import { describe, expect, it } from 'vitest';

import * as canonical from '@ecoma-io/identity-contracts';

// ⚠️ Import `./internal-auth` — module mà `index.ts` (entry thật, `exports["."]`) re-export
// các symbol giao thức từ đó — chứ **không** phải một barrel phụ chỉ có spec này import.
// Đối tượng của assert object-identity phải là đúng file mà một bản cài đặt thứ hai sẽ
// được đặt vào: trước đây spec import `./internal-hmac`, nên ai đó thêm implementation
// vào `./internal-auth` vẫn để suite xanh.
import * as shim from './internal-auth';

/**
 * Encode chuỗi → byte UTF-8.
 *
 * ⚠️ **Bắt buộc**: `signRequest`/`verifyRequest` ký trên `Uint8Array`, không phải chuỗi.
 * Truyền thẳng chuỗi vào (điều mà spec này từng làm) không phải lỗi biên dịch ở đây vì
 * spec không nằm trong `tsconfig` nào của package — và lúc chạy, `new Uint8Array('<chuỗi>')`
 * cho ra mảng **rỗng**, nên hai phía cùng băm thân rỗng và ca interop biến thành "đúng mà
 * không kiểm gì cả". Encode tường minh là cách duy nhất khiến test nói về byte thật.
 */
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

/**
 * Spec của **bề mặt internal-HMAC** mà `@ecoma-io/identity-auth-contracts` ship.
 *
 * Đối tượng được soi là `./internal-auth` — module `index.ts` (entry thật, `exports["."]`)
 * re-export các symbol giao thức từ đó — chứ không phải một barrel phụ chỉ có spec này
 * import. Trước đây spec import `./internal-hmac`, tức một đường không consumer nào đi:
 * ai đó đặt một bản cài đặt thứ hai vào `./internal-auth` vẫn để suite xanh. Barrel phụ
 * đó đã bị xoá cùng lúc — một barrel không ai import chỉ là chỗ thứ hai để danh sách
 * symbol trôi lệch.
 *
 * ## Vì sao file này từng test một envelope khác, và vì sao nó đổi
 *
 * Trước PR hợp nhất, file này dài ~428 dòng và test **bản cài đặt envelope thứ hai**
 * của `auth`: `verifyEnvelope`, `verifyEnvelopeFromHeaders`, `signCanonicalString`,
 * `canonicalString` dạng object, `HEADER_*` / `EXTERNAL_HEADER_*`, nonce base64url,
 * timestamp mili giây, và length prefix theo UTF-16. Bản đó **không tương thích** với
 * envelope của `account`, và nó bị xoá trong PR này — nên spec cũ test những symbol
 * không còn tồn tại.
 *
 * ⚠️ **Xoá spec cũ không phải là nới lỏng test bảo mật**: các thuộc tính nó phủ
 * (chống dịch chuyển trường nhờ length prefix, độ dài theo byte chứ không theo ký tự,
 * method không phân biệt hoa/thường, body rỗng vẫn có hash, từ chối nonce yếu, từ chối
 * sai secret / body / path / method, cửa sổ skew và biên của nó, chữ ký thiếu version,
 * query string nằm trong chuỗi ký, đọc header không phân biệt hoa/thường) đều được phủ
 * ở **bản canonical** — `libs/internal-auth-contracts/src/internal-auth.spec.ts`, gồm cả
 * golden vector tính bằng một cài đặt độc lập. File này giữ lại đúng phần mà bản
 * canonical **không** phủ được: chứng minh gói này **không** sinh ra envelope thứ hai.
 *
 * Đó là rủi ro thật của một package mang tên "contracts của auth": nếu một ngày ai đó
 * thêm một hàm vào đây thay vì re-export, hai bên lại lệch nhau y như trước, và cả hai
 * suite vẫn xanh vì mỗi bên tự đối chiếu với chính mình.
 */

/** Tên symbol mà shim phải re-export — danh sách này là hợp đồng của chính file test. */
const RE_EXPORTED_VALUES = [
  'DEFAULT_SKEW_SECONDS',
  'INTERNAL_NONCE_HEADER',
  'INTERNAL_SIGNATURE_HEADER',
  'INTERNAL_TIMESTAMP_HEADER',
  'MAX_SKEW_SECONDS',
  'MIN_SKEW_SECONDS',
  'NONCE_TTL_BUFFER_SECONDS',
  'canonicalString',
  'createNonce',
  'hashBody',
  'isStrongNonce',
  'resolveSkewSeconds',
  'signRequest',
  'timingSafeEqualHex',
  'verifyRequest',
] as const;

/**
 * Tên symbol của bản envelope **cũ** phải vắng mặt.
 *
 * ⚠️ Danh sách này cố ý liệt kê đúng những cái tên đã bị bỏ. Một shim lỡ tay khôi phục
 * chúng — dù chỉ để "tương thích ngược" — là đang dựng lại bản cài đặt thứ hai, tức là
 * đúng lỗi mà PR này sửa. Test phải đỏ trong trường hợp đó.
 */
const REMOVED_NAMES = [
  'verifyEnvelope',
  'verifyEnvelopeFromHeaders',
  'signCanonicalString',
  'assertHeaderNamesMatchParameters',
  'HEADER_NONCE',
  'HEADER_SIGNATURE',
  'HEADER_TIMESTAMP',
  'EXTERNAL_HEADER_NONCE',
  'EXTERNAL_HEADER_SIGNATURE',
  'EXTERNAL_HEADER_TIMESTAMP',
] as const;

