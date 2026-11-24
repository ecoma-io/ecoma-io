import {
  OTP_CODE_DIGITS,
  OTP_TTL_SECONDS,
  hashAddressKey,
  normalizeEmailAddress,
} from '@ecoma-io/account-domain';
import type {
  AccountSnapshot,
  EmailAddressKey,
  InvitationSnapshot,
  OtpChallengeSnapshot,
  Subject,
} from '@ecoma-io/account-domain';

import { RequestOtpChallengeUseCase } from './request-otp-challenge';
import type {
  AccountStore,
  Clock,
  CryptoDigestPort,
  IdGenerator,
  InvitationStore,
  MailIdempotencyKey,
  OtpChallengeStore,
  OtpIssueOutcome,
  TransactionalMail,
  TransactionalMailOutbound,
} from '../ports';
import { FixedClock } from '../testing/fixed-clock';
import { SequentialIdGenerator } from '../testing/id-generators';

// --- Fakes -----------------------------------------------------------------

const EMAIL = 'user@example.com',
  NOW = 1_700_000_000_000,
  SECRET = 'test-secret';

/** In-memory OtpChallengeStore fake — ghi lại issue call, mô phỏng outcome. */
class FakeOtpStore implements OtpChallengeStore {
  public issued: Parameters<OtpChallengeStore['issueWithinProtocol']>[0][] = [];
  public outcome: OtpIssueOutcome;

  public constructor(outcome: OtpIssueOutcome) {
    this.outcome = outcome;
  }

  public async issueWithinProtocol(
    input: Parameters<OtpChallengeStore['issueWithinProtocol']>[0],
  ): Promise<OtpIssueOutcome> {
    this.issued.push(input);
    return this.outcome;
  }

  // Không dùng trong use case này.
  public async findActive(): Promise<OtpChallengeSnapshot | undefined> {
    return undefined;
  }
  public async expireIfExpired(): Promise<boolean> {
    return false;
  }
  public async consume(): Promise<boolean> {
    return false;
  }
  public async recordFailedAttemptAndLock(): Promise<OtpChallengeSnapshot | undefined> {
    return undefined;
  }
}

class FakeInvitationStore implements InvitationStore {
  public openByAddress = new Map<EmailAddressKey, InvitationSnapshot[]>();

  public async findOpenByAddressKey(
    addressKey: EmailAddressKey,
  ): Promise<readonly InvitationSnapshot[]> {
    return this.openByAddress.get(addressKey) ?? [];
  }
  public async consumeOpenWithinTx(): Promise<boolean> {
    return false;
  }
  public async insertOpen(): Promise<boolean> {
    return true;
  }
  public async revoke(): Promise<boolean> {
    return false;
  }
  public async expireIfExpired(): Promise<boolean> {
    return false;
  }
  public async findById(): Promise<InvitationSnapshot | undefined> {
    return undefined;
  }
}

class FakeAccountStore implements AccountStore {
  public verified = new Map<EmailAddressKey, { subject: Subject; snapshot: AccountSnapshot }>();

  public async findByVerifiedAddressKey(
    addressKey: string,
  ): Promise<{ subject: Subject; snapshot: AccountSnapshot } | undefined> {
    return this.verified.get(addressKey as EmailAddressKey);
  }
  public async insertWithinAcceptanceTx(): Promise<boolean> {
    return true;
  }
  public async findById(): Promise<AccountSnapshot | undefined> {
    return undefined;
  }
  public async save(): Promise<void> {
    // No-op: use case này không mutate account.
  }
}

class FakeMail implements TransactionalMailOutbound {
  public sent: { mail: TransactionalMail; key: MailIdempotencyKey }[] = [];
  public failNext = false;

  public async send(mail: TransactionalMail, idempotencyKey: MailIdempotencyKey): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('mail transport down');
    }
    this.sent.push({ key: idempotencyKey, mail });
  }
}

