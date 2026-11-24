import { describe, expect, it } from 'vitest';

import { createSellerActorId, createSellerTenantId } from '@ecoma-io/llm-seller-tenant-domain';
import {
  createEvidenceId,
  createLegalPrincipalId,
  createVerificationCaseId,
} from '../shared/shared';
import { createEvidenceReference, type EvidenceReference } from '../evidence/evidence';
import { FirstPartyLegalPrincipalAggregate } from '../principal/principal';
import {
  VerificationCaseAggregate,
  createVerificationCase,
  decideVerification,
  expireVerificationCase,
  startVerificationReview,
  submitVerificationCase,
  type VerificationCase,
  type VerificationStatus,
} from './verification';

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
const PRINCIPAL_ID = createLegalPrincipalId('principal-1');
const ACTOR = createSellerActorId('member-1');
const REVIEWER = createSellerActorId('reviewer-1');
const AT = 1_700_000_000_000;

function evidence(): EvidenceReference {
  return expectOk(
    createEvidenceReference({
      id: createEvidenceId('e-1'),
      tenantId: TENANT,
      kind: 'business_registration',
      storageRef: 'blob://evidence/e-1',
      contentHash: 'sha256:abc',
      recordedAt: AT,
      recordedBy: ACTOR,
    }),
  );
}

function draft(type = 'business'): VerificationCase {
  return expectOk(
    createVerificationCase({
      id: createVerificationCaseId(`vc-${type}`),
      tenantId: TENANT,
      type,
      createdAt: AT,
    }),
  );
}

function submitted(type = 'business'): VerificationCase {
  return expectOk(
    submitVerificationCase({
      verificationCase: draft(type),
      submissionId: 's-1',
      evidence: [evidence()],
      submittedBy: ACTOR,
      submittedAt: AT + 10,
    }),
  );
}

function underReview(type = 'business'): VerificationCase {
  return expectOk(
    startVerificationReview({
      verificationCase: submitted(type),
      reviewer: REVIEWER,
      reviewedAt: AT + 20,
    }),
  );
}

function approved(type = 'business'): VerificationCase {
  return expectOk(
    decideVerification({
      verificationCase: underReview(type),
      decision: 'approved',
      decidedBy: REVIEWER,
      decidedAt: AT + 30,
    }),
  ).verificationCase;
}

function rejected(): VerificationCase {
  return expectOk(
    decideVerification({
      verificationCase: underReview(),
      decision: 'rejected',
      decidedBy: REVIEWER,
      decidedAt: AT + 30,
      publicDecisionReason: 'Document unreadable.',
    }),
  ).verificationCase;
}

function expired(): VerificationCase {
  return expectOk(
    expireVerificationCase({
      verificationCase: approved(),
      expiresAt: AT + 100,
      expiredAt: AT + 100,
    }),
  );
}

function statusOf(testCase: VerificationCase): VerificationStatus {
  return testCase.status;
}

function casesByStatus(): Map<VerificationStatus, VerificationCase> {
  return new Map<VerificationStatus, VerificationCase>([
    ['draft', draft()],
    ['submitted', submitted()],
    ['under_review', underReview()],
    ['approved', approved()],
    ['rejected', rejected()],
    ['expired', expired()],
  ]);
}

