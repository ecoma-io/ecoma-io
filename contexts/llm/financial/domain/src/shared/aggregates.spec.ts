/**
 * Spec cho các aggregate root (Phase 3): issue / reconstitute / snapshot và
 * state-machine method. Các operation trên `FinancialBook` đã được ghim bởi spec
 * của từng concept — file này chỉ phủ phần aggregate mới.
 */

import { describe, expect, it } from 'vitest';

import {
  ChargeAggregate,
  createWalletBalances,
  DepositAggregate,
  EscrowAggregate,
  LeaseAggregate,
  MAX_MONEY_MAGNITUDE,
  PayableAggregate,
  ReservationAggregate,
  SponsorGrantAggregate,
  WalletAggregate,
  type BudgetEscrow,
  type BudgetLease,
  type CustomerCharge,
  type Deposit,
  type LlmFinancialDomainError,
  type Reservation,
  type SellerPayable,
  type SponsorGrant,
  type Wallet,
} from '../index';
import { IDS, NOW, ec, uc, unwrap } from './test-fixtures';

/** Đọc error code từ kết quả mutation; null là thành công. */
function code(error: LlmFinancialDomainError | null): string {
  expect(error).not.toBeNull();
  return (error as LlmFinancialDomainError).code;
}

/**
 * Đọc mọi accessor của aggregate — phủ các getter và khẳng định snapshot khớp
 * field-by-field (round-trip issue → snapshot → reconstitute → snapshot).
 */
/** So sánh sâu an toàn BigInt — `JSON.stringify` ném trên BigInt. */
function stringify(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? `${item}n` : item,
  );
}

function expectAccessorsMatchSnapshot(aggregate: object, snapshot: Record<string, unknown>): void {
  const record = aggregate as Record<string, unknown> & { readonly id: unknown };
  const mismatches: string[] = [];
  for (const key of Object.keys(snapshot)) {
    // Trường id của snapshot ánh xạ về `id` kế thừa từ AggregateRoot.
    const actual = record[key] ?? (key.endsWith('_id') ? record.id : record[key]);
    const expected = snapshot[key];
    if (Array.isArray(expected)) {
      // Aggregate lồng nhau: so độ dài thay vì so object (private field của
      // class instance không đọc được qua `toEqual`/`toBe`).
      if ((actual as unknown[] | undefined)?.length !== expected.length) {
        mismatches.push(key);
      }
    } else if (stringify(actual) !== stringify(expected)) {
      mismatches.push(key);
    }
  }
  expect(mismatches).toEqual([]);
}

/** Wallet aggregate đã nạp `available` — dựng qua record shape hợp lệ. */
function fundedWallet(available: bigint): WalletAggregate {
  const zero = ec(0);
  const balances = unwrap(
    createWalletBalances({ available: ec(available), held: zero, charged: zero }),
  );
  return WalletAggregate.reconstitute(
    Object.freeze({
      wallet_id: 'wallet-agg',
      billing_account_id: IDS.sellerAccount,
      denomination: 'EC',
      balances,
      fencing_token: IDS.ecFence,
    }) as Wallet,
  );
}

