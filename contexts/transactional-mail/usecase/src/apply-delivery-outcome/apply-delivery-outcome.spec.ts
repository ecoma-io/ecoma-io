import { describe, expect, it } from 'vitest';

import { ApplyMailDeliveryOutcomeUseCase } from './apply-delivery-outcome';
import type { ApplyMailDeliveryOutcomeDeps } from './apply-delivery-outcome';
import type { MailMessageStateReaderPort } from '../ports';

function asDeliveryId(value: string): import('@ecoma-io/transactional-mail-domain').DeliveryId {
  return value as import('@ecoma-io/transactional-mail-domain').DeliveryId;
}

function mockDeps(
  overrides: {
    state?: { status: string; dispatchGeneration: number } | null;
    applyResult?: boolean;
  } = {},
): ApplyMailDeliveryOutcomeDeps {
  const stateReader: MailMessageStateReaderPort = {
    async findStateByDeliveryId() {
      return overrides.state === undefined
        ? { status: 'queued', dispatchGeneration: 1 }
        : overrides.state;
    },
    async applyOutcome() {
      return overrides.applyResult ?? true;
    },
  };
  return { stateReader };
}

const baseInput = {
  deliveryId: asDeliveryId('dlv-1'),
  outcome: 'sent' as const,
  dispatchGeneration: 1,
  errorClass: null,
  nowMs: 3000,
};

describe('ApplyMailDeliveryOutcomeUseCase — fixed check order (§6.2.2)', () => {
  it('1. unknown delivery → not-found', async () => {
    const useCase = new ApplyMailDeliveryOutcomeUseCase(mockDeps({ state: null }));
    const result = await useCase.execute(baseInput);
    expect(result).toEqual({ result: 'not-found' });
  });

  it('2. generation mismatch → stale with current generation, no write', async () => {
    const deps = mockDeps({ state: { status: 'queued', dispatchGeneration: 2 } });
    const applySpy = vi.spyOn(deps.stateReader, 'applyOutcome');
    const useCase = new ApplyMailDeliveryOutcomeUseCase(deps);
    const result = await useCase.execute(baseInput);
    expect(result).toEqual({ result: 'stale', status: 'queued', currentDispatchGeneration: 2 });
    expect(applySpy).not.toHaveBeenCalled();
  });

  it('3. same outcome on same generation → duplicate, no write', async () => {
    const deps = mockDeps({ state: { status: 'sent', dispatchGeneration: 1 } });
    const applySpy = vi.spyOn(deps.stateReader, 'applyOutcome');
    const useCase = new ApplyMailDeliveryOutcomeUseCase(deps);
    const result = await useCase.execute(baseInput);
    expect(result).toEqual({ result: 'duplicate', status: 'sent' });
    expect(applySpy).not.toHaveBeenCalled();
  });

  it('4. accepted/queued + matching generation → applied via conditional write', async () => {
    const deps = mockDeps({ state: { status: 'queued', dispatchGeneration: 1 } });
    const applySpy = vi.spyOn(deps.stateReader, 'applyOutcome');
    const useCase = new ApplyMailDeliveryOutcomeUseCase(deps);
    const result = await useCase.execute({
      ...baseInput,
      outcome: 'failed' as const,
      errorClass: 'provider_rejected',
    });
    expect(result).toEqual({ result: 'applied', status: 'failed' });
    expect(applySpy).toHaveBeenCalledOnce();
  });

  it('5. terminal state with different outcome → stale (never regress)', async () => {
    const deps = mockDeps({ state: { status: 'sent', dispatchGeneration: 1 } });
    const applySpy = vi.spyOn(deps.stateReader, 'applyOutcome');
    const useCase = new ApplyMailDeliveryOutcomeUseCase(deps);
    const result = await useCase.execute({
      ...baseInput,
      outcome: 'failed' as const,
      errorClass: 'system_error',
    });
    expect(result).toEqual({ result: 'stale', status: 'sent', currentDispatchGeneration: 1 });
    expect(applySpy).not.toHaveBeenCalled();
  });

  it('conditional write lost the race → stale, never fake applied', async () => {
    const deps = mockDeps({
      state: { status: 'queued', dispatchGeneration: 1 },
      applyResult: false,
    });
    const useCase = new ApplyMailDeliveryOutcomeUseCase(deps);
    const result = await useCase.execute(baseInput);
    expect(result.result).toBe('stale');
  });

  it('invalid generation shape → not-found (fail closed)', async () => {
    const useCase = new ApplyMailDeliveryOutcomeUseCase(mockDeps());
    const result = await useCase.execute({ ...baseInput, dispatchGeneration: 0 });
    expect(result).toEqual({ result: 'not-found' });
  });
});
