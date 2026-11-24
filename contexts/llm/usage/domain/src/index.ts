/**
 * `@ecoma-io/llm-usage-domain` — tầng domain thuần của bounded context `llm-usage`
 * (usage measurement, normalization, token accounting, correction, reconciliation).
 *
 * Thuần khiết:
 * - **Không** import Nx project khác ngoài `@ecoma-io/domain-primitives`.
 * - **Không** SQL, **không** Node builtin, **không** I/O.
 * - Mọi tham số thời gian do caller truyền vào; domain không đọc đồng hồ.
 * - Không provider SDK, không HTTP client, không DB driver, không ORM.
 * - Không import implementation bounded context khác.
 * - Không persistence, durable idempotency, alerting, event dispatch.
 * - Không sở hữu quota / reservation / settlement / credit / balance / ledger.
 *
 * Usage **measurement** (đo lường tiêu thụ) khác **financial charge** (tính tiền):
 * usage là dữ liệu đo lường; charge là quyết định tài chính của `llm-financial`.
 *
 * ## Ràng buộc chưa chốt — không âm thầm chốt trong lib này
 *
 * Các quyết định dưới đây vẫn OPEN — lib này không âm thầm chốt chúng.
 *
 * - **U-1**: Nhiều attempt completed — tổng hợp `sum` hay `last-wins`? `aggregateAttemptUsage`
 *   hiện tại dùng `sum` (hành vi interim), chưa được business xác nhận.
 * - **U-2**: Thứ tự correction, replacement vs merge, conflict trùng khóa. `isCorrectionValid`
 *   chỉ kiểm validity cơ bản, không implement ordering hay replacement.
 * - **U-3**: Mối quan hệ correction request-level vs attempt-level. `correctionIdempotencyKey`
 *   hỗ trợ cả hai scope độc lập, không suy luận mối quan hệ.
 * - **U-4**: Ngưỡng so sánh reconciliation (tolerance). `reconcile` so sánh exact, không sai số.
 */

export type { AttemptId, CorrectionId, RequestId, ReservationId } from './shared/ids';
export {
  type AttemptUsage,
  type Correction,
  type DomainError,
  type DomainErrorCode,
  type NormalizedUsage,
  type ParsedProviderUsage,
  type Provenance,
  type RequestUsage,
  type ReconciliationResult,
  type TokenCount,
  USAGE_STATUS,
  type UsageStatus,
} from './shared/types';
export {
  domainErrorKeys,
  isLLMUsageDomainError,
  llmUsageDomainError,
  LLM_USAGE_DOMAIN_ERROR_MESSAGES,
  type LLMUsageDomainError,
} from './shared/errors';
export {
  computeTotalTokens,
  createNormalizedUsage,
  isNormalizedUsage,
  isValidTokenCount,
  validateUsageInvariants,
} from './normalized-usage/normalized-usage';
export { createProvenance, isProvenance } from './attempt-usage/provenance';
export { normalizeUsage } from './normalized-usage/normalize';
export { classifyUsage } from './normalized-usage/classify';
export { aggregateAttemptUsage } from './attempt-usage/aggregate';
export { correctionIdempotencyKey, isCorrection, isCorrectionValid } from './correction/correction';
export { reconcile } from './reconcile/reconcile';
