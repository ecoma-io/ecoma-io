/**
 * Value object `NormalizedEmailAddress` — địa chỉ email đã chuẩn hóa
 * (trim + lowercase + NFC), dạng "processing representation": đầu vào của
 * việc hash và của việc hiển thị/so sánh trước khi hash.
 *
 * Đây là khía cạnh **xử lý** của địa chỉ — không bao giờ xuất hiện trong
 * snapshot/persistence (DB chỉ lưu `address_hash`, xem
 * {@link ./email-address-key.ts}). Chuẩn hóa khớp DB CHECK trên `address_hash`
 * ở cả `email_addresses` và `invitations` trong reference.
 */

import type { Brand } from '@ecoma-io/domain-primitives';

/** Địa chỉ email đã chuẩn hóa (trim + lowercase + NFC). */
export type NormalizedEmailAddress = Brand<string, 'NormalizedEmailAddress'>;

/**
 * Chuẩn hóa địa chỉ email và bọc thành VO (sync — convention §3: VO factory
 * không làm việc async; hashing nằm ở `hashAddressKey`).
 *
 * @throws TypeError nếu không phải chuỗi hoặc rỗng sau chuẩn hóa.
 */
export function normalizeEmailAddress(address: string): NormalizedEmailAddress {
  if (typeof address !== 'string') {
    throw new TypeError('Địa chỉ email phải là chuỗi.');
  }
  const normalized = address.trim().toLowerCase().normalize('NFC');
  if (normalized.length === 0) {
    throw new TypeError('Địa chỉ email không được rỗng.');
  }
  return normalized as NormalizedEmailAddress;
}

export function isNormalizedEmailAddress(value: unknown): value is NormalizedEmailAddress {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim().toLowerCase().normalize('NFC')
  );
}
