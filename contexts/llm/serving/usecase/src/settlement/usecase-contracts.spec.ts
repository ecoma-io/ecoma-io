/**
 * Contracts test của FinalizeAttemptCommand với fake ports: settle known usage
 * (charge + remainder release), capped charge (missing/malformed usage —
 * `financial_charge_capped` semantics), confirmed_not_executed release,
 * idempotent identities, evidence regression fail-closed.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Command } from '@ecoma-io/usecase-primitives';

import {
  FinalizeAttemptCommand,
  type FinalizeAttemptInput,
  type FinalizeAttemptUseCaseType,
  type FinalizeOutcome,
} from './finalize-attempt.js';
import type { ClassifiedUpstreamOutcome } from '../dispatch/dispatch.js';
import {
  FakeClock,
  FakeFinancialGateway,
  FakeJournal,
  FakeQuotaLedger,
  buildFundedBook,
} from '../testing/fake-ports.js';
import {
  capture,
  createWalletId,
  deriveWalletBalances,
  reserve,
} from '@ecoma-io/llm-financial-domain';

function classifiedOutcome(
  overrides: Partial<ClassifiedUpstreamOutcome> = {},
): ClassifiedUpstreamOutcome {
  return {
    evidence: 'confirmed_completed',
    completion: { content: 'hi', finishReason: 'stop', upstreamModel: 'm' },
    usage: {
      status: 'known',
      usage: {
        input_tokens: 3,
        output_tokens: 4,
        cached_tokens: 0,
        reasoning_tokens: 0,
        request_count: null,
      },
      rawUsage: { prompt_tokens: 3, completion_tokens: 4 },
    },
    retryAfterSeconds: null,
    ...overrides,
  };
}

function makeInput(overrides: Partial<FinalizeAttemptInput> = {}): FinalizeAttemptInput {
  return {
    requestId: 'req-1',
    tenantId: 'tenant-1',
    attemptId: 'attempt:req-1:1',
    quotaReservationId: 'quota:req-1',
    financialReservationId: 'finres:req-1:attempt:req-1:1',
    settlementId: 'settle:req-1:attempt:req-1:1',
    chargeId: 'charge:req-1:attempt:req-1:1',
    holdTokens: 50n,
    inputRatePerMillionMinor: 1_000_000n,
    outputRatePerMillionMinor: 1_000_000n,
    classified: classifiedOutcome(),
    upstreamRetryAfter: null,
    ...overrides,
  };
}

/** Dựng deps với book ĐÃ reserve `finres:...` amountMinor. */
function makeDeps(input: { reservedMinor?: bigint } = {}) {
  const quota = new FakeQuotaLedger();
  const journal = new FakeJournal();
  const clock = new FakeClock();
  const { book } = buildFundedBook({
    billingAccountId: 'billing-1',
    walletId: 'wallet:billing-1:UC',
    grantId: 'grant:1',
    amountMinor: 10_000n,
  });
  const reservationOutcome = reserve(book, {
    reservationId: 'finres:req-1:attempt:req-1:1',
    walletId: 'wallet:billing-1:UC',
    billingAccountId: 'billing-1',
    amount: { denomination: 'UC', minor: input.reservedMinor ?? 100n },
    createdAt: clock.current,
    fencingToken: 'fence:fake:v1',
  });
  if (!reservationOutcome.ok) {
    throw new Error(`reserve seed failed: ${reservationOutcome.error.code}`);
  }
  const financial = new FakeFinancialGateway(
    reservationOutcome.value.book,
    'wallet:billing-1:UC',
    'billing-1',
  );
  quota.reserve({
    reservationId: 'quota:req-1',
    requestId: 'req-1',
    tenantId: 'tenant-1',
    tokenAmount: 50n,
  });
  const command = new FinalizeAttemptCommand({ quota, financial, journal, clock });
  return { command, quota, journal, clock, financial };
}

describe('finalize attempt use case contracts', () => {
  it('finalizeAttemptUseCaseType implements Command with matching execute signature', () => {
    expectTypeOf<FinalizeAttemptUseCaseType>().toExtend<
      Command<FinalizeAttemptInput, FinalizeOutcome>
    >();
  });
});

