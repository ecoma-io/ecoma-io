import { describe, expect, it } from 'vitest';

import {
  MODEL_OFFER_ACTIVATABLE_STATUSES,
  MODEL_OFFER_STATUS,
  ModelOffer,
  addEndpointToPool,
  assertPublicAliasUnique,
  createCapabilitySet,
  createEndpointPool,
  createEndpointPoolId,
  createModelOfferId,
  createSellerTenantId,
  createUpstreamEndpoint,
  createUpstreamEndpointId,
  isModelOfferServing,
  isModelOfferSnapshot,
  isModelOfferStatus,
  isPublicAlias,
  type EndpointPool,
  type SellerOperationalEligibility,
} from '../index';

function expectOk<Value>(
  result: { ok: true; value: Value } | { ok: false; error: { code: string } },
): Value {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}`);
  }
  return result.value;
}

function expectErrorCode(error: { code: string } | undefined): string {
  if (error === undefined) {
    throw new Error('expected a domain error, got ok');
  }
  return error.code;
}

function expectRejection(result: { ok: true } | { ok: false; error: { code: string } }): string {
  if (result.ok) {
    throw new Error('expected rejection, got ok');
  }
  return result.error.code;
}

const AT = 1_700_000_000_000;
const TENANT = createSellerTenantId('tenant-1');
const OFFER_ID = createModelOfferId('offer-1');
const POOL_ID = createEndpointPoolId('pool-1');

function issue(overrides: Record<string, unknown> = {}): ModelOffer {
  return ModelOffer.issue({
    id: OFFER_ID,
    sellerTenantId: TENANT,
    normalizedModelId: 'gpt-4o',
    capabilities: ['text_generation'],
    createdAt: AT,
    ...overrides,
  } as never);
}

function activeOffer(at = AT + 10): ModelOffer {
  const offer = issue();
  const error = offer.activate({
    eligibility: verdict(),
    pools: [healthyPool()],
    activatedAt: at,
  });
  expect(error).toBeUndefined();
  return offer;
}

function healthyPool(
  offerId = OFFER_ID,
  health: 'healthy' | 'degraded' | 'down' = 'healthy',
): EndpointPool {
  const pool = expectOk(createEndpointPool({ id: POOL_ID, offerId, createdAt: AT }));
  const endpoint = expectOk(
    createUpstreamEndpoint({
      id: createUpstreamEndpointId('ep-1'),
      endpointPoolId: POOL_ID,
      url: 'https://api.provider.example/v1',
      protocol: 'openai_chat',
      health,
      createdAt: AT,
    }),
  );
  return expectOk(addEndpointToPool({ pool, endpoint, addedAt: AT + 2 }));
}

function verdict(
  overrides: Partial<SellerOperationalEligibility> = {},
): SellerOperationalEligibility {
  return { tenantId: TENANT, eligible: true, blockers: [], assessedAt: AT, ...overrides };
}

describe('isModelOfferStatus / MODEL_OFFER_STATUS', () => {
  it('covers exactly the four statuses', () => {
    expect(Object.keys(MODEL_OFFER_STATUS).toSorted()).toEqual([
      'active',
      'draft',
      'inactive',
      'retired',
    ]);
    expect(Object.isFrozen(MODEL_OFFER_STATUS)).toBe(true);
    expect(isModelOfferStatus('draft')).toBe(true);
    expect(isModelOfferStatus('retired')).toBe(true);
    expect(isModelOfferStatus('paused')).toBe(false);
  });
});

describe('isPublicAlias', () => {
  it('accepts lowercase names and rejects other shapes', () => {
    expect(isPublicAlias('gpt-4o')).toBe(true);
    expect(isPublicAlias('my.model_1')).toBe(true);
    expect(isPublicAlias('GPT-4o')).toBe(false);
    expect(isPublicAlias('-gpt')).toBe(false);
    expect(isPublicAlias('gpt 4o')).toBe(false);
    expect(isPublicAlias('')).toBe(false);
    expect(isPublicAlias('a'.repeat(201))).toBe(false);
    expect(isPublicAlias(null)).toBe(false);
  });
});

describe('ModelOffer.issue', () => {
  it('creates a frozen-snapshot draft with no event timestamps', () => {
    const created = issue({ publicAlias: 'gpt-4o' });
    expect(created.status()).toBe('draft');
    expect(created.publicAlias()).toBe('gpt-4o');
    expect(created.capabilities().capabilities).toEqual(['text_generation']);
    expect(created.activatedAt()).toBeNull();
    expect(created.deactivatedAt()).toBeNull();
    expect(created.retiredAt()).toBeNull();
    expect(created.updatedAt()).toBe(AT);
    expect(isModelOfferSnapshot(created.snapshot())).toBe(true);
  });

  it('allows an offer without a public alias', () => {
    expect(issue().publicAlias()).toBeNull();
  });

  it.each([
    [{ id: '' }, /model offer ID is not valid/u],
    [{ sellerTenantId: '' }, /seller tenant ID is not valid/u],
    [{ normalizedModelId: 'GPT-4o' }, /normalized model ID is not valid/u],
    [{ capabilities: [] }, /capability set is not valid/u],
    [{ capabilities: ['bad one'] }, /Capability is not valid/u],
    [{ createdAt: 1.5 }, /epoch millisecond/u],
    [{ publicAlias: 'GPT' }, /public alias is not valid/u],
  ] as const)('rejects invalid input %j', (overrides, message) => {
    expect(() => issue({ ...overrides })).toThrow(TypeError);
    expect(() => issue({ ...overrides })).toThrow(message);
  });

  it('rejects a duplicate offer id', () => {
    expect(() => issue({ existing: [issue()] })).toThrow(/model offer ID is duplicated/u);
  });

  it('rejects a public alias already used by another offer', () => {
    const existing = issue({ id: createModelOfferId('offer-2'), publicAlias: 'gpt-4o' });
    expect(() => issue({ publicAlias: 'gpt-4o', existing: [existing] })).toThrow(
      /public alias is not valid/u,
    );
  });

  it('allows the same alias when the existing offer has none', () => {
    const existing = issue({ id: createModelOfferId('offer-2') });
    expect(issue({ publicAlias: 'gpt-4o', existing: [existing] }).publicAlias()).toBe('gpt-4o');
  });
});

describe('ModelOffer.snapshot / ModelOffer.reconstitute', () => {
  it('round-trips through the snapshot', () => {
    const offer = issue({ publicAlias: 'gpt-4o' });
    const restored = ModelOffer.reconstitute(offer.snapshot());
    expect(restored.snapshot()).toEqual(offer.snapshot());
    expect(restored.id).toBe(offer.id);
  });

  it('snapshot is frozen and carries the canonical capability order', () => {
    const offer = issue({ capabilities: ['vision', 'embedding'] });
    const snap = offer.snapshot();
    expect(snap.capabilities).toEqual(['embedding', 'vision']);
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.capabilities)).toBe(true);
  });

  it('rejects snapshots inconsistent with their status', () => {
    const draft = issue();
    expect(() => ModelOffer.reconstitute({ ...draft.snapshot(), activatedAt: AT + 1 })).toThrow(
      TypeError,
    );
    expect(() => ModelOffer.reconstitute({ ...draft.snapshot(), retiredAt: AT + 1 })).toThrow(
      TypeError,
    );
    const active = activeOffer();
    expect(() => ModelOffer.reconstitute({ ...active.snapshot(), activatedAt: null })).toThrow(
      TypeError,
    );
    expect(() => ModelOffer.reconstitute({ ...active.snapshot(), retiredAt: AT + 20 })).toThrow(
      TypeError,
    );
    const inactive = deactivate(active);
    expect(() => ModelOffer.reconstitute({ ...inactive.snapshot(), deactivatedAt: null })).toThrow(
      TypeError,
    );
    expect(() => ModelOffer.reconstitute({ ...inactive.snapshot(), activatedAt: null })).toThrow(
      TypeError,
    );
    expect(() => ModelOffer.reconstitute({ ...inactive.snapshot(), retiredAt: AT + 30 })).toThrow(
      TypeError,
    );
    const retired = retire(inactive);
    expect(() => ModelOffer.reconstitute({ ...retired.snapshot(), retiredAt: null })).toThrow(
      TypeError,
    );
  });

  it('rejects event timestamps later than updatedAt and updatedAt before createdAt', () => {
    expect(() =>
      ModelOffer.reconstitute({ ...activeOffer().snapshot(), updatedAt: AT + 5 }),
    ).toThrow(TypeError);
    expect(() => ModelOffer.reconstitute({ ...issue().snapshot(), updatedAt: AT - 1 })).toThrow(
      TypeError,
    );
  });

  it('rejects broken field shapes', () => {
    expect(isModelOfferSnapshot(null)).toBe(false);
    expect(isModelOfferSnapshot({ ...issue().snapshot(), capabilities: [] })).toBe(false);
    expect(isModelOfferSnapshot({ ...issue().snapshot(), capabilities: ['bad one'] })).toBe(false);
    expect(isModelOfferSnapshot({ ...issue().snapshot(), capabilities: ['b', 'a'] })).toBe(false);
    expect(isModelOfferSnapshot({ ...issue().snapshot(), publicAlias: 'BAD' })).toBe(false);
    expect(isModelOfferSnapshot({ ...issue().snapshot(), status: 'paused' })).toBe(false);
    expect(isModelOfferSnapshot({ ...issue().snapshot(), normalizedModelId: 'GPT' })).toBe(false);
    expect(isModelOfferSnapshot({ ...issue().snapshot(), sellerTenantId: '' })).toBe(false);
  });
});

describe('ModelOffer.assignPublicAlias', () => {
  it('assigns the alias while draft and advances updatedAt', () => {
    const offer = issue();
    const error = offer.assignPublicAlias({ publicAlias: 'gpt-4o', assignedAt: AT + 1 });
    expect(error).toBeUndefined();
    expect(offer.publicAlias()).toBe('gpt-4o');
    expect(offer.updatedAt()).toBe(AT + 1);
  });

  it('refuses to change the alias after activation', () => {
    const offer = activeOffer();
    expect(
      expectErrorCode(offer.assignPublicAlias({ publicAlias: 'new-name', assignedAt: AT + 20 })),
    ).toBe('public_alias_immutable');
  });

  it('rejects a retired offer before the immutability check', () => {
    const offer = issue();
    expect(offer.retire({ retiredAt: AT + 1 })).toBeUndefined();
    expect(
      expectErrorCode(offer.assignPublicAlias({ publicAlias: 'new-name', assignedAt: AT + 2 })),
    ).toBe('offer_retired');
  });

  it('rejects an alias used by another offer but allows keeping its own', () => {
    const offer = issue();
    expect(offer.assignPublicAlias({ publicAlias: 'gpt-4o', assignedAt: AT + 1 })).toBeUndefined();
    const other = issue({ id: createModelOfferId('offer-2'), publicAlias: 'other' });
    expect(
      expectErrorCode(
        offer.assignPublicAlias({
          publicAlias: 'other',
          assignedAt: AT + 2,
          existing: [offer, other],
        }),
      ),
    ).toBe('invalid_public_alias');
    expect(
      offer.assignPublicAlias({ publicAlias: 'gpt-4o', assignedAt: AT + 2, existing: [offer] }),
    ).toBeUndefined();
  });

  it('rejects invalid input, timestamps and context', () => {
    const offer = issue();
    expect(expectErrorCode(offer.assignPublicAlias({ publicAlias: 'X', assignedAt: AT }))).toBe(
      'invalid_public_alias',
    );
    expect(expectErrorCode(offer.assignPublicAlias({ publicAlias: 'x', assignedAt: AT - 1 }))).toBe(
      'timestamp_regression',
    );
    expect(
      expectErrorCode(offer.assignPublicAlias({ publicAlias: 'x', assignedAt: 'now' as never })),
    ).toBe('invalid_timestamp');
  });
});

describe('ModelOffer.replaceCapabilities', () => {
  it('replaces the set on a draft and on an active offer', () => {
    const draft = issue();
    expect(
      draft.replaceCapabilities({ capabilities: ['vision', 'embedding'], updatedAt: AT + 1 }),
    ).toBeUndefined();
    expect(draft.capabilities().capabilities).toEqual(['embedding', 'vision']);

    const active = activeOffer();
    expect(
      active.replaceCapabilities({ capabilities: ['vision'], updatedAt: AT + 20 }),
    ).toBeUndefined();
    expect(active.status()).toBe('active');
    expect(active.capabilities().capabilities).toEqual(['vision']);
  });

  it('rejects a retired offer', () => {
    const offer = issue();
    expect(offer.retire({ retiredAt: AT + 1 })).toBeUndefined();
    expect(
      expectErrorCode(offer.replaceCapabilities({ capabilities: ['vision'], updatedAt: AT + 2 })),
    ).toBe('offer_retired');
  });

  it('rejects an empty or invalid set and a regressing timestamp', () => {
    const offer = issue();
    expect(
      expectErrorCode(offer.replaceCapabilities({ capabilities: [], updatedAt: AT + 1 })),
    ).toBe('invalid_capability_set');
    expect(
      expectErrorCode(offer.replaceCapabilities({ capabilities: ['bad one'], updatedAt: AT + 1 })),
    ).toBe('invalid_capability');
    expect(
      expectErrorCode(offer.replaceCapabilities({ capabilities: ['vision'], updatedAt: AT - 1 })),
    ).toBe('timestamp_regression');
    expect(
      expectErrorCode(
        offer.replaceCapabilities({ capabilities: ['vision'], updatedAt: 'x' as never }),
      ),
    ).toBe('invalid_timestamp');
  });
});

describe('ModelOffer.activate', () => {
  it('activates a draft when eligible and a pool is healthy', () => {
    const offer = activeOffer();
    expect(offer.status()).toBe('active');
    expect(offer.activatedAt()).toBe(AT + 10);
    expect(offer.updatedAt()).toBe(AT + 10);
    expect(offer.deactivatedAt()).toBeNull();
    expect(isModelOfferSnapshot(offer.snapshot())).toBe(true);
  });

  it('re-activates an inactive offer', () => {
    const inactive = deactivate(activeOffer());
    expect(inactive.status()).toBe('inactive');
    const reactivated = inactive;
    expect(
      reactivated.activate({
        eligibility: verdict(),
        pools: [healthyPool()],
        activatedAt: AT + 30,
      }),
    ).toBeUndefined();
    expect(reactivated.status()).toBe('active');
    expect(reactivated.activatedAt()).toBe(AT + 30);
    expect(reactivated.deactivatedAt()).toBe(AT + 20);
  });

  it('refuses activating an already active offer instead of silently succeeding', () => {
    const offer = activeOffer();
    expect(
      expectErrorCode(
        offer.activate({ eligibility: verdict(), pools: [healthyPool()], activatedAt: AT + 20 }),
      ),
    ).toBe('offer_already_active');
  });

  it('refuses activating a retired offer', () => {
    const offer = issue();
    expect(offer.retire({ retiredAt: AT + 1 })).toBeUndefined();
    expect(
      expectErrorCode(
        offer.activate({ eligibility: verdict(), pools: [healthyPool()], activatedAt: AT + 2 }),
      ),
    ).toBe('offer_retired');
  });

  it('rejects a verdict belonging to another tenant', () => {
    const offer = issue();
    expect(
      expectErrorCode(
        offer.activate({
          eligibility: verdict({ tenantId: createSellerTenantId('tenant-2') }),
          pools: [healthyPool()],
          activatedAt: AT + 10,
        }),
      ),
    ).toBe('eligibility_tenant_mismatch');
  });

  it('rejects an ineligible verdict and a stale verdict', () => {
    const offer = issue();
    expect(
      expectErrorCode(
        offer.activate({
          eligibility: verdict({ eligible: false, blockers: ['restricted'] }),
          pools: [healthyPool()],
          activatedAt: AT + 10,
        }),
      ),
    ).toBe('seller_not_eligible');
    expect(
      expectErrorCode(
        offer.activate({
          eligibility: verdict({ assessedAt: AT - 1 }),
          pools: [healthyPool()],
          activatedAt: AT + 10,
        }),
      ),
    ).toBe('seller_not_eligible');
  });

  it('rejects a malformed verdict', () => {
    const offer = issue();
    expect(
      expectErrorCode(
        offer.activate({
          eligibility: { bad: true } as never,
          pools: [healthyPool()],
          activatedAt: AT + 10,
        }),
      ),
    ).toBe('invalid_eligibility_verdict');
  });

  it('requires at least one healthy pool', () => {
    const offer = issue();
    expect(
      expectErrorCode(
        offer.activate({
          eligibility: verdict(),
          pools: [healthyPool(OFFER_ID, 'degraded')],
          activatedAt: AT + 10,
        }),
      ),
    ).toBe('endpoint_pool_not_healthy');
    expect(
      expectErrorCode(offer.activate({ eligibility: verdict(), pools: [], activatedAt: AT + 10 })),
    ).toBe('endpoint_pool_missing');
  });

  it('rejects pools of another offer', () => {
    const offer = issue();
    expect(
      expectErrorCode(
        offer.activate({
          eligibility: verdict(),
          pools: [healthyPool(createModelOfferId('offer-2'))],
          activatedAt: AT + 10,
        }),
      ),
    ).toBe('pool_offer_mismatch');
  });

  it('rejects a duplicate pool id in the input list', () => {
    const offer = issue();
    const pool = healthyPool();
    expect(
      expectErrorCode(
        offer.activate({ eligibility: verdict(), pools: [pool, pool], activatedAt: AT + 10 }),
      ),
    ).toBe('ambiguous_context');
  });

  it('rejects invalid input shapes and timestamps', () => {
    const offer = issue();
    expect(
      expectErrorCode(
        offer.activate({ eligibility: verdict(), pools: [healthyPool()], activatedAt: 'x' }),
      ),
    ).toBe('invalid_timestamp');
    expect(
      expectErrorCode(
        offer.activate({ eligibility: verdict(), pools: [healthyPool()], activatedAt: AT - 1 }),
      ),
    ).toBe('timestamp_regression');
  });
});

describe('ModelOffer.deactivate', () => {
  it('deactivates an active offer and keeps activation history', () => {
    const offer = activeOffer();
    expect(offer.deactivate({ deactivatedAt: AT + 20 })).toBeUndefined();
    expect(offer.status()).toBe('inactive');
    expect(offer.deactivatedAt()).toBe(AT + 20);
    expect(offer.activatedAt()).toBe(AT + 10);
  });

  it('rejects deactivating an offer that is already inactive', () => {
    const offer = deactivate(activeOffer());
    expect(expectErrorCode(offer.deactivate({ deactivatedAt: AT + 30 }))).toBe(
      'offer_already_inactive',
    );
  });

  it('rejects draft, retired, regressing and invalid input', () => {
    expect(expectErrorCode(issue().deactivate({ deactivatedAt: AT + 1 }))).toBe(
      'invalid_offer_transition',
    );
    const retired = issue();
    expect(retired.retire({ retiredAt: AT + 1 })).toBeUndefined();
    expect(expectErrorCode(retired.deactivate({ deactivatedAt: AT + 2 }))).toBe('offer_retired');
    expect(expectErrorCode(activeOffer().deactivate({ deactivatedAt: AT }))).toBe(
      'timestamp_regression',
    );
    expect(expectErrorCode(activeOffer().deactivate({ deactivatedAt: 'x' as never }))).toBe(
      'invalid_timestamp',
    );
  });
});

describe('ModelOffer.retire', () => {
  it('retires from draft, active and inactive', () => {
    const fromDraft = issue();
    expect(fromDraft.retire({ retiredAt: AT + 1 })).toBeUndefined();
    expect(fromDraft.status()).toBe('retired');
    expect(fromDraft.retiredAt()).toBe(AT + 1);

    const fromActive = activeOffer();
    expect(fromActive.retire({ retiredAt: AT + 20 })).toBeUndefined();
    expect(fromActive.status()).toBe('retired');
    expect(fromActive.activatedAt()).toBe(AT + 10);

    const fromInactive = deactivate(activeOffer());
    expect(fromInactive.retire({ retiredAt: AT + 30 })).toBeUndefined();
    expect(fromInactive.status()).toBe('retired');
  });

  it('is terminal', () => {
    const offer = issue();
    expect(offer.retire({ retiredAt: AT + 1 })).toBeUndefined();
    expect(expectErrorCode(offer.retire({ retiredAt: AT + 2 }))).toBe('offer_retired');
    expect(
      expectErrorCode(
        offer.activate({ eligibility: verdict(), pools: [healthyPool()], activatedAt: AT + 2 }),
      ),
    ).toBe('offer_retired');
  });

  it('rejects regressing and invalid timestamps', () => {
    const offer = issue();
    expect(expectErrorCode(offer.retire({ retiredAt: AT - 1 }))).toBe('timestamp_regression');
    expect(expectErrorCode(offer.retire({ retiredAt: 'x' as never }))).toBe('invalid_timestamp');
  });
});

describe('isModelOfferServing', () => {
  it('is true for an active offer with a serving pool', () => {
    expect(isModelOfferServing(activeOffer(), [healthyPool()])).toBe(true);
  });

  it('is false for a draft even with healthy pools', () => {
    expect(isModelOfferServing(issue(), [healthyPool()])).toBe(false);
  });

  it('is false when every endpoint is down', () => {
    expect(isModelOfferServing(activeOffer(), [healthyPool(OFFER_ID, 'down')])).toBe(false);
  });

  it('fails closed on a foreign pool or malformed input', () => {
    expect(isModelOfferServing(activeOffer(), [healthyPool(createModelOfferId('offer-2'))])).toBe(
      false,
    );
    expect(isModelOfferServing(activeOffer(), 'nope' as never)).toBe(false);
    expect(isModelOfferServing({ bad: true } as never, [healthyPool()])).toBe(false);
    expect(isModelOfferServing(activeOffer(), [])).toBe(false);
  });
});

describe('assertPublicAliasUnique', () => {
  it('accepts an unused alias and an alias owned by the same offer', () => {
    const assigned = issue({ publicAlias: 'gpt-4o' });
    expect(expectOk(assertPublicAliasUnique('gpt-4o', []))).toBe('gpt-4o');
    expect(expectOk(assertPublicAliasUnique('gpt-4o', [assigned], assigned.id))).toBe('gpt-4o');
  });

  it('rejects an alias owned by another offer', () => {
    const assigned = issue({ publicAlias: 'gpt-4o' });
    expect(expectRejection(assertPublicAliasUnique('gpt-4o', [assigned]))).toBe(
      'invalid_public_alias',
    );
  });

  it('rejects an invalid alias or broken offer list', () => {
    expect(expectRejection(assertPublicAliasUnique('BAD', []))).toBe('invalid_public_alias');
    expect(
      expectRejection(assertPublicAliasUnique('ok', [{ bad: true }] as unknown as ModelOffer[])),
    ).toBe('invalid_model_offer');
    expect(
      expectRejection(assertPublicAliasUnique('ok', 'nope' as unknown as readonly ModelOffer[])),
    ).toBe('invalid_model_offer');
  });
});

describe('MODEL_OFFER_ACTIVATABLE_STATUSES', () => {
  it('lists exactly draft and inactive, and is frozen', () => {
    expect(MODEL_OFFER_ACTIVATABLE_STATUSES).toEqual(['draft', 'inactive']);
    expect(Object.isFrozen(MODEL_OFFER_ACTIVATABLE_STATUSES)).toBe(true);
  });
});

describe('capability set coupling', () => {
  it('stores a canonical capability set, not the caller array', () => {
    const created = issue({ capabilities: ['vision', 'embedding'] });
    expect(created.snapshot().capabilities).toEqual(
      expectOk(createCapabilitySet(['embedding', 'vision'])).capabilities,
    );
  });
});

describe('aggregate hardening: snapshot isolation and reconstitute edge cases', () => {
  // Ghim: snapshot() trả mảng capabilities MỚI mỗi lần — mutate snapshot không
  // được thấm vào aggregate, và mutate input lúc issue/reconstitute không được
  // đổi capability đã canonical.
  it('snapshot() returns a fresh frozen array: mutating one snapshot does not affect the aggregate', () => {
    const offer = issue({ capabilities: ['vision', 'embedding'] });
    const snap1 = offer.snapshot();
    const snap2 = offer.snapshot();
    expect(snap1.capabilities).not.toBe(snap2.capabilities);
    // Frozen: mutate trực tiếp phải ném.
    expect(() => (snap1.capabilities as string[]).push('audio')).toThrow(TypeError);
  });

  it('input capabilities array aliasing does not leak into the aggregate', () => {
    const input = ['vision', 'embedding'];
    const offer = issue({ capabilities: input });
    input.push('audio'); // mutate mảng truyền vào sau khi issue
    expect(offer.snapshot().capabilities).toEqual(['embedding', 'vision']);
  });

  it('reconstitute does not alias the snapshot capabilities array', () => {
    const snapshot = { ...issue({ capabilities: ['vision'] }).snapshot() };
    const restored = ModelOffer.reconstitute(snapshot);
    expect(() => (snapshot.capabilities as string[]).push('audio')).toThrow(TypeError);
    expect(restored.snapshot().capabilities).toEqual(['vision']);
  });

  it('reconstitutes a retired-from-draft offer (legal path: terminal from any state)', () => {
    const offer = issue();
    expect(offer.retire({ retiredAt: AT + 1 })).toBeUndefined();
    const restored = ModelOffer.reconstitute(offer.snapshot());
    expect(restored.status()).toBe('retired');
    expect(restored.retiredAt()).toBe(AT + 1);
    expect(restored.activatedAt()).toBeNull();
  });

  it('reconstitute accepts a retired snapshot whose publicAlias stays intact (uniqueness is a write-boundary concern, not a snapshot invariant)', () => {
    const offer = issue({ publicAlias: 'gpt-4o' });
    const twin = issue({ id: createModelOfferId('offer-2'), publicAlias: 'gpt-4o' });
    // Hai offer cùng alias trong "storage" — reconstitute từng cái một vẫn phải
    // thành công: uniqueness không phải invariant của snapshot đơn lẻ.
    expect(ModelOffer.reconstitute(offer.snapshot()).publicAlias()).toBe('gpt-4o');
    expect(ModelOffer.reconstitute(twin.snapshot()).publicAlias()).toBe('gpt-4o');
  });

  it('rejects a retired snapshot with a retiredAt before createdAt', () => {
    const offer = issue();
    expect(offer.retire({ retiredAt: AT + 1 })).toBeUndefined();
    expect(() =>
      ModelOffer.reconstitute({ ...offer.snapshot(), retiredAt: AT - 1, updatedAt: AT - 1 }),
    ).toThrow(TypeError);
  });

  it('rejects a non-canonical or duplicated capability list on reconstitute', () => {
    expect(() =>
      ModelOffer.reconstitute({ ...issue().snapshot(), capabilities: ['vision', 'vision'] }),
    ).toThrow(TypeError);
  });

  it('rejects a draft snapshot that has updatedAt before createdAt', () => {
    expect(() => ModelOffer.reconstitute({ ...issue().snapshot(), updatedAt: AT - 1 })).toThrow(
      TypeError,
    );
  });
});

describe('aggregate hardening: alias reassignment while draft', () => {
  it('allows reassigning the alias repeatedly while still draft, advancing updatedAt each time', () => {
    const offer = issue();
    expect(offer.assignPublicAlias({ publicAlias: 'name-a', assignedAt: AT + 1 })).toBeUndefined();
    expect(offer.assignPublicAlias({ publicAlias: 'name-b', assignedAt: AT + 2 })).toBeUndefined();
    expect(offer.publicAlias()).toBe('name-b');
    expect(offer.updatedAt()).toBe(AT + 2);
  });

  it('rejects an alias matching the offers own current alias given self in existing (self-exclusion guard)', () => {
    const offer = issue();
    expect(offer.assignPublicAlias({ publicAlias: 'gpt-4o', assignedAt: AT + 1 })).toBeUndefined();
    // Tự giữ alias của mình là hợp lệ (self-excluded khỏi unique check).
    expect(
      offer.assignPublicAlias({ publicAlias: 'gpt-4o', assignedAt: AT + 2, existing: [offer] }),
    ).toBeUndefined();
  });
});

// — helpers over the aggregate operations —
function deactivate(offer: ModelOffer): ModelOffer {
  expect(offer.deactivate({ deactivatedAt: AT + 20 })).toBeUndefined();
  return offer;
}

function retire(offer: ModelOffer): ModelOffer {
  expect(offer.retire({ retiredAt: AT + 30 })).toBeUndefined();
  return offer;
}