describe('WalletAggregate', () => {
  it('issues a zero wallet and round-trips a snapshot', () => {
    const wallet = unwrap(
      WalletAggregate.issue({
        walletId: 'wallet-agg',
        billingAccountId: IDS.sellerAccount,
        denomination: 'EC',
        fencingToken: IDS.ecFence,
      }),
    );
    expect(wallet.balances.available.minor).toBe(0n);
    expect(wallet.balances.total.minor).toBe(0n);
    const restored = WalletAggregate.reconstitute(wallet.snapshot() as Wallet);
    expect(restored.snapshot().wallet_id).toBe('wallet-agg');
    expect(restored.snapshot().balances.available.minor).toBe(0n);
  });

  it('reserves, captures with remainder rule, releases and settles', () => {
    const wallet = fundedWallet(50n);
    expect(wallet.reserve(ec(50))).toBeNull();
    expect(code(wallet.reserve(ec(1_000_000)))).toBe('insufficient_available_balance');
    expect(code(wallet.reserve(uc(1)))).toBe('denomination_mismatch');
    // held = 50, available = 0.
    expect(code(wallet.capture(ec(60), { releaseRemainder: true }))).toBe(
      'insufficient_held_balance',
    );

    // Capture một phần không kèm releaseRemainder bị từ chối; capture toàn bộ thì được.
    expect(code(wallet.capture(ec(30)))).toBe('remainder_release_required');
    expect(wallet.capture(ec(30), { releaseRemainder: true })).toBeNull();
    expect(wallet.balances.charged.minor).toBe(30n);
    expect(wallet.balances.held.minor).toBe(0n);
    expect(wallet.balances.available.minor).toBe(20n);

    // Release phần chưa dùng, rồi settle phần giữ mới.
    expect(wallet.reserve(ec(10))).toBeNull();
    expect(wallet.release(ec(5))).toBeNull();
    expect(code(wallet.release(ec(999)))).toBe('insufficient_held_balance');
    expect(wallet.balances.available.minor).toBe(15n);
    expect(wallet.settle(ec(5))).toBeNull();
    expect(wallet.balances.charged.minor).toBe(35n);
    expect(wallet.balances.available.minor).toBe(15n);
    // Bất biến conservation giữ nguyên qua mọi mutation.
    expect(
      wallet.balances.available.minor + wallet.balances.held.minor + wallet.balances.charged.minor,
    ).toBe(wallet.balances.total.minor);
  });

  it('rejects a corrupt snapshot', () => {
    expect(() => WalletAggregate.reconstitute({} as unknown as Wallet)).toThrow(TypeError);
    // Snapshot vi phạm conservation (total ≠ available + held + charged) phải
    // bị từ chối ở mức aggregate — không chỉ `{}` shape hỏng.
    const funded = fundedWallet(7n);
    const corrupt = {
      ...funded.snapshot(),
      balances: {
        ...funded.snapshot().balances,
        total: ec(9),
      },
    } as unknown as Wallet;
    expect(() => WalletAggregate.reconstitute(corrupt)).toThrow(TypeError);
    // Accessor khớp snapshot field-by-field.
    expectAccessorsMatchSnapshot(funded, funded.snapshot() as unknown as Record<string, unknown>);
  });
});

describe('DepositAggregate', () => {
  it('walks pending → credited → reversed and rejects wrong transitions', () => {
    const deposit = DepositAggregate.issue({
      depositId: 'dep-agg',
      walletId: IDS.ecWallet,
      amount: ec(100),
      paymentReference: 'pay:agg',
      createdAt: NOW,
    });
    expect(deposit.state).toBe('pending');
    expect(code(deposit.toReversed())).toBe('invalid_deposit_transition');
    expect(deposit.credit()).toBeNull();
    expect(deposit.state).toBe('credited');
    expect(code(deposit.credit())).toBe('invalid_deposit_transition');
    expect(deposit.toReversed()).toBeNull();
    expect(deposit.state).toBe('reversed');
    const snapshot = deposit.snapshot() as Deposit;
    expect(snapshot.deposit_id).toBe('dep-agg');
    expect(snapshot.payment_reference).toBe('pay:agg');
    expectAccessorsMatchSnapshot(deposit, snapshot as unknown as Record<string, unknown>);
    expect(() =>
      DepositAggregate.reconstitute({ ...snapshot, state: 'nope' } as unknown as Deposit),
    ).toThrow(TypeError);
    expect(() =>
      DepositAggregate.reconstitute({ ...snapshot, created_at: 'yesterday' } as unknown as Deposit),
    ).toThrow(TypeError);
  });
});

