/**
 * Application contracts của tầng usecase serving.
 * Brand các identifier: reuse brand từ domain lib khi domain đã brand id đó —
 * không re-brand. Không phục vụ trực tiếp HTTP DTO, DB record hay domain snapshot.
 */

import type { Brand } from '@ecoma-io/domain-primitives';

import type {
  FencingToken,
  Money,
  ReservationId,
  SettlementId,
  ChargeId,
} from '@ecoma-io/llm-financial-domain';

// ---------------------------------------------------------------------------
// Ids — reuse domain brands khi đã có
// ---------------------------------------------------------------------------

/** Id logical request của serving path (opaque 1..200 ký tự). */
export type RequestId = Brand<string, 'RequestId'>;
/** Id attempt của một logical request. */
export type AttemptId = Brand<string, 'AttemptId'>;
/** Id quota reservation — identity thứ nhất, suy từ request_id. */
export type QuotaReservationId = Brand<string, 'QuotaReservationId'>;
/** Id API key row ở gateway. */
export type ApiKeyId = Brand<string, 'ApiKeyId'>;
/** Id seller tenant của offer. */
export type SellerTenantId = Brand<string, 'SellerTenantId'>;
/** Id offer active trên marketplace. */
export type OfferId = Brand<string, 'OfferId'>;
/** Id pricing snapshot active. */
export type PricingSnapshotId = Brand<string, 'PricingSnapshotId'>;
/** Id billing account của tenant. */
export type BillingAccountId = Brand<string, 'BillingAccountId'>;

export type {
  FencingToken,
  ReservationId as FinancialReservationId,
  SettlementId,
  ChargeId,
  Money,
};
