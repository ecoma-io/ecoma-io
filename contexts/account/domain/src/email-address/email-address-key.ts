/**
 * Value object `EmailAddressKey` — **định danh opaque** của một địa chỉ email:
 * SHA-256 hex của địa chỉ đã chuẩn hóa. Đây là dạng duy nhất được persist
 * (`address_hash` trong reference — anti-enumeration) và là dạng duy nhất
 * xuất hiện trong snapshot của mọi aggregate (Account, Invitation,
 * OtpChallenge).
 *
 * Tách hai khía cạnh:
 * - Xử lý: {@link ./normalized-email-address.ts} (normalize, sync VO).
 * - Định danh: `EmailAddressKey` này — bất biến, không reverse được.
 *
 * Hashing là async (WebCrypto) nên nằm ở {@link hashAddressKey}, tách khỏi VO
 * factory (convention §3: VO factory đồng bộ).
 */

import type { Brand } from '@ecoma-io/domain-primitives';

import type { NormalizedEmailAddress } from './normalized-email-address';

/** SHA-256 hex (64 ký tự) của địa chỉ đã chuẩn hóa — `address_hash` trong DB. */
export type EmailAddressKey = Brand<string, 'EmailAddressKey'>;

/**
 * Hash SHA-256 (hex) của địa chỉ đã chuẩn hóa — dạng được lưu trong DB và
 * dùng làm identity xuyên suốt các aggregate.
 */
export async function hashAddressKey(address: NormalizedEmailAddress): Promise<EmailAddressKey> {
  const bytes = new TextEncoder().encode(address),
    digest = await crypto.subtle.digest('SHA-256', bytes),
    hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return hex as EmailAddressKey;
}

/**
 * Type guard cho key tái tạo từ persistence: hex 64 ký tự. Không kiểm tra được
 * "đúng là hash của một địa chỉ" — đó là thuộc tính không thể verify lại từ
 * hash, và không cần: key là opaque.
 */
export function isEmailAddressKey(value: unknown): value is EmailAddressKey {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}
