import {
  ACR,
  Account,
  BrowserSession,
  OTP_TTL_SECONDS,
  hashAddressKey,
  normalizeEmailAddress,
} from '@ecoma-io/account-domain';
import type {
  EmailAddressKey,
  InvitationId,
  OtpChallengeId,
  OtpChallengeSnapshot,
  OtpDigest,
  SessionRef,
  Subject,
} from '@ecoma-io/account-domain';

import { VerifyOtpLoginUseCase } from './verify-otp-login';
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
import { FixedClock } from '../testing/fixed-clock';
import { SequentialIdGenerator } from '../testing/id-generators';

// --- Fakes -----------------------------------------------------------------

const CODE = '12345678',
  EMAIL = 'user@example.com',
  NOW = 1_700_000_000_000,
  SECRET = 'test-secret',
  SUBJECT = `sub_${'a'.repeat(32)}` as Subject,
  // Hash thật (async WebCrypto) — trước khi tests chạy.
  ADDRESS_KEY: EmailAddressKey = await hashAddressKey(normalizeEmailAddress(EMAIL));

/** In-memory OtpChallengeStore fake — CAS theo snapshot. */
class FakeOtpStore implements OtpChallengeStore {
  public rows = new Map<OtpChallengeId, OtpChallengeSnapshot>();
  /** Consume chỉ thắng lần đầu (CAS) — false nếu cấu hình trúng lần tiếp. */
  #consumeLost = false;
  #unitOfWork: FakeUnitOfWork | undefined;

  /** Wire UnitOfWork giả để consume trong tx đăng ký undo (rollback thật). */
  public withUnitOfWork(unitOfWork: FakeUnitOfWork): this {
    this.#unitOfWork = unitOfWork;
    return this;
  }

  public seed(snapshot: OtpChallengeSnapshot): void {
    this.rows.set(snapshot.id, snapshot);
  }

  public issueWithinProtocol(): Promise<{ issued: true; snapshot: OtpChallengeSnapshot }> {
    throw new Error('not used in VerifyOtpLogin tests');
  }

  public async findActive(
    addressKey: EmailAddressKey,
    purpose: OtpChallengeSnapshot['purpose'],
    _now: number,
  ): Promise<OtpChallengeSnapshot | undefined> {
    // Khớp legacy `findActiveChallenge`: trả hàng chưa consumed bất kể TTL —
    // Expiry là outcome của phép kiểm của use case (CAS expire riêng), không
    // Phải filter của findActive.
    for (const row of this.rows.values()) {
      if (row.addressKey === addressKey && row.purpose === purpose && !row.terminal) {
        return row;
      }
    }
    return undefined;
  }

  public async expireIfExpired(id: OtpChallengeId, now: number): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || row.terminal || now < row.expiresAt) {
      return false;
    }
    this.rows.set(id, { ...row, terminal: true, terminalReason: 'expired' });
    return true;
  }

  public async consume(
    id: OtpChallengeId,
    _now: number,
    _tx?: TransactionHandle,
  ): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || row.terminal || this.#consumeLost) {
      return false;
    }
    this.rows.set(id, { ...row, terminal: true, terminalReason: 'verified_ok' });
    if (this.#unitOfWork !== undefined) {
      this.#unitOfWork.track(() => this.rows.set(id, row));
    }
    return true;
  }

  public async recordFailedAttemptAndLock(
    id: OtpChallengeId,
    _now: number,
  ): Promise<OtpChallengeSnapshot | undefined> {
    const row = this.rows.get(id);
    if (row === undefined) {
      return undefined;
    }
    const attempts = row.attempts + 1,
      updated: OtpChallengeSnapshot = {
        ...row,
        attempts,
        terminal: attempts >= 5,
        terminalReason: attempts >= 5 ? 'attempt_cap' : null,
      };
    this.rows.set(id, updated);
    return updated;
  }

  /** Test helper — lần consume tiếp theo thua CAS (mô phỏng request trùng). */
  public loseNextConsume(): void {
    this.#consumeLost = true;
  }
}

class FakeInvitationStore implements InvitationStore {
  public rows = new Map<string, InvitationSnapshotForTest>();
  #unitOfWork: FakeUnitOfWork | undefined;

