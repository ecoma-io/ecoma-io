/**
 * Thư viện OTP của luồng đăng nhập email — sinh mã, digest keyed-HMAC, so sánh
 * timing-safe, normalize địa chỉ và rate limit.
 *
 * ## Biên của module này
 *
 * Toàn bộ **policy** (window, số lần thử, TTL) là hằng số export để test khoá và
 * call site không tự ghép số. Toàn bộ **I/O** (PostgreSQL, đồng hồ, entropy mặc
 * định) do caller truyền vào: các hàm thuần nhận tham số, các hàm persistence nhận
 * `Pool`. Module không đọc env, không giữ state — cùng nguyên tắc với
 * `server/utils/db.ts` (runtime:edge cấm node-local state).
 *
 * ## Anti-enumeration là bất biến của tầng này
 *
 * Route `challenge` phải trả lời **giống nhau** cho địa chỉ tồn tại và địa chỉ
 * lạ: không câu chữ, không status code, không thời gian phản hồi phân biệt được
 * (trong giới hạn của một lần ghi DB — phần thời gian được xử lý ở route bằng
 * cách **vẫn ghi** challenge cho địa chỉ lạ, dùng chính rate-limit làm cơ chế
 * chống dò, xem `0006_otp_challenges.sql`). Hàm `resolveOtpTarget` ở đây trả một
 * discriminator để route biết phải gửi mail hay không — discriminator đó **không
 * bao giờ** đi vào response.
 *
 * ⚠️ Không import `node:*`: `.oxlintrc.json` cấm Node builtin trong `apps/**`
 * (`runtime:edge`). WebCrypto (`crypto.subtle`, `crypto.getRandomValues`) là
 * global có trên cả Workers lẫn Node ≥ 19 — cùng đường với
 * `libs/identity-contracts/src/internal-auth.ts`.
 */

/** Số chữ số của mã OTP. 8 chữ số = 10^8 không gian. */
export const OTP_CODE_DIGITS = 8;

/** TTL của một challenge (giây) — nhiệm vụ yêu cầu 10 phút. */
export const OTP_TTL_SECONDS = 600;

/** Khoảng cách tối thiểu giữa hai lần cấp mã cho cùng địa chỉ (giây). */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/** Trần số lần nhập sai cho một challenge. */
export const MAX_OTP_ATTEMPTS = 5;

/** Rate limit cấp mã: tối đa 3 challenge trong cửa sổ trượt 15 phút, mỗi địa chỉ. */
export const OTP_RATE_LIMIT_SHORT_MAX = 3;

/** Cửa sổ ngắn của rate limit (giây). */
export const OTP_RATE_LIMIT_SHORT_WINDOW_SECONDS = 900;

/** Rate limit cấp mã: tối đa 10 challenge trong cửa sổ trượt 1 giờ, mỗi địa chỉ. */
export const OTP_RATE_LIMIT_HOUR_MAX = 10;

/** Cửa sổ dài của rate limit (giây). */
export const OTP_RATE_LIMIT_HOUR_WINDOW_SECONDS = 3600;

/** Độ dài tối thiểu của secret HMAC cho OTP — cùng mốc với internal HMAC. */
export const MIN_OTP_HMAC_SECRET_LENGTH = 32;

/** Purpose duy nhất của v1 — phải khớp CHECK `otp_challenges_purpose_check`. */
export const OTP_PURPOSE_LOGIN = 'login';

/** Kết quả sinh mã: mã trần (chỉ tồn tại trong bộ nhớ của caller) và digest để ghi. */
export interface OtpCodeMaterial {
  /** Mã 8 chữ số dạng chuỗi — đi thẳng vào mail, không bao giờ vào DB hay log. */
  readonly code: string;
  /** HMAC-SHA256 hex của `purpose:code` — thứ duy nhất được ghi xuống DB. */
  readonly digest: string;
}

/** Nhãn của một địa chỉ sau khi normalize. */
export interface NormalizedEmail {
  /** Địa chỉ đã lowercase + trim — dạng nội bộ, không phải dạng hiển thị. */
  readonly normalized: string;
  /** SHA-256 hex của `normalized` — khoá tra cứu của DB. */
  readonly hash: string;
}

/** Loại mục tiêu mà route `challenge` đối mặt. */
export type OtpTargetKind = 'verified' | 'unknown_or_unusable';

