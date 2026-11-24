/**
 * Ghim guard rehydrate: state đọc từ persistence phải bị từ chối nếu vi phạm
 * invariant mà aggregate tự bảo đảm khi sinh state.
 */

import { describe, expect, it } from 'vitest';

import { isProviderAttempt, type ProviderAttempt } from './attempt/attempt';
import { isClientDelivery } from './delivery/delivery';
import {
  LogicalRequest,
  isLogicalRequestSnapshot,
  type LogicalRequestSnapshot,
} from './request/request';
import { createRequestId } from './shared/shared';

const ADMITTED_AT = 1_700_000_000_000;

function openRequest(): LogicalRequest {
  const result = LogicalRequest.create({
    requestId: 'req_guard',
    admittedAt: ADMITTED_AT,
    policy: { maxAttempts: 3, deadlineAt: ADMITTED_AT + 60_000 },
  });
  if (!result.ok) {
    throw new Error('fixture is invalid');
  }
  return result.value;
}

function attempt(): ProviderAttempt {
  const request = openRequest();
  const result = request.recordDispatchIntent({
    attemptId: 'att_1',
    candidateRef: 'cand_a',
    endpointRef: null,
    recordedAt: ADMITTED_AT + 1,
  });
  if (!result.ok) {
    throw new Error('fixture is invalid');
  }
  return request.attempts()[0];
}

function closedAttemptSnapshot(): LogicalRequestSnapshot {
  const request = openRequest();
  const dispatched = request.recordDispatchIntent({
    attemptId: 'att_1',
    candidateRef: 'cand_a',
    endpointRef: null,
    recordedAt: ADMITTED_AT + 1,
  });
  if (!dispatched.ok) {
    throw new Error('fixture is invalid');
  }
  const closed = request.closeAttempt({
    attemptId: 'att_1',
    evidence: 'confirmed_not_executed',
    endedAt: ADMITTED_AT + 2,
  });
  if (!closed.ok) {
    throw new Error('fixture is invalid');
  }
  return request.snapshot();
}

describe('isProviderAttempt', () => {
  it('accepts an attempt produced by the domain', () => {
    expect(isProviderAttempt(attempt())).toBe(true);
    expect(isProviderAttempt(closedAttemptSnapshot().attempts[0])).toBe(true);
  });

  it('rejects authoritative evidence that was never recorded', () => {
    expect(isProviderAttempt({ ...attempt(), evidence: 'confirmed_completed' })).toBe(false);
  });

  it('rejects evidence recorded before dispatch', () => {
    expect(
      isProviderAttempt({
        ...attempt(),
        evidence: 'may_have_executed',
        evidenceRecordedAt: 1,
      }),
    ).toBe(false);
  });

  it('rejects a closed attempt without a recorded evidence time', () => {
    expect(isProviderAttempt({ ...attempt(), endedAt: ADMITTED_AT + 2 })).toBe(false);
  });

  it('rejects a sequence that is not a positive integer', () => {
    for (const sequence of [0, -1, 1.5, Number.NaN]) {
      expect(isProviderAttempt({ ...attempt(), sequence })).toBe(false);
    }
  });
});

