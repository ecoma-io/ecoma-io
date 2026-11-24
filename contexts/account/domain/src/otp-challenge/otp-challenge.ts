/**
 * Aggregate `OtpChallenge` — thử thách OTP dùng một lần cho một địa chỉ email
 * và một mục đích (`login` hoặc `verify_email`).
 *
 * Identity kép: **`OtpChallengeId`** (branded — khớp `otp_challenges.id uuid`
 * của DB) là aggregate identity, kế thừa `AggregateRoot`. Cặp
 * `(addressKey, purpose)` là **business key** — mọi invariant cross-row (một
 * challenge active, cooldown resend, cửa sổ rate) khoá theo cặp này, và là
 * thứ DB enforce thật qua partial unique + SQL count. Protocol đó **không
 * thuộc aggregate này** — là serialization protocol của infrastructure
 * (proposal §7b: SELECT FOR UPDATE → cooldown → window count sau lock →
 * INSERT; partial unique enforce thật ở DB). Aggregate chỉ phủ lifecycle một
 * challenge.
 *
 * Persistence chỉ có một cột `consumed_at`, nên chỉ có một trạng thái terminal:
 * `consumed` kèm lý do `verified_ok` | `attempt_cap` | `expired`. Crypto
 * (HMAC) do caller tính trước và truyền vào dưới dạng `OtpDigest` — domain
 * không tự gọi WebCrypto (WebCrypto async; convention §3).
 *
 * `addressKey` là `EmailAddressKey` (hash hex opaque) — dạng duy nhất persist,
 * không bao giờ là địa chỉ thô hay địa chỉ normalized.
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';
import type { Brand } from '@ecoma-io/domain-primitives';

import type { EmailAddressKey } from '../email-address/email-address-key';
import { isEmailAddressKey } from '../email-address/email-address-key';
import { domainError } from '../shared/errors';
import type { DomainError } from '../shared/errors';

/** Digest HMAC-SHA256 (hex 64 ký tự) của `purpose:code` — thứ duy nhất lưu được.
 *  Plaintext code (8 chữ số) không bao giờ persist — không có type riêng cho nó. */
export type OtpDigest = Brand<string, 'OtpDigest'>;

/** Định danh hàng challenge — khớp `otp_challenges.id uuid` của DB. */
export type OtpChallengeId = Brand<string, 'OtpChallengeId'>;

/** Type guard cho id tái tạo từ persistence: UUID. */
export function isOtpChallengeId(value: unknown): value is OtpChallengeId {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value)
  );
}

export const OTP_PURPOSE_LOGIN = 'login';
export const OTP_PURPOSE_VERIFY_EMAIL = 'verify_email';
export type OtpPurpose = typeof OTP_PURPOSE_LOGIN | typeof OTP_PURPOSE_VERIFY_EMAIL;

export const OTP_CODE_DIGITS = 8;
export const OTP_TTL_SECONDS = 600;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const MAX_OTP_ATTEMPTS = 5;
export const OTP_RATE_LIMIT_SHORT_MAX = 3;
export const OTP_RATE_LIMIT_SHORT_WINDOW_SECONDS = 900;
export const OTP_RATE_LIMIT_HOUR_MAX = 10;
export const OTP_RATE_LIMIT_HOUR_WINDOW_SECONDS = 3600;

/** Lý do terminal của một challenge đã dùng hết. */
export type OtpTerminalReason = 'verified_ok' | 'attempt_cap' | 'expired';

export interface OtpChallengeSnapshot {
  readonly id: OtpChallengeId;
  readonly addressKey: EmailAddressKey;
  readonly purpose: OtpPurpose;
  readonly digest: OtpDigest | null;
  readonly attempts: number;
  readonly terminal: boolean;
  readonly terminalReason: OtpTerminalReason | null;
  readonly expiresAt: number;
}

const OTP_PURPOSES: ReadonlySet<string> = new Set([OTP_PURPOSE_LOGIN, OTP_PURPOSE_VERIFY_EMAIL]);

/** Digest đúng format: hex 64 ký tự (HMAC-SHA256 hex). */
function isOtpDigestShape(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}