/**
 * Kết quả tra cứu địa chỉ — discriminated để route quyết định gửi mail hay chỉ
 * ghi challenge "ma" (rate-limit địa chỉ lạ), **không bao giờ** lộ vào response.
 */
export interface OtpTarget {
  readonly kind: OtpTargetKind;
  /** Chỉ có ở `verified`: hàng `email_addresses` và chủ thể của nó. */
  readonly emailId?: string;
  readonly userSub?: string;
  /** Trạng thái account của chủ thể — route phải fail-closed với `suspended`/`deleted`. */
  readonly accountStatus?: string;
}

/**
 * Chuẩn hoá địa chỉ email: trim + lowercase toàn bộ.
 *
 * ⚠️ Đây là hình thức normalize **đơn giản có chủ đích**, không phải bộ RFC 5321
 * đầy đủ: local-part của hầu hết provider là case-insensitive trong thực tế, và
 * việc giữ nguyên hoa/thường chia đôi không gian tra cứu mà không thêm đúng nào.
 * Ví dụ `dot-atom` đặc biệt (quoted local-part, `"A"@example.com`) là trường hợp
 * hiếm và bị loại một cách chấp nhận được vì luồng OTP chỉ phục vụ địa chỉ
 * **đã được user tự khai báo** — khai báo bằng dạng nào thì đăng nhập bằng dạng đó
 * sau khi normalize. Không chuẩn hoá theo kiểu provider (Gmail bỏ dấu chấm) — đó là policy của
 * provider, không phải của ta.
 */
export function normalizeEmailAddress(address: string): string {
  return address.trim().toLowerCase();
}

/** SHA-256 hex của địa chỉ đã normalize — khoá tra cứu DB. */
export async function emailAddressHash(normalized: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(digest));
}

/** Cả hai bước normalize + hash — đường chính mà mọi call site dùng. */
export async function normalizeAndHashEmail(address: string): Promise<NormalizedEmail> {
  const normalized = normalizeEmailAddress(address);
  return { normalized, hash: await emailAddressHash(normalized) };
}

/**
 * Sinh mã OTP 8 chữ số **không bias** và digest HMAC của nó.
 *
 * ## Vì sao modulo sau một khoảng lớn là đủ, và vì sao vẫn loại bias
 *
 * `crypto.getRandomValues(Uint32Array)` cho giá trị đều trên [0, 2^32). Lấy
 * `value % 10^8` sẽ có bias nhỏ (2^32 không chia hết cho 10^8) — một bias 2^-12
 * không phải lỗ hổng thực tế, nhưng loại nó gần như miễn phí: lấy **số 64-bit
 * từ hai Uint32** rồi modulo 10^8. 2^64 mod 10^8 lệch rất nhỏ; dứt điểm bằng
 * rejection sampling trên khoảng [0, 10^8·k) — re-draw khi rơi vào phần dư.
 * Vòng lặp kết thúc gần như tức thì (xác suất re-draw ~5.4% mỗi lần với
 * k = floor(2^64/10^8)).
 *
 * Mã trả dạng chuỗi **có số 0 đệm đầu** (`padStart`) — một mã `0042...` là một
 * mã hợp lệ, và so sánh số học sẽ làm mất không gian đó.
 *
 * ⚠️ Mã trần chỉ sống trong bộ nhớ của caller cho tới khi đi vào mail. Không log,
 * không ghi DB, không đưa vào response — chỉ digest được lưu (invariant 9).
 *
 * @param hmacKey Secret hex hoặc chuỗi tuỳ ý từ Worker Secret; dùng thẳng làm
 *   khoá HMAC (encode UTF-8). Tham số để test khoá được bất biến digest mà không
 *   chạm env.
 * @param purpose Ghép vào trước mã trong message HMAC để digest của cùng mã ở
 *   hai purpose khác nhau là hai giá trị — domain separation rẻ nhất.
 * @param random Nguồn byte ngẫu nhiên do caller truyền (mặc định
 *   `crypto.getRandomValues` trên `Uint32Array(2)`). Test truyền nguồn tất định
 *   để kiểm trajectory mà không chạm CSPRNG.
 */
