import type { Command } from '@ecoma-io/usecase-primitives';

import {
  ACR,
  Account,
  BrowserSession,
  INVITATION_STATE,
  OTP_PURPOSE_LOGIN,
  createSubject,
  hashAddressKey,
  normalizeEmailAddress,
} from '@ecoma-io/account-domain';
import type {
  BrowserSessionSnapshot,
  OtpChallengeId,
  OtpDigest,
  SessionRef,
  Subject,
} from '@ecoma-io/account-domain';

import type {
  AccountStore,
  BrowserSessionStore,
  Clock,
  CryptoDigestPort,
  IdGenerator,
  InvitationStore,
  LoginHandoffStore,
  OtpChallengeStore,
  UnitOfWork,
} from '../ports';
import type { TransactionHandle } from '../ports/unit-of-work.js';

/** Input của VerifyOtpLogin — transport đã resolve cookie thành sessionRef. */
export interface VerifyOtpLoginInput {
  readonly email: string;
  readonly code: string;
  /** SessionRef của phiên live trình duyệt đang cầm cookie (nếu có) — cho rotation. */
  readonly presentSessionRef?: SessionRef;
}

/** Phiên mới phát hành — snapshot + ref cho transport dựng cookie. */
export interface IssuedSession {
  readonly sessionRef: SessionRef;
  readonly snapshot: BrowserSessionSnapshot;
}

/**
 * Output — `rejected` là MỘT nhánh mờ (anti-guessing): không phân biệt "chưa
 * từng yêu cầu mã", "hết hạn", "mã sai", "hết lượt thử" ra ngoài.
 */
export type VerifyOtpLoginOutput =
  | { readonly kind: 'logged_in'; readonly subject: Subject; readonly session: IssuedSession }
  | {
      readonly kind: 'invitation_accepted';
      readonly subject: Subject;
      readonly session: IssuedSession;
    }
  | { readonly kind: 'rejected' };

export type VerifyOtpLogin = Command<VerifyOtpLoginInput, VerifyOtpLoginOutput>;

/** Alias contract cho type-level test. */
export type VerifyOtpLoginUseCaseType = VerifyOtpLogin;

/** Lỗi sentinel nội bộ để rollback transaction acceptance — không rò ra ngoài. */
class AcceptanceRejection extends Error {
  public constructor() {
    super('acceptance rejected');
    this.name = 'AcceptanceRejection';
  }
}

function assertVerifyShape(email: string, code: string): void {
  if (
    typeof email !== 'string' ||
    email.length <= 3 ||
    email.length > 254 ||
    !email.includes('@') ||
    typeof code !== 'string' ||
    !/^\d{8}$/u.test(code)
  ) {
    throw new TypeError('VerifyOtpLogin: email/code sai hình dạng.');
  }
}

/**
 * Command xác minh OTP và phát hành phiên (rotation FR-004a nằm trong cùng
 * transaction) — reproduces legacy `verify.post.ts` trừ transport (cookie,
 * CSRF, confirmUrl là việc của transport).
 *
 * Bất biến từ legacy:
 * - Mọi nhánh từ chối cùng về `rejected` — anti-guessing (400 chung của route).
 * - Digest mã so timing-safe; mismatch tăng attempts + khóa-at-cap trong MỘT
 *   statement ({@link OtpChallengeStore.recordFailedAttemptAndLock}).
 * - Trạng thái địa chỉ + account xác minh lại TẠI THỜI ĐIỂM verify (không tin
 *   thứ tự sự kiện giữa challenge và verify); suspended/deleted fail-closed vì
 *   port chỉ trả về account có email verified.
 * - Consume challenge là CAS — thua consume = request trùng đã thắng.
 * - Rotation (FR-004a): chỉ session **anonymous** của cùng browser bị thu hồi;
 *   phiên authenticated của account khác không bao giờ bị đụng tới.
 * - Kênh lời mời (ADR-0030): mã đúng + invitation open + chưa có email verified
 *   ⇒ chấp nhận trong MỘT transaction (consume-challenge → accept-invitation →
 *   INSERT account → rotate/insert session — thứ tự trigger birth-guard).
 *   Mọi lý do từ chối giữa chừng ⇒ ROLLBACK toàn bộ (sentinel error) — không
 *   còn nửa vời nào: challenge vẫn còn, invitation vẫn open.
 */
