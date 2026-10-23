/**
 * Enforcement của authorization cho server routes của `apps/backoffice` —
 * lớp modular phủ policy-call sang `@ecoma-io/backoffice-domain/can()`:
 * deny-by-default trên mọi protected request, server-side mỗi request
 * (SR-002/SR-003), không route nào được allow mặc định.
 *
 * ## Hình thức lớp modular — KHÔNG đụng handler nghiệp vụ
 *
 * Cố ý KHÔNG import bất kỳ handler trong `server/api/**`: module này là
 * checkpoint enforcement riêng — business handler (read routes của J1 và
 * các route tương lai) đi qua {@link requirePermission} trước khi chạm dữ
 * liệu. Task này không sửa business handler nào; một route được "phủ" bằng
 * cách gọi {@link requirePermission} ở đầu handler, và route nào gọi là
 * route đó được bảo vệ — không có khối middleware tự động phủ theo path
 * (không có khối middleware tự động phủ theo path; xem ghi chú phụ ở cuối
 * file về authn boundary).
 *
 * ## ADR-0009 — không sync-call mỗi request
 *
 * {@link requirePermission} đánh giá trên ảnh assignment đã đồng bộ mà
 * caller dựng — **KHÔNG** có lời gọi HTTP/sync-call tới `backoffice` trên
 * đường request. Kênh đồng bộ (batch/event-based) là quyết định chưa chốt
 * của schema (`outbox_states` chưa được tạo ở workstream A); khi nó ra đời
 * sẽ chỉ làm ảnh assignment tươi hơn, còn hợp đồng của policy-call này
 * không đổi. Chỗ cần event-based sync về sau: nhận invalidation push từ
 * `backoffice` khi `role_assignments` đổi — sẽ cắm vào đây thay vì re-read
 * theo TTL, không phải thay thế {@link can}.
 *
 * ## `stale` là marker, không phải verdict allow (S1, F2)
 *
 * `can()` trả `stale: true` khi ảnh assignment đã quá TTL của risk class
 * (ADR-0002: `normal` ≤ 60s, `high` ≤ 5s). Trước S1, enforcement nuốt marker
 * này: `if (decision.allowed) return decision` — ảnh quyền cũ vẫn cho qua,
 * tức "âm thầm nới cửa sổ" mà ADR-0002 cấm, và SR-008 (re-check at write
 * time, chống TOCTOU) chưa có code thật.
 *
 * Luật sau S1 — **fail-closed trên đường ghi**:
 *
 * - `mode: 'write'` + `stale: true` ⇒ **KHÔNG** cho qua. Ảnh quyền đã quá
 *   ngưỡng thì không đủ tươi cho thao tác ghi; caller phải re-read (hoặc
 *   chờ sync mới) rồi thử lại. Đường này ghi audit rồi trả `503` — không
 *   phải `403`, vì đây không phải quyết định từ chối do thiếu quyền mà là
 *   "chưa đủ dữ liệu để quyết định" (T-14: unknown ≠ allow).
 * - `mode: 'read'` + `stale: true` ⇒ cho qua **kèm marker** trả về. Đây là
 *   cửa sổ mà ADR-0002 đã chốt cho lớp `normal`; chặn nó ở đường đọc sẽ
 *   biến mọi request thành `503` vì ảnh batch-sync vốn già hơn TTL.
 *
 * `mode` mặc định là `'read'` để **không phá** call-site đang có: mọi route
 * gọi {@link requirePermission} mà chưa khai `mode` vẫn chạy đúng như trước
 * (chỉ là được bảo vệ yếu hơn trên đường ghi — caller ghi thì phải khai
 * `mode: 'write'`, và đó là điều SR-008 đòi).
 *
 * ## HTTP status của deny
 *
 * - Deny do dữ liệu authorization không đọc được / audit ghi hỏng — `503`
 *   "authorization unavailable" (fail-closed của T-14: unknown ≠ allow).
 * - Deny có lý do nội tại (không có permission / hết hạn / bị revoke /
 *   staff không active) — `403` như bảng AC của `02-requirements.md`.
 *
 * ⚠️ Thân response không phân biệt lý do: phía gọi không học từ response
 * rằng assignment đã revoke ở mốc nào — `denial` chỉ vào audit, cùng hình
 * thức với `internal-auth.ts` của `account` (một message chung, reason chỉ
 * vào log/audit).
 *
 * ## Ghi chú phụ — authn boundary chưa có ở task này
 *
 * `requirePermission` nhận principal ĐÃ verify (token đã qua `auth`) từ
 * caller; việc dựng `PrincipalAuthorization` từ token là phần authn của
 * pipeline lớn hơn, không thuộc task B — module này chỉ đảm bảo KHÔNG route
 * nào đi quanh checkpoint và KHÔNG nhánh nào coi "chưa verify" là allow.
 */

import { createError } from 'h3';
import type { Client } from 'pg';

import {
  can,
  isBackofficeAccountId,
  type AuthorizationDecision,
  type AuthorizationMode,
  type AuthorizationRiskClass,
  type CatalogPermission,
  type GrantedAssignment,
} from '@ecoma-io/backoffice-domain';