export async function createOtpChallenge(
  hmacKey: string,
  purpose: string,
  random?: () => number,
): Promise<OtpCodeMaterial> {
  const code = random === undefined ? drawUnbiasedCode() : deterministicCode(random);
  const digest = await otpDigest(hmacKey, purpose, code);
  return { code, digest };
}

/**
 * HMAC-SHA256(key, `purpose + ":" + code`), hex 64 ký tự.
 *
 * Message ghép theo mẫu `purpose:code` thay vì hash riêng từng phần: purpose là
 * hằng của giao thức (`login`), code là chuỗi digit độ dài cố định, nên ghép
 * không mơ hồ. Export riêng để test tính bất biến digest (cùng key + cùng input
 * ⇒ cùng digest; đổi key ⇒ digest khác) và để verify gọi đúng hàm này.
 */
export async function otpDigest(hmacKey: string, purpose: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(hmacKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const message = new TextEncoder().encode(`${purpose}:${code}`);
  const signature = await crypto.subtle.sign('HMAC', key, message);
  return toHex(new Uint8Array(signature));
}

/**
 * So sánh digest theo thời gian hằng trên hex — bản dùng cho OTP của
 * `timingSafeEqualHex` trong `libs/identity-contracts` (không import được: contract
 * lib không export hàm nội bộ đó, và lặp lại một hàm 15 dòng với cùng JSDoc là rẻ
 * hơn một phụ thuộc mới vào `type:contracts` từ composition app).
 *
 * XOR trên từng byte, không short-circuit: thời gian chạy không phụ thuộc vị trí
 * byte khác nhau đầu tiên. Độ dài khác nhau trả `false` trước vòng lặp — độ dài
 * digest là hằng công khai (64 hex), rò ở đó không lộ gì.
 */
export function timingSafeDigestEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    const left = Number.parseInt(a[i] ?? '0', 16);
    const right = Number.parseInt(b[i] ?? '0', 16);
    diff |= left ^ right;
  }
  return diff === 0;
}

/**
 * Rút một mã từ CSPRNG không bias — rejection sampling trên khoảng 64-bit.
 *
 * Export để test gọi trực tiếp và đo phân bố/độ dài; đường production đi qua
 * {@link createOtpChallenge}.
 */
export function drawUnbiasedCode(): string {
  const space = 10 ** OTP_CODE_DIGITS;
  // k = số lượng "splits" đầy đủ của [0, 2^64) — mọi giá trị dưới `k * space`
  // đều nhau trên không gian mã.
  const spaceBig = BigInt(space);
  const draws = 2n ** 64n;
  const usable = (draws / spaceBig) * spaceBig; // k * space, số nguyên 64-bit

  for (;;) {
    const value = (BigInt(cryptoRandom32()) << 32n) | BigInt(cryptoRandom32());
    // Giá trị dưới `usable` là đều trên không gian; lấy modulo. Re-draw phần dư.
    if (value < usable) {
      const code = Number(value % spaceBig);
      return String(code).padStart(OTP_CODE_DIGITS, '0');
    }
    // Biên an toàn không bao giờ chạm vì `usable >= 2^53` khi space = 10^8
    // (2^64/10^8 ≈ 1.8·10^11 splits). Assert dạng comment chứ không throw để
    // không thêm nhánh runtime vô nghĩa.
  }
}

/** Con số tất định từ callback — đường test của {@link createOtpChallenge}. */
function deterministicCode(random: () => number): string {
  const code = Math.abs(Math.floor(random())) % 10 ** OTP_CODE_DIGITS;
  return String(code).padStart(OTP_CODE_DIGITS, '0');
}

function cryptoRandom32(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] ?? 0;
}

/** Byte buffer → hex chữ thường. */
function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

// -------------------------------------------------------------------------------------------
// Persistence — PostgreSQL
// -------------------------------------------------------------------------------------------

/** Hàng `otp_challenges` cần cho verify và cho kiểm cooldown resend. */
export interface OtpChallengeRow {
  readonly id: string;
  readonly code_digest: string;
  readonly attempts: number;
  readonly expires_at: Date;
  readonly consumed_at: Date | null;
  readonly created_at: Date;
}

/** Loại row rút gọn phục vụ tra cứu active. */
type QueryablePool = import('pg').Pool;

