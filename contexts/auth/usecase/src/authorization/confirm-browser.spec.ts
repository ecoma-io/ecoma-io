import { ConfirmBrowserUseCase } from './confirm-browser';
import type {
  AuthorizationTransactionState,
  AuthorizationTransactionStore,
  HandleHash,
  HandleService,
  TransactionId,
} from '../ports';

const TRANSACTION_ID = 'a'.repeat(43);

function makeUseCase(
  overrides: {
    transactions?: Partial<AuthorizationTransactionStore>;
    handles?: Partial<HandleService>;
  } = {},
) {
  const transactions: AuthorizationTransactionStore = {
      findByHandleHashX: vi.fn<(handleHashX: string) => Promise<TransactionId | undefined>>(
        async (handleHashX) => (handleHashX === 'hash(hX)' ? (TRANSACTION_ID as never) : undefined),
      ),
      findState: vi.fn<
        () => Promise<
          | {
              state: 'pending_browser';
              expiresAt: Date;
              consumedAt: null;
              browserBindingHash: unknown;
            }
          | undefined
        >
      >(async () => ({
        browserBindingHash: 'hash(binding)' as never,
        consumedAt: null,
        expiresAt: new Date('2026-01-01T00:10:00Z'),
        state: 'pending_browser',
      })),
      transition: vi.fn<() => Promise<'won' | 'lost'>>(async () => 'won'),
      ...overrides.transactions,
    } as unknown as AuthorizationTransactionStore,
    handles: HandleService = {
      browserBindingMatches: vi.fn<(presented: string, stored: string) => Promise<boolean>>(
        // Mock so hash(presented cookie) với stored hash — như HandleService thật.
        async (presented, stored) => `hash(${presented})` === stored,
      ),
      deriveHandle: vi.fn<() => Promise<never>>(() => 'hX' as never),
      hashEquals: vi.fn<(a: string, b: string) => boolean>((a, b) => a === b),
      hashHandle: vi.fn<(handle: string) => Promise<never>>((handle) => `hash(${handle})` as never),
      ...overrides.handles,
    };
  return {
    handles,
    transactions,
    useCase: new ConfirmBrowserUseCase({ handles, transactions }),
  };
}

describe('ConfirmBrowserUseCase', () => {
  it('transitions pending_browser to browser_confirmed on the happy path', async () => {
    expect.hasAssertions();
    const { useCase, transactions } = makeUseCase(),
      output = await useCase.execute({ browserCookie: 'binding', handleX: 'hX' });

    expect(output.transactionId).toBe(TRANSACTION_ID);
    expect(transactions.transition).toHaveBeenCalledWith({
      fromState: 'pending_browser',
      toState: 'browser_confirmed',
      transactionId: TRANSACTION_ID,
    });
  });

  it('rejects an unknown handle with a non-redirectable invalid_grant', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase();

    await expect(
      useCase.execute({ browserCookie: 'binding', handleX: 'unknown' }),
    ).rejects.toMatchObject({ code: 'invalid_grant', redirectable: false });
  });

  it('rejects a mismatched browser binding', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase();

    await expect(
      useCase.execute({ browserCookie: 'wrong-cookie', handleX: 'hX' }),
    ).rejects.toMatchObject({ code: 'invalid_grant', redirectable: false });
  });

  it('is idempotent when the same browser reloads an already-confirmed transaction', async () => {
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
            state: 'browser_confirmed' as const,
          })),
        },
      }),
      output = await useCase.execute({ browserCookie: 'binding', handleX: 'hX' });

    expect(output.transactionId).toBeDefined();
  });

  it('rejects a transaction in a terminal state', async () => {
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
          state: 'completed' as const,
        })),
      },
    });

    await expect(
      useCase.execute({ browserCookie: 'binding', handleX: 'hX' }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('rejects on CAS loss (expired or concurrently consumed)', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase({
      transactions: { transition: vi.fn<() => Promise<'won' | 'lost'>>(async () => 'lost') },
    });

    await expect(
      useCase.execute({ browserCookie: 'binding', handleX: 'hX' }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });
});
