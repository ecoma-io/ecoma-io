/**
 * Credit và deposit — nguồn duy nhất làm tăng `total` của một wallet.
 *
 * State (§4.1): `pending → credited → reversed`.
 *
 * - `pending`: Payment đã khởi tạo nhưng chưa xác nhận; chưa có bút toán và
 *   chưa tăng balance. Lib giữ record để caller đối chiếu.
 * - `credited`: bút toán `funding_clearing` debit / `wallet_available` credit —
 *   đây là chỗ duy nhất `total` tăng.
 * - `reversed`: deposit bị đảo (payment fail/refund). Bút toán đối ứng **giữ
 *   nguyên bất biến conservation**: `wallet_available` debit / `funding_clearing`
 *   credit, và `total` giảm đúng bằng số đã credit. Không có đường nào giảm
 *   `total` mà không ghi bút toán đối ứng.
 *
 * Idempotent theo `deposit_id` ở mọi transition: replay cùng payload trả record
 * gốc; transition không hợp lệ là domain error.
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';
import {
  commitTransaction,
  derivedIdempotencyKey,
  derivedTransactionId,
  locateWallet,
  type FinancialBook,
} from '../book/book';
import { referenceOf } from '../ledger/ledger';
import {
  isDepositState,
  type Deposit,
  type Deposit as DepositRecord,
  type DepositState,
} from '../wallet/wallet';
import { isMoney, type Money } from '../money/money';
import {
  assertAggregateInvariant,
  financialFailure,
  financialOk,
  freezeArray,
  isEpochMillis,
  isOpaqueId,
  type WalletId,
  type FinancialResult,
} from '../shared/shared';
import { llmFinancialDomainError, type LlmFinancialDomainError } from '../shared/errors';

export type { Deposit } from '../wallet/wallet';

/** Trạng thái deposit mà caller đăng ký khi Payment báo một khoản nạp. */
export interface RegisterDepositInput {
  readonly depositId: string;
  readonly walletId: string;
  readonly amount: Money;
  readonly paymentReference: string;
  readonly createdAt: number;
}

/** Kết quả của một operation deposit. */
export interface DepositOutcome {
  readonly book: FinancialBook;
  readonly deposit: Deposit;
  readonly replayed: boolean;
}

/** Tìm deposit theo id. */
export function findDeposit(book: FinancialBook, depositId: string): FinancialResult<Deposit> {
  const deposit = book.deposits.find((candidate) => candidate.deposit_id === depositId);
  return deposit === undefined ? financialFailure('deposit_not_found') : financialOk(deposit);
}

/** Thay một deposit trong book. */
function replaceDeposit(book: FinancialBook, deposit: Deposit): FinancialBook {
  return Object.freeze({
    ...book,
    deposits: freezeArray(
      book.deposits.map((candidate) =>
        candidate.deposit_id === deposit.deposit_id ? deposit : candidate,
      ),
    ),
  });
}

/**
 * Đăng ký một deposit ở trạng thái `pending`.
 *
 * Chưa có bút toán, chưa đổi balance: một pending deposit không phải tiền trong
 * ví, và không bao giờ được dùng để reserve.
 */
export function registerDeposit(
  book: FinancialBook,
  input: RegisterDepositInput,
): FinancialResult<DepositOutcome> {
  if (
    !isOpaqueId(input.depositId) ||
    !isOpaqueId(input.walletId) ||
    !isOpaqueId(input.paymentReference) ||
    !isEpochMillis(input.createdAt) ||
    !isMoney(input.amount) ||
    input.amount.minor <= 0n
  ) {
    return financialFailure('invalid_amount');
  }
  const located = locateWallet(book, input.walletId as WalletId);
  if (!located.ok) {
    return located;
  }
  if (located.value.wallet.denomination !== input.amount.denomination) {
    return financialFailure('denomination_mismatch');
  }
  const existing = book.deposits.find((candidate) => candidate.deposit_id === input.depositId);
  if (existing !== undefined) {
    if (
      existing.wallet_id !== input.walletId ||
      existing.amount.minor !== input.amount.minor ||
      existing.payment_reference !== input.paymentReference
    ) {
      return financialFailure('idempotency_conflict');
    }
    return financialOk(Object.freeze({ book, deposit: existing, replayed: true }));
  }
  const deposit: DepositRecord = Object.freeze({
    deposit_id: input.depositId,
    wallet_id: located.value.wallet.wallet_id,
    amount: input.amount,
    state: 'pending',
    created_at: input.createdAt,
    payment_reference: input.paymentReference,
  });
  return financialOk(
    Object.freeze({
      book: Object.freeze({ ...book, deposits: freezeArray([...book.deposits, deposit]) }),
      deposit,
      replayed: false,
    }),
  );
}

