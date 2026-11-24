/**
 * Aggregate roots `BudgetEscrow` + `BudgetLease` — tiền earmark và quyền tiêu
 * tài chính.
 *
 * Escrow thực sự giữ tiền trong wallet (`available → held`), nên unused escrow
 * là **held money**, không phải outstanding liability (invariant 12). Lease cấp
 * từ phần escrow chưa allocate và không post bút toán; epoch là fencing đơn điệu
 * — lease cũ bị loại khi epoch mới vượt qua (invariant 6).
 *
 * Các phương thức mutate chỉ đổi trạng thái trong bộ nhớ aggregate; posting
 * `available → held` / `held → available` thuộc về `FinancialBook`
 * (coordinator). Close đòi `reconciliationRef` và không còn lease `active` —
 * fail-closed cho tới khi có operation ghi nhận việc tiêu phần `exhausted`.
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';
import { isBudgetEscrow, type BudgetEscrow, type EscrowState } from './escrow-record';
import { isBudgetLease, type BudgetLease, type LeaseState } from '../lease/lease-record';
import { isMoney, type Money } from '../money/money';
import { llmFinancialDomainError, type LlmFinancialDomainError } from '../shared/errors';
import { assertAggregateInvariant, isEpochMillis, isOpaqueId } from '../shared/shared';
import type { BillingAccountId, FencingToken, WalletId } from '../shared/shared';

export class LeaseAggregate extends AggregateRoot<string> {
  #escrowId: string;
  #amount: Money;
  #epoch: number;
  #fencingToken: FencingToken;
  #state: LeaseState;
  #issuedAt: number;
  #expiresAt: number;
  #reconciliationRef: string | null;
  #reallocatedAt: number | null;

  private constructor(
    id: string,
    escrowId: string,
    amount: Money,
    epoch: number,
    fencingToken: FencingToken,
    state: LeaseState,
    issuedAt: number,
    expiresAt: number,
    reconciliationRef: string | null,
    reallocatedAt: number | null,
  ) {
    super(id);
    this.#escrowId = escrowId;
    this.#amount = amount;
    this.#epoch = epoch;
    this.#fencingToken = fencingToken;
    this.#state = state;
    this.#issuedAt = issuedAt;
    this.#expiresAt = expiresAt;
    this.#reconciliationRef = reconciliationRef;
    this.#reallocatedAt = reallocatedAt;
  }

  /**
   * Dựng lease `active` mới từ input cấp phát.
   *
   * Aggregate tự bảo vệ ở cùng mức với `issueLease` ở tầng operation: id shape,
   * amount dương đúng denomination, epoch non-negative, token, timestamps và
   * cửa sổ `expiresAt > issuedAt`. Vi phạm là `TypeError`.
   */
  public static issue(input: {
    leaseId: string;
    escrowId: string;
    amount: Money;
    epoch: number;
    fencingToken: string;
    issuedAt: number;
    expiresAt: number;
  }): LeaseAggregate {
    assertAggregateInvariant(
      isOpaqueId(input.leaseId) && isOpaqueId(input.escrowId) && isOpaqueId(input.fencingToken),
      'invalid_id',
    );
    assertAggregateInvariant(isMoney(input.amount) && input.amount.minor > 0n, 'invalid_amount');
    assertAggregateInvariant(
      Number.isSafeInteger(input.epoch) && input.epoch >= 0,
      'invalid_budget_lease',
    );
    assertAggregateInvariant(
      isEpochMillis(input.issuedAt) &&
        isEpochMillis(input.expiresAt) &&
        input.expiresAt > input.issuedAt,
      'invalid_epoch_millis',
    );
    return new LeaseAggregate(
      input.leaseId,
      input.escrowId,
      input.amount,
      input.epoch,
      input.fencingToken as FencingToken,
      'active',
      input.issuedAt,
      input.expiresAt,
      null,
      null,
    );
  }

  /** Reconstitute; ném `TypeError` khi snapshot hỏng. Cùng mức validate với `issue()`. */
  public static reconstitute(record: BudgetLease): LeaseAggregate {
    assertAggregateInvariant(isBudgetLease(record), 'invalid_budget_lease');
    assertAggregateInvariant(record.amount.minor > 0n, 'invalid_amount');
    assertAggregateInvariant(record.expires_at > record.issued_at, 'invalid_budget_lease');
    return new LeaseAggregate(
      record.lease_id,
      record.escrow_id,
      record.amount,
      record.epoch,
      record.fencing_token,
      record.state,
      record.issued_at,
      record.expires_at,
      record.reconciliation_ref,
      record.reallocated_at,
    );
  }

  public get escrow_id(): string {
    return this.#escrowId;
  }

  public get amount(): Money {
    return this.#amount;
  }

  public get epoch(): number {
    return this.#epoch;
  }

  public get fencing_token(): FencingToken {
    return this.#fencingToken;
  }

  public get state(): LeaseState {
    return this.#state;
  }

  public get issued_at(): number {
    return this.#issuedAt;
  }

  public get expires_at(): number {
    return this.#expiresAt;
  }

  public get reconciliation_ref(): string | null {
    return this.#reconciliationRef;
  }

  public get reallocated_at(): number | null {
    return this.#reallocatedAt;
  }

  /** Snapshot readonly — persist về record shape. */
  public snapshot(): BudgetLease {
    return Object.freeze({
      lease_id: this.id,
      escrow_id: this.#escrowId,
      amount: this.#amount,
      epoch: this.#epoch,
      fencing_token: this.#fencingToken,
      state: this.#state,
      issued_at: this.#issuedAt,
      expires_at: this.#expiresAt,
      reconciliation_ref: this.#reconciliationRef,
      reallocated_at: this.#reallocatedAt,
    });
  }

  /**
   * Thu hồi lease đã stale — `observedEpoch` phải vượt qua epoch của lease
   * (`lease_not_stale` nếu chưa); chỉ từ `active`.
   */
  public revoke(observedEpoch: number, revokedAt: number): LlmFinancialDomainError | null {
    if (this.#state !== 'active') {
      return llmFinancialDomainError('invalid_budget_lease');
    }
    if (observedEpoch <= this.#epoch) {
      return llmFinancialDomainError('lease_not_stale');
    }
    this.#state = 'revoked';
    this.#reallocatedAt = revokedAt;
    return null;
  }

  /** Đánh dấu lease hết hạn — epoch chưa vượt, chỉ thời gian đã qua. */
  public expire(): LlmFinancialDomainError | null {
    if (this.#state !== 'active') {
      return llmFinancialDomainError('invalid_budget_lease');
    }
    this.#state = 'expired';
    return null;
  }
}

