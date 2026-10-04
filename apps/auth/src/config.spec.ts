import { exportPKCS8, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { AuthConfigurationError, SigningKeyProvider } from '@ecoma-io/identity-auth-domain';
import { DEFAULT_SKEW_SECONDS } from '@ecoma-io/identity-auth-contracts';

import { type AuthEnv, loadAuthConfig } from './config';

/**
 * Nạp cấu hình là nơi quyết định Worker có phát hành token được hay không.
 *
 * ⚠️ Mỗi test ở đây là một CÁCH CẤU HÌNH SAI mà nếu lọt qua sẽ thành lỗ hổng.
 * Suite xanh vì vậy có giá trị; suite đỏ nghĩa là có một đường mà lỗi đi vào.
 */

let pem: string;

beforeAll(async () => {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  pem = await exportPKCS8(privateKey);
});

/** `K_auth`: 32 byte base64url, đúng dạng Worker Secret thật. */
const HANDLE_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function makeEnv(overrides: Partial<AuthEnv> = {}): AuthEnv {
  return {
    HYPERDRIVE: { connectionString: 'hyperdrive-internal-placeholder' },
    ACCOUNT_SERVICE: { fetch: async () => new Response('{}') },
    AUTH_SIGNING_KEY: pem,
    AUTH_SIGNING_KEY_ID: 'kid-2026-01',
    AUTH_HANDLE_KEY: HANDLE_KEY,
    AUTH_HANDLE_KEY_VERSION: '1',
    AUTH_INTERNAL_SECRET: 'internal-secret-test',
    AUTH_ISSUER: 'https://auth.ecoma.io',
    AUTH_AUDIENCE: 'https://api.ecoma.io',
    // oidc-provider ký cookie phiên bằng keygrip — thiếu là fail-closed.
    AUTH_COOKIE_KEYS: 'test-cookie-key-1,test-cookie-key-2',
    AUTH_ACCOUNT_BASE_URL: 'https://account.ecoma.io',
    ...overrides,
  };
}

describe('loadAuthConfig — fail-closed', () => {
  it('naph duoc cau hinh day du', async () => {
    const config = await loadAuthConfig(makeEnv());
    expect(config.issuer).toBe('https://auth.ecoma.io');
    expect(config.audience).toBe('https://api.ecoma.io');
    expect(config.signingKeyProvider.kid).toBe('kid-2026-01');
    expect(config.handleKeyVersion).toBe(1);
  });

  it('THIEU signing key — nem, KHONG sinh khoa tam', async () => {
    // ⚠️ Đây là D4. Một khoá sinh lúc khởi động đổi mỗi lần deploy: JWKS đổi
    // theo và mọi token đã cấu không còn verify được.
    await expect(loadAuthConfig(makeEnv({ AUTH_SIGNING_KEY: undefined }))).rejects.toThrow(
      AuthConfigurationError,
    );
  });

  it('THIEU Hyperdrive binding — nem', async () => {
    await expect(loadAuthConfig(makeEnv({ HYPERDRIVE: undefined }))).rejects.toThrow(
      /HYPERDRIVE|db-auth/u,
    );
  });

  it('THIEU ACCOUNT_SERVICE — nem, vi khong the fail-closed', async () => {
    // ⚠️ Không có binding tới Account thì không có cách nào hỏi trạng thái
    // account, và "không hỏi được coi như khoẻ" đúng là lỗ hổng.
    await expect(loadAuthConfig(makeEnv({ ACCOUNT_SERVICE: undefined }))).rejects.toThrow(
      /ACCOUNT_SERVICE/u,
    );
  });

  it('secret rong (chua whitespace) cung bi tu choi', async () => {
    await expect(loadAuthConfig(makeEnv({ AUTH_HANDLE_KEY: '   ' }))).rejects.toThrow(
      /AUTH_HANDLE_KEY/u,
    );
  });

  it('KHONG co gia tri mac dinh cho bat ky secret nao', async () => {
    // Lặp qua từng secret: thiếu bất kỳ cái nào cũng phải ném.
    const secrets = [
      'AUTH_SIGNING_KEY',
      'AUTH_SIGNING_KEY_ID',
      'AUTH_HANDLE_KEY',
      'AUTH_HANDLE_KEY_VERSION',
      'AUTH_INTERNAL_SECRET',
      'AUTH_ISSUER',
      'AUTH_AUDIENCE',
      'AUTH_COOKIE_KEYS',
      'AUTH_ACCOUNT_BASE_URL',
    ] as const;

    for (const secret of secrets) {
      await expect(loadAuthConfig(makeEnv({ [secret]: undefined }))).rejects.toThrow(
        AuthConfigurationError,
      );
    }
  });

  it('AUTH_HANDLE_KEY_VERSION with a malformed value — throws', async () => {
    await expect(loadAuthConfig(makeEnv({ AUTH_HANDLE_KEY_VERSION: '0x1' }))).rejects.toThrow(
      /AUTH_HANDLE_KEY_VERSION/u,
    );
    await expect(loadAuthConfig(makeEnv({ AUTH_HANDLE_KEY_VERSION: '0' }))).rejects.toThrow(
      /AUTH_HANDLE_KEY_VERSION/u,
    );
    await expect(loadAuthConfig(makeEnv({ AUTH_HANDLE_KEY_VERSION: ' 1' }))).rejects.toThrow(
      /AUTH_HANDLE_KEY_VERSION/u,
    );
  });

  it('PEM khong phai PKCS#8 — nem ro rang', async () => {
    await expect(
      loadAuthConfig(
        makeEnv({
          AUTH_SIGNING_KEY:
            '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEE\n-----END EC PRIVATE KEY-----',
        }),
      ),
    ).rejects.toThrow(/PKCS#8/u);
  });

  it('thong diep loi KHONG chua gia tri secret', async () => {
    // ⚠️ Một thông báo lỗi chứa secret là một secret nằm trong log.
    let message = '';
    try {
      await loadAuthConfig(makeEnv({ AUTH_SIGNING_KEY: undefined }));
    } catch (error: unknown) {
      message = (error as Error).message;
    }
    expect(message).not.toContain(pem);
    expect(message).not.toContain('internal-secret-test');
  });
});

describe('AUTH_INTERNAL_SKEW_SECONDS — a protocol constant, not a free-form field', () => {
  it('unset or an empty string ⇒ DEFAULT_SKEW_SECONDS of the lib', async () => {
    const unset = await loadAuthConfig(makeEnv());
    const empty = await loadAuthConfig(makeEnv({ AUTH_INTERNAL_SKEW_SECONDS: '' }));

    expect(unset.internalAuthSkewSeconds).toBe(DEFAULT_SKEW_SECONDS);
    expect(empty.internalAuthSkewSeconds).toBe(DEFAULT_SKEW_SECONDS);
  });

  it('a valid decimal integer ⇒ exactly that number, and 0 is rejected', async () => {
    const config = await loadAuthConfig(makeEnv({ AUTH_INTERNAL_SKEW_SECONDS: '120' }));

    expect(config.internalAuthSkewSeconds).toBe(120);
    await expect(loadAuthConfig(makeEnv({ AUTH_INTERNAL_SKEW_SECONDS: '0' }))).rejects.toThrow(
      /AUTH_INTERNAL_SKEW_SECONDS/u,
    );
  });

  it.each([
    ['leading whitespace', ' 300'],
    ['trailing whitespace', '300 '],
    ['decimal part', '3.0'],
    ['hex literal', '0x10'],
    ['exponent notation', '1e3'],
    ['leading plus', '+300'],
    ['negative', '-1'],
    ['trailing letter', '300x'],
    ['whitespace-only string', '   '],
    ['trailing newline', '300\n'],
  ])('rejects a value that is not a decimal digit string: %s', async (_label, value) => {
    // ⚠️ Mọi giá trị ở đây đều LỌT qua `Number.isInteger(Number(value))` — trừ
    // `'300x'`/`'   '` — nên một phép kiểm bằng `Number.isInteger` sẽ nhận im lặng
    // `'0x10'` thành 16, `'1e3'` thành 1000. Đó không phải chi tiết hình thức: skew
    // quyết định cửa sổ replay của envelope VÀ TTL của nonce.
    //
    // `'300\n'` là ca tinh tế nhất: trong JavaScript `$` **không** khớp trước một
    // ký tự xuống dòng cuối (đó là hành vi của Python), nên `/^\d+$/u` từ chối nó —
    // nhưng `Number('300\n')` vẫn là 300, nên bỏ regex mà chỉ dùng `Number()` là
    // nhận im lặng một giá trị có ký tự lạ.
    await expect(loadAuthConfig(makeEnv({ AUTH_INTERNAL_SKEW_SECONDS: value }))).rejects.toThrow(
      /AUTH_INTERNAL_SKEW_SECONDS/u,
    );
  });

  it('rejects a skew above the cap — a typo must not open a 24h replay window', async () => {
    // ⚠️ `86400` vẫn là "số nguyên không âm": nếu chỉ kiểm kiểu thì một Worker Secret
    // gõ sai sẽ im lặng mở cửa sổ replay lên 24 giờ và kéo TTL nonce theo, làm phình
    // bảng `auth.internal_nonces`. Trần biến lỗi gõ tay thành lỗi cấu hình.
    await expect(loadAuthConfig(makeEnv({ AUTH_INTERNAL_SKEW_SECONDS: '86400' }))).rejects.toThrow(
      /AUTH_INTERNAL_SKEW_SECONDS/u,
    );
  });

  it('3600 is exactly at the cap, 3601 is over it', async () => {
    // ⚠️ Biên của một trần là chỗ dễ sai nhất: đổi `>` thành `>=` không làm test nào
    // đỏ nếu chỉ có một ca ở xa ngưỡng.
    const atCap = await loadAuthConfig(makeEnv({ AUTH_INTERNAL_SKEW_SECONDS: '3600' }));
    expect(atCap.internalAuthSkewSeconds).toBe(3600);
    await expect(loadAuthConfig(makeEnv({ AUTH_INTERNAL_SKEW_SECONDS: '3601' }))).rejects.toThrow(
      /AUTH_INTERNAL_SKEW_SECONDS/u,
    );
  });

  it('NEVER names the value in the error message: it would reach the error log (F-07)', async () => {
    // ⚠️ Bất biến này chỉ có một đường kiểm được: bắt **chính** message và tìm giá trị
    // trong đó. Assert `toThrow(/AUTH_INTERNAL_SKEW_SECONDS/u)` ở các test trên không
    // nói gì về việc message có kèm giá trị hay không, nên một bản cài đặt
    // `` `... khong hop le: ${value}` `` vẫn làm toàn bộ suite xanh.
    //
    // Vì sao đây là chuyện bảo mật chứ không phải văn phong: một operator có thể dán
    // nhầm `AUTH_INTERNAL_SECRET` (một chuỗi base64 dài) vào `AUTH_INTERNAL_SKEW_SECONDS`.
    // Message lỗi là thứ đi thẳng vào `console.error`/log thu thập của Worker, và ở đó
    // secret sẽ nằm lại lâu hơn nhiều so với một request. Đây đúng là F-07.
    // Cố ý KHÔNG dùng một chuỗi mang hình dạng credential của provider nào (`sk_live_…`,
    // `ghp_…`): quét secret của repo sẽ chặn push vì nó, và khi đó người sửa phải đi xin
    // allowlist cho một giá trị chưa bao giờ là secret thật. Thứ test này cần chỉ là một
    // giá trị (a) không phải chuỗi chữ số để lọt vào nhánh định dạng, và (b) to như một
    // secret thật để ca "lọt vào message" là ca đáng sợ. Base64 43 ký tự đúng hình dạng
    // `AUTH_INTERNAL_SECRET` mà không khớp pattern của provider nào.
    //
    // ⚠️ **Tên biến không được chứa từ khoá `secret`.** `generic-api-key` của gitleaks
    // khớp theo *từ khoá cạnh giá trị*, không theo giá trị: đo bằng binary 8.30.1 đúng
    // như CI chạy, `const secretLookingValue = '<base64 55 ký tự>'` bị báo (entropy 4.63)
    // còn **cùng giá trị đó** dưới tên `pastedSkewValue` thì sạch. Đây là fixture, không
    // phải secret, nhưng một tên biến mang từ khoá làm required check `Gitleaks` đỏ — và
    // cách chữa đúng là đổi tên, không phải thêm allowlist vào `.gitleaks.toml` (allowlist
    // cho một giá trị chưa bao giờ là secret là cách dạy cho gate biết im lặng).
    const pastedSkewValue = 'Zm9vYmFyYmF6cXV1eGNvcmdlZ3JhdWx0Z2FycGx5c3R1ZmYxMjM0NTY';
    const cases = [
      // Nhánh "không phải chuỗi chữ số".
      pastedSkewValue,
      // Nhánh dưới biên (`0` sao cho nó lọt regex nhưng < 1 là không thể với `\d+`;
      // dùng `00` để vẫn là chuỗi chữ số mà giá trị là 0).
      '00',
      // Nhánh trên trần.
      '99999999',
    ];

    for (const value of cases) {
      let message = '';
      try {
        await loadAuthConfig(makeEnv({ AUTH_INTERNAL_SKEW_SECONDS: value }));
      } catch (error: unknown) {
        message = (error as Error).message;
      }
      expect(message).toContain('AUTH_INTERNAL_SKEW_SECONDS');
      // Không giá trị nào lọt vào message, kể cả nhánh trên trần (nhánh đó nhắc
      // **trần**, tức hằng của chính file này, không phải đầu vào của operator).
      expect(message).not.toContain(value);
      expect(message).not.toContain('sk_live');
    }
  });
});

describe('JWKS — chi cong bo khoa cong khai', () => {
  it('public JWK khong co truong rieng tu', async () => {
    const config = await loadAuthConfig(makeEnv());
    const jwk = await config.signingKeyProvider.publicJwk();

    // ⚠️ Một trường `d` trong JWKS là một lần rò private key ra internet.
    expect(jwk).not.toHaveProperty('d');
    expect(Object.keys(jwk).toSorted()).toEqual(['alg', 'crv', 'kid', 'kty', 'use', 'x', 'y']);
  });

  it('PEM khong xuat hien trong JWKS', async () => {
    const config = await loadAuthConfig(makeEnv());
    const serialized = JSON.stringify(await config.signingKeyProvider.publicJwk());

    expect(serialized).not.toContain(pem);
    expect(serialized).not.toContain('PRIVATE KEY');
    // Đoạn base64 đặc trưng của PEM cũng không được xuất hiện.
    const body = pem.split('\n').filter((line) => line.length > 10)[1] ?? '';
    expect(body.length).toBeGreaterThan(10);
    expect(serialized).not.toContain(body);
  });

  it('provider dung chung JWKS ma SigningKeyProvider sinh ra', async () => {
    // Hai chỗ dựng JWKS khác nhau là hai bề mặt công khai có thể lệch.
    const config = await loadAuthConfig(makeEnv());
    const direct = await SigningKeyProvider.fromPem({ pem, kid: 'kid-2026-01' });
    expect(await config.signingKeyProvider.publicJwk()).toEqual(await direct.publicJwk());
  });
});
