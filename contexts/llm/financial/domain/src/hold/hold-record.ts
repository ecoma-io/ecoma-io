/**
 * Record financial hold — chặn settlement của seller, không xoá earnings.
 *
 * Hold chỉ là điều kiện được kiểm trong `settlePayable`; nó không đổi balance.
 * Hai field release đi cùng nhau: chưa release thì cả hai `null`.
 */

import { isEpochMillis, isOpaqueId, type ActorRef, type TenantRef } from '../shared/shared';

/** Phạm vi hold — ADR-0007. */
export const HOLD_SCOPES = ['settlement', 'account'] as const;

/** Phạm vi hold. */
export type HoldScope = (typeof HOLD_SCOPES)[number];

/** Type guard cho `HoldScope`. */
export function isHoldScope(value: unknown): value is HoldScope {
  return typeof value === 'string' && (HOLD_SCOPES as readonly string[]).includes(value);
}

/**
 * Financial hold.
 *
 * - `settlement`: giữ toàn bộ settlement của một Seller tenant cho một kỳ.
 * - `account`: chặn dùng toàn bộ EC available hiện có (fraud/compliance).
 *
 * Hold không xoá/viết lại earnings; nó chỉ chặn transition và yêu cầu reason,
 * actor, scope, thời điểm bắt đầu và thời điểm release để audit.
 */
export interface FinancialHold {
  readonly hold_id: string;
  readonly scope: HoldScope;
  readonly seller_tenant: TenantRef;
  /** Kỳ bị ảnh hưởng khi `scope === 'settlement'`; `null` với account hold. */
  readonly period: string | null;
  readonly reason_ref: string;
  /** Actor đã mở hold — không bị ghi đè khi release, để audit truy được người mở. */
  readonly actor_ref: ActorRef;
  readonly started_at: number;
  readonly released_at: number | null;
  /** Actor đã release; `null` khi hold còn hiệu lực. */
  readonly released_by: ActorRef | null;
}

/** Type guard cho `FinancialHold`. */
export function isFinancialHold(value: unknown): value is FinancialHold {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<FinancialHold>;
  return (
    isOpaqueId(record.hold_id) &&
    isHoldScope(record.scope) &&
    isOpaqueId(record.seller_tenant) &&
    (record.period === null || isOpaqueId(record.period)) &&
    isOpaqueId(record.reason_ref) &&
    isOpaqueId(record.actor_ref) &&
    isEpochMillis(record.started_at) &&
    (record.released_at === null || isEpochMillis(record.released_at)) &&
    // Hai field release đi cùng nhau: chưa release thì cả hai `null`, đã release
    // thì cả hai phải có. Một hold release mà không rõ ai release là audit hỏng.
    (record.released_at === null) === (record.released_by === null) &&
    (record.released_by === null || isOpaqueId(record.released_by)) &&
    (record.scope !== 'settlement' || isOpaqueId(record.period)) &&
    // Account hold không có kỳ; một `period` thừa là dữ liệu không nhất quán mà
    // `hasBlockingHold` sẽ không bao giờ đọc tới.
    (record.scope === 'account' || record.period !== null)
  );
}

/** Hold đang hiệu lực tại một thời điểm. */
export function isHoldActive(hold: FinancialHold, at: number): boolean {
  return hold.released_at === null || hold.released_at > at;
}

/**
 * Có hold đang chặn một (seller tenant, kỳ) tại thời điểm `at` không.
 *
 * Settlement hold khớp đúng kỳ; account hold chặn mọi kỳ của tenant.
 */
export function hasBlockingHold(
  holds: readonly FinancialHold[],
  sellerTenant: TenantRef,
  period: string | null,
  at: number,
): boolean {
  return holds.some(
    (hold) =>
      hold.seller_tenant === sellerTenant &&
      isHoldActive(hold, at) &&
      (hold.scope === 'account' || (hold.scope === 'settlement' && hold.period === period)),
  );
}
