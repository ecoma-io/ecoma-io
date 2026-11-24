/**
 * Seller payable — nghĩa vụ phải trả cho seller, tách khỏi payout.
 *
 * Bốn bất biến liên quan:
 *
 * - **Payable ≠ payout** (invariant 9): payable không có beneficiary, không có
 *   fiat disbursement. `paid` chỉ là state sau khi caller cấp **bằng chứng
 *   payout** opaque; `payout`/`payment` sở hữu việc thực thi và bằng chứng đó.
 * - **Payable ≠ provider cost** (invariant 8): payable là phần seller nhận từ
 *   customer charge. Provider cost là đại lượng độc lập, ownership còn OPEN, và
 *   không có kiểu nào ở đây đại diện cho nó.
 * - **Append-only**: mỗi transition là một record version mới cùng `payable_id`;
 *   không sửa record cũ. `latestPayable` trả version cao nhất.
 * - **Hold ≠ restriction** (ADR-0007): một settlement hold chặn `settle` của
 *   đúng kỳ; account hold chặn mọi kỳ. Hold không xoá earnings và không chặn
 *   seller đăng nhập/publish.
 *
 * State machine (§4.4): `accrued → settled → paid | adjusted`.
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';
import type { FinancialBook } from '../book/book';
import { hasBlockingHold } from '../hold/hold-record';
import {
  isSellerPayable,
  latestPayable,
  type PayableState,
  type SellerPayable,
} from './payable-record';
import { isMoney, type Money } from '../money/money';
import {
  assertAggregateInvariant,
  financialFailure,
  financialOk,
  freezeArray,
  isEpochMillis,
  isOpaqueId,
  type ChargeId,
  type FencingToken,
  type FinancialResult,
  type PayableId,
  type PayoutEvidenceRef,
  type SettlementId,
  type TenantRef,
} from '../shared/shared';
import { llmFinancialDomainError, type LlmFinancialDomainError } from '../shared/errors';

/** Input của `accruePayable`. */
export interface AccruePayableInput {
  readonly payableId: string;
  readonly sellerTenant: string;
  readonly amount: Money<'EC'>;
  readonly period: string;
  readonly availableAt: number;
  readonly accruedAt: number;
  readonly settlementId: string | null;
  readonly chargeId: string | null;
  readonly fencingToken: string;
}

/** Kết quả của một operation payable. */
export interface PayableOutcome {
  readonly book: FinancialBook;
  readonly payable: SellerPayable;
  readonly replayed: boolean;
}

/** Thêm record payable mới vào book. */
function appendPayable(book: FinancialBook, payable: SellerPayable): FinancialBook {
  return Object.freeze({
    ...book,
    payables: freezeArray([...book.payables, payable]),
  });
}

/** Đọc version mới nhất của một payable, trả domain error nếu không có. */
export function currentPayable(
  book: FinancialBook,
  payableId: PayableId,
): FinancialResult<SellerPayable> {
  const payable = latestPayable(book.payables, payableId);
  return payable === null ? financialFailure('payable_not_found') : financialOk(payable);
}

/**
 * Ghi nhận earnings đã phát sinh (`accrued`).
 *
 * `period` và `availableAt` do caller cấp: ADR-0007 chốt policy theo calendar
 * month và ngày 20, nhưng domain không đọc đồng hồ và không tính lịch; nó chỉ
 * giữ mốc caller đã tính. `amount` là earnings của seller sau mọi split policy
 * — split/commission/tax không thuộc lib này (ADR-0008).
 */
