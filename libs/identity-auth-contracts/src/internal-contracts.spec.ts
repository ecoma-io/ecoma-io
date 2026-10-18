import { describe, expect, it } from 'vitest';

import * as canonical from '@ecoma-io/identity-contracts';

import * as shim from './internal-contracts';

/**
 * Spec của **bề mặt DTO** mà `@ecoma-io/identity-auth-contracts` ship.
 *
 * Vì sao cần một file riêng thay vì thêm vào `internal-hmac.spec.ts`: hai file soi hai
 * module khác nhau (`./internal-auth` cho protocol, `./internal-contracts` cho DTO), và
 * lỗi đã thực sự xảy ra nằm ở module thứ hai — nên nếu không có guard ở đây thì việc sửa
 * nó không có gì chặn tái diễn.
 *
 * ## Lỗi đã xảy ra, để không sửa nhầm chỗ
 *
 * `./internal-contracts` từng **khai lại bằng tay** `SessionVerifiedRequest`,
 * `AccountStatusResponse` thay vì re-export. Ba bản đó trôi khỏi bản
 * canonical:
 *
 *  - `authn_at` khai là `string`, canonical là epoch ms `number`;
 *  - `acr` nhận giá trị ngoài tập ACR URN canonical,
 *    `'anonymous' | 'password' | 'totp' | 'passkey'` — `'mfa'` là giá trị **không tồn tại**
 *    ở canonical, còn `'anonymous'` thì không gửi được;
 *  - `SessionVerifiedOutcome` có thêm `'invalid_request'` mà canonical không có.
 *
 * Hậu quả không nằm ở compile: `apps/auth` dùng đúng type của shim để dựng payload gửi
 * sang `account`, còn `account` validate bằng validator canonical — nên một caller viết
 * code **đúng theo type** vẫn bị `400`. TypeScript không bắt được vì cả hai phía đều
 * "đúng type của mình". Đó là lý do guard dưới đây không chỉ so hành vi.
 */

/**
 * Các khai báo **được phép** sống cục bộ trong `./internal-contracts`.
 *
 * Chỉ năm type `Consent*` và `allowsIssuance` — `identity-contracts` chưa có bản canonical
 * cho nhóm này. `/internal/consent/*` là contract `account → auth` (provider `auth`).
 * Mọi thứ khác phải là re-export. Danh sách này cố ý là **allowlist**: thêm một khai báo
 * cục bộ mới sẽ làm test đỏ cho tới khi người thêm quyết định một cách có ý thức rằng nó
 * thuộc về đây chứ không thuộc về bản canonical.
 */
const LOCAL_DECLARATIONS_ALLOWED = [
  'ConsentContextRequest',
  'ConsentContextResponse',
  'ConsentDecideRequest',
  'ConsentDecideResponse',
  'ConsentDecision',
  'allowsIssuance',
].toSorted();

/** Symbol **giá trị** mà shim phải trỏ vào đúng object của bản canonical. */
const RE_EXPORTED_DTO_VALUES = ['FORBIDDEN_SESSION_VERIFIED_FIELDS'] as const;

/**
 * Đọc nguồn của module DTO.
 *
 * ⚠️ Đường dẫn neo theo **gốc workspace**, không theo cwd: `nx test` đặt cwd ở
 * `libs/identity-auth-contracts` còn chạy tay từ gốc repo lại ở gốc — đúng kiểu lỗi chỉ
 * đỏ trên CI. `import.meta.dirname` không dùng được vì `package.json` của project không
 * khai `"type": "module"`.
 */
async function readShimSource(): Promise<string> {
  const { existsSync, readFileSync } = await import('node:fs');
  const { dirname, join, resolve } = await import('node:path');

  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return readFileSync(
        join(dir, 'libs/identity-auth-contracts/src/internal-contracts.ts'),
        'utf8',
      );
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('khong tim thay goc workspace (pnpm-workspace.yaml)');
    }
    dir = parent;
  }
}

describe('shim @ecoma-io/identity-auth-contracts — DTOs, not redeclarations', () => {
  it('binds every re-exported DTO value to the IDENTICAL object of the canonical module', () => {
    // So danh tính object chứ không so nội dung: một mảng khai lại với đúng bảy phần tử
    // hôm nay vẫn là bản thứ hai, và sẽ lệch vào ngày ai đó thêm phần tử thứ tám ở một
    // phía. `toEqual` sẽ xanh trong trường hợp đó — `toBe` thì không.
    for (const name of RE_EXPORTED_DTO_VALUES) {
      const shimValue = (shim as Record<string, unknown>)[name];
      const canonicalValue = (canonical as Record<string, unknown>)[name];
      expect(canonicalValue).toBeDefined();
      expect(shimValue).toBe(canonicalValue);
    }
  });

  it('declares no local DTO beyond the Consent allowlist', async () => {
    // Type bị xoá lúc runtime, nên `authn_at: string` không thể hiện ra ở bất kỳ assert
    // giá trị nào — chỉ đọc nguồn mới thấy. Đây là guard duy nhất bắt được đúng lỗi đã
    // xảy ra, nên nó phải đọc file thật thay vì tin vào một danh sách chép tay.
    const src = await readShimSource();

    const declaration =
      /^export\s+(?:interface|type|const|let|var|function|class|enum)\s+([A-Za-z0-9_$]+)/gmu;
    const declared = [...src.matchAll(declaration)].map((match) => match[1]).toSorted();

    expect(declared).toEqual(LOCAL_DECLARATIONS_ALLOWED);
  });

  it('re-exports only from the canonical module', async () => {
    // Chặn đường vòng: một `export ... from './mot-module-cuc-bo'` vẫn là nguồn thứ hai,
    // kể cả khi tên symbol trùng bản canonical. Chỉ `@ecoma-io/identity-contracts` được
    // phép là nguồn của re-export trong file này.
    const src = await readShimSource();

    const specifiers = [...src.matchAll(/from\s+'([^']+)'/gu)].map((match) => match[1]);

    expect(specifiers.length).toBeGreaterThan(0);
    expect([...new Set(specifiers)]).toEqual(['@ecoma-io/identity-contracts']);
  });
});
