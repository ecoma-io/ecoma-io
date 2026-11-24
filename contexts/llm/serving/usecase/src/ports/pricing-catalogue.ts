/**
 * Port catalogue pricing — step 8 (ADR-0028 §13.4 fail-closed khi thiếu/không
 * express được bằng VND). Implement thật là SQL `llm_seller.pricing_snapshots`.
 */

/** Snapshot giá active của một model serving. */
export interface ActivePricing {
  readonly snapshotId: string;
  readonly currency: string;
  readonly inputRatePerMillionMinor: bigint;
  readonly outputRatePerMillionMinor: bigint;
  readonly maxInputTokensPerRequest: bigint;
  readonly maxOutputTokensPerRequest: bigint;
}

export interface PricingCatalogue {
  findActivePricing(model: string): Promise<ActivePricing | null>;
}