describe('SponsorGrantAggregate', () => {
  it('walks pending → credited → reversed and only reverses from credited', () => {
    const grant = SponsorGrantAggregate.issue({
      grantId: 'grant-agg',
      authorizationId: 'auth-agg',
      sponsorId: 'sponsor-agg',
      billingAccountId: IDS.sellerAccount,
      amount: ec(500),
      actorRef: 'actor:agg',
      createdAt: NOW,
    });
    expect(grant.state).toBe('pending');
    expect(code(grant.toReversed())).toBe('invalid_grant_transition');
    expect(grant.credit()).toBeNull();
    expect(grant.state).toBe('credited');
    expect(code(grant.credit())).toBe('invalid_grant_transition');
    expect(grant.toReversed()).toBeNull();
    expect(grant.state).toBe('reversed');
    const snapshot = grant.snapshot() as SponsorGrant;
    expect(snapshot.authorization_id).toBe('auth-agg');
    expectAccessorsMatchSnapshot(grant, snapshot as unknown as Record<string, unknown>);
    expect(() =>
      SponsorGrantAggregate.reconstitute({ ...snapshot, state: 'nope' } as unknown as SponsorGrant),
    ).toThrow(TypeError);
  });
});

function postedCharge(): ChargeAggregate {
  const charge = ChargeAggregate.issue({
    chargeId: 'charge-agg',
    walletId: IDS.ecWallet,
    billingAccountId: IDS.sellerAccount,
    denomination: 'EC',
    amount: ec(100),
    reservationId: 'res-agg',
    settlementId: 'set-agg',
    createdAt: NOW,
  });
  expect(charge.post(NOW + 1)).toBeNull();
  return charge;
}

describe('ChargeAggregate', () => {
  it('posts a pending charge exactly once', () => {
    const charge = ChargeAggregate.issue({
      chargeId: 'charge-agg',
      walletId: IDS.ecWallet,
      billingAccountId: IDS.sellerAccount,
      denomination: 'EC',
      amount: ec(100),
      reservationId: null,
      settlementId: null,
      createdAt: NOW,
    });
    expect(charge.state).toBe('pending');
    expect(code(charge.applyRefund(ec(1)))).toBe('invalid_charge_transition');
    expect(charge.post(NOW + 1)).toBeNull();
    expect(code(charge.post(NOW + 2))).toBe('invalid_charge_transition');
    expect((charge.snapshot() as CustomerCharge).posted_at).toBe(NOW + 1);
  });

  it('accumulates refunds until fully refunded and caps refunds at the charge', () => {
    const charge = postedCharge();
    expect(code(charge.applyRefund(uc(1)))).toBe('denomination_mismatch');
    expect(code(charge.applyRefund(ec(101)))).toBe('refund_exceeds_charge');
    expect(charge.applyRefund(ec(60))).toBeNull();
    expect(charge.refundable().minor).toBe(40n);
    expect(charge.applyRefund(ec(40))).toBeNull();
    expect(charge.state).toBe('refunded');
    expect(charge.refundable().minor).toBe(0n);
  });

  it('accumulates adjustments and rejects magnitude overflow', () => {
    const charge = postedCharge();
    expect(code(charge.applyAdjustment('increase', uc(1)))).toBe('denomination_mismatch');
    expect(charge.applyAdjustment('increase', ec(10))).toBeNull();
    expect(charge.applyAdjustment('decrease', ec(4))).toBeNull();
    expect(charge.state).toBe('adjusted');
    expect(charge.refundable().minor).toBe(106n);
    // Tích luỹ increase tới trần magnitude: lần tiếp theo là amount_overflow.
    const maxed = postedCharge();
    expect(maxed.applyAdjustment('increase', ec(MAX_MONEY_MAGNITUDE))).toBeNull();
    expect(code(maxed.applyAdjustment('increase', ec(1)))).toBe('amount_overflow');
  });

  it('rejects a corrupt snapshot', () => {
    expect(() => ChargeAggregate.reconstitute({} as unknown as CustomerCharge)).toThrow(TypeError);
    const charge = postedCharge();
    expectAccessorsMatchSnapshot(charge, charge.snapshot() as unknown as Record<string, unknown>);
  });
});