export class VerifyOtpLoginUseCase implements VerifyOtpLogin {
  readonly #otp: OtpChallengeStore;
  readonly #invitations: InvitationStore;
  readonly #accounts: AccountStore;
  readonly #sessions: BrowserSessionStore;
  readonly #handoffs: LoginHandoffStore;
  readonly #unitOfWork: UnitOfWork;
  readonly #ids: IdGenerator;
  readonly #crypto: CryptoDigestPort;
  readonly #clock: Clock;
  readonly #otpSecret: string;

  public constructor(deps: {
    otp: OtpChallengeStore;
    invitations: InvitationStore;
    accounts: AccountStore;
    sessions: BrowserSessionStore;
    handoffs: LoginHandoffStore;
    unitOfWork: UnitOfWork;
    ids: IdGenerator;
    crypto: CryptoDigestPort;
    clock: Clock;
    otpSecret: string;
  }) {
    if (deps.otpSecret.length === 0) {
      throw new TypeError('VerifyOtpLogin: otpSecret không được rỗng.');
    }
    this.#otp = deps.otp;
    this.#invitations = deps.invitations;
    this.#accounts = deps.accounts;
    this.#sessions = deps.sessions;
    this.#handoffs = deps.handoffs;
    this.#unitOfWork = deps.unitOfWork;
    this.#ids = deps.ids;
    this.#crypto = deps.crypto;
    this.#clock = deps.clock;
    this.#otpSecret = deps.otpSecret;
  }

  public async execute(input: VerifyOtpLoginInput): Promise<VerifyOtpLoginOutput> {
    assertVerifyShape(input.email, input.code);
    const addressKey = await hashAddressKey(normalizeEmailAddress(input.email)),
      now = this.#clock.now(),
      challenge = await this.#otp.findActive(addressKey, OTP_PURPOSE_LOGIN, now);
    if (challenge === undefined) {
      return { kind: 'rejected' };
    }
    if (now >= challenge.expiresAt) {
      // Hết hạn: khoá nguyên tử (hygiene vòng đời) rồi từ chối như mọi nhánh khác.
      await this.#otp.expireIfExpired(challenge.id, now);
      return { kind: 'rejected' };
    }

    const digest = (await this.#crypto.hmacSha256Hex(
      this.#otpSecret,
      `${OTP_PURPOSE_LOGIN}:${input.code}`,
    )) as OtpDigest;
    if (!this.#crypto.timingSafeEqualHex(digest, challenge.digest ?? '')) {
      // Tăng + khóa trong MỘT statement — trần attempts không bị luồn.
      await this.#otp.recordFailedAttemptAndLock(challenge.id, now);
      return { kind: 'rejected' };
    }

    // Xác minh lại trạng thái địa chỉ TẠI THỜI ĐIỂM verify — fail-closed.
    const target = await this.#accounts.findByVerifiedAddressKey(addressKey);
    if (target === undefined) {
      return this.#acceptInvitation(addressKey, challenge.id, now, input);
    }

