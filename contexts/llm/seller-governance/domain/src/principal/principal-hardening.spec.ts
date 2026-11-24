import { describe, expect, it } from 'vitest';

import { createSellerActorId } from '@ecoma-io/llm-seller-tenant-domain';
import { createLegalPrincipalId } from '../shared/shared';
import {
  FirstPartyLegalPrincipalAggregate,
  blockLegalPrincipal,
  unblockLegalPrincipal,
  type FirstPartyLegalPrincipal,
  type LegalPrincipalStatus,
} from './principal';

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

const ACTOR = createSellerActorId('actor-1');
const REVIEWER = createSellerActorId('reviewer-1');
const AT = 1_700_000_000_000;

function issued(): FirstPartyLegalPrincipal {
  return expectOk(
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
  ).snapshot();
}

function withStatus(status: LegalPrincipalStatus): FirstPartyLegalPrincipal {
  let principal = issued();
  if (status === 'active') {
    // `active` không đạt được trực tiếp từ create; mô phỏng snapshot storage
    // hợp lệ về shape đã qua giai đoạn activation (việc của decideVerification).
    return { ...principal, status, statusChangedAt: AT + 10, statusChangedBy: REVIEWER };
  }
  if (status === 'blocked') {
    principal = expectOk(
      blockLegalPrincipal({
        principal: withStatus('active'),
        blockedBy: REVIEWER,
        blockedAt: AT + 20,
      }),
    );
  }
  return principal;
}

describe('principal state machine — every transition from every state', () => {
  it('permits block from active and reverification_required', () => {
    for (const status of ['active', 'reverification_required'] as const) {
      const blocked = expectOk(
        blockLegalPrincipal({
          principal: withStatus(status),
          blockedBy: REVIEWER,
          blockedAt: AT + 30,
        }),
      );
      expect(blocked.status, `block from ${status}`).toBe('blocked');
    }
  });

  it('forbids block from blocked (no double block)', () => {
    expect(
      expectRejection(
        blockLegalPrincipal({
          principal: withStatus('blocked'),
          blockedBy: REVIEWER,
          blockedAt: AT + 30,
        }),
      ),
    ).toBe('invalid_principal_status_transition');
  });

  it('permits unblock only from blocked, landing at reverification_required', () => {
    const unblocked = expectOk(
      unblockLegalPrincipal({
        principal: withStatus('blocked'),
        unblockedBy: REVIEWER,
        unblockedAt: AT + 40,
      }),
    );
    expect(unblocked.status).toBe('reverification_required');
  });

  it('forbids unblock from active and reverification_required', () => {
    for (const status of ['active', 'reverification_required'] as const) {
      const attempt = unblockLegalPrincipal({
        principal: withStatus(status),
        unblockedBy: REVIEWER,
        unblockedAt: AT + 40,
      });
      expect(expectRejection(attempt as never), `unblock from ${status}`).toBe(
        'invalid_principal_status_transition',
      );
    }
  });

  it('never lets block or unblock be the exit to active', () => {
    const unblocked = expectOk(
      unblockLegalPrincipal({
        principal: withStatus('blocked'),
        unblockedBy: REVIEWER,
        unblockedAt: AT + 40,
      }),
    );
    expect(unblocked.status).toBe('reverification_required');
    const reblocked = expectOk(
      blockLegalPrincipal({ principal: unblocked, blockedBy: REVIEWER, blockedAt: AT + 50 }),
    );
    expect(reblocked.status).toBe('blocked');
  });
});

describe('FirstPartyLegalPrincipalAggregate — reconstitute rejects self-contradictory snapshots', () => {
  it('accepts a coherent snapshot of each status', () => {
    for (const status of ['active', 'reverification_required', 'blocked'] as const) {
      expect(FirstPartyLegalPrincipalAggregate.reconstitute(withStatus(status)).status()).toBe(
        status,
      );
    }
  });

  it('rejects a half-written status audit (one field set, the other null)', () => {
    expect(() =>
      FirstPartyLegalPrincipalAggregate.reconstitute({
        ...withStatus('blocked'),
        statusChangedAt: null,
      }),
    ).toThrow(TypeError);
    expect(() =>
      FirstPartyLegalPrincipalAggregate.reconstitute({
        ...withStatus('blocked'),
        statusChangedBy: null,
      }),
    ).toThrow(TypeError);
  });
});
