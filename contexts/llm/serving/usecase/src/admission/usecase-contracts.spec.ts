/**
 * Contracts test của AdmitRequestCommand với fake ports: happy path, replay
 * conflict, insufficient quota, insufficient funds, service unavailable.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Command } from '@ecoma-io/usecase-primitives';

import {
  AdmitRequestCommand,
  type AdmitOutcome,
  type AdmitRequestInput,
  type AdmitRequestUseCaseType,
} from './admit-request.js';
import {
  FakeClock,
  FakeFinancialGateway,
  FakeJournal,
  FakeQuotaLedger,
  buildFundedBook,
  ucMoney,
} from '../testing/fake-ports.js';
import { reserve } from '@ecoma-io/llm-financial-domain';

function makeInput(overrides: Partial<AdmitRequestInput> = {}): AdmitRequestInput {
  return {
    requestId: 'req-1',
    tenantId: 'tenant-1',
    apiKeyId: 'key-1',
    payloadHash: 'hash-1',
    requestedModel: 'model-a',
    offerId: 'offer-1',
    sellerTenantId: 'seller-1',
    pricingSnapshotId: 'snap-1',
    upstreamEndpointUrl: 'https://upstream.example',
    holdAmount: ucMoney(100n),
    holdTokens: 50n,
    inputRatePerMillionMinor: 1_000_000n,
    outputRatePerMillionMinor: 1_000_000n,
    attemptNo: 1,
    ...overrides,
  };
}

function makeDeps(input: { fundedMinor?: bigint } = {}) {
  const quota = new FakeQuotaLedger();
  const journal = new FakeJournal();
  const clock = new FakeClock();
  const { book } = buildFundedBook({
    billingAccountId: 'billing-1',
    walletId: 'wallet:billing-1:UC',
    grantId: 'grant:1',
    amountMinor: input.fundedMinor ?? 10_000n,
  });
  const financial = new FakeFinancialGateway(book, 'wallet:billing-1:UC', 'billing-1');
  const command = new AdmitRequestCommand({ quota, financial, journal, clock });
  return { command, quota, journal, clock, financial };
}

describe('admit request use case contracts', () => {
  it('admitRequestUseCaseType implements Command with matching execute signature', () => {
    expectTypeOf<AdmitRequestUseCaseType>().toExtend<Command<AdmitRequestInput, AdmitOutcome>>();
  });
});

describe('AdmitRequestCommand', () => {
  it('admits with deterministic ids and records journal before dispatch', async () => {
    const { command, journal } = makeDeps();
    const outcome = await command.execute(makeInput());
    expect(outcome).toMatchObject({
      kind: 'admitted',
      attemptId: 'attempt:req-1:1',
      quotaReservationId: 'quota:req-1',
      financialReservationId: 'finres:req-1:attempt:req-1:1',
      settlementId: 'settle:req-1:attempt:req-1:1',
      chargeId: 'charge:req-1:attempt:req-1:1',
      reservedMinor: 100n,
      holdTokens: 50n,
    });
    expect(journal.admissions).toHaveLength(1);
  });

  it('rejects replay with same payload hash (request_id_replay)', async () => {
    const { command, journal } = makeDeps();
    journal.payloadHashes.set('tenant-1:req-1', 'hash-1');
    const outcome = await command.execute(makeInput());
    expect(outcome).toEqual({ kind: 'rejected', code: 'request_id_replay' });
    expect(journal.admissions).toHaveLength(0);
  });

  it('rejects idempotency conflict with different payload hash', async () => {
    const journal = new FakeJournal();
    journal.payloadHashes.set('tenant-1:req-1', 'other-hash');
    const outcome = await new AdmitRequestCommand({
      quota: new FakeQuotaLedger(),
      financial: new FakeFinancialGateway(
        buildFundedBook({
          billingAccountId: 'billing-1',
          walletId: 'wallet:billing-1:UC',
          grantId: 'grant:1',
          amountMinor: 10_000n,
        }).book,
        'wallet:billing-1:UC',
        'billing-1',
      ),
      journal,
      clock: new FakeClock(),
    }).execute(makeInput());
    expect(outcome).toEqual({ kind: 'rejected', code: 'idempotency_conflict' });
  });

  it('rejects insufficient quota when committed tokens exceed the ceiling', async () => {
    const { command, quota, journal } = makeDeps();
    quota.settledTokens = 999_960n; // ceiling 1_000_000 − hold 50 → thiếu
    const outcome = await command.execute(makeInput());
    expect(outcome).toEqual({ kind: 'rejected', code: 'insufficient_quota' });
    expect(journal.admissions).toHaveLength(0);
  });

  it('rejects insufficient funds, releasing the quota reservation as compensation', async () => {
    const { command, quota } = makeDeps({ fundedMinor: 10n }); // hold 100 > available 10
    const outcome = await command.execute(makeInput());
    expect(outcome).toEqual({ kind: 'rejected', code: 'insufficient_funds' });
    // Compensation: quota reservation đã release (không còn held).
    expect(quota.reservations.has('quota:req-1')).toBe(false);
  });

  it('maps a financial idempotency conflict to request_id_replay (same reservation id, other payload)', async () => {
    // Reservation finres id đã tồn tại với payload khác (attempt retry cùng
    // request nhưng amount đổi) → domain idempotency_conflict → usecase phải
    // map về request_id_replay, không phải service_unavailable.
    const { command, financial, journal, clock } = makeDeps();
    const seeded = reserve(financial.state.book, {
      reservationId: 'finres:req-1:attempt:req-1:1',
      walletId: 'wallet:billing-1:UC',
      billingAccountId: 'billing-1',
      amount: ucMoney(999n), // khác holdAmount 100
      createdAt: clock.current,
      fencingToken: 'fence:fake:v1',
    });
    if (!seeded.ok) {
      throw new Error(`seed reserve failed: ${seeded.error.code}`);
    }
    financial.state = { ...financial.state, book: seeded.value.book };
    const outcome = await command.execute(makeInput());
    expect(outcome).toEqual({ kind: 'rejected', code: 'request_id_replay' });
    expect(journal.admissions).toHaveLength(0);
  });

  it('fails closed with service_unavailable when the gateway throws', async () => {
    const { command, financial } = makeDeps();
    financial.failBilling = true;
    const outcome = await command.execute(makeInput());
    expect(outcome).toEqual({ kind: 'rejected', code: 'service_unavailable' });
  });

  it('rejects when journal recordAdmission reports a concurrent replay (idempotency row race)', async () => {
    const { command, journal } = makeDeps();
    journal.conflictOnRecord = true;
    const outcome = await command.execute(makeInput());
    expect(outcome).toEqual({ kind: 'rejected', code: 'request_id_replay' });
  });

  it('rejects with service_unavailable on stale fencing token (fail-closed, not client error)', async () => {
    const { command, financial } = makeDeps();
    // Token fencing mà gateway cấp khác wallet trong book → reserve bị chặn.
    financial.state = { ...financial.state, walletFencingToken: 'fence:stale:v99' };
    const outcome = await command.execute(makeInput());
    expect(outcome).toEqual({ kind: 'rejected', code: 'service_unavailable' });
  });

  it('fails closed with service_unavailable when quota read throws (never silently admit)', async () => {
    const { command, quota } = makeDeps();
    quota.failRead = true;
    // Port ném ra — usecase không được nuốt lỗi âm thầm thành một outcome lạ.
    await expect(command.execute(makeInput())).rejects.toThrow('quota read failed');
  });

  it('does not hold quota tokens when financial admission is rejected for insufficient funds', async () => {
    const { command, quota } = makeDeps({ fundedMinor: 10n });
    await command.execute(makeInput());
    // Compensation phải trả heldActiveTokens về 0 — không để giữ rò rỉ.
    expect(quota.heldActiveTokens).toBe(0n);
  });

  it('derives the same ids across replays of the same input (deterministic identity)', async () => {
    const { command, journal } = makeDeps();
    const first = await command.execute(makeInput());
    if (first.kind !== 'admitted') {
      throw new Error('expected admitted');
    }
    const ids = {
      attemptId: first.attemptId,
      quotaReservationId: first.quotaReservationId,
      financialReservationId: first.financialReservationId,
    };
    // Row journal giờ tồn tại với cùng hash → replay path trả đúng code.
    const second = await command.execute(makeInput());
    expect(second).toEqual({ kind: 'rejected', code: 'request_id_replay' });
    expect(journal.admissions).toHaveLength(1);
    expect(ids).toEqual({
      attemptId: 'attempt:req-1:1',
      quotaReservationId: 'quota:req-1',
      financialReservationId: 'finres:req-1:attempt:req-1:1',
    });
  });

  it('releases the quota hold when the gateway throws mid-admission (no held-token leak)', async () => {
    // Sự cố một phía (gateway throw sau khi quota đã reserve) không được để
    // reservation quota treo vĩnh viễn — compensation phải chạy cả khi financial
    // path ném exception, không chỉ khi reserve từ chối (invariant 1).
    const { command, quota, financial } = makeDeps();
    financial.failBilling = true;
    const outcome = await command.execute(makeInput());
    expect(outcome).toEqual({ kind: 'rejected', code: 'service_unavailable' });
    expect(quota.reservations.has('quota:req-1')).toBe(false);
    expect(quota.heldActiveTokens).toBe(0n);
  });
});