  public withUnitOfWork(unitOfWork: FakeUnitOfWork): this {
    this.#unitOfWork = unitOfWork;
    return this;
  }

  public seed(snapshot: InvitationSnapshotForTest): void {
    this.rows.set(snapshot.id, snapshot);
  }

  public async findOpenByAddressKey(addressKey: EmailAddressKey) {
    return [...this.rows.values()].filter(
      (row) => row.addressKey === addressKey && row.state === 'open',
    );
  }

  public async consumeOpenWithinTx(input: { id: string; now: number }): Promise<boolean> {
    const row = this.rows.get(input.id);
    if (row === undefined || row.state !== 'open' || row.expiresAt <= input.now) {
      return false;
    }
    this.rows.set(input.id, { ...row, state: 'accepted' });
    this.#unitOfWork?.track(() => this.rows.set(input.id, row));
    return true;
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
  public async findById(): Promise<InvitationSnapshotForTest | undefined> {
    return undefined;
  }
}
interface InvitationSnapshotForTest {
  id: InvitationId;
  addressKey: EmailAddressKey;
  state: 'open' | 'accepted' | 'revoked' | 'expired';
  issuedAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  acceptedSubject: Subject | null;
}

class FakeAccountStore implements Partial<AccountStore> {
  public rows = new Map<Subject, AccountSnapshotForTest>();
  #unitOfWork: FakeUnitOfWork | undefined;

  public withUnitOfWork(unitOfWork: FakeUnitOfWork): this {
    this.#unitOfWork = unitOfWork;
    return this;
  }

  public seed(account: Account): void {
    this.rows.set(account.id, account.snapshot());
  }

  public async findByVerifiedAddressKey(addressKey: string) {
    for (const snapshot of this.rows.values()) {
      if (snapshot.status !== 'active') {
        continue;
      }
      if (snapshot.emails.some((e) => e.key === addressKey && e.state === 'verified')) {
        return { snapshot, subject: snapshot.subject };
      }
    }
    return undefined;
  }

  public async insertWithinAcceptanceTx(snapshot: AccountSnapshotForTest): Promise<boolean> {
    if (this.rows.has(snapshot.subject)) {
      return false;
    }
    this.rows.set(snapshot.subject, snapshot);
    this.#unitOfWork?.track(() => this.rows.delete(snapshot.subject));
    return true;
  }
  public async findById(subject: Subject) {
    return this.rows.get(subject);
  }
  public async save(): Promise<void> {
    // Persist sau mutation — không dùng trong các test hiện tại.
  }
}
type AccountSnapshotForTest = ReturnType<Account['snapshot']>;

class FakeSessionStore implements Partial<BrowserSessionStore> {
  public rows = new Map<SessionRef, ReturnType<BrowserSession['snapshot']>>();
  public rotateRejected = false;
  #unitOfWork: FakeUnitOfWork | undefined;

  public withUnitOfWork(unitOfWork: FakeUnitOfWork): this {
    this.#unitOfWork = unitOfWork;
    return this;
  }

  public async insertWithinTx(input: {
    subject: Subject;
    snapshot: ReturnType<BrowserSession['snapshot']>;
  }): Promise<boolean> {
    if (this.rows.has(input.snapshot.sessionRef)) {
      return false;
    }
    this.rows.set(input.snapshot.sessionRef, input.snapshot);
    this.#unitOfWork?.track(() => this.rows.delete(input.snapshot.sessionRef));
    return true;
  }
  public async findOwnerByRef(): Promise<Subject | undefined> {
    return SUBJECT;
  }
  public async findById(sessionRef: SessionRef) {
    return this.rows.get(sessionRef);
  }
  public async save(snapshot: ReturnType<BrowserSession['snapshot']>): Promise<void> {
    this.rows.set(snapshot.sessionRef, snapshot);
  }
  public async revokeOne(sessionRef: SessionRef, now: number): Promise<boolean> {
    const row = this.rows.get(sessionRef);
    if (row === undefined || row.revokedAt !== null) {
      return false;
    }
    this.rows.set(sessionRef, { ...row, revokedAt: now, state: 'revoked' });
    this.#unitOfWork?.track(() => this.rows.set(sessionRef, row));
    return true;
  }

