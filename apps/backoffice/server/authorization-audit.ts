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
 *
 * ## Ba đường ghi, ba outcome khác nhau
 *
 * | Hàm                    | Outcome  | Khi nào                                                    |
 * | ---------------------- | -------- | --------------------------------------------------------- |
 * | {@link recordDecision} | `denied` | Policy `can()` trả deny (thiếu permission, hết hạn, revoke…) |
 * | {@link recordStaleWriteDenial} | `denied` | Write path thấy ảnh authorization quá TTL (S1/F2)     |
 * | {@link recordAuthorizationFailure} | `failure` | Actor không xác định được — không gắn actor (S4)  |
 *
 * Cả ba đều propagate lỗi (I-08) và cả ba đều dùng chung **một** đường ghi
 * {@link writeAuditRow} — một bảng audit có nhiều đường ghi là nơi scrubbing
 * (SR-014) dễ hở.
 */

import type { Client } from 'pg';

import type {
  AuthorizationDecision,
  AuthorizationMode,
  AuthorizationRiskClass,
  CatalogPermission,
} from '@ecoma-io/backoffice-domain';
import { isBackofficeAccountId } from '@ecoma-io/backoffice-domain';

/**
 * Độ dài tối đa của `request_id` / `correlation_id` ghi vào audit.
 *
 * ⚠️ Hai ID này là **correlation** id do tầng trên sinh, không phải payload:
 * giới hạn độ dài chặn một chuỗi tuỳ ý dài vô hạn làm đầy bảng audit (SR-013
 * đòi "mỗi privileged operation một record", nên bảng này là bảng ghi sự kiện
 * chứ không phải nơi chứa dữ liệu). Cùng ngưỡng này được DB chặn bằng CHECK ở
 * migration `0004` — tầng app và tầng DB cùng một con số, và test integration
 * ghim rằng hai bên không lệch.
 */
export const AUTHORIZATION_AUDIT_ID_MAX_LENGTH = 128;

/**
 * Reason code của denial phát sinh ở **tầng enforcement** (không phải từ
 * policy `can()`) — tập ĐÓNG, không ghép chữ tự do.
 *
 * `stale_write_blocked`: write path nhận ảnh authorization đã quá TTL của
 * risk class, nên không đủ tươi cho thao tác ghi (SR-008, ADR-0002) — đường
 * này fail-closed thay vì âm thầm nới cửa sổ.
 */
export const ENFORCEMENT_DENIAL_STALE_WRITE = 'stale_write_blocked';

/**
 * Reason code của một lần kiểm tra authorization **không xác định được actor**
 * — actor sai định dạng thì không gắn được actor vào bản ghi (S4, issue #102).
 */
export const AUTHORIZATION_FAILURE_INVALID_ACTOR = 'invalid_actor';

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
  /**
   * Đường thao tác (`read` | `write`) — ghi vào `context` để audit đọc được
   * quyết định được đánh giá trên đường nào (F4, issue #101). Mặc định
   * `'read'` khớp với mặc định của `requirePermission`.
   */
  readonly mode?: AuthorizationMode;
}

/**
 * Ngữ cảnh audit ghi vào cột `context` — chỉ marker, **không** payload.
 *
 * ⚠️ `context` là cột jsonb duy nhất của bảng audit có thể mang dữ liệu tuỳ ý,
 * nên nó là nơi SR-014 (không secret/PII) dễ hở nhất. Vì vậy kiểu này là
 * **đóng**: mọi trường đều là marker đã biết, không có chỗ cho payload lạ.
 */
export interface AuthorizationAuditContext {
  /** Risk class mà quyết định được tính theo (ADR-0002). */
  readonly riskClass: AuthorizationRiskClass;
  /** Marker ảnh authorization đã quá TTL của risk class hay chưa. */
  readonly stale: boolean;
  /** Đường thao tác: `'read'` hay `'write'` (SR-008 — re-check at write time). */
  readonly mode: AuthorizationMode;
}

/**
 * Đầu vào của bản ghi **failure** — lần kiểm tra authorization không xác định
 * được actor (S4, issue #102).
 */
