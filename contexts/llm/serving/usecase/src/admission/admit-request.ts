/**
 * Phase 10 — MỘT transaction gateway cho toàn bộ admission: replay pre-check,
 * trần quota, reserve quota (identity từ request_id), reserve financial
 * (identity từ (request_id, attempt_id)) trong gateway transaction, persist
 * journal. Financial từ chối → release quota reservation idempotent trong cùng
 * transaction (compensation, invariant 1). Outcomes là discriminated union
 * KHÔNG HTTP — transport maps failure codes sang status + OpenAI envelope.
 */
import { reserve, type Money } from '@ecoma-io/llm-financial-domain';
import type { Command } from '@ecoma-io/usecase-primitives';

import type { Clock } from '../ports/clock.js';
import type { FinancialGateway } from '../ports/financial-gateway.js';
import type { QuotaLedger } from '../ports/quota-ledger.js';
import type { ServingJournal } from '../ports/serving-journal.js';
import {
  deriveAttemptId,
  deriveChargeId,
  deriveFinancialReservationId,
  deriveQuotaReservationId,
  deriveSettlementId,
} from '../identity/identity.js';

/** Mã failure admission — mirror mã ApiError cũ nhưng KHÔNG HTTP. */
export type AdmitFailureCode =
  | 'request_id_replay'
  | 'idempotency_conflict'
  | 'insufficient_quota'
  | 'insufficient_funds'
  | 'service_unavailable';

export interface AdmitRequestInput {
  readonly requestId: string;
  readonly tenantId: string;
  readonly apiKeyId: string;
  /** sha256 hex của canonical JSON body — đã compute ở orchestration trước. */
  readonly payloadHash: string;
  readonly requestedModel: string;
  readonly offerId: string;
  readonly sellerTenantId: string;
  readonly pricingSnapshotId: string;
  readonly upstreamEndpointUrl: string;
  /** Cận trên số tiền admission (ADR-0028 §5) — đã tính bởi validate module. */
  readonly holdAmount: Money;
  readonly holdTokens: bigint;
  readonly inputRatePerMillionMinor: bigint;
  readonly outputRatePerMillionMinor: bigint;
  readonly attemptNo: number;
}

export interface AdmittedAttempt {
  readonly kind: 'admitted';
  readonly attemptId: string;
  readonly quotaReservationId: string;
  readonly financialReservationId: string;
  readonly settlementId: string;
  readonly chargeId: string;
  /** Số tiền thực sự được giữ (reservation reserved) — input cho settlement. */
  readonly reservedMinor: bigint;
  readonly inputRatePerMillionMinor: bigint;
  readonly outputRatePerMillionMinor: bigint;
  readonly holdTokens: bigint;
}

export interface AdmitFailure {
  readonly kind: 'rejected';
  readonly code: AdmitFailureCode;
}

export type AdmitOutcome = AdmittedAttempt | AdmitFailure;

/** Alias contract cho type-level test. */
export type AdmitRequestUseCaseType = Command<AdmitRequestInput, AdmitOutcome>;

/** Deps của {@link AdmitRequestCommand} — inject qua constructor deps object. */
export interface AdmitRequestDeps {
  readonly quota: QuotaLedger;
  readonly financial: FinancialGateway;
  readonly journal: ServingJournal;
  readonly clock: Clock;
}

/**
 * Command admission serving (phase 10). Mọi state bền thay đổi trong MỘT
 * gateway transaction (adapter đảm bảo QuotaLedger + ServingJournal +
 * FinancialGateway chia sẻ cùng persistence transaction). Ids tất định.
 */
export class AdmitRequestCommand implements AdmitRequestUseCaseType {
  readonly #quota: QuotaLedger;
  readonly #financial: FinancialGateway;
  readonly #journal: ServingJournal;
  readonly #clock: Clock;

  public constructor(deps: AdmitRequestDeps) {
    this.#quota = deps.quota;
    this.#financial = deps.financial;
    this.#journal = deps.journal;
    this.#clock = deps.clock;
  }

