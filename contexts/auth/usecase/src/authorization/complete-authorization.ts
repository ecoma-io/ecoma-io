import type { Command } from '@ecoma-io/usecase-primitives';

import { HANDLE_DOMAINS, OAuthProtocolError, assertBrowserConfirmed } from '@ecoma-io/auth-domain';

import type {
  AccountStatusChecker,
  AuthorizationCode,
  AuthorizationTransactionStore,
  CasOutcome,
  Clock,
  Handle,
  HandleService,
  RevocationChecker,
  TransactionId,
} from '../ports';

/** Input của CompleteAuthorization — handle Z từ `GET /authorize/complete`. */
export interface CompleteAuthorizationInput {
  readonly transactionId: TransactionId;
  readonly handleZ: string;
  /** Giá trị cookie `__Host-auth-browser` trình ra ở request này. */
  readonly browserCookie: string;
  /** Quyết định cuối: approve cấp code, deny kết thúc không cấp code. */
  readonly decision: 'approve' | 'deny';
  /** Client id của transaction — chặn issuance đúng phạm vi grant khi check revocation. */
  readonly clientId: import('../ports/types.js').ClientId;
}

export interface CompleteAuthorizationOutput {
  /** Chỉ có ở nhánh approve — code single-use, TTL 60s, at-rest chỉ lưu hash. */
  readonly authorizationCode: AuthorizationCode | undefined;
  /** `state` gốc phản chiếu cho client; transport ghép vào redirect URL. */
  readonly redirectState: string | undefined;
}

export type CompleteAuthorization = Command<
  CompleteAuthorizationInput,
  CompleteAuthorizationOutput
>;

/** Alias contract cho type-level tests: class phải thỏa Command primitive. */
export type CompleteAuthorizationUseCaseType = CompleteAuthorization;

/** TTL của authorization code: 60 giây (legacy AUTHORIZATION_CODE_TTL_MS). */
const AUTHORIZATION_CODE_TTL_MS = 60 * 1000;

/**
 * Hoàn tất transaction: xác minh handle Z + browser binding, kiểm tra account
 * status fail-closed, rồi CAS →completed + INSERT code hash NGUYÊN TỬ trong
 * một persistence operation (không bao giờ completed mà thiếu code).
 *
 * Lỗi verify (handle/binding) là non-redirectable; lỗi business (denied,
 * CAS lost) là redirectable `invalid_grant`/`access_denied` — transport dựng
 * error redirect tới redirect_uri đã xác minh từ lúc begin (KHÔNG đọc lại từ query).
 */
export class CompleteAuthorizationUseCase implements CompleteAuthorization {
  readonly #transactions: AuthorizationTransactionStore;
  readonly #handles: HandleService;
  readonly #accountStatus: AccountStatusChecker;
  readonly #revocation: RevocationChecker;
  readonly #clock: Clock;

  public constructor(deps: {
    transactions: AuthorizationTransactionStore;
    handles: HandleService;
    accountStatus: AccountStatusChecker;
    revocation: RevocationChecker;
    clock: Clock;
  }) {
    this.#transactions = deps.transactions;
    this.#handles = deps.handles;
    this.#accountStatus = deps.accountStatus;
    this.#revocation = deps.revocation;
    this.#clock = deps.clock;
  }

  public async execute(input: CompleteAuthorizationInput): Promise<CompleteAuthorizationOutput> {
    // 1. Đọc state + binding hash; transaction không tồn tại → invalid_grant.
    const recorded = await this.#transactions.findState(input.transactionId);
    if (recorded === undefined) {
      throw OAuthProtocolError.invalidGrant('transaction khong ton tai');
    }

    // 2. Điều kiện tiên quyết FR-016q: chưa qua browser confirm thì không đọc gì thêm.
    assertBrowserConfirmed(recorded.state);

    // 3. Handle Z phải derive từ đúng transaction (domain separation) + khớp hash.
    const expectedHash = await this.#handles.hashHandle(
        await this.#handles.deriveHandle({
          domain: HANDLE_DOMAINS.authorizationCode,
          transactionId: input.transactionId,
        }),
      ),
      presentedHash = await this.#handles.hashHandle(input.handleZ as Handle);
    if (!this.#handles.hashEquals(presentedHash, expectedHash)) {
      throw OAuthProtocolError.invalidGrant('handle Z khong thuoc transaction');
    }

    // 4. Browser binding — constant-time.
    const bindingOk = await this.#handles.browserBindingMatches(
      input.browserCookie,
      recorded.browserBindingHash,
    );
    if (!bindingOk) {
      throw OAuthProtocolError.invalidGrant('browser binding khong khop');
    }

    // 5. Fail-closed gates: account status 'active' (mọi thứ khác chặn) + revocation
    //    'not_revoked' (legacy checkRevocation trước khi cấp code).
    const identity = await this.#transactions.findBoundIdentity(input.transactionId);
    if (identity === undefined) {
      throw OAuthProtocolError.invalidGrant('transaction chua bind identity');
    }
    const status = await this.#accountStatus.check(identity.subject);
    // Fail-closed: chỉ 'active' đi tiếp — 'unknown' cũng bị chặn.
    if (status.status !== 'active') {
      throw OAuthProtocolError.accessDenied('tai khoan khong duoc phep cap token');
    }
    const revocationResult = await this.#revocation.checkAtIssuance({
      clientId: input.clientId,
      subject: identity.subject,
    });
    if (revocationResult !== 'not_revoked') {
      throw OAuthProtocolError.accessDenied('token da bi thu hoi');
    }

    // 6. Terminal step — CAS + INSERT code trong MỘT persistence operation.
    let authorizationCode: AuthorizationCode | undefined, outcome: CasOutcome;
    if (input.decision === 'deny') {
      outcome = await this.#transactions.completeAndIssueAuthorizationCode({
        fromState: 'ready_to_complete',
        toState: 'denied',
        transactionId: input.transactionId,
      });
    } else {
      const code = await this.#handles.deriveHandle({
        domain: HANDLE_DOMAINS.authorizationCode,
        transactionId: input.transactionId,
      });
      authorizationCode = code as unknown as AuthorizationCode;
      const codeHash = await this.#handles.hashHandle(code);
      outcome = await this.#transactions.completeAndIssueAuthorizationCode({
        codeExpiresAt: new Date(this.#clock.now().getTime() + AUTHORIZATION_CODE_TTL_MS),
        codeHash,
        fromState: 'ready_to_complete',
        toState: 'completed',
        transactionId: input.transactionId,
      });
    }

    if (outcome === 'lost') {
      // Race với completion khác hoặc state không còn completable — invalid_grant,
      // Không oracle phân biệt consumed/expired.
      throw OAuthProtocolError.invalidGrant('transaction khong con completable');
    }

    if (input.decision === 'deny') {
      throw OAuthProtocolError.accessDenied('nguoi dung tu choi cap quyen');
    }

    // `state` phản chiếu cho client PHẢI là client_state ghi lúc begin — không đọc từ query.
    const payload = await this.#transactions.findPayload(input.transactionId);

    return {
      authorizationCode,
      redirectState: payload?.clientState,
    };
  }
}
