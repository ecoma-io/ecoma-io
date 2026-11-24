import { OAuthProtocolError } from '@ecoma-io/auth-domain';

import {
  asClientId,
  asGrantId,
  asHandleHash,
  asSubject,
  asTransactionId,
  mockClock,
  mockGrantStore,
  mockTransactionStore,
} from '../testing/mock-ports.js';
import { ConsentContextQuery } from './consent-context.js';

const txId = asTransactionId('t'.repeat(43)),
  subject = asSubject('sub-1'),
  clientId = asClientId('client-1');

describe('ConsentContextQuery', () => {
  it('returns needsConsent true with low risk when no grant exists', async () => {
    expect.hasAssertions();
    const query = new ConsentContextQuery(
        mockTransactionStore({
          findBoundIdentity: async () => ({
            accountSessionRef: 'asr-1',
            acr: 'urn:acme:acr:email-otp',
            authnAt: new Date(),
            subject,
          }),
          findState: async () => ({
            browserBindingHash: asHandleHash('bbh'),
            consumedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
            state: 'awaiting_consent' as const,
          }),
        }),
        mockGrantStore(),
        mockClock(new Date()),
      ),
      output = await query.execute({
        accountSessionRef: 'asr-1',
        clientId,
        requestedScope: ['profile'],
        transactionId: txId,
      });

    expect(output.needsConsent).toBe(true);
    // IsNewClient + isNewScope = 2 điểm → 'high' theo assessRiskLevel.
    expect(output.riskLevel).toBe('high');
    expect(output.grantedScopes).toStrictEqual([]);
  });

  it('returns needsConsent false when active grant covers requested scope', async () => {
    expect.hasAssertions();
    const query = new ConsentContextQuery(
        mockTransactionStore({
          findBoundIdentity: async () => ({
            accountSessionRef: 'asr-1',
            acr: 'urn:acme:acr:email-otp',
            authnAt: new Date(),
            subject,
          }),
          findState: async () => ({
            browserBindingHash: asHandleHash('bbh'),
            consumedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
            state: 'awaiting_consent' as const,
          }),
        }),
        mockGrantStore({
          findActiveGrant: async () => ({
            clientId,
            id: asGrantId('g-1'),
            isActive: true,
            scopes: ['profile'],
            subject,
          }),
        }),
        mockClock(new Date()),
      ),
      output = await query.execute({
        accountSessionRef: 'asr-1',
        clientId,
        requestedScope: ['profile'],
        transactionId: txId,
      });

    expect(output.needsConsent).toBeFalsy();
    expect(output.grantedScopes).toStrictEqual(['profile']);
  });

  it('rejects with invalid_grant when transaction does not exist', async () => {
    expect.hasAssertions();
    const query = new ConsentContextQuery(
      mockTransactionStore(),
      mockGrantStore(),
      mockClock(new Date()),
    );

    await expect(
      query.execute({
        accountSessionRef: 'asr-1',
        clientId,
        requestedScope: ['profile'],
        transactionId: txId,
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant', redirectable: false });
  });

  it('rejects with invalid_grant when account session ref does not match bound identity', async () => {
    expect.hasAssertions();
    const query = new ConsentContextQuery(
      mockTransactionStore({
        findBoundIdentity: async () => ({
          accountSessionRef: 'asr-other',
          acr: 'urn:acme:acr:email-otp',
          authnAt: new Date(),
          subject,
        }),
        findState: async () => ({
          browserBindingHash: asHandleHash('bbh'),
          consumedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          state: 'awaiting_consent' as const,
        }),
      }),
      mockGrantStore(),
      mockClock(new Date()),
    );

    await expect(
      query.execute({
        accountSessionRef: 'asr-1',
        clientId,
        requestedScope: ['profile'],
        transactionId: txId,
      }),
    ).rejects.toBeInstanceOf(OAuthProtocolError);
  });
});
