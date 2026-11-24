import type { Command } from '@ecoma-io/usecase-primitives';

import {
  OTP_CODE_DIGITS,
  OTP_RATE_LIMIT_HOUR_MAX,
  OTP_RATE_LIMIT_HOUR_WINDOW_SECONDS,
  OTP_RATE_LIMIT_SHORT_MAX,
  OTP_RATE_LIMIT_SHORT_WINDOW_SECONDS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  hashAddressKey,
  normalizeEmailAddress,
} from '@ecoma-io/account-domain';
import type { OtpDigest, OtpPurpose } from '@ecoma-io/account-domain';

import type {
  AccountStore,
  Clock,
  CryptoDigestPort,
  IdGenerator,
  InvitationStore,
  MailIdempotencyKey,
  OtpChallengeStore,
  TransactionalMailOutbound,
} from '../ports';

/** Input của RequestOtpChallenge — trường thô từ transport. */
export interface RequestOtpChallengeInput {
  readonly email: string;
  readonly purpose: OtpPurpose;
}

/**
 * Output cho transport — cùng hình dạng trên MỌI nhánh (anti-enumeration).
 * Discriminator chỉ phục vụ test/log; transport luôn phản hồi giống nhau.
 */
export interface RequestOtpChallengeOutput {
  readonly status: 'accepted' | 'silently_rejected';
}

export type RequestOtpChallenge = Command<RequestOtpChallengeInput, RequestOtpChallengeOutput>;

/** Alias contract cho type-level test. */
export type RequestOtpChallengeUseCaseType = RequestOtpChallenge;

/**
 * Hình dạng tối thiểu của địa chỉ — không phải RFC 5321 đầy đủ. Sai hình dạng
 * là điều người gọi tự sửa được → TypeError tại trust boundary (400 của transport).
 */
function assertEmailShape(email: string): void {
  if (
    typeof email !== 'string' ||
    email.length <= 3 ||
    email.length > 254 ||
    !email.includes('@')
  ) {
    throw new TypeError('RequestOtpChallenge: email sai hình dạng.');
  }
}

/**
 * Command cấp mã OTP cho một địa chỉ email (mục đích `login` | `verify_email`).
 *
 * Bất invariant từ legacy `challenge.post.ts`:
 * - **Anti-enumeration là bất biến số một**: mọi nhánh bị chặn (race, cooldown,
 *   rate limit, địa chỉ lạ) cùng trả `silently_rejected` — không phân biệt được
 *   ra ngoài.
 * - **Challenge ma**: địa chỉ không thuộc account nào vẫn được ghi challenge
 *   với digest của mã sinh thật (không nhánh bỏ qua crypto — không lệch timing);
 *   rate-limit đếm từ bảng challenge nên địa chỉ lạ chịu cùng giới hạn.
 * - Mail chỉ đi ra sau khi challenge đã được ghi; Idempotency-Key derive từ
 *   challenge id (UUID) — KHÔNG derive từ digest (mã chỉ 10^8 giá trị, trùng mã
 *   ⇒ cùng khoá ⇒ receiver nhầm replay).
 * - Kênh lời mời: địa chỉ chưa verified nhưng đang có invitation `open` nhận
 *   mã thật (ADR-0030 — người được mời đi qua đúng luồng email-OTP).
 * - Serialization của việc phát hành (cooldown → window count → consume-old →
 *   INSERT, partial unique trọng tài) là hợp đồng của
 *   {@link OtpChallengeStore.issueWithinProtocol} — use case không tự kiểm.
 */
export class RequestOtpChallengeUseCase implements RequestOtpChallenge {
  readonly #otp: OtpChallengeStore;
  readonly #invitations: InvitationStore;
  readonly #accounts: AccountStore;
  readonly #mail: TransactionalMailOutbound;
  readonly #ids: IdGenerator;
  readonly #crypto: CryptoDigestPort;
  readonly #clock: Clock;
  readonly #otpSecret: string;

  public constructor(deps: {
    otp: OtpChallengeStore;
    invitations: InvitationStore;
    accounts: AccountStore;
    mail: TransactionalMailOutbound;
    ids: IdGenerator;
    crypto: CryptoDigestPort;
    clock: Clock;
    /** Secret HMAC cho digest OTP — cấu hình, không bao giờ persist. */
    otpSecret: string;
  }) {
    if (deps.otpSecret.length === 0) {
      throw new TypeError('RequestOtpChallenge: otpSecret không được rỗng.');
    }
    this.#otp = deps.otp;
    this.#invitations = deps.invitations;
    this.#accounts = deps.accounts;
    this.#mail = deps.mail;
    this.#ids = deps.ids;
    this.#crypto = deps.crypto;
    this.#clock = deps.clock;
    this.#otpSecret = deps.otpSecret;
  }

  public async execute(input: RequestOtpChallengeInput): Promise<RequestOtpChallengeOutput> {
    assertEmailShape(input.email);
    const normalized = normalizeEmailAddress(input.email),
      addressKey = await hashAddressKey(normalized),
      now = this.#clock.now(),
      // Sinh mã + digest CHO MỌI địa chỉ, kể cả lạ — không có nhánh bỏ qua crypto.
      code = this.#crypto.randomDigits(OTP_CODE_DIGITS),
      digest = (await this.#crypto.hmacSha256Hex(
        this.#otpSecret,
        `${input.purpose}:${code}`,
      )) as OtpDigest,
      // Phát hành theo protocol §7b — store là nơi tuần tự hoá thật.
      outcome = await this.#otp.issueWithinProtocol({
        addressKey,
        cooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS,
        digest,
        id: this.#ids.newOtpChallengeId(),
        now,
        purpose: input.purpose,
        rateLimits: {
          hourMax: OTP_RATE_LIMIT_HOUR_MAX,
          hourWindowSeconds: OTP_RATE_LIMIT_HOUR_WINDOW_SECONDS,
          shortMax: OTP_RATE_LIMIT_SHORT_MAX,
          shortWindowSeconds: OTP_RATE_LIMIT_SHORT_WINDOW_SECONDS,
        },
        ttlSeconds: OTP_TTL_SECONDS,
      });
    if ('rejected' in outcome) {
      // Race_lost / cooldown / rate_limited — cùng một nhánh im lặng.
      return { status: 'silently_rejected' };
    }

    // Quyết định gửi mail — KHÔNG quyết định response. Địa chỉ lạ (không
    // Verified, không invitation mở) là challenge ma: đã ghi, không mail.
    const verified = await this.#accounts.findByVerifiedAddressKey(addressKey);
    let mailable = verified !== undefined;
    if (!mailable) {
      const open = await this.#invitations.findOpenByAddressKey(addressKey);
      mailable = open.length > 0;
    }
    if (!mailable) {
      return { status: 'silently_rejected' };
    }

    // Idempotency-Key từ challenge id (identity duy nhất per challenge, stable
    // Cho retry) — không derive từ digest (xem JSDoc class).
    try {
      await this.#mail.send(
        {
          payload: { code },
          templateId: input.purpose === 'login' ? 'account_otp_login' : 'account_otp_verify_email',
          to: normalized,
        },
        `otp:${outcome.snapshot.id}` as MailIdempotencyKey,
      );
    } catch {
      // Mail lỗi không đổi outcome — observability là concern của infrastructure.
    }
    return { status: 'accepted' };
  }
}