export function accruePayable(
  book: FinancialBook,
  input: AccruePayableInput,
): FinancialResult<PayableOutcome> {
  if (
    !isOpaqueId(input.payableId) ||
    !isOpaqueId(input.sellerTenant) ||
    !isOpaqueId(input.period) ||
    !isOpaqueId(input.fencingToken) ||
    !isEpochMillis(input.availableAt) ||
    !isEpochMillis(input.accruedAt) ||
    (input.settlementId !== null && !isOpaqueId(input.settlementId)) ||
    (input.chargeId !== null && !isOpaqueId(input.chargeId)) ||
    !isMoney(input.amount) ||
    input.amount.denomination !== 'EC'
  ) {
    return financialFailure('invalid_payable');
  }
  if (input.amount.minor <= 0n) {
    return financialFailure('invalid_amount');
  }
  const existing = latestPayable(book.payables, input.payableId as PayableId);
  if (existing !== null) {
    if (
      existing.seller_tenant !== input.sellerTenant ||
      existing.period !== input.period ||
      existing.amount.minor !== input.amount.minor
    ) {
      return financialFailure('idempotency_conflict');
    }
    if (existing.state !== 'accrued') {
      // Cùng payload nhưng payable đã đi tiếp (`settled`/`paid`/`adjusted`):
      // không phải xung đột idempotency mà là một accrual đã được xử lý.
      return financialFailure('invalid_payable_transition');
    }
    return financialOk(Object.freeze({ book, payable: existing, replayed: true }));
  }
  const payable: SellerPayable = Object.freeze({
    payable_id: input.payableId as PayableId,
    version: 1,
    seller_tenant: input.sellerTenant as TenantRef,
    denomination: 'EC',
    amount: input.amount,
    state: 'accrued',
    period: input.period,
    available_at: input.availableAt,
    accrued_at: input.accruedAt,
    settled_at: null,
    paid_at: null,
    payout_evidence_ref: null,
    settlement_id: input.settlementId as SettlementId | null,
    charge_id: input.chargeId as ChargeId | null,
    fencing_token: input.fencingToken as FencingToken,
  });
  if (!isSellerPayable(payable)) {
    return financialFailure('invalid_payable');
  }
  return financialOk(
    Object.freeze({ book: appendPayable(book, payable), payable, replayed: false }),
  );
}

/** Input của `settlePayable`. */
export interface SettlePayableInput {
  readonly payableId: string;
  readonly settledAt: number;
  readonly fencingToken: string;
}

/**
 * Chuyển payable `accrued → settled`.
 *
 * Từ chối khi còn hold đang hiệu lực cho Seller tenant/kỳ (`payable_on_hold`) —
 * hold là điều kiện chặn settlement, không phải một cờ trang trí. Từ chối khi
 * chưa tới `available_at`: earnings chưa available thì chưa được settle, và
 * domain không tự đọc lịch để quyết định thay.
 */
export function settlePayable(
  book: FinancialBook,
  input: SettlePayableInput,
): FinancialResult<PayableOutcome> {
  const found = currentPayable(book, input.payableId as PayableId);
  if (!found.ok) {
    return found;
  }
  const payable = found.value;
  if (payable.state === 'settled') {
    return financialOk(Object.freeze({ book, payable, replayed: true }));
  }
  if (payable.state !== 'accrued') {
    return financialFailure('invalid_payable_transition');
  }
  if (!isEpochMillis(input.settledAt) || !isOpaqueId(input.fencingToken)) {
    return financialFailure('invalid_epoch_millis');
  }
  if (input.settledAt < payable.available_at) {
    return financialFailure('invalid_payable_transition');
  }
  if (hasBlockingHold(book.holds, payable.seller_tenant, payable.period, input.settledAt)) {
    return financialFailure('payable_on_hold');
  }
  const next: SellerPayable = Object.freeze({
    ...payable,
    version: payable.version + 1,
    state: 'settled',
    settled_at: input.settledAt,
    fencing_token: input.fencingToken as FencingToken,
  });
  return financialOk(
    Object.freeze({ book: appendPayable(book, next), payable: next, replayed: false }),
  );
}

/** Input của `markPayablePaid`. */
export interface MarkPayablePaidInput {
  readonly payableId: string;
  readonly paidAt: number;
  readonly payoutEvidenceRef: string;
  readonly fencingToken: string;
}

