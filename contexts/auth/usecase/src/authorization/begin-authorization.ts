import type { Command } from '@ecoma-io/usecase-primitives';

import {
  HANDLE_DOMAINS,
  OAuthProtocolError,
  assertRegisteredRedirectUri,
  filterAllowedScopes,
  parseAuthorizationRequest,
} from '@ecoma-io/auth-domain';

import type {
  AuthorizationTransactionStore,
  ClientId,
  ClientStore,
  Clock,
  Handle,
  HandleService,
  IdGenerator,
  TransactionId,
} from '../ports';
export { type HandleHash } from '../ports';
export interface BeginAuthorizationInput {
  readonly responseType: string | undefined;
  readonly clientId: string | undefined;
  readonly redirectUri: string | undefined;
  readonly scope: string | undefined;
  readonly state: string | undefined;
  readonly nonce: string | undefined;
  readonly codeChallenge: string | undefined;
  readonly codeChallengeMethod: string | undefined;
  /** Giá trị cookie `__Host-auth-browser` — dùng để tính browser binding hash. */
  readonly browserBinding: string;
}

/** Output cho transport: handle X đi back-channel tới account, KHÔNG về browser. */
export interface BeginAuthorizationOutput {
  readonly transactionId: TransactionId;
  readonly handleX: Handle;
  readonly state: string | undefined;
  readonly clientId: ClientId;
}

export type BeginAuthorization = Command<BeginAuthorizationInput, BeginAuthorizationOutput>;

/** Alias contract cho type-level tests: class phải thỏa Command primitive. */
export type BeginAuthorizationUseCaseType = BeginAuthorization;

/** TTL của authorization transaction: 10 phút (legacy TRANSACTION_TTL_MS). */
const TRANSACTION_TTL_MS = 10 * 60 * 1000,
  /**
   * Phiên bản K_auth hiện tại — infrastructure inject qua port để handle verify
   * chọn đúng key lúc mint (legacy key_version; sau khi rotate K_auth, transaction
   * đang chạy vẫn verify được).
   */
  CURRENT_HANDLE_KEY_VERSION = 1;

/**
 * Bắt đầu authorization transaction: parse + xác minh request, mint transaction id,
 * derive handle X và ghi transaction ở `pending_browser`.
 *
 * Ranh giới redirect: mọi lỗi trước `assertRegisteredRedirectUri` là non-redirectable
 * (open-redirect guard); scope filter chạy SAU đó nên dùng mặc định redirectable=true.
 */
export class BeginAuthorizationUseCase implements BeginAuthorization {
  readonly #ids: IdGenerator;
  readonly #clients: ClientStore;
  readonly #transactions: AuthorizationTransactionStore;
  readonly #handles: HandleService;
  readonly #clock: Clock;

  public constructor(deps: {
    ids: IdGenerator;
    clients: ClientStore;
    transactions: AuthorizationTransactionStore;
    handles: HandleService;
    clock: Clock;
  }) {
    this.#ids = deps.ids;
    this.#clients = deps.clients;
    this.#transactions = deps.transactions;
    this.#handles = deps.handles;
    this.#clock = deps.clock;
  }

  public async execute(input: BeginAuthorizationInput): Promise<BeginAuthorizationOutput> {
    // 1. Parse cú pháp — mọi lỗi đều directInvalidRequest (chưa xác minh redirect_uri).
    const request = parseAuthorizationRequest({
        clientId: input.clientId,
        codeChallenge: input.codeChallenge,
        codeChallengeMethod: input.codeChallengeMethod,
        nonce: input.nonce,
        redirectUri: input.redirectUri,
        responseType: input.responseType,
        scope: input.scope,
        state: input.state,
      }),
      // 2. Client phải active — store chỉ trả client active (non-oracle với client lạ).
      client = await this.#clients.findActiveClient(request.clientId as ClientId);
    if (client === undefined) {
      throw OAuthProtocolError.invalidClient('client khong ton tai hoac khong active');
    }

    // 3. RANH GIỚI REDIRECT — từ đây lỗi được phép redirect tới redirect_uri.
    assertRegisteredRedirectUri(request.redirectUri, client.redirectUris, { kind: 'exact' });

    // 4. Scope phải nằm trong allowed_scopes của client (redirectable mặc định — đúng).
    filterAllowedScopes(request.scope, client.allowedScopes);

    // 5. Mint id + derive handle X (domain separation: login-handoff) và hash để lưu.
    const transactionId = this.#ids.newTransactionId(),
      handleX = await this.#handles.deriveHandle({
        domain: HANDLE_DOMAINS.loginHandoff,
        transactionId,
      }),
      handleHashX = await this.#handles.hashHandle(handleX),
      // 6. Browser binding hash — so với cookie ở confirm/complete.
      browserBindingHash = await this.#handles.hashHandle(input.browserBinding as Handle),
      // 7. Ghi transaction ở pending_browser; trùng id là 500-class (không bao giờ xảy ra với 256-bit entropy).
      expiresAt = new Date(this.#clock.now().getTime() + TRANSACTION_TTL_MS),
      inserted = await this.#transactions.insertPending({
        browserBindingHash,
        clientId: client.id,
        clientState: request.state,
        codeChallenge: request.codeChallenge,
        expiresAt,
        handleHashX,
        keyVersion: CURRENT_HANDLE_KEY_VERSION,
        nonce: request.nonce,
        redirectUri: request.redirectUri,
        scope: request.scope,
        state: 'pending_browser',
        transactionId,
      });
    if (!inserted) {
      throw OAuthProtocolError.serverError(undefined);
    }

    return {
      clientId: client.id,
      handleX,
      state: request.state,
      transactionId,
    };
  }
}

// Xác minh kiểu (type-level): use case bắt buộc tuân thủ Command primitive.
export type BeginAuthorizationUseCaseTypeCheck =
  BeginAuthorizationUseCase extends Command<BeginAuthorizationInput, BeginAuthorizationOutput>
    ? true
    : false;

// Giữ HandleHash được tham chiếu ở port contract (không dùng trực tiếp trong class này).