describe('FinalizeAttemptCommand', () => {
  it('settles known usage charge and marks request completed', async () => {
    const { command, journal } = makeDeps({ reservedMinor: 100n });
    const outcome = await command.execute(makeInput());
    // usage 3 in + 4 out × 1_000_000/1M = 7 minor charge (≤ held 100).
    expect(outcome).toEqual({
      kind: 'completed',
      completion: { content: 'hi', finishReason: 'stop', upstreamModel: 'm' },
      chargeMinor: 7n,
    });
    expect(journal.finalizations).toHaveLength(1);
    expect(journal.finalizations[0]).toMatchObject({
      requestStatus: 'completed',
      finalEvidence: 'confirmed_completed',
      chargeMinor: 7n,
      inputTokens: 3n,
      outputTokens: 4n,
    });
  });

  it('caps the charge at held when usage is missing (financial_charge_capped semantics)', async () => {
    const { command } = makeDeps({ reservedMinor: 100n });
    const outcome = await command.execute(
      makeInput({ classified: classifiedOutcome({ usage: { status: 'missing' } }) }),
    );
    // Missing usage → charge = held (100), KHÔNG ngầm 0.
    expect(outcome).toMatchObject({ kind: 'completed', chargeMinor: 100n });
  });

  it('caps the charge at held when usage is malformed', async () => {
    const { command } = makeDeps({ reservedMinor: 100n });
    const outcome = await command.execute(
      makeInput({ classified: classifiedOutcome({ usage: { status: 'malformed' } }) }),
    );
    expect(outcome).toMatchObject({ kind: 'completed', chargeMinor: 100n });
  });

  it('caps the charge at held when real usage exceeds the hold', async () => {
    const { command } = makeDeps({ reservedMinor: 10n });
    const outcome = await command.execute(
      makeInput({
        classified: classifiedOutcome({
          usage: {
            status: 'known',
            usage: {
              input_tokens: 500,
              output_tokens: 500,
              cached_tokens: 0,
              reasoning_tokens: 0,
              request_count: null,
            },
            rawUsage: {},
          },
        }),
      }),
    );
    expect(outcome).toMatchObject({ kind: 'completed', chargeMinor: 10n });
  });

  it('releases everything on zero usage instead of posting an empty charge', async () => {
    const { command } = makeDeps({ reservedMinor: 100n });
    const outcome = await command.execute(
      makeInput({
        classified: classifiedOutcome({
          usage: {
            status: 'known',
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cached_tokens: 0,
              reasoning_tokens: 0,
              request_count: null,
            },
            rawUsage: {},
          },
        }),
      }),
    );
    expect(outcome).toMatchObject({ kind: 'completed', chargeMinor: 0n });
  });

  it('releases financial + quota on confirmed_not_executed and maps retry-after', async () => {
    const { command, quota, journal } = makeDeps({ reservedMinor: 100n });
    const outcome = await command.execute(
      makeInput({
        classified: classifiedOutcome({
          evidence: 'confirmed_not_executed',
          completion: null,
          usage: { status: 'missing' },
          retryAfterSeconds: 30,
        }),
        upstreamRetryAfter: 30,
      }),
    );
    expect(outcome).toEqual({
      kind: 'failed',
      code: 'rate_limit_exceeded',
      retryAfterSeconds: 30,
    });
    expect(quota.reservations.has('quota:req-1')).toBe(false);
    expect(journal.finalizations[0]).toMatchObject({
      requestStatus: 'failed',
      finalEvidence: 'confirmed_not_executed',
      chargeMinor: 0n,
      errorCode: 'rate_limit_exceeded',
    });
  });

  it('settles capped at held on may_have_executed (F5, never timeout-release)', async () => {
    const { command, journal } = makeDeps({ reservedMinor: 100n });
    const outcome = await command.execute(
      makeInput({
        classified: classifiedOutcome({
          evidence: 'may_have_executed',
          completion: null,
          usage: { status: 'missing' },
        }),
      }),
    );
    expect(outcome).toEqual({ kind: 'failed', code: 'upstream_error', retryAfterSeconds: null });
    expect(journal.finalizations[0]).toMatchObject({
      requestStatus: 'failed',
      finalEvidence: 'may_have_executed',
      chargeMinor: 100n,
      errorCode: 'upstream_error',
    });
  });

  it('is idempotent by settlement identity: a second run replays, not double-charges', async () => {
    const { command } = makeDeps({ reservedMinor: 100n });
    await command.execute(makeInput());
    const second = await command.execute(makeInput());
    // Settle idempotent theo settlementId — cùng chargeMinor, không lỗi.
    expect(second).toMatchObject({ kind: 'completed', chargeMinor: 7n });
  });

  it('fails closed on evidence regression (terminal attempt cannot go backwards)', async () => {
    const { command, journal } = makeDeps({ reservedMinor: 100n });
    journal.attemptEvidence.set('attempt:req-1:1', 'confirmed_completed');
    const outcome = await command.execute(
      makeInput({
        classified: classifiedOutcome({ evidence: 'may_have_executed', completion: null }),
      }),
    );
    // may_have_executed → confirmed_completed regression phải bị chặn.
    expect(outcome).toEqual({
      kind: 'failed',
      code: 'service_unavailable',
      retryAfterSeconds: null,
    });
    expect(journal.finalizations).toHaveLength(0);
  });

  it('fails closed with service_unavailable when the gateway throws', async () => {
    const { command, financial } = makeDeps({ reservedMinor: 100n });
    financial.failBilling = true;
    const outcome = await command.execute(makeInput());
    expect(outcome).toEqual({
      kind: 'failed',
      code: 'service_unavailable',
      retryAfterSeconds: null,
    });
  });

  it('double-settles without a second charge: replay returns the original charge row', async () => {
    const { command, financial, journal } = makeDeps({ reservedMinor: 100n });
    await command.execute(makeInput());
    await command.execute(makeInput());
    // Charge idempotent theo settlementId — đúng MỘT charge row, tổng charged
    // đúng 7 (không double-charge dù settle hai lần).
    expect(financial.state.book.charges).toHaveLength(1);
    expect(financial.state.book.charges[0].amount.minor).toBe(7n);
    const balances = deriveWalletBalances(
      financial.state.book.ledger,
      createWalletId('wallet:billing-1:UC'),
      'UC',
    );
    if (!balances.ok) {
      throw new Error('balances derive failed');
    }
    expect(balances.value.charged.minor).toBe(7n);
    // Finalization replay cập nhật cùng attempt (upsert) — evidence không lùi.
    expect(journal.finalizations).toHaveLength(2);
    expect(journal.finalizations[1].finalEvidence).toBe('confirmed_completed');
  });

  it('rejects settling with a different payload on the same settlement id (idempotency conflict)', async () => {
    // Charge thật khác replay payload → domain từ chối, usecase fail-closed
    // service_unavailable thay vì đổi số tiền im lặng.
    const { command } = makeDeps({ reservedMinor: 100n });
    await command.execute(makeInput());
    const second = await command.execute(
      makeInput({
        inputRatePerMillionMinor: 9_999n, // cùng settlementId, amount khác
      }),
    );
    expect(second).toEqual({
      kind: 'failed',
      code: 'service_unavailable',
      retryAfterSeconds: null,
    });
  });

  it('fails closed when the financial reservation is missing from the loaded book', async () => {
    // Book KHÔNG có reservation finres:... → không thể settle — fail-closed.
    const quota = new FakeQuotaLedger();
    const journal = new FakeJournal();
    const clock = new FakeClock();
    const { book } = buildFundedBook({
      billingAccountId: 'billing-1',
      walletId: 'wallet:billing-1:UC',
      grantId: 'grant:1',
      amountMinor: 10_000n,
    });
    const financial = new FakeFinancialGateway(book, 'wallet:billing-1:UC', 'billing-1');
    const command = new FinalizeAttemptCommand({ quota, financial, journal, clock });
    const outcome = await command.execute(makeInput());
    expect(outcome).toEqual({
      kind: 'failed',
      code: 'service_unavailable',
      retryAfterSeconds: null,
    });
  });

  it('fails closed when a second settlement id targets an already-finalized reservation', async () => {
    // settle sai attemptId (settlement id khác trên cùng reservation đã
    // captured) → reservation_already_finalized → usecase fail-closed, không âm sổ.
    const { command } = makeDeps({ reservedMinor: 100n });
    await command.execute(makeInput());
    const second = await command.execute(
      makeInput({
        settlementId: 'settle:req-1:attempt:req-1:2',
        chargeId: 'charge:req-1:attempt:req-1:2',
      }),
    );
    expect(second).toEqual({
      kind: 'failed',
      code: 'service_unavailable',
      retryAfterSeconds: null,
    });
  });

  it('releases the full hold as one zero-charge release when usage is known zero (release path, not charge path)', async () => {
    const { command, financial } = makeDeps({ reservedMinor: 100n });
    const outcome = await command.execute(
      makeInput({
        classified: classifiedOutcome({
          usage: {
            status: 'known',
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cached_tokens: 0,
              reasoning_tokens: 0,
              request_count: null,
            },
            rawUsage: {},
          },
        }),
      }),
    );
    expect(outcome).toMatchObject({ kind: 'completed', chargeMinor: 0n });
    // Không có charge row; reservation released; available hoàn về đủ 10_000.
    expect(financial.state.book.charges).toHaveLength(0);
    const reservation = financial.state.book.reservations.find(
      (candidate) => candidate.reservation_id === 'finres:req-1:attempt:req-1:1',
    );
    expect(reservation?.state).toBe('released');
    const balances = deriveWalletBalances(
      financial.state.book.ledger,
      createWalletId('wallet:billing-1:UC'),
      'UC',
    );
    if (!balances.ok) {
      throw new Error('balances derive failed');
    }
    expect(balances.value.available.minor).toBe(10_000n);
  });

  it('fails closed when the zero-charge release hits an already-finalized reservation', async () => {
    // Usage 0 → release path; reservation đã captured trước đó → release bị
    // từ chối → fail-closed thay vì nuốt.
    const { command, financial } = makeDeps({ reservedMinor: 100n });
    const captured = capture(financial.state.book, {
      reservationId: 'finres:req-1:attempt:req-1:1',
      amount: { denomination: 'UC', minor: 5n },
      releaseRemainder: true,
      capturedAt: 1,
      fencingToken: 'fence:fake:v1',
    });
    if (!captured.ok) {
      throw new Error(`seed capture failed: ${captured.error.code}`);
    }
    financial.state = { ...financial.state, book: captured.value.book };
    const outcome = await command.execute(
      makeInput({
        classified: classifiedOutcome({
          usage: {
            status: 'known',
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cached_tokens: 0,
              reasoning_tokens: 0,
              request_count: null,
            },
            rawUsage: {},
          },
        }),
      }),
    );
    expect(outcome).toEqual({
      kind: 'failed',
      code: 'service_unavailable',
      retryAfterSeconds: null,
    });
  });

  it('does not release quota before financial admission existed (settle-before-reserve fails closed)', async () => {
    // Chưa reserve gì cả: quota reservation không tồn tại — settle quota là
    // no-op idempotent, nhưng financial fail-closed trước đó nên không có lỗ.
    const quota = new FakeQuotaLedger();
    const journal = new FakeJournal();
    const clock = new FakeClock();
    const { book } = buildFundedBook({
      billingAccountId: 'billing-1',
      walletId: 'wallet:billing-1:UC',
      grantId: 'grant:1',
      amountMinor: 10_000n,
    });
    const financial = new FakeFinancialGateway(book, 'wallet:billing-1:UC', 'billing-1');
    const command = new FinalizeAttemptCommand({ quota, financial, journal, clock });
    const outcome = await command.execute(
      makeInput({
        classified: classifiedOutcome({ evidence: 'confirmed_not_executed', completion: null }),
      }),
    );
    // Release reservation không tồn tại → domain từ chối (not found) → fail-closed.
    expect(outcome).toEqual({
      kind: 'failed',
      code: 'service_unavailable',
      retryAfterSeconds: null,
    });
    expect(journal.finalizations).toHaveLength(0);
  });

  it('releases the OTHER reservation identity independently: releasing quota id does not touch financial id', async () => {
    // Hai định danh độc lập: release theo financialReservationId không ảnh hưởng
    // reservation quota cùng request — sự cố một phía không xoá phía kia.
    const { command, quota, financial } = makeDeps({ reservedMinor: 100n });
    const outcome = await command.execute(
      makeInput({
        classified: classifiedOutcome({
          evidence: 'confirmed_not_executed',
          completion: null,
          usage: { status: 'missing' },
        }),
      }),
    );
    expect(outcome).toMatchObject({ kind: 'failed' });
    expect(quota.reservations.has('quota:req-1')).toBe(false);
    const reservation = financial.state.book.reservations.find(
      (candidate) => candidate.reservation_id === 'finres:req-1:attempt:req-1:1',
    );
    expect(reservation?.state).toBe('released');
  });

  it('propagates quota settle port throw as service_unavailable instead of completing silently', async () => {
    const { command, quota } = makeDeps({ reservedMinor: 100n });
    quota.settle = async () => {
      throw new Error('quota settle failed');
    };
    const outcome = await command.execute(makeInput());
    expect(outcome).toEqual({
      kind: 'failed',
      code: 'service_unavailable',
      retryAfterSeconds: null,
    });
  });
});