  public rotateWithinTx(): Promise<boolean> {
    throw new Error('not used in VerifyOtpLogin tests');
  }
  public async listLiveBySubject(): Promise<readonly ReturnType<BrowserSession['snapshot']>[]> {
    return [];
  }
  public async revokeAllBySubject(): Promise<number> {
    return 0;
  }
}

class FakeHandoffStore implements LoginHandoffStore {
  public carried: { fromSessionRef: SessionRef; toSessionRef: SessionRef }[] = [];

  public async bindFirst(): Promise<{ won: true } | { won: false; winnerSessionRef: SessionRef }> {
    throw new Error('not used in VerifyOtpLogin tests');
  }
  public async findById(): Promise<undefined> {
    return undefined;
  }
  public async rotateToWithinTx(): Promise<boolean> {
    return false;
  }
  public async consume(): Promise<boolean> {
    return false;
  }
  public async carryBindingWithinTx(input: {
    fromSessionRef: SessionRef;
    toSessionRef: SessionRef;
  }): Promise<boolean> {
    this.carried.push({ fromSessionRef: input.fromSessionRef, toSessionRef: input.toSessionRef });
    return true;
  }
}

/** UnitOfWork giả — rollback thật: hoàn tác mutations ghi trong tx. */
class FakeUnitOfWork implements UnitOfWork {
  #rolledBack = 0;
  /** Undo callbacks do Fake stores đăng ký khi ghi trong tx. */
  #undoStack: (() => void)[] = [];

  public get rollbackCount(): number {
    return this.#rolledBack;
  }

  /** Fake store gọi khi mutation trong tx — đăng ký undo. */
  public track(undo: () => void): void {
    this.#undoStack.push(undo);
  }

