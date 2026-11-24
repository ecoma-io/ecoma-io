import { describe, expect, it } from 'vitest';

import { createAppealId, createRestrictionId } from '../shared/shared';
import { createSellerActorId, createSellerTenantId } from '@ecoma-io/llm-seller-tenant-domain';
import { Restriction } from '../restriction/restriction';
import { AppealAggregate, decideAppeal, startAppealReview, withdrawAppeal } from './appeal';
import type { Appeal, AppealStatus } from './appeal';

function expectOk<Value>(
  result: { ok: true; value: Value } | { ok: false; error: { code: string } },
): Value {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}`);
  }
  return result.value;
}

function expectRejection(result: { ok: true } | { ok: false; error: { code: string } }): string {
  if (result.ok) {
    throw new Error('expected rejection, got ok');
  }
  return result.error.code;
}

const TENANT = createSellerTenantId('tenant-1');
const OWNER = createSellerActorId('owner-1');
const REVIEWER = createSellerActorId('reviewer-1');
const AT = 1_700_000_000_000;

function submittedAppeal(): Appeal {
  return expectOk(
    AppealAggregate.issue({
      id: createAppealId('a-1'),
      restriction: expectOk(
        Restriction.issue({
          id: createRestrictionId('r-1'),
          tenantId: TENANT,
          policy: 'compliance',
          publicReason: 'Policy breach.',
          internalReason: 'Internal note.',
          scope: { kind: 'tenant' },
          activatesAt: AT,
        }),
      ).snapshot(),
      tenant: { id: TENANT, owner: OWNER },
      memberships: [],
      submittedBy: OWNER,
      submittedAt: AT + 10,
    }),
  ).snapshot();
}

function reviewedAppeal(): Appeal {
  return expectOk(
    startAppealReview({ appeal: submittedAppeal(), reviewer: REVIEWER, reviewedAt: AT + 20 }),
  );
}

function decidedAppeal(decision: 'accepted' | 'rejected'): Appeal {
  return expectOk(
    decideAppeal({
      appeal: reviewedAppeal(),
      decision,
      decidedBy: REVIEWER,
      decidedAt: AT + 30,
      publicDecisionReason: decision === 'rejected' ? 'Not accepted.' : undefined,
      decisionReason: 'Internal note.',
    }),
  );
}

describe('appeal state machine — transitions from every state', () => {
  const TERMINAL: readonly AppealStatus[] = ['accepted', 'rejected', 'withdrawn'];

  it('permits withdrawal from submitted and under_review, forbids it from terminal states', () => {
    expect(
      expectOk(withdrawAppeal({ appeal: submittedAppeal(), withdrawnAt: AT + 15 })).status,
    ).toBe('withdrawn');
    expect(
      expectOk(withdrawAppeal({ appeal: reviewedAppeal(), withdrawnAt: AT + 25 })).status,
    ).toBe('withdrawn');
    for (const terminal of TERMINAL) {
      const appeal = { ...submittedAppeal(), status: terminal } as Appeal;
      expect(expectRejection(withdrawAppeal({ appeal, withdrawnAt: AT + 40 }))).toBe(
        'invalid_appeal_transition',
      );
    }
  });

  it('forbids review and decision from every terminal state', () => {
    for (const terminal of TERMINAL) {
      const appeal = { ...submittedAppeal(), status: terminal } as Appeal;
      expect(
        expectRejection(startAppealReview({ appeal, reviewer: REVIEWER, reviewedAt: AT + 40 })),
      ).toBe('invalid_appeal_transition');
      expect(
        expectRejection(
          decideAppeal({
            appeal,
            decision: 'accepted',
            decidedBy: REVIEWER,
            decidedAt: AT + 40,
          }),
        ),
      ).toBe('invalid_appeal_transition');
    }
  });

  it('forbids a second review from under_review and a second decision after a decision', () => {
    const review = reviewedAppeal();
    expect(
      expectRejection(
        startAppealReview({ appeal: review, reviewer: REVIEWER, reviewedAt: AT + 25 }),
      ),
    ).toBe('invalid_appeal_transition');
    const accepted = decidedAppeal('accepted');
    expect(
      expectRejection(
        decideAppeal({
          appeal: accepted,
          decision: 'rejected',
          decidedBy: REVIEWER,
          decidedAt: AT + 40,
          publicDecisionReason: 'Reversed.',
        }),
      ),
    ).toBe('invalid_appeal_transition');
  });

  it('forbids deciding an appeal straight from submitted, skipping review', () => {
    expect(
      expectRejection(
        decideAppeal({
          appeal: submittedAppeal(),
          decision: 'accepted',
          decidedBy: REVIEWER,
          decidedAt: AT + 30,
        }),
      ),
    ).toBe('invalid_appeal_transition');
  });
});

describe('appeal aggregate — reconstitute rejects self-contradictory snapshots', () => {
  it('accepts a coherent snapshot of each lifecycle stage', () => {
    for (const appeal of [submittedAppeal(), reviewedAppeal(), decidedAppeal('rejected')]) {
      expect(AppealAggregate.reconstitute(appeal).status()).toBe(appeal.status);
    }
  });

  it('rejects an accepted appeal without a decision audit', () => {
    const accepted = decidedAppeal('accepted');
    expect(() =>
      AppealAggregate.reconstitute({ ...accepted, decidedAt: null, decidedBy: null }),
    ).toThrow(TypeError);
  });

  it('rejects a rejected appeal without the mandatory public reason', () => {
    const rejected = decidedAppeal('rejected');
    expect(() => AppealAggregate.reconstitute({ ...rejected, publicDecisionReason: null })).toThrow(
      TypeError,
    );
  });

  it('rejects an under_review appeal whose review audit is missing, and vice versa', () => {
    expect(() =>
      AppealAggregate.reconstitute({
        ...submittedAppeal(),
        status: 'under_review',
        reviewedAt: null,
        reviewedBy: null,
      }),
    ).toThrow(TypeError);
    expect(() =>
      AppealAggregate.reconstitute({
        ...submittedAppeal(),
        reviewedAt: AT + 5,
        reviewedBy: REVIEWER,
      }),
    ).toThrow(TypeError);
  });

  it('rejects a withdrawn appeal without withdrawnAt and a submitted one carrying it', () => {
    expect(() =>
      AppealAggregate.reconstitute({
        ...submittedAppeal(),
        status: 'withdrawn',
        withdrawnAt: null,
      }),
    ).toThrow(TypeError);
    expect(() =>
      AppealAggregate.reconstitute({ ...submittedAppeal(), withdrawnAt: AT + 1 }),
    ).toThrow(TypeError);
  });
});