describe('shim @ecoma-io/identity-auth-contracts — a single installation, not two', () => {
  it('re-exports every protocol symbol of the canonical module', () => {
    for (const name of RE_EXPORTED_VALUES) {
      expect(name in shim).toBe(true);
      expect(name in canonical).toBe(true);
    }
  });

  it('binds each symbol to the IDENTICAL object of the canonical module', () => {
    // ⚠️ Đây là khẳng định trung tâm của cả file: so **danh tính object**, không so
    // hành vi. Hai hàm cùng hành vi nhưng khác thân hàm vẫn là hai bản cài đặt — đúng
    // thứ đã trôi lệch giữa `auth` và `account` trước PR này. Chỉ `===` mới phân biệt
    // được "một bản" với "hai bản tình cờ giống nhau hôm nay".
    for (const name of RE_EXPORTED_VALUES) {
      const shimValue = (shim as Record<string, unknown>)[name];
      const canonicalValue = (canonical as Record<string, unknown>)[name];
      expect(shimValue).toBe(canonicalValue);
    }
  });

  it('does not resurrect any symbol of the removed envelope', () => {
    for (const name of REMOVED_NAMES) {
      expect(name in shim).toBe(false);
    }
  });

  it('publishes no symbol the canonical module does not have', () => {
    // Bề mặt của shim phải là **tập con** của bản canonical. Một export chỉ có ở đây
    // là một mảnh giao thức chỉ tồn tại ở phía `auth` — tức là một envelope thứ hai
    // đang mọc lại, kể cả khi nó chưa được gọi ở đâu.
    const canonicalNames = new Set(Object.keys(canonical));
    const extras = Object.keys(shim).filter((name) => !canonicalNames.has(name));
    expect(extras).toEqual([]);
  });

  it('interoperates across entry points: sign via the shim, verify via the canonical module', async () => {
    const headers = await shim.signRequest({
      method: 'POST',
      path: '/internal/session/verified',
      body: bytes('{"handle":"Y","sub":"sub-1"}'),
      secret: 'shim-interop-secret',
      timestamp: '1700000000',
    });

    const result = await canonical.verifyRequest({
      method: 'POST',
      path: '/internal/session/verified',
      body: bytes('{"handle":"Y","sub":"sub-1"}'),
      headers,
      secret: 'shim-interop-secret',
      now: '1700000000',
      skewSeconds: canonical.DEFAULT_SKEW_SECONDS,
      claimNonce: () => false,
    });

    expect(result).toEqual({ ok: true, nonce: expect.any(String), timestamp: '1700000000' });
  });

  it('interoperates across entry points: sign via the canonical module, verify via the shim', async () => {
    // Chiều ngược lại không thừa: `account` dùng `@ecoma-io/identity-contracts`, còn
    // `auth` import qua shim. Một bất tương thích chỉ hiện ra khi hai chiều đều được đi.
    const headers = await canonical.signRequest({
      method: 'GET',
      path: '/internal/account/status?sub=sub_1',
      secret: 'shim-interop-secret',
      timestamp: '1700000000',
    });

    const result = await shim.verifyRequest({
      method: 'GET',
      path: '/internal/account/status?sub=sub_1',
      headers,
      secret: 'shim-interop-secret',
      now: '1700000000',
      skewSeconds: shim.DEFAULT_SKEW_SECONDS,
      claimNonce: () => false,
    });

    expect(result).toEqual({ ok: true, nonce: expect.any(String), timestamp: '1700000000' });
  });

  it('uses the same header names and signature format as the canonical wire protocol', async () => {
    const headers = await shim.signRequest({
      method: 'POST',
      path: '/internal/session/verified',
      body: bytes(''),
      secret: 'shim-interop-secret',
      timestamp: '1700000000',
    });

    // Tên header là một phần của wire protocol: đổi ở một phía là mọi request nội bộ
    // `missing_header`. Chốt cả tên lẫn cách viết chữ thường.
    expect(Object.keys(headers).toSorted()).toEqual([
      'x-ecoma-internal-nonce',
      'x-ecoma-internal-signature',
      'x-ecoma-internal-timestamp',
    ]);
    expect(headers['x-ecoma-internal-signature']).toMatch(/^v1=[0-9a-f]{64}$/u);
    expect(Number(headers['x-ecoma-internal-timestamp'])).toBe(1_700_000_000);
  });

  it('the package entry re-exports the guarded barrel surface, same objects', async () => {
    // ⚠️ Vì sao phải soi **entry** (`./index`, tức `exports["."]`) chứ không chỉ barrel:
    // mọi assert ở trên soi `./internal-auth`, nhưng consumer (`apps/auth`) import
    // `@ecoma-io/identity-auth-contracts` — đường đó đi qua `index.ts`, nơi danh sách
    // symbol được **liệt kê lại lần thứ hai**. Hai danh sách có thể lệch trong im lặng:
    // barrel thêm một symbol mà entry quên ⇒ consumer không thấy nó và suite vẫn xanh;
    // entry thêm một symbol lạ không có ở barrel ⇒ bề mặt thật rộng hơn bề mặt được canh.
    // Test này đóng cả hai chiều, và vẫn là object-identity chứ không phải so hành vi.
    const entry = (await import('./index')) as Record<string, unknown>;
    const barrelNames = new Set(Object.keys(shim));
    const dtoNames = new Set(Object.keys(await import('./internal-contracts')));

    for (const name of barrelNames) {
      expect(entry[name]).toBe((shim as Record<string, unknown>)[name]);
    }

    const entryOnly = Object.keys(entry).filter(
      (name) => !barrelNames.has(name) && !dtoNames.has(name),
    );
    expect(entryOnly).toEqual([]);
  });
});