/** Input của `creditDeposit`. */
export interface CreditDepositInput {
  readonly depositId: string;
  readonly creditedAt: number;
  readonly fencingToken: string;
}

/**
 * Chuyển deposit `pending → credited` và nạp tiền vào available balance.
 *
 * Đây là operation duy nhất làm tăng `total`. Từ chối nếu deposit không ở trạng
 * thái `pending`; replay một deposit đã `credited` trả record gốc.
 */
export function creditDeposit(
  book: FinancialBook,
  input: CreditDepositInput,
): FinancialResult<DepositOutcome> {
  const found = findDeposit(book, input.depositId);
  if (!found.ok) {
    return found;
  }
  const deposit = found.value;
  if (deposit.state === 'credited') {
    return financialOk(Object.freeze({ book, deposit, replayed: true }));
  }
  if (deposit.state !== 'pending') {
    return financialFailure('invalid_deposit_transition');
  }
  if (!isEpochMillis(input.creditedAt) || !isOpaqueId(input.fencingToken)) {
    return financialFailure('invalid_epoch_millis');
  }
  const located = locateWallet(book, deposit.wallet_id);
  if (!located.ok) {
    return located;
  }
  const commit = commitTransaction(book, {
    accountId: located.value.account.billing_account_id,
    walletId: deposit.wallet_id,
    denomination: deposit.amount.denomination,
    transactionId: derivedTransactionId('credit', deposit.deposit_id, 'credit'),
    idempotencyKey: derivedIdempotencyKey('credit', deposit.deposit_id, 'credit'),
    reference: referenceOf('credit', deposit.deposit_id),
    fencingToken: input.fencingToken,
    createdAt: input.creditedAt,
    legs: [
      { account: 'funding_clearing', direction: 'credit', amount: deposit.amount },
      { account: 'wallet_available', direction: 'debit', amount: deposit.amount },
    ],
  });
  if (!commit.ok) {
    return commit;
  }
  const next: DepositRecord = Object.freeze({ ...deposit, state: 'credited' });
  return financialOk(
    Object.freeze({
      book: replaceDeposit(commit.value.book, next),
      deposit: next,
      replayed: false,
    }),
  );
}

/** Input của `reverseDeposit`. */
export interface ReverseDepositInput {
  readonly depositId: string;
  readonly reversedAt: number;
  readonly fencingToken: string;
  /** Tham chiếu tới bằng chứng đảo — caller cấp, opaque. */
  readonly evidenceRef: string;
}

/**
 * Đảo một deposit đã credit — `credited → reversed`.
 *
 * Bút toán đối ứng debit `wallet_available` / credit `funding_clearing`. Từ chối
 * nếu available không đủ để đảo (`insufficient_available_balance`) — khi tiền
 * đã bị giữ hoặc đã chi, đảo deposit cần xử lý tường minh, không được ép số dư
 * âm. Đó là lý do `reversed` không phải một phép "xoá" mà là một transaction
 * thật.
 */
export function reverseDeposit(
  book: FinancialBook,
  input: ReverseDepositInput,
): FinancialResult<DepositOutcome> {
  const found = findDeposit(book, input.depositId);
  if (!found.ok) {
    return found;
  }
  const deposit = found.value;
  if (deposit.state === 'reversed') {
    return financialOk(Object.freeze({ book, deposit, replayed: true }));
  }
  if (deposit.state !== 'credited') {
    return financialFailure('invalid_deposit_transition');
  }
  if (
    !isEpochMillis(input.reversedAt) ||
    !isOpaqueId(input.fencingToken) ||
    !isOpaqueId(input.evidenceRef)
  ) {
    return financialFailure('invalid_epoch_millis');
  }
  const located = locateWallet(book, deposit.wallet_id);
  if (!located.ok) {
    return located;
  }
  if (located.value.wallet.balances.available.minor < deposit.amount.minor) {
    return financialFailure('insufficient_available_balance');
  }
  const commit = commitTransaction(book, {
    accountId: located.value.account.billing_account_id,
    walletId: deposit.wallet_id,
    denomination: deposit.amount.denomination,
    transactionId: derivedTransactionId('credit', deposit.deposit_id, 'reverse'),
    idempotencyKey: derivedIdempotencyKey('credit', deposit.deposit_id, 'reverse'),
    reference: referenceOf('credit_reversal', deposit.deposit_id),
    fencingToken: input.fencingToken,
    createdAt: input.reversedAt,
    legs: [
      { account: 'wallet_available', direction: 'credit', amount: deposit.amount },
      { account: 'funding_clearing', direction: 'debit', amount: deposit.amount },
    ],
  });
  if (!commit.ok) {
    return commit;
  }
  const next: DepositRecord = Object.freeze({ ...deposit, state: 'reversed' });
  return financialOk(
    Object.freeze({
      book: replaceDeposit(commit.value.book, next),
      deposit: next,
      replayed: false,
    }),
  );
}

