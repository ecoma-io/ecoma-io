import { describe, expect, it } from 'vitest';

import {
  RoutingPolicyAggregate,
  createPolicy,
  isRoutingPolicy,
  isRoutingPolicyId,
  type RoutingPolicy,
} from './policy';
import type { CandidateId } from '../candidate/candidate';
import type { FallbackConfig } from '../snapshot/snapshot';

const cand = (id: string) => id as CandidateId;

const fallbackConfig: FallbackConfig = {
  endpointFallback: true,
  offerFallback: true,
  maxAttempts: 3,
};

describe('RoutingPolicyAggregate lifecycle', () => {
  it('issues a policy at version 1', () => {
    const policy = RoutingPolicyAggregate.issue({
      policyId: 'pol-1',
      candidates: [cand('cand-a')],
      strategy: 'priority',
      fallbackConfig,
      issuedAt: 1_700_000_000_000,
    });
    expect(policy.policyId()).toBe('pol-1');
    expect(policy.version()).toBe(1);
    expect(policy.candidates()).toEqual(['cand-a']);
    expect(policy.strategy()).toBe('priority');
    expect(policy.fallbackConfig()).toEqual(fallbackConfig);
    expect(policy.isEligibleForNewRequests()).toBe(true);
  });

  it('issue rejects invalid input', () => {
    expect(() =>
      RoutingPolicyAggregate.issue({
        policyId: '   ',
        candidates: [cand('cand-a')],
        strategy: 'priority',
        fallbackConfig,
        issuedAt: 1_700_000_000_000,
      }),
    ).toThrow(TypeError);
    expect(() =>
      RoutingPolicyAggregate.issue({
        policyId: 'pol-1',
        candidates: [],
        strategy: 'priority',
        fallbackConfig,
        issuedAt: 1_700_000_000_000,
      }),
    ).toThrow(TypeError);
    expect(() =>
      RoutingPolicyAggregate.issue({
        policyId: 'pol-1',
        candidates: [''],
        strategy: 'priority',
        fallbackConfig,
        issuedAt: 1_700_000_000_000,
      }),
    ).toThrow(TypeError);
    expect(() =>
      RoutingPolicyAggregate.issue({
        policyId: 'pol-1',
        candidates: [cand('cand-a')],
        strategy: 'weighted',
        fallbackConfig,
        issuedAt: 1_700_000_000_000,
      }),
    ).toThrow(TypeError);
    expect(() =>
      RoutingPolicyAggregate.issue({
        policyId: 'pol-1',
        candidates: [cand('cand-a')],
        strategy: 'priority',
        fallbackConfig: { endpointFallback: true },
        issuedAt: 1_700_000_000_000,
      }),
    ).toThrow(TypeError);
    expect(() =>
      RoutingPolicyAggregate.issue({
        policyId: 'pol-1',
        candidates: [cand('cand-a')],
        strategy: 'priority',
        fallbackConfig,
        issuedAt: Number.NaN,
      }),
    ).toThrow(TypeError);
  });

  it('applyChange bumps version by exactly +1 (monotonic)', () => {
    const policy = RoutingPolicyAggregate.issue({
      policyId: 'pol-1',
      candidates: [cand('cand-a')],
      strategy: 'priority',
      fallbackConfig,
      issuedAt: 1_700_000_000_000,
    });
    expect(
      policy.applyChange({
        expectedVersion: 1,
        candidates: [cand('cand-a'), cand('cand-b')],
        strategy: 'round_robin',
        fallbackConfig,
        updatedAt: 1_700_000_001_000,
      }),
    ).toBeUndefined();
    expect(policy.version()).toBe(2);
    expect(
      policy.applyChange({
        expectedVersion: 2,
        candidates: [cand('cand-a')],
        strategy: 'priority',
        fallbackConfig,
        updatedAt: 1_700_000_002_000,
      }),
    ).toBeUndefined();
    expect(policy.version()).toBe(3);
    expect(policy.strategy()).toBe('priority');
  });

  it('applyChange rejects a stale expected version (no downgrade/skip)', () => {
    const policy = RoutingPolicyAggregate.issue({
      policyId: 'pol-1',
      candidates: [cand('cand-a')],
      strategy: 'priority',
      fallbackConfig,
      issuedAt: 1_700_000_000_000,
    });
    policy.applyChange({
      expectedVersion: 1,
      candidates: [cand('cand-a')],
      strategy: 'priority',
      fallbackConfig,
      updatedAt: 1_700_000_001_000,
    });
    // Stale expected version — concurrent writer already moved to v2.
    expect(
      policy.applyChange({
        expectedVersion: 1,
        candidates: [cand('cand-a')],
        strategy: 'lowest_price',
        fallbackConfig,
        updatedAt: 1_700_000_002_000,
      })?.code,
    ).toBe('invalid_policy_version');
    // Skipping versions is refused: aggregate owns +1.
    expect(policy.version()).toBe(2);
  });

  it('applyChange rejects timestamp regression and invalid payloads', () => {
    const policy = RoutingPolicyAggregate.issue({
      policyId: 'pol-1',
      candidates: [cand('cand-a')],
      strategy: 'priority',
      fallbackConfig,
      issuedAt: 1_700_000_000_000,
    });
    expect(
      policy.applyChange({
        expectedVersion: 1,
        candidates: [cand('cand-a')],
        strategy: 'priority',
        fallbackConfig,
        updatedAt: 1_699_999_999_999,
      })?.code,
    ).toBe('invalid_policy_version');
    expect(
      policy.applyChange({
        expectedVersion: 1,
        candidates: [],
        strategy: 'priority',
        fallbackConfig,
        updatedAt: 1_700_000_001_000,
      })?.code,
    ).toBe('invalid_candidate');
    expect(
      policy.applyChange({
        expectedVersion: 1,
        candidates: [cand('cand-a')],
        strategy: 'weighted' as never,
        fallbackConfig,
        updatedAt: 1_700_000_001_000,
      })?.code,
    ).toBe('invalid_strategy_input');
    expect(
      policy.applyChange({
        expectedVersion: 1,
        candidates: [cand('cand-a')],
        strategy: 'priority',
        fallbackConfig: { maxAttempts: 0 } as unknown as FallbackConfig,
        updatedAt: 1_700_000_001_000,
      })?.code,
    ).toBe('invalid_snapshot');
  });

  it('reconstitutes from a snapshot and rejects corrupt data', () => {
    const original = RoutingPolicyAggregate.issue({
      policyId: 'pol-1',
      candidates: [cand('cand-a')],
      strategy: 'priority',
      fallbackConfig,
      issuedAt: 1_700_000_000_000,
    });
    const restored = RoutingPolicyAggregate.reconstitute(original.snapshot());
    expect(restored.version()).toBe(1);
    expect(restored.equals(original)).toBe(true);
    expect(() =>
      RoutingPolicyAggregate.reconstitute({ policyId: 'pol-1', version: 0 } as RoutingPolicy),
    ).toThrow(TypeError);
  });

  it('snapshot returns a frozen readonly view', () => {
    const policy = RoutingPolicyAggregate.issue({
      policyId: 'pol-1',
      candidates: [cand('cand-a')],
      strategy: 'priority',
      fallbackConfig,
      issuedAt: 1_700_000_000_000,
    });
    const snap = policy.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.candidates)).toBe(true);
    expect(snap.version).toBe(1);
  });

  it('keeps pure factory and guards intact', () => {
    const result = createPolicy({
      policyId: 'pol-1',
      candidates: [cand('cand-a')],
      strategy: 'priority',
      fallbackConfig,
      currentVersion: 5,
      updatedAt: 1_700_000_000_000,
    });
    expect(result.ok).toBe(true);
    expect(result.ok && isRoutingPolicy(result.policy)).toBe(true);
    expect(isRoutingPolicyId('pol-1')).toBe(true);
  });
});