export interface AuthorizationFailureAuditInput {
  /** Permission đã hỏi — vẫn biết dù actor không xác định được. */
  readonly permission: CatalogPermission;
  /** Risk class của operation (để audit đọc được ngữ cảnh). */
  readonly riskClass: AuthorizationRiskClass;
  /** Đường thao tác (`read` | `write`). */
  readonly mode: AuthorizationMode;
  /** Request ID — cột `request_id`. */
  readonly requestId?: string;
  /** Correlation ID — cột `correlation_id`. */
  readonly correlationId?: string;
}

/**
 * Đầu vào của bản ghi **denied phát sinh ở tầng enforcement** — write path thấy
 * ảnh authorization quá TTL (S1/F2).
 */
export interface EnforcementDenialAuditInput {
  /** Account ID của actor — đã qua validate {@link isBackofficeAccountId}. */
  readonly actorSub: string;
  /** Account ID của subject bị tác động, nếu operation tác động ai đó. */
  readonly targetSub?: string;
  /** Permission đã hỏi (`domain.action`). */
  readonly permission: CatalogPermission;
  /** Risk class của operation. */
  readonly riskClass: AuthorizationRiskClass;
  /** Marker stale của ảnh authorization đã dùng để đánh giá. */
  readonly stale: boolean;
  /** Đường thao tác — luôn là `'write'` ở đường này. */
  readonly mode: AuthorizationMode;
  /** Request ID — cột `request_id`. */
  readonly requestId?: string;
  /** Correlation ID — cột `correlation_id`. */
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
    // không có bản ghi audit mồ côi định danh. Đường "actor không xác định
    // được" dùng {@link recordAuthorizationFailure} (outcome `failure`,
    // `actor_sub` NULL) — có dấu vết mà không bịa đặt danh tính.
    throw new TypeError('authorization audit yêu cầu actorSub là BackofficeAccountId hợp lệ');
  }

  // ⚠️ Outcome chỉ một giá trị ở hook deny này (`denied`): allow path KHÔNG
  // ghi audit (SR-013 là privileged *operation* audit — đường allow phổ thông
  // của một read handler không là privileged op; chỉ operation đổi quyền/
  // vượt permission mới ghim audit. Caller muốn ghi audit cho allow của một
  // privileged op dùng {@link recordPrivilegedSuccess} — xem 01 §4.6: audit
  // ghi "đã xảy ra gì", KHÔNG thay thế enforcement).
  if (input.decision.allowed) {
    throw new TypeError(
      'recordDecision chỉ ghi denied; allow của privileged operation dùng recordPrivilegedSuccess',
    );
  }

  const reasonCode = input.decision.riskClass + ':' + input.decision.denial;

  await writeAuditRow(client, {
    actorSub: input.actorSub,
    targetSub: input.targetSub,
    action: input.permission,
    outcome: 'denied',
    reasonCode,
    requestId: input.requestId,
    correlationId: input.correlationId,
    context: {
      riskClass: input.decision.riskClass,
      stale: input.decision.stale,
      mode: input.mode ?? 'read',
    },
  });
}

/**
 * Ghi bản ghi **denied** cho write path bị chặn vì ảnh authorization quá TTL
 * (S1/F2 — issue #101/#102).
 *
 * ⚠️ Khác {@link recordDecision} ở chỗ **quyết định của policy vẫn là allow**:
 * principal CÓ quyền, nhưng ảnh quyền đã quá hạn theo risk class nên không đủ
 * tươi cho thao tác ghi (SR-008: không dùng kết quả đã cache trước thay đổi).
 * Vì vậy đây là một **denial của enforcement**, không phải denial của policy —
 * và nó phải để lại dấu vết y hệt deny thường (SR-018), nếu không thì đường
 * ghi bị chặn là đường im lặng.
 */
export async function recordStaleWriteDenial(
  client: Client,
  input: EnforcementDenialAuditInput,
): Promise<void> {
  if (!isBackofficeAccountId(input.actorSub)) {
    throw new TypeError('authorization audit yêu cầu actorSub là BackofficeAccountId hợp lệ');
  }

  await writeAuditRow(client, {
    actorSub: input.actorSub,
    targetSub: input.targetSub,
    action: input.permission,
    outcome: 'denied',
    reasonCode: `${input.riskClass}:${ENFORCEMENT_DENIAL_STALE_WRITE}`,
    requestId: input.requestId,
    correlationId: input.correlationId,
    context: {
      riskClass: input.riskClass,
      stale: input.stale,
      mode: input.mode,
    },
  });
}

