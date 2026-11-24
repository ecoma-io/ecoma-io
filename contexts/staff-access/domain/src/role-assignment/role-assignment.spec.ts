/**
 * Ghim invariants của aggregate `RoleAssignment`: cửa sổ hiệu lực, revocation
 * một chiều, self-elevation bị chặn, read-time filter `isInEffectAt`.
 */

import { createStaffId } from '../staff/staff-id';
import type { StaffId } from '../staff/staff-id';
import type { RoleId } from '../role/role';
import { RoleAssignment } from './role-assignment';
import type { RoleAssignmentId } from './role-assignment';

const ASSIGNMENT_ID = 'ra-1' as RoleAssignmentId,
  NOW = 1_700_000_000_000,
  OTHER = createStaffId('c'.repeat(32)),
  ROLE = 'role-1' as RoleId,
  STAFF = createStaffId('a'.repeat(32));

function assignment(
  overrides: Partial<Parameters<typeof RoleAssignment.assign>[0]> = {},
): RoleAssignment {
  return RoleAssignment.assign({
    grantedBy: OTHER,
    id: ASSIGNMENT_ID,
    now: NOW,
    roleId: ROLE,
    staffId: STAFF,
    ...overrides,
  });
}

describe('roleAssignment.assign', () => {
  it('creates an open-ended assignment in effect immediately', () => {
    expect.hasAssertions();
    const a = assignment();
    expect(a.revokedAt()).toBeNull();
    expect(a.isInEffectAt(NOW)).toBe(true);
    expect(a.grantedBy()).toBe(OTHER);
    expect(a.scope()).toBeNull();
  });

  it('rejects an inverted effective window (CHECK effective_window)', () => {
    expect.hasAssertions();
    expect(() => assignment({ effectiveFrom: NOW + 100, effectiveUntil: NOW })).toThrow(TypeError);
  });

  it('rejects self-elevation — grantedBy equal to staffId', () => {
    expect.hasAssertions();
    expect(() => assignment({ grantedBy: STAFF })).toThrow(TypeError);
  });

  it('rejects non-finite window timestamps and invalid staff ids', () => {
    expect.hasAssertions();
    expect(() => assignment({ effectiveUntil: Number.NaN })).toThrow(TypeError);
    expect(() => assignment({ staffId: 'staff_bad' as StaffId })).toThrow(TypeError);
    expect(() => assignment({ now: Number.NaN })).toThrow(TypeError);
  });
});

describe('isInEffectAt (read-time filter)', () => {
  it('is false before effectiveFrom and at/after effectiveUntil', () => {
    expect.hasAssertions();
    const a = assignment({ effectiveFrom: NOW + 10, effectiveUntil: NOW + 100 });
    expect(a.isInEffectAt(NOW + 9)).toBeFalsy();
    expect(a.isInEffectAt(NOW + 10)).toBe(true);
    expect(a.isInEffectAt(NOW + 99)).toBe(true);
    // Boundary: effectiveUntil chính xác là hết hạn (điều kiện `>` ngoài).
    expect(a.isInEffectAt(NOW + 100)).toBeFalsy();
  });

  it('is false once revoked regardless of the natural window', () => {
    expect.hasAssertions();
    const a = assignment({ effectiveUntil: NOW + 1000 });
    a.revoke(NOW + 1);
    expect(a.isInEffectAt(NOW + 2)).toBeFalsy();
  });

  it('rejects non-finite now', () => {
    expect.hasAssertions();
    expect(() => assignment().isInEffectAt(Number.NaN)).toThrow(TypeError);
  });
});

describe('revoke (one-way UPDATE, not DELETE)', () => {
  it('sets revokedAt once; re-revoke is invalid_transition; no un-revoke', () => {
    expect.hasAssertions();
    const a = assignment();
    expect(a.revoke(NOW + 1)).toBeUndefined();
    expect(a.isRevoked()).toBe(true);
    expect(a.revokedAt()).toBe(NOW + 1);
    expect(a.revoke(NOW + 2)?.code).toBe('invalid_transition');
    expect(a.revokedAt()).toBe(NOW + 1);
  });
});

describe('roleAssignment.reconstitute', () => {
  it('round-trips an active assignment with a full window', () => {
    expect.hasAssertions();
    const a = assignment({ effectiveFrom: NOW, effectiveUntil: NOW + 100, scope: { team: 'sre' } });
    expect(RoleAssignment.reconstitute(a.snapshot()).snapshot()).toStrictEqual(a.snapshot());
  });

  it('round-trips a revoked assignment', () => {
    expect.hasAssertions();
    const a = assignment();
    a.revoke(NOW + 1);
    expect(RoleAssignment.reconstitute(a.snapshot()).snapshot()).toStrictEqual(a.snapshot());
  });

  it('rejects corrupt snapshots', () => {
    expect.hasAssertions();
    const base = assignment().snapshot();
    expect(() =>
      RoleAssignment.reconstitute({ ...base, effectiveFrom: NOW + 50, effectiveUntil: NOW }),
    ).toThrow(TypeError);
    expect(() => RoleAssignment.reconstitute({ ...base, revokedAt: base.createdAt - 1 })).toThrow(
      TypeError,
    );
    expect(() => RoleAssignment.reconstitute({ ...base, grantedBy: base.staffId })).toThrow(
      TypeError,
    );
    expect(() => RoleAssignment.reconstitute({ ...base, staffId: 'staff_x' as never })).toThrow(
      TypeError,
    );
    expect(() => RoleAssignment.reconstitute({ ...base, revokedAt: Number.NaN })).toThrow(
      TypeError,
    );
  });
});
