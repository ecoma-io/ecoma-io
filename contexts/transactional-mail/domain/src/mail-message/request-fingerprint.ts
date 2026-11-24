/**
 * Value object `RequestFingerprint` — dấu vân tay một chiều có khoá của canonical request.
 *
 * ⚠️ Đây KHÔNG phải hash trần (§6.3, invariant 17): HMAC với khoá do
 * keyring cấp. Việc tính HMAC (crypto) thuộc tầng application/infrastructure — domain
 * chỉ mô hình hoá **hình dạng đã persist** và việc so sánh.
 *
 * Hình dạng persist: `<profileTag>:<64 hex>` — profile tag (`p1.k1`) nhận diện đúng
 * khoá đã ký row, để replay sau rotation tính lại bằng đúng khoá cũ (FR-002 keyring).
 *
 * `variables` không bao giờ nằm ở đây — fingerprint là một chiều, không chứa raw
 * variables, nội dung render, token hay credential.
 */

import type { Brand } from '@ecoma-io/domain-primitives';

/** Dấu vân tay một chiều có khoá — hình dạng đã persist trong `request_fingerprint`. */
export type RequestFingerprint = Brand<string, 'RequestFingerprint'>;

/** Số hex ký tự của HMAC-SHA256. */
export const FINGERPRINT_HEX_LENGTH = 64;

/** Kết quả parse fingerprint đã persist. */
export type StoredFingerprintParse =
  | { readonly ok: true; readonly profileTag: string; readonly digestHex: string }
  | { readonly ok: false; readonly reason: 'shape' };

/**
 * Parse fingerprint đã persist thành `(profileTag, digestHex)`.
 *
 * Tag lạ hay digest không phải 64 hex là **dữ liệu hỏng / profile chưa từng định
 * nghĩa** — caller phân loại thành `service-unavailable` (503, trạng thái keyring),
 * KHÔNG `409` (không phải payload sai của caller).
 */
export function parseStoredFingerprint(stored: string): StoredFingerprintParse {
  const separator = stored.indexOf(':');
  if (separator <= 0 || separator === stored.length - 1) {
    return { ok: false, reason: 'shape' };
  }
  const profileTag = stored.slice(0, separator);
  const digestHex = stored.slice(separator + 1);
  if (!/^[0-9a-f]{64}$/u.test(digestHex)) {
    return { ok: false, reason: 'shape' };
  }
  return { ok: true, profileTag, digestHex };
}