function makeCrypto(): CryptoDigestPort {
  return {
    hmacSha256Hex: vi.fn<(key: string, value: string) => Promise<string>>(
      async (key, value) => `hmac(${key}:${value})`,
    ),
    randomDigits: vi.fn<() => string>(() => '12345678'),
    timingSafeEqualHex: (a: string, b: string) => a === b,
  };
}

function makeDeps(
  overrides: {
    otp?: FakeOtpStore;
    invitations?: FakeInvitationStore;
    accounts?: FakeAccountStore;
    mail?: FakeMail;
  } = {},
) {
  const otp = overrides.otp ?? new FakeOtpStore({ issued: true, snapshot: makeSnapshot() }),
    invitations = overrides.invitations ?? new FakeInvitationStore(),
    accounts = overrides.accounts ?? new FakeAccountStore(),
    mail = overrides.mail ?? new FakeMail(),
    clock: Clock = new FixedClock(NOW),
    ids: IdGenerator = new SequentialIdGenerator(),
    crypto = makeCrypto(),
    useCase = new RequestOtpChallengeUseCase({
      accounts,
      clock,
      crypto,
      ids,
      invitations,
      mail,
      otp,
      otpSecret: SECRET,
    });
  return { accounts, clock, crypto, ids, invitations, mail, otp, useCase };
}

function makeSnapshot(): OtpChallengeSnapshot {
  return {
    addressKey: '0'.repeat(64) as EmailAddressKey,
    attempts: 0,
    digest: 'a'.repeat(64) as OtpChallengeSnapshot['digest'],
    expiresAt: NOW + OTP_TTL_SECONDS * 1000,
    id: 'ch-1' as OtpChallengeSnapshot['id'],
    purpose: 'login',
    terminal: false,
    terminalReason: null,
  };
}

function addressKeyOf(email: string): Promise<EmailAddressKey> {
  return hashAddressKey(normalizeEmailAddress(email));
}

// --- Tests -----------------------------------------------------------------

