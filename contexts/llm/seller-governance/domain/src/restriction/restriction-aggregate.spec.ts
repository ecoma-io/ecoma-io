import { describe, expect, it } from 'vitest';

import { createSellerActorId, createSellerTenantId } from '@ecoma-io/llm-seller-tenant-domain';
import {
  createAppealId,
  createLegalPrincipalId,
  createRestrictionId,
  createVerificationCaseId,
  llmGovernanceOk,
  type LlmGovernanceResult,
} from '../shared/shared';
import { AppealAggregate } from '../appeal/appeal';
import {
  FirstPartyLegalPrincipalAggregate,
  type LegalPrincipalStatus,
} from '../principal/principal';
import { type AppealStatus } from '../appeal/appeal';
import { VerificationCaseAggregate } from '../verification-case/verification';
import { Restriction, type RestrictionRecord } from './restriction';

function expectOk<Value>(result: LlmGovernanceResult<Value>): Value {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}`);
  }
  return result.value;
}

const TENANT = createSellerTenantId('tenant-1');
const OWNER = createSellerActorId('owner-1');
const REVIEWER = createSellerActorId('reviewer-1');
const ACTOR = createSellerActorId('actor-1');
const AT = 1_700_000_000_000;

describe('Restriction aggregate', () => {
  it('issues a record and exposes the same snapshot as the record shape', () => {
    const issued = expectOk(
      Restriction.issue({
        id: createRestrictionId('r-1'),
        tenantId: TENANT,
        policy: 'compliance',
        publicReason: 'Policy breach.',
        internalReason: 'Internal note.',
        scope: { kind: 'tenant' },
        activatesAt: AT,
      }),
    );
    expect(issued.id).toBe('r-1');
    const snapshot = issued.snapshot();
    expect(snapshot.tenantId).toBe(TENANT);
    expect(snapshot.policy).toBe('compliance');
    expect(snapshot.liftedAt).toBeNull();
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('rejects duplicate ids via issue()', () => {
    const existing: RestrictionRecord[] = [
      expectOk(
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
    ];
    const duplicate = Restriction.issue(
      {
        id: createRestrictionId('r-1'),
        tenantId: TENANT,
        policy: 'compliance',
        publicReason: 'Policy breach.',
        internalReason: 'Internal note.',
        scope: { kind: 'tenant' },
        activatesAt: AT,
      },
      existing,
    );
    expect(duplicate.ok).toBe(false);
  });

  it('reconstitutes a valid snapshot and rejects a corrupted one', () => {
    const record = expectOk(
      Restriction.issue({
        id: createRestrictionId('r-1'),
        tenantId: TENANT,
        policy: 'compliance',
        publicReason: 'Policy breach.',
        internalReason: 'Internal note.',
        scope: { kind: 'tenant' },
        activatesAt: AT,
      }),
    ).snapshot();
    const restored = Restriction.reconstitute(record);
    expect(restored.id).toBe('r-1');
    expect(() =>
      Restriction.reconstitute({
        ...record,
        publicReason: '  padded  ',
      }),
    ).toThrow(TypeError);
  });

  it('derives effectiveness at evaluation time, never stored', () => {
    const restriction = expectOk(
      Restriction.issue({
        id: createRestrictionId('r-1'),
        tenantId: TENANT,
        policy: 'compliance',
        publicReason: 'Policy breach.',
        internalReason: 'Internal note.',
        scope: { kind: 'tenant' },
        activatesAt: AT,
        expiresAt: AT + 1_000,
      }),
    );
    expect(restriction.isEffectiveAt(AT)).toBe(true);
    expect(restriction.isEffectiveAt(AT - 1)).toBe(false);
    expect(restriction.isEffectiveAt(AT + 1_000)).toBe(false);
    // Derived, not stored: snapshot has no effectiveness flag.
    expect(Object.hasOwn(restriction.snapshot(), 'effective')).toBe(false);
  });

  it('lifts once and refuses a second lift', () => {
    const restriction = expectOk(
      Restriction.issue({
        id: createRestrictionId('r-1'),
        tenantId: TENANT,
        policy: 'compliance',
        publicReason: 'Policy breach.',
        internalReason: 'Internal note.',
        scope: { kind: 'tenant' },
        activatesAt: AT,
      }),
    );
    expectOk(restriction.lift({ record: restriction.snapshot(), liftedAt: AT + 500 }));
    expect(restriction.snapshot().liftedAt).toBe(AT + 500);
    const again = restriction.lift({ record: restriction.snapshot(), liftedAt: AT + 900 });
    const code = again.ok ? 'ok' : again.error.code;
    expect(again.ok).toBe(false);
    expect(code).toBe('restriction_already_lifted');
    expect(restriction.snapshot().liftedAt).toBe(AT + 500);
  });

  it('keeps llmGovernanceOk result semantics for issue', () => {
    const result = Restriction.issue({
      id: createRestrictionId('r-1'),
      tenantId: TENANT,
      policy: 'compliance',
      publicReason: 'Policy breach.',
      internalReason: 'Internal note.',
      scope: { kind: 'tenant' },
      activatesAt: AT,
    });
    expect(result).toSatisfy(
      (r: LlmGovernanceResult<unknown>) => llmGovernanceOk(true).ok === r.ok,
    );
  });
});

describe('Appeal aggregate', () => {
  it('issues, reconstitutes and runs the lifecycle through the aggregate', () => {
    const restriction = expectOk(
      Restriction.issue({
        id: createRestrictionId('r-1'),
        tenantId: TENANT,
        policy: 'compliance',
        publicReason: 'Policy breach.',
        internalReason: 'Internal note.',
        scope: { kind: 'tenant' },
        activatesAt: AT,
      }),
    );
    const submitted = expectOk(
      AppealAggregate.issue({
        id: createAppealId('a-1'),
        restriction: restriction.snapshot(),
        tenant: { id: TENANT, owner: OWNER },
        memberships: [],
        submittedBy: OWNER,
        submittedAt: AT,
      }),
    );
    expect(submitted.status()).toBe('submitted');
    expectOk(submitted.startReview({ reviewer: REVIEWER, reviewedAt: AT + 100 }));
    expect(submitted.status()).toBe('under_review');
    expectOk(
      submitted.decide({
        decision: 'accepted',
        decidedBy: REVIEWER,
        decidedAt: AT + 200,
        decisionReason: 'Resolved.',
        publicDecisionReason: 'Appeal accepted.',
      }),
    );
    expect(submitted.status()).toBe('accepted');
    expect(submitted.toPublic().publicDecisionReason).toBe('Appeal accepted.');
    expect(submitted.snapshot().decisionReason).toBe('Resolved.');
    // Decision does not lift the restriction — lift is a separate caller action.
    expect(restriction.snapshot().liftedAt).toBeNull();
    const restored = AppealAggregate.reconstitute(submitted.snapshot());
    expect(restored.status()).toBe('accepted');
    expect(() =>
      AppealAggregate.reconstitute({ ...submitted.snapshot(), status: 'unknown' as AppealStatus }),
    ).toThrow(TypeError);
  });
});

describe('VerificationCase aggregate', () => {
  it('issues a draft case and reconstitutes from snapshot', () => {
    const created = expectOk(
      VerificationCaseAggregate.issue({
        id: createVerificationCaseId('v-1'),
        tenantId: TENANT,
        type: 'business',
        createdAt: AT,
      }),
    );
    expect(created.status()).toBe('draft');
    expect(created.submissions()).toEqual([]);
    const restored = VerificationCaseAggregate.reconstitute(created.snapshot());
    expect(restored.id).toBe('v-1');
    expect(() =>
      VerificationCaseAggregate.reconstitute({
        ...created.snapshot(),
        tenantId: null,
      }),
    ).toThrow(TypeError);
  });
});

describe('FirstPartyLegalPrincipal aggregate', () => {
  it('issues at reverification_required and blocks/unblocks through the lifecycle', () => {
    const principal = expectOk(
      FirstPartyLegalPrincipalAggregate.issue({
        principalId: createLegalPrincipalId('p-1'),
        legalName: 'Ecoma Legal',
        legalType: 'company',
        jurisdiction: 'VN',
        registrationReference: 'REG-1',
        taxResidency: 'VN',
        taxIdentifier: 'TAX-1',
        declarationReference: 'DEC-1',
        effectiveFrom: AT,
        recordedAt: AT,
        recordedBy: ACTOR,
      }),
    );
    expect(principal.status()).toBe('reverification_required');
    expect(principal.legalProfileVersionAt(AT)?.version).toBe(1);
    expect(principal.taxProfileVersionAt(AT)?.version).toBe(1);
    expectOk(principal.block({ blockedBy: ACTOR, blockedAt: AT + 100 }));
    expect(principal.status()).toBe('blocked');
    // Append from blocked is rejected.
    const appendBlocked = principal.appendLegalProfileVersion({
      legalName: 'Ecoma Legal 2',
      legalType: 'company',
      jurisdiction: 'VN',
      registrationReference: 'REG-2',
      effectiveFrom: AT + 1_000,
      recordedAt: AT + 1_000,
      recordedBy: ACTOR,
    });
    expect(appendBlocked.ok).toBe(false);
    expectOk(principal.unblock({ unblockedBy: ACTOR, unblockedAt: AT + 200 }));
    // Unblock never returns to active directly (§7).
    expect(principal.status()).toBe('reverification_required');
    const restored = FirstPartyLegalPrincipalAggregate.reconstitute(principal.snapshot());
    expect(restored.status()).toBe('reverification_required');
    expect(() =>
      FirstPartyLegalPrincipalAggregate.reconstitute({
        ...principal.snapshot(),
        status: 'unknown' as LegalPrincipalStatus,
      }),
    ).toThrow(TypeError);
  });
});