  public async run<T>(work: (tx: TransactionHandle) => Promise<T>): Promise<T> {
    const tx = `tx-${this.#rolledBack + 1}` as TransactionHandle,
      startDepth = this.#undoStack.length;
    try {
      return await work(tx);
    } catch (error) {
      // Rollback: hoàn tác ngược thứ tự các mutation trong tx này.
      while (this.#undoStack.length > startDepth) {
        this.#undoStack.pop()?.();
      }
      this.#rolledBack += 1;
      throw error;
    }
  }
}

function makeCrypto(digestOf: (value: string) => string): CryptoDigestPort {
  return {
    hmacSha256Hex: vi.fn<(_key: string, value: string) => Promise<string>>(async (_key, value) =>
      digestOf(value),
    ),
    randomDigits: vi.fn<() => string>(() => CODE),
    timingSafeEqualHex: (a: string, b: string) => a === b,
  };
}

/** Digest tất định cho test: `hmac(value)` — mã đúng CODE sẽ ra digest CODE. */
const digestOf = (value: string) => `hmac(${value})`;

function makeDeps(
  overrides: {
    otp?: FakeOtpStore;
    invitations?: FakeInvitationStore;
    accounts?: FakeAccountStore;
    sessions?: FakeSessionStore;
    unitOfWork?: FakeUnitOfWork;
    ids?: IdGenerator;
  } = {},
) {
  const unitOfWork = overrides.unitOfWork ?? new FakeUnitOfWork(),
    otp = overrides.otp ?? new FakeOtpStore();
  otp.withUnitOfWork(unitOfWork);
  const invitations = overrides.invitations ?? new FakeInvitationStore();
  invitations.withUnitOfWork(unitOfWork);
  const accounts = overrides.accounts ?? new FakeAccountStore();
  accounts.withUnitOfWork(unitOfWork);
  const sessions = overrides.sessions ?? new FakeSessionStore();
  sessions.withUnitOfWork(unitOfWork);
  const handoffs = new FakeHandoffStore(),
    clock: Clock = new FixedClock(NOW),
    ids: IdGenerator = overrides.ids ?? new SequentialIdGenerator(),
    crypto = makeCrypto(digestOf),
    useCase = new VerifyOtpLoginUseCase({
      accounts,
      clock,
      crypto,
      handoffs,
      ids,
      invitations,
      otp,
      otpSecret: SECRET,
      sessions,
      unitOfWork,
    });
  return {
    accounts,
    clock,
    crypto,
    handoffs,
    ids,
    invitations,
    otp,
    sessions,
    unitOfWork,
    useCase,
  };
}

function seedChallenge(otp: FakeOtpStore, addressKey: EmailAddressKey): OtpChallengeSnapshot {
  const snapshot: OtpChallengeSnapshot = {
    addressKey,
    attempts: 0,
    digest: digestOf(`login:${CODE}`) as OtpDigest,
    expiresAt: NOW + OTP_TTL_SECONDS * 1000,
    id: 'ch-1' as OtpChallengeId,
    purpose: 'login',
    terminal: false,
    terminalReason: null,
  };
  otp.seed(snapshot);
  return snapshot;
}

function seedAccount(accounts: FakeAccountStore, addressKey: EmailAddressKey): Account {
  const account = Account.provisionFromInvitation({
    emailKey: addressKey,
    now: NOW - 3_600_000,
    subject: SUBJECT,
  });
  accounts.seed(account);
  return account;
}

function seedOpenInvitation(
  invitations: FakeInvitationStore,
  addressKey: EmailAddressKey,
): InvitationSnapshotForTest {
  const snapshot: InvitationSnapshotForTest = {
    acceptedAt: null,
    acceptedSubject: null,
    addressKey,
    expiresAt: NOW + 6 * 86_400_000,
    id: 'inv-1' as InvitationId,
    issuedAt: NOW - 86_400_000,
    state: 'open',
  };
  invitations.seed(snapshot);
  return snapshot;
}

// --- Tests -----------------------------------------------------------------

describe('VerifyOtpLoginUseCase', () => {
  it('logs in verified address: consumes challenge and issues authenticated session', async () => {
    expect.hasAssertions();
    const { otp, accounts, sessions, useCase } = makeDeps();
    seedChallenge(otp, ADDRESS_KEY);
    seedAccount(accounts, ADDRESS_KEY);

    const result = await useCase.execute({ code: CODE, email: EMAIL });

    expect(result.kind).toBe('logged_in');
    const loggedIn = result.kind === 'logged_in' ? result : undefined;
    expect(loggedIn?.subject).toBe(SUBJECT);
    expect(loggedIn?.session.snapshot.acr).toBe(ACR.EmailOtp);
    expect(loggedIn?.session.snapshot.state).toBe('authenticated');
    expect(sessions.rows.has(loggedIn?.session.sessionRef as SessionRef)).toBe(true);
    expect(otp.rows.get('ch-1' as OtpChallengeId)?.terminalReason).toBe('verified_ok');
  });

  it('rejects with one opaque branch for every failure shape (anti-guessing)', async () => {
    expect.hasAssertions();
    // Không có challenge / challenge hết hạn / mã sai — cùng `rejected`.
    const shapes: ((deps: ReturnType<typeof makeDeps>) => Promise<unknown>)[] = [
        ({ useCase }) => useCase.execute({ code: CODE, email: EMAIL }), // No challenge
        (deps) => {
          seedChallenge(deps.otp, ADDRESS_KEY);
          (deps.clock as FixedClock).advance((OTP_TTL_SECONDS + 60) * 1000);
          return deps.useCase.execute({ code: CODE, email: EMAIL });
        },
        (deps) => {
          seedChallenge(deps.otp, ADDRESS_KEY);
          return deps.useCase.execute({ code: '00000000', email: EMAIL });
        },
      ],
      // Each shape uses fresh deps, so the calls are independent.
      results = (await Promise.all(shapes.map((shape) => shape(makeDeps())))) as {
        kind: string;
      }[];
    for (const result of results) {
      expect(result.kind).toBe('rejected');
    }
  });

  it('marks expired challenge terminal via CAS before rejecting', async () => {
    expect.hasAssertions();
    // Seed the challenge with an expiresAt in the past to exercise the real expire CAS.
    const expiredOtp = new FakeOtpStore(),
      deps = makeDeps({ otp: expiredOtp }),
      snapshot = seedChallenge(expiredOtp, ADDRESS_KEY);
    expiredOtp.rows.set(snapshot.id, { ...snapshot, expiresAt: NOW - 1000 });
    const rejected = await deps.useCase.execute({ code: CODE, email: EMAIL });
    expect(rejected.kind).toBe('rejected');
    expect(expiredOtp.rows.get(snapshot.id)?.terminalReason).toBe('expired');
  });

  it('records failed attempt on code mismatch', async () => {
    expect.hasAssertions();
    const { otp, useCase } = makeDeps();
    seedChallenge(otp, ADDRESS_KEY);

    const result = await useCase.execute({ code: '00000000', email: EMAIL });

    expect(result.kind).toBe('rejected');
    expect(otp.rows.get('ch-1' as OtpChallengeId)?.attempts).toBe(1);
  });

  it('loses consume CAS to a duplicate request and rejects without session', async () => {
    expect.hasAssertions();
    const { otp, accounts, sessions, useCase } = makeDeps();
    seedChallenge(otp, ADDRESS_KEY);
    seedAccount(accounts, ADDRESS_KEY);
    otp.loseNextConsume();

    const result = await useCase.execute({ code: CODE, email: EMAIL });

    expect(result.kind).toBe('rejected');
    expect(sessions.rows.size).toBe(0);
  });

  it('revokes only the anonymous present session during rotation (FR-004a)', async () => {
    expect.hasAssertions();
    const { otp, accounts, sessions, useCase } = makeDeps();
    seedChallenge(otp, ADDRESS_KEY);
    seedAccount(accounts, ADDRESS_KEY);
    const anon = BrowserSession.startAnonymous({
      now: NOW - 60_000,
      sessionRef: 'sess-anon' as SessionRef,
    });
    sessions.rows.set(anon.sessionRef(), anon.snapshot());
    const otherAuth = BrowserSession.startAnonymous({
      now: NOW - 60_000,
      sessionRef: 'sess-other' as SessionRef,
    });
    sessions.rows.set(otherAuth.sessionRef(), otherAuth.snapshot());

    await useCase.execute({
      code: CODE,
      email: EMAIL,
      presentSessionRef: 'sess-anon' as SessionRef,
    });

    expect(sessions.rows.get('sess-anon' as SessionRef)?.revokedAt).not.toBeNull();
    // Phiên authenticated của account khác không bao giờ bị đụng tới.
    expect(sessions.rows.get('sess-other' as SessionRef)?.revokedAt).toBeNull();
  });

  it('accepts invitation in one transaction: challenge, invitation, account, session', async () => {
    expect.hasAssertions();
    const { otp, invitations, accounts, sessions, useCase } = makeDeps();
    seedChallenge(otp, ADDRESS_KEY);
    seedOpenInvitation(invitations, ADDRESS_KEY);

    const result = await useCase.execute({ code: CODE, email: EMAIL });

    expect(result.kind).toBe('invitation_accepted');
    const accepted = result.kind === 'invitation_accepted' ? result : undefined;
    expect(accepted?.subject).toMatch(/^sub_[a-z0-9]{32}$/u);
    expect(accepted?.session.snapshot.acr).toBe(ACR.EmailOtp);
    expect(sessions.rows.has(accepted?.session.sessionRef as SessionRef)).toBe(true);
    const account = await accounts.findByVerifiedAddressKey(ADDRESS_KEY);
    expect(account).toBeDefined();
    expect(invitations.rows.get('inv-1')?.state).toBe('accepted');
    expect(otp.rows.get('ch-1' as OtpChallengeId)?.terminalReason).toBe('verified_ok');
  });

  it('rolls back the whole acceptance when invitation CAS loses (challenge unconsumed)', async () => {
    expect.hasAssertions();
    const { otp, invitations, accounts, sessions, useCase, unitOfWork } = makeDeps();
    seedChallenge(otp, ADDRESS_KEY);
    const invitation = seedOpenInvitation(invitations, ADDRESS_KEY);
    // Invitation hết hạn tại thời điểm verify — CAS consume thua sau khi
    // Challenge đã consume trong tx ⇒ toàn bộ phải rollback.
    invitations.rows.set(invitation.id, { ...invitation, expiresAt: NOW - 1 });

    const result = await useCase.execute({ code: CODE, email: EMAIL });

    expect(result.kind).toBe('rejected');
    expect(unitOfWork.rollbackCount).toBe(1);
    // Challenge vẫn còn (consume bị rollback) — không nửa vời nào.
    expect(otp.rows.get('ch-1' as OtpChallengeId)?.terminal).toBeFalsy();
    expect(accounts.rows.size).toBe(0);
    expect(sessions.rows.size).toBe(0);
  });

  it('rejects invitation branch when no open invitation exists', async () => {
    expect.hasAssertions();
    const { otp, useCase } = makeDeps();
    seedChallenge(otp, ADDRESS_KEY);
    // Không account, không invitation — địa chỉ lạ.

    const result = await useCase.execute({ code: CODE, email: EMAIL });

    expect(result.kind).toBe('rejected');
  });

  it('throws TypeError for malformed email or code at trust boundary', async () => {
    expect.hasAssertions();
    const { useCase } = makeDeps();
    await expect(useCase.execute({ code: CODE, email: 'bad' })).rejects.toThrow(TypeError);
    await expect(useCase.execute({ code: '12345', email: EMAIL })).rejects.toThrow(TypeError);
    await expect(useCase.execute({ code: '123456789', email: EMAIL })).rejects.toThrow(TypeError);
  });

  it('throws TypeError when otpSecret is empty (programmer error)', () => {
    expect.hasAssertions();
    const clock: Clock = new FixedClock(NOW);
    expect(
      () =>
        new VerifyOtpLoginUseCase({
          accounts: new FakeAccountStore(),
          clock,
          crypto: makeCrypto(digestOf),
          handoffs: new FakeHandoffStore(),
          ids: new SequentialIdGenerator(),
          invitations: new FakeInvitationStore(),
          otp: new FakeOtpStore(),
          otpSecret: '',
          sessions: new FakeSessionStore(),
          unitOfWork: new FakeUnitOfWork(),
        }),
    ).toThrow(TypeError);
  });

  it('rolls back acceptance when account insert loses (subject collision)', async () => {
    expect.hasAssertions();
    // Subject trùng nhưng địa chỉ khác — tìm verified miss ⇒ invitation branch;
    // Insert account thua sau consume challenge + invitation ⇒ rollback toàn bộ.
    const otherKey = (await hashAddressKey(
        normalizeEmailAddress('other@example.com'),
      )) as EmailAddressKey,
      accounts = new FakeAccountStore();
    accounts.seed(
      Account.provisionFromInvitation({ emailKey: otherKey, now: NOW, subject: SUBJECT }),
    );
    // Ép subject sinh ra trùng với account đã có (entropy xác định).
    const fixedIds: IdGenerator = {
        newInvitationId: () => 'inv-x' as unknown as InvitationId,
        newOtpChallengeId: () => 'ch-x' as unknown as OtpChallengeId,
        newSessionRef: () => 'sess-x' as unknown as SessionRef,
        newSubjectEntropy: () => SUBJECT.slice('sub_'.length),
      },
      { otp, invitations, sessions, useCase, unitOfWork } = makeDeps({
        accounts,
        ids: fixedIds,
      });
    seedChallenge(otp, ADDRESS_KEY);
    seedOpenInvitation(invitations, ADDRESS_KEY);

    const result = await useCase.execute({ code: CODE, email: EMAIL });

    expect(result.kind).toBe('rejected');
    expect(unitOfWork.rollbackCount).toBe(1);
    expect(invitations.rows.get('inv-1')?.state).toBe('open');
    expect(sessions.rows.size).toBe(0);
  });

  it('fails closed with TypeError when session insert collides (entropy broken)', async () => {
    expect.hasAssertions();
    // Fake store từ chối INSERT phiên mới — TypeError programmer-error class.
    class RejectingSessions extends FakeSessionStore {
      public override async insertWithinTx(): Promise<boolean> {
        return false;
      }
    }
    const sessions = new RejectingSessions(),
      { otp, accounts, useCase } = makeDeps({ sessions });
    seedChallenge(otp, ADDRESS_KEY);
    seedAccount(accounts, ADDRESS_KEY);

    await expect(useCase.execute({ code: CODE, email: EMAIL })).rejects.toThrow(TypeError);
  });
});