describe('verification state machine — transitions from every state', () => {
  it('permits submit only from draft and rejected', () => {
    for (const status of ['draft', 'rejected'] as const) {
      const attempt = submitVerificationCase({
        verificationCase: casesByStatus().get(status) as VerificationCase,
        submissionId: 's-new',
        evidence: [evidence()],
        submittedBy: ACTOR,
        submittedAt: AT + 50,
      });
      expect(attempt.ok, `submit from ${status} should succeed`).toBe(true);
    }
  });

  it('forbids submit from submitted, under_review, approved and expired', () => {
    for (const status of ['submitted', 'under_review', 'approved', 'expired'] as const) {
      const attempt = submitVerificationCase({
        verificationCase: casesByStatus().get(status) as VerificationCase,
        submissionId: 's-new',
        evidence: [evidence()],
        submittedBy: ACTOR,
        submittedAt: AT + 50,
      });
      expect(expectRejection(attempt as never), `submit from ${status}`).toBe(
        'invalid_verification_transition',
      );
    }
  });

  it('permits review only from submitted', () => {
    const attempt = startVerificationReview({
      verificationCase: submitted(),
      reviewer: REVIEWER,
      reviewedAt: AT + 50,
    });
    expect(attempt.ok).toBe(true);
  });

  it('forbids review from every other state', () => {
    for (const status of ['draft', 'under_review', 'approved', 'expired'] as const) {
      const attempt = startVerificationReview({
        verificationCase: casesByStatus().get(status) as VerificationCase,
        reviewer: REVIEWER,
        reviewedAt: AT + 50,
      });
      expect(expectRejection(attempt as never), `review from ${status}`).toBe(
        'invalid_verification_transition',
      );
    }
  });

  it('permits decide only from under_review', () => {
    const attempt = decideVerification({
      verificationCase: underReview(),
      decision: 'approved',
      decidedBy: REVIEWER,
      decidedAt: AT + 50,
    });
    expect(attempt.ok).toBe(true);
  });

  it('forbids decide from every other state', () => {
    for (const status of ['draft', 'submitted', 'approved', 'expired'] as const) {
      const attempt = decideVerification({
        verificationCase: casesByStatus().get(status) as VerificationCase,
        decision: 'approved',
        decidedBy: REVIEWER,
        decidedAt: AT + 50,
      });
      expect(expectRejection(attempt as never), `decide from ${status}`).toBe(
        'invalid_verification_transition',
      );
    }
  });

  it('permits expire only from approved', () => {
    const attempt = expireVerificationCase({
      verificationCase: approved(),
      expiresAt: AT + 100,
      expiredAt: AT + 100,
    });
    expect(attempt.ok).toBe(true);
  });

  it('forbids expire from every other state', () => {
    for (const status of ['draft', 'submitted', 'under_review', 'expired'] as const) {
      const attempt = expireVerificationCase({
        verificationCase: casesByStatus().get(status) as VerificationCase,
        expiresAt: AT + 100,
        expiredAt: AT + 100,
      });
      expect(expectRejection(attempt as never), `expire from ${status}`).toBe(
        'invalid_verification_transition',
      );
    }
  });

  it('is terminal at expired: no submit, review, decide or expire escapes it', () => {
    const terminal = expired();
    expect(statusOf(terminal)).toBe('expired');
    expect(
      expectRejection(
        submitVerificationCase({
          verificationCase: terminal,
          submissionId: 's-new',
          evidence: [evidence()],
          submittedBy: ACTOR,
          submittedAt: AT + 200,
        }),
      ),
    ).toBe('invalid_verification_transition');
    expect(
      expectRejection(
        startVerificationReview({
          verificationCase: terminal,
          reviewer: REVIEWER,
          reviewedAt: AT + 200,
        }),
      ),
    ).toBe('invalid_verification_transition');
    expect(
      expectRejection(
        decideVerification({
          verificationCase: terminal,
          decision: 'approved',
          decidedBy: REVIEWER,
          decidedAt: AT + 200,
        }),
      ),
    ).toBe('invalid_verification_transition');
    expect(
      expectRejection(
        expireVerificationCase({
          verificationCase: terminal,
          expiresAt: AT + 200,
          expiredAt: AT + 200,
        }),
      ),
    ).toBe('invalid_verification_transition');
  });
});

describe('VerificationCaseAggregate — reconstitute rejects self-contradictory snapshots', () => {
  it('accepts a coherent snapshot of each lifecycle stage', () => {
    const stages: readonly VerificationCase[] = [
      draft(),
      submitted(),
      underReview(),
      approved(),
      rejected(),
      expired(),
    ];
    for (const stage of stages) {
      expect(VerificationCaseAggregate.reconstitute(stage).status()).toBe(stage.status);
    }
  });

  it('rejects an approved case without a decision audit', () => {
    expect(() =>
      VerificationCaseAggregate.reconstitute({
        ...approved(),
        decidedAt: null,
        decidedBy: null,
      }),
    ).toThrow(TypeError);
  });

  it('rejects a rejected case without the mandatory public reason', () => {
    expect(() =>
      VerificationCaseAggregate.reconstitute({ ...rejected(), publicDecisionReason: null }),
    ).toThrow(TypeError);
  });

  it('rejects a draft case that already carries a submission timestamp', () => {
    expect(() =>
      VerificationCaseAggregate.reconstitute({ ...draft(), submittedAt: AT + 1 }),
    ).toThrow(TypeError);
  });

  it('rejects an expired case missing its expiry markers', () => {
    expect(() =>
      VerificationCaseAggregate.reconstitute({
        ...expired(),
        expiresAt: null,
        expiredAt: null,
      }),
    ).toThrow(TypeError);
  });

  it('rejects pins on a case that was never approved', () => {
    expect(() =>
      VerificationCaseAggregate.reconstitute({
        ...submitted(),
        verifiedProfileVersions: [{ axis: 'legal', version: 1 }],
      }),
    ).toThrow(TypeError);
  });

  it('keeps a principal-scoped case on its own lifecycle', () => {
    const principalDraft = expectOk(
      createVerificationCase({
        id: createVerificationCaseId('pc-1'),
        principalId: PRINCIPAL_ID,
        type: 'legal-identity',
        createdAt: AT,
      }),
    );
    expect(VerificationCaseAggregate.reconstitute(principalDraft).status()).toBe('draft');
  });
});

void FirstPartyLegalPrincipalAggregate;
