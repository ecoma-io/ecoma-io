/**
 * Query catalogue model đang phục vụ cho `/v1/models` — business query over
 * {@link OfferCatalogue}. HTTP body-shape building (OpenAI `{"object":"list",...}`)
 * thuộc transport. Quy tắc fail-closed (ADR-0027 §7):
 * - Chỉ offer `active` được liệt kê.
 * - Offer `active` mà `seller_tenant_id` không ánh xạ được sang tenant ở
 *   gateway ⇒ lỗi catalogue (không liệt kê "mù" một model với owner không
 *   xác thực được).
 * - Catalogue rỗng là kết quả HỢP LỆ, không phải lỗi.
 */
import type { Query } from '@ecoma-io/usecase-primitives';

import type { OfferCatalogue } from '../ports/offer-catalogue.js';

/** Một model đang phục vụ trong catalogue công khai. */
export interface ServingModel {
  /** Normalized model id — định danh công khai trên `/v1/models`. */
  readonly id: string;
  /** Thời điểm offer được tạo, quy đổi ra giây epoch (quy ước OpenAI). */
  readonly created: number;
  /** Tên Seller tenant sở hữu offer — định danh công khai của owner. */
  readonly ownedBy: string;
}

export interface ListServingModelsInput {
  /** Không có tham số — catalogue toàn hệ thống. */
  readonly _brand?: undefined;
}

export interface ListServingModelsOutput {
  readonly models: readonly ServingModel[];
}

/** Alias contract cho type-level test. */
export type ListServingModelsUseCaseType = Query<ListServingModelsInput, ListServingModelsOutput>;

export class ListServingModelsQuery implements ListServingModelsUseCaseType {
  readonly #offers: OfferCatalogue;

  public constructor(offers: OfferCatalogue) {
    this.#offers = offers;
  }

  public async execute(_input: ListServingModelsInput): Promise<ListServingModelsOutput> {
    const offers = await this.#offers.listActiveOffers();
    if (offers.length === 0) {
      return { models: [] };
    }
    const tenants = await this.#offers.listSellerTenantNames();
    const models: ServingModel[] = offers.map((offer) => {
      const ownedBy = tenants.get(offer.sellerTenantId);
      if (ownedBy === undefined) {
        // Lỗi catalogue: offer active mà owner không xác thực được — fail-closed.
        throw new Error('model catalogue tenant mapping missing');
      }
      return {
        id: offer.normalizedModelId,
        // Truncate về 0 (millis epoch luôn dương trong thực tế).
        created: Math.trunc(offer.createdAtMillis / 1000),
        ownedBy,
      };
    });
    return { models };
  }
}