describe('isLogicalRequestSnapshot', () => {
  it('accepts a request produced by the domain', () => {
    expect(isLogicalRequestSnapshot(openRequest().snapshot())).toBe(true);
    expect(isLogicalRequestSnapshot(closedAttemptSnapshot())).toBe(true);
  });

  it('rejects non-contiguous or duplicate attempt sequences', () => {
    const snapshot = closedAttemptSnapshot();
    expect(
      isLogicalRequestSnapshot({
        ...snapshot,
        attempts: [{ ...snapshot.attempts[0], sequence: 2 }],
      }),
    ).toBe(false);
    expect(
      isLogicalRequestSnapshot({
        ...snapshot,
        attempts: [snapshot.attempts[0], snapshot.attempts[0]],
      }),
    ).toBe(false);
  });

  it('rejects attempts recorded before the previous attempt', () => {
    const snapshot = closedAttemptSnapshot();
    const second = {
      ...snapshot.attempts[0],
      attemptId: 'att_2',
      sequence: 2,
      recordedAt: ADMITTED_AT,
    };
    expect(
      isLogicalRequestSnapshot({
        ...snapshot,
        attempts: [snapshot.attempts[0], second],
      }),
    ).toBe(false);
  });

  it('rejects a deadline that is not after admission', () => {
    const snapshot = openRequest().snapshot();
    expect(
      isLogicalRequestSnapshot({
        ...snapshot,
        policy: { ...snapshot.policy, deadlineAt: snapshot.admittedAt },
      }),
    ).toBe(false);
  });

  it('rejects a delivery fact recorded before admission', () => {
    const snapshot = openRequest().snapshot();
    expect(
      isLogicalRequestSnapshot({
        ...snapshot,
        delivery: { state: 'committed', committedAt: 1, disconnectedAt: null },
      }),
    ).toBe(false);
    expect(
      isLogicalRequestSnapshot({
        ...snapshot,
        delivery: {
          state: 'not_committed',
          committedAt: null,
          disconnectedAt: 1,
        },
      }),
    ).toBe(false);
  });

  it('rejects a terminal request that still carries an open attempt', () => {
    const request = openRequest();
    const dispatched = request.recordDispatchIntent({
      attemptId: 'att_1',
      candidateRef: 'cand_a',
      endpointRef: null,
      recordedAt: ADMITTED_AT + 1,
    });
    if (!dispatched.ok) {
      throw new Error('fixture is invalid');
    }
    expect(
      isLogicalRequestSnapshot({
        ...request.snapshot(),
        status: 'completed',
        completion: {
          status: 'completed',
          closedAt: ADMITTED_AT + 2,
          reason: null,
        },
      }),
    ).toBe(false);
  });

  it('rejects completion without a confirmed provider completion', () => {
    const snapshot = closedAttemptSnapshot();
    expect(
      isLogicalRequestSnapshot({
        ...snapshot,
        status: 'completed',
        completion: {
          status: 'completed',
          closedAt: ADMITTED_AT + 3,
          reason: null,
        },
      }),
    ).toBe(false);
  });

  it('rejects a completion closed before a recorded attempt', () => {
    const snapshot = closedAttemptSnapshot();
    expect(
      isLogicalRequestSnapshot({
        ...snapshot,
        status: 'completed',
        attempts: snapshot.attempts.map((item) => ({
          ...item,
          evidence: 'confirmed_completed',
        })),
        completion: {
          status: 'completed',
          closedAt: ADMITTED_AT,
          reason: null,
        },
      }),
    ).toBe(false);
  });

  it('rejects a cancellation without a reason and a failure with one', () => {
    const snapshot = closedAttemptSnapshot();
    expect(
      isLogicalRequestSnapshot({
        ...snapshot,
        status: 'cancelled',
        completion: {
          status: 'cancelled',
          closedAt: ADMITTED_AT + 3,
          reason: null,
        },
      }),
    ).toBe(false);
    expect(
      isLogicalRequestSnapshot({
        ...snapshot,
        status: 'failed',
        completion: {
          status: 'failed',
          closedAt: ADMITTED_AT + 3,
          reason: 'client_cancelled',
        },
      }),
    ).toBe(false);
  });

  it('rejects a snapshot with a request id that is not an opaque id', () => {
    const snapshot = closedAttemptSnapshot();
    expect(isLogicalRequestSnapshot({ ...snapshot, requestId: '  ' })).toBe(false);
    expect(isLogicalRequestSnapshot({ ...snapshot, requestId: 42 })).toBe(false);
  });
});

