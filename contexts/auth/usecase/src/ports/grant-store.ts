import type {
  CasOutcome,
  ClientId,
  ConsentDecision,
  GrantId,
  GrantRecord,
  Subject,
  TransactionId,
} from './types.js';

/**
 * Port persistence cho Grant + Consent + revocation client-level.
 *
 * Bất biến thiết kế (từ legacy):
 * - Tối đa 1 grant active cho mỗi (subject, clientId) — unique partial index.
 * - Grant/consent inserts idempotent (ON CONFLICT DO NOTHING).
 * - decideConsent là MỘT DB transaction: CAS transition + consumeHandleY +
   audit event + consent decision + (nếu approve) grant + grant scopes.
 * - Revoke là CAS theo status='active'; mất CAS không phải error.
 */
export interface GrantStore {
  /** Grant active duy nhất của (subject, clientId); undefined nếu chưa có. */
  findActiveGrant(subject: Subject, clientId: ClientId): Promise<GrantRecord | undefined>;

  /** Mint grant id mới — thay cho crypto.randomUUID() trực tiếp trong use case. */
  newGrantId(): GrantId;

  /** Idempotent insert grant + scopes. Trả về id grant (cũ hoặc mới). */
  insertGrantIfAbsent(input: {
    grantId: GrantId;
    subject: Subject;
    clientId: ClientId;
    scopes: readonly string[];
  }): Promise<GrantId>;

  /** Ghi quyết định consent (append-only). */
  insertConsentDecision(input: {
    transactionId: TransactionId;
    subject: Subject;
    clientId: ClientId;
    decision: ConsentDecision;
    scopes: readonly string[];
  }): Promise<void>;

  /**
   * Nguồn chân lý duy nhất cho "consent đã quyết chưa" — tra theo transaction identity
   * (không theo event id), phục vụ replay idempotency.
   */
  findCommittedConsentDecision(
    transactionId: TransactionId,
  ): Promise<{ decision: ConsentDecision } | undefined>;

  /**
   * Nguyên tử revoke: CAS revoke grant + ghi client-level revocation vào token_revocations.
   * Một transaction DB duy nhất — không partial state.
   */
  revokeGrantWithClientRevocation(input: {
    grantId: GrantId;
    subject: Subject;
    clientId: ClientId;
    source: string;
  }): Promise<CasOutcome>;

  /** Danh sách connected applications của subject. */
  listConnectedApplications(subject: Subject): Promise<
    readonly {
      clientId: ClientId;
      grantId: GrantId;
      scopes: readonly string[];
      grantedAt: Date;
    }[]
  >;
}
