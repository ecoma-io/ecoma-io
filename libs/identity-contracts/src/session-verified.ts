/**
 * Contract `POST /internal/session/verified` — consumer `account`, provider `auth`
 * (`docs/services/account/01-architecture.md` §5.1.1).
 *
 * ⚠️ **Đây là contract substitution của cả hệ thống.** `account` đẩy kết quả xác thực
 * của chính nó sang `auth`; nếu payload mang thêm tham số của authorization transaction
 * (`client_id`, `redirect_uri`, `scope`, `state`, `nonce`, PKCE) thì một request bị chặm
 * sẽ có thể ghi đè transaction đó bằng danh tính của session khác — tức hoàn thành
 * authorization dưới tên người khác.
 *
 * Vì vậy validator ở đây là **cấu trúc**, không phải kiểm tra sau: nhóm thứ hai bị
 * chặn bằng danh sách `FORBIDDEN_SESSION_VERIFIED_FIELDS`, và type của request được
 * định nghĩa sao cho **không còn chỗ** để thêm trường mà không sửa contract.
 */

/** Mức bằng chứng xác thực — mirror ladder của tầng domain, khai báo lại ở đây. */
export const AUTHN_LEVEL_VALUES = ['anonymous', 'password', 'totp', 'passkey'] as const;

/** Union mức bằng chứng trên wire. */
export type AuthnLevelValue = (typeof AUTHN_LEVEL_VALUES)[number];

/**
 * Thân request — **đúng sáu trường này, không hơn**.
 *
 * Không `client_id`, không `redirect_uri`, không `scope`, không `state`, không `nonce`,
 * không PKCE: những thứ đó thuộc transaction của `auth`, đã lưu từ `/authorize`, và
 * request push không được phép ghi đè chúng.
 */
export interface SessionVerifiedRequest {
  /** Handle X do `auth` cấp. */
  readonly handle: string;
  /** Subject lấy từ session của `account`. */
  readonly sub: string;
  /** Mức bằng chứng của session. */
  readonly authn_level: AuthnLevelValue;
  /** Thời điểm xác thực (epoch ms), để `auth` đo tuổi bằng chứng. */
  readonly authn_at: number;
  /** Session reference của `account` — phải so khớp `sub` trong `db-account`. */
  readonly account_session_ref: string;
  /** Idempotency key của event. */
  readonly event_id: string;
}

/**
 * Nhóm trường **không được phép** có mặt trong payload.
 *
 * FR-006f: bỏ nhóm này khỏi payload làm transaction substitution bất khả thi **về mặt
 * cấu trúc** — mạnh hơn là kiểm tra thêm sau khi đã nhận.
 */
export const FORBIDDEN_SESSION_VERIFIED_FIELDS = [
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'nonce',
  'code_challenge',
  'code_verifier',
] as const;

/** Trường bắt buộc — thiếu bất kỳ trường nào cũng bị từ chối. */
export const REQUIRED_SESSION_VERIFIED_FIELDS = [
  'handle',
  'sub',
  'authn_level',
  'authn_at',
  'account_session_ref',
  'event_id',
] as const;

/** Outcome mà `auth` quyết định ngay trong response. */
export type SessionVerifiedOutcome = 'consent_required' | 'granted' | 'already_processed';

/** Thân response — `200` có body, **không** dùng `204` ở bất kỳ outcome nào. */
export interface SessionVerifiedResponse {
  readonly outcome: SessionVerifiedOutcome;
  /**
   * URL tuyệt đối do `auth` dựng; `account` chỉ `302` browser tới đó, không tự ghép
   * chuỗi. Vắng ở `already_processed` vì outcome đó không có continuation để cấp.
   */
  readonly continue_url?: string;
  /** Chỉ có ở `already_processed` — trạng thái kết thúc của transaction. */
  readonly transaction_state?: string;
}

/** Lý do từ chối payload. */
export type SessionVerifiedRejectionReason =
  | 'invalid_payload'
  | 'missing_field'
  | 'forbidden_field';

/** Kết quả validate — discriminated union. */
export type SessionVerifiedValidation =
  | { readonly ok: true; readonly request: SessionVerifiedRequest }
  | {
      readonly ok: false;
      readonly reason: SessionVerifiedRejectionReason;
      readonly detail: string;
    };

/** Kiểm tra `authn_level` có thuộc ladder không. */
function isAuthnLevelValue(value: unknown): value is AuthnLevelValue {
  return typeof value === 'string' && (AUTHN_LEVEL_VALUES as readonly string[]).includes(value);
}

/**
 * Validate payload của `POST /internal/session/verified`.
 *
 * Kiểm theo thứ tự: nhóm cấm trước (để request tấn công bị chặn ở đúng chỗ đáng chặn và
 * không bị gán nhầm là lỗi thiếu trường), rồi trường bắt buộc, rồi kiểu từng trường.
 *
 * ⚠️ Không log hay nối vào `detail` bất kỳ **giá trị** nào từ payload: `detail` chỉ nêu
 * *tên* trường, không nêu nội dung — invariant 9 cấm log session handle.
 */
export function validateSessionVerifiedRequest(payload: unknown): SessionVerifiedValidation {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, reason: 'invalid_payload', detail: 'Payload phải là object.' };
  }
  const record = payload as Record<string, unknown>;

  for (const field of FORBIDDEN_SESSION_VERIFIED_FIELDS) {
    if (field in record) {
      return {
        ok: false,
        reason: 'forbidden_field',
        detail: `Payload chứa trường bị cấm: ${field}.`,
      };
    }
  }

  for (const field of REQUIRED_SESSION_VERIFIED_FIELDS) {
    if (!(field in record)) {
      return { ok: false, reason: 'missing_field', detail: `Payload thiếu trường: ${field}.` };
    }
  }

  if (!isAuthnLevelValue(record.authn_level)) {
    return {
      ok: false,
      reason: 'invalid_payload',
      detail: `authn_level không thuộc ladder: ${String(record.authn_level)}`,
    };
  }
  if (typeof record.handle !== 'string' || record.handle.length === 0) {
    return { ok: false, reason: 'invalid_payload', detail: 'handle phải là chuỗi không rỗng.' };
  }
  if (typeof record.sub !== 'string' || record.sub.length === 0) {
    return { ok: false, reason: 'invalid_payload', detail: 'sub phải là chuỗi không rỗng.' };
  }
  if (typeof record.account_session_ref !== 'string' || record.account_session_ref.length === 0) {
    return {
      ok: false,
      reason: 'invalid_payload',
      detail: 'account_session_ref phải là chuỗi không rỗng.',
    };
  }
  if (typeof record.event_id !== 'string' || record.event_id.length === 0) {
    return { ok: false, reason: 'invalid_payload', detail: 'event_id phải là chuỗi không rỗng.' };
  }
  if (typeof record.authn_at !== 'number' || !Number.isSafeInteger(record.authn_at)) {
    return { ok: false, reason: 'invalid_payload', detail: 'authn_at phải là epoch ms nguyên.' };
  }

  return {
    ok: true,
    request: {
      handle: record.handle,
      sub: record.sub,
      authn_level: record.authn_level,
      authn_at: record.authn_at,
      account_session_ref: record.account_session_ref,
      event_id: record.event_id,
    },
  };
}
