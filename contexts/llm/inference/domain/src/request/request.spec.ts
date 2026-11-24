/**
 * Ghim vòng đời logical request: chuyển trạng thái, retry admissibility,
 * streaming/delivery facts, reconciliation của outcome bất định và các cửa sổ
 * crash. Mọi test đều kiểm hành vi nghiệp vụ, không kiểm chi tiết cài đặt.
 */

import { describe, expect, it } from 'vitest';

import { classifyAttemptOutcome, isAttemptOpen, type ProviderAttempt } from '../attempt/attempt';
import type { InferenceDomainErrorCode } from '../shared/errors';
import { LogicalRequest, isLogicalRequestSnapshot } from './request';

const ADMITTED_AT = 1_700_000_000_000;
const DEADLINE = ADMITTED_AT + 60_000;

function request(overrides: { maxAttempts?: number; deadlineAt?: number } = {}): LogicalRequest {
  const result = LogicalRequest.create({
    requestId: 'req_1',
    admittedAt: ADMITTED_AT,
    policy: {
      maxAttempts: overrides.maxAttempts ?? 3,
      deadlineAt: overrides.deadlineAt ?? DEADLINE,
    },
  });
  if (!result.ok) {
    throw new Error('fixture is invalid');
  }
  return result.value;
}

function unwrap<T>(result: { ok: boolean; value?: T; error?: { code: string } }): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error?.code}`);
  }
  return result.value as T;
}

function errorOf(result: {
  ok: boolean;
  error?: { code: InferenceDomainErrorCode };
}): InferenceDomainErrorCode | null {
  return result.ok ? null : (result.error?.code ?? null);
}

function withAttempt(
  options: {
    attemptId?: string;
    recordedAt?: number;
    candidateRef?: string;
    endpointRef?: string | null;
    maxAttempts?: number;
    deadlineAt?: number;
  } = {},
): LogicalRequest {
  const target = request({ maxAttempts: options.maxAttempts, deadlineAt: options.deadlineAt });
  const result = target.recordDispatchIntent({
    attemptId: options.attemptId ?? 'att_1',
    candidateRef: options.candidateRef ?? 'cand_a',
    endpointRef: options.endpointRef ?? null,
    recordedAt: options.recordedAt ?? ADMITTED_AT + 1,
  });
  if (!result.ok) {
    throw new Error(`fixture is invalid: ${result.error.code}`);
  }
  return target;
}

/** Request với attempt 1 đã đóng bằng `evidence` cho trước. */
function withClosedAttempt(
  evidence: 'not_sent' | 'may_have_executed' | 'confirmed_completed' | 'confirmed_not_executed',
  options: { maxAttempts?: number; deadlineAt?: number; endedAt?: number } = {},
): LogicalRequest {
  const target = withAttempt({
    maxAttempts: options.maxAttempts,
    deadlineAt: options.deadlineAt,
  });
  const closed = target.closeAttempt({
    attemptId: 'att_1',
    evidence,
    endedAt: options.endedAt ?? ADMITTED_AT + 2,
  });
  if (!closed.ok) {
    throw new Error(`fixture is invalid: ${closed.error.code}`);
  }
  return target;
}

describe('LogicalRequest.create', () => {
  it('creates an open request with no attempts and no delivery', () => {
    const created = request();
    expect(created.status()).toBe('open');
    expect(created.attempts()).toEqual([]);
    expect(created.completion()).toBeNull();
    expect(created.delivery()).toEqual({
      state: 'not_committed',
      committedAt: null,
      disconnectedAt: null,
    });
    expect(isLogicalRequestSnapshot(created.snapshot())).toBe(true);
  });

  it('rejects an invalid request id or admission timestamp', () => {
    const base = {
      requestId: 'req_1',
      admittedAt: ADMITTED_AT,
      policy: { maxAttempts: 2, deadlineAt: DEADLINE },
    };
    expect(errorOf(LogicalRequest.create({ ...base, requestId: '  ' }))).toBe('invalid_request_id');
    expect(errorOf(LogicalRequest.create({ ...base, requestId: 42 }))).toBe('invalid_request_id');
    expect(errorOf(LogicalRequest.create({ ...base, admittedAt: 1.5 }))).toBe('invalid_timestamp');
    expect(errorOf(LogicalRequest.create({ ...base, admittedAt: null }))).toBe('invalid_timestamp');
  });

  it('rejects an invalid attempt policy', () => {
    const base = { requestId: 'req_1', admittedAt: ADMITTED_AT };
    for (const maxAttempts of [0, -1, 1.5, Infinity, NaN, undefined]) {
      expect(
        errorOf(
          LogicalRequest.create({
            ...base,
            policy: { maxAttempts, deadlineAt: DEADLINE },
          }),
        ),
      ).toBe('invalid_attempt_limit');
    }
    expect(
      errorOf(LogicalRequest.create({ ...base, policy: { maxAttempts: 2, deadlineAt: null } })),
    ).toBe('invalid_attempt_limit');
  });

  it('rejects a deadline that is not after admission', () => {
    for (const deadlineAt of [ADMITTED_AT, ADMITTED_AT - 1]) {
      expect(
        errorOf(
          LogicalRequest.create({
            requestId: 'req_1',
            admittedAt: ADMITTED_AT,
            policy: { maxAttempts: 2, deadlineAt },
          }),
        ),
      ).toBe('invalid_deadline');
    }
  });

  it('does not mutate or leak the caller policy object', () => {
    const policy = { maxAttempts: 3, deadlineAt: DEADLINE };
    const created = LogicalRequest.create({ requestId: 'req_1', admittedAt: ADMITTED_AT, policy });
    expect(policy).toEqual({ maxAttempts: 3, deadlineAt: DEADLINE });
    expect(created.ok).toBe(true);
  });
});

describe('dispatch intent and provider attempt lifecycle', () => {
  it('records an attempt as not_sent and in progress', () => {
    const dispatched = withAttempt();
    expect(dispatched.attempts()).toHaveLength(1);
    const attempt = dispatched.attempts()[0];
    expect(attempt.sequence).toBe(1);
    expect(attempt.evidence).toBe('not_sent');
    expect(isAttemptOpen(attempt)).toBe(true);
    expect(classifyAttemptOutcome(attempt)).toBe('not_executed');
  });

  it('assigns increasing sequence numbers', () => {
    const first = withClosedAttempt('confirmed_not_executed');
    const second = first.recordDispatchIntent({
      attemptId: 'att_2',
      candidateRef: 'cand_b',
      endpointRef: 'ep_2',
      recordedAt: ADMITTED_AT + 3,
    });
    expect(second.ok).toBe(true);
    expect(first.attempts().map((attempt) => attempt.sequence)).toEqual([1, 2]);
  });

  it('treats a repeated dispatch intent with identical facts as idempotent', () => {
    const dispatched = withAttempt();
    const replay = dispatched.recordDispatchIntent({
      attemptId: 'att_1',
      candidateRef: 'cand_a',
      endpointRef: null,
      recordedAt: ADMITTED_AT + 1,
    });
    expect(replay.ok).toBe(true);
    expect(dispatched.attempts()).toHaveLength(1);
  });

  it('rejects a reused attempt id with different facts', () => {
    const dispatched = withAttempt();
    expect(
      errorOf(
        dispatched.recordDispatchIntent({
          attemptId: 'att_1',
          candidateRef: 'cand_other',
          endpointRef: null,
          recordedAt: ADMITTED_AT + 1,
        }),
      ),
    ).toBe('duplicate_attempt_id');
  });

  it('rejects an attempt while another is still open', () => {
    const dispatched = withAttempt();
    expect(
      errorOf(
        dispatched.recordDispatchIntent({
          attemptId: 'att_2',
          candidateRef: 'cand_b',
          endpointRef: null,
          recordedAt: ADMITTED_AT + 2,
        }),
      ),
    ).toBe('attempt_in_flight');
  });

  it('rejects malformed dispatch input', () => {
    const fresh = request();
    expect(
      errorOf(
        fresh.recordDispatchIntent({
          attemptId: '',
          candidateRef: 'cand_a',
          endpointRef: null,
          recordedAt: ADMITTED_AT + 1,
        }),
      ),
    ).toBe('invalid_attempt_id');
    expect(
      errorOf(
        fresh.recordDispatchIntent({
          attemptId: 'att_1',
          candidateRef: '',
          endpointRef: null,
          recordedAt: ADMITTED_AT + 1,
        }),
      ),
    ).toBe('invalid_candidate_ref');
    expect(
      errorOf(
        fresh.recordDispatchIntent({
          attemptId: 'att_1',
          candidateRef: 'cand_a',
          endpointRef: ' ',
          recordedAt: ADMITTED_AT + 1,
        }),
      ),
    ).toBe('invalid_candidate_ref');
    expect(
      errorOf(
        fresh.recordDispatchIntent({
          attemptId: 'att_1',
          candidateRef: 'cand_a',
          endpointRef: null,
          recordedAt: 'now',
        }),
      ),
    ).toBe('invalid_timestamp');
  });

  it('rejects a dispatch intent recorded before admission', () => {
    expect(
      errorOf(
        request().recordDispatchIntent({
          attemptId: 'att_1',
          candidateRef: 'cand_a',
          endpointRef: null,
          recordedAt: ADMITTED_AT - 1,
        }),
      ),
    ).toBe('timestamp_regression');
  });

  it('closes an attempt exactly once and keeps the recorded facts', () => {
    const closed = withClosedAttempt('confirmed_completed');
    const attempt = closed.attempts()[0];
    expect(isAttemptOpen(attempt)).toBe(false);
    expect(attempt.endedAt).toBe(ADMITTED_AT + 2);
    expect(classifyAttemptOutcome(attempt)).toBe('succeeded');
  });

  it('treats a repeated identical close as idempotent and rejects a conflicting one', () => {
    const closed = withClosedAttempt('confirmed_not_executed');
    const replay = closed.closeAttempt({
      attemptId: 'att_1',
      evidence: 'confirmed_not_executed',
      endedAt: ADMITTED_AT + 2,
    });
    expect(replay.ok).toBe(true);

    expect(
      errorOf(
        closed.closeAttempt({
          attemptId: 'att_1',
          evidence: 'confirmed_completed',
          endedAt: ADMITTED_AT + 3,
        }),
      ),
    ).toBe('attempt_not_in_flight');
  });

  it('reports attempt_not_found for an attempt of another request', () => {
    const closed = withClosedAttempt('confirmed_not_executed');
    expect(
      errorOf(
        closed.closeAttempt({
          attemptId: 'att_other',
          evidence: 'not_sent',
          endedAt: ADMITTED_AT + 2,
        }),
      ),
    ).toBe('attempt_not_found');
    expect(closed.findAttempt('att_other')).toBeNull();
  });

  it('rejects invalid close input', () => {
    const dispatched = withAttempt();
    expect(
      errorOf(
        dispatched.closeAttempt({ attemptId: 'att_1', evidence: 'x', endedAt: ADMITTED_AT + 2 }),
      ),
    ).toBe('invalid_evidence');
    expect(
      errorOf(dispatched.closeAttempt({ attemptId: 'att_1', evidence: 'not_sent', endedAt: null })),
    ).toBe('invalid_timestamp');
  });
});

describe('execution evidence recorded on an attempt', () => {
  it('strengthens evidence from not_sent to may_have_executed', () => {
    const dispatched = withAttempt();
    const updated = dispatched.recordAttemptEvidence({
      attemptId: 'att_1',
      evidence: 'may_have_executed',
      recordedAt: ADMITTED_AT + 5,
    });
    expect(updated.ok).toBe(true);
    expect(dispatched.attempts()[0].evidence).toBe('may_have_executed');
    expect(dispatched.attempts()[0].evidenceRecordedAt).toBe(ADMITTED_AT + 5);
    expect(isAttemptOpen(dispatched.attempts()[0])).toBe(true);
  });

  it('rejects a downgrade of evidence', () => {
    const dispatched = withAttempt();
    unwrap(
      dispatched.recordAttemptEvidence({
        attemptId: 'att_1',
        evidence: 'may_have_executed',
        recordedAt: ADMITTED_AT + 5,
      }),
    );
    expect(
      errorOf(
        dispatched.recordAttemptEvidence({
          attemptId: 'att_1',
          evidence: 'not_sent',
          recordedAt: ADMITTED_AT + 6,
        }),
      ),
    ).toBe('invalid_evidence_transition');
  });

  it('treats an identical evidence record as idempotent', () => {
    const dispatched = withAttempt();
    const updated = dispatched.recordAttemptEvidence({
      attemptId: 'att_1',
      evidence: 'may_have_executed',
      recordedAt: ADMITTED_AT + 5,
    });
    expect(updated.ok).toBe(true);
    const replay = dispatched.recordAttemptEvidence({
      attemptId: 'att_1',
      evidence: 'may_have_executed',
      recordedAt: ADMITTED_AT + 5,
    });
    expect(replay.ok).toBe(true);
  });

  it('rejects an out-of-order evidence record', () => {
    const dispatched = withAttempt();
    unwrap(
      dispatched.recordAttemptEvidence({
        attemptId: 'att_1',
        evidence: 'may_have_executed',
        recordedAt: ADMITTED_AT + 5,
      }),
    );
    expect(
      errorOf(
        dispatched.recordAttemptEvidence({
          attemptId: 'att_1',
          evidence: 'confirmed_completed',
          recordedAt: ADMITTED_AT + 4,
        }),
      ),
    ).toBe('timestamp_regression');
  });

  it('rejects evidence for a closed attempt', () => {
    const closed = withClosedAttempt('confirmed_not_executed');
    expect(
      errorOf(
        closed.recordAttemptEvidence({
          attemptId: 'att_1',
          evidence: 'confirmed_completed',
          recordedAt: ADMITTED_AT + 9,
        }),
      ),
    ).toBe('attempt_not_in_flight');
  });

  it('validates evidence and timestamp values', () => {
    const dispatched = withAttempt();
    expect(
      errorOf(
        dispatched.recordAttemptEvidence({ attemptId: 'att_1', evidence: 'done', recordedAt: 1 }),
      ),
    ).toBe('invalid_evidence');
    expect(
      errorOf(
        dispatched.recordAttemptEvidence({
          attemptId: 'att_1',
          evidence: 'confirmed_completed',
          recordedAt: 'now',
        }),
      ),
    ).toBe('invalid_timestamp');
  });

  it('keeps an uncertain outcome distinguishable from a confirmed failure', () => {
    const uncertain = withClosedAttempt('may_have_executed');
    const notExecuted = withClosedAttempt('confirmed_not_executed');
    expect(classifyAttemptOutcome(uncertain.attempts()[0])).toBe('uncertain');
    expect(classifyAttemptOutcome(notExecuted.attempts()[0])).toBe('not_executed');
    expect(uncertain.hasUnresolvedUncertainty()).toBe(true);
    expect(notExecuted.hasUnresolvedUncertainty()).toBe(false);
  });

  it('treats an open uncertain attempt as in progress, not as failure', () => {
    const dispatched = withAttempt();
    const updated = dispatched.recordAttemptEvidence({
      attemptId: 'att_1',
      evidence: 'may_have_executed',
      recordedAt: ADMITTED_AT + 5,
    });
    expect(updated.ok).toBe(true);
    expect(classifyAttemptOutcome(dispatched.attempts()[0])).toBe('in_progress');
  });
});

describe('retry admissibility', () => {
  it('admits the first attempt of an open request', () => {
    const decision = request().evaluateRetryAdmissibility({ now: ADMITTED_AT });
    expect(decision.ok && decision.value).toEqual({ admissible: true, nextSequence: 1 });
  });

  it('admits another attempt after a confirmed not-executed attempt', () => {
    const closed = withClosedAttempt('confirmed_not_executed');
    const next = closed.recordDispatchIntent({
      attemptId: 'att_2',
      candidateRef: 'cand_b',
      endpointRef: null,
      recordedAt: ADMITTED_AT + 3,
    });
    expect(next.ok).toBe(true);
    expect(closed.attempts()).toHaveLength(2);
  });

  it('admits another attempt after a not_sent attempt', () => {
    const closed = withClosedAttempt('not_sent');
    const decision = closed.evaluateRetryAdmissibility({ now: ADMITTED_AT + 3 });
    expect(decision.ok && decision.value.admissible).toBe(true);
  });

  it('rejects a blind retry after may_have_executed', () => {
    const uncertain = withClosedAttempt('may_have_executed');
    const decision = uncertain.evaluateRetryAdmissibility({ now: ADMITTED_AT + 3 });
    expect(decision.ok && decision.value).toEqual({
      admissible: false,
      reason: 'previous_attempt_uncertain',
    });
    expect(
      errorOf(
        uncertain.recordDispatchIntent({
          attemptId: 'att_2',
          candidateRef: 'cand_b',
          endpointRef: null,
          recordedAt: ADMITTED_AT + 3,
        }),
      ),
    ).toBe('previous_attempt_uncertain');
  });

  it('rejects a retry after a confirmed completion', () => {
    const completed = withClosedAttempt('confirmed_completed');
    const decision = completed.evaluateRetryAdmissibility({ now: ADMITTED_AT + 3 });
    expect(decision.ok && decision.value).toEqual({
      admissible: false,
      reason: 'previous_attempt_completed',
    });
  });

  it('rejects a retry after client-visible output was committed', () => {
    const notExecuted = withClosedAttempt('confirmed_not_executed');
    const committed = notExecuted.recordClientOutputCommitted({ committedAt: ADMITTED_AT + 3 });
    expect(committed.ok).toBe(true);
    const decision = notExecuted.evaluateRetryAdmissibility({ now: ADMITTED_AT + 4 });
    expect(decision.ok && decision.value).toEqual({
      admissible: false,
      reason: 'client_output_committed',
    });
    expect(
      errorOf(
        notExecuted.recordDispatchIntent({
          attemptId: 'att_2',
          candidateRef: 'cand_b',
          endpointRef: null,
          recordedAt: ADMITTED_AT + 4,
        }),
      ),
    ).toBe('client_output_committed');
  });

  it('rejects an attempt after a terminal request', () => {
    const failed = withClosedAttempt('confirmed_not_executed');
    unwrap(failed.failRequest({ failedAt: ADMITTED_AT + 5 }));
    expect(failed.isRequestTerminal()).toBe(true);
    const decision = failed.evaluateRetryAdmissibility({ now: ADMITTED_AT + 6 });
    expect(decision.ok && decision.value).toEqual({ admissible: false, reason: 'request_closed' });
    expect(
      errorOf(
        failed.recordDispatchIntent({
          attemptId: 'att_2',
          candidateRef: 'cand_b',
          endpointRef: null,
          recordedAt: ADMITTED_AT + 6,
        }),
      ),
    ).toBe('request_closed');
  });

  it('rejects an attempt while one is still open', () => {
    const decision = withAttempt().evaluateRetryAdmissibility({ now: ADMITTED_AT + 2 });
    expect(decision.ok && decision.value).toEqual({
      admissible: false,
      reason: 'attempt_in_flight',
    });
  });

  it('enforces the attempt budget', () => {
    const closed = withClosedAttempt('confirmed_not_executed', { maxAttempts: 1 });
    expect(closed.evaluateRetryAdmissibility({ now: ADMITTED_AT + 3 })).toMatchObject({
      ok: true,
      value: { admissible: false, reason: 'attempts_exhausted' },
    });
  });

  it('enforces the request deadline', () => {
    const closed = withClosedAttempt('confirmed_not_executed');
    expect(closed.evaluateRetryAdmissibility({ now: DEADLINE })).toMatchObject({
      ok: true,
      value: { admissible: false, reason: 'deadline_exhausted' },
    });
    expect(
      errorOf(
        closed.recordDispatchIntent({
          attemptId: 'att_2',
          candidateRef: 'cand_b',
          endpointRef: null,
          recordedAt: DEADLINE,
        }),
      ),
    ).toBe('deadline_exhausted');
  });

  it('rejects a retry while the request awaits reconciliation', () => {
    const reconciling = withClosedAttempt('may_have_executed');
    unwrap(reconciling.awaitReconciliation());
    expect(reconciling.evaluateRetryAdmissibility({ now: ADMITTED_AT + 5 })).toMatchObject({
      ok: true,
      value: { admissible: false, reason: 'requires_reconciliation' },
    });
  });

  it('rejects a non-timestamp decision time', () => {
    expect(errorOf(request().evaluateRetryAdmissibility({ now: 'later' }))).toBe(
      'invalid_timestamp',
    );
  });

  it('reports the next sequence when admissible', () => {
    const closed = withClosedAttempt('confirmed_not_executed');
    const decision = closed.evaluateRetryAdmissibility({ now: ADMITTED_AT + 3 });
    expect(decision.ok && decision.value).toEqual({ admissible: true, nextSequence: 2 });
  });
});

describe('client delivery and streaming facts', () => {
  it('records the first committed response byte once', () => {
    const committed = request();
    unwrap(committed.recordClientOutputCommitted({ committedAt: ADMITTED_AT + 1 }));
    expect(committed.delivery().state).toBe('committed');
    expect(committed.delivery().committedAt).toBe(ADMITTED_AT + 1);
    unwrap(committed.recordClientOutputCommitted({ committedAt: ADMITTED_AT + 9 }));
    expect(committed.delivery().committedAt).toBe(ADMITTED_AT + 1);
  });

  it('rejects output committed after the client already disconnected', () => {
    const disconnected = request();
    unwrap(disconnected.recordClientDisconnectEvent({ disconnectedAt: ADMITTED_AT + 1 }));
    expect(
      errorOf(disconnected.recordClientOutputCommitted({ committedAt: ADMITTED_AT + 2 })),
    ).toBe('invalid_delivery_transition');
  });

  it('does not treat a client disconnect as a provider cancellation', () => {
    const dispatched = withAttempt();
    const disconnected = dispatched.recordClientDisconnectEvent({
      disconnectedAt: ADMITTED_AT + 2,
    });
    expect(disconnected.ok).toBe(true);
    expect(dispatched.status()).toBe('open');
    expect(isAttemptOpen(dispatched.attempts()[0])).toBe(true);
    expect(dispatched.evaluateRetryAdmissibility({ now: ADMITTED_AT + 3 })).toMatchObject({
      ok: true,
      value: { admissible: false, reason: 'attempt_in_flight' },
    });
  });

  it('keeps the disconnect fact separate from execution outcome', () => {
    const uncertain = withClosedAttempt('may_have_executed');
    unwrap(uncertain.recordClientDisconnectEvent({ disconnectedAt: ADMITTED_AT + 3 }));
    expect(uncertain.hasUnresolvedUncertainty()).toBe(true);
    expect(uncertain.describeRequestProgress()).toMatchObject({
      status: 'open',
      clientDisconnected: true,
      clientOutputCommitted: false,
    });
  });

  it('treats a repeated disconnect as idempotent and rejects timestamp regression', () => {
    const disconnected = request();
    unwrap(disconnected.recordClientDisconnectEvent({ disconnectedAt: ADMITTED_AT + 2 }));
    const replay = disconnected.recordClientDisconnectEvent({ disconnectedAt: ADMITTED_AT + 2 });
    expect(replay.ok).toBe(true);
    expect(
      errorOf(disconnected.recordClientDisconnectEvent({ disconnectedAt: ADMITTED_AT + 1 })),
    ).toBe('timestamp_regression');
  });

  it('rejects an invalid delivery timestamp', () => {
    const fresh = request();
    expect(errorOf(fresh.recordClientOutputCommitted({ committedAt: null }))).toBe(
      'invalid_timestamp',
    );
    expect(errorOf(fresh.recordClientDisconnectEvent({ disconnectedAt: 'x' }))).toBe(
      'invalid_timestamp',
    );
  });
});

describe('reconciliation of an uncertain outcome', () => {
  it('requires uncertainty before entering reconciliation', () => {
    const noUncertainty = withClosedAttempt('confirmed_not_executed');
    expect(errorOf(noUncertainty.awaitReconciliation())).toBe('no_uncertainty_to_reconcile');
    expect(errorOf(withAttempt().awaitReconciliation())).toBe('attempt_in_flight');
  });

  it('rejects reconciliation of a terminal request', () => {
    const failed = withClosedAttempt('confirmed_not_executed');
    unwrap(failed.failRequest({ failedAt: ADMITTED_AT + 5 }));
    expect(errorOf(failed.awaitReconciliation())).toBe('request_closed');
  });

  it('reconciles may_have_executed into confirmed_not_executed and reopens the request', () => {
    const reconciling = withClosedAttempt('may_have_executed');
    unwrap(reconciling.awaitReconciliation());
    expect(reconciling.status()).toBe('reconciling');

    const reconciled = reconciling.reconcileUncertainAttempt({
      attemptId: 'att_1',
      evidence: 'confirmed_not_executed',
      recordedAt: ADMITTED_AT + 10,
    });
    expect(reconciled.ok).toBe(true);
    expect(reconciling.status()).toBe('open');
    expect(reconciling.attempts()[0].evidence).toBe('confirmed_not_executed');
    expect(reconciling.hasUnresolvedUncertainty()).toBe(false);
    expect(reconciling.evaluateRetryAdmissibility({ now: ADMITTED_AT + 11 })).toMatchObject({
      ok: true,
      value: { admissible: true },
    });
  });

  it('reconciles may_have_executed into confirmed_completed and completes the request', () => {
    const reconciling = withClosedAttempt('may_have_executed');
    unwrap(reconciling.awaitReconciliation());
    const completed = reconciling.reconcileUncertainAttempt({
      attemptId: 'att_1',
      evidence: 'confirmed_completed',
      recordedAt: ADMITTED_AT + 10,
    });
    expect(completed.ok).toBe(true);
    expect(reconciling.status()).toBe('completed');
    expect(reconciling.completion()).toEqual({
      status: 'completed',
      closedAt: ADMITTED_AT + 10,
      reason: null,
    });
    expect(reconciling.hasUnresolvedUncertainty()).toBe(false);
  });

  it('refuses a second-hand "not executed" conclusion without provider confirmation', () => {
    const reconciling = withClosedAttempt('may_have_executed');
    unwrap(reconciling.awaitReconciliation());
    for (const evidence of ['may_have_executed', 'not_sent']) {
      expect(
        errorOf(
          reconciling.reconcileUncertainAttempt({
            attemptId: 'att_1',
            evidence,
            recordedAt: ADMITTED_AT + 10,
          }),
        ),
      ).toBe('reconciliation_requires_confirmation');
    }
  });

  it('rejects reconciliation when the request is not reconciling', () => {
    const notReconciling = withClosedAttempt('may_have_executed');
    expect(
      errorOf(
        notReconciling.reconcileUncertainAttempt({
          attemptId: 'att_1',
          evidence: 'confirmed_not_executed',
          recordedAt: ADMITTED_AT + 10,
        }),
      ),
    ).toBe('reconciliation_not_pending');
  });

  it('rejects reconciliation of an attempt that does not belong to the request', () => {
    const reconciling = withClosedAttempt('may_have_executed');
    unwrap(reconciling.awaitReconciliation());
    expect(
      errorOf(
        reconciling.reconcileUncertainAttempt({
          attemptId: 'att_missing',
          evidence: 'confirmed_not_executed',
          recordedAt: ADMITTED_AT + 10,
        }),
      ),
    ).toBe('attempt_not_found');
  });

  it('treats a reconciling request with no uncertainty as an inconsistent state', () => {
    const inconsistent = {
      ...withClosedAttempt('confirmed_not_executed').snapshot(),
      status: 'reconciling',
    };
    expect(isLogicalRequestSnapshot(inconsistent)).toBe(false);
  });

  it('still refuses to reconcile an attempt that is not uncertain', () => {
    // Defence in depth: operation không được tin vào guard của caller. Dựng
    // request reconciling hợp lệ (attempt 2 bất định) rồi nhắm vào attempt 1
    // KHÔNG bất định — path `attempt_not_uncertain` phải vẫn chặn.
    const target = withClosedAttempt('confirmed_not_executed');
    unwrap(
      target.recordDispatchIntent({
        attemptId: 'att_2',
        candidateRef: 'cand_b',
        endpointRef: null,
        recordedAt: ADMITTED_AT + 3,
      }),
    );
    unwrap(
      target.closeAttempt({
        attemptId: 'att_2',
        evidence: 'may_have_executed',
        endedAt: ADMITTED_AT + 4,
      }),
    );
    unwrap(target.awaitReconciliation());
    expect(target.status()).toBe('reconciling');
    expect(
      errorOf(
        target.reconcileUncertainAttempt({
          attemptId: 'att_1',
          evidence: 'confirmed_completed',
          recordedAt: ADMITTED_AT + 10,
        }),
      ),
    ).toBe('attempt_not_uncertain');
  });

  it('keeps uncertainty visible until reconciliation actually happens', () => {
    const reconciling = withClosedAttempt('may_have_executed');
    unwrap(reconciling.awaitReconciliation());
    expect(reconciling.hasUnresolvedUncertainty()).toBe(true);
    expect(errorOf(reconciling.failRequest({ failedAt: ADMITTED_AT + 10 }))).toBe(
      'uncertain_execution_unresolved',
    );
    expect(
      errorOf(
        reconciling.cancelRequest({ cancelledAt: ADMITTED_AT + 10, reason: 'client_cancelled' }),
      ),
    ).toBe('uncertain_execution_unresolved');
  });
});

describe('logical request completion', () => {
  it('completes the request after a confirmed provider completion', () => {
    const completed = withClosedAttempt('confirmed_completed');
    unwrap(completed.completeRequest({ completedAt: ADMITTED_AT + 2 }));
    expect(completed.status()).toBe('completed');
    expect(completed.completion()).toEqual({
      status: 'completed',
      closedAt: ADMITTED_AT + 2,
      reason: null,
    });
    expect(completed.isRequestTerminal()).toBe(true);
  });

  it('refuses completion without a confirmed provider completion', () => {
    for (const evidence of ['not_sent', 'confirmed_not_executed'] as const) {
      const target = withClosedAttempt(evidence);
      expect(errorOf(target.completeRequest({ completedAt: ADMITTED_AT + 5 }))).toBe(
        'completion_requires_completed_attempt',
      );
    }
  });

  it('refuses completion while an attempt is still open', () => {
    expect(errorOf(withAttempt().completeRequest({ completedAt: ADMITTED_AT + 5 }))).toBe(
      'attempt_in_flight',
    );
  });

  it('fails the request when no attempt may have executed', () => {
    const failed = withClosedAttempt('confirmed_not_executed');
    unwrap(failed.failRequest({ failedAt: ADMITTED_AT + 5 }));
    expect(failed.status()).toBe('failed');
    expect(failed.completion()).toEqual({
      status: 'failed',
      closedAt: ADMITTED_AT + 5,
      reason: null,
    });
  });

  it('refuses to fail a request that may have executed', () => {
    const uncertain = withClosedAttempt('may_have_executed');
    expect(errorOf(uncertain.failRequest({ failedAt: ADMITTED_AT + 5 }))).toBe(
      'uncertain_execution_unresolved',
    );
  });

  it('cancels a request with a reason and refuses without one', () => {
    const cancelled = withClosedAttempt('confirmed_not_executed');
    unwrap(cancelled.cancelRequest({ cancelledAt: ADMITTED_AT + 5, reason: 'client_cancelled' }));
    expect(cancelled.status()).toBe('cancelled');
    expect(cancelled.completion()?.reason).toBe('client_cancelled');

    const invalidReason = withClosedAttempt('confirmed_not_executed');
    expect(
      errorOf(
        invalidReason.cancelRequest({
          cancelledAt: ADMITTED_AT + 5,
          reason: 'because',
        }),
      ),
    ).toBe('invalid_cancellation_reason');
  });

  it('refuses cancellation while an attempt is in flight', () => {
    expect(
      errorOf(
        withAttempt().cancelRequest({
          cancelledAt: ADMITTED_AT + 5,
          reason: 'client_cancelled',
        }),
      ),
    ).toBe('attempt_in_flight');
  });

  it('refuses a terminal transition on an already terminal request', () => {
    const failed = withClosedAttempt('confirmed_not_executed');
    unwrap(failed.failRequest({ failedAt: ADMITTED_AT + 5 }));
    const completed = withClosedAttempt('confirmed_completed');
    unwrap(completed.completeRequest({ completedAt: ADMITTED_AT + 2 }));
    expect(errorOf(completed.completeRequest({ completedAt: ADMITTED_AT + 6 }))).toBe(
      'request_closed',
    );
    expect(
      errorOf(failed.cancelRequest({ cancelledAt: ADMITTED_AT + 6, reason: 'client_cancelled' })),
    ).toBe('request_closed');
  });

  it('treats a repeated identical completion as idempotent', () => {
    const completed = withClosedAttempt('confirmed_completed');
    unwrap(completed.completeRequest({ completedAt: ADMITTED_AT + 2 }));
    const replay = completed.completeRequest({ completedAt: ADMITTED_AT + 2 });
    expect(replay.ok).toBe(true);
    expect(errorOf(completed.completeRequest({ completedAt: ADMITTED_AT + 3 }))).toBe(
      'request_closed',
    );
  });

  it('rejects a completion timestamp before admission', () => {
    const target = withClosedAttempt('confirmed_completed');
    expect(errorOf(target.completeRequest({ completedAt: ADMITTED_AT - 1 }))).toBe(
      'timestamp_regression',
    );
  });
});

describe('crash windows and duplicate or out-of-order commands', () => {
  it('does not allow a retry when a crash left an open dispatch intent', () => {
    const dispatched = withAttempt();
    expect(dispatched.evaluateRetryAdmissibility({ now: ADMITTED_AT + 2 })).toMatchObject({
      ok: true,
      value: { admissible: false, reason: 'attempt_in_flight' },
    });
    expect(errorOf(dispatched.completeRequest({ completedAt: ADMITTED_AT + 2 }))).toBe(
      'attempt_in_flight',
    );
  });

  it('allows a duplicate dispatch intent replay after a crash to be a no-op', () => {
    const dispatched = withAttempt();
    const replay = dispatched.recordDispatchIntent({
      attemptId: 'att_1',
      candidateRef: 'cand_a',
      endpointRef: null,
      recordedAt: ADMITTED_AT + 1,
    });
    expect(replay.ok).toBe(true);
    expect(dispatched.attempts()).toHaveLength(1);
  });

  it('rejects a duplicate attempt id even when the request is terminal', () => {
    const failed = withClosedAttempt('confirmed_not_executed');
    unwrap(failed.failRequest({ failedAt: ADMITTED_AT + 5 }));
    expect(
      errorOf(
        failed.recordDispatchIntent({
          attemptId: 'att_1',
          candidateRef: 'cand_other',
          endpointRef: null,
          recordedAt: ADMITTED_AT + 6,
        }),
      ),
    ).toBe('duplicate_attempt_id');
  });

  it('is deterministic for identical inputs', () => {
    const first = withClosedAttempt('may_have_executed');
    const second = withClosedAttempt('may_have_executed');
    expect(first.snapshot()).toEqual(second.snapshot());
    expect(first.evaluateRetryAdmissibility({ now: ADMITTED_AT + 3 })).toEqual(
      second.evaluateRetryAdmissibility({ now: ADMITTED_AT + 3 }),
    );
  });

  it('keeps a rejected command from changing the state', () => {
    const uncertain = withClosedAttempt('may_have_executed');
    const snapshot = structuredClone(uncertain.snapshot());
    uncertain.recordDispatchIntent({
      attemptId: 'att_2',
      candidateRef: 'cand_b',
      endpointRef: null,
      recordedAt: ADMITTED_AT + 3,
    });
    uncertain.failRequest({ failedAt: ADMITTED_AT + 3 });
    uncertain.recordAttemptEvidence({
      attemptId: 'att_1',
      evidence: 'not_sent',
      recordedAt: ADMITTED_AT + 3,
    });
    expect(uncertain.snapshot()).toEqual(snapshot);
  });

  it('freezes every snapshot and its nested collections', () => {
    const dispatched = withAttempt();
    const snapshot = dispatched.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.attempts)).toBe(true);
    expect(Object.isFrozen(snapshot.attempts[0])).toBe(true);
    expect(Object.isFrozen(snapshot.delivery)).toBe(true);
  });
});

describe('describeRequestProgress', () => {
  it('summarises outcomes without replacing the execution state', () => {
    const closed = withClosedAttempt('confirmed_not_executed');
    const progress = closed.describeRequestProgress();
    expect(progress).toEqual({
      status: 'open',
      attemptCount: 1,
      attemptOutcomes: ['not_executed'],
      clientOutputCommitted: false,
      clientDisconnected: false,
    });
    expect(closed.latestAttempt()?.attemptId).toBe('att_1');
  });

  it('reports an uncertain closed attempt as uncertain', () => {
    const progress = withClosedAttempt('may_have_executed').describeRequestProgress();
    expect(progress.attemptOutcomes).toEqual(['uncertain']);
  });

  it('reports an open not_sent attempt as not_executed but still in flight', () => {
    const attempt: ProviderAttempt = withAttempt().attempts()[0];
    expect(isAttemptOpen(attempt)).toBe(true);
    expect(withAttempt().describeRequestProgress().attemptOutcomes).toEqual(['not_executed']);
  });
});

describe('evidence transitions enforced by the aggregate', () => {
  it('never lets a closed attempt upgrade after the request went terminal', () => {
    const failed = withClosedAttempt('confirmed_not_executed');
    unwrap(failed.failRequest({ failedAt: ADMITTED_AT + 5 }));
    expect(
      errorOf(
        failed.recordAttemptEvidence({
          attemptId: 'att_1',
          evidence: 'confirmed_completed',
          recordedAt: ADMITTED_AT + 6,
        }),
      ),
    ).toBe('attempt_not_in_flight');
  });

  it('blocks every downgrade path while the attempt is still in flight', () => {
    // Matrix đầy đủ đã pin ở evidence.spec; ở aggregate ghim đường thực tế:
    // attempt đang mở đã thấy confirmed_completed thì không hạ về bất định
    // hay not_sent — không có downgrade giữa các mức evidence.
    const inFlight = withAttempt();
    unwrap(
      inFlight.recordAttemptEvidence({
        attemptId: 'att_1',
        evidence: 'confirmed_completed',
        recordedAt: ADMITTED_AT + 2,
      }),
    );
    for (const downgrade of ['may_have_executed', 'not_sent'] as const) {
      expect(
        errorOf(
          inFlight.recordAttemptEvidence({
            attemptId: 'att_1',
            evidence: downgrade,
            recordedAt: ADMITTED_AT + 3,
          }),
        ),
      ).toBe('invalid_evidence_transition');
    }

    // Attempt đã đóng: mọi đổi evidence bị chặn bởi guard closed-attempt.
    const closed = withClosedAttempt('confirmed_completed');
    expect(
      errorOf(
        closed.recordAttemptEvidence({
          attemptId: 'att_1',
          evidence: 'may_have_executed',
          recordedAt: ADMITTED_AT + 3,
        }),
      ),
    ).toBe('attempt_not_in_flight');
  });

  it('keeps a failed request from reopening after reconciliation-style input', () => {
    const failed = withClosedAttempt('confirmed_not_executed');
    unwrap(failed.failRequest({ failedAt: ADMITTED_AT + 5 }));
    expect(
      errorOf(
        failed.reconcileUncertainAttempt({
          attemptId: 'att_1',
          evidence: 'confirmed_completed',
          recordedAt: ADMITTED_AT + 6,
        }),
      ),
    ).toBe('reconciliation_not_pending');
  });
});
