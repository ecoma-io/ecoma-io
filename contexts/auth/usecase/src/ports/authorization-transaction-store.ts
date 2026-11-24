/**
 * Port persistence cho AuthorizationTransaction và authorization code.
 *
 * Bất biến thiết kế (từ legacy):
 * - Mọi consume/transition là CAS theo state + consumed_at + expires_at.
 * - Expiry được kiểm tra BÊN TRONG CAS — row hết hạn không bao giờ transition được.
 * - `consumeHandleXAndBindIdentity` là MỘT statement: consume X + bind identity + event block.
 * - `completeAndIssueAuthorizationCode` phải nguyên tử: CAS →completed + INSERT code
 *   trong cùng một DB transaction (legacy dead code làm 2 bước tuần tự — lỗi đã biết).
 */
import type {
  AuthorizationTransactionState,
  CasOutcome,
  ClientId,
  ConsentDecision,
  EventId,
  GrantId,
  HandleHash,
  Subject,
  TransactionId,
} from './types.js';

export interface AuthorizationTransactionStore {
  /**
   * Ghi transaction mới ở state `pending_browser` cùng hash handle X và browser binding hash.
   * Payload (client, redirectUri, scope, PKCE, state, nonce, keyVersion) là record data
   * PHẢI được ghi cùng lúc — nếu không, round-trip persistence không thể implement
   * (authorization code redemption cần redirectUri/codeChallenge đã ghi).
   * Trả về false nếu transaction id đã tồn tại (idempotency-first-bind-wins).
   */
  insertPending(input: {
    transactionId: TransactionId;
    state: 'pending_browser';
    handleHashX: HandleHash;
    browserBindingHash: HandleHash;
    expiresAt: Date;
    /** Phiên bản của K_auth tại thời điểm mint handle — phục vụ key rotation. */
    keyVersion: number;
    clientId: ClientId;
    redirectUri: string;
    scope: readonly string[];
    codeChallenge: string;
    clientState: string | undefined;
    nonce: string | undefined;
  }): Promise<boolean>;

  /**
   * Nguyên tử quyết định consent — MỘT DB transaction bảo đảm:
   * consume handle Y (CAS kèm binding checks) + CAS transition sang
   * `denied`/`ready_to_complete` + ghi consent decision + (approve) ghi grant
   * + scopes. Không có partial state: Y consumed mà decision chưa commit là
   * bất khả thi theo hợp đồng này (legacy chạy trong một `postgresClient.begin`).
   * Trả về 'lost' nếu CAS thua (quyết định khác đã thắng) — KHÔNG ghi gì.
   */
  decideConsent(input: {
    transactionId: TransactionId;
    handleHashY: HandleHash;
    expectedSubject: Subject;
    expectedAccountSessionRef: string;
    decision: ConsentDecision;
    eventId: EventId;
    /** Chỉ dùng khi decision = approve. */
    grant?:
      | {
          grantId: GrantId;
          clientId: ClientId;
          scopes: readonly string[];
        }
      | undefined;
  }): Promise<CasOutcome>;

  /** Đọc state hiện tại; trả về undefined nếu không tồn tại (không lọc consumed/expired để caller phân biệt failure reasons). */
  findState(transactionId: TransactionId): Promise<
    | {
        state: AuthorizationTransactionState;
        expiresAt: Date;
        consumedAt: Date | null;
        /** Hash browser binding đã ghi lúc begin — để use case xác minh cookie. */
        browserBindingHash: HandleHash;
      }
    | undefined
  >;

  /** CAS transition thuần: chỉ thắng khi state đúng, chưa consume và chưa hết hạn. */
  transition(input: {
    transactionId: TransactionId;
    fromState: AuthorizationTransactionState;
    toState: AuthorizationTransactionState;
  }): Promise<CasOutcome>;

  /**
   * Nguyên tử: consume handle X + bind identity (sub, acr, authnAt, accountSessionRef)
   * + ghi event block (eventId). CAS điều kiện: state=browser_confirmed, chưa consume,
   * chưa hết hạn, handle hash X khớp.
   */
  consumeHandleXAndBindIdentity(input: {
    handleHashX: HandleHash;
    transactionId: TransactionId;
    subject: Subject;
    acr: string;
    authnAt: Date;
    accountSessionRef: string;
    eventId: EventId;
  }): Promise<CasOutcome>;

  /**
   * CAS transition kèm ghi hash handle Y (sau consume X, tới awaiting_consent)
   * hoặc Z (tới ready_to_complete). Không đụng event_* columns — event identity
   * chỉ thuộc về consumeHandleXAndBindIdentity.
   */
  advanceWithHandle(input: {
    transactionId: TransactionId;
    fromState: AuthorizationTransactionState;
    toState: 'awaiting_consent' | 'ready_to_complete';
    handleHash: HandleHash;
  }): Promise<CasOutcome>;

  /**
   * Nguyên tử: CAS →completed (hoặc →denied) + INSERT authorization code hash.
   * Thỏa mãn ràng buộc "không bao giờ completed mà thiếu code" dù có partial failure.
   */
  completeAndIssueAuthorizationCode(input: {
    transactionId: TransactionId;
    fromState: 'ready_to_complete';
    toState: 'completed' | 'denied';
    codeHash?: HandleHash;
    codeExpiresAt?: Date;
  }): Promise<CasOutcome>;

  /**
   * Consume handle Y (consent continuation). CAS predicate ĐẦY ĐỦ (legacy CAS 2):
   * state = 'awaiting_consent' AND handle_hash_y khớp AND consumed_at IS NULL
   * AND expires_at > now AND subject + account_session_ref khớp những gì đã bind
   * lúc consume X. Transaction terminal/hết hạn thì KHÔNG bao giờ consume được.
   */
  consumeHandleY(input: {
    handleHashY: HandleHash;
    transactionId: TransactionId;
    expectedSubject: Subject;
    expectedAccountSessionRef: string;
  }): Promise<CasOutcome>;

  /** Đọc identity đã bind (để consent context và complete xác thực lại). */
  findBoundIdentity(transactionId: TransactionId): Promise<
    | {
        subject: Subject;
        acr: string;
        authnAt: Date;
        accountSessionRef: string;
      }
    | undefined
  >;

  /** Tra cứu transaction qua hash handle X (session verification back-channel). */
  findByHandleHashX(handleHashX: HandleHash): Promise<TransactionId | undefined>;

  /**
   * Payload record data đã ghi lúc begin — cần cho consent context/decide
   * (clientId, requestedScope) và verify lại client_state lúc complete.
   */
  findPayload(transactionId: TransactionId): Promise<
    | {
        clientId: ClientId;
        redirectUri: string;
        scope: readonly string[];
        codeChallenge: string;
        clientState: string | undefined;
        keyVersion: number;
      }
    | undefined
  >;
}

/** Đã thay thế BeginTransactionData trước đó — payload giờ nằm trong insertPending. */
