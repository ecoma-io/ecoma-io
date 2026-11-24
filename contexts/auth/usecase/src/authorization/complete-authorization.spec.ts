import { CompleteAuthorizationUseCase } from './complete-authorization';
import { mockRevocation } from '../testing/mock-ports';
import type {
  AccountStatusChecker,
  AuthorizationTransactionState,
  AuthorizationTransactionStore,
  Clock,
  HandleHash,
  HandleService,
  RevocationChecker,
} from '../ports';

const TRANSACTION_ID = 'a'.repeat(43),
  CLIENT_ID = 'client-1';

function makeUseCase(
  overrides: {
    transactions?: Partial<AuthorizationTransactionStore>;
    handles?: Partial<HandleService>;
    accountStatus?: Partial<AccountStatusChecker>;
    revocation?: Partial<RevocationChecker>;
  } = {},
) {
  const transactions: AuthorizationTransactionStore = {
      findState: vi.fn<
        () => Promise<
          | {
              state: AuthorizationTransactionState;
              expiresAt: Date;
              consumedAt: Date | null;
              browserBindingHash: HandleHash;
            }
          | undefined
        >
      >(async () => ({
        browserBindingHash: 'hash(binding)' as never,
        consumedAt: null,
        expiresAt: new Date('2026-01-01T00:10:00Z'),
        state: 'ready_to_complete' as const,
      })),
      findBoundIdentity: vi.fn<() => Promise<unknown>>(async () => ({
        accountSessionRef: 'asr-1',
        acr: 'urn:ecoma:acr:email-otp',
        authnAt: new Date('2026-01-01T00:00:00Z'),
        subject: 'sub-1' as never,
      })),
      // Client_state ghi lúc begin — output phản chiếu giá trị này, không đọc từ query.
      findPayload: vi.fn<() => Promise<unknown>>(async () => ({
        clientId: CLIENT_ID,
        clientState: 'xyz',
        codeChallenge: 'c'.repeat(43),
        keyVersion: 1,
        redirectUri: 'https://app.example.com/cb',
        scope: ['openid'],
      })),
      completeAndIssueAuthorizationCode: vi.fn<() => Promise<'won' | 'lost'>>(async () => 'won'),
      ...overrides.transactions,
    } as unknown as AuthorizationTransactionStore,
    handles: HandleService = {
      browserBindingMatches: vi.fn<(presented: string, stored: string) => Promise<boolean>>(
        async (_presented, stored) => stored === 'hash(binding)',
      ),
      deriveHandle: vi.fn<(input: { domain: string }) => Promise<never>>(
        ({ domain }) => `h-${domain}` as never,
      ),
      hashEquals: vi.fn<(a: string, b: string) => boolean>((a, b) => a === b),
      hashHandle: vi.fn<(handle: string) => Promise<never>>((handle) => `hash(${handle})` as never),
      ...overrides.handles,
    },
    accountStatus: AccountStatusChecker = {
      check: vi.fn<() => Promise<{ status: 'active' | 'suspended' | 'unknown' }>>(async () => ({
        status: 'active',
      })),
      ...overrides.accountStatus,
    },
    revocation: RevocationChecker = {
      ...mockRevocation(),
      ...overrides.revocation,
    },
    clock: Clock = { now: () => new Date('2026-01-01T00:00:00Z') };
  return {
    accountStatus,
    handles,
    revocation,
    transactions,
    useCase: new CompleteAuthorizationUseCase({
      accountStatus,
      clock,
      handles,
      revocation,
      transactions,
    }),
  };
}

const BASE_INPUT = {
  browserCookie: 'binding',
  clientId: CLIENT_ID as never,
  decision: 'approve',
  handleZ: 'h-authorization-code',
  transactionId: TRANSACTION_ID as never,
} as const;

