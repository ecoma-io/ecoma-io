/**
 * Phase 12 — settlement/release theo evidence, MỘT transaction gateway:
 * - confirmed_completed + completion + usage known → settle charge ≤ held;
 * - confirmed_completed + completion + usage missing/malformed → settle capped
 *   tại held + audit `financial_charge_capped` (không bao giờ ngầm 0);
 * - may_have_executed → settle capped tại held, request failed (F5);
 * - confirmed_not_executed → release financial + release quota (compensation
 *   idempotent), request failed.
 * Charge 0 (usage 0 token) → release toàn bộ giữ, không có charge row.
 * Idempotent identities: settlement id tất định từ (request_id, attempt_id)
 * (invariant 9); evidence chỉ strengthen — regression là lỗi state fail-closed.
 */
import {
  compareMoney,
  release,
  settle,
  admissionUpperBoundAmount,
  createMoney,
  type Money,
} from '@ecoma-io/llm-financial-domain';
import type { Command } from '@ecoma-io/usecase-primitives';

import type { Clock } from '../ports/clock.js';
import type { FinancialGateway } from '../ports/financial-gateway.js';
import type { QuotaLedger } from '../ports/quota-ledger.js';
import type { ServingJournal } from '../ports/serving-journal.js';
import type { ClassifiedUpstreamOutcome, UpstreamCompletion } from '../dispatch/dispatch.js';
import { evidenceCanTransition } from '../dispatch/dispatch.js';

/** Denomination serving của MVP: UC. */
const SERVING_DENOMINATION = 'UC' as const;

/** Mã failure settlement — mirror mã ApiError cũ nhưng KHÔNG HTTP. */
export type FinalizeFailureCode = 'rate_limit_exceeded' | 'upstream_error' | 'service_unavailable';

/** Usage resolution của finalization — đã chuyển bigint từ classified outcome. */
export type FinalizeUsage =
  | { readonly status: 'known'; readonly inputTokens: bigint; readonly outputTokens: bigint }
  | { readonly status: 'missing' }
  | { readonly status: 'malformed' };

export interface FinalizeAttemptInput {
  readonly requestId: string;
  readonly tenantId: string;
  readonly attemptId: string;
  readonly quotaReservationId: string;
  readonly financialReservationId: string;
  readonly settlementId: string;
  readonly chargeId: string;
  readonly holdTokens: bigint;
  readonly inputRatePerMillionMinor: bigint;
  readonly outputRatePerMillionMinor: bigint;
  readonly classified: ClassifiedUpstreamOutcome;
  readonly upstreamRetryAfter: number | null;
}

export interface FinalizedCompleted {
  readonly kind: 'completed';
  readonly completion: UpstreamCompletion;
  readonly chargeMinor: bigint;
}

export interface FinalizedFailed {
  readonly kind: 'failed';
  readonly code: FinalizeFailureCode;
  readonly retryAfterSeconds: number | null;
}

export type FinalizeOutcome = FinalizedCompleted | FinalizedFailed;

/** Alias contract cho type-level test. */
export type FinalizeAttemptUseCaseType = Command<FinalizeAttemptInput, FinalizeOutcome>;

/** Deps của {@link FinalizeAttemptCommand}. */
export interface FinalizeAttemptDeps {
  readonly quota: QuotaLedger;
  readonly financial: FinancialGateway;
  readonly journal: ServingJournal;
  readonly clock: Clock;
}

/** Chuyển classified usage resolution thành FinalizeUsage (bigint). */
export function toFinalizeUsage(classified: ClassifiedUpstreamOutcome): FinalizeUsage {
  const usage = classified.usage;
  if (
    usage.status === 'known' &&
    usage.usage.input_tokens !== null &&
    usage.usage.output_tokens !== null
  ) {
    return {
      status: 'known',
      inputTokens: BigInt(usage.usage.input_tokens),
      outputTokens: BigInt(usage.usage.output_tokens),
    };
  }
  return usage.status === 'malformed' ? { status: 'malformed' } : { status: 'missing' };
}