function accrued(): PayableAggregate {
  return PayableAggregate.issue({
    payableId: 'payable-agg',
    sellerTenant: 'tenant-agg',
    amount: ec(300),
    period: '2026-11',
    availableAt: NOW,
    accruedAt: NOW,
    settlementId: 'set-agg',
    chargeId: 'charge-agg',
    fencingToken: 'fence-agg',
  });
}

describe('PayableAggregate', () => {
  it('walks accrued → settled → paid with append-only versions', () => {
    const payable = accrued();
    expect(payable.version).toBe(1);
    expect(payable.state).toBe('accrued');
    expect(code(payable.markPaid(NOW + 2, 'payout:agg', 'fence-agg-2'))).toBe(
      'invalid_payable_transition',
    );
    expect(payable.settle(NOW + 1, 'fence-agg-1')).toBeNull();
    expect(payable.version).toBe(2);
    expect(payable.state).toBe('settled');
    expect(code(payable.settle(NOW + 2, 'fence-agg-3'))).toBe('invalid_payable_transition');
    // `paid` đòi bằng chứng payout — thiếu evidence là từ chối, không chuyển state.
    expect(code(payable.markPaid(NOW + 2, '', 'fence-agg-2'))).toBe('payout_evidence_required');
    expect(payable.state).toBe('settled');
    expect(payable.markPaid(NOW + 2, 'payout:agg', 'fence-agg-2')).toBeNull();
    expect(payable.version).toBe(3);
    expect(payable.state).toBe('paid');
    expect((payable.snapshot() as SellerPayable).payout_evidence_ref).toBe('payout:agg');
  });

  it('adjusts from accrued or settled and bumps the version', () => {
    const payable = accrued();
    expect(payable.adjust(ec(250), 'fence-agg-9')).toBeNull();
    expect(payable.version).toBe(2);
    expect(payable.state).toBe('adjusted');
    expect(payable.amount.minor).toBe(250n);
    expect(code(payable.settle(NOW + 1, 'fence-agg-1'))).toBe('invalid_payable_transition');
  });

  it('rejects a corrupt snapshot', () => {
    expect(() => PayableAggregate.reconstitute({} as unknown as SellerPayable)).toThrow(TypeError);
    const payable = accrued();
    expectAccessorsMatchSnapshot(payable, payable.snapshot() as unknown as Record<string, unknown>);
  });
});

describe('ReservationAggregate', () => {
  it('captures fully or partially with the explicit remainder rule', () => {
    const reservation = ReservationAggregate.issue({
      reservationId: 'res-agg',
      walletId: IDS.ecWallet,
      billingAccountId: IDS.sellerAccount,
      denomination: 'EC',
      reserved: ec(100),
      createdAt: NOW,
      fencingToken: 'fence-res',
    });
    expect(reservation.state).toBe('reserved');
    expect(code(reservation.capture(uc(1)))).toBe('denomination_mismatch');
    expect(code(reservation.capture(ec(0)))).toBe('invalid_amount');
    expect(code(reservation.capture(ec(101)))).toBe('insufficient_held_balance');
    expect(code(reservation.capture(ec(60)))).toBe('remainder_release_required');
    expect(reservation.capture(ec(60), { releaseRemainder: true })).toBeNull();
    expect(reservation.state).toBe('captured');
    expect(reservation.captured.minor).toBe(60n);
    expect(reservation.released.minor).toBe(40n);
    expect(code(reservation.capture(ec(1), { releaseRemainder: true }))).toBe(
      'reservation_already_finalized',
    );
    const snapshot = reservation.snapshot() as Reservation;
    expect(snapshot.reservation_id).toBe('res-agg');
    expectAccessorsMatchSnapshot(reservation, snapshot as unknown as Record<string, unknown>);
    expect(() => ReservationAggregate.reconstitute({} as unknown as Reservation)).toThrow(
      TypeError,
    );
  });

  it('releases the full hold exactly once', () => {
    const reservation = ReservationAggregate.issue({
      reservationId: 'res-agg-2',
      walletId: IDS.ecWallet,
      billingAccountId: IDS.sellerAccount,
      denomination: 'EC',
      reserved: ec(70),
      createdAt: NOW,
      fencingToken: 'fence-res',
    });
    expect(reservation.release()).toBeNull();
    expect(reservation.state).toBe('released');
    expect(reservation.released.minor).toBe(70n);
    expect(code(reservation.release())).toBe('reservation_already_finalized');
  });
});

