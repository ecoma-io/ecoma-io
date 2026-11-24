/**
 * Record seller payable — projection nghĩa vụ phải trả cho seller.
 *
 * Không phải payout: không có beneficiary, không có fiat disbursement, và `paid`
 * chỉ là state sau khi caller cấp bằng chứng payout. Append-only theo version:
 * mỗi transition thêm một record cùng `payable_id` với `version + 1`;
 * `latestPayable` trả version cao nhất.
 */

import { isMoney, type Money } from '../money/money';
import {
  isEpochMillis,
  isOpaqueId,
  type ChargeId,
  type FencingToken,
  type PayableId,
  type PayoutEvidenceRef,
  type SettlementId,
  type TenantRef,
} from '../shared/shared';

/** Trạng thái seller payable — §4.4 của architecture. */
export const PAYABLE_STATES = ['accrued', 'settled', 'paid', 'adjusted'] as const;

/** Trạng thái seller payable. */
export type PayableState = (typeof PAYABLE_STATES)[number];

/** Type guard cho `PayableState`. */
export function isPayableState(value: unknown): value is PayableState {
  return typeof value === 'string' && (PAYABLE_STATES as readonly string[]).includes(value);
}

/**
 * Seller payable — **projection** nghĩa vụ phải trả cho seller.
 *
 * Không phải payout: không có beneficiary, không có fiat disbursement, và
 * `paid` chỉ là state sau khi caller cấp bằng chứng payout (opaque reference do
 * `payout`/`payment` sở hữu). Cũng không phải provider cost.
 *
 * Append-only theo version: mỗi transition thêm một record cùng `payable_id` với
 * `version + 1`; `latestPayable` trả version cao nhất. Vì vậy adjustment là một
 * transition mới, không phải sửa record cũ.
 */
export interface SellerPayable {
  readonly payable_id: PayableId;
  readonly version: number;
  readonly seller_tenant: TenantRef;
  readonly denomination: 'EC';
  readonly amount: Money<'EC'>;
  readonly state: PayableState;
  /** Kỳ earnings do caller cấp (ví dụ `2026-10`); calendar policy thuộc ADR-0007. */
  readonly period: string;
  /** Thời điểm earnings trở nên available — caller suy ra từ policy, domain không tính lịch. */
  readonly available_at: number;
  readonly accrued_at: number;
  readonly settled_at: number | null;
  readonly paid_at: number | null;
  /** Bằng chứng payout — opaque, không phải payout record của lib này. */
  readonly payout_evidence_ref: PayoutEvidenceRef | null;
  readonly settlement_id: SettlementId | null;
  readonly charge_id: ChargeId | null;
  readonly fencing_token: FencingToken;
}

/** Type guard cho `SellerPayable`. */
export function isSellerPayable(value: unknown): value is SellerPayable {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<SellerPayable>;
  return (
    isOpaqueId(record.payable_id) &&
    typeof record.version === 'number' &&
    Number.isSafeInteger(record.version) &&
    record.version >= 1 &&
    isOpaqueId(record.seller_tenant) &&
    record.denomination === 'EC' &&
    isMoney(record.amount) &&
    record.amount.denomination === 'EC' &&
    isPayableState(record.state) &&
    isOpaqueId(record.period) &&
    isEpochMillis(record.available_at) &&
    isEpochMillis(record.accrued_at) &&
    (record.settled_at === null || isEpochMillis(record.settled_at)) &&
    (record.paid_at === null || isEpochMillis(record.paid_at)) &&
    (record.payout_evidence_ref === null || isOpaqueId(record.payout_evidence_ref)) &&
    (record.settlement_id === null || isOpaqueId(record.settlement_id)) &&
    (record.charge_id === null || isOpaqueId(record.charge_id)) &&
    isOpaqueId(record.fencing_token)
  );
}

/** Version mới nhất của một payable id. */
export function latestPayable(
  payables: readonly SellerPayable[],
  payableId: PayableId,
): SellerPayable | null {
  let latest: SellerPayable | null = null;
  for (const payable of payables) {
    if (payable.payable_id !== payableId) {
      continue;
    }
    if (latest === null || payable.version > latest.version) {
      latest = payable;
    }
  }
  return latest;
}