/**
 * So sánh timing-safe hai chuỗi hex cùng độ dài.
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    // Toán trên đơn vị UTF-16; XOR từng code unit — với hex ASCII, codePointAt cho
    // Kết quả giống charCodeAt nhưng thỏa mãn prefer-code-point.
    diff |= (a.codePointAt(i) ?? 0) ^ (b.codePointAt(i) ?? 0);
  }
  return diff === 0;
}

export class OtpChallenge extends AggregateRoot<OtpChallengeId> {
  readonly #addressKey: EmailAddressKey;
  readonly #purpose: OtpPurpose;
  #digest: OtpDigest | null;
  #attempts: number;
  #terminal: boolean;
  #terminalReason: OtpTerminalReason | null;
  readonly #expiresAt: number;

  private constructor(
    id: OtpChallengeId,
    addressKey: EmailAddressKey,
    purpose: OtpPurpose,
    digest: OtpDigest | null,
    attempts: number,
    terminal: boolean,
    terminalReason: OtpTerminalReason | null,
    expiresAt: number,
  ) {
    super(id);
    this.#addressKey = addressKey;
    this.#purpose = purpose;
    this.#digest = digest;
    this.#attempts = attempts;
    this.#terminal = terminal;
    this.#terminalReason = terminalReason;
    this.#expiresAt = expiresAt;
  }

  public static issue(args: {
    id: OtpChallengeId;
    addressKey: EmailAddressKey;
    purpose: OtpPurpose;
    digest: OtpDigest;
    now: number;
    ttlSeconds?: number;
  }): OtpChallenge {
    if (!Number.isFinite(args.now)) {
      throw new TypeError('OtpChallenge issue: now phải là số hữu hạn.');
    }
    if (
      args.ttlSeconds !== undefined &&
      (!Number.isFinite(args.ttlSeconds) || args.ttlSeconds <= 0)
    ) {
      throw new TypeError('OtpChallenge issue: ttlSeconds phải là số hữu hạn dương.');
    }
    // TtlSeconds khổng lồ làm expiresAt tràn thành Infinity — snapshot sẽ bị
    // Reconstitute từ chối.
    if (!Number.isFinite(args.now + (args.ttlSeconds ?? OTP_TTL_SECONDS) * 1000)) {
      throw new TypeError('OtpChallenge issue: expiresAt tràn giá trị.');
    }
    // Format check tại behavior entry — issue() không được tạo snapshot mà
    // Reconstitute sẽ từ chối (convention §11: validation ở mọi entry point).
    if (!isOtpChallengeId(args.id)) {
      throw new TypeError('OtpChallenge issue: id không hợp lệ.');
    }
    if (!isEmailAddressKey(args.addressKey)) {
      throw new TypeError('OtpChallenge issue: addressKey không hợp lệ.');
    }
    if (!OTP_PURPOSES.has(args.purpose)) {
      // Persistence hiện tại chỉ lưu được các purpose trong CHECK constraint —
      // Không tạo domain state mà DB không thể lưu.
      throw new TypeError('OtpChallenge issue: purpose không hợp lệ.');
    }
    if (!isOtpDigestShape(args.digest)) {
      throw new TypeError('OtpChallenge issue: digest không đúng định dạng.');
    }
    return new OtpChallenge(
      args.id,
      args.addressKey,
      args.purpose,
      args.digest,
      0,
      false,
      null,
      args.now + (args.ttlSeconds ?? OTP_TTL_SECONDS) * 1000,
    );
  }

  public static reconstitute(snapshot: OtpChallengeSnapshot): OtpChallenge {
    if (
      !isOtpChallengeId(snapshot.id) ||
      !isEmailAddressKey(snapshot.addressKey) ||
      !OTP_PURPOSES.has(snapshot.purpose) ||
      !Number.isFinite(snapshot.expiresAt) ||
      !Number.isInteger(snapshot.attempts) ||
      snapshot.attempts < 0 ||
      snapshot.attempts > MAX_OTP_ATTEMPTS ||
      (snapshot.terminal && snapshot.terminalReason == null) ||
      (!snapshot.terminal && snapshot.terminalReason !== null) ||
      // Dữ liệu tự mâu thuẫn: attempt_cap phải đạt đủ số lần thử.
      (snapshot.terminalReason === 'attempt_cap' && snapshot.attempts < MAX_OTP_ATTEMPTS) ||
      // Digest là cột lưu trong DB, luôn có trên challenge còn sống; thiếu
      // Digest trên non-terminal snapshot là dữ liệu hỏng (sẽ burn attempts vô nghĩa).
      (!snapshot.terminal && snapshot.digest === null) ||
      (snapshot.digest !== null && !isOtpDigestShape(snapshot.digest))
    ) {
      throw new TypeError('OtpChallenge snapshot không hợp lệ');
    }
    return new OtpChallenge(
      snapshot.id,
      snapshot.addressKey,
      snapshot.purpose,
      snapshot.digest,
      snapshot.attempts,
      snapshot.terminal,
      snapshot.terminalReason,
      snapshot.expiresAt,
    );
  }

  /** Định danh aggregate (khớp `otp_challenges.id`). */
  public override get id(): OtpChallengeId {
    return super.id;
  }

  /** Business key — thứ mà mọi invariant cross-row khoá theo (xem JSDoc class). */
  public businessKey(): { addressKey: EmailAddressKey; purpose: OtpPurpose } {
    return { addressKey: this.#addressKey, purpose: this.#purpose };
  }

  public addressKey(): EmailAddressKey {
    return this.#addressKey;
  }

  public purpose(): OtpPurpose {
    return this.#purpose;
  }

  public attempts(): number {
    return this.#attempts;
  }

  public isTerminal(): boolean {
    return this.#terminal;
  }

  public terminalReason(): OtpTerminalReason | null {
    return this.#terminalReason;
  }

  public expiresAt(): number {
    return this.#expiresAt;
  }

  /**
   * `true` nếu challenge chưa dùng và chưa hết hạn — có thể dùng cho consume.
   */
  public isConsumable(now: number): boolean {
    return Number.isFinite(now) && !this.#terminal && now < this.#expiresAt;
  }

  /**
   * Dùng challenge. Thứ tự kiểm tra: terminal trước, expired sau, mismatch cuối
   * (expired + mã đúng vẫn là 'expired'). Trả `{ consumed: true }` khi đúng;
   * mismatch tăng attempts và có thể khóa khi đạt cap (terminal 'attempt_cap').
   */
  public consume(
    digest: OtpDigest,
    now: number,
  ): { consumed: true } | { rejected: 'mismatch' | 'terminal' | 'expired' } {
    if (this.#terminal) {
      return { rejected: 'terminal' };
    }
    if (!Number.isFinite(now)) {
      // Invalid `now` không được tạo partial mutation (vô tình expire hay
      // Burn attempts) — nhưng cũng không được consume. Mismatch an toàn:
      // Không đổi state, caller thấy rejection.
      return { rejected: 'mismatch' };
    }
    if (now >= this.#expiresAt) {
      this.#terminal = true;
      this.#terminalReason = 'expired';
      return { rejected: 'expired' };
    }
    if (timingSafeEqualHex(digest, this.#digest ?? '')) {
      this.#terminal = true;
      this.#terminalReason = 'verified_ok';
      return { consumed: true };
    }
    this.#attempts += 1;
    if (this.#attempts >= MAX_OTP_ATTEMPTS) {
      this.#terminal = true;
      this.#terminalReason = 'attempt_cap';
    }
    return { rejected: 'mismatch' };
  }

  /**
   * Ghi nhận một lần thử sai (không đi kèm mã). Khóa khi đạt cap.
   * Hết TTL trước khi gọi: challenge chuyển terminal 'expired' — gọi tiếp là
   * vi phạm protocol (caller đã expireIfExpired trước) → domain error.
   * Không gọi trên challenge đã terminal vì lý do khác — cũng domain error.
   */
  public recordFailedAttempt(now: number): { locked: boolean } | DomainError {
    if (!Number.isFinite(now)) {
      return domainError('invalid_transition');
    }
    if (this.expireIfExpired(now)) {
      return domainError('invalid_transition');
    }
    if (this.#terminal) {
      return domainError('invalid_transition');
    }
    this.#attempts += 1;
    if (this.#attempts >= MAX_OTP_ATTEMPTS) {
      this.#terminal = true;
      this.#terminalReason = 'attempt_cap';
      return { locked: true };
    }
    return { locked: false };
  }

  /**
   * Đánh dấu hết hạn (lazy TTL). Trả `true` nếu vừa chuyển sang terminal 'expired';
   * caller cần biết có phải persist hay không. Invalid `now` không mutation —
   * NaN < expiresAt là false, nhưng vô hạn dương sẽ expire một challenge chưa
   * hết hạn thật; chặn tại entry.
   */
  public expireIfExpired(now: number): boolean {
    if (!Number.isFinite(now) || this.#terminal || now < this.#expiresAt) {
      return false;
    }
    this.#terminal = true;
    this.#terminalReason = 'expired';
    return true;
  }

  public snapshot(): OtpChallengeSnapshot {
    return {
      addressKey: this.#addressKey,
      attempts: this.#attempts,
      digest: this.#digest,
      expiresAt: this.#expiresAt,
      id: this.id,
      purpose: this.#purpose,
      terminal: this.#terminal,
      terminalReason: this.#terminalReason,
    };
  }

  /**
   * Equality theo aggregate identity (`OtpChallengeId`) — kế thừa từ `Entity`.
   */
}