function activeLease(): LeaseAggregate {
  return LeaseAggregate.issue({
    leaseId: 'lease-agg',
    escrowId: 'escrow-agg',
    amount: ec(60),
    epoch: 1,
    fencingToken: 'fence-lease',
    issuedAt: NOW,
    expiresAt: NOW + 1_000,
  });
}

describe('LeaseAggregate', () => {
  it('revokes only a stale active lease and expires otherwise', () => {
    const granted = activeLease();
    expect(code(granted.revoke(1, NOW + 5))).toBe('lease_not_stale');
    expect(granted.revoke(2, NOW + 5)).toBeNull();
    expect(granted.state).toBe('revoked');
    expect(granted.reallocated_at).toBe(NOW + 5);
    expect(code(granted.expire())).toBe('invalid_budget_lease');
    const fresh = activeLease();
    expect(fresh.expire()).toBeNull();
    expect(fresh.state).toBe('expired');
    const snapshot = fresh.snapshot() as BudgetLease;
    expect(snapshot.lease_id).toBe('lease-agg');
    expectAccessorsMatchSnapshot(fresh, snapshot as unknown as Record<string, unknown>);
    expect(() =>
      LeaseAggregate.reconstitute({ ...snapshot, state: 'nope' } as unknown as BudgetLease),
    ).toThrow(TypeError);
  });
});

function openEscrow(): EscrowAggregate {
  return EscrowAggregate.issue({
    escrowId: 'escrow-agg',
    walletId: IDS.ecWallet,
    billingAccountId: IDS.sellerAccount,
    denomination: 'EC',
    amount: ec(100),
    createdAt: NOW,
    fencingToken: 'fence-escrow',
  });
}

function lease(leaseId: string, amount: bigint, epoch: number): LeaseAggregate {
  return LeaseAggregate.issue({
    leaseId,
    escrowId: 'escrow-agg',
    amount: ec(amount),
    epoch,
    fencingToken: 'fence-lease',
    issuedAt: NOW,
    expiresAt: NOW + 1_000,
  });
}