describe('RequestOtpChallengeUseCase', () => {
  it('issues challenge with domain constants and sends mail for verified address', async () => {
    expect.hasAssertions();
    const key = await addressKeyOf(EMAIL),
      { accounts, otp, mail, useCase, crypto } = makeDeps();
    // Địa chỉ verified — mail thật.
    accounts.verified.set(key, [] as never);

    const result = await useCase.execute({ email: EMAIL, purpose: 'login' });

    expect(result).toStrictEqual({ status: 'accepted' });
    expect(otp.issued).toHaveLength(1);
    const issue =
      otp.issued[0] ??
      ((): never => {
        throw new Error('missing issue');
      })();
    expect(issue.addressKey).toBe(key);
    expect(issue.ttlSeconds).toBe(OTP_TTL_SECONDS);
    expect(issue.purpose).toBe('login');
    expect(crypto.randomDigits).toHaveBeenCalledWith(8);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.mail.to).toBe(normalizeEmailAddress(EMAIL));
    expect(mail.sent[0]?.mail.payload['code']).toBe('12345678');
  });

  it('derives mail idempotency key from challenge id, not digest', async () => {
    expect.hasAssertions();
    const key = await addressKeyOf(EMAIL),
      snapshot = makeSnapshot(),
      { accounts, mail, useCase } = makeDeps({
        otp: new FakeOtpStore({ issued: true, snapshot }),
      });
    accounts.verified.set(key, [] as never);

    await useCase.execute({ email: EMAIL, purpose: 'login' });

    expect(mail.sent[0]?.key).toBe(`otp:${snapshot.id}`);
  });

  it('rejects blocked branches with the same silently_rejected shape (anti-enumeration)', async () => {
    expect.hasAssertions();
    const key = await addressKeyOf(EMAIL),
      blockedOutcomes: OtpIssueOutcome[] = [
        { rejected: 'race_lost' },
        { rejected: 'cooldown' },
        { rejected: 'rate_limited' },
      ],
      // Each branch uses fresh deps, so the calls are independent.
      attempts = await Promise.all(
        blockedOutcomes.map(async (outcome) => {
          const { accounts, mail, useCase } = makeDeps({ otp: new FakeOtpStore(outcome) });
          accounts.verified.set(key, [] as never);
          return { mail, result: await useCase.execute({ email: EMAIL, purpose: 'login' }) };
        }),
      );
    for (const { mail, result } of attempts) {
      expect(result).toStrictEqual({ status: 'silently_rejected' });
      expect(mail.sent).toHaveLength(0);
    }
  });

  it('issues ghost challenge for unknown address without sending mail', async () => {
    expect.hasAssertions();
    // Không verified, không invitation — challenge vẫn ghi (rate-limit địa chỉ lạ).
    const { otp, mail, useCase, crypto } = makeDeps(),
      result = await useCase.execute({ email: EMAIL, purpose: 'login' });

    expect(result).toStrictEqual({ status: 'silently_rejected' });
    expect(otp.issued).toHaveLength(1);
    // Mã sinh thật cả cho challenge ma — không nhánh bỏ qua crypto.
    expect(crypto.randomDigits).toHaveBeenCalledWith(OTP_CODE_DIGITS);
    expect(mail.sent).toHaveLength(0);
  });

  it('sends mail on the invitation channel for open invitation without verified email', async () => {
    expect.hasAssertions();
    const key = await addressKeyOf(EMAIL),
      invitations = new FakeInvitationStore();
    invitations.openByAddress.set(key, [{} as InvitationSnapshot]);
    const { accounts, mail, useCase } = makeDeps({ invitations });
    accounts.verified.delete(key);

    const result = await useCase.execute({ email: EMAIL, purpose: 'login' });

    expect(result).toStrictEqual({ status: 'accepted' });
    expect(mail.sent).toHaveLength(1);
  });

  it('swallows mail transport failure — outcome unchanged', async () => {
    expect.hasAssertions();
    const key = await addressKeyOf(EMAIL),
      mail = new FakeMail();
    mail.failNext = true;
    const { accounts, useCase } = makeDeps({ mail });
    accounts.verified.set(key, [] as never);

    const result = await useCase.execute({ email: EMAIL, purpose: 'login' });

    expect(result).toStrictEqual({ status: 'accepted' });
  });

  it('rejects malformed email shape with TypeError at trust boundary', async () => {
    expect.hasAssertions();
    const { useCase } = makeDeps(),
      badEmails = ['ab@', `${'a'.repeat(255)}@x`, 'no-at-sign'];
    // Each call rejects at validation, so the calls are independent.
    await Promise.all(
      badEmails.map((bad) =>
        expect(useCase.execute({ email: bad, purpose: 'login' })).rejects.toThrow(TypeError),
      ),
    );
  });

  it('throws TypeError when otpSecret is empty (programmer error)', () => {
    expect.hasAssertions();
    const clock: Clock = new FixedClock(NOW);
    expect(
      () =>
        new RequestOtpChallengeUseCase({
          accounts: new FakeAccountStore(),
          clock,
          crypto: makeCrypto(),
          ids: new SequentialIdGenerator(),
          invitations: new FakeInvitationStore(),
          mail: new FakeMail(),
          otp: new FakeOtpStore({ issued: true, snapshot: makeSnapshot() }),
          otpSecret: '',
        }),
    ).toThrow(TypeError);
  });

  it('passes purpose into digest material', async () => {
    expect.hasAssertions();
    const key = await addressKeyOf(EMAIL),
      { accounts, crypto, useCase } = makeDeps();
    accounts.verified.set(key, [] as never);

    await useCase.execute({ email: EMAIL, purpose: 'verify_email' });

    expect(crypto.hmacSha256Hex).toHaveBeenCalledWith(SECRET, 'verify_email:12345678');
  });
});