describe('LogicalRequest.reconstitute', () => {
  it('round-trips a snapshot produced by the domain', () => {
    const snapshot = closedAttemptSnapshot();
    const rehydrated = LogicalRequest.reconstitute(snapshot);
    expect(rehydrated.snapshot()).toEqual(snapshot);
    expect(rehydrated.id).toBe(createRequestId('req_guard'));
  });

  it('rejects a self-inconsistent snapshot with TypeError', () => {
    expect(() => LogicalRequest.reconstitute(null)).toThrow(TypeError);
    expect(() => LogicalRequest.reconstitute({})).toThrow(TypeError);
    const snapshot = closedAttemptSnapshot();
    expect(() =>
      LogicalRequest.reconstitute({
        ...snapshot,
        status: 'completed',
        completion: {
          status: 'completed',
          closedAt: ADMITTED_AT + 3,
          reason: null,
        },
      }),
    ).toThrow(TypeError);
  });
});

describe('isClientDelivery', () => {
  it('rejects a delivery whose facts contradict its state', () => {
    expect(
      isClientDelivery({
        state: 'committed',
        committedAt: null,
        disconnectedAt: null,
      }),
    ).toBe(false);
    expect(
      isClientDelivery({
        state: 'not_committed',
        committedAt: ADMITTED_AT,
        disconnectedAt: null,
      }),
    ).toBe(false);
  });
});

describe('reconstitute self-contradiction hardening', () => {
  it('rejects an attempt whose evidence was recorded but claims not_sent with a timestamp', () => {
    // not_sent + evidenceRecordedAt là trạng thái không thể sinh ra từ domain:
    // evidence ban đầu luôn có evidenceRecordedAt null. Domain chấp nhận
    // (not_sent là trạng thái khởi tạo), nhưng timestamp lùi trước dispatch thì không.
    expect(
      isProviderAttempt({
        ...attempt(),
        evidence: 'not_sent',
        evidenceRecordedAt: 1,
      }),
    ).toBe(false);
  });

  it('rejects a terminal snapshot whose completion timestamp precedes the last attempt', () => {
    const snapshot = closedAttemptSnapshot();
    expect(
      isLogicalRequestSnapshot({
        ...snapshot,
        status: 'failed',
        completion: {
          status: 'failed',
          closedAt: ADMITTED_AT,
          reason: null,
        },
      }),
    ).toBe(false);
  });

  it('rejects a reconciling snapshot whose uncertain attempt is still open', () => {
    const request = openRequest();
    const dispatched = request.recordDispatchIntent({
      attemptId: 'att_1',
      candidateRef: 'cand_a',
      endpointRef: null,
      recordedAt: ADMITTED_AT + 1,
    });
    if (!dispatched.ok) {
      throw new Error('fixture is invalid');
    }
    const updated = request.recordAttemptEvidence({
      attemptId: 'att_1',
      evidence: 'may_have_executed',
      recordedAt: ADMITTED_AT + 2,
    });
    if (!updated.ok) {
      throw new Error('fixture is invalid');
    }
    expect(
      isLogicalRequestSnapshot({
        ...request.snapshot(),
        status: 'reconciling',
        completion: null,
      }),
    ).toBe(false);
  });

  it('rejects a completed snapshot whose only attempt is not a confirmed completion', () => {
    const snapshot = closedAttemptSnapshot();
    const upgraded = {
      ...snapshot,
      attempts: snapshot.attempts.map((item) => ({
        ...item,
        evidence: 'confirmed_not_executed' as const,
      })),
    };
    expect(
      isLogicalRequestSnapshot({
        ...upgraded,
        status: 'completed',
        completion: {
          status: 'completed',
          closedAt: ADMITTED_AT + 3,
          reason: null,
        },
      }),
    ).toBe(false);
  });

  it('round-trips a reconstituted aggregate without losing state', () => {
    const snapshot = closedAttemptSnapshot();
    const twice = LogicalRequest.reconstitute(snapshot).snapshot();
    expect(isLogicalRequestSnapshot(twice)).toBe(true);
    expect(twice).toEqual(snapshot);
  });
});