describe('EscrowAggregate', () => {
  it('issues leases monotonically within the earmarked amount', () => {
    const escrow = openEscrow();
    expect(escrow.state).toBe('open');
    expect(escrow.remaining()).toBe(100n);
    expect(escrow.issueLease(lease('lease-1', 60n, 1))).toBeNull();
    expect(escrow.allocated()).toBe(60n);
    expect(escrow.remaining()).toBe(40n);
    // Epoch phải đơn điệu tăng; id trùng hoặc epoch không vượt đều bị từ chối.
    expect(code(escrow.issueLease(lease('lease-1', 10n, 2)))).toBe('invalid_budget_lease');
    expect(code(escrow.issueLease(lease('lease-2', 10n, 1)))).toBe('invalid_budget_lease');
    expect(escrow.issueLease(lease('lease-3', 10n, 2))).toBeNull();
    // Vượt phần earmark còn lại.
    expect(code(escrow.issueLease(lease('lease-4', 41n, 3)))).toBe('invalid_budget_lease');
    // Sai denomination hoặc sai escrow.
    const foreign = LeaseAggregate.issue({
      leaseId: 'lease-5',
      escrowId: 'escrow-other',
      amount: uc(10),
      epoch: 9,
      fencingToken: 'fence-lease',
      issuedAt: NOW,
      expiresAt: NOW + 1_000,
    });
    expect(code(escrow.issueLease(foreign))).toBe('invalid_budget_lease');
  });

  it('closes only with reconciliation evidence and no live leases', () => {
    const escrow = openEscrow();
    expect(code(escrow.close('', NOW + 9))).toBe('reconciliation_required');
    expect(escrow.issueLease(lease('lease-1', 40n, 1))).toBeNull();
    expect(code(escrow.close('recon:agg', NOW + 9))).toBe('lease_not_stale');
    expect(escrow.leases[0].revoke(2, NOW + 5)).toBeNull();
    expect(escrow.close('recon:agg', NOW + 9)).toBeNull();
    expect(escrow.state).toBe('released');
    expect(escrow.released_at).toBe(NOW + 9);
    expect(escrow.remaining()).toBe(0n);
    expect(code(escrow.close('recon:agg-2', NOW + 10))).toBe('invalid_budget_lease');
    expect(code(escrow.issueLease(lease('lease-2', 10n, 5)))).toBe('invalid_budget_lease');
    expectAccessorsMatchSnapshot(escrow, escrow.snapshot() as unknown as Record<string, unknown>);
  });

  it('fail-closes an exhausted lease and rejects corrupt snapshots', () => {
    const escrow = openEscrow();
    expect(escrow.issueLease(lease('lease-1', 40n, 1))).toBeNull();
    // Mô phỏng lease đã tiêu hết tiền (state do persistence ghi) — close vẫn bị chặn.
    const drained = { ...(escrow.snapshot() as BudgetEscrow) } as unknown as {
      leases: Array<Record<string, unknown>>;
    };
    drained.leases = drained.leases.map((l) => ({ ...l, state: 'exhausted' }));
    const rehydrated = EscrowAggregate.reconstitute(drained as unknown as BudgetEscrow);
    expect(code(rehydrated.close('recon:agg', NOW + 9))).toBe('lease_not_stale');
    expect(() => EscrowAggregate.reconstitute({} as unknown as BudgetEscrow)).toThrow(TypeError);
  });

  it('rejects a snapshot whose lease epochs regress in write order', () => {
    const escrow = openEscrow();
    expect(escrow.issueLease(lease('lease-1', 40n, 1))).toBeNull();
    expect(escrow.issueLease(lease('lease-2', 10n, 2))).toBeNull();
    const snapshot = escrow.snapshot() as BudgetEscrow;
    // Snapshot với epoch lùi giữa hai lease liên tiếp — dữ liệu tự mâu thuẫn,
    // không được nạp thành aggregate.
    const swapped = {
      ...snapshot,
      leases: [snapshot.leases[1], snapshot.leases[0]],
    } as unknown as BudgetEscrow;
    expect(() => EscrowAggregate.reconstitute(swapped)).toThrow(TypeError);
    // Thứ tự đúng với cùng bộ lease thì nạp được.
    expect(() => EscrowAggregate.reconstitute(snapshot)).not.toThrow();
  });
});

