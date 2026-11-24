/**
 * Port catalogue offer trên marketplace — step 6 resolve model và `/v1/models`.
 * Implement thật là SQL `llm_marketplace.model_offers` (binding marketplace).
 */

/** Một offer active resolve theo model serving. */
export interface ActiveOffer {
  readonly id: string;
  readonly normalizedModelId: string;
  readonly sellerTenantId: string;
}

/** Một offer active cho catalogue công khai `/v1/models`. */
export interface CatalogueOffer {
  readonly normalizedModelId: string;
  readonly createdAtMillis: number;
  readonly sellerTenantId: string;
}

export interface OfferCatalogue {
  /** Offer active cho model; null khi không có (model_not_found). */
  findActiveOffer(model: string): Promise<ActiveOffer | null>;
  /** Toàn bộ offer active cho catalogue công khai `/v1/models`. */
  listActiveOffers(): Promise<readonly CatalogueOffer[]>;
  /** Ánh xạ seller tenant id → tên tenant công khai (binding gateway); thiếu mapping là lỗi catalogue. */
  listSellerTenantNames(): Promise<ReadonlyMap<string, string>>;
}
