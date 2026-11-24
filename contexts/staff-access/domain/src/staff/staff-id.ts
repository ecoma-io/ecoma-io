/**
 * Định danh `Staff` — định danh nội bộ của bounded context `staff-access`.
 *
 * ⚠️ `StaffId` KHÔNG được đồng nhất với `AccountSubject`. `StaffId` do
 * `staff-access` phát hành (prefix `staff_`), `AccountSubject` là reference
 * opaque do `account` cấp (prefix `sub_`). Hai định danh này ở boundary khác,
 * không tái dùng, không chuyển đổi ngầm.
 *
 * Thư viện thuần TypeScript: không SQL, không Node builtin, không I/O. Entropy
 * do caller cung cấp (CSPRNG ở application layer).
 */

import type { Brand } from '@ecoma-io/domain-primitives';

/** Prefix bắt buộc, phân biệt `StaffId` với các định danh khác trong log. */
const STAFF_ID_PREFIX = 'staff_';

/** Số ký tự base32 của phần entropy — 32 × 5 bit = 160 bit. */
export const STAFF_ID_ENTROPY_CHARS = 32;

/** Alphabet base32 chuẩn RFC 4648, viết thường, không padding. */
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** Opaque value object — brand nominal, không constructor public. */
export type StaffId = Brand<string, 'StaffId'>;

/** Regex đầy đủ cho một `StaffId` hợp lệ. */
const STAFF_ID_PATTERN = new RegExp(
  `^${STAFF_ID_PREFIX}[${BASE32_ALPHABET}]{${STAFF_ID_ENTROPY_CHARS}}$`,
  'u',
);

/**
 * Kiểm tra một chuỗi bất kỳ có phải `StaffId` hợp lệ không — dùng khi đọc từ
 * nguồn bên ngoài (DB, contract) sau khi serialization mất brand.
 */
export function isStaffId(value: unknown): value is StaffId {
  return typeof value === 'string' && STAFF_ID_PATTERN.test(value);
}

/**
 * Tạo `StaffId` mới từ entropy do caller sinh.
 *
 * @param entropy Chuỗi base32 viết thường, đúng
 *   {@link STAFF_ID_ENTROPY_CHARS} ký tự.
 * @throws TypeError nếu entropy sai kiểu hoặc sai định dạng.
 */
export function createStaffId(entropy: string): StaffId {
  if (typeof entropy !== 'string') {
    throw new TypeError('StaffId entropy phải là chuỗi.');
  }
  const full = `${STAFF_ID_PREFIX}${entropy}`;
  if (!STAFF_ID_PATTERN.test(full)) {
    throw new TypeError(
      `StaffId entropy phải là ${STAFF_ID_ENTROPY_CHARS} ký tự base32 viết thường (${BASE32_ALPHABET}).`,
    );
  }
  return full as StaffId;
}

/** Lấy phần entropy của `StaffId` (bỏ prefix) — chỉ phục vụ chẩn đoán log/audit. */
export function staffIdEntropy(staffId: StaffId): string {
  return staffId.slice(STAFF_ID_PREFIX.length);
}