/**
 * Chuyển payable `settled → paid`.
 *
 * Đòi **bằng chứng payout** (opaque reference tới execution evidence do
 * `payout`/`payment` sở hữu). Không có evidence thì từ chối
 * (`payout_evidence_required`): request timeout hoặc sự tồn tại của một payout
 * request không chứng minh tiền đã được chi.
 */
export function markPayablePaid(
  book: FinancialBook,
  input: MarkPayablePaidInput,
): FinancialResult<PayableOutcome> {
  const found = currentPayable(book, input.payableId as PayableId);
  if (!found.ok) {
    return found;
  }
  const payable = found.value;
  if (payable.state === 'paid') {
    if (payable.payout_evidence_ref === input.payoutEvidenceRef) {
      return financialOk(Object.freeze({ book, payable, replayed: true }));
    }
    return financialFailure('idempotency_conflict');
  }
  if (payable.state !== 'settled') {
    return financialFailure('invalid_payable_transition');
  }
  if (!isOpaqueId(input.payoutEvidenceRef)) {
    return financialFailure('payout_evidence_required');
  }
  if (!isEpochMillis(input.paidAt) || !isOpaqueId(input.fencingToken)) {
    return financialFailure('invalid_epoch_millis');
  }
  const next: SellerPayable = Object.freeze({
    ...payable,
    version: payable.version + 1,
    state: 'paid',
    paid_at: input.paidAt,
    payout_evidence_ref: input.payoutEvidenceRef as PayoutEvidenceRef,
    fencing_token: input.fencingToken as FencingToken,
  });
  return financialOk(
    Object.freeze({ book: appendPayable(book, next), payable: next, replayed: false }),
  );
}

/** Input của `adjustPayable`. */
export interface AdjustPayableInput {
  readonly payableId: string;
  readonly amount: Money<'EC'>;
  readonly reasonRef: string;
  readonly adjustedAt: number;
  readonly fencingToken: string;
}

/**
 * Điều chỉnh payable bằng một version mới (`adjusted`).
 *
 * Đây là **transition**, không phải mutation: record cũ giữ nguyên amount/state,
 * record mới mang amount đã sửa. Chỉ áp dụng cho `accrued` hoặc `settled`; một
 * payable đã `paid` cần correction riêng qua payout flow, không sửa tại đây.
 */
export function adjustPayable(
  book: FinancialBook,
  input: AdjustPayableInput,
): FinancialResult<PayableOutcome> {
  const found = currentPayable(book, input.payableId as PayableId);
  if (!found.ok) {
    return found;
  }
  const payable = found.value;
  // `adjusted` và `paid` đều là trạng thái cuối của nhánh tương ứng: §5 của
  // `03-domain-design.md` chỉ cho `accrued | settled → adjusted`. Điều chỉnh một
  // bản đã adjusted sẽ tạo chuỗi version không có transition hợp lệ nào sinh ra.
  if (payable.state !== 'accrued' && payable.state !== 'settled') {
    return financialFailure('invalid_payable_transition');
  }
  if (
    !isMoney(input.amount) ||
    input.amount.denomination !== 'EC' ||
    input.amount.minor <= 0n ||
    !isOpaqueId(input.reasonRef) ||
    !isEpochMillis(input.adjustedAt) ||
    !isOpaqueId(input.fencingToken)
  ) {
    return financialFailure('invalid_adjustment');
  }
  const next: SellerPayable = Object.freeze({
    ...payable,
    version: payable.version + 1,
    amount: input.amount,
    state: 'adjusted',
    fencing_token: input.fencingToken as FencingToken,
  });
  return financialOk(
    Object.freeze({ book: appendPayable(book, next), payable: next, replayed: false }),
  );
}

/** Trạng thái hiện tại của một payable — dùng trong test và projection. */
export function payableState(payable: SellerPayable): PayableState {
  return payable.state;
}

