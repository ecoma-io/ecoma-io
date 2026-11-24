/**
 * Record budget escrow — tiền earmark cho một consumer trong một khoảng thời
 * gian.
 *
 * Escrow thực sự giữ tiền trong wallet (`available → held`), nên unused escrow
 * là **held money**, không phải outstanding liability (invariant 12). Lease được
 * cấp từ phần escrow chưa allocate.
 */

import { isBudgetLease, type BudgetLease } from '../lease/lease-record';
import { isMoney, type Denomination, type Money } from '../money/money';
import {
  isEpochMillis,
  isOpaqueId,
  type BillingAccountId,
  type FencingToken,
  type WalletId,
} from '../shared/shared';

/** Trạng thái suy ra của escrow: còn mở hay đã release. */
export const ESCROW_STATES = ['open', 'released'] as const;

/** Trạng thái escrow. */
export type EscrowState = (typeof ESCROW_STATES)[number];

/** Type guard cho `EscrowState`. */
export function isEscrowState(value: unknown): value is EscrowState {
  return typeof value === 'string' && (ESCROW_STATES as readonly string[]).includes(value);
}

/**
 * Budget escrow — tiền earmark cho một consumer trong một khoảng thời gian.
 *
 * Escrow thực sự giữ tiền trong wallet (`available → held`), nên unused escrow
 * là **held money**, không phải outstanding liability (invariant 12). Lease được
 * cấp từ phần escrow chưa allocate.
 */
export interface BudgetEscrow {
  readonly escrow_id: string;
  readonly wallet_id: WalletId;
  readonly billing_account_id: BillingAccountId;
  readonly denomination: Denomination;
  readonly amount: Money;
  readonly leases: readonly BudgetLease[];
  readonly created_at: number;
  readonly fencing_token: FencingToken;
  /** Thời điểm escrow được trả phần chưa dùng về available; `null` khi còn mở. */
  readonly released_at: number | null;
  /** Bằng chứng reconciliation cho phép release — bắt buộc khi `released_at` khác `null`. */
  readonly reconciliation_ref: string | null;
}

/** Type guard cho `BudgetEscrow`. */
export function isBudgetEscrow(value: unknown): value is BudgetEscrow {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<BudgetEscrow>;
  return (
    isOpaqueId(record.escrow_id) &&
    isOpaqueId(record.wallet_id) &&
    isOpaqueId(record.billing_account_id) &&
    (record.denomination === 'UC' || record.denomination === 'EC') &&
    isMoney(record.amount) &&
    record.amount.denomination === record.denomination &&
    Array.isArray(record.leases) &&
    record.leases.every((lease) => isBudgetLease(lease) && lease.escrow_id === record.escrow_id) &&
    isEpochMillis(record.created_at) &&
    isOpaqueId(record.fencing_token) &&
    (record.released_at === null || isEpochMillis(record.released_at)) &&
    (record.reconciliation_ref === null || isOpaqueId(record.reconciliation_ref)) &&
    (record.released_at === null) === (record.reconciliation_ref === null)
  );
}