  public async execute(input: AdmitRequestInput): Promise<AdmitOutcome> {
    const now = this.#clock.now();
    const attemptId = deriveAttemptId(input.requestId, input.attemptNo);
    const quotaReservationId = deriveQuotaReservationId(input.requestId);
    const financialReservationId = deriveFinancialReservationId(input.requestId, attemptId);
    const settlementId = deriveSettlementId(input.requestId, attemptId);
    const chargeId = deriveChargeId(input.requestId, attemptId);

    // Replay pre-check — nhanh, read-only, trước admission (invariant 3).
    const existingHash = await this.#journal.findPayloadHash({
      requestId: input.requestId,
      tenantId: input.tenantId,
    });
    if (existingHash !== null) {
      return {
        kind: 'rejected',
        code: existingHash === input.payloadHash ? 'request_id_replay' : 'idempotency_conflict',
      };
    }

    // Trần quota operational: khoá để tính (ensure row ceiling là trách nhiệm adapter).
    const quota = await this.#quota.read(input.tenantId);
    const tokensCommitted = quota.settledTokens + quota.heldActiveTokens;
    if (tokensCommitted + input.holdTokens > quota.tokenCeiling) {
      return { kind: 'rejected', code: 'insufficient_quota' };
    }

    // Reserve quota DURABLE (identity từ request_id) — invariant 1. Cố ý gọi
    // NGOÀI transaction gateway: reserve chạy trước để fail-fast khỏi trần
    // quota mà không mở transaction; compensation release trong catch (và trong
    // path insufficient_funds) là lưới an toàn thứ hai. Dưới Kịch bản A hai
    // thao tác vẫn nằm chung MỘT DB transaction ở adapter — atomicity do
    // FinancialGateway.inTransaction đảm bảo cho cả QuotaLedger.
    await this.#quota.reserve({
      reservationId: quotaReservationId,
      requestId: input.requestId,
      tenantId: input.tenantId,
      tokenAmount: input.holdTokens,
    });

    // Financial admission trong transaction gateway — identity thứ hai
    // (request_id, attempt_id).
    try {
      return await this.#financial.inTransaction({ tenantId: input.tenantId }, async (state) => {
        const reservationOutcome = reserve(state.book, {
          reservationId: financialReservationId,
          walletId: state.walletId,
          billingAccountId: state.billingAccountId,
          amount: input.holdAmount,
          createdAt: now,
          fencingToken: state.walletFencingToken,
        });
        if (!reservationOutcome.ok) {
          if (reservationOutcome.error.code === 'insufficient_available_balance') {
            // Compensation idempotent: release quota reservation (cùng transaction).
            await this.#quota.release(quotaReservationId);
            return { kind: 'rejected', code: 'insufficient_funds' } satisfies AdmitFailure;
          }
          if (reservationOutcome.error.code === 'idempotency_conflict') {
            return { kind: 'rejected', code: 'request_id_replay' } satisfies AdmitFailure;
          }
          // stale_fencing_token / state hỏng — fail-closed.
          return { kind: 'rejected', code: 'service_unavailable' } satisfies AdmitFailure;
        }
        await this.#financial.commit({
          book: reservationOutcome.value.book,
          knownTransactionIds: new Set(
            state.book.ledger.transactions.map((transaction) => transaction.transaction_id),
          ),
          reservations: [reservationOutcome.value.reservation],
          charges: [],
        });

        // Journal: logical request + attempt (evidence not_sent) TRƯỚC dispatch.
        const recorded = await this.#journal.recordAdmission({
          requestId: input.requestId,
          tenantId: input.tenantId,
          apiKeyId: input.apiKeyId,
          payloadHash: input.payloadHash,
          requestedModel: input.requestedModel,
          offerId: input.offerId,
          sellerTenantId: input.sellerTenantId,
          pricingSnapshotId: input.pricingSnapshotId,
          attemptId,
          attemptNo: input.attemptNo,
          upstreamEndpointUrl: input.upstreamEndpointUrl,
          quotaReservationId,
          financialReservationId,
          settlementId,
          chargeId,
          amountMinor: reservationOutcome.value.reservation.reserved.minor,
          createdAt: now,
        });
        if (recorded.kind === 'replay') {
          // Concurrent duplicate cùng request_id — replay path (invariant 3).
          return { kind: 'rejected', code: 'request_id_replay' } satisfies AdmitFailure;
        }
        return {
          kind: 'admitted',
          attemptId,
          quotaReservationId,
          financialReservationId,
          settlementId,
          chargeId,
          reservedMinor: reservationOutcome.value.reservation.reserved.minor,
          inputRatePerMillionMinor: input.inputRatePerMillionMinor,
          outputRatePerMillionMinor: input.outputRatePerMillionMinor,
          holdTokens: input.holdTokens,
        } satisfies AdmittedAttempt;
      });
    } catch {
      // Lỗi hạ tầng giữa transaction (billing account thiếu, state hỏng):
      // rollback đã chạy ở gateway — fail-closed. Compensation quota vẫn phải
      // chạy: sự cố một phía không được treo reservation quota vĩnh viễn
      // (invariant 1 — release idempotent, no-op khi chưa reserve).
      // Kịch bản A: release này nằm trong cùng DB transaction bị rollback ở
      // gateway — nếu rollback đã xóa reserve thì release là no-op idempotent,
      // nếu reserve chạy ở session khác thì release vẫn dọn được nó.
      await this.#quota.release(quotaReservationId);
      return { kind: 'rejected', code: 'service_unavailable' };
    }
  }
}
