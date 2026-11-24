/**
 * Bất biến conservation dưới dạng property-style: sau MỌI thao tác tiền di
 * chuyển (reserve / capture / release / settle / refund / adjustment) trên cả
 * hai ví, ba số dư luôn thỏa `available >= 0, held >= 0, charged >= 0` và
 * `available + held + charged = total`; số dư ví phải bằng số dư suy ra từ
 * ledger (`deriveWalletBalances`), và ledger luôn cân bằng (double-entry).
 *
 * Đường đi là giả ngẫu nhiên nhưng suy ra tất định từ một hạt giống cố định —
 * không `Math.random`, không đọc đồng hồ.
 */

import { describe, expect, it } from 'vitest';

import {
  adjustCharge,
  capture,
  creditDeposit,
  locateWallet,
  refundCharge,
  registerDeposit,
  release,
  reserve,
  settle,
  type FinancialBook,
} from '../index';
import { deriveWalletBalances } from '../ledger/ledger';
import { createTestBook, IDS, NOW, ec, uc, unwrap } from '../shared/test-fixtures';
import type { Denomination, Money } from '../money/money';

/** Hạt giống cố định → chuỗi thao tác giống hệt nhau giữa các lần chạy. */
let seed = 0xcafecafecafecafen;
function rand(): number {
  // 64-bit LCG, deterministic.
  seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
  return Number((seed >> 17n) % 1_000_000n) / 1_000_000;
}
function pickInt(max: number): number {
  return Math.floor(rand() * max);
}

function walletOf(book: FinancialBook, walletId: string) {
  return unwrap(locateWallet(book, walletId as never)).wallet;
}

function assertConservation(book: FinancialBook): void {
  // Double-entry: tổng debit − tổng credit qua toàn bộ ledger phải bằng 0.
  let ledgerSum = 0n;
  for (const tx of book.ledger.transactions) {
    for (const entry of tx.entries) {
      ledgerSum += entry.direction === 'debit' ? entry.amount.minor : -entry.amount.minor;
    }
  }
  expect(ledgerSum).toBe(0n);

  for (const account of book.accounts) {
    for (const wallet of account.wallets) {
      const b = wallet.balances;
      expect(b.available.minor).toBeGreaterThanOrEqual(0n);
      expect(b.held.minor).toBeGreaterThanOrEqual(0n);
      expect(b.charged.minor).toBeGreaterThanOrEqual(0n);
      expect(b.available.minor + b.held.minor + b.charged.minor).toBe(b.total.minor);
      // Balance là projection của ledger — phải khớp từng thành phần.
      const derived = unwrap(
        deriveWalletBalances(book.ledger, wallet.wallet_id, wallet.denomination),
      );
      expect(derived.available.minor).toBe(b.available.minor);
      expect(derived.held.minor).toBe(b.held.minor);
      expect(derived.charged.minor).toBe(b.charged.minor);
      expect(derived.total.minor).toBe(b.total.minor);
    }
  }
}

/** Một reservation đang `reserved` mà test đang theo dõi. */
interface LiveReservation {
  readonly reservationId: string;
  readonly walletId: string;
  readonly denom: Denomination;
  readonly reserved: bigint;
}

/** Một charge đã `posted` cùng các accumulator chạy kèm theo nó. */
interface LiveCharge {
  readonly chargeId: string;
  readonly walletId: string;
  readonly denom: Denomination;
  amount: bigint;
  refunded: bigint;
  increase: bigint;
  decrease: bigint;
}

/** Phần charge còn có thể hoàn — cùng công thức với `refundableAmount`. */
function refundable(charge: LiveCharge): bigint {
  const net = charge.amount + charge.increase - charge.decrease;
  return net > charge.refunded ? net - charge.refunded : 0n;
}

function amountOf(denom: Denomination, minor: bigint): Money {
  return denom === 'EC' ? ec(minor) : uc(minor);
}

/** Số ngẫu nhiên trong khoảng `[1, max]` theo denomination đã cho. */
function amountIn(denom: Denomination, max: bigint): Money {
  return amountOf(denom, BigInt(pickInt(Number(max)) + 1));
}

