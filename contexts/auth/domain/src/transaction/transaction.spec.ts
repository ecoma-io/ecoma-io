import { AuthorizationTransaction, canTransition, createTransactionId, isTerminal } from '../index';
import type { AuthorizationTransactionState } from '../index';
import { OAuthProtocolError } from '../shared/errors';

/** TransactionId hợp lệ — 43 ký tự base64url. */
const TX_ID = createTransactionId('a'.repeat(43)),
  TX_ALT = createTransactionId('b'.repeat(43));

describe('authorizationTransaction — lifecycle', () => {
  it('starts at pending_browser', () => {
    expect.hasAssertions();
    const tx = AuthorizationTransaction.start(TX_ID);
    expect(tx.state).toBe('pending_browser');
    expect(tx.isBrowserConfirmed).toBeFalsy();
    expect(tx.isCompletable).toBeFalsy();
    expect(tx.isTerminal).toBeFalsy();
  });

  it('walks the happy path: pending_browser → browser_confirmed → awaiting_consent → ready_to_complete → completed', () => {
    expect.hasAssertions();
    const tx = AuthorizationTransaction.start(TX_ID);
    tx.transitionTo('browser_confirmed');
    expect(tx.isBrowserConfirmed).toBe(true);
    tx.transitionTo('awaiting_consent');
    tx.transitionTo('ready_to_complete');
    expect(tx.isCompletable).toBe(true);
    tx.transitionTo('completed');
    expect(tx.isTerminal).toBe(true);
    expect(tx.isCompletable).toBeFalsy();
  });

  it('denied is reachable from ready_to_complete and is terminal', () => {
    expect.hasAssertions();
    const tx = AuthorizationTransaction.start(TX_ID);
    tx.transitionTo('browser_confirmed');
    tx.transitionTo('ready_to_complete');
    tx.transitionTo('denied');
    expect(tx.isTerminal).toBe(true);
    expect(tx.isCompletable).toBe(true);
  });
});

describe('authorizationTransaction — invalid state transitions', () => {
  it('refuses to skip browser confirmation', () => {
    expect.hasAssertions();
    const tx = AuthorizationTransaction.start(TX_ID);
    expect(() => tx.transitionTo('ready_to_complete')).toThrow(OAuthProtocolError);
    expect(tx.state).toBe('pending_browser');
  });

  it('refuses to leave a terminal state — code chỉ được cấp một lần', () => {
    expect.hasAssertions();
    const tx = AuthorizationTransaction.start(TX_ID);
    tx.transitionTo('browser_confirmed');
    tx.transitionTo('denied');
    expect(() => tx.transitionTo('ready_to_complete')).toThrow(OAuthProtocolError);
    expect(tx.state).toBe('denied');

    const done = AuthorizationTransaction.start(TX_ID);
    done.transitionTo('browser_confirmed');
    done.transitionTo('ready_to_complete');
    done.transitionTo('completed');
    expect(() => done.transitionTo('denied')).toThrow(OAuthProtocolError);
    expect(() => done.transitionTo('browser_confirmed')).toThrow(OAuthProtocolError);
  });

  it('refuses to reset a transaction back to pending_browser', () => {
    expect.hasAssertions();
    // Bảng chuyển tiếp chặn việc repository vô tình reset — transaction không
    // Dùng lại được.
    const tx = AuthorizationTransaction.start(TX_ID);
    tx.transitionTo('browser_confirmed');
    expect(() => tx.transitionTo('pending_browser')).toThrow(OAuthProtocolError);
  });

  it('refuses awaiting_consent directly after start', () => {
    expect.hasAssertions();
    const tx = AuthorizationTransaction.start(TX_ID);
    expect(() => tx.transitionTo('awaiting_consent')).toThrow(OAuthProtocolError);
  });
});

describe('authorizationTransaction — reconstitution', () => {
  it('rebuilds with the persisted state', () => {
    expect.hasAssertions();
    const tx = AuthorizationTransaction.reconstitute(TX_ID, 'ready_to_complete');
    expect(tx.state).toBe('ready_to_complete');
    expect(tx.isCompletable).toBe(true);
  });

  it('rejects an unknown persisted state — dữ liệu hỏng không reconstitute được', () => {
    expect.hasAssertions();
    expect(() =>
      AuthorizationTransaction.reconstitute(TX_ID, 'hacked' as AuthorizationTransactionState),
    ).toThrow(OAuthProtocolError);
  });
});

