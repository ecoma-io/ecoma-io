import {
  asClientId,
  asEventId,
  asGrantId,
  asHandle,
  asSubject,
  asTransactionId,
  mockGrantStore,
  mockTransactionStore,
} from '../testing/mock-ports.js';
import { ConsentDecideUseCase, ConsentRaceError } from './consent-decide.js';

const txId = asTransactionId('t'.repeat(43)),
  subject = asSubject('sub-1'),
  clientId = asClientId('client-1'),
  handleY = asHandle('handle-y'),
  eventId = asEventId('event-1');

function baseInput() {
  return {
    accountSessionRef: 'asr-1',
    clientId,
    decision: 'approve' as const,
    eventId,
    handleY,
    requestedScope: ['profile'] as const,
    subject,
    transactionId: txId,
  };
}

describe('ConsentDecideUseCase', () => {
  it('replays already-decided outcome without side effects', async () => {
    expect.hasAssertions();
    const grants = mockGrantStore({
        findCommittedConsentDecision: async () => ({ decision: 'deny' }),
      }),
      transactions = mockTransactionStore(),
      decideConsent = vi.spyOn(transactions, 'decideConsent'),
      useCase = new ConsentDecideUseCase(transactions, grants),
      output = await useCase.execute(baseInput());

    expect(output).toStrictEqual({ decision: 'deny', outcome: 'already-decided' });
    expect(decideConsent).not.toHaveBeenCalled();
  });

  it('approves atomically: one decideConsent op consumes Y, transitions, records decision and grant', async () => {
    expect.hasAssertions();
    const decideConsent = vi.fn<() => Promise<'won' | 'lost'>>(async () => 'won' as const),
      transactions = mockTransactionStore({ decideConsent }),
      grants = mockGrantStore({
        findActiveGrant: async () => {
          /* Empty */
        },
      }),
      useCase = new ConsentDecideUseCase(transactions, grants),
      output = await useCase.execute(baseInput());

    // MỘT persistence operation duy nhất — consume Y + decision + grant nguyên tử.
    expect(decideConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'approve',
        eventId,
        expectedAccountSessionRef: 'asr-1',
        expectedSubject: subject,
        grant: expect.objectContaining({ clientId, scopes: ['profile'] }),
        transactionId: txId,
      }),
    );
    expect(output).toStrictEqual({
      decision: 'approve',
      grantId: expect.any(String),
      outcome: 'decided',
    });
  });

  it('deny: decideConsent records denial without a grant', async () => {
    expect.hasAssertions();
    const decideConsent = vi.fn<() => Promise<'won' | 'lost'>>(async () => 'won' as const),
      transactions = mockTransactionStore({ decideConsent }),
      grants = mockGrantStore(),
      useCase = new ConsentDecideUseCase(transactions, grants),
      output = await useCase.execute({ ...baseInput(), decision: 'deny' as const });

    expect(decideConsent).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'deny', grant: undefined }),
    );
    expect(output).toStrictEqual({ decision: 'deny', outcome: 'decided' });
  });

  it('approve with an existing grant covering scope: grant id minted, no scope assertion failure', async () => {
    expect.hasAssertions();
    const transactions = mockTransactionStore({
        decideConsent: async () => 'won' as const,
      }),
      grants = mockGrantStore({
        findActiveGrant: async () => ({
          clientId,
          id: asGrantId('existing-grant'),
          isActive: true,
          scopes: ['profile'],
          subject,
        }),
      }),
      useCase = new ConsentDecideUseCase(transactions, grants),
      output = await useCase.execute(baseInput());

    expect(output).toStrictEqual({
      decision: 'approve',
      grantId: expect.any(String),
      outcome: 'decided',
    });
  });

  it('approve requesting scope beyond the existing grant violates the grant invariant', async () => {
    expect.hasAssertions();
    const transactions = mockTransactionStore(),
      grants = mockGrantStore({
        findActiveGrant: async () => ({
          clientId,
          id: asGrantId('existing-grant'),
          isActive: true,
          scopes: ['profile'],
          subject,
        }),
      }),
      useCase = new ConsentDecideUseCase(transactions, grants);

    await expect(
      useCase.execute({ ...baseInput(), requestedScope: ['profile', 'wallet'] as const }),
    ).rejects.toMatchObject({ code: 'access_denied' });
  });

  it('throws ConsentRaceError when decideConsent loses the CAS', async () => {
    expect.hasAssertions();
    const transactions = mockTransactionStore({
        decideConsent: async () => 'lost' as const,
      }),
      useCase = new ConsentDecideUseCase(transactions, mockGrantStore());

    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(ConsentRaceError);
  });
});
