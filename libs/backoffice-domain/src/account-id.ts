/**
 * Value object `BackofficeAccountId` — Account ID (`sub`) của một staff member,
 * tức **reference** xuyên service mà `backoffice` giữ để nối staff entry sang
 * hồ sơ danh tính của `account`.
 *
 * Source of truth:
 * - `docs/services/backoffice/01-architecture.md` §3, §4.1: một staff member
 *   gắn đúng một Account ID; Account ID là **reference**, không FK xuyên
 *   database; **email KHÔNG phải primary identity key**.
 * - `docs/overview/01-architecture.md` §4 và invariant 7: danh tính xuyên
 *   service là `sub`, không tái sử dụng, không tái phát hành.
 *
 * ⚠️ **Tự viết, không import `@ecoma-io/identity-domain`.** Hình thức giống
 * `Subject` của identity-domain (prefix + base32 + entropy) nhưng đó là trùng
 * hợp hình thức, không phải phụ thuộc: ranh giới phụ thuộc là quy tắc
 * module-boundary (một BC không import implementation của BC khác —
 * `docs/overview/05-code-architecture.md` §3), nên lib này khai báo riêng
 * định danh mà nó sở hữu. Lợi ích thứ
 * hai của việc viết riêng: thay đổi thuật toán entropy của `backoffice` không
 * cần đụng lib identity.
 *
 * Mức entropy yêu cầu: ≥ 256 bit. Subject của identity-domain dùng 32 ký tự
 * (160 bit); đây là định danh của một BC khác nên không ghim chung một con số —
 * constraint của lib này (52 ký tự) là 260 bit, bảo đảm "đoán sub không thực tế"
 * ở cùng mức như identity-domain, không nhỏ hơn.
 */

/** Prefix bắt buộc, giúp phân biệt `sub` với các định danh khác trong log. */
const ACCOUNT_ID_PREFIX = 'sub_';

/**
 * Số ký tự base32 của phần entropy — đủ cho ≥ 256 bit.
 *
 * 52 ký tự × 5 bit = 260 bit ≥ 256. Hằng này được test ghim — thay đổi độ dài
 * mà phá vỡ ngưỡng 256 bit phải được test đỏ trước khi merge.
 */
export const BACKOFFICE_ACCOUNT_ID_ENTROPY_CHARS = 52;

/**
 * Ngưỡng entropy tối thiểu theo bit (§4.1). Hằng độc lập để test so khớp hai
 * bên riêng — đừng suy "ENTROPY_CHARS × 5 ≥ MIN_BITS" trong code thư viện gọi.
 */
export const BACKOFFICE_ACCOUNT_ID_MIN_ENTROPY_BITS = 256;

/**
 * Alphabet base32 chuẩn RFC 4648, viết thường, không padding. Chữ thường bắt
 * buộc để `sub` không phụ thuộc case-folding khi đi qua header, log hay storage.
 */
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** Brand ở mức type: hai `BackofficeAccountId` chỉ tương đương khi cùng chuỗi. */
declare const accountIdBrand: unique symbol;

/** Opaque value object — không có constructor public, chỉ qua `createBackofficeAccountId`. */
export type BackofficeAccountId = string & { readonly [accountIdBrand]?: true };

/** Prefix của `BackofficeAccountId` — phơi ra để consumer dùng trong log/audit. */
export const BACKOFFICE_ACCOUNT_ID_PREFIX = ACCOUNT_ID_PREFIX;

/** Regex đầy đủ cho một `BackofficeAccountId` hợp lệ. */
const ACCOUNT_ID_PATTERN = new RegExp(
  `^${ACCOUNT_ID_PREFIX}[${BASE32_ALPHABET}]{${BACKOFFICE_ACCOUNT_ID_ENTROPY_CHARS}}$`,
  'u',
);

/**
 * Entropy mà {@link BACKOFFICE_ACCOUNT_ID_ENTROPY_CHARS} đạt theo bit — depicting
 * cho log chẩn đoán và để test ghim ngưỡng trực tiếp.
 */
export const BACKOFFICE_ACCOUNT_ID_ENTROPY_BITS = BACKOFFICE_ACCOUNT_ID_ENTROPY_CHARS * 5;

/**
 * Kiểm tra một chuỗi bất kỳ có phải `BackofficeAccountId` hợp lệ không.
 *
 * Dùng khi đọc `sub` từ nguồn bên ngoài (token claim, DB, contract) — nơi giá
 * trị đã đi qua serialization nên không còn giữ brand.
 */
export function isBackofficeAccountId(value: unknown): value is BackofficeAccountId {
  return typeof value === 'string' && ACCOUNT_ID_PATTERN.test(value);
}

/**
 * Tạo `BackofficeAccountId` mới từ entropy do caller sinh.
 *
 * @param entropy Chuỗi base32 viết thường, đúng
 *   {@link BACKOFFICE_ACCOUNT_ID_ENTROPY_CHARS} ký tự. Caller lấy từ CSPRNG
 *   (`crypto.getRandomValues`) rồi encode base32 — thư viện này không tự sinh
 *   entropy để giữ ranh giới "không I/O" của tầng domain.
 *
 * @throws TypeError nếu entropy sai kiểu hoặc sai định dạng.
 *
 * ⚠️ Không có đường nào trong API này nhận lại một `sub` cũ để tái phát hành:
 * caller muốn sinh ID mới thì gọi hàm này, còn tái sử dụng `sub` cũ cho staff
 * khác là vi phạm §4.1 (mapping 1:1, không tái phát hành) và không có API nào
 * cho phép.
 */
export function createBackofficeAccountId(entropy: string): BackofficeAccountId {
  if (typeof entropy !== 'string') {
    throw new TypeError('BackofficeAccountId entropy phải là chuỗi');
  }
  const full = `${ACCOUNT_ID_PREFIX}${entropy}`;
  if (!ACCOUNT_ID_PATTERN.test(full)) {
    throw new TypeError(
      `BackofficeAccountId entropy phải là ${BACKOFFICE_ACCOUNT_ID_ENTROPY_CHARS} ký tự base32 viết thường (${BASE32_ALPHABET})`,
    );
  }
  return full as BackofficeAccountId;
}

/**
 * Lấy phần entropy của `BackofficeAccountId` (bỏ prefix).
 *
 * Chỉ phục vụ chẩn đoán — entropy tự nó KHÔNG phải bí mật; `sub` ở đây là
 * reference của account do `account` cấp, không phải credential.
 */
export function backofficeAccountIdEntropy(accountId: BackofficeAccountId): string {
  return accountId.slice(ACCOUNT_ID_PREFIX.length);
}