export class EscrowAggregate extends AggregateRoot<string> {
  #walletId: WalletId;
  #billingAccountId: BillingAccountId;
  #denomination: BudgetEscrow['denomination'];
  #amount: Money;
  #leases: LeaseAggregate[];
  #createdAt: number;
  #fencingToken: FencingToken;
  #releasedAt: number | null;
  #reconciliationRef: string | null;

  private constructor(
    id: string,
    walletId: WalletId,
    billingAccountId: BillingAccountId,
    denomination: BudgetEscrow['denomination'],
    amount: Money,
    leases: LeaseAggregate[],
    createdAt: number,
    fencingToken: FencingToken,
    releasedAt: number | null,
    reconciliationRef: string | null,
  ) {
    super(id);
    this.#walletId = walletId;
    this.#billingAccountId = billingAccountId;
    this.#denomination = denomination;
    this.#amount = amount;
    this.#leases = leases;
    this.#createdAt = createdAt;
    this.#fencingToken = fencingToken;
    this.#releasedAt = releasedAt;
    this.#reconciliationRef = reconciliationRef;
  }

  /**
   * Dựng escrow mở mới, chưa có lease.
   *
   * Aggregate tự bảo vệ ở cùng mức với `openEscrow` ở tầng operation: id shape,
   * amount dương đúng denomination, timestamp epoch millis. Vi phạm là
   * `TypeError`.
   */
  public static issue(input: {
    escrowId: string;
    walletId: string;
    billingAccountId: string;
    denomination: BudgetEscrow['denomination'];
    amount: Money;
    createdAt: number;
    fencingToken: string;
  }): EscrowAggregate {
    assertAggregateInvariant(
      isOpaqueId(input.escrowId) &&
        isOpaqueId(input.walletId) &&
        isOpaqueId(input.billingAccountId) &&
        isOpaqueId(input.fencingToken),
      'invalid_id',
    );
    assertAggregateInvariant(isMoney(input.amount) && input.amount.minor > 0n, 'invalid_amount');
    assertAggregateInvariant(isEpochMillis(input.createdAt), 'invalid_epoch_millis');
    return new EscrowAggregate(
      input.escrowId,
      input.walletId as WalletId,
      input.billingAccountId as BillingAccountId,
      input.denomination,
      input.amount,
      [],
      input.createdAt,
      input.fencingToken as FencingToken,
      null,
      null,
    );
  }