describe('authorizationTransaction — identity equality', () => {
  it('same id is the same transaction regardless of state', () => {
    expect.hasAssertions();
    const a = AuthorizationTransaction.start(TX_ID),
      b = AuthorizationTransaction.reconstitute(TX_ID, 'denied');
    expect(a.equals(b)).toBe(true);
  });

  it('different ids are different transactions', () => {
    expect.hasAssertions();
    const a = AuthorizationTransaction.start(TX_ID),
      b = AuthorizationTransaction.start(TX_ALT);
    expect(a.equals(b)).toBeFalsy();
  });

  it('preserves the id', () => {
    expect.hasAssertions();
    expect(AuthorizationTransaction.start(TX_ID).id).toBe(TX_ID);
  });
});

describe('authorizationTransaction — named behaviors', () => {
  it('confirmBrowser is the only way out of pending_browser', () => {
    expect.hasAssertions();
    const tx = AuthorizationTransaction.start(TX_ID);
    tx.confirmBrowser();
    expect(tx.state).toBe('browser_confirmed');
    expect(tx.isBrowserConfirmed).toBe(true);
  });

  it('complete marks the transaction terminal exactly once', () => {
    expect.hasAssertions();
    const tx = AuthorizationTransaction.start(TX_ID);
    tx.confirmBrowser();
    tx.markReadyToComplete();
    tx.complete();
    expect(tx.isTerminal).toBe(true);
    expect(tx.isCompletable).toBeFalsy();
    // Replay: completed là đích — hoàn tất lần hai bị từ chối bởi bảng chuyển tiếp.
    expect(() => tx.complete()).toThrow(OAuthProtocolError);
    expect(() => tx.deny()).toThrow(OAuthProtocolError);
    expect(() => tx.confirmBrowser()).toThrow(OAuthProtocolError);
  });

  it('deny is terminal too — handle Z hoàn tất lần hai không dùng lại được', () => {
    expect.hasAssertions();
    const tx = AuthorizationTransaction.start(TX_ID);
    tx.confirmBrowser();
    tx.deny();
    expect(tx.isTerminal).toBe(true);
    // Vẫn completable theo nghĩa handle Z được TIÊU THỤ để dựng access_denied.
    expect(tx.isCompletable).toBe(true);
    expect(() => tx.complete()).toThrow(OAuthProtocolError);
  });

  it('requestConsent follows browser confirmation only', () => {
    expect.hasAssertions();
    const tx = AuthorizationTransaction.start(TX_ID);
    expect(() => tx.requestConsent()).toThrow(OAuthProtocolError);
    tx.confirmBrowser();
    tx.requestConsent();
    expect(tx.state).toBe('awaiting_consent');
    tx.markReadyToComplete();
    expect(tx.isCompletable).toBe(true);
  });

  it('reconstituted transaction in a terminal state refuses every behavior', () => {
    expect.hasAssertions();
    for (const terminal of ['completed', 'denied'] as const) {
      const tx = AuthorizationTransaction.reconstitute(TX_ID, terminal);
      expect(() => tx.confirmBrowser()).toThrow(OAuthProtocolError);
      expect(() => tx.requestConsent()).toThrow(OAuthProtocolError);
      expect(() => tx.markReadyToComplete()).toThrow(OAuthProtocolError);
      expect(() => tx.complete()).toThrow(OAuthProtocolError);
      expect(() => tx.deny()).toThrow(OAuthProtocolError);
    }
  });
});

describe('authorizationTransaction — browser confirmation gate (FR-016q)', () => {
  it('assertBrowserConfirmed throws before /authorize/confirm', () => {
    expect.hasAssertions();
    const tx = AuthorizationTransaction.start(TX_ID);
    expect(() => tx.assertBrowserConfirmed()).toThrow(OAuthProtocolError);
  });

  it('assertBrowserConfirmed passes after confirmation', () => {
    expect.hasAssertions();
    const tx = AuthorizationTransaction.start(TX_ID);
    tx.transitionTo('browser_confirmed');
    expect(() => tx.assertBrowserConfirmed()).not.toThrow();
  });
});

describe('pure transition table — unchanged behavior', () => {
  it('canTransition mirrors the one-directional table', () => {
    expect.hasAssertions();
    expect(canTransition('pending_browser', 'browser_confirmed')).toBe(true);
    expect(canTransition('completed', 'pending_browser')).toBeFalsy();
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('denied')).toBe(true);
    expect(isTerminal('ready_to_complete')).toBeFalsy();
  });
});
