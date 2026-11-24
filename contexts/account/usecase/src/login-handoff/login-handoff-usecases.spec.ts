import type { Command } from '@ecoma-io/usecase-primitives';

import type { SessionRef } from '@ecoma-io/account-domain';

import { FixedClock } from '../testing/fixed-clock';
import {
  InMemoryLoginHandoffStore,
  boundHandoff,
  fakeHandleHash,
} from '../testing/in-memory-login-handoff-store';
import { InMemoryUnitOfWork } from '../testing/in-memory-unit-of-work';
import {
  BindLoginHandoffUseCase,
  ConsumeLoginHandoffUseCase,
  RotateLoginHandoffBindingUseCase,
} from './login-handoff-usecases';
import type {
  BindLoginHandoff,
  ConsumeLoginHandoff,
  RotateLoginHandoffBinding,
} from './login-handoff-usecases';

function ref(n: number): SessionRef {
  return `ref-${n}` as SessionRef;
}

describe('login handoff contracts', () => {
  it('bindLoginHandoff implements Command', () => {
    type I = Parameters<BindLoginHandoffUseCase['execute']>[0];
    type O = Awaited<ReturnType<BindLoginHandoffUseCase['execute']>>;
    expectTypeOf<BindLoginHandoff>().toExtend<Command<I, O>>();
  });

  it('rotateLoginHandoffBinding implements Command', () => {
    type I = Parameters<RotateLoginHandoffBindingUseCase['execute']>[0];
    type O = Awaited<ReturnType<RotateLoginHandoffBindingUseCase['execute']>>;
    expectTypeOf<RotateLoginHandoffBinding>().toExtend<Command<I, O>>();
  });

  it('consumeLoginHandoff implements Command', () => {
    type I = Parameters<ConsumeLoginHandoffUseCase['execute']>[0];
    type O = Awaited<ReturnType<ConsumeLoginHandoffUseCase['execute']>>;
    expectTypeOf<ConsumeLoginHandoff>().toExtend<Command<I, O>>();
  });
});

describe('BindLoginHandoffUseCase', () => {
  it('binds first and wins', async () => {
    expect.hasAssertions();
    const handoffs = new InMemoryLoginHandoffStore(),
      clock = new FixedClock(1000),
      useCase = new BindLoginHandoffUseCase({ clock, handoffs }),
      result = await useCase.execute({ handleHash: fakeHandleHash(1), sessionRef: ref(1) });
    expect(result).toStrictEqual({ won: true });
  });

  it('loses binding to the earlier session — comparison only, no overwrite', async () => {
    expect.hasAssertions();
    const handoffs = new InMemoryLoginHandoffStore(),
      clock = new FixedClock(1000),
      useCase = new BindLoginHandoffUseCase({ clock, handoffs });
    await useCase.execute({ handleHash: fakeHandleHash(1), sessionRef: ref(1) });

    const result = await useCase.execute({ handleHash: fakeHandleHash(1), sessionRef: ref(2) });
    expect(result).toStrictEqual({ alreadyBound: ref(1) });
    // Binding của session đầu giữ nguyên (FR-006c3).
    expect((await handoffs.findById(fakeHandleHash(1)))?.sessionRef).toBe(ref(1));
  });
});

