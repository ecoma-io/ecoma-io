/**
 * Record budget lease — quyền tiêu liên tục trong một cửa sổ cho một consumer.
 *
 * Khác **quota lease**: lease tài chính không cấp quota token/request. `epoch`
 * là số đơn điệu do caller cấp; fencing token của lease cũ bị từ chối khi epoch
 * đã bị vượt qua.
 */

import { isMoney, type Money } from '../money/money';
import { isEpochMillis, isOpaqueId, type FencingToken } from '../shared/shared';

// Budget escrow & lease
// ---------------------------------------------------------------------------

/** Trạng thái budget lease — §4.3 của architecture. */
export const LEASE_STATES = ['active', 'expired', 'revoked', 'exhausted'] as const;

/** Trạng thái budget lease. */
export type LeaseState = (typeof LEASE_STATES)[number];

/** Type guard cho `LeaseState`. */
export function isLeaseState(value: unknown): value is LeaseState {
  return typeof value === 'string' && (LEASE_STATES as readonly string[]).includes(value);
}

/**
 * Budget lease — quyền tiêu liên tục trong một cửa sổ cho một consumer/key.
 *
 * Khác **quota lease**: lease tài chính không cấp quota token/request. `epoch` là
 * số đơn điệu do caller cấp; fencing token của lease cũ bị từ chối khi epoch đã
 * bị vượt qua.
 */
export interface BudgetLease {
  readonly lease_id: string;
  readonly escrow_id: string;
  readonly amount: Money;
  readonly epoch: number;
  readonly fencing_token: FencingToken;
  readonly state: LeaseState;
  readonly issued_at: number;
  readonly expires_at: number;
  /** Bằng chứng reconciliation đã cho phép reallocate escrow của lease này. */
  readonly reconciliation_ref: string | null;
  readonly reallocated_at: number | null;
}

/** Type guard cho `BudgetLease`. */
export function isBudgetLease(value: unknown): value is BudgetLease {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<BudgetLease>;
  return (
    isOpaqueId(record.lease_id) &&
    isOpaqueId(record.escrow_id) &&
    isMoney(record.amount) &&
    typeof record.epoch === 'number' &&
    Number.isSafeInteger(record.epoch) &&
    record.epoch >= 0 &&
    isOpaqueId(record.fencing_token) &&
    isLeaseState(record.state) &&
    isEpochMillis(record.issued_at) &&
    isEpochMillis(record.expires_at) &&
    (record.reconciliation_ref === null || isOpaqueId(record.reconciliation_ref)) &&
    (record.reallocated_at === null || isEpochMillis(record.reallocated_at))
  );
}
