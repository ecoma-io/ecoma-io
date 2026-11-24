/**
 * `@ecoma-io/llm-seller-pricing-domain` — value object, bất biến và phép tính
 * thuần của bounded context `llm-seller-pricing`: seller-configured customer
 * price, pricing schedule theo offer, per-request/per-token pricing, peak/off-peak
 * theo IANA timezone, versioning và pricing snapshot.
 *
 * Library này là nguồn chân lý hiện tại của bounded context.
 *
 * ## Ranh giới của library này
 *
 * - **Thuần**: không import Nx project khác, không SQL, không Node builtin,
 *   không I/O, không đọc đồng hồ. Mọi mốc thời gian do caller truyền vào
 *   (không đọc đồng hồ).
 * - **Chỉ định giá**: không reserve quota, không dispatch, không settle usage,
 *   không charge wallet, không giữ balance (invariant 13).
 * - **Không suy ra customer price**: giá seller cấu hình *là* customer price;
 *   provider cost là đại lượng độc lập và không phải input của library
 *   (`domains/README.md` §5.8).
 * - **Không có tier pricing**: không graduated/volume tier, threshold, bracket
 *   hay usage window. Pricing dimension chỉ có per-request và per-token.
 * - **Một currency**: không chuyển đổi currency hay đơn vị; một snapshot mang
 *   đúng một currency và một cặp scale.
 *
 * ## Bất biến không chốt trong library này
 *
 * - Pricing granularity giữa offer và normalized model: schedule được key theo
 *   **offer**. Library không
 *   mở rộng sang normalized model khi chưa có quyết định.
 * - Provider cost ownership/source: ngoài phạm vi, không có kiểu nào ở
 *   đây đại diện cho nó.
 */

export {
  LLM_PRICING_DOMAIN_ERROR_MESSAGES,
  isLlmPricingDomainError,
  llmPricingDomainError,
  type LlmPricingDomainError,
  type LlmPricingDomainErrorCode,
} from './shared/errors';
export {
  pricingFailure,
  pricingOk,
  type PricingFailure,
  type PricingOk,
  type PricingResult,
} from './shared/result';
export {
  AMOUNT_SCALE_MAX,
  MAX_FIXED_POINT_MAGNITUDE,
  PRICE_SCALE_MAX,
  ROUNDING_RULES,
  isAmountScale,
  isFixedPointAmount,
  isPriceScale,
  isRoundingRule,
  type RoundingRule,
} from './price/fixed-point';
export { isCurrencyCode } from './price/currency';
export { isEpochMillis } from './schedule/instant';
export { readOfferId, type OfferId } from './shared/offer-id';
export {
  isPriceSet,
  isResolvedPriceSet,
  isSubsetPriceRule,
  readPriceSet,
  readSubsetPriceRule,
  resolvePriceSet,
  type PriceSet,
  type ResolvedPriceSet,
  type SubsetPriceRule,
} from './price/price';
export {
  isIanaTimeZone,
  isPeakWindow,
  isWithinPeakWindow,
  readPeakWindow,
  type PeakWindow,
} from './schedule/peak-window';
export {
  isPricingSchedule,
  readPricingSchedule,
  type PeakPriceSet,
  type PricingSchedule,
} from './schedule/pricing-schedule';
export {
  appendPricingVersion,
  isPricingVersion,
  readPricingVersion,
  readPricingVersionHistory,
  selectApplicableVersion,
  type PricingVersion,
  type PricingVersionHistory,
} from './schedule/pricing-version';
export {
  isTokenUsage,
  readRequestCount,
  readTokenUsage,
  type TokenUsage,
} from './price/token-usage';
export { calculatePrice, type PriceCalculation, type PricedAmount } from './price/calculate-price';
export {
  PRICING_PERIODS,
  calculateSnapshotPrice,
  createPricingSnapshot,
  isPricingPeriod,
  readPricingSnapshot,
  resolvePricingSnapshot,
  type PricingPeriod,
  type PricingSnapshot,
} from './snapshot/pricing-snapshot';
