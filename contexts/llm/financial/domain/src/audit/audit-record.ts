/**
 * Record financial audit — một dòng append-only log của mọi thay đổi tài chính.
 *
 * Vocabulary đóng để một hành động lạ không lọt vào log mà không ai định nghĩa
 * ngữ nghĩa của nó. Không chứa secret/token; mọi tham chiếu đều opaque.
 */

import { isMoney, type Money } from '../money/money';
import { isEpochMillis, isOpaqueId, type ActorRef, type FencingToken } from '../shared/shared';

/**
 * Hành động được ghi audit.
 *
 * Vocabulary đóng để một hành động lạ không lọt vào log mà không ai định nghĩa
 * ngữ nghĩa của nó.
 */
export const AUDIT_ACTIONS = [
  'deposit_registered',
  'deposit_credited',
  'deposit_reversed',
  'wallet_credited',
  'reserved',
  'reservation_captured',
  'reservation_released',
  'settled',
  'charge_refunded',
  'charge_adjusted',
  'payable_accrued',
  'payable_settled',
  'payable_paid',
  'payable_adjusted',
  'hold_opened',
  'hold_released',
  'escrow_opened',
  'lease_issued',
  'lease_revoked',
  'escrow_reallocated',
  'converted',
  'fencing_token_rotated',
  // Sponsor funding vocabulary — tên exactly theo ADR-0028 §4. Các action
  // revoke/update không có operation nào phát sinh ở MVP; chúng là vocabulary
  // canonical cho bề mặt tương lai (ADR-0028 §13.6).
  'sponsor_registered',
  'sponsor_funding_authorized',
  'sponsor_funding_authorization_revoked',
  'sponsor_grant_registered',
  'sponsor_grant_credited',
  'sponsor_grant_reversed',
  'sponsor_ceiling_updated',
  'sponsor_funding_authorization_ceiling_updated',
  'financial_charge_capped',
  'financial_settle_missing_usage',
] as const;

/** Một hành động audit. */
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Type guard cho `AuditAction`. */
export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === 'string' && (AUDIT_ACTIONS as readonly string[]).includes(value);
}

/**
 * Một dòng financial audit.
 *
 * Append-only: không có operation sửa/xoá dòng đã ghi. `actor_ref` và
 * `correlation_id` do caller cấp — domain không biết request context. Không
 * chứa secret/token; mọi tham chiếu đều opaque.
 */
export interface FinancialAuditEntry {
  readonly action: AuditAction;
  readonly actor_ref: ActorRef;
  readonly target_ref: string;
  readonly amount: Money | null;
  readonly correlation_id: string;
  readonly at: number;
  readonly fencing_token: FencingToken;
}

/** Type guard cho `FinancialAuditEntry`. */
export function isFinancialAuditEntry(value: unknown): value is FinancialAuditEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Partial<FinancialAuditEntry>;
  return (
    isAuditAction(entry.action) &&
    isOpaqueId(entry.actor_ref) &&
    isOpaqueId(entry.target_ref) &&
    (entry.amount === null || isMoney(entry.amount)) &&
    isOpaqueId(entry.correlation_id) &&
    isEpochMillis(entry.at) &&
    isOpaqueId(entry.fencing_token)
  );
}
