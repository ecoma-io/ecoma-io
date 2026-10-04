import { describe, expect, it } from 'vitest';

import * as canonical from '@ecoma-io/identity-contracts';

// ⚠️ **Self-reference qua tên gói, không qua đường dẫn tương đối.** Đây là điểm mấu chốt của
// cả file: `'./index'` vẫn là một đường dẫn nội bộ, còn `'@ecoma-io/identity-auth-contracts'`
// đi qua `exports["."]` của `package.json` — đúng đường mà `apps/auth` đi. Nếu `exports` trỏ
// sai file thì test này đỏ, còn import tương đối thì không.
// Import theo TÊN GÓI là chính nội dung của test này: `exports["."]` của `package.json`
// trỏ vào `./src/index.ts`, và `apps/auth` cũng import đúng tên gói đó. Một import tương
// đối `'./index'` sẽ không phát hiện được cảnh `exports` bị đổi sang file khác — tức guard
// mất đúng phần nó tồn tại để giữ.
// oxlint-disable-next-line @nx/enforce-module-boundaries
import {
  DEFAULT_SKEW_SECONDS,
  FORBIDDEN_SESSION_VERIFIED_FIELDS,
  INTERNAL_BODY_LIMIT_BYTES,
  INTERNAL_NONCE_HEADER,
  INTERNAL_SIGNATURE_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  MAX_NONCE_EXPIRY_EPOCH_SECONDS,
  NONCE_TTL_BUFFER_SECONDS,
  PROTOCOL_ID,
  assertNonceExpirySeconds,
  isAccountStatusResponseValue,
  createNonce,
  isValidNonceExpirySeconds,
  signRequest,
  verifyRequest,
} from '@ecoma-io/identity-auth-contracts';
import * as rootSurface from '@ecoma-io/identity-auth-contracts'; // oxlint-disable-line @nx/enforce-module-boundaries

/**
 * Spec của **góc entry thật** mà `@ecoma-io/identity-auth-contracts` publish.
 *
 * ## Vì sao cần file này, khi đã có `internal-hmac.spec.ts` và `internal-contracts.spec.ts`
 *
 * Hai file kia import `./internal-auth` và `./internal-contracts` — hai module **nội bộ**.
 * `package.json` của gói không trỏ vào chúng: `exports["."]` trỏ vào `./src/index.ts`. Nghĩa
 * là cả hai suite đó có thể xanh trong khi `index.ts` **không re-export** một symbol mà
 * consumer thật cần — và không có gì đỏ. Đó không phải giả thuyết: bản `index.ts` trước PR
 * này khai lại `SessionVerifiedRequest` bằng tay, và cả hai suite cũ vẫn xanh vì mỗi suite
 * tự đối chiếu với module nội bộ của chính nó.
 *
 * Ở đây import đúng cái tên mà `apps/auth` gõ: `@ecoma-io/identity-auth-contracts`
 * (self-reference qua `exports` của chính gói), rồi assert trên **bề mặt runtime**.
 *
 * ## Ranh giới của khẳng định: bề mặt là tập con **có chủ ý**
 *
 * Shim này **cố ý** hẹp hơn bản canonical — nó không phải một bản sao của
 * `@ecoma-io/identity-contracts`. Đo được: canonical phơi ra 7 giá trị runtime
 * (`ACCOUNT_STATUS_RESPONSE_VALUES`, `AUTHN_LEVEL_VALUES`, `FORBIDDEN_ACCOUNT_STATUS_FIELDS`,
 * `REQUIRED_SESSION_VERIFIED_FIELDS`, `accountStatusResponse`, `validateAccountStatusResponse`,
 * `validateSessionVerifiedRequest`) mà shim không re-export, và `apps/auth` không dùng cái
 * nào trong số đó. Vì vậy "thiếu so với canonical" ở đây là **hợp lệ** và test không được
 * khẳng định ngược lại. Cái test khẳng định là hai chiều còn lại, đúng hai chiều sinh ra lỗi
 * thật: mọi thứ shim **có** phải là **cùng object** của canonical (không chép tay), và mọi
 * thứ shim có mà canonical **không** có phải nằm đúng trong allowlist khai báo cục bộ.
 */

/** Encode chuỗi → byte UTF-8; xem `internal-hmac.spec.ts` cho lý do bắt buộc. */
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

/**
 * Khai báo **được phép** sống cục bộ ở góc entry này.
 *
 * ⚠️ Đồng bộ với `LOCAL_DECLARATIONS_ALLOWED` trong `internal-contracts.spec.ts`; nếu hai
 * danh sách lệch nhau thì guard này nói dối. `allowsIssuance` là hàm của shim (nhóm
 * `Consent*` chưa có bản canonical) — đó là lý do duy nhất một tên được phép khác canonical.
 */
const LOCAL_DECLARATIONS_ALLOWED = ['allowsIssuance'] as const;

