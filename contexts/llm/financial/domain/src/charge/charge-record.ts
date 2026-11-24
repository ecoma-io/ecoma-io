/**
 * Records của customer charge: charge, refund, adjustment — cùng type guard.
 *
 * Charge là append-only ở nghĩa không có operation nào sửa `amount`; refund và
 * adjustment là record mới, và charge tích luỹ tổng đã hoàn/đã điều chỉnh để
 * tính phần còn lại. Không record nào mang provider cost.
 */

import { isMoney, type Denomination, type Money } from '../money/money';
import {
  isEpochMillis,
  isOpaqueId,
  type BillingAccountId,
  type ChargeId,
  type FencingToken,
  type RefundId,
  type ReservationId,
  type SettlementId,
  type WalletId,
} from '../shared/shared';

/** Trạng thái customer charge — §4.5 của architecture. */
export const CHARGE_STATES = ['pending', 'posted', 'refunded', 'adjusted'] as const;

/** Trạng thái customer charge. */
export type ChargeState = (typeof CHARGE_STATES)[number];

/** Type guard cho `ChargeState`. */
export function isChargeState(value: unknown): value is ChargeState {
  return typeof value === 'string' && (CHARGE_STATES as readonly string[]).includes(value);
}

/**
 * Customer charge — khoản thu từ customer sau settlement.
 *
 * `amount` là **giá bán** (customer price), không phải provider cost. Charge là
 * append-only ở nghĩa không có operation nào sửa `amount`; refund và adjustment
 * là record mới, và charge giữ tổng đã hoàn/đã điều chỉnh để tính phần còn lại.
 */
export interface CustomerCharge {
  readonly charge_id: ChargeId;
  readonly wallet_id: WalletId;
  readonly billing_account_id: BillingAccountId;
  readonly denomination: Denomination;
  readonly amount: Money;
  readonly refunded: Money;
  readonly increase: Money;
  readonly decrease: Money;
  readonly state: ChargeState;
  readonly reservation_id: ReservationId | null;
  readonly settlement_id: SettlementId | null;
  readonly created_at: number;
  readonly posted_at: number | null;
}

/** Type guard cho `CustomerCharge`. */
export function isCustomerCharge(value: unknown): value is CustomerCharge {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<CustomerCharge>;
  return (
    isOpaqueId(record.charge_id) &&
    isOpaqueId(record.wallet_id) &&
    isOpaqueId(record.billing_account_id) &&
    (record.denomination === 'UC' || record.denomination === 'EC') &&
    isMoney(record.amount) &&
    isMoney(record.refunded) &&
    isMoney(record.increase) &&
    isMoney(record.decrease) &&
    isChargeState(record.state) &&
    (record.reservation_id === null || isOpaqueId(record.reservation_id)) &&
    (record.settlement_id === null || isOpaqueId(record.settlement_id)) &&
    isEpochMillis(record.created_at) &&
    (record.posted_at === null || isEpochMillis(record.posted_at)) &&
    record.amount.denomination === record.denomination
  );
}

/** Số tiền còn có thể hoàn của một charge: `amount + increase - decrease - refunded`. */
export function refundableAmount(charge: CustomerCharge): Money {
  const net = charge.amount.minor + charge.increase.minor;
  const used = charge.decrease.minor + charge.refunded.minor;
  const minor = net > used ? net - used : 0n;
  return Object.freeze({ denomination: charge.denomination, minor });
}

/** Refund — bút toán đảo của một phần customer charge. */
export interface Refund {
  readonly refund_id: RefundId;
  readonly charge_id: ChargeId;
  readonly wallet_id: WalletId;
  readonly amount: Money;
  readonly reason_ref: string | null;
  readonly created_at: number;
  readonly fencing_token: FencingToken;
}

/** Type guard cho `Refund`. */
export function isRefund(value: unknown): value is Refund {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<Refund>;
  return (
    isOpaqueId(record.refund_id) &&
    isOpaqueId(record.charge_id) &&
    isOpaqueId(record.wallet_id) &&
    isMoney(record.amount) &&
    (record.reason_ref === null || isOpaqueId(record.reason_ref)) &&
    isEpochMillis(record.created_at) &&
    isOpaqueId(record.fencing_token)
  );
}

/** Chiều điều chỉnh một charge. */
export type AdjustmentDirection = 'increase' | 'decrease';

/** Type guard cho `AdjustmentDirection`. */
export function isAdjustmentDirection(value: unknown): value is AdjustmentDirection {
  return value === 'increase' || value === 'decrease';
}

/** Adjustment — sửa sai một charge bằng bút toán mới, không sửa charge cũ. */
export interface ChargeAdjustment {
  readonly adjustment_id: string;
  readonly charge_id: ChargeId;
  readonly wallet_id: WalletId;
  readonly direction: AdjustmentDirection;
  readonly amount: Money;
  readonly reason_ref: string | null;
  readonly created_at: number;
  readonly fencing_token: FencingToken;
}

/** Type guard cho `ChargeAdjustment`. */
export function isChargeAdjustment(value: unknown): value is ChargeAdjustment {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<ChargeAdjustment>;
  return (
    isOpaqueId(record.adjustment_id) &&
    isOpaqueId(record.charge_id) &&
    isOpaqueId(record.wallet_id) &&
    isAdjustmentDirection(record.direction) &&
    isMoney(record.amount) &&
    (record.reason_ref === null || isOpaqueId(record.reason_ref)) &&
    isEpochMillis(record.created_at) &&
    isOpaqueId(record.fencing_token)
  );
}
