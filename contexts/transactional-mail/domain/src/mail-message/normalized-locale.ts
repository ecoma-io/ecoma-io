/**
 * Value object `NormalizedLocale` + hàm chuẩn hoá locale.
 *
 * Cùng nguyên tắc với recipient: **một hàm chuẩn hoá duy nhất** dùng cho cả
 * fingerprint lẫn chọn template (§6.3). Chuỗi vào fingerprint là
 * chuỗi ĐÃ chuẩn hoá, không phải giá trị nguyên văn từ request.
 */

import type { Brand } from '@ecoma-io/domain-primitives';

/** Locale đã chuẩn hoá — dạng dùng cho fingerprint và chọn template version. */
export type NormalizedLocale = Brand<string, 'NormalizedLocale'>;

/** Locale mặc định của service — fallback một lần khi locale yêu cầu không có template. */
export const DEFAULT_LOCALE = 'en';

/** Giới hạn độ dài: BCP-47 tag dài thực tế nhất vẫn nhỏ hơn nhiều con số này. */
export const MAX_LOCALE_LENGTH = 35;

/** Kết quả chuẩn hoá locale. */
export type LocaleNormalization =
  | { readonly ok: true; readonly value: NormalizedLocale }
  | { readonly ok: false; readonly reason: 'empty' | 'too-long' | 'malformed' };

/**
 * Pattern BCP-47 tước bỏ phân biệt hoa/thường ở cú pháp — giá trị trả về vẫn
 * giữ nguyên văn (không lowercase toàn bộ): `en-US` và `en-us` là MỘT locale sau
 * chuẩn hoá case-insensitive, nhưng lowercase toàn chuỗi là sai cho fingerprint
 * vì fingerprint phải deterministic trên chuỗi chuẩn hoá duy nhất.
 *
 * subtag: letter/digit (2-8) hoặc 4 ký tự chữ + digit…
 * Đủ chặt để từ chối chuỗi control character và dấu cách.
 */
const BCP47_PATTERN = /^[a-z]{2,8}(-[a-z0-9]{2,8})*(-[a-z0-9]{2,8})?$/iu;

/**
 * Chuẩn hoá locale: trim, kiểm độ dài, kiểm hình dạng BCP-47 đơn giản.
 *
 * Chuẩn hoá ở đây là **identity sau trim + validate hình dạng** — không lowercase,
 * không canonicalize subtag: hai chuỗi khác cú pháp hoa/thường sẽ cho fingerprint
 * khác nhau, và đó là quyết định có chủ đích (deterministic, không phụ thuộc bảng
 * IANA ở domain layer). Application layer có thể canonicalize thêm nếu muốn, nhưng
 * phải qua hàm này trước.
 */
export function normalizeLocale(input: string | undefined): LocaleNormalization {
  const trimmed = (input ?? '').trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (trimmed.length > MAX_LOCALE_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }
  if (!BCP47_PATTERN.test(trimmed)) {
    return { ok: false, reason: 'malformed' };
  }
  return { ok: true, value: trimmed as NormalizedLocale };
}
