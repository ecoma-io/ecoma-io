/**
 * Audit hook của authorization — ghi quyết định denied/failure vào
 * `backoffice.authorization_audit`, chỉ qua **runtime role** (chỉ có
 * SELECT + INSERT trên bảng — grant lớp 1 của SR-015), theo đúng pipeline
 * chạy migration của workstream A: bảng nằm trong schema `backoffice`,
 * không đường ghi nào ngoài role `ecoma_backoffice_runtime` được dùng.
 *
 * Source of truth:
 * - `02-requirements.md` SR-013: mỗi privileged operation ghi audit đủ 7
 *   trường (actor, target, action, time, result, reason, request/correlation).
 * - SR-014 + invariant 7: audit KHÔNG chứa token/secret/PII — CHECK top-level
 *   key của schema chỉ là soft-check; scrubbing thật nằm ở đây (không field
 *   nào trong struct này nhận payload tuỳ ý).
 * - SR-018 / T-18: deny cũng phải quan sát được — deny mà nuốt lỗi ghi audit
 *   là mất tín hiệu điều tra.
 * - **I-08 của issue #86: lỗi audit không được âm thầm nuốt.** {@link recordDecision}
 *   KHÔNG `.catch(() => {})`: một `INSERT` audit hỏng phải propagate lên
 *   caller để caller tự fail-closed (không hoàn tất enforcement procession
 *   mà không thấy được denial đã log — cùng nguyên tắc với T-18).
 * - ADR-0002, khung `0001_backoffice_domain.sql`: audit phải INSERT được
 *   ngay trong đường deny — append-only chỉ chặn UPDATE/DELETE.
 */

import type { Client } from 'pg';

import type { AuthorizationDecision, CatalogPermission } from '@ecoma-io/backoffice-domain';
import { isBackofficeAccountId } from '@ecoma-io/backoffice-domain';

/**
 * Các mảnh thông tin của một lần gọi `requirePermission` — cấu thành **đúng
 * 7 trường** của SR-013; struct KHÔNG có chỗ nào cho token/secret/payload
 * (SR-014 ở tầng type, mạnh hơn CHECK của SQL).
 */
export interface DecisionAuditInput {
  /** Account ID của actor — đã qua validate {@link isBackofficeAccountId}. */
  readonly actorSub: string;
  /** Account ID của subject bị tác động, nếu operation tác động ai đó. */
  readonly targetSub?: string;
  /**
   * Permission đã hỏi (`domain.action`) — vào cột `action` của audit; định
   * danh tới catalog, không phải chuỗi tự do.
   */
  readonly permission: CatalogPermission;
  /** Quyết định của {@link can} — outcome + reason_code + risk class. */
  readonly decision: AuthorizationDecision;
  /** Request ID — cột `request_id`, không nhận giá trị từ client. */
  readonly requestId?: string;
  /** Correlation ID — cột `correlation_id`, không nhận giá trị từ client. */
  readonly correlationId?: string;
}

/**
 * Ghi một bản ghi audit **denied** cho một lần gọi `requirePermission` —
 * outcome luôn `denied` (SR-018: deny cũng phải quan sát được); đường
 * success của privileged operation dùng {@link recordPrivilegedSuccess}.
 *
 * ⚠️ Propagate error — KHÔNG nuốt (I-08). Lỗi DB phải ném lên caller, caller
 * {@link requirePermission} dùng nó để fail-closed: một denial KHÔNG log
 * được là một request phải từ chối, không phải request được im lặng cho qua.
 *
 * ⚠️ Chỉ nhận client của **runtime role** — bảng chỉ grant SELECT+INSERT cho
 * `ecoma_backoffice_runtime` và caller phải tự cắm credential đúng; thư viện
 * này không tự mở connection (không node-local state). `INSERT` column-name
 * tường minh: `id`/`occurred_at` để DB default, không nhận giá trị từ code.
 *
 * @param client pg client đã kết nối bằng runtime role.
 */
export async function recordDecision(client: Client, input: DecisionAuditInput): Promise<void> {
  if (!isBackofficeAccountId(input.actorSub)) {
    // Actor sai định dạng là bug tầng composition, không phải dữ liệu tin
    // được: KHÔNG ghi audit với actor rác — ném để đường request chết ngay,
    // không có bản ghi audit mồ côi định danh.
    throw new TypeError('authorization audit yêu cầu actorSub là BackofficeAccountId hợp lệ');
  }

  // ⚠️ Outcome chỉ một giá trị ở hook deny này (`denied`): allow path KHÔNG
  // ghi audit (SR-013 là privileged *operation* audit — đường allow phổ thông
  // của một read handler không là privileged op; chỉ operation đổi quyền/
  // vượt permission mới ghim audit. Caller muốn ghi audit cho allow của một
  // privileged op dùng {@link recordPrivilegedSuccess} — xem 01 §4.6: audit
  // ghi "đã xảy ra gì", KHÔNG thay thế enforcement). Outcome `failure` của
  // schema dành cho lỗi hệ thống khi thực thi operation — nếu một lần gọi
  // privileged operation ném lỗi sau khi đã pass policy, caller tự ghi
  // audit `failure` bằng INSERT riêng với cùng khối 7 trường.
  if (input.decision.allowed) {
    throw new TypeError(
      'recordDecision chỉ ghi denied; allow của privileged operation dùng recordPrivilegedSuccess',
    );
  }
  const outcome = 'denied' as const;

  const reasonCode = input.decision.riskClass + ':' + input.decision.denial;

  await client.query(
    `INSERT INTO backoffice.authorization_audit
       (actor_sub, target_sub, action, outcome, reason_code, request_id, correlation_id, context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.actorSub,
      input.targetSub ?? null,
      input.permission,
      outcome,
      reasonCode,
      input.requestId ?? null,
      input.correlationId ?? null,
      // Context chỉ mang marker risk class — không payload nào khác, không
      // fallback stringify object lạ (SR-014: scrubbing chủ động ở đây).
      JSON.stringify({ riskClass: input.decision.riskClass, stale: input.decision.stale }),
    ],
  );
}

/**
 * Ghi audit cho một **privileged operation cho phép** (outcome `success`).
 *
 * Tách khỏi {@link recordDecision} để type ép phân biệt: đường allow phủ
 * động của một read thông thường KHÔNG tạo audit; chỉ caller gọi tường minh với
 * tham số đủ 7 trường mới ghi được success.
 */
export interface PrivilegedOperationAuditInput {
  readonly actorSub: string;
  readonly targetSub?: string;
  /** Định danh operation có audit (vd. `role_management.assign`). */
  readonly operation: string;
  /** Ghi chú reason_code tự do của operation — vẫn text thuần, không payload. */
  readonly reasonCode?: string;
  readonly requestId?: string;
  readonly correlationId?: string;
}

export async function recordPrivilegedSuccess(
  client: Client,
  input: PrivilegedOperationAuditInput,
): Promise<void> {
  if (!isBackofficeAccountId(input.actorSub)) {
    throw new TypeError('authorization audit yêu cầu actorSub là BackofficeAccountId hợp lệ');
  }

  await client.query(
    `INSERT INTO backoffice.authorization_audit
       (actor_sub, target_sub, action, outcome, reason_code, request_id, correlation_id, context)
     VALUES ($1, $2, $3, 'success', $4, $5, $6, '{}'::jsonb)`,
    [
      input.actorSub,
      input.targetSub ?? null,
      input.operation,
      input.reasonCode ?? null,
      input.requestId ?? null,
      input.correlationId ?? null,
    ],
  );
}