describe('CompleteAuthorizationUseCase', () => {
  it('issues an authorization code atomically with the completed transition', async () => {
    expect.hasAssertions();
    const { useCase, transactions } = makeUseCase(),
      output = await useCase.execute({ ...BASE_INPUT });

    expect(output.authorizationCode).toBe('h-authorization-code');
    expect(transactions.completeAndIssueAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        codeExpiresAt: new Date('2026-01-01T00:01:00Z'),
        codeHash: 'hash(h-authorization-code)',
        toState: 'completed',
      }),
    );
  });

  it('reflects the client_state recorded at begin, not the query string', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase(),
      output = await useCase.execute({ ...BASE_INPUT });

    expect(output.redirectState).toBe('xyz');
  });

  it('rejects an unknown transaction with invalid_grant', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase({
      transactions: {
        findState: vi.fn<() => Promise<undefined>>(async () => {
          /* Empty */
        }),
      },
    });

    await expect(useCase.execute({ ...BASE_INPUT })).rejects.toMatchObject({
      code: 'invalid_grant',
    });
  });

  it('rejects a transaction that never passed browser confirmation', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase({
      transactions: {
        findState: vi.fn<
          () => Promise<
            | {
                state: AuthorizationTransactionState;
                expiresAt: Date;
                consumedAt: Date | null;
                browserBindingHash: HandleHash;
              }
            | undefined
          >
        >(async () => ({
          browserBindingHash: 'hash(binding)' as never,
          consumedAt: null,
          expiresAt: new Date(),
          state: 'pending_browser' as const,
        })),
      },
    });

    await expect(useCase.execute({ ...BASE_INPUT })).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  it('rejects a handle Z that does not belong to this transaction', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase({
      handles: {
        hashEquals: vi.fn<() => false>(() => false),
      },
    });

    await expect(useCase.execute({ ...BASE_INPUT })).rejects.toMatchObject({
      code: 'invalid_grant',
    });
  });

  it('rejects a mismatched browser binding', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase({
      handles: { browserBindingMatches: vi.fn<() => Promise<false>>(async () => false) },
    });

    await expect(useCase.execute({ ...BASE_INPUT })).rejects.toMatchObject({
      code: 'invalid_grant',
    });
  });

  it('fails closed when the account status is unknown', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase({
      accountStatus: {
        check: vi.fn<() => Promise<{ status: 'unknown' }>>(async () => ({ status: 'unknown' })),
      },
    });

    await expect(useCase.execute({ ...BASE_INPUT })).rejects.toMatchObject({
      code: 'access_denied',
    });
  });

  it('fails closed when the account is suspended', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase({
      accountStatus: {
        check: vi.fn<() => Promise<{ status: 'suspended' }>>(async () => ({ status: 'suspended' })),
      },
    });

    await expect(useCase.execute({ ...BASE_INPUT })).rejects.toMatchObject({
      code: 'access_denied',
    });
  });

  it('fails closed when the subject or client is revoked', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase({
      revocation: {
        checkAtIssuance: vi.fn<() => Promise<'revoked'>>(async () => 'revoked' as const),
      },
    });

    await expect(useCase.execute({ ...BASE_INPUT })).rejects.toMatchObject({
      code: 'access_denied',
    });
  });

  it('fails closed when the revocation check is unavailable', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase({
      revocation: {
        checkAtIssuance: vi.fn<() => Promise<'unavailable'>>(async () => 'unavailable' as const),
      },
    });

    await expect(useCase.execute({ ...BASE_INPUT })).rejects.toMatchObject({
      code: 'access_denied',
    });
  });

  it('completes as denied on the deny path without issuing a code', async () => {
    expect.hasAssertions();
    const { useCase, transactions } = makeUseCase();

    await expect(useCase.execute({ ...BASE_INPUT, decision: 'deny' })).rejects.toMatchObject({
      code: 'access_denied',
      redirectable: true,
    });

    expect(transactions.completeAndIssueAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({ toState: 'denied' }),
    );
  });

  it('maps CAS loss to invalid_grant on the approve path', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase({
      transactions: {
        completeAndIssueAuthorizationCode: vi.fn<() => Promise<'won' | 'lost'>>(async () => 'lost'),
      },
    });

    await expect(useCase.execute({ ...BASE_INPUT })).rejects.toMatchObject({
      code: 'invalid_grant',
    });
  });
});