import {
  recordAuthorizationFailure,
  recordDecision,
  recordStaleWriteDenial,
} from './authorization-audit';

/**
 * Dữ liệu authorization đã đồng bộ của một principal — caller dựng từ
 * persistence của workstream A (schema `backoffice`), KHÔNG tin từ client.
 */
export interface PrincipalAuthorization {
  readonly assignments: readonly GrantedAssignment[];
  /** Account ID đã verify server-side (`sub` từ token — không nhận từ client). */
  readonly actorSub: string;
}

/**
 * Checkpoint authorization của một protected request.
 *
 * Thứ tự:
 * 1. Validate principal — actor sai định dạng ⇒ ghi audit `failure` rồi
 *    `503`: fail closed trước cả bước chạy policy (dữ liệu đầu vào mờ hồ không
 *    phải allow). S4: **audit TRƯỚC throw** — một denial không để lại dấu vết
 *    là mất tín hiệu điều tra (SR-018).
 * 2. Chạy {@link can} (policy thuần) với risk class do caller truyền —
 *    class gắn theo OPERATION (ADR-0002), không theo role/người dùng.
 * 3. Allow **nhưng ảnh đã cũ** trên đường ghi ⇒ ghi audit rồi `503` (S1/F2).
 * 4. Deny ⇒ ghi audit qua runtime role trước khi throw — **lỗi audit
 *    propagate** (I-08): `INSERT` audit hỏng biến request thành `503`
 *    denial-unlogged, không có đường nào denial im lặng cho qua.
 * 5. Deny đã log ⇒ `403` với thân chung; `allow` ⇒ trả decision (caller
 *    đọc `stale` để tự re-check at write time với thao tác ghi — SR-008).
 *
 * @param permission Định danh `domain.action` đọc từ catalog của backoffice
 *   (invariant 10/SR-020) — KHÔNG tự phát minh permission ngoài catalog.
 * @param auditClient pg client của **runtime role** (`ecoma_backoffice_runtime`)
 *   — bảng audit chỉ INSERT được qua role đó (SR-015).
 */
export async function requirePermission(
  permission: CatalogPermission,
  principal: PrincipalAuthorization,
  auditClient: Client,
  options: {
    readonly riskClass?: AuthorizationRiskClass;
    readonly requestId?: string;
    readonly correlationId?: string;
    readonly targetSub?: string;
    /**
     * Đường thao tác — `'read'` (mặc định) hoặc `'write'`. Trên `'write'`, ảnh
     * authorization quá TTL **không** được dùng để quyết định (S1/F2, SR-008).
     */
    readonly mode?: AuthorizationMode;
  } = {},
): Promise<AuthorizationDecision> {
  const riskClass = options.riskClass ?? 'normal';
  const mode = options.mode ?? 'read';

  if (!isBackofficeAccountId(principal.actorSub)) {
    // ⚠️ Audit TRƯỚC throw (S4): actor không xác định được thì request chết ở
    // đây, và nếu không ghi thì lần kiểm tra này **không để lại dấu vết nào** —
    // đúng đường "deny im lặng" mà SR-018 cấm. `actor_sub` NULL trong bản ghi
    // (không bịa danh tính), outcome `failure` (lỗi hệ thống, không phải quyết
    // định từ chối), reason `invalid_actor`.
    //
    // Lỗi audit vẫn propagate (I-08) — nó thay thế 503 bằng lỗi DB, và cả hai
    // đều fail-closed.
    await recordAuthorizationFailure(auditClient, {
      permission,
      riskClass,
      mode,
      requestId: options.requestId,
      correlationId: options.correlationId,
    });

    throw createError({ statusCode: 503, statusMessage: 'authorization unavailable' });
  }

  const decision = can(permission, principal.assignments, new Date(), riskClass);

  if (decision.allowed) {
    // ⚠️ S1/F2: `stale` là marker "ảnh này đã quá TTL", KHÔNG phải verdict
    // allow. Trên đường ghi thì ảnh cũ là TOCTOU (SR-008) — chặn ở đây,
    // ghi audit rồi `503` (chưa đủ dữ liệu để quyết định, T-14).
    if (mode === 'write' && decision.stale) {
      await recordStaleWriteDenial(auditClient, {
        actorSub: principal.actorSub,
        targetSub: options.targetSub,
        permission,
        riskClass,
        stale: decision.stale,
        mode,
        requestId: options.requestId,
        correlationId: options.correlationId,
      });

      throw createError({ statusCode: 503, statusMessage: 'authorization unavailable' });
    }

    return decision;
  }

  // ⚠️ Thứ tự này quan trọng: audit TRƯỚC throw — một denial mà audit hỏng
  // ném từ đây ra ngoài (503), còn denial đã log xong mới 403. Đảo lại
  // thành "throw trước" là chính đường "deny im lặng" mà SR-018 cấm.
  await recordDecision(auditClient, {
    actorSub: principal.actorSub,
    targetSub: options.targetSub,
    permission,
    decision,
    requestId: options.requestId,
    correlationId: options.correlationId,
    mode,
  });

  throw createError({ statusCode: 403, statusMessage: 'forbidden' });
}
