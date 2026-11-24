import { computeS256Challenge } from '@ecoma-io/auth-domain';

import type { RedeemedAuthorizationCode } from '../ports/authorization-code-redeemer.js';
import {
  asClientId,
  asGrantId,
  asHandle,
  asHandleHash,
  asSubject,
  asTransactionId,
  mockAccountStatus,
  mockClientStore,
  mockGrantStore,
  mockHandleService,
  mockRedeemer,
  mockRevocation,
  mockTokenIssuers,
} from '../testing/mock-ports.js';
import { ExchangeAuthorizationCodeUseCase } from './exchange-authorization-code.js';

const clientId = asClientId('client-1'),
  subject = asSubject('sub-1'),
  grantId = asGrantId('g-1'),
  CLIENT = { allowedScopes: ['profile'], redirectUris: ['https://app.example.com/cb'] },
  REDIRECT_URI = 'https://app.example.com/cb',
  VERIFIER = 'v'.repeat(43);

function redeemed(overrides: Partial<RedeemedAuthorizationCode> = {}): RedeemedAuthorizationCode {
  return {
    codeChallenge: 'A'.repeat(43),
    redirectUri: REDIRECT_URI,
    scope: ['profile'],
    subject,
    transactionId: asTransactionId('t'.repeat(43)),
    ...overrides,
  };
}

interface DepsOverrides {
  redeemer?: RedeemedAuthorizationCode | undefined;
  accountStatus?: 'active' | 'suspended' | 'unknown';
  revocation?: 'not_revoked' | 'revoked' | 'unknown' | 'unavailable';
  grantedScopes?: readonly string[];
  requestedScope?: readonly string[];
  spyHash?: ((handle: string) => Promise<string>) | undefined;
}

function buildUseCase(overrides: DepsOverrides = {}) {
  const issuers = mockTokenIssuers(),
    handles = mockHandleService(),
    { spyHash } = overrides,
    spyHandles =
      spyHash === undefined
        ? handles
        : ({
            ...handles,
            hashHandle: (handle: string) => spyHash(handle),
          } as unknown as typeof handles),
    useCase = new ExchangeAuthorizationCodeUseCase(
      mockClientStore(CLIENT),
      mockRedeemer(overrides.redeemer === undefined ? redeemed() : overrides.redeemer),
      mockGrantStore({
        findActiveGrant: async () => ({
          clientId,
          id: grantId,
          isActive: true,
          scopes: overrides.grantedScopes ?? ['profile'],
          subject,
        }),
      }),
      spyHandles,
      mockAccountStatus(overrides.accountStatus ?? 'active'),
      mockRevocation(overrides.revocation ?? 'not_revoked'),
      issuers.access,
      issuers.refresh,
    );
  return useCase;
}

function executeInput(
  overrides: Partial<{ code: string; codeVerifier: string; redirectUri: string }> = {},
) {
  return {
    clientId,
    code: asHandle(overrides.code ?? 'handle-z'),
    codeVerifier: overrides.codeVerifier ?? VERIFIER,
    redirectUri: overrides.redirectUri ?? REDIRECT_URI,
  };
}

describe('ExchangeAuthorizationCodeUseCase', () => {
  it('exchanges a valid code for access and refresh tokens', async () => {
    expect.hasAssertions();
    const challenge = await computeS256Challenge(VERIFIER),
      useCase = buildUseCase({ redeemer: redeemed({ codeChallenge: challenge }) }),
      output = await useCase.execute(executeInput());

    expect(output.tokenType).toBe('Bearer');
    expect(output.accessToken).toContain('at-sub-1');
    expect(output.refreshToken).toBe('rt-1');
    expect(output.scope).toStrictEqual(['profile']);
  });

  it('rejects unknown or inactive client with invalid_client', async () => {
    expect.hasAssertions();
    const challenge = await computeS256Challenge(VERIFIER),
      issuers = mockTokenIssuers(),
      useCase = new ExchangeAuthorizationCodeUseCase(
        mockClientStore(undefined),
        mockRedeemer(redeemed({ codeChallenge: challenge })),
        mockGrantStore(),
        mockHandleService(),
        mockAccountStatus(),
        mockRevocation(),
        issuers.access,
        issuers.refresh,
      );

    await expect(useCase.execute(executeInput())).rejects.toMatchObject({
      code: 'invalid_client',
      httpStatus: 401,
    });
  });

  it('rejects unregistered redirect_uri with direct invalid_request', async () => {
    expect.hasAssertions();
    const useCase = buildUseCase({});

    await expect(
      useCase.execute(executeInput({ redirectUri: 'https://evil.example.com/cb' })),
    ).rejects.toMatchObject({ code: 'invalid_request', redirectable: false });
  });

  it('rejects consumed or unknown code as non-oracle invalid_grant', async () => {
    expect.hasAssertions();
    const useCase = buildUseCase({ redeemer: undefined });

    await expect(useCase.execute(executeInput())).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('rejects wrong PKCE verifier with invalid_grant', async () => {
    expect.hasAssertions();
    const otherChallenge = await computeS256Challenge('x'.repeat(43)),
      useCase = buildUseCase({ redeemer: redeemed({ codeChallenge: otherChallenge }) });

    await expect(useCase.execute(executeInput())).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('rejects redirect_uri mismatch with the transaction record (FR-009k)', async () => {
    expect.hasAssertions();
    const challenge = await computeS256Challenge(VERIFIER),
      useCase = buildUseCase({
        redeemer: redeemed({
          codeChallenge: challenge,
          redirectUri: 'https://app.example.com/other',
        }),
      });

    await expect(useCase.execute(executeInput())).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('fail-closed: suspended account is denied after successful consume', async () => {
    expect.hasAssertions();
    const challenge = await computeS256Challenge(VERIFIER),
      useCase = buildUseCase({
        accountStatus: 'suspended',
        redeemer: redeemed({ codeChallenge: challenge }),
      });

    await expect(useCase.execute(executeInput())).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('fail-closed: revoked subject is denied after successful consume', async () => {
    expect.hasAssertions();
    const challenge = await computeS256Challenge(VERIFIER),
      useCase = buildUseCase({
        redeemer: redeemed({ codeChallenge: challenge }),
        revocation: 'revoked',
      });

    await expect(useCase.execute(executeInput())).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('fail-closed: grant without sufficient scope is denied', async () => {
    expect.hasAssertions();
    const challenge = await computeS256Challenge(VERIFIER),
      useCase = buildUseCase({
        redeemer: redeemed({ codeChallenge: challenge, scope: ['profile', 'email'] }),
      });

    // AssertGrantCoversScope của domain ném access_denied — bất biến do domain sở hữu.
    await expect(useCase.execute(executeInput())).rejects.toMatchObject({ code: 'access_denied' });
  });

  it('hashes the presented code before redemption', async () => {
    expect.hasAssertions();
    const challenge = await computeS256Challenge(VERIFIER);
    let seenHash = '';
    const useCase = buildUseCase({
      redeemer: redeemed({ codeChallenge: challenge }),
      spyHash: async (handle) => {
        const h = asHandleHash(`hash(${handle})`);
        seenHash = h;
        return h;
      },
    });

    await useCase.execute(executeInput());

    expect(seenHash).toBe(asHandleHash('hash(handle-z)'));
  });
});