/**
 * Aggregate root `SellerPayable` — nghĩa vụ phải trả cho seller, tách khỏi
 * payout (invariant 9). State machine (§4.4): `accrued → settled → paid`, nhánh
 * `adjusted` từ `accrued | settled`.
 *
 * Mỗi transition sinh **một record version mới** (append-only): aggregate giữ
 * version hiện tại và `snapshot()` trả record đó; caller append vào book.
 * `markPaid()` đòi bằng chứng payout — một payout request không chứng minh tiền
 * đã chi. Hold và available_at được coordinator kiểm trước khi gọi.
 */
export class PayableAggregate extends AggregateRoot<PayableId> {
  #version: number;
  #sellerTenant: TenantRef;
  #denomination: 'EC';
  #amount: Money<'EC'>;
  #state: PayableState;
  #period: string;
  #availableAt: number;
  #accruedAt: number;
  #settledAt: number | null;
  #paidAt: number | null;
  #payoutEvidenceRef: PayoutEvidenceRef | null;
  #settlementId: SettlementId | null;
  #chargeId: ChargeId | null;
  #fencingToken: FencingToken;

  private constructor(
    id: PayableId,
    version: number,
    sellerTenant: TenantRef,
    amount: Money<'EC'>,
    state: PayableState,
    period: string,
    availableAt: number,
    accruedAt: number,
    settledAt: number | null,
    paidAt: number | null,
    payoutEvidenceRef: PayoutEvidenceRef | null,
    settlementId: SettlementId | null,
    chargeId: ChargeId | null,
    fencingToken: FencingToken,
  ) {
    super(id);
    this.#version = version;
    this.#sellerTenant = sellerTenant;
    this.#denomination = 'EC';
    this.#amount = amount;
    this.#state = state;
    this.#period = period;
    this.#availableAt = availableAt;
    this.#accruedAt = accruedAt;
    this.#settledAt = settledAt;
    this.#paidAt = paidAt;
    this.#payoutEvidenceRef = payoutEvidenceRef;
    this.#settlementId = settlementId;
    this.#chargeId = chargeId;
    this.#fencingToken = fencingToken;
  }

  /**
   * Dựng payable `accrued` mới (version 1).
   *
   * Aggregate tự bảo vệ ở cùng mức với `accruePayable`: id shape, seller tenant,
   * period, fencing token, timestamps epoch millis, amount EC dương. Vi phạm là
   * `TypeError`, không phải một outcome domain.
   */
  public static issue(input: {
    payableId: string;
    sellerTenant: string;
    amount: Money<'EC'>;
    period: string;
    availableAt: number;
    accruedAt: number;
    settlementId: string | null;
    chargeId: string | null;
    fencingToken: string;
  }): PayableAggregate {
    assertAggregateInvariant(
      isOpaqueId(input.payableId) &&
        isOpaqueId(input.sellerTenant) &&
        isOpaqueId(input.period) &&
        isOpaqueId(input.fencingToken),
      'invalid_id',
    );
    assertAggregateInvariant(
      input.settlementId === null || isOpaqueId(input.settlementId),
      'invalid_id',
    );
    assertAggregateInvariant(input.chargeId === null || isOpaqueId(input.chargeId), 'invalid_id');
    assertAggregateInvariant(
      isMoney(input.amount) && input.amount.denomination === 'EC' && input.amount.minor > 0n,
      'invalid_amount',
    );
    assertAggregateInvariant(
      isEpochMillis(input.availableAt) && isEpochMillis(input.accruedAt),
      'invalid_epoch_millis',
    );
    return new PayableAggregate(
      input.payableId as PayableId,
      1,
      input.sellerTenant as TenantRef,
      input.amount,
      'accrued',
      input.period,
      input.availableAt,
      input.accruedAt,
      null,
      null,
      null,
      input.settlementId as SettlementId | null,
      input.chargeId as ChargeId | null,
      input.fencingToken as FencingToken,
    );
  }