    // Đăng nhập thường.
    return this.#issueSessionForExisting(target.subject, challenge.id, now, input);
  }

  /** Đăng nhập account có sẵn: consume challenge + rotate/insert session trong MỘT tx. */
  async #issueSessionForExisting(
    subject: Subject,
    challengeId: OtpChallengeId,
    now: number,
    input: VerifyOtpLoginInput,
  ): Promise<VerifyOtpLoginOutput> {
    try {
      const issued = await this.#unitOfWork.run(async (tx) => {
        const consumed = await this.#otp.consume(challengeId, now, tx);
        if (!consumed) {
          // Thua CAS — request trùng đã thắng. Sentinel abort tx (không ghi gì).
          throw new AcceptanceRejection();
        }
        return this.#writeSessionStatements(subject, now, input, tx);
      });
      return { kind: 'logged_in', session: issued, subject };
    } catch (error) {
      if (error instanceof AcceptanceRejection) {
        return { kind: 'rejected' };
      }
      throw error;
    }
  }

  /**
   * Kênh lời mời: mã đúng + invitation open + chưa có email verified. MỘT
   * transaction theo thứ tự trigger birth-guard; từ chối giữa chừng ⇒ sentinel
   * abort ⇒ ROLLBACK toàn bộ.
   */
  async #acceptInvitation(
    addressKey: string,
    challengeId: OtpChallengeId,
    now: number,
    input: VerifyOtpLoginInput,
  ): Promise<VerifyOtpLoginOutput> {
    const open = await this.#invitations.findOpenByAddressKey(addressKey as never),
      invitation = open.find((inv) => inv.state === INVITATION_STATE.Open);
    if (invitation === undefined) {
      return { kind: 'rejected' };
    }

    // Sinh subject TRƯỚC tx — entropy CSPRNG, thất bại ở đây chưa ghi gì.
    const subject = createSubject(this.#ids.newSubjectEntropy());

    try {
      const issued = await this.#unitOfWork.run(async (tx) => {
        // 1. Consume challenge TRƯỚC (trigger birth-guard đọc challenge đã tiêu).
        const consumed = await this.#otp.consume(challengeId, now, tx);
        if (!consumed) {
          throw new AcceptanceRejection();
        }
        // 2. CAS consume invitation (state open + TTL bên trong CAS).
        const accepted = await this.#invitations.consumeOpenWithinTx({
          acceptedAt: now,
          acceptedSubject: subject,
          id: invitation.id,
          now,
          tx,
        });
        if (!accepted) {
          throw new AcceptanceRejection();
        }
        // 3. Provision account — aggregate tự sinh email đầu tiên verified.
        const account = Account.provisionFromInvitation({
            emailKey: addressKey as never,
            now,
            subject,
          }),
          inserted = await this.#accounts.insertWithinAcceptanceTx(account.snapshot(), tx);
        if (!inserted) {
          throw new AcceptanceRejection();
        }
        // 4. Session trong cùng tx (rotate anonymous + insert authenticated).
        return this.#writeSessionStatements(subject, now, input, tx);
      });
      return { kind: 'invitation_accepted', session: issued, subject };
    } catch (error) {
      if (error instanceof AcceptanceRejection) {
        return { kind: 'rejected' };
      }
      throw error;
    }
  }

  /**
   * Các statement session của cả hai đường: revoke session anonymous hiện có
   * (chỉ anonymous — phiên authenticated của account khác không đụng tới,
   * legacy) + INSERT phiên authenticated mới (acr email-otp). FR-006c4: carry
   * handoff binding của phiên cũ sang phiên mới trong CÙNG transaction —
   * tách ra là khoảng chết §3.6.2. Trong transaction caller.
   */
  async #writeSessionStatements(
    subject: Subject,
    now: number,
    input: VerifyOtpLoginInput,
    tx: TransactionHandle,
  ): Promise<IssuedSession> {
    let carriedFrom: SessionRef | undefined;
    if (input.presentSessionRef !== undefined) {
      const present = await this.#sessions.findById(input.presentSessionRef, tx);
      // Chỉ anonymous live bị thu hồi trong rotation (legacy: accept/verify không
      // Hợp nhất phiên account khác). Session chết tự cạn theo TTL.
      if (present !== undefined && present.acr === null && present.revokedAt === null) {
        carriedFrom = input.presentSessionRef;
        await this.#sessions.revokeOne(input.presentSessionRef, now, tx);
      }
    }
    // Phiên mới: anonymous → authenticate bằng OTP vừa xác minh (FR-004a).
    const sessionRef = this.#ids.newSessionRef(),
      session = BrowserSession.startAnonymous({ now, sessionRef }),
      authError = session.authenticate(ACR.EmailOtp, now);
    if (authError !== undefined) {
      throw new TypeError('VerifyOtpLogin: session authenticate bị từ chối bởi domain.');
    }
    const inserted = await this.#sessions.insertWithinTx({
      snapshot: session.snapshot(),
      subject,
      tx,
    });
    if (!inserted) {
      throw new TypeError('VerifyOtpLogin: session_ref trùng — entropy hỏng.');
    }
    // FR-006c4: chuyển binding handoff sang phiên mới trong đúng tx rotate.
    // Không có binding thì UPDATE khớp 0 hàng — rotate đi tiếp bình thường.
    if (carriedFrom !== undefined) {
      await this.#handoffs.carryBindingWithinTx({
        fromSessionRef: carriedFrom,
        now,
        toSessionRef: sessionRef,
        tx,
      });
    }
    return { sessionRef, snapshot: session.snapshot() };
  }
}
