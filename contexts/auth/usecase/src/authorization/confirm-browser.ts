import type { Command } from '@ecoma-io/usecase-primitives';

import { OAuthProtocolError, isTerminal } from '@ecoma-io/auth-domain';

import type { AuthorizationTransactionStore, Handle, HandleService, TransactionId } from '../ports';

/** Input của ConfirmBrowser — handle X từ `/login/continue` và cookie browser. */
export interface ConfirmBrowserInput {
  readonly handleX: string;
  /** Giá trị cookie `__Host-auth-browser` trình ra ở request này. */
  readonly browserCookie: string;
}

export interface ConfirmBrowserOutput {
  readonly transactionId: TransactionId;
}

export type ConfirmBrowser = Command<ConfirmBrowserInput, ConfirmBrowserOutput>;

/** Alias contract cho type-level tests: class phải thỏa Command primitive. */
export type ConfirmBrowserUseCaseType = ConfirmBrowser;

/**
 * Xác nhận browser đã duyệt request `/authorize`: so browser binding, kiểm tra
 * state còn `pending_browser`, rồi CAS transition sang `browser_confirmed`.
 *
 * Thất bại everywhere là `directInvalidGrant` — non-redirectable: handler chỉ
 * biết redirect được sau khi transaction đã xác minh, mà ở đây chưa có bước nào
 * xác minh request đủ tin.
 */
export class ConfirmBrowserUseCase implements ConfirmBrowser {
  readonly #transactions: AuthorizationTransactionStore;
  readonly #handles: HandleService;

  public constructor(deps: {
    transactions: AuthorizationTransactionStore;
    handles: HandleService;
  }) {
    this.#transactions = deps.transactions;
    this.#handles = deps.handles;
  }

  public async execute(input: ConfirmBrowserInput): Promise<ConfirmBrowserOutput> {
    // 1. Hash handle X rồi tra transaction theo hash (at-rest chỉ có hash).
    const handleHashX = await this.#handles.hashHandle(input.handleX as Handle),
      transactionId = await this.#transactions.findByHandleHashX(handleHashX);
    if (transactionId === undefined) {
      throw OAuthProtocolError.directInvalidGrant('handle khong ton tai');
    }

    // 2. Browser binding — constant-time so với hash đã lưu lúc begin.
    const recorded = await this.#transactions.findState(transactionId);
    if (recorded === undefined) {
      throw OAuthProtocolError.directInvalidGrant('transaction khong ton tai');
    }
    const bindingOk = await this.#handles.browserBindingMatches(
      input.browserCookie,
      recorded.browserBindingHash,
    );
    if (!bindingOk) {
      throw OAuthProtocolError.directInvalidGrant('browser binding khong khop');
    }

    // 3. State phải còn pending_browser. Đã browser_confirmed với cùng cookie là
    //    Idempotent replay (legacy: reload/back-navigation không lỗi); terminal thì terminal.
    if (recorded.state === 'browser_confirmed') {
      return { transactionId };
    }
    if (isTerminal(recorded.state) || recorded.state !== 'pending_browser') {
      throw OAuthProtocolError.directInvalidGrant('transaction khong con o pending_browser');
    }

    // 4. CAS transition — expiry/consumed được kiểm trong CAS. 'lost' → invalid_grant.
    const outcome = await this.#transactions.transition({
      fromState: 'pending_browser',
      toState: 'browser_confirmed',
      transactionId,
    });
    if (outcome === 'lost') {
      throw OAuthProtocolError.directInvalidGrant('transaction khong con hieu luc');
    }

    return { transactionId };
  }
}