  /** Reconstitute; ném `TypeError` khi snapshot hỏng. Cùng mức validate với `issue()`. */
  public static reconstitute(record: SellerPayable): PayableAggregate {
    assertAggregateInvariant(isSellerPayable(record), 'invalid_payable');
    assertAggregateInvariant(record.amount.minor > 0n, 'invalid_amount');
    return new PayableAggregate(
      record.payable_id,
      record.version,
      record.seller_tenant,
      record.amount as Money<'EC'>,
      record.state,
      record.period,
      record.available_at,
      record.accrued_at,
      record.settled_at,
      record.paid_at,
      record.payout_evidence_ref,
      record.settlement_id,
      record.charge_id,
      record.fencing_token,
    );
  }

  public get version(): number {
    return this.#version;
  }

  public get seller_tenant(): TenantRef {
    return this.#sellerTenant;
  }

  public get denomination(): 'EC' {
    return this.#denomination;
  }

  public get amount(): Money<'EC'> {
    return this.#amount;
  }

  public get state(): PayableState {
    return this.#state;
  }

  public get period(): string {
    return this.#period;
  }

  public get available_at(): number {
    return this.#availableAt;
  }

  public get accrued_at(): number {
    return this.#accruedAt;
  }

  public get settled_at(): number | null {
    return this.#settledAt;
  }

  public get paid_at(): number | null {
    return this.#paidAt;
  }

  public get payout_evidence_ref(): PayoutEvidenceRef | null {
    return this.#payoutEvidenceRef;
  }

  public get settlement_id(): SettlementId | null {
    return this.#settlementId;
  }

  public get charge_id(): ChargeId | null {
    return this.#chargeId;
  }

  public get fencing_token(): FencingToken {
    return this.#fencingToken;
  }

  /** Snapshot readonly — record version hiện tại, persist/append về book. */
  public snapshot(): SellerPayable {
    return Object.freeze({
      payable_id: this.id,
      version: this.#version,
      seller_tenant: this.#sellerTenant,
      denomination: this.#denomination,
      amount: this.#amount,
      state: this.#state,
      period: this.#period,
      available_at: this.#availableAt,
      accrued_at: this.#accruedAt,
      settled_at: this.#settledAt,
      paid_at: this.#paidAt,
      payout_evidence_ref: this.#payoutEvidenceRef,
      settlement_id: this.#settlementId,
      charge_id: this.#chargeId,
      fencing_token: this.#fencingToken,
    });
  }

  /** `accrued → settled`, bump version. */
  public settle(settledAt: number, fencingToken: string): LlmFinancialDomainError | null {
    if (this.#state !== 'accrued') {
      return llmFinancialDomainError('invalid_payable_transition');
    }
    this.#state = 'settled';
    this.#settledAt = settledAt;
    this.#fencingToken = fencingToken as FencingToken;
    this.#version += 1;
    return null;
  }

  /**
   * `settled → paid` — đòi bằng chứng payout opaque. Replay cùng evidence là
   * việc của coordinator; aggregate từ chối evidence thiếu.
   */
  public markPaid(
    paidAt: number,
    payoutEvidenceRef: string,
    fencingToken: string,
  ): LlmFinancialDomainError | null {
    if (this.#state !== 'settled') {
      return llmFinancialDomainError('invalid_payable_transition');
    }
    if (!isOpaqueId(payoutEvidenceRef)) {
      return llmFinancialDomainError('payout_evidence_required');
    }
    this.#state = 'paid';
    this.#paidAt = paidAt;
    this.#payoutEvidenceRef = payoutEvidenceRef as PayoutEvidenceRef;
    this.#fencingToken = fencingToken as FencingToken;
    this.#version += 1;
    return null;
  }

  /** `accrued | settled → adjusted` với amount mới, bump version. */
  public adjust(amount: Money<'EC'>, fencingToken: string): LlmFinancialDomainError | null {
    if (this.#state !== 'accrued' && this.#state !== 'settled') {
      return llmFinancialDomainError('invalid_payable_transition');
    }
    this.#amount = amount;
    this.#state = 'adjusted';
    this.#fencingToken = fencingToken as FencingToken;
    this.#version += 1;
    return null;
  }
}
