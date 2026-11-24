/**
 * Aggregate root `CustomerCharge` — khoản thu từ customer sau settlement.
 *
 * State machine (§4.5): `pending → posted → refunded | adjusted`. Charge là
 * append-only ở nghĩa không operation nào sửa `amount`; `refunded`, `increase`,
 * `decrease` tích luỹ qua `applyRefund()` / `applyAdjustment()` trên record mới.
 * Bút toán ledger thuộc về `FinancialBook` (coordinator).
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';
import {
  isCustomerCharge,
  refundableAmount,
  type ChargeState,
  type CustomerCharge,
} from './charge-record';
import { isMoney, type Money } from '../money/money';
import { llmFinancialDomainError, type LlmFinancialDomainError } from '../shared/errors';
import { assertAggregateInvariant, isEpochMillis, isOpaqueId } from '../shared/shared';
import type {
  BillingAccountId,
  ChargeId,
  ReservationId,
  SettlementId,
  WalletId,
} from '../shared/shared';

export class ChargeAggregate extends AggregateRoot<ChargeId> {
  #walletId: WalletId;
  #billingAccountId: BillingAccountId;
  #denomination: CustomerCharge['denomination'];
  #amount: Money;
  #refunded: Money;
  #increase: Money;
  #decrease: Money;
  #state: ChargeState;
  #reservationId: ReservationId | null;
  #settlementId: SettlementId | null;
  #createdAt: number;
  #postedAt: number | null;

  private constructor(
    id: ChargeId,
    walletId: WalletId,
    billingAccountId: BillingAccountId,
    denomination: CustomerCharge['denomination'],
    amount: Money,
    refunded: Money,
    increase: Money,
    decrease: Money,
    state: ChargeState,
    reservationId: ReservationId | null,
    settlementId: SettlementId | null,
    createdAt: number,
    postedAt: number | null,
  ) {
    super(id);
    this.#walletId = walletId;
    this.#billingAccountId = billingAccountId;
    this.#denomination = denomination;
    this.#amount = amount;
    this.#refunded = refunded;
    this.#increase = increase;
    this.#decrease = decrease;
    this.#state = state;
    this.#reservationId = reservationId;
    this.#settlementId = settlementId;
    this.#createdAt = createdAt;
    this.#postedAt = postedAt;
  }

  /** Dựng charge `pending` mới với các accumulator zero. */
  public static issue(input: {
    chargeId: string;
    walletId: string;
    billingAccountId: string;
    denomination: CustomerCharge['denomination'];
    amount: Money;
    reservationId: string | null;
    settlementId: string | null;
    createdAt: number;
  }): ChargeAggregate {
    assertAggregateInvariant(
      isOpaqueId(input.chargeId) &&
        isOpaqueId(input.walletId) &&
        isOpaqueId(input.billingAccountId),
      'invalid_id',
    );
    assertAggregateInvariant(
      input.reservationId === null || isOpaqueId(input.reservationId),
      'invalid_id',
    );
    assertAggregateInvariant(
      input.settlementId === null || isOpaqueId(input.settlementId),
      'invalid_id',
    );
    assertAggregateInvariant(isMoney(input.amount) && input.amount.minor > 0n, 'invalid_amount');
    assertAggregateInvariant(isEpochMillis(input.createdAt), 'invalid_epoch_millis');
    const zero = { denomination: input.denomination, minor: 0n } as const;
    return new ChargeAggregate(
      input.chargeId as ChargeId,
      input.walletId as WalletId,
      input.billingAccountId as BillingAccountId,
      input.denomination,
      input.amount,
      zero,
      zero,
      zero,
      'pending',
      input.reservationId as ReservationId | null,
      input.settlementId as SettlementId | null,
      input.createdAt,
      null,
    );
  }

  /** Reconstitute; ném `TypeError` khi snapshot hỏng. Cùng mức validate với `issue()`. */
  public static reconstitute(record: CustomerCharge): ChargeAggregate {
    assertAggregateInvariant(isCustomerCharge(record), 'invalid_charge');
    return new ChargeAggregate(
      record.charge_id,
      record.wallet_id,
      record.billing_account_id,
      record.denomination,
      record.amount,
      record.refunded,
      record.increase,
      record.decrease,
      record.state,
      record.reservation_id,
      record.settlement_id,
      record.created_at,
      record.posted_at,
    );
  }

  public get wallet_id(): WalletId {
    return this.#walletId;
  }

  public get billing_account_id(): BillingAccountId {
    return this.#billingAccountId;
  }

  public get denomination(): CustomerCharge['denomination'] {
    return this.#denomination;
  }

  public get amount(): Money {
    return this.#amount;
  }

  public get refunded(): Money {
    return this.#refunded;
  }

  public get increase(): Money {
    return this.#increase;
  }

  public get decrease(): Money {
    return this.#decrease;
  }

  public get state(): ChargeState {
    return this.#state;
  }

  public get reservation_id(): ReservationId | null {
    return this.#reservationId;
  }

  public get settlement_id(): SettlementId | null {
    return this.#settlementId;
  }

  public get created_at(): number {
    return this.#createdAt;
  }

  public get posted_at(): number | null {
    return this.#postedAt;
  }

  /** Số tiền còn có thể hoàn: `amount + increase - decrease - refunded`. */
  public refundable(): Money {
    return refundableAmount(this.snapshot());
  }

  /** Snapshot readonly — persist về record shape. */
  public snapshot(): CustomerCharge {
    return Object.freeze({
      charge_id: this.id,
      wallet_id: this.#walletId,
      billing_account_id: this.#billingAccountId,
      denomination: this.#denomination,
      amount: this.#amount,
      refunded: this.#refunded,
      increase: this.#increase,
      decrease: this.#decrease,
      state: this.#state,
      reservation_id: this.#reservationId,
      settlement_id: this.#settlementId,
      created_at: this.#createdAt,
      posted_at: this.#postedAt,
    });
  }

  /** `pending → posted`, đóng dấu `posted_at`. */
  public post(postedAt: number): LlmFinancialDomainError | null {
    if (this.#state !== 'pending') {
      return llmFinancialDomainError('invalid_charge_transition');
    }
    this.#state = 'posted';
    this.#postedAt = postedAt;
    return null;
  }

  /**
   * Tích luỹ một khoản hoàn — chỉ từ `posted`. Trả
   * `refund_exceeds_charge` khi vượt phần còn hoàn; charge chuyển `refunded`
   * khi đã hoàn đủ.
   */
  public applyRefund(amount: Money): LlmFinancialDomainError | null {
    if (this.#state === 'pending') {
      return llmFinancialDomainError('invalid_charge_transition');
    }
    if (amount.denomination !== this.#denomination) {
      return llmFinancialDomainError('denomination_mismatch');
    }
    if (amount.minor > refundableAmount(this.snapshot()).minor) {
      return llmFinancialDomainError('refund_exceeds_charge');
    }
    const nextRefunded = this.#accumulate(this.#refunded.minor, amount.minor);
    if (nextRefunded === null) {
      return llmFinancialDomainError('amount_overflow');
    }
    this.#refunded = nextRefunded;
    if (this.#refunded.minor >= this.#amount.minor + this.#increase.minor - this.#decrease.minor) {
      this.#state = 'refunded';
    }
    return null;
  }

  /**
   * Tích luỹ một adjustment — chỉ từ `posted` (không đụng charge đã `refunded`
   * hoàn toàn). `increase` thu thêm, `decrease` giảm bớt.
   */
  public applyAdjustment(
    direction: 'increase' | 'decrease',
    amount: Money,
  ): LlmFinancialDomainError | null {
    if (this.#state === 'pending') {
      return llmFinancialDomainError('invalid_charge_transition');
    }
    if (amount.denomination !== this.#denomination) {
      return llmFinancialDomainError('denomination_mismatch');
    }
    if (direction === 'increase') {
      const next = this.#accumulate(this.#increase.minor, amount.minor);
      if (next === null) {
        return llmFinancialDomainError('amount_overflow');
      }
      this.#increase = next;
    } else {
      const next = this.#accumulate(this.#decrease.minor, amount.minor);
      if (next === null) {
        return llmFinancialDomainError('amount_overflow');
      }
      this.#decrease = next;
    }
    this.#state = 'adjusted';
    return null;
  }

  #accumulate(current: bigint, delta: bigint): Money | null {
    const minor = current + delta;
    if (minor > 10n ** 30n - 1n) {
      return null;
    }
    return Object.freeze({ denomination: this.#denomination, minor });
  }
}
