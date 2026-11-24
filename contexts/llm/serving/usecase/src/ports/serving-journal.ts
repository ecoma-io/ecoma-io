/**
 * Port serving journal — journal `llm_gateway.logical_requests` + `attempts`,
 * metadata only. Persist admission TRƯỚC dispatch (lệ ngoại duy nhất của
 * "no DB write for decisioning"); persist finalization sau settlement.
 *
 * Adapter bắt buộc: mọi operation chạy TRONG CÙNG persistence transaction với
 * QuotaLedger và FinancialGateway của cùng một admission/finalization (gateway
 * DB duy nhất, hợp đồng Kịch bản A) — operation có thể được gọi trong khi
 * transaction gateway đang mở và phải tham gia nó; atomicity là trách nhiệm
 * adapter.
 */
import type { ExecutionEvidence, UsageStatus } from './inference-usage.js';

/** Payload journal finalization — metadata only, không bao giờ body prompt/response. */
export interface AttemptFinalizationRecord {
  readonly requestId: string;
  readonly attemptId: string;
  readonly finalEvidence: ExecutionEvidence;
  readonly usageStatus: UsageStatus;
  readonly inputTokens: bigint | null;
  readonly outputTokens: bigint | null;
  readonly chargeMinor: bigint;
  readonly requestStatus: 'completed' | 'failed';
  readonly errorCode: string | null;
  readonly endedAt: number;
}

export interface ServingJournal {
  /**
   * Replay pre-check: trả payload_hash của logical_requests row hiện có, hoặc
   * null khi chưa có (invariant 3).
   */
  findPayloadHash(input: { requestId: string; tenantId: string }): Promise<string | null>;
  /**
   * Persist logical_requests (status admitted) + attempts (evidence `not_sent`)
   * TRƯỚC dispatch. Row logical_requests đã tồn tại (concurrent duplicate cùng
   * request_id) → trả 'replay' (invariant 3).
   */
  recordAdmission(input: {
    requestId: string;
    tenantId: string;
    apiKeyId: string;
    payloadHash: string;
    requestedModel: string;
    offerId: string;
    sellerTenantId: string;
    pricingSnapshotId: string;
    attemptId: string;
    attemptNo: number;
    upstreamEndpointUrl: string;
    quotaReservationId: string;
    financialReservationId: string;
    settlementId: string;
    chargeId: string;
    amountMinor: bigint;
    createdAt: number;
  }): Promise<{ readonly kind: 'recorded' } | { readonly kind: 'replay' }>;
  /** Đọc evidence hiện tại của attempt — guard regression (evidence chỉ strengthen). */
  readAttemptEvidence(attemptId: string): Promise<ExecutionEvidence | null>;
  /** Persist finalization metadata (attempts + logical_requests update). */
  recordFinalization(record: AttemptFinalizationRecord): Promise<void>;
}