/**
 * Ghi bản ghi **failure** cho một lần kiểm tra authorization mà actor không xác
 * định được (S4 — issue #102).
 *
 * ⚠️ `actor_sub` là NULL — actor sai định dạng thì **không** gắn được danh
 * tính nào vào bản ghi, và bịa một actor để "cho có" là tệ hơn việc để trống:
 * audit mà chứa danh tính bịa là audit sai. Đây là lý do `outcome` của bản ghi
 * này là `failure` (lỗi hệ thống khi thực thi operation), khác `denied`
 * (quyết định chủ đích của policy).
 *
 * ⚠️ Không validate `actorSub` ở đây — **đó là lý do tồn tại** của hàm này.
 */
export async function recordAuthorizationFailure(
  client: Client,
  input: AuthorizationFailureAuditInput,
): Promise<void> {
  await writeAuditRow(client, {
    actorSub: null,
    targetSub: undefined,
    action: input.permission,
    outcome: 'failure',
    reasonCode: AUTHORIZATION_FAILURE_INVALID_ACTOR,
    requestId: input.requestId,
    correlationId: input.correlationId,
    context: {
      riskClass: input.riskClass,
      stale: false,
      mode: input.mode,
    },
  });
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

/** Thông tin một bản ghi audit sắp ghi — đã validate, đã scrub. */
interface AuditRow {
  readonly actorSub: string | null;
  readonly targetSub?: string;
  readonly action: string;
  readonly outcome: 'success' | 'failure' | 'denied';
  readonly reasonCode: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly context: AuthorizationAuditContext;
}

/**
 * **Đường ghi duy nhất** của module — mọi bản ghi audit đi qua đây.
 *
 * Vì sao một đường: SR-014 (không secret/PII) được bảo đảm bằng việc *mọi*
 * giá trị đi qua đây đều đã được validate và scrub ở tầng trên; một bảng audit
 * có nhiều đường ghi là nơi một đường quên validate sẽ lọt.
 *
 * ⚠️ `target_sub` phải là {@link isBackofficeAccountId} hợp lệ: `target_sub` là
 * Account ID mà operation tác động, không phải chuỗi tự do — nếu nó mang bất
 * kỳ payload nào thì audit đã thành kênh rò dữ liệu (S2, issue #102).
 * `request_id`/`correlation_id` là correlation id do tầng trên sinh: cap độ
 * dài để bảng audit không bị một chuỗi tuỳ ý làm ngập.
 */
async function writeAuditRow(client: Client, row: AuditRow): Promise<void> {
  if (row.targetSub !== undefined && !isBackofficeAccountId(row.targetSub)) {
    throw new TypeError('authorization audit yêu cầu targetSub là BackofficeAccountId hợp lệ');
  }

  assertBoundedCorrelationId(row.requestId, 'requestId');
  assertBoundedCorrelationId(row.correlationId, 'correlationId');

  await client.query(
    `INSERT INTO backoffice.authorization_audit
       (actor_sub, target_sub, action, outcome, reason_code, request_id, correlation_id, context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      row.actorSub,
      row.targetSub ?? null,
      row.action,
      row.outcome,
      row.reasonCode,
      row.requestId ?? null,
      row.correlationId ?? null,
      // Context chỉ mang marker đã biết — không payload nào khác, không
      // fallback stringify object lạ (SR-014: scrubbing chủ động ở đây).
      JSON.stringify(row.context),
    ],
  );
}

/**
 * Chặn correlation id quá dài — xem {@link AUTHORIZATION_AUDIT_ID_MAX_LENGTH}.
 */
function assertBoundedCorrelationId(value: string | undefined, field: string): void {
  if (value !== undefined && value.length > AUTHORIZATION_AUDIT_ID_MAX_LENGTH) {
    throw new TypeError(
      `authorization audit yêu cầu ${field} dài tối đa ${AUTHORIZATION_AUDIT_ID_MAX_LENGTH} ký tự`,
    );
  }
}
