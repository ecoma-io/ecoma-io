import {
  asClientId,
  asEventId,
  asHandle,
  asHandleHash,
  asSubject,
  asTransactionId,
  mockAccountStatus,
  mockClock,
  mockGrantStore,
  mockHandleService,
  mockRevocation,
  mockTransactionStore,
} from '../testing/mock-ports.js';
import { SessionVerifiedUseCase } from './session-verified.js';

const subject = asSubject('sub-1'),
  clientId = asClientId('client-1');

function baseInput() {
  return {
    accountSessionRef: 'asr-1',
    acr: 'urn:acme:acr:email-otp',
    authnAt: '2026-01-01T00:00:00Z',
    clientId,
    eventId: asEventId('event-1'),
    handleX: asHandle('handle-x'),
    requestedScope: ['profile'] as const,
    subject,
  };
}

function buildUseCase(overrides: {
  transactionStore?: Parameters<typeof mockTransactionStore>[0];
  grantStore?: Parameters<typeof mockGrantStore>[0];
  accountStatus?: 'active' | 'suspended' | 'unknown';
  revocation?: 'not_revoked' | 'revoked' | 'unknown' | 'unavailable';
}) {
  return new SessionVerifiedUseCase(
    mockTransactionStore({
      findByHandleHashX: async () => asTransactionId('t'.repeat(43)),
      ...overrides.transactionStore,
    }),
    mockGrantStore(overrides.grantStore),
    mockHandleService(),
    mockAccountStatus(overrides.accountStatus ?? 'active'),
    mockRevocation(overrides.revocation ?? 'not_revoked'),
    mockClock(),
  );
}

describe('SessionVerifiedUseCase', () => {
  it('advances to awaiting_consent and returns handleY when consent is required', async () => {
    expect.hasAssertions();
    const useCase = buildUseCase({}),
      output = await useCase.execute(baseInput());

    expect(output).toStrictEqual({
      handleY: asHandle('h-consent-continuation-ttttttttttttttttttttttttttttttttttttttttttt'),
      outcome: 'consent-required',
      riskLevel: 'low',
    });
  });

  it('advances to ready_to_complete and returns handleZ when active grant covers scope', async () => {
    expect.hasAssertions();
    const useCase = buildUseCase({
        grantStore: {
          findActiveGrant: async () => ({
            clientId,
            id: asSubject('g-1') as never,
            isActive: true,
            scopes: ['profile'],
            subject,
          }),
        },
      }),
      output = await useCase.execute(baseInput());

    expect(output.outcome).toBe('ready');
    expect(output).toHaveProperty('handleZ');
    // Handle Z chứa domain separation marker trong mock deriveHandle.
    expect(String((output as { handleZ?: string }).handleZ)).toContain('authorization-code');
  });

  it('returns idempotent replay when CAS lost and transaction already advanced', async () => {
    expect.hasAssertions();
    const useCase = buildUseCase({
        transactionStore: {
          consumeHandleXAndBindIdentity: async () => 'lost' as const,
          findState: async () => ({
            browserBindingHash: asHandleHash('bbh'),
            consumedAt: new Date(),
            expiresAt: new Date(),
            state: 'ready_to_complete' as const,
          }),
        },
      }),
      output = await useCase.execute(baseInput());

    expect(output).toStrictEqual({ outcome: 'replayed', state: 'ready_to_complete' });
  });

  it('rejects handle reuse when CAS lost but transaction still in browser_confirmed', async () => {
    expect.hasAssertions();
    const useCase = buildUseCase({
      transactionStore: {
        consumeHandleXAndBindIdentity: async () => 'lost' as const,
        findState: async () => ({
          browserBindingHash: asHandleHash('bbh'),
          consumedAt: new Date(),
          expiresAt: new Date(),
          state: 'browser_confirmed' as const,
        }),
      },
    });

    await expect(useCase.execute(baseInput())).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('fail-closed: suspended account is denied even though consume won', async () => {
    expect.hasAssertions();
    const useCase = buildUseCase({ accountStatus: 'suspended' });

    await expect(useCase.execute(baseInput())).rejects.toMatchObject({ code: 'access_denied' });
  });

  it('fail-closed: unknown account status is denied', async () => {
    expect.hasAssertions();
    const useCase = buildUseCase({ accountStatus: 'unknown' });

    await expect(useCase.execute(baseInput())).rejects.toMatchObject({ code: 'access_denied' });
  });

  it('fail-closed: unavailable revocation check is denied', async () => {
    expect.hasAssertions();
    const useCase = buildUseCase({ revocation: 'unavailable' });

    await expect(useCase.execute(baseInput())).rejects.toMatchObject({ code: 'access_denied' });
  });

  it('rejects unknown handle with invalid_grant', async () => {
    expect.hasAssertions();
    const useCase = buildUseCase({
      transactionStore: {
        findByHandleHashX: async () => {
          /* Empty */
        },
      },
    });

    await expect(useCase.execute(baseInput())).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('flags riskLevel high when authn is stale beyond 5 minutes', async () => {
    expect.hasAssertions();
    const useCase = buildUseCase({
        grantStore: {
          findActiveGrant: async () => ({
            clientId,
            id: asSubject('g-1') as never,
            isActive: true,
            scopes: ['profile'],
            subject,
          }),
        },
      }),
      // Clock mặc định 2026-01-01T00:00:00Z; authnAt 10 phút trước → stale.
      input = { ...baseInput(), authnAt: '2025-12-31T23:50:00Z' },
      output = await useCase.execute(input);

    expect(output.outcome).toBe('ready');
    expect(output).toHaveProperty('riskLevel', 'elevated');
  });
});
