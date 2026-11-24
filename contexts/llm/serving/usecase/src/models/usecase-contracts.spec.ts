/**
 * Contracts test của ListServingModelsQuery — fail-closed tenant mapping.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Query } from '@ecoma-io/usecase-primitives';

import {
  ListServingModelsQuery,
  type ListServingModelsInput,
  type ListServingModelsOutput,
  type ListServingModelsUseCaseType,
} from './list-serving-models.js';
import { FakeOffers } from '../testing/fake-ports.js';

describe('list serving models use case contracts', () => {
  it('listServingModelsUseCaseType implements Query with matching execute signature', () => {
    expectTypeOf<ListServingModelsUseCaseType>().toExtend<
      Query<ListServingModelsInput, ListServingModelsOutput>
    >();
  });
});

describe('ListServingModelsQuery', () => {
  it('returns an empty list as a valid result (not an error)', async () => {
    const outcome = await new ListServingModelsQuery(new FakeOffers()).execute({});
    expect(outcome).toEqual({ models: [] });
  });

  it('maps offers to public models with tenant names and seconds-epoch created', async () => {
    const offers = new FakeOffers();
    offers.offers = [
      {
        normalizedModelId: 'model-a',
        createdAtMillis: 1_700_000_001_234,
        sellerTenantId: 'seller-1',
      },
      {
        normalizedModelId: 'model-b',
        createdAtMillis: 1_700_000_000_000,
        sellerTenantId: 'seller-2',
      },
    ];
    offers.tenantNames.set('seller-1', 'Acme');
    offers.tenantNames.set('seller-2', 'Beta');
    const outcome = await new ListServingModelsQuery(offers).execute({});
    expect(outcome.models).toEqual([
      { id: 'model-a', created: 1_700_000_001, ownedBy: 'Acme' },
      { id: 'model-b', created: 1_700_000_000, ownedBy: 'Beta' },
    ]);
  });

  it('fails closed when an active offer cannot be mapped to a tenant', async () => {
    const offers = new FakeOffers();
    offers.offers = [
      { normalizedModelId: 'model-a', createdAtMillis: 1, sellerTenantId: 'unknown-seller' },
    ];
    await expect(new ListServingModelsQuery(offers).execute({})).rejects.toThrow(
      'model catalogue tenant mapping missing',
    );
  });
});
