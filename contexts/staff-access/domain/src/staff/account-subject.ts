/**
 * Reference `AccountSubject` — định danh `sub` mà bounded context `account`
 * cấp, mà `staff-access` giữ trên staff entry để nối sang hồ sơ danh tính.
 *
 * ⚠️ **Tự viết, không import `@ecoma-io/account-domain`.** Hình thức giống
 * `Subject` (prefix `sub_` + base32 + entropy) và **cùng một con số entropy**
 * — đó là yêu cầu, không phải trùng hợp. Ranh giới phụ thuộc là quy tắc
 * module-boundary (một BC không import implementation của BC khác), nên lib
 * này khai báo riêng định danh mà nó tham chiếu; test ghim hai bên bằng cách
 * đọc file nguồn của producer, không bằng cạnh import.
 *
 * Mức entropy: đây **không phải** định danh do `staff-access` phát hành mà là
 * **reference** tới `sub` mà `account` cấp — nên ngưỡng của nó là ngưỡng của
 * producer thật, tức 32 ký tự / 160 bit của `Subject`
 * (`libs/account-domain/src/account/subject.ts`). Một định danh local tự khai
 * ngưỡng khác là bug: giá trị `sub` thật do `account` cấp sẽ không qua được
 * guard, tức resolve staff fail-closed vĩnh viễn khi token thật được wire.
 *
 * ⚠️ `staff-access` **không tự sinh** `sub` và không quản lý vòng đời Account
 * Subject — chỉ tham chiếu. Reference là 1:1 với staff entry, không tái sử
 * dụng, không tái phát hành (invariant của `account`).
 */

/** Prefix bắt buộc, giúp phân biệt `sub` với các định danh khác trong log. */
const SUB_PREFIX = 'sub_';

/**
 * Số ký tự base32 của phần entropy — ghim bằng producer thật của giá trị này
 * (`Subject` của `account`: 32 ký tự base32 = 160 bit). Consumer dùng con số
 * của producer, không tự khai số khác.
 */
export const ACCOUNT_SUBJECT_ENTROPY_CHARS = 32;

/** Ngưỡng entropy tối thiểu theo bit — theo producer của giá trị này. */
export const ACCOUNT_SUBJECT_MIN_ENTROPY_BITS = 160;

/** Alphabet base32 chuẩn RFC 4648, viết thường, không padding. */
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** Brand ở mức type: hai `AccountSubject` chỉ tương đương khi cùng chuỗi. */
declare const accountSubjectBrand: unique symbol;

/** Opaque value object — không có constructor public, chỉ qua factory/guard. */
export type AccountSubject = string & { readonly [accountSubjectBrand]?: true };

/** Prefix của `AccountSubject` — phơi ra để consumer dùng trong log/audit. */
export const ACCOUNT_SUBJECT_PREFIX = SUB_PREFIX;

/** Regex đầy đủ cho một `AccountSubject` hợp lệ. */
const ACCOUNT_SUBJECT_PATTERN = new RegExp(
  `^${SUB_PREFIX}[${BASE32_ALPHABET}]{${ACCOUNT_SUBJECT_ENTROPY_CHARS}}$`,
  'u',
);

/**
 * Kiểm tra một chuỗi bất kỳ có phải `AccountSubject` hợp lệ không — dùng khi
 * đọc `sub` từ nguồn bên ngoài (token claim, DB, contract).
 */
export function isAccountSubject(value: unknown): value is AccountSubject {
  return typeof value === 'string' && ACCOUNT_SUBJECT_PATTERN.test(value);
}

/**
 * Đóng gói một `sub` đã xác thực thành `AccountSubject` — KHÔNG phát hành mới.
 *
 * Chỉ dùng cho dữ liệu đã được verify server-side từ token/DB (ADR-0012):
 * client không được supply principal, nên factory này không nhận entropy để
 * sinh id — nó chỉ brand lại chuỗi đã qua kiểm tra hình thức.
 *
 * @throws TypeError nếu giá trị không đúng hình `sub` của producer.
 */
export function accountSubjectFrom(value: string): AccountSubject {
  if (!isAccountSubject(value)) {
    throw new TypeError(
      `AccountSubject phải là ${ACCOUNT_SUBJECT_PREFIX} + ${ACCOUNT_SUBJECT_ENTROPY_CHARS} ký tự base32 viết thường.`,
    );
  }
  return value;
}
