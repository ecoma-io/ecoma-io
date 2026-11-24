/**
 * Ghim invariants của aggregate `Staff`: lifecycle active⇄suspended→terminated,
 * terminated terminal, AccountSubject bất biến, snapshot pair-parity.
 */

import { createStaffId } from './staff-id';
import type { StaffId } from './staff-id';
import { accountSubjectFrom } from './account-subject';
import { Staff } from './staff';
import type { StaffSnapshot } from './staff';

const NOW = 1_700_000_000_000,
  STAFF_ID = createStaffId('a'.repeat(32)),
  SUB = accountSubjectFrom(`sub_${'b'.repeat(32)}`);

function staff(): Staff {
  return Staff.create({ accountSubject: SUB, displayName: 'Nguyen Van A', id: STAFF_ID, now: NOW });
}

describe('staff.create', () => {
  it('starts active with null transition timestamps', () => {
    expect.hasAssertions();
    const s = staff();
    expect(s.status()).toBe('active');
    expect(s.suspendedAt()).toBeNull();
    expect(s.terminatedAt()).toBeNull();
    expect(s.accountSubject()).toBe(SUB);
    expect(s.createdAt()).toBe(NOW);
  });

  it('rejects invalid staffId, accountSubject, displayName and now', () => {
    expect.hasAssertions();
    expect(() =>
      Staff.create({
        accountSubject: SUB,
        displayName: 'x',
        id: 'staff_short' as StaffId,
        now: NOW,
      }),
    ).toThrow(TypeError);
    expect(() =>
      Staff.create({
        accountSubject: `sub_${'b'.repeat(31)}`,
        displayName: 'x',
        id: STAFF_ID,
        now: NOW,
      }),
    ).toThrow(TypeError);
    expect(() =>
      Staff.create({ accountSubject: SUB, displayName: 'x'.repeat(201), id: STAFF_ID, now: NOW }),
    ).toThrow(TypeError);
    expect(() =>
      Staff.create({ accountSubject: SUB, displayName: 'x', id: STAFF_ID, now: Number.NaN }),
    ).toThrow(TypeError);
  });
});

describe('staff lifecycle', () => {
  it('suspend → reactivate → suspend → terminate', () => {
    expect.hasAssertions();
    const s = staff();
    expect(s.suspend(NOW + 1)).toBeUndefined();
    expect(s.status()).toBe('suspended');
    expect(s.suspendedAt()).toBe(NOW + 1);
    expect(s.reactivate(NOW + 2)).toBeUndefined();
    expect(s.status()).toBe('active');
    expect(s.suspendedAt()).toBeNull();
    expect(s.suspend(NOW + 3)).toBeUndefined();
    expect(s.terminate(NOW + 4)).toBeUndefined();
    expect(s.isTerminated()).toBe(true);
    expect(s.terminatedAt()).toBe(NOW + 4);
  });

  it('terminate is terminal — no transition out', () => {
    expect.hasAssertions();
    const s = staff();
    s.terminate(NOW + 1);
    expect(s.reactivate(NOW + 2)?.code).toBe('invalid_transition');
    expect(s.suspend(NOW + 2)?.code).toBe('invalid_transition');
    // Terminate lần nữa cũng không — terminal không có đường ra.
    expect(s.terminate(NOW + 2)?.code).toBe('staff_terminated');
    expect(s.status()).toBe('terminated');
  });

  it('suspended → suspended is idempotent; active → active is idempotent', () => {
    expect.hasAssertions();
    const s = staff();
    expect(s.suspend(NOW)).toBeUndefined();
    expect(s.suspend(NOW + 1)).toBeUndefined();
    expect(s.reactivate(NOW + 2)).toBeUndefined();
    expect(s.reactivate(NOW + 3)).toBeUndefined();
  });

  it('rejects non-finite now without mutating state', () => {
    expect.hasAssertions();
    const s = staff();
    expect(() => s.suspend(Number.NaN)).toThrow(TypeError);
    expect(s.status()).toBe('active');
  });

  it('rename works while active and fails with staff_terminated once terminated', () => {
    expect.hasAssertions();
    const s = staff();
    expect(s.rename('New Name', NOW + 1)).toBeUndefined();
    expect(s.displayName()).toBe('New Name');
    s.terminate(NOW + 2);
    expect(s.rename('Another', NOW + 3)?.code).toBe('staff_terminated');
  });
});

describe('staff.reconstitute round-trip', () => {
  it('round-trips a suspended snapshot', () => {
    expect.hasAssertions();
    const s = staff();
    s.suspend(NOW + 1);
    const back = Staff.reconstitute(s.snapshot());
    expect(back.snapshot()).toStrictEqual(s.snapshot());
  });

  it('round-trips a terminated-after-suspended snapshot', () => {
    expect.hasAssertions();
    const s = staff();
    s.suspend(NOW + 1);
    s.terminate(NOW + 2);
    expect(Staff.reconstitute(s.snapshot()).snapshot()).toStrictEqual(s.snapshot());
  });

  it('keeps identity equality via StaffId', () => {
    expect.hasAssertions();
    const a = staff(),
      b = Staff.reconstitute(a.snapshot());
    expect(a.equals(b)).toBe(true);
  });
});

describe('staff.reconstitute rejects corrupt snapshots', () => {
  it('rejects corrupt snapshots', () => {
    expect.hasAssertions();
    const base = staff().snapshot();
    expect(() => Staff.reconstitute({ ...base, status: 'deleted' as never })).toThrow(TypeError);
    expect(() =>
      // Runtime payload from a corrupt row can carry undefined despite the snapshot type.
      Staff.reconstitute({
        ...base,
        status: 'suspended',
        suspendedAt: undefined,
      } as unknown as StaffSnapshot),
    ).toThrow(TypeError);
    expect(() =>
      Staff.reconstitute({
        ...base,
        status: 'terminated',
        terminatedAt: undefined,
      } as unknown as StaffSnapshot),
    ).toThrow(TypeError);
    expect(() => Staff.reconstitute({ ...base, status: 'active', suspendedAt: NOW })).toThrow(
      TypeError,
    );
    expect(() => Staff.reconstitute({ ...base, createdAt: Number.NaN })).toThrow(TypeError);
    expect(() =>
      Staff.reconstitute({ ...base, status: 'suspended', suspendedAt: base.createdAt - 1 }),
    ).toThrow(TypeError);
    expect(() =>
      Staff.reconstitute({ ...base, status: 'terminated', terminatedAt: base.createdAt - 1 }),
    ).toThrow(TypeError);
    expect(() =>
      Staff.reconstitute({
        ...base,
        status: 'terminated',
        suspendedAt: NOW + 6,
        terminatedAt: NOW + 5,
      }),
    ).toThrow(TypeError);
    expect(() => Staff.reconstitute({ ...base, accountSubject: 'not-a-sub' as never })).toThrow(
      TypeError,
    );
  });
});
