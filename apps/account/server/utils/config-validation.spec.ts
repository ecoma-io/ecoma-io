import { describe, expect, it, vi } from 'vitest';

import { MAX_SKEW_SECONDS, MIN_SKEW_SECONDS } from '@ecoma-io/identity-contracts';

import { lazyConfigValidator, validateAccountConfig } from './config-validation';

/**
 * Test fail-closed của config.
 *
 * Mỗi test ở đây bảo vệ một câu hỏi: "Worker có khởi động được khi config sai không?".
 * Câu trả lời đúng cho tất cả là **không** — vì `03-operations.md` §8 quy định identity
 * không có degraded path, và Worker khởi động được rồi mới phát hiện thiếu secret thì
 * nó đã nhận traffic.
 */

/** Secret đủ dài, hợp lệ theo luật độ dài tối thiểu. */
const VALID_SECRET = 'k'.repeat(32);

describe('validateAccountConfig', () => {
  it('accepts a valid secret', () => {
    expect(() => validateAccountConfig({ internalHmacSecret: VALID_SECRET })).not.toThrow();
  });

  it('rejects a missing secret', () => {
    expect(() => validateAccountConfig({ internalHmacSecret: undefined })).toThrow(
      /NUXT_INTERNAL_HMAC_SECRET/u,
    );
  });

  it('rejects an empty secret instead of falling back to an unauthenticated path', () => {
    // Secret rỗng là trường hợp nguy hiểm nhất: `verifyRequest` chạy trơn và chấp nhận
    // MỌI chữ ký. Vì vậy rỗng phải throw chứ không được coi là "không cấu hình thì bỏ qua".
    expect(() => validateAccountConfig({ internalHmacSecret: '' })).toThrow(
      /NUXT_INTERNAL_HMAC_SECRET/u,
    );
  });

  it('rejects a non-string secret', () => {
    expect(() => validateAccountConfig({ internalHmacSecret: 12345 })).toThrow(
      /NUXT_INTERNAL_HMAC_SECRET/u,
    );
  });

  it('rejects a secret shorter than the minimum length', () => {
    expect(() => validateAccountConfig({ internalHmacSecret: 'k'.repeat(31) })).toThrow(
      /ít nhất 32 ký tự/u,
    );
  });

  it('never reveals the configured secret itself in the error message', () => {
    // Message lỗi đọc được trong log của platform, nên nó chỉ được nêu **ngưỡng** và
    // tên biến — không bao giờ nêu độ dài thật hay bất kỳ ký tự nào của secret.
    let message = '';
    try {
      validateAccountConfig({ internalHmacSecret: 'x'.repeat(5) });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('xxxxx');
    expect(message).toContain('NUXT_INTERNAL_HMAC_SECRET');
  });

  it('rejects a non-integer skew window', () => {
    expect(() =>
      validateAccountConfig({ internalHmacSecret: VALID_SECRET, internalAuthSkewSeconds: 1.5 }),
    ).toThrow(/NUXT_INTERNAL_AUTH_SKEW_SECONDS/u);
  });

  it('rejects a non-positive skew window', () => {
    expect(() =>
      validateAccountConfig({ internalHmacSecret: VALID_SECRET, internalAuthSkewSeconds: 0 }),
    ).toThrow(/NUXT_INTERNAL_AUTH_SKEW_SECONDS/u);
  });

  it('rejects a skew window above the protocol cap', () => {
    // Trần là **hằng giao thức** của `identity-contracts`, không phải ngưỡng cục bộ: nếu
    // `account` nhận `86400` trong khi `auth` từ chối nó, hai service chạy hai cửa sổ khác
    // nhau và bên rộng hơn quyết định cửa sổ replay thật. Test neo đúng biên qua biên:
    // `MAX_SKEW_SECONDS` phải **qua**, `MAX_SKEW_SECONDS + 1` phải **rơi**.
    expect(() =>
      validateAccountConfig({
        internalHmacSecret: VALID_SECRET,
        internalAuthSkewSeconds: MAX_SKEW_SECONDS,
      }),
    ).not.toThrow();
    expect(() =>
      validateAccountConfig({
        internalHmacSecret: VALID_SECRET,
        internalAuthSkewSeconds: MAX_SKEW_SECONDS + 1,
      }),
    ).toThrow(/NUXT_INTERNAL_AUTH_SKEW_SECONDS/u);
  });

  it('rejects the library floor exactly one below MIN_SKEW_SECONDS', () => {
    // Biên dưới dùng **cùng hằng** với `auth` (trước đây mỗi bên tự hardcode một luật).
    expect(() =>
      validateAccountConfig({
        internalHmacSecret: VALID_SECRET,
        internalAuthSkewSeconds: MIN_SKEW_SECONDS,
      }),
    ).not.toThrow();
    expect(() =>
      validateAccountConfig({
        internalHmacSecret: VALID_SECRET,
        internalAuthSkewSeconds: MIN_SKEW_SECONDS - 1,
      }),
    ).toThrow(/NUXT_INTERNAL_AUTH_SKEW_SECONDS/u);
  });

  it('accepts an absent skew window so the library default stays authoritative', () => {
    // Không đặt ⇒ `verifyRequest` dùng `DEFAULT_SKEW_SECONDS`. Chỉ có một nơi định
    // nghĩa mặc định, trong `identity-contracts`, để không có hai nguồn sự thật cho
    // một luật.
    expect(() =>
      validateAccountConfig({ internalHmacSecret: VALID_SECRET, internalAuthSkewSeconds: '' }),
    ).not.toThrow();
    expect(() => validateAccountConfig({ internalHmacSecret: VALID_SECRET })).not.toThrow();
  });
});

/**
 * `lazyConfigValidator` — thời điểm gọi: request đầu, không phải module-init.
 *
 * Trên Workers, `createNitroApp()` chạy top-level của `index.mjs` khi module
 * Worker load, còn secret chỉ được nối vào runtime config ở request. Validate
 * lúc init đọc config **chưa có secret** và ném ⇒ module không load được ⇒ kể
 * cả deployment đúng cũng chết. Các test dưới đây giữ ba tính chất của phiên
 * bản trì hoãn: (1) không validate trước khi được ensure, (2) config thiếu vẫn
 * ném và **vẫn** ném ở lần sau — cờ chưa được set, (3) sau khi hợp lệ thì đắt
 * nhất một boolean check.
 */
describe('lazyConfigValidator', () => {
  it('does not validate until the first ensure call', () => {
    const readConfig = vi.fn<(event: unknown) => { internalHmacSecret: string }>(() => ({
      internalHmacSecret: VALID_SECRET,
    }));
    lazyConfigValidator(readConfig);
    expect(readConfig).not.toHaveBeenCalled();
  });

  it('throws on the first request when the config is missing and keeps throwing', () => {
    // Fail-closed của phiên bản trì hoãn: ném ở giữa ⇒ cờ chưa set ⇒ request sau
    // thử lại và vẫn ném. Không có đường "thử một lần rồi cho qua".
    const ensure = lazyConfigValidator(() => ({ internalHmacSecret: '' }));
    expect(() => ensure({})).toThrow(/NUXT_INTERNAL_HMAC_SECRET/u);
    expect(() => ensure({})).toThrow(/NUXT_INTERNAL_HMAC_SECRET/u);
  });

  it('validates once after a successful first request', () => {
    const readConfig = vi.fn<(event: unknown) => { internalHmacSecret: string }>(() => ({
      internalHmacSecret: VALID_SECRET,
    }));
    const ensure = lazyConfigValidator(readConfig);
    const event = { marker: 'request-1' };
    ensure(event);
    ensure({ marker: 'request-2' });
    // Đúng một lần đọc config — và đọc đúng event của request đầu.
    expect(readConfig).toHaveBeenCalledTimes(1);
    expect(readConfig).toHaveBeenCalledWith(event);
  });

  it('retries and succeeds once the config becomes valid', () => {
    let secret = '';
    const ensure = lazyConfigValidator(() => ({ internalHmacSecret: secret }));
    expect(() => ensure({})).toThrow(/NUXT_INTERNAL_HMAC_SECRET/u);
    secret = VALID_SECRET;
    expect(() => ensure({})).not.toThrow();
    // Đã hợp lệ: lần tiếp theo không ném và không đọc lại config thừa.
    expect(() => ensure({})).not.toThrow();
  });
});