  /**
   * Reconstitute; ném `TypeError` khi snapshot hỏng. Cùng mức validate với
   * `issue()` qua type guard cấu trúc, cộng bất biến epoch đơn điệu giữa các
   * lease theo đúng thứ tự thời gian ghi — snapshot có epoch lùi là dữ liệu tự
   * mâu thuẫn, không bao giờ được nạp thành aggregate.
   */
  public static reconstitute(record: BudgetEscrow): EscrowAggregate {
    assertAggregateInvariant(isBudgetEscrow(record), 'invalid_budget_lease');
    for (let index = 1; index < record.leases.length; index += 1) {
      assertAggregateInvariant(
        record.leases[index].epoch > record.leases[index - 1].epoch,
        'invalid_budget_lease',
      );
    }
    return new EscrowAggregate(
      record.escrow_id,
      record.wallet_id,
      record.billing_account_id,
      record.denomination,
      record.amount,
      record.leases.map((lease) => LeaseAggregate.reconstitute(lease)),
      record.created_at,
      record.fencing_token,
      record.released_at,
      record.reconciliation_ref,
    );
  }

  public get wallet_id(): WalletId {
    return this.#walletId;
  }

  public get billing_account_id(): BillingAccountId {
    return this.#billingAccountId;
  }

  public get denomination(): BudgetEscrow['denomination'] {
    return this.#denomination;
  }

  public get amount(): Money {
    return this.#amount;
  }

  public get leases(): readonly LeaseAggregate[] {
    return this.#leases;
  }

  public get created_at(): number {
    return this.#createdAt;
  }

  public get fencing_token(): FencingToken {
    return this.#fencingToken;
  }

  public get released_at(): number | null {
    return this.#releasedAt;
  }

  public get reconciliation_ref(): string | null {
    return this.#reconciliationRef;
  }

  /** Trạng thái suy ra: còn mở hay đã release. */
  public get state(): EscrowState {
    return this.#releasedAt === null ? 'open' : 'released';
  }

  /** Snapshot readonly — persist về record shape. */
  public snapshot(): BudgetEscrow {
    return Object.freeze({
      escrow_id: this.id,
      wallet_id: this.#walletId,
      billing_account_id: this.#billingAccountId,
      denomination: this.#denomination,
      amount: this.#amount,
      leases: Object.freeze(this.#leases.map((lease) => lease.snapshot())),
      created_at: this.#createdAt,
      fencing_token: this.#fencingToken,
      released_at: this.#releasedAt,
      reconciliation_ref: this.#reconciliationRef,
    });
  }

  /** Tổng tiền đã cấp cho các lease đang `active`/`exhausted`. */
  public allocated(): bigint {
    let total = 0n;
    for (const lease of this.#leases) {
      if (lease.state === 'active' || lease.state === 'exhausted') {
        total += lease.amount.minor;
      }
    }
    return total;
  }

  /** Tổng tiền còn giữ trong escrow — phần chưa allocate. */
  public remaining(): bigint {
    if (this.#releasedAt !== null) {
      return 0n;
    }
    const remaining = this.#amount.minor - this.allocated();
    return remaining > 0n ? remaining : 0n;
  }

  /** Cấp một lease từ phần chưa allocate; epoch phải đơn điệu tăng. */
  public issueLease(lease: LeaseAggregate): LlmFinancialDomainError | null {
    if (this.#releasedAt !== null) {
      return llmFinancialDomainError('invalid_budget_lease');
    }
    if (lease.escrow_id !== this.id) {
      return llmFinancialDomainError('invalid_budget_lease');
    }
    if (lease.amount.denomination !== this.#denomination) {
      return llmFinancialDomainError('denomination_mismatch');
    }
    if (
      this.#leases.some((candidate) => candidate.id === lease.id || candidate.epoch >= lease.epoch)
    ) {
      return llmFinancialDomainError('invalid_budget_lease');
    }
    if (this.allocated() + lease.amount.minor > this.#amount.minor) {
      return llmFinancialDomainError('invalid_budget_lease');
    }
    this.#leases.push(lease);
    return null;
  }

  /**
   * Đóng escrow — đòi bằng chứng reconciliation và không còn lease
   * `active`/`exhausted`. `exhausted` fail-closed: domain chưa mô hình hoá bút
   * toán cho phần đã tiêu, trả về available lúc này sẽ trả đúp.
   */
  public close(reconciliationRef: string, closedAt: number): LlmFinancialDomainError | null {
    if (this.#releasedAt !== null) {
      return llmFinancialDomainError('invalid_budget_lease');
    }
    if (typeof reconciliationRef !== 'string' || reconciliationRef.length === 0) {
      return llmFinancialDomainError('reconciliation_required');
    }
    if (this.#leases.some((lease) => lease.state === 'active' || lease.state === 'exhausted')) {
      return llmFinancialDomainError('lease_not_stale');
    }
    this.#releasedAt = closedAt;
    this.#reconciliationRef = reconciliationRef;
    return null;
  }
}