/**
 * Challenge active của một (address, purpose) — hoặc `null`.
 *
 * Unique partial index đảm bảo tối đa một hàng; đọc bằng `LIMIT 1` vẫn đúng hợp
 * đồng kể cả khi index bị bỏ (ví dụ hàng cũ từ trước khi migration tạo index).
 */
export async function findActiveChallenge(
  pool: QueryablePool,
  addressHash: string,
  purpose: string,
): Promise<OtpChallengeRow | null> {
  const result = await pool.query<{
    id: string;
    code_digest: string;
    attempts: number;
    expires_at: Date;
    consumed_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id, code_digest, attempts, expires_at, consumed_at, created_at
       FROM account.otp_challenges
      WHERE address_hash = $1 AND purpose = $2 AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [addressHash, purpose],
  );
  const row = result.rows[0];
  return row === undefined ? null : row;
}

/**
 * Đếm số challenge đã cấp cho địa chỉ trong cửa sổ trượt — đầu vào của rate limit.
 *
 * Đếm **mọi** hàng trong cửa sổ, kể cả đã consume: giới hạn là về **tần suất cấp
 * mã** (mỗi cấp là một mail đi ra), không phải về số challenge đang sống.
 */
export async function countChallengesSince(
  pool: QueryablePool,
  addressHash: string,
  sinceSeconds: number,
): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM account.otp_challenges
      WHERE address_hash = $1 AND created_at > now() - make_interval(secs => $2)`,
    [addressHash, sinceSeconds],
  );
  return result.rows[0]?.count ?? 0;
}

/** Quyết định rate limit — thuần, test được không cần DB. */
export function isRateLimited(shortCount: number, hourCount: number): boolean {
  return shortCount >= OTP_RATE_LIMIT_SHORT_MAX || hourCount >= OTP_RATE_LIMIT_HOUR_MAX;
}

/**
 * Kiểm cooldown resend: còn `now - lastCreated < cooldown` không.
 *
 * Thuần — caller truyền mốc tạo của challenge active gần nhất.
 */
export function isResendBlocked(lastCreatedAt: Date, nowMs: number): boolean {
  const elapsedMs = nowMs - lastCreatedAt.getTime();
  return elapsedMs < OTP_RESEND_COOLDOWN_SECONDS * 1000;
}

/**
 * Ghi một challenge mới, **consume challenge active cũ trong cùng transaction**.
 *
 * ⚠️ Hai lệnh trong MỘT transaction là điều kiện của ràng buộc unique partial:
 * `INSERT` khi còn hàng active phải lỗi, nên consume-trước-ghi là thứ giữ mọi
 * resend đi qua đúng một đường. Transaction rollback khi `INSERT` ném — hàng cũ
 * được trả lại trạng thái active, không mất mát.
 *
 * @returns Hàng đã ghi (để route biết `id` và `expires_at` khi cần), hoặc ném lỗi
 *   unique violation từ DB — caller (route) phải coi ném là điều kiện cạnh tranh
 *   đã thua và trả 429, **không** retry ngầm.
 */
export async function insertChallenge(
  pool: QueryablePool,
  params: {
    addressHash: string;
    digest: string;
    purpose: string;
    expiresAt: Date;
  },
): Promise<{ id: string; expiresAt: Date }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE account.otp_challenges
          SET consumed_at = now()
        WHERE address_hash = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [params.addressHash, params.purpose],
    );
    const inserted = await client.query<{ id: string; expires_at: Date }>(
      `INSERT INTO account.otp_challenges (address_hash, code_digest, purpose, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, expires_at`,
      [params.addressHash, params.digest, params.purpose, params.expiresAt],
    );
    await client.query('COMMIT');
    const row = inserted.rows[0];
    if (row === undefined) {
      throw new Error('otp_challenges: insert returned no row');
    }
    return { id: row.id, expiresAt: row.expires_at };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Tăng `attempts` của challenge — một UPDATE nguyên tử.
 *
 * Cộng thêm ở server (`attempts + 1`) chứ không ghi giá trị client gửi: hai
 * request verify cạnh nhau cùng đọc `attempts = 4` rồi cùng ghi `5` là hai lần
 * nhập sai được tính một — trần 5 lần thành trần tuỳ hứng. `attempts = attempts + 1`
 * trong một câu là nguyên tử theo PostgreSQL row-level lock.
 *
 * @returns Số `attempts` sau khi tăng, hoặc `null` khi challenge đã bị consume
 *   bởi request khác giữa chừng (điều kiện `consumed_at IS NULL` không còn khớp).
 */
export async function recordFailedAttempt(
  pool: QueryablePool,
  challengeId: string,
): Promise<number | null> {
  const result = await pool.query<{ attempts: number }>(
    `UPDATE account.otp_challenges
        SET attempts = attempts + 1
      WHERE id = $1 AND consumed_at IS NULL
      RETURNING attempts`,
    [challengeId],
  );
  const row = result.rows[0];
  return row === undefined ? null : row.attempts;
}

/**
 * Consume challenge — một UPDATE nguyên tử, chỉ khi còn active.
 *
 * @returns `true` khi request này thắng consume; `false` khi request khác đã
 *   consume trước (single-use enforced bởi điều kiện WHERE, không phải bằng
 *   đọc-rồi-ghi).
 */
export async function consumeChallenge(pool: QueryablePool, challengeId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE account.otp_challenges
        SET consumed_at = now()
      WHERE id = $1 AND consumed_at IS NULL`,
    [challengeId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Nhận diện lỗi unique violation của PostgreSQL (`23505`) từ một error bất kỳ.
 *
 * Route `challenge` dùng nó để phân biệt **thua race consume-then-insert** (hai
 * request cấp mã song song cho cùng địa chỉ — partial UNIQUE index chỉ cho một
 * cái thắng) khỏi lỗi DB thật. Thua race là một nhánh bị chặn bình thường của
 * luồng — nó phải về `silently_rejected` (204, anti-enumeration), không được rơi
 * vào 503 `db_unreachable` vì 503 là một response phân biệt được.
 *
 * Chỉ đọc `code` của error driver `pg` — không đọc `message` (message có thể
 * chứa giá trị cột, ví dụ digest).
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

// -------------------------------------------------------------------------------------------
// Tra cứu địa chỉ — đầu vào của anti-enumeration
// -------------------------------------------------------------------------------------------

/**
 * Hàng `email_addresses` + trạng thái `users` của địa chỉ đã tra cứu.
 */
export interface OtpAddressLookup {
  readonly emailId: string | null;
  readonly userSub: string | null;
  readonly accountStatus: string | null;
}

/**
 * Tra cứu địa chỉ theo hash: hàng `email_addresses` verified và trạng thái account.
 *
 * ⚠️ Chỉ hàng `status = 'verified'` được nhận OTP đăng nhập (FR-002). `pending`
 * trả như **không tồn tại** — cả hai cùng là `unknown_or_unusable` ở tầng route.
 */
export async function lookupVerifiedAddress(
  pool: QueryablePool,
  addressHash: string,
): Promise<OtpAddressLookup | null> {
  const result = await pool.query<{
    email_id: string;
    user_sub: string;
    account_status: string;
  }>(
    `SELECT e.id AS email_id, e.user_sub, u.status AS account_status
       FROM account.email_addresses e
       JOIN account.users u ON u.sub = e.user_sub
      WHERE e.address_hash = $1 AND e.status = 'verified'
      LIMIT 1`,
    [addressHash],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }
  return {
    emailId: row.email_id,
    userSub: row.user_sub,
    accountStatus: row.account_status,
  };
}

/**
 * Phân loại mục tiêu — route dùng kết quả này để quyết định **hành vi nội bộ**
 * (gửi mail hay không), không phải để phân biệt response.
 *
 * Fail-closed với account status: `active` là trạng thái duy nhất được tiếp tục;
 * `suspended`/`deleted` và mọi giá trị lạ đều về `unknown_or_unusable` — cùng kết
 * quả phát hành, đúng hợp đồng "not_found và deleted dẫn tới cùng kết quả" của
 * FR-011d.
 */
export function resolveOtpTarget(lookup: OtpAddressLookup | null): OtpTarget {
  if (
    lookup === null ||
    lookup.emailId === null ||
    lookup.userSub === null ||
    lookup.accountStatus !== 'active'
  ) {
    return { kind: 'unknown_or_unusable' };
  }
  return {
    kind: 'verified',
    emailId: lookup.emailId,
    userSub: lookup.userSub,
    accountStatus: lookup.accountStatus,
  };
}