describe('entry thật `@ecoma-io/identity-auth-contracts` — bề mặt runtime', () => {
  it('exposes the account-status allowlist as a runtime value, not only as a type', () => {
    // ⚠️ Đây là hàm mà `AccountClient` của `apps/auth` dùng để kiểm response. Nó là
    // validator **runtime**, nên `import type` sẽ biên dịch rồi nổ ở runtime; và một bản
    // chép allowlist `['active','suspended','deleted','not_found']` tại chỗ gọi là đúng
    // thứ F-08 cấm. Assert cả hai vế: có mặt, và là **cùng** hàm của bản canonical.
    expect(isAccountStatusResponseValue).toBe(canonical.isAccountStatusResponseValue);
    expect(typeof isAccountStatusResponseValue).toBe('function');
    expect(isAccountStatusResponseValue('active')).toBe(true);
    expect(isAccountStatusResponseValue('not_found')).toBe(true);
    // Giá trị ngoài allowlist phải là `false`, không phải `undefined` — nếu không thì
    // `if (!validator(x))` vẫn chạy nhưng `if (validator(x) === false)` thì không.
    expect(isAccountStatusResponseValue('mfa')).toBe(false);
    expect(isAccountStatusResponseValue('')).toBe(false);
    expect(isAccountStatusResponseValue(undefined)).toBe(false);
  });

  it('exposes the protocol constants the middleware and client read at runtime', () => {
    // Đây là các hằng mà `apps/auth/src/main.ts`, `config.ts` và middleware của `account`
    // **đọc** (không phải chỉ type): thiếu re-export thì lỗi biên dịch, nhưng sai **giá trị**
    // thì không — và hai Worker cầm hai giá trị khác nhau là một envelope không bao giờ
    // verify được, mà cả hai suite vẫn xanh.
    expect(INTERNAL_BODY_LIMIT_BYTES).toBe(canonical.INTERNAL_BODY_LIMIT_BYTES);
    expect(MAX_NONCE_EXPIRY_EPOCH_SECONDS).toBe(canonical.MAX_NONCE_EXPIRY_EPOCH_SECONDS);
    expect(NONCE_TTL_BUFFER_SECONDS).toBe(canonical.NONCE_TTL_BUFFER_SECONDS);
    expect(DEFAULT_SKEW_SECONDS).toBe(canonical.DEFAULT_SKEW_SECONDS);
    expect(PROTOCOL_ID).toBe(canonical.PROTOCOL_ID);
    expect(INTERNAL_SIGNATURE_HEADER).toBe(canonical.INTERNAL_SIGNATURE_HEADER);
    expect(INTERNAL_NONCE_HEADER).toBe(canonical.INTERNAL_NONCE_HEADER);
    expect(INTERNAL_TIMESTAMP_HEADER).toBe(canonical.INTERNAL_TIMESTAMP_HEADER);
    expect(FORBIDDEN_SESSION_VERIFIED_FIELDS).toBe(canonical.FORBIDDEN_SESSION_VERIFIED_FIELDS);
  });

  it('exposes the expiry validator used by the account persistence layer', () => {
    // `apps/account/server/utils/db.ts` gọi `assertNonceExpirySeconds` ở đúng tầng ghi, và
    // đó là F-04(B). Nếu entry thật không re-export nó, đường duy nhất còn lại là chép luật
    // — chính điều finding cấm. Assert hành vi: hàm này phải thật sự ném.
    expect(assertNonceExpirySeconds).toBe(canonical.assertNonceExpirySeconds);
    expect(isValidNonceExpirySeconds).toBe(canonical.isValidNonceExpirySeconds);
    expect(() => assertNonceExpirySeconds(Number.NaN)).toThrow(RangeError);
    // ⚠️ `1_700_000_000_000` là epoch **mili giây** — lỗi đơn vị mà F-04(B) tồn tại để chặn.
    // Nếu validator nhận nó, `to_timestamp` tạo một nonce sống tới năm 57000: một hàng không
    // bao giờ được prune, tức replay guard hỏng theo nghĩa "bền vĩnh viễn".
    expect(() => assertNonceExpirySeconds(1_700_000_000_000)).toThrow(RangeError);
    expect(isValidNonceExpirySeconds(1_700_000_000_000)).toBe(false);
    expect(isValidNonceExpirySeconds(1_700_000_000)).toBe(true);
  });

  it('exposes signRequest/verifyRequest and they interoperate through this entry alone', async () => {
    // Bất biến cuối cùng: một consumer chỉ biết entry này phải ký được và verify được, trên
    // **byte** thân request. Trước F-01 cả hai bên ký chuỗi đã decode, nên một cặp
    // encode/decode không đối xứng vẫn qua được; giờ chữ ký phải gắn với byte.
    //
    // ⚠️ `claimNonce` trả `true` nghĩa là **nonce đã bị chiếm trước đó** (tức replay), không
    // phải "chiếm thành công". Trả `true` ở đây biến ca hợp lệ thành `replayed_nonce` — và
    // đúng như vậy trong lần chạy đầu. Chiều của giá trị là một bẫy thật của API, nên ghim nó
    // bằng cả hai ca: `false` cho lần chiếm đầu, và một ca riêng khẳng định `true` ⇒
    // `replayed_nonce`.
    const body = bytes('{"handle":"Y"}');
    // ⚠️ `now` phải nằm trong cửa sổ skew của `timestamp`, nếu không `verifyRequest` trả
    // `bad_timestamp` **trước khi** chạm tới chữ ký (thứ tự đó là chủ ý — xem JSDoc của
    // `verifyRequest`) và ca này sẽ đỏ vì lý do sai. Neo hai giá trị vào cùng một mốc để
    // khẳng định đang thật sự nói về chữ ký. `now` là **chuỗi epoch giây**, không phải ms.
    const nowSeconds = '1700000000';
    // ⚠️ Nonce phải qua `isStrongNonce`, thứ chạy **trước** bước kiểm chữ ký. Một chuỗi tự
    // chế như `'root-surface-nonce-000000000000'` trượt ở đó và ca này trả `weak_nonce` —
    // đỏ vì lý do sai. Dùng chính `createNonce()` của bề mặt để chắc chắn hợp lệ.
    const rootNonce = createNonce();
    const headers = await signRequest({
      method: 'POST',
      path: '/internal/session/verified',
      body,
      secret: 'root-surface-secret',
      timestamp: nowSeconds,
      nonce: rootNonce,
    });

    await expect(
      verifyRequest({
        method: 'POST',
        path: '/internal/session/verified',
        body,
        secret: 'root-surface-secret',
        headers,
        now: nowSeconds,
        claimNonce: () => Promise.resolve(false),
      }),
    ).resolves.toEqual({
      ok: true,
      nonce: rootNonce,
      timestamp: '1700000000',
    });

    // Cùng envelope nhưng **khác byte** thân: phải là `bad_signature`. Đây là khẳng định
    // phân biệt được F-01 với bản cũ; nếu ai đó đưa lại đường ký-theo-chuỗi, ca này vàng.
    await expect(
      verifyRequest({
        method: 'POST',
        path: '/internal/session/verified',
        body: bytes('{"handle":"Z"}'),
        secret: 'root-surface-secret',
        headers,
        now: nowSeconds,
        claimNonce: () => Promise.resolve(true),
      }),
    ).resolves.toEqual({ ok: false, reason: 'bad_signature' });

    // Và chiều còn lại của hợp đồng `claimNonce`: `true` = nonce đã có trong kho ⇒ replay.
    await expect(
      verifyRequest({
        method: 'POST',
        path: '/internal/session/verified',
        body,
        secret: 'root-surface-secret',
        headers,
        now: nowSeconds,
        claimNonce: () => Promise.resolve(true),
      }),
    ).resolves.toEqual({ ok: false, reason: 'replayed_nonce' });
  });

  it('binds every published runtime value to the canonical object', () => {
    // ⚠️ So **danh tính object**, không so hành vi. Hai hàm cùng hành vi nhưng khác thân hàm
    // vẫn là hai bản cài đặt — đúng thứ đã trôi lệch trước PR này. Một mảng allowlist chép
    // tay cùng nội dung cũng vậy, và nó trôi khỏi bản canonical đúng vào lúc ai đó thêm giá
    // trị thứ năm ở một phía.
    for (const name of Object.keys(rootSurface)) {
      if (name === 'default') {
        continue;
      }
      const published = (rootSurface as Record<string, unknown>)[name];
      const canonicalValue = (canonical as Record<string, unknown>)[name];
      if (canonicalValue === undefined) {
        continue; // khai báo cục bộ — kiểm riêng ở ca dưới
      }
      expect(published).toBe(canonicalValue);
    }
  });

  it('does not declare anything locally beyond the published allowlist', () => {
    // Chiều còn lại, và là chiều sinh ra lỗi thật: một tên **chỉ** có ở đây là một mảnh giao
    // thức chỉ sống ở phía `auth` — envelope thứ hai đang mọc lại, kể cả khi chưa ai gọi.
    // Chỉ `allowsIssuance` được phép (nhóm `Consent*` chưa có bản canonical).
    const canonicalNames = new Set(Object.keys(canonical));
    const localDeclarations = Object.keys(rootSurface)
      .filter((name) => name !== 'default')
      .filter((name) => !canonicalNames.has(name));
    expect(localDeclarations).toHaveLength(LOCAL_DECLARATIONS_ALLOWED.length);
    for (const name of LOCAL_DECLARATIONS_ALLOWED) {
      expect(localDeclarations).toContain(name);
    }
  });
});
