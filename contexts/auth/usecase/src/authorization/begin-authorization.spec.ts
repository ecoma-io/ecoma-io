import { OAuthProtocolError } from '@ecoma-io/auth-domain';

import { BeginAuthorizationUseCase } from './begin-authorization';
import type {
  AuthorizationTransactionStore,
  ClientStore,
  Clock,
  HandleService,
  IdGenerator,
} from '../ports';

// --- Mock ports ------------------------------------------------------------

const TRANSACTION_ID = 'a'.repeat(43),
  CLIENT_ID = 'client-1';

function makeHandles(overrides: Partial<HandleService> = {}): HandleService {
  // Handle giả lập: derive trả giá trị tất định theo domain, hash thêm prefix.
  return {
    browserBindingMatches: vi.fn<() => Promise<true>>(async () => true),
    deriveHandle: vi.fn<(input: { domain: string }) => Promise<never>>(
      ({ domain }) => `h-${domain}` as never,
    ),
    hashEquals: vi.fn<(a: string, b: string) => boolean>((a, b) => a === b),
    hashHandle: vi.fn<(handle: string) => Promise<never>>((handle) => `hash(${handle})` as never),
    ...overrides,
  };
}

function makeStores(
  overrides: {
    clients?: Partial<ClientStore>;
    transactions?: Partial<AuthorizationTransactionStore>;
  } = {},
): {
  clients: ClientStore;
  transactions: AuthorizationTransactionStore;
} {
  return {
    clients: {
      findActiveClient: vi.fn<() => Promise<unknown>>(async () => ({
        allowedScopes: ['openid', 'offline_access'],
        id: CLIENT_ID as never,
        redirectUris: ['https://app.example/cb'],
      })),
      ...overrides.clients,
    } as ClientStore,
    transactions: {
      insertPending: vi.fn<() => Promise<boolean>>(async () => true),
      ...overrides.transactions,
    } as unknown as AuthorizationTransactionStore,
  };
}

function makeUseCase(overrides: Parameters<typeof makeStores>[0] = {}) {
  const stores = makeStores(overrides),
    ids: IdGenerator = { newTransactionId: () => TRANSACTION_ID as never },
    clock: Clock = { now: () => new Date('2026-01-01T00:00:00Z') },
    useCase = new BeginAuthorizationUseCase({
      clients: stores.clients,
      clock,
      handles: makeHandles(),
      ids,
      transactions: stores.transactions,
    });
  return { useCase, ...stores };
}

const BASE_INPUT = {
  browserBinding: 'cookie-value',
  clientId: CLIENT_ID,
  codeChallenge: 'A'.repeat(43),
  codeChallengeMethod: 'S256',
  nonce: undefined,
  redirectUri: 'https://app.example/cb',
  responseType: 'code',
  scope: 'openid',
  state: undefined,
} as const;

// --- Tests -----------------------------------------------------------------

describe('BeginAuthorizationUseCase', () => {
  it('completes the happy path and persists a pending transaction', async () => {
    expect.hasAssertions();
    const { useCase, transactions } = makeUseCase(),
      output = await useCase.execute({ ...BASE_INPUT });

    expect(output.transactionId).toBe(TRANSACTION_ID);
    expect(output.handleX).toBe('h-login-handoff');
    expect(output.clientId).toBe(CLIENT_ID);
    expect(output.state).toBeUndefined();
    expect(transactions.insertPending).toHaveBeenCalledWith(
      expect.objectContaining({
        browserBindingHash: 'hash(cookie-value)',
        handleHashX: 'hash(h-login-handoff)',
        state: 'pending_browser',
      }),
    );
  });

  it('reflects the original state parameter in the output', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase(),
      output = await useCase.execute({ ...BASE_INPUT, state: 'xyz' });

    expect(output.state).toBe('xyz');
  });

  it('rejects a missing response_type with a non-redirectable error', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase();

    await expect(useCase.execute({ ...BASE_INPUT, responseType: undefined })).rejects.toMatchObject(
      { code: 'invalid_request', redirectable: false },
    );
  });

  it('rejects an unknown client with invalid_client and never redirects', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase({
      clients: {
        findActiveClient: vi.fn<() => Promise<undefined>>(async () => {
          /* Empty */
        }),
      },
    });

    await expect(useCase.execute({ ...BASE_INPUT })).rejects.toMatchObject({
      code: 'invalid_client',
      httpStatus: 401,
      redirectable: false,
    });
  });

  it('rejects an unregistered redirect_uri with a non-redirectable error', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase();

    await expect(
      useCase.execute({ ...BASE_INPUT, redirectUri: 'https://evil.example/cb' }),
    ).rejects.toMatchObject({ code: 'invalid_request', redirectable: false });
  });

  it('rejects a scope outside the client allowlist with a redirectable invalid_scope', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase();

    await expect(useCase.execute({ ...BASE_INPUT, scope: 'openid admin' })).rejects.toMatchObject({
      code: 'invalid_scope',
      redirectable: true,
    });
  });

  it('rejects a missing code_challenge_method (no implicit S256 default)', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase();

    await expect(
      useCase.execute({ ...BASE_INPUT, codeChallengeMethod: undefined }),
    ).rejects.toBeInstanceOf(OAuthProtocolError);
  });

  it('rejects plain PKCE method', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase();

    await expect(
      useCase.execute({ ...BASE_INPUT, codeChallengeMethod: 'plain' }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('maps a transaction id collision to server_error', async () => {
    expect.hasAssertions();
    const { useCase } = makeUseCase({
      transactions: { insertPending: vi.fn<() => Promise<false>>(async () => false) },
    });

    await expect(useCase.execute({ ...BASE_INPUT })).rejects.toMatchObject({
      code: 'server_error',
    });
  });
});
