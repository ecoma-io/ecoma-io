import { describe, expect, it } from 'vitest';

import { ModelAliasAggregate, isModelAlias, isAliasStatus, ALIAS_STATUS } from './alias';
import type { AliasRecord } from './alias';
import { isRoutingPolicyId } from '../policy/policy';
import type { RoutingPolicyId } from '../policy/policy';
import type { RoutingPolicyVersion as PolicyVersion } from '../snapshot/snapshot';

function snapshot(overrides: Partial<AliasRecord> = {}): AliasRecord {
  return {
    alias: 'claude-3-5-sonnet' as AliasRecord['alias'],
    status: ALIAS_STATUS.active,
    policyId: 'pol-1' as AliasRecord['policyId'],
    policyVersion: 1 as PolicyVersion,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('ModelAliasAggregate lifecycle', () => {
  it('issues an active alias bound to a policy version', () => {
    const alias = ModelAliasAggregate.issue({
      alias: 'claude-3-5-sonnet',
      policyId: 'pol-1',
      policyVersion: 3,
      createdAt: 1_700_000_000_000,
    });
    expect(alias.alias()).toBe('claude-3-5-sonnet');
    expect(alias.status()).toBe(ALIAS_STATUS.active);
    expect(alias.policyId()).toBe('pol-1');
    expect(alias.policyVersion()).toBe(3);
    expect(alias.isEligibleForNewRequests()).toBe(true);
    expect(alias.createdAt()).toBe(1_700_000_000_000);
    expect(alias.updatedAt()).toBe(1_700_000_000_000);
  });

  it('issue rejects invalid alias, policy id, version, or timestamp', () => {
    expect(() =>
      ModelAliasAggregate.issue({
        alias: '   ',
        policyId: 'pol-1',
        policyVersion: 1,
        createdAt: 1_700_000_000_000,
      }),
    ).toThrow(TypeError);
    expect(() =>
      ModelAliasAggregate.issue({
        alias: 'a',
        policyId: '  ',
        policyVersion: 1,
        createdAt: 1_700_000_000_000,
      }),
    ).toThrow(TypeError);
    expect(() =>
      ModelAliasAggregate.issue({
        alias: 'a',
        policyId: 'pol-1',
        policyVersion: 0,
        createdAt: 1_700_000_000_000,
      }),
    ).toThrow(TypeError);
    expect(() =>
      ModelAliasAggregate.issue({
        alias: 'a',
        policyId: 'pol-1',
        policyVersion: 1,
        createdAt: Number.NaN,
      }),
    ).toThrow(TypeError);
  });

  it('retires an active alias — terminal for new requests', () => {
    const alias = ModelAliasAggregate.issue({
      alias: 'a',
      policyId: 'pol-1',
      policyVersion: 1,
      createdAt: 1_700_000_000_000,
    });
    expect(alias.retire(1_700_000_001_000)).toBeUndefined();
    expect(alias.status()).toBe(ALIAS_STATUS.retired);
    expect(alias.updatedAt()).toBe(1_700_000_001_000);
    expect(alias.isEligibleForNewRequests()).toBe(false);
  });

  it('retire is idempotent-hostile: re-retire is rejected', () => {
    const alias = ModelAliasAggregate.issue({
      alias: 'a',
      policyId: 'pol-1',
      policyVersion: 1,
      createdAt: 1_700_000_000_000,
    });
    alias.retire(1_700_000_001_000);
    const result = alias.retire(1_700_000_002_000);
    expect(result?.code).toBe('alias_retired');
  });

  it('rejects retargeting or retiring with invalid timestamps', () => {
    const alias = ModelAliasAggregate.issue({
      alias: 'a',
      policyId: 'pol-1',
      policyVersion: 1,
      createdAt: 1_700_000_000_000,
    });
    expect(alias.retire(Number.NaN)?.code).toBe('invalid_alias');
    expect(
      alias.retargetPolicy({
        policyId: 'pol-2' as RoutingPolicyId,
        policyVersion: 2 as PolicyVersion,
        updatedAt: Number.NaN,
      })?.code,
    ).toBe('invalid_policy_version');
  });

  it('retargets policy while active and blocks after retire', () => {
    const alias = ModelAliasAggregate.issue({
      alias: 'a',
      policyId: 'pol-1',
      policyVersion: 1,
      createdAt: 1_700_000_000_000,
    });
    expect(
      alias.retargetPolicy({
        policyId: 'pol-2' as RoutingPolicyId,
        policyVersion: 4 as PolicyVersion,
        updatedAt: 1_700_000_001_000,
      }),
    ).toBeUndefined();
    expect(alias.policyId()).toBe('pol-2');
    expect(alias.policyVersion()).toBe(4);
    alias.retire(1_700_000_002_000);
    expect(
      alias.retargetPolicy({
        policyId: 'pol-3' as RoutingPolicyId,
        policyVersion: 5 as PolicyVersion,
        updatedAt: 1_700_000_003_000,
      })?.code,
    ).toBe('alias_retired');
  });

  it('reconstitutes from a snapshot and rejects corrupt data', () => {
    const original = ModelAliasAggregate.issue({
      alias: 'a',
      policyId: 'pol-1',
      policyVersion: 2,
      createdAt: 1_700_000_000_000,
    });
    original.retire(1_700_000_001_000);
    const restored = ModelAliasAggregate.reconstitute(original.snapshot());
    expect(restored.status()).toBe(ALIAS_STATUS.retired);
    expect(restored.policyVersion()).toBe(2);
    expect(restored.equals(original)).toBe(true);
    expect(() => ModelAliasAggregate.reconstitute({ alias: '' } as AliasRecord)).toThrow(TypeError);
  });

  it('snapshot returns a frozen readonly view', () => {
    const alias = ModelAliasAggregate.issue({
      alias: 'a',
      policyId: 'pol-1',
      policyVersion: 1,
      createdAt: 1_700_000_000_000,
    });
    const snap = alias.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(snap.alias).toBe('a');
    expect(snap.status).toBe(ALIAS_STATUS.active);
  });

  it('keeps pure guards intact', () => {
    expect(isModelAlias('a')).toBe(true);
    expect(isModelAlias('')).toBe(false);
    expect(isAliasStatus('retired')).toBe(true);
    expect(isAliasStatus('paused')).toBe(false);
    expect(isRoutingPolicyId('pol-1')).toBe(true);
  });

  it('snapshot fixture still satisfies the record guard', () => {
    expect(snapshot()).not.toBeNull();
  });
});

describe('ModelAliasAggregate timestamp hardening', () => {
  const T = 1_700_000_000_000;

  function active(): ReturnType<typeof ModelAliasAggregate.issue> {
    return ModelAliasAggregate.issue({
      alias: 'a',
      policyId: 'pol-1',
      policyVersion: 1,
      createdAt: T,
    });
  }

  it('rejects a retire timestamp earlier than the last update (no time regression)', () => {
    const alias = active();
    expect(alias.retire(T - 1)?.code).toBe('invalid_alias');
    expect(alias.status()).toBe('active');
  });

  it('rejects a retarget timestamp earlier than the last update', () => {
    const alias = active();
    expect(
      alias.retargetPolicy({
        policyId: 'pol-2' as RoutingPolicyId,
        policyVersion: 2 as PolicyVersion,
        updatedAt: T - 1,
      })?.code,
    ).toBe('invalid_policy_version');
  });

  it('rejects a reconstituted snapshot whose updatedAt precedes createdAt', () => {
    const stale = { ...active().snapshot(), updatedAt: T - 1 };
    expect(() => ModelAliasAggregate.reconstitute(stale)).toThrow(TypeError);
  });
});
