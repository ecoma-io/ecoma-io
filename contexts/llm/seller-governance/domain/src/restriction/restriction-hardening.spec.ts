import { describe, expect, it } from 'vitest';

import { createSellerTenantId } from '@ecoma-io/llm-seller-tenant-domain';
import { createRestrictionId } from '../shared/shared';
import {
  Restriction,
  evaluateRestrictions,
  isRestrictionEffective,
  liftRestriction,
  type RestrictionPolicy,
  type RestrictionRecord,
} from './restriction';

function expectOk<Value>(
  result: { ok: true; value: Value } | { ok: false; error: { code: string } },
): Value {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}`);
  }
  return result.value;
}

const TENANT = createSellerTenantId('tenant-1');
const AT = 1_700_000_000_000;

const POLICIES: Readonly<Record<string, RestrictionPolicy>> = Object.freeze({
  compliance: { restrictive: true },
  monitoring: { restrictive: false },
});

function record(overrides: Partial<Parameters<typeof createRecord>[0]> = {}): RestrictionRecord {
  return createRecord({
    id: createRestrictionId('r-1'),
    tenantId: TENANT,
    policy: 'compliance',
    publicReason: 'Policy breach.',
    internalReason: 'Internal note.',
    scope: { kind: 'tenant' as const },
    activatesAt: AT,
    ...overrides,
  });
}

function createRecord(input: Parameters<typeof Restriction.issue>[0]): RestrictionRecord {
  return expectOk(Restriction.issue(input)).snapshot();
}

describe('authorization ladder — overlapping restrictions', () => {
  it('denies when any single effective restrictive record matches, regardless of the rest', () => {
    // Một restrictive + một non-restrictive + một lifted: chỉ restrictive chặn.
    const restrictive = record({ id: createRestrictionId('r-a') });
    const monitoring = record({
      id: createRestrictionId('r-b'),
      policy: 'monitoring',
    });
    const lifted = expectOk(
      liftRestriction({ record: record({ id: createRestrictionId('r-c') }), liftedAt: AT + 1 }),
    );
    const evaluation = expectOk(
      evaluateRestrictions({
        tenantId: TENANT,
        records: [restrictive, monitoring, lifted],
        policies: POLICIES,
        target: { kind: 'tenant' },
        now: AT + 10,
      }),
    );
    expect(evaluation.blocked).toBe(true);
    expect(evaluation.blockingRecordIds).toEqual([restrictive.id]);
    expect(evaluation.unevaluable).toBe(false);
  });

  it('is not unblocked by a non-restrictive record overlapping a restrictive one', () => {
    // Thứ tự record không tạo ưu tiên: non-restrictive đứng trước không "nuốt" restrictive.
    const monitoring = record({
      id: createRestrictionId('r-b'),
      policy: 'monitoring',
    });
    const restrictive = record({ id: createRestrictionId('r-a') });
    const evaluation = expectOk(
      evaluateRestrictions({
        tenantId: TENANT,
        records: [monitoring, restrictive],
        policies: POLICIES,
        target: { kind: 'tenant' },
        now: AT + 10,
      }),
    );
    expect(evaluation.blocked).toBe(true);
  });

  it('fails closed when one overlapping record has an unknown policy, even if another is clear', () => {
    const clear = record({ id: createRestrictionId('r-a'), policy: 'monitoring' });
    const unknown = record({ id: createRestrictionId('r-b'), policy: 'never_seen' });
    const evaluation = expectOk(
      evaluateRestrictions({
        tenantId: TENANT,
        records: [clear, unknown],
        policies: POLICIES,
        target: { kind: 'tenant' },
        now: AT + 10,
      }),
    );
    expect(evaluation.blocked).toBe(true);
    expect(evaluation.unevaluable).toBe(true);
    expect(evaluation.unknownPolicies).toEqual(['never_seen']);
  });
});

describe('authorization ladder — expiry boundary (caller-supplied now)', () => {
  it('blocks strictly inside [activatesAt, expiresAt) and clears at and after expiry', () => {
    const bounded = record({
      id: createRestrictionId('r-exp'),
      activatesAt: AT,
      expiresAt: AT + 100,
    });
    // Trước activation: chưa chặn.
    expect(isRestrictionEffective(bounded, AT - 1)).toBe(false);
    // Trúng cửa sổ.
    expect(isRestrictionEffective(bounded, AT)).toBe(true);
    expect(isRestrictionEffective(bounded, AT + 99)).toBe(true);
    // Trúng biên expiry: nửa mở, hết hạn tại expiresAt.
    expect(isRestrictionEffective(bounded, AT + 100)).toBe(false);
    // Sau expiry.
    expect(isRestrictionEffective(bounded, AT + 1000)).toBe(false);

    for (const now of [AT - 1, AT + 100, AT + 1000]) {
      const evaluation = expectOk(
        evaluateRestrictions({
          tenantId: TENANT,
          records: [bounded],
          policies: POLICIES,
          target: { kind: 'tenant' },
          now,
        }),
      );
      expect(evaluation.blocked).toBe(false);
    }
  });

  it('blocks until the boundary when the caller evaluates before expiry', () => {
    const bounded = record({
      id: createRestrictionId('r-exp'),
      expiresAt: AT + 100,
    });
    const evaluation = expectOk(
      evaluateRestrictions({
        tenantId: TENANT,
        records: [bounded],
        policies: POLICIES,
        target: { kind: 'tenant' },
        now: AT + 99,
      }),
    );
    expect(evaluation.blocked).toBe(true);
  });

  it('treats a record with no expiry as blocking forever after activation', () => {
    const unbounded = record({ id: createRestrictionId('r-forever') });
    expect(isRestrictionEffective(unbounded, AT + 100_000)).toBe(true);
  });

  it('keeps blocking across an overlapping pair whose windows expire at different times', () => {
    // Hai record chồng nhau, hết hạn khác lúc: blocked chỉ mất khi cả hai hết hạn.
    const short = record({
      id: createRestrictionId('r-short'),
      expiresAt: AT + 50,
    });
    const long = record({
      id: createRestrictionId('r-long'),
      expiresAt: AT + 500,
    });
    const midEval = expectOk(
      evaluateRestrictions({
        tenantId: TENANT,
        records: [short, long],
        policies: POLICIES,
        target: { kind: 'tenant' },
        now: AT + 60,
      }),
    );
    expect(midEval.blocked).toBe(true);
    expect(midEval.blockingRecordIds).toEqual([long.id]);
    const endEval = expectOk(
      evaluateRestrictions({
        tenantId: TENANT,
        records: [short, long],
        policies: POLICIES,
        target: { kind: 'tenant' },
        now: AT + 500,
      }),
    );
    expect(endEval.blocked).toBe(false);
  });
});

describe('Restriction.reconstitute — self-contradictory snapshots', () => {
  const base = {
    id: createRestrictionId('r-1'),
    tenantId: TENANT,
    policy: 'compliance',
    publicReason: 'Policy breach.',
    internalReason: 'Internal note.',
    scope: { kind: 'tenant' as const },
    activatesAt: AT,
    expiresAt: null,
    liftedAt: null,
    appealDeadline: null,
  };

  it('accepts a snapshot every window field of which is coherent', () => {
    const restored = Restriction.reconstitute({
      ...base,
      expiresAt: AT + 100,
      liftedAt: AT + 150,
      appealDeadline: AT + 50,
    });
    expect(restored.snapshot().liftedAt).toBe(AT + 150);
  });

  it('rejects an expiry at or before activation', () => {
    expect(() => Restriction.reconstitute({ ...base, expiresAt: AT })).toThrow(TypeError);
    expect(() => Restriction.reconstitute({ ...base, expiresAt: AT - 1 })).toThrow(TypeError);
  });

  it('rejects a lift before activation', () => {
    expect(() => Restriction.reconstitute({ ...base, liftedAt: AT - 1 })).toThrow(TypeError);
  });

  it('rejects an appeal deadline before activation', () => {
    expect(() => Restriction.reconstitute({ ...base, appealDeadline: AT - 1 })).toThrow(TypeError);
  });
});
