/**
 * Enforcement của authorization cho server routes của `apps/backoffice` —
 * lớp modular phủ policy-call sang `@ecoma-io/backoffice-domain/can()`:
 * deny-by-default trên mọi protected request, server-side mỗi request
 * (SR-002/SR-003), không route nào được allow mặc định.
 *
 * ## Hình thức lớp modular — KHÔNG đụng handler nghiệp vụ
 *
 * Cố ý KHÔNG import bất kỳ handler trong `server/api/**`: module này là
 * checkpoint enforcement riêng — business handler (hiện chỉ `greet`) và
 * các route tương lai đi qua {@link requirePermission} trước khi chạm dữ
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
 * `backoffice` khi `role_assignments` đổi — sẽ cắm vào đây thay cho re-read
 * theo TTL, không phải thay thế {@link can}.
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
  type AuthorizationRiskClass,
  type CatalogPermission,
  type GrantedAssignment,
} from '@ecoma-io/backoffice-domain';

import { recordDecision } from './authorization-audit';

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
 * 1. Validate principal — actor sai định dạng ⇒ `503` ngay: fail closed
 *    trước cả bước chạy policy (dữ liệu đầu vào mờ hồ không phải allow).
 * 2. Chạy {@link can} (policy thuần) với risk class do caller truyền —
 *    class gắn theo OPERATION (ADR-0002), không theo role/người dùng.
 * 3. Deny ⇒ ghi audit qua runtime role trước khi throw — **lỗi audit
 *    propagate** (I-08): `INSERT` audit hỏng biến request thành `503`
 *    denial-unlogged, không có đường nào denial im lặng cho qua.
 * 4. Deny đã log ⇒ `403` với thân chung; `allow` ⇒ trả decision (caller
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
  } = {},
): Promise<AuthorizationDecision> {
  if (!isBackofficeAccountId(principal.actorSub)) {
    throw createError({ statusCode: 503, statusMessage: 'authorization unavailable' });
  }

  const decision = can(
    permission,
    principal.assignments,
    new Date(),
    options.riskClass ?? 'normal',
  );

  if (decision.allowed) {
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
  });

  throw createError({ statusCode: 403, statusMessage: 'forbidden' });
}