describe('aggregate issue admission', () => {
  /**
   * `issue()` của aggregate tự bảo vệ ở cùng mức validate với book operation
   * tương ứng: dữ liệu provisioning hỏng là `TypeError`, không phải một outcome
   * domain — không còn đường "amount âm vẫn tạo aggregate".
   */
  it('rejects a negative deposit amount', () => {
    expect(() =>
      DepositAggregate.issue({
        depositId: 'dep-neg',
        walletId: IDS.ecWallet,
        amount: { denomination: 'EC', minor: -5n } as never,
        paymentReference: 'pay:neg',
        createdAt: NOW,
      }),
    ).toThrow(TypeError);
  });

  it('rejects a zero sponsor grant amount', () => {
    expect(() =>
      SponsorGrantAggregate.issue({
        grantId: 'grant-zero',
        authorizationId: 'auth-zero',
        sponsorId: 'sponsor-zero',
        billingAccountId: IDS.sellerAccount,
        amount: ec(0),
        actorRef: 'actor:zero',
        createdAt: NOW,
      }),
    ).toThrow(TypeError);
  });

  it('rejects a charge with a negative amount', () => {
    expect(() =>
      ChargeAggregate.issue({
        chargeId: 'charge-neg',
        walletId: IDS.ecWallet,
        billingAccountId: IDS.sellerAccount,
        denomination: 'EC',
        amount: { denomination: 'EC', minor: -1n } as never,
        reservationId: null,
        settlementId: null,
        createdAt: NOW,
      }),
    ).toThrow(TypeError);
  });

  it('rejects a payable with a non-EC or non-positive amount', () => {
    expect(() =>
      PayableAggregate.issue({
        payableId: 'payable-neg',
        sellerTenant: 'tenant-neg',
        amount: uc(300) as never,
        period: '2026-11',
        availableAt: NOW,
        accruedAt: NOW,
        settlementId: null,
        chargeId: null,
        fencingToken: 'fence-neg',
      }),
    ).toThrow(TypeError);
    expect(() =>
      PayableAggregate.issue({
        payableId: 'payable-zero',
        sellerTenant: 'tenant-zero',
        amount: ec(0),
        period: '2026-11',
        availableAt: NOW,
        accruedAt: NOW,
        settlementId: null,
        chargeId: null,
        fencingToken: 'fence-zero',
      }),
    ).toThrow(TypeError);
  });

  it('rejects a reservation with a zero or wrong-denomination amount', () => {
    expect(() =>
      ReservationAggregate.issue({
        reservationId: 'res-zero',
        walletId: IDS.ecWallet,
        billingAccountId: IDS.sellerAccount,
        denomination: 'EC',
        reserved: ec(0),
        createdAt: NOW,
        fencingToken: 'fence-res',
      }),
    ).toThrow(TypeError);
    expect(() =>
      ReservationAggregate.issue({
        reservationId: 'res-denom',
        walletId: IDS.ecWallet,
        billingAccountId: IDS.sellerAccount,
        denomination: 'EC',
        reserved: uc(10),
        createdAt: NOW,
        fencingToken: 'fence-res',
      }),
    ).toThrow(TypeError);
  });

  it('rejects a lease whose expiry window is not positive', () => {
    expect(() =>
      LeaseAggregate.issue({
        leaseId: 'lease-window',
        escrowId: 'escrow-agg',
        amount: ec(60),
        epoch: 1,
        fencingToken: 'fence-lease',
        issuedAt: NOW,
        expiresAt: NOW,
      }),
    ).toThrow(TypeError);
  });

  it('rejects an escrow with a non-positive amount', () => {
    expect(() =>
      EscrowAggregate.issue({
        escrowId: 'escrow-zero',
        walletId: IDS.ecWallet,
        billingAccountId: IDS.sellerAccount,
        denomination: 'EC',
        amount: ec(0),
        createdAt: NOW,
        fencingToken: 'fence-escrow',
      }),
    ).toThrow(TypeError);
  });

  it('rejects a reconstituted reservation whose captured plus released misses reserved', () => {
    const reservation = ReservationAggregate.issue({
      reservationId: 'res-drift',
      walletId: IDS.ecWallet,
      billingAccountId: IDS.sellerAccount,
      denomination: 'EC',
      reserved: ec(100),
      createdAt: NOW,
      fencingToken: 'fence-res',
    });
    expect(reservation.capture(ec(60), { releaseRemainder: true })).toBeNull();
    const drifted = {
      ...reservation.snapshot(),
      captured: ec(50),
    } as unknown as Reservation;
    expect(() => ReservationAggregate.reconstitute(drifted)).toThrow(TypeError);
    // Snapshot đúng invariant vẫn nạp được.
    expect(() =>
      ReservationAggregate.reconstitute(reservation.snapshot() as Reservation),
    ).not.toThrow();
  });
});
