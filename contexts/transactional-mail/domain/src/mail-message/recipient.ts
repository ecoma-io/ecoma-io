/**
 * Value object `Recipient` — địa chỉ nhận đã chuẩn hoá, dạng duy nhất persist và
 * đưa vào fingerprint.
 *
 * Chuẩn hoá là **một hàm duy nhất** dùng cho cả fingerprint lẫn lưu trữ/chọn template
 * (§6.3) — không tồn tại hai chuẩn hoá khác nhau cho cùng một giá trị.
 *
 * Quy tắc chuẩn hoá (§6.3, chấp nhận có chủ đích):
 * - trim, từ chối chuỗi rỗng / không có đúng một `@` / chứa control character;
 * - lowercase **domain** (IDN về A-label trước — IDN conversion cần runtime unicode,
 *   thuộc tầng application; domain lib chỉ lowercase phần ASCII);
 * - giữ nguyên và phân biệt hoa/thường **local-part**;
 * - **không** strip dot, **không** strip plus-tag, **không** áp rule riêng của provider —
 *   service không sở hữu semantics đó. Hệ quả được chấp nhận: nếu provider coi hai
 *   mailbox khác hoa/thường là một, hậu quả tệ nhất là gửi dư, không phải dedupe sai
 *   hai request khác nhau.
 */

import type { Brand } from '@ecoma-io/domain-primitives';

/** Địa chỉ nhận đã chuẩn hoá — dạng duy nhất persist, không bao giờ là địa chỉ thô. */
export type Recipient = Brand<string, 'Recipient'>;

/** Có ký tự control (C0/C1, trừ tab) trong chuỗi — loop code point, không dùng
 *  control-regex (lint no-control-regex). */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const cp = value.codePointAt(i) ?? 0;
    if ((cp < 0x20 && cp !== 0x09) || (cp >= 0x7f && cp <= 0x9f)) {
      return true;
    }
  }
  return false;
}

/** Kết quả chuẩn hoá: hợp lệ hoặc từ chối — không bao giờ trả chuỗi nửa vời. */
export type RecipientNormalization =
  | { readonly ok: true; readonly value: Recipient }
  | { readonly ok: false; readonly reason: 'empty' | 'no-at' | 'multiple-at' | 'control-char' };

/**
 * Chuẩn hoá địa chỉ nhận — hàm chuẩn hoá duy nhất của context.
 *
 * Không throw: mọi trường hợp không hợp lệ đều là kết quả có kiểu, để caller
 * (application layer) phân loại `400` mà không cần try/catch.
 */
export function normalizeRecipient(input: string): RecipientNormalization {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (hasControlCharacter(trimmed)) {
    return { ok: false, reason: 'control-char' };
  }
  // Đếm '@' bằng indexOf hai lần — rẻ và không cần regex toàn cục.
  const firstAt = trimmed.indexOf('@');
  if (firstAt === -1) {
    return { ok: false, reason: 'no-at' };
  }
  if (trimmed.indexOf('@', firstAt + 1) !== -1) {
    return { ok: false, reason: 'multiple-at' };
  }
  // Local-part giữ nguyên hoa/thường; domain lowercase.
  const localPart = trimmed.slice(0, firstAt);
  const domain = trimmed.slice(firstAt + 1).toLowerCase();
  if (localPart.length === 0 || domain.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  return { ok: true, value: `${localPart}@${domain}` as Recipient };
}