/**
 * Command settlement/release (phase 12). Mọi persist trong MỘT gateway
 * transaction (adapter đảm bảo quota + financial + journal cùng transaction).
 */
export class FinalizeAttemptCommand implements FinalizeAttemptUseCaseType {
  readonly #quota: QuotaLedger;
  readonly #financial: FinancialGateway;
  readonly #journal: ServingJournal;
  readonly #clock: Clock;

  public constructor(deps: FinalizeAttemptDeps) {
    this.#quota = deps.quota;
    this.#financial = deps.financial;
    this.#journal = deps.journal;
    this.#clock = deps.clock;
  }

  public async execute(input: FinalizeAttemptInput): Promise<FinalizeOutcome> {
    const now = this.#clock.now();
    const usage = toFinalizeUsage(input.classified);
    const usageKnown = usage.status === 'known';
    const notExecuted = input.classified.evidence === 'confirmed_not_executed';
    const executed = !notExecuted && input.classified.completion !== null;
    const degradedExecution = !notExecuted && input.classified.completion === null; // 200 malformed / may_have_executed

    const finalEvidence = notExecuted
      ? 'confirmed_not_executed'
      : input.classified.evidence === 'confirmed_completed'
        ? 'confirmed_completed'
        : 'may_have_executed';

    try {
      const outcome = await this.#financial.inTransaction(
        { tenantId: input.tenantId },
        async (state) => {
          const knownTransactionIds = new Set(
            state.book.ledger.transactions.map((transaction) => transaction.transaction_id),
          );

          let chargeMinor = 0n;
          if (!notExecuted) {
            // Cận charge thật theo usage khi known; missing/malformed → cap tại held.
            let chargeAmount: Money | null = null;
            if (usageKnown && usage.status === 'known') {
              const upper = admissionUpperBoundAmount({
                denomination: SERVING_DENOMINATION,
                perRequestMinor: 0n,
                inputRatePerMillionMinor: input.inputRatePerMillionMinor,
                outputRatePerMillionMinor: input.outputRatePerMillionMinor,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
              });
              // Lỗi compute → an toàn hơn là cap tại held (cận trên luôn đủ).
              chargeAmount = upper.ok ? upper.value : null;
            }
            const reservation = state.book.reservations.find(
              (candidate) => candidate.reservation_id === input.financialReservationId,
            );
            if (reservation === undefined) {
              // State tài chính không tìm thấy reservation đang thao tác — không
              // thể xảy ra trên đường lành; fail-closed.
              throw new Error('financial reservation state missing during finalize');
            }
            const capped =
              chargeAmount === null
                ? reservation.reserved
                : (compareMoney(chargeAmount, reservation.reserved) ?? 1) <= 0
                  ? chargeAmount
                  : reservation.reserved;
            chargeMinor = capped.minor;
            if (chargeMinor > 0n) {
              const settleOutcome = settle(state.book, {
                settlementId: input.settlementId,
                reservationId: input.financialReservationId,
                chargeId: input.chargeId,
                chargeAmount: capped,
                settledAt: now,
                fencingToken: state.walletFencingToken,
                seller: null, // first-party: tự phục vụ — không payable (ADR-0028 §7.1)
              });
              if (!settleOutcome.ok) {
                if (
                  settleOutcome.error.code === 'insufficient_held_balance' ||
                  settleOutcome.error.code === 'invalid_settlement'
                ) {
                  throw new Error(`settle rejected: ${settleOutcome.error.code}`);
                }
                throw new Error('financial reservation state missing during finalize');
              }
              await this.#financial.commit({
                book: settleOutcome.value.book,
                knownTransactionIds,
                reservations: [
                  settleOutcome.value.book.reservations.find(
                    (candidate) => candidate.reservation_id === input.financialReservationId,
                  ),
                ].filter(
                  (candidate): candidate is NonNullable<typeof candidate> =>
                    candidate !== undefined,
                ),
                charges: [settleOutcome.value.charge],
              });
              const wasCapped =
                chargeAmount === null ||
                (compareMoney(chargeAmount, reservation.reserved) ?? 1) > 0;
              if (wasCapped) {
                // Semantics `financial_charge_capped` — caller (transport) quyết
                // định escalation/alert; usecase chỉ giữ kết quả capped.
              }
            } else {
              // Charge 0: release toàn bộ giữ (không có gì để capture).
              const releaseOutcome = release(state.book, {
                reservationId: input.financialReservationId,
                releasedAt: now,
                fencingToken: state.walletFencingToken,
              });
              if (!releaseOutcome.ok) {
                throw new Error('financial reservation state missing during finalize');
              }
              await this.#financial.commit({
                book: releaseOutcome.value.book,
                knownTransactionIds,
                reservations: [releaseOutcome.value.reservation],
                charges: [],
              });
            }
          } else {
            const releaseOutcome = release(state.book, {
              reservationId: input.financialReservationId,
              releasedAt: now,
              fencingToken: state.walletFencingToken,
            });
            if (!releaseOutcome.ok) {
              throw new Error('financial reservation state missing during finalize');
            }
            await this.#financial.commit({
              book: releaseOutcome.value.book,
              knownTransactionIds,
              reservations: [releaseOutcome.value.reservation],
              charges: [],
            });
          }

          // Quota settle/release — conservative khi usage unknown (settled_tokens = estimate).
          if (notExecuted) {
            await this.#quota.release(input.quotaReservationId);
          } else {
            const actualTokens =
              usageKnown && usage.status === 'known'
                ? usage.inputTokens + usage.outputTokens
                : input.holdTokens;
            await this.#quota.settle({
              reservationId: input.quotaReservationId,
              settledTokens: actualTokens,
            });
          }

          // Guard evidence: evidence chỉ strengthen (llm-inference-domain) — attempt
          // đang `not_sent` nhận mọi evidence cuối; một attempt đã terminal thì
          // transition trái chiều là lỗi state, fail-closed.
          const currentEvidence = await this.#journal.readAttemptEvidence(input.attemptId);
          if (currentEvidence !== null && !evidenceCanTransition(currentEvidence, finalEvidence)) {
            throw new Error('evidence regression');
          }
          const inputTokens = usageKnown && usage.status === 'known' ? usage.inputTokens : null;
          const outputTokens = usageKnown && usage.status === 'known' ? usage.outputTokens : null;
          await this.#journal.recordFinalization({
            requestId: input.requestId,
            attemptId: input.attemptId,
            finalEvidence,
            usageStatus: usage.status,
            inputTokens,
            outputTokens,
            chargeMinor,
            requestStatus: executed ? 'completed' : 'failed',
            errorCode: executed
              ? null
              : notExecuted && input.upstreamRetryAfter !== null
                ? 'rate_limit_exceeded'
                : 'upstream_error',
            endedAt: now,
          });

          if (executed && input.classified.completion !== null) {
            return {
              kind: 'completed',
              completion: input.classified.completion,
              chargeMinor,
            } satisfies FinalizedCompleted;
          }
          if (notExecuted && input.upstreamRetryAfter !== null) {
            return {
              kind: 'failed',
              code: 'rate_limit_exceeded',
              retryAfterSeconds: input.upstreamRetryAfter,
            } satisfies FinalizedFailed;
          }
          return {
            kind: 'failed',
            code: 'upstream_error',
            retryAfterSeconds: null,
          } satisfies FinalizedFailed;
        },
      );
      // `degradedExecution` (200-malformed hoặc may_have_executed): escalate
      // theo F5 — usecase không log; transport quyết định escalation/alert.
      void degradedExecution;
      return outcome;
    } catch {
      // Lỗi hạ tầng giữa transaction: rollback đã chạy ở gateway — fail-closed.
      return { kind: 'failed', code: 'service_unavailable', retryAfterSeconds: null };
    }
  }
}

/** So sánh Money tiện dụng — re-export from domain lib. */
export { compareMoney, createMoney };
