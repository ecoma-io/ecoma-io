/**
 * Record reservation — giữ tiền trong wallet (`available → held`).
 *
 * State machine (§4.2): `reserved → captured | released | expired`. Payload là
 * dữ liệu caller cấp hoặc domain suy ra tất định; record không mang provider
 * cost.
 */

import { isMoney, type Denomination, type Money } from '../money/money';
import {
  isEpochMillis,
  isOpaqueId,
  type BillingAccountId,
  type FencingToken,
  type ReservationId,
  type WalletId,
} from '../shared/shared';

// Reservation
// ---------------------------------------------------------------------------

/** Trạng thái reservation — §4.2 của architecture. */
export const RESERVATION_STATES = ['reserved', 'captured', 'released', 'expired'] as const;

/** Trạng thái reservation. */
export type ReservationState = (typeof RESERVATION_STATES)[number];

/** Type guard cho `ReservationState`. */
export function isReservationState(value: unknown): value is ReservationState {
  return typeof value === 'string' && (RESERVATION_STATES as readonly string[]).includes(value);
}

/** Reservation giữ tiền trong wallet: `available → held`. */
export interface Reservation {
  readonly reservation_id: ReservationId;
  readonly wallet_id: WalletId;
  readonly billing_account_id: BillingAccountId;
  readonly denomination: Denomination;
  /** Số tiền đã giữ khi reserve. */
  readonly reserved: Money;
  /** Số tiền đã capture (chuyển sang `charged`). */
  readonly captured: Money;
  /** Số tiền đã release (trả về `available`). */
  readonly released: Money;
  readonly state: ReservationState;
  readonly created_at: number;
  readonly finalized_at: number | null;
  readonly fencing_token: FencingToken;
}

/** Type guard cho `Reservation`. */
export function isReservation(value: unknown): value is Reservation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<Reservation>;
  return (
    isOpaqueId(record.reservation_id) &&
    isOpaqueId(record.wallet_id) &&
    isOpaqueId(record.billing_account_id) &&
    (record.denomination === 'UC' || record.denomination === 'EC') &&
    isMoney(record.reserved) &&
    isMoney(record.captured) &&
    isMoney(record.released) &&
    isReservationState(record.state) &&
    isEpochMillis(record.created_at) &&
    (record.finalized_at === null || isEpochMillis(record.finalized_at)) &&
    isOpaqueId(record.fencing_token) &&
    record.reserved.denomination === record.denomination
  );
}
