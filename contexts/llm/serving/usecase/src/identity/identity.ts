/**
 * Identity THUẦN của logical request — step 4 của pipeline serving.
 *
 * Module này không đọc env, không chạm DB, không fetch. Hai identity ĐỘC LẬP
 * VĨNH VIỄN của admission được suy TẤT ĐỊNH ở đây (§11, invariant 9):
 * - quota reservation id: từ `request_id` (một logical request một reservation);
 * - financial admission identity: từ `(request_id, attempt_id)` — không bao
 *   giờ trùng identity quota (ADR-0028 §5).
 */

/** Giới hạn độ dài id opaque của hệ thống (khớp `isOpaqueId` của financial lib). */
const MAX_OPAQUE_ID_LENGTH = 200;

// ---------------------------------------------------------------------------
// Id tất định
// ---------------------------------------------------------------------------

/** Quota reservation id — identity thứ nhất, suy từ `request_id`. */
export function deriveQuotaReservationId(requestId: string): string {
  return `quota:${requestId}`;
}

/** Attempt id của attempt số `attemptNo` của một logical request. */
export function deriveAttemptId(requestId: string, attemptNo: number): string {
  return `attempt:${requestId}:${String(attemptNo)}`;
}

/** Financial reservation id — identity thứ hai, suy từ `(request_id, attempt_id)`. */
export function deriveFinancialReservationId(requestId: string, attemptId: string): string {
  return `finres:${requestId}:${attemptId}`;
}

/** Settlement id tất định của `(request_id, attempt_id)` — settle idempotent không tra cứu. */
export function deriveSettlementId(requestId: string, attemptId: string): string {
  return `settle:${requestId}:${attemptId}`;
}

/** Charge id tất định của `(request_id, attempt_id)`. */
export function deriveChargeId(requestId: string, attemptId: string): string {
  return `charge:${requestId}:${attemptId}`;
}

/** Completion id của response (`chatcmpl-` + request_id) — tất định, không randomness. */
export function deriveCompletionId(requestId: string): string {
  return `chatcmpl-${requestId}`;
}

// ---------------------------------------------------------------------------
// request_id + payload hash (idempotency)
// ---------------------------------------------------------------------------

/** Kết quả đọc `x-request-id`: tự sinh khi thiếu, từ chối khi sai hình. */
export type RequestIdResolution =
  | { readonly kind: 'generated'; readonly requestId: string }
  | { readonly kind: 'provided'; readonly requestId: string }
  | { readonly kind: 'invalid' };

/**
 * Đọc identity của logical request từ giá trị header `x-request-id`: trim,
 * 1..200 ký tự opaque. `headerValue === undefined` (header vắng mặt) → gọi
 * `generate` do caller cấp (UUID qua port {@link RequestIdGenerator} ở usecase
 * — hàm thuần này không tự sinh). Sai hình → `invalid` (lỗi 400, không tự sinh
 * — caller thừa nhận một contract không hợp lệ phải thấy lỗi, không phải một
 * request mới im lặng).
 */
export function resolveRequestId(
  headerValue: string | undefined,
  generate?: () => string,
): RequestIdResolution {
  if (headerValue === undefined) {
    if (generate === undefined) {
      return { kind: 'invalid' };
    }
    return { kind: 'generated', requestId: generate() };
  }
  const trimmed = headerValue.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_OPAQUE_ID_LENGTH) {
    return { kind: 'invalid' };
  }
  return { kind: 'provided', requestId: trimmed };
}

/**
 * Canonical JSON: key sort đệ quy — cùng payload với thứ tự key khác nhau cho
 * cùng hash (replay đúng nghĩa), payload khác cho hash khác (conflict).
 * `undefined` field bị drop (JSON.stringify semantics), array giữ thứ tự.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .toSorted(([leftKey], [rightKey]) => (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}