describe('conservation across operations (property-style)', () => {
  it('keeps available plus held plus charged equal to total after a deterministic walk of mixed operations', () => {
    const { book: start } = createTestBook({ ecAmount: 100_000n, ucAmount: 100_000n });
    let book = start;

    const wallets: ReadonlyArray<{ id: string; denom: Denomination }> = [
      { id: IDS.ecWallet, denom: 'EC' },
      { id: IDS.ucWallet, denom: 'UC' },
    ];
    const fencing: Record<string, string> = {
      [IDS.ecWallet]: IDS.ecFence,
      [IDS.ucWallet]: IDS.ucFence,
    };

    const reservations: LiveReservation[] = [];
    const charges: LiveCharge[] = [];
    let reservationSeq = 0;
    let chargeSeq = 0;
    let depositSeq = 0;
    let refundSeq = 0;
    let adjustmentSeq = 0;

    const iterations = 400;
    for (let i = 0; i < iterations; i++) {
      const wallet = wallets[pickInt(wallets.length)];
      const w = walletOf(book, wallet.id);
      const at = NOW + i * 10;

      switch (pickInt(7)) {
        case 0: {
          // Credit một deposit — đường duy nhất làm tăng total.
          const amount = amountIn(wallet.denom, 1_000n);
          const registered = unwrap(
            registerDeposit(book, {
              depositId: `dep-${++depositSeq}`,
              walletId: wallet.id,
              amount,
              paymentReference: `pay:${depositSeq}`,
              createdAt: at,
            }),
          );
          book = unwrap(
            creditDeposit(registered.book, {
              depositId: registered.deposit.deposit_id,
              creditedAt: at + 1,
              fencingToken: fencing[wallet.id],
            }),
          ).book;
          break;
        }
        case 1: {
          // Reserve một phần available.
          const available = w.balances.available.minor;
          if (available < 1n) {
            break;
          }
          const reserved = unwrap(
            reserve(book, {
              reservationId: `rsv-${++reservationSeq}`,
              walletId: wallet.id,
              billingAccountId: w.billing_account_id,
              amount: amountIn(wallet.denom, available),
              createdAt: at,
              fencingToken: fencing[wallet.id],
            }),
          );
          reservations.push({
            reservationId: reserved.reservation.reservation_id,
            walletId: wallet.id,
            denom: wallet.denom,
            reserved: reserved.reservation.reserved.minor,
          });
          book = reserved.book;
          break;
        }
        case 2: {
          // Capture toàn bộ hoặc một phần (kèm release phần dư).
          if (reservations.length === 0) {
            break;
          }
          const index = pickInt(reservations.length);
          const res = reservations[index];
          reservations.splice(index, 1);
          const full = pickInt(2) === 0;
          const amount = full
            ? amountOf(res.denom, res.reserved)
            : amountIn(res.denom, res.reserved);
          const captured = unwrap(
            capture(book, {
              reservationId: res.reservationId,
              amount,
              releaseRemainder: !full,
              capturedAt: at + 1,
              fencingToken: fencing[res.walletId],
            }),
          );
          if (captured.reservation.captured.minor !== amount.minor) {
            throw new Error('capture did not record the requested amount.');
          }
          book = captured.book;
          break;
        }
        case 3: {
          // Release toàn bộ phần giữ của một reservation.
          if (reservations.length === 0) {
            break;
          }
          const index = pickInt(reservations.length);
          const res = reservations[index];
          reservations.splice(index, 1);
          book = unwrap(
            release(book, {
              reservationId: res.reservationId,
              releasedAt: at + 1,
              fencingToken: fencing[res.walletId],
            }),
          ).book;
          break;
        }
        case 4: {
          // Settle reservation thành charge (một phần hoặc toàn bộ).
          if (reservations.length === 0) {
            break;
          }
          const index = pickInt(reservations.length);
          const res = reservations[index];
          reservations.splice(index, 1);
          const settled = unwrap(
            settle(book, {
              settlementId: `stl-${++chargeSeq}`,
              reservationId: res.reservationId,
              chargeId: `chg-${chargeSeq}`,
              chargeAmount: amountIn(res.denom, res.reserved),
              settledAt: at + 1,
              fencingToken: fencing[res.walletId],
              seller: null,
            }),
          );
          charges.push({
            chargeId: settled.charge.charge_id,
            walletId: res.walletId,
            denom: res.denom,
            amount: settled.charge.amount.minor,
            refunded: 0n,
            increase: 0n,
            decrease: 0n,
          });
          book = settled.book;
          break;
        }
        case 5: {
          // Refund một phần charge.
          const refundableCharges = charges.filter((c) => refundable(c) > 0n);
          if (refundableCharges.length === 0) {
            break;
          }
          const charge = refundableCharges[pickInt(refundableCharges.length)];
          const amount = amountIn(charge.denom, refundable(charge));
          const refunded = unwrap(
            refundCharge(book, {
              refundId: `rfd-${++refundSeq}`,
              chargeId: charge.chargeId,
              amount,
              reasonRef: null,
              refundedAt: at + 1,
              fencingToken: fencing[charge.walletId],
            }),
          );
          if (refunded.charge.state === 'refunded' && refundable(charge) - amount.minor !== 0n) {
            throw new Error('charge marked refunded before the refundable amount was exhausted.');
          }
          charge.refunded += amount.minor;
          book = refunded.book;
          break;
        }
        case 6: {
          // Adjust charge: increase tiêu available, decrease trả lại available.
          if (charges.length === 0) {
            break;
          }
          const target = charges[pickInt(charges.length)];
          if (target.denom !== wallet.denom) {
            break;
          }
          if (w.balances.available.minor > 0n) {
            const adjusted = unwrap(
              adjustCharge(book, {
                adjustmentId: `adj-${++adjustmentSeq}`,
                chargeId: target.chargeId,
                direction: 'increase',
                amount: amountIn(wallet.denom, w.balances.available.minor),
                reasonRef: `undercharge:${adjustmentSeq}`,
                adjustedAt: at + 1,
                fencingToken: fencing[target.walletId],
              }),
            );
            target.increase = adjusted.charge.increase.minor;
            book = adjusted.book;
          } else if (refundable(target) > 0n) {
            const adjusted = unwrap(
              adjustCharge(book, {
                adjustmentId: `adj-${++adjustmentSeq}`,
                chargeId: target.chargeId,
                direction: 'decrease',
                amount: amountIn(wallet.denom, refundable(target)),
                reasonRef: `overcharge:${adjustmentSeq}`,
                adjustedAt: at + 1,
                fencingToken: fencing[target.walletId],
              }),
            );
            target.decrease = adjusted.charge.decrease.minor;
            book = adjusted.book;
          }
          break;
        }
      }
      assertConservation(book);
    }
    // Đường đi phải thật sự di chuyển tiền — nếu không assertConservation là
    // kiểm trên book rỗng.
    expect(book.ledger.transactions.length).toBeGreaterThan(2);
  });
});