/** Type guard cho trạng thái deposit — re-export để consumer kiểm dữ liệu đọc từ ngoài. */
export { isDepositState };

/**
 * Aggregate root `Deposit` — một lần credit vào wallet, state machine
 * `pending → credited → reversed` (§4.1).
 *
 * `credit()` và `toReversed()` chỉ chuyển state trong bộ nhớ; posting bút toán đối
 * ứng thuộc về `FinancialBook` qua `commitTransaction`. Caller persist
 * `snapshot()` sau khi transition thành công.
 */
export class DepositAggregate extends AggregateRoot<string> {
  #walletId: WalletId;
  #amount: Money;
  #state: DepositState;
  #createdAt: number;
  #paymentReference: string;

  private constructor(
    id: string,
    walletId: WalletId,
    amount: Money,
    state: DepositState,
    createdAt: number,
    paymentReference: string,
  ) {
    super(id);
    this.#walletId = walletId;
    this.#amount = amount;
    this.#state = state;
    this.#createdAt = createdAt;
    this.#paymentReference = paymentReference;
  }

  /**
   * Dựng deposit `pending` mới từ input provisioning.
   *
   * Aggregate tự bảo vệ trước khi trở thành state: cùng tập điều kiện mà
   * `registerDeposit` áp ở tầng operation (id shape, amount dương đúng
   * denomination, timestamp epoch millis). Vi phạm là `TypeError`, không phải
   * một outcome domain.
   */
  public static issue(input: {
    depositId: string;
    walletId: string;
    amount: Money;
    paymentReference: string;
    createdAt: number;
  }): DepositAggregate {
    assertAggregateInvariant(
      isOpaqueId(input.depositId) &&
        isOpaqueId(input.walletId) &&
        isOpaqueId(input.paymentReference),
      'invalid_id',
    );
    assertAggregateInvariant(isMoney(input.amount) && input.amount.minor > 0n, 'invalid_amount');
    assertAggregateInvariant(isEpochMillis(input.createdAt), 'invalid_epoch_millis');
    return new DepositAggregate(
      input.depositId,
      input.walletId as WalletId,
      input.amount,
      'pending',
      input.createdAt,
      input.paymentReference,
    );
  }

  /**
   * Reconstitute deposit từ record; ném `TypeError` khi snapshot hỏng — state
   * lạ, timestamp vô lệ, id shape sai hay amount không hợp lệ là dữ liệu hỏng,
   * không phải state aggregate. Cùng mức validate với `issue()`.
   */
  public static reconstitute(record: Deposit): DepositAggregate {
    assertAggregateInvariant(
      isOpaqueId(record.deposit_id) &&
        isOpaqueId(record.wallet_id) &&
        isOpaqueId(record.payment_reference),
      'invalid_id',
    );
    assertAggregateInvariant(isDepositState(record.state), 'invalid_deposit_transition');
    assertAggregateInvariant(isEpochMillis(record.created_at), 'invalid_epoch_millis');
    assertAggregateInvariant(isMoney(record.amount) && record.amount.minor > 0n, 'invalid_amount');
    return new DepositAggregate(
      record.deposit_id,
      record.wallet_id,
      record.amount,
      record.state,
      record.created_at,
      record.payment_reference,
    );
  }

  public get wallet_id(): WalletId {
    return this.#walletId;
  }

  public get amount(): Money {
    return this.#amount;
  }

  public get state(): DepositState {
    return this.#state;
  }

  public get created_at(): number {
    return this.#createdAt;
  }

  public get payment_reference(): string {
    return this.#paymentReference;
  }

  /** Snapshot readonly — persist về record shape. */
  public snapshot(): Deposit {
    return Object.freeze({
      deposit_id: this.id,
      wallet_id: this.#walletId,
      amount: this.#amount,
      state: this.#state,
      created_at: this.#createdAt,
      payment_reference: this.#paymentReference,
    });
  }

  /** `pending → credited`. Từ chối mọi transition khác (`invalid_deposit_transition`). */
  public credit(): LlmFinancialDomainError | null {
    if (this.#state !== 'pending') {
      return llmFinancialDomainError('invalid_deposit_transition');
    }
    this.#state = 'credited';
    return null;
  }

  /** `credited → reversed` — terminal; từ `pending` là transition không hợp lệ. */
  public toReversed(): LlmFinancialDomainError | null {
    if (this.#state !== 'credited') {
      return llmFinancialDomainError('invalid_deposit_transition');
    }
    this.#state = 'reversed';
    return null;
  }
}
