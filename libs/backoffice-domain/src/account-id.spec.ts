/**
 * Ghim định dạng và entropy threshold của `BackofficeAccountId`.
 *
 * ⚠️ Đây là test cho **constraint type** — lib thuần không có policy runtime.
 * 1:1 mapping giữa staff và Account ID được enforce ở tầng DB (PRIMARY KEY
 * trên `staff.sub`) và tầng application, không ở lib này.
 */

import { describe, expect, it } from 'vitest';

import {
  BACKOFFICE_ACCOUNT_ID_ENTROPY_BITS,
  BACKOFFICE_ACCOUNT_ID_ENTROPY_CHARS,
  BACKOFFICE_ACCOUNT_ID_MIN_ENTROPY_BITS,
  BACKOFFICE_ACCOUNT_ID_PREFIX,
  backofficeAccountIdEntropy,
  createBackofficeAccountId,
  isBackofficeAccountId,
} from './account-id';

/** Entropy hợp lệ — đúng độ dài, đúng alphabet. */
const ENTROPY = 'a'.repeat(BACKOFFICE_ACCOUNT_ID_ENTROPY_CHARS);

describe('entropy threshold', () => {
  it('declares at least 256 bits and encodes them exactly', () => {
    expect(BACKOFFICE_ACCOUNT_ID_MIN_ENTROPY_BITS).toBe(256);
    expect(BACKOFFICE_ACCOUNT_ID_ENTROPY_BITS).toBeGreaterThanOrEqual(
      BACKOFFICE_ACCOUNT_ID_MIN_ENTROPY_BITS,
    );
    // Hằng bits phải đúng sản phẩm: đổi độ dài mà không tính lại là bug ở chỗ
    // log/audit sẽ in con số sai.
    expect(BACKOFFICE_ACCOUNT_ID_ENTROPY_BITS).toBe(BACKOFFICE_ACCOUNT_ID_ENTROPY_CHARS * 5);
  });

  it('keeps the alphabet lowercase base32 without the digits silhouette', () => {
    // Sử dụng một entropy ngoài alphabet phải fail create → constraint alphabet
    //ownership gắn với guard ăn khớp là bất biến.
    const outsideAlphabet = `${'g'.repeat(BACKOFFICE_ACCOUNT_ID_ENTROPY_CHARS - 1)}8`;
    expect(() => createBackofficeAccountId(outsideAlphabet)).toThrow(TypeError);
  });
});

describe('type guard', () => {
  it('accepts the well-formed id and rejects look-alikes', () => {
    const accountId = createBackofficeAccountId(ENTROPY);
    expect(isBackofficeAccountId(accountId)).toBe(true);
    expect(isBackofficeAccountId(`${BACKOFFICE_ACCOUNT_ID_PREFIX}${ENTROPY.slice(0, -1)}G`)).toBe(
      false,
    );
    expect(isBackofficeAccountId(`${BACKOFFICE_ACCOUNT_ID_PREFIX}${'a'.repeat(32)}`)).toBe(false);
    expect(isBackofficeAccountId(`staff_${ENTROPY}`)).toBe(false);
    expect(isBackofficeAccountId(undefined)).toBe(false);
    expect(isBackofficeAccountId(null)).toBe(false);
  });
});

describe('createBackofficeAccountId', () => {
  it('prefixes the given entropy and returns a valid id', () => {
    const accountId = createBackofficeAccountId(ENTROPY);
    expect(accountId.startsWith(BACKOFFICE_ACCOUNT_ID_PREFIX)).toBe(true);
    expect(backofficeAccountIdEntropy(accountId)).toBe(ENTROPY);
  });

  it('rejects non-string entropy and wrong lengths', () => {
    expect(() => createBackofficeAccountId(undefined as unknown as string)).toThrow(TypeError);
    expect(() => createBackofficeAccountId('')).toThrow(TypeError);
    expect(() =>
      createBackofficeAccountId('a'.repeat(BACKOFFICE_ACCOUNT_ID_ENTROPY_CHARS - 1)),
    ).toThrow(TypeError);
    expect(() => createBackofficeAccountId(`${ENTROPY}a`)).toThrow(TypeError);
  });
});

describe('opaque brand', () => {
  it('keeps the value exactly the string it wraps', () => {
    // Brand chỉ là marker type-level, không thêm property runtime nào: value
    // đọc lại bằng `String()` phải đúng chuỗi đã tạo.
    expect(String(createBackofficeAccountId(ENTROPY))).toBe(
      `${BACKOFFICE_ACCOUNT_ID_PREFIX}${ENTROPY}`,
    );
  });
});
