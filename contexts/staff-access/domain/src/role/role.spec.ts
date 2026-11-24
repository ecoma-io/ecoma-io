/**
 * Ghim invariants của aggregate `Role`: tập permission hữu hạn (không bypass),
 * retire là terminal, snapshot parity, permission set readonly qua public API.
 */

import { permissionIdFrom } from '../permission/permission-id';
import { Role } from './role';
import type { RoleId, RoleSnapshot } from './role';

const ASSIGN = permissionIdFrom('role.assign'),
  NOW = 1_700_000_000_000,
  READ = permissionIdFrom('staff.read'),
  ROLE_ID = 'role-1' as RoleId;

function role(): Role {
  return Role.define({
    id: ROLE_ID,
    kind: 'system',
    name: 'system-administrator',
    now: NOW,
    permissions: [READ],
  });
}

describe('role.define', () => {
  it('starts active with the given permission set', () => {
    expect.hasAssertions();
    const r = role();
    expect(r.state()).toBe('active');
    expect(r.kind()).toBe('system');
    expect(r.permissions()).toStrictEqual([READ]);
    expect(r.hasPermission(READ)).toBe(true);
    expect(r.hasPermission(ASSIGN)).toBeFalsy();
  });

  it('rejects invalid name, kind, permission and now', () => {
    expect.hasAssertions();
    expect(() =>
      Role.define({ id: ROLE_ID, kind: 'system', name: '', now: NOW, permissions: [] }),
    ).toThrow(TypeError);
    expect(() =>
      Role.define({ id: ROLE_ID, kind: 'bogus' as never, name: 'x', now: NOW, permissions: [] }),
    ).toThrow(TypeError);
    expect(() =>
      Role.define({
        id: ROLE_ID,
        kind: 'system',
        name: 'x',
        now: NOW,
        permissions: ['STAFF.READ' as never],
      }),
    ).toThrow(TypeError);
    expect(() =>
      Role.define({ id: ROLE_ID, kind: 'system', name: 'x', now: Number.NaN, permissions: [] }),
    ).toThrow(TypeError);
  });
});

describe('role permission set', () => {
  it('grants and revokes permissions through named behavior only', () => {
    expect.hasAssertions();
    const r = role();
    expect(r.grantPermission(ASSIGN)).toBeUndefined();
    expect(r.hasPermission(ASSIGN)).toBe(true);
    expect(r.revokePermission(ASSIGN)).toBeUndefined();
    expect(r.hasPermission(ASSIGN)).toBeFalsy();
  });

  it('returns a readonly view — mutating the copy does not affect the aggregate', () => {
    expect.hasAssertions();
    const r = role(),
      view = r.permissions() as unknown as PermissionIdMutator;
    // Bản copy: tác động không lan vào aggregate
    view.push(ASSIGN);
    expect(r.permissions()).toStrictEqual([READ]);
    expect(r.hasPermission(ASSIGN)).toBeFalsy();
  });

  it('rejects permission mutation after retire', () => {
    expect.hasAssertions();
    const r = role();
    r.retire(NOW + 1);
    expect(r.grantPermission(ASSIGN)?.code).toBe('invalid_transition');
    expect(r.revokePermission(READ)?.code).toBe('invalid_transition');
  });
});

describe('role lifecycle', () => {
  it('retire is terminal', () => {
    expect.hasAssertions();
    const r = role();
    expect(r.retire(NOW + 1)).toBeUndefined();
    expect(r.isRetired()).toBe(true);
    expect(r.retiredAt()).toBe(NOW + 1);
    expect(r.retire(NOW + 2)?.code).toBe('invalid_transition');
  });
});

describe('role.reconstitute', () => {
  it('round-trips an active role', () => {
    expect.hasAssertions();
    const r = role();
    expect(Role.reconstitute(r.snapshot()).snapshot()).toStrictEqual(r.snapshot());
  });

  it('round-trips a retired role', () => {
    expect.hasAssertions();
    const r = role();
    r.retire(NOW + 1);
    expect(Role.reconstitute(r.snapshot()).snapshot()).toStrictEqual(r.snapshot());
  });

  it('rejects corrupt snapshots', () => {
    expect.hasAssertions();
    const base = role().snapshot();
    // Runtime payload from a corrupt row can carry undefined despite the snapshot type.
    expect(() =>
      Role.reconstitute({
        ...base,
        retiredAt: undefined,
        state: 'retired',
      } as unknown as RoleSnapshot),
    ).toThrow(TypeError);
    expect(() => Role.reconstitute({ ...base, retiredAt: base.createdAt - 1 })).toThrow(TypeError);
    expect(() => Role.reconstitute({ ...base, permissions: ['no dot' as never] })).toThrow(
      TypeError,
    );
    expect(() => Role.reconstitute({ ...base, name: '' })).toThrow(TypeError);
  });
});

interface PermissionIdMutator {
  push(p: unknown): number;
}
