/**
 * Records của EC → UC conversion: ratio, authorization evidence, conversion.
 *
 * ADR-0005 để conversion ratio và fee OPEN — lib chỉ nhận ratio, kiểm tính hợp
 * lệ, yêu cầu kết quả nguyên chính xác, và ghi ratio bất biến vào conversion
 * record. Authorization là opaque verdict do tầng sở hữu nó tính.
 */

import { isMoney, type Money } from '../money/money';
import {
  isEpochMillis,
  isOpaqueId,
  type ActorRef,
  type ConversionId,
  type FencingToken,
  type LedgerEntryId,
  type LedgerTransactionId,
  type TenantRef,
  type WalletId,
} from '../shared/shared';

/**
 * Tỷ lệ conversion do caller cấp.
 *
 * ADR-0005 để conversion ratio và fee là **OPEN**. Lib không có default 1:1 và
 * không áp fee; nó chỉ nhận ratio, kiểm tính hợp lệ, yêu cầu kết quả nguyên
 * chính xác, và ghi ratio bất biến vào conversion record.
 */
export interface ConversionRatio {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** Type guard cho `ConversionRatio`: cả hai dương, denominator khác 0. */
export function isConversionRatio(value: unknown): value is ConversionRatio {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const ratio = value as { numerator?: unknown; denominator?: unknown };
  return (
    typeof ratio.numerator === 'bigint' &&
    typeof ratio.denominator === 'bigint' &&
    ratio.numerator > 0n &&
    ratio.denominator > 0n
  );
}

/**
 * Kết quả authorization do caller cấp — **không** phải authorization model của
 * lib này.
 *
 * Dual authorization của ADR-0005 là `same_identity AND seller.payout AND
 * console.payment`; verdict được tính ở tầng authorization sở hữu nó và truyền
 * vào đây như một opaque value. Lib chỉ kiểm hình dạng, kiểm các cờ đều `true`,
 * và kiểm các tham chiếu khớp với conversion. Thiếu hoặc lệch → fail closed.
 */
export interface ConversionAuthorizationEvidence {
  readonly actor_ref: ActorRef;
  readonly seller_tenant: TenantRef;
  readonly console_tenant: TenantRef;
  readonly same_identity: true;
  readonly seller_payout_authorized: true;
  readonly console_payment_authorized: true;
  readonly evaluated_at: number;
}

/** Type guard nghiêm ngặt cho `ConversionAuthorizationEvidence`. */
export function isConversionAuthorizationEvidence(
  value: unknown,
): value is ConversionAuthorizationEvidence {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const evidence = value as Partial<ConversionAuthorizationEvidence>;
  const ownKeys = Object.keys(value);
  const expectedKeys = [
    'actor_ref',
    'seller_tenant',
    'console_tenant',
    'same_identity',
    'seller_payout_authorized',
    'console_payment_authorized',
    'evaluated_at',
  ];
  return (
    ownKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => ownKeys.includes(key)) &&
    isOpaqueId(evidence.actor_ref) &&
    isOpaqueId(evidence.seller_tenant) &&
    isOpaqueId(evidence.console_tenant) &&
    evidence.same_identity === true &&
    evidence.seller_payout_authorized === true &&
    evidence.console_payment_authorized === true &&
    isEpochMillis(evidence.evaluated_at)
  );
}

/** Record conversion EC→UC. Irreversible: không có operation chuyển ngược. */
export interface Conversion {
  readonly conversion_id: ConversionId;
  readonly actor_ref: ActorRef;
  readonly source_seller_tenant: TenantRef;
  readonly destination_console_tenant: TenantRef;
  readonly source_wallet_id: WalletId;
  readonly destination_wallet_id: WalletId;
  readonly source_amount: Money<'EC'>;
  readonly target_amount: Money<'UC'>;
  readonly ratio: ConversionRatio;
  readonly authorization: ConversionAuthorizationEvidence;
  /** Hai transaction ledger (EC và UC) — mỗi bên cân bằng trong ledger của nó. */
  readonly source_transaction_id: LedgerTransactionId;
  readonly target_transaction_id: LedgerTransactionId;
  readonly created_at: number;
  readonly fencing_token: FencingToken;
  readonly source_entry_ids: readonly LedgerEntryId[];
  readonly target_entry_ids: readonly LedgerEntryId[];
}

/** Type guard cho `Conversion`. */
export function isConversion(value: unknown): value is Conversion {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<Conversion>;
  return (
    isOpaqueId(record.conversion_id) &&
    isOpaqueId(record.actor_ref) &&
    isOpaqueId(record.source_seller_tenant) &&
    isOpaqueId(record.destination_console_tenant) &&
    isOpaqueId(record.source_wallet_id) &&
    isOpaqueId(record.destination_wallet_id) &&
    isMoney(record.source_amount) &&
    record.source_amount.denomination === 'EC' &&
    isMoney(record.target_amount) &&
    record.target_amount.denomination === 'UC' &&
    isConversionRatio(record.ratio) &&
    isConversionAuthorizationEvidence(record.authorization) &&
    isOpaqueId(record.source_transaction_id) &&
    isOpaqueId(record.target_transaction_id) &&
    isEpochMillis(record.created_at) &&
    isOpaqueId(record.fencing_token) &&
    Array.isArray(record.source_entry_ids) &&
    Array.isArray(record.target_entry_ids)
  );
}