describe('RotateLoginHandoffBindingUseCase', () => {
  it('carries the binding to the new session', async () => {
    expect.hasAssertions();
    const handoffs = new InMemoryLoginHandoffStore(),
      clock = new FixedClock(1000),
      hash = fakeHandleHash(1);
    handoffs.seed(boundHandoff(hash, ref(1), clock.now()));
    const useCase = new RotateLoginHandoffBindingUseCase({
        clock,
        handoffs,
        unitOfWork: new InMemoryUnitOfWork(),
      }),
      result = await useCase.execute({ handleHash: hash, newSessionRef: ref(2) });
    expect(result).toStrictEqual({ rotated: true });
    const row = await handoffs.findById(hash);
    expect(row?.sessionRef).toBe(ref(2));
    expect(row?.state).toBe('session_rotated');
  });

  it('returns expired for a binding past TTL', async () => {
    expect.hasAssertions();
    const handoffs = new InMemoryLoginHandoffStore(),
      clock = new FixedClock(1000),
      hash = fakeHandleHash(1);
    handoffs.seed(boundHandoff(hash, ref(1), clock.now()));
    clock.advance(601_000);
    const useCase = new RotateLoginHandoffBindingUseCase({
      clock,
      handoffs,
      unitOfWork: new InMemoryUnitOfWork(),
    });

    await expect(
      useCase.execute({ handleHash: hash, newSessionRef: ref(2) }),
    ).resolves.toStrictEqual({
      rejected: 'expired',
    });
  });

  it('returns not_found for an unknown handle', async () => {
    expect.hasAssertions();
    const handoffs = new InMemoryLoginHandoffStore(),
      useCase = new RotateLoginHandoffBindingUseCase({
        clock: new FixedClock(1000),
        handoffs,
        unitOfWork: new InMemoryUnitOfWork(),
      });
    await expect(
      useCase.execute({ handleHash: fakeHandleHash(9), newSessionRef: ref(2) }),
    ).resolves.toStrictEqual({ rejected: 'not_found' });
  });
});

describe('ConsumeLoginHandoffUseCase', () => {
  it('consumes a matched binding', async () => {
    expect.hasAssertions();
    const handoffs = new InMemoryLoginHandoffStore(),
      clock = new FixedClock(1000),
      hash = fakeHandleHash(1);
    handoffs.seed(boundHandoff(hash, ref(1), clock.now()));
    const useCase = new ConsumeLoginHandoffUseCase({ clock, handoffs });

    await expect(useCase.execute({ handleHash: hash, sessionRef: ref(1) })).resolves.toStrictEqual({
      consumed: true,
    });
    expect((await handoffs.findById(hash))?.state).toBe('consumed');
  });

  it('rejects mismatch BEFORE terminal — wrong session first', async () => {
    expect.hasAssertions();
    const handoffs = new InMemoryLoginHandoffStore(),
      clock = new FixedClock(1000),
      hash = fakeHandleHash(1);
    handoffs.seed(boundHandoff(hash, ref(1), clock.now()));
    const useCase = new ConsumeLoginHandoffUseCase({ clock, handoffs });
    // Consume đúng trước → state consumed (terminal).
    await useCase.execute({ handleHash: hash, sessionRef: ref(1) });

    // Sai phiên trên handoff đã terminal: mismatch vẫn thắng thứ tự kiểm tra
    // (khớp checkHandoffBinding của reference).
    await expect(useCase.execute({ handleHash: hash, sessionRef: ref(99) })).resolves.toStrictEqual(
      {
        rejected: 'binding_mismatch',
      },
    );
  });

  it('rejects an expired binding', async () => {
    expect.hasAssertions();
    const handoffs = new InMemoryLoginHandoffStore(),
      clock = new FixedClock(1000),
      hash = fakeHandleHash(1);
    handoffs.seed(boundHandoff(hash, ref(1), clock.now()));
    clock.advance(601_000);
    const useCase = new ConsumeLoginHandoffUseCase({ clock, handoffs });

    await expect(useCase.execute({ handleHash: hash, sessionRef: ref(1) })).resolves.toStrictEqual({
      rejected: 'expired',
    });
  });

  it('treats an unknown handle as mismatch — no oracle', async () => {
    expect.hasAssertions();
    const handoffs = new InMemoryLoginHandoffStore(),
      useCase = new ConsumeLoginHandoffUseCase({ clock: new FixedClock(1000), handoffs });
    await expect(
      useCase.execute({ handleHash: fakeHandleHash(8), sessionRef: ref(1) }),
    ).resolves.toStrictEqual({
      rejected: 'binding_mismatch',
    });
  });
});
