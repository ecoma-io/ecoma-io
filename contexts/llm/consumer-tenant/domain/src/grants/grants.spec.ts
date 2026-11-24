/**
 * Ghim quy tắc grant: cấp trực tiếp cho một membership active, đúng một scope,
 * không trùng lặp, không trỏ workspace của tenant khác, và grant của một lần
 * membership đã revoke không áp cho lần membership mới.
 */

import { describe, expect, it } from 'vitest';

import {
  createMembershipId,
  createPermissionId,
  createTenantId,
  createWorkspaceId,
  type MembershipId,
  type PermissionId,
  type WorkspaceId,
} from '../shared/shared';
import {
  provisionMembership,
  revokeMembership,
  type MembershipSnapshot,
} from '../membership/membership';
import { createWorkspace, type WorkspaceSnapshot } from '../workspace/workspace';
import {
  createGrant,
  isGrantEffectiveForMembership,
  isPermissionGrant,
  revokeGrant,
  type GrantIssuanceContext,
  type PermissionGrant,
} from '../grants/grants';

const CREATED_AT = 1_775_000_000_000;
const REVOKED_AT = CREATED_AT + 1_000;

function membership(
  id = 'mbr_acme_alice',
  actor = 'sub_alice',
  tenantId = 'tnt_acme',
): MembershipSnapshot {
  const result = provisionMembership({ id, tenantId, actor, createdAt: CREATED_AT });
  if (!result.ok) {
    throw new Error('fixture is invalid');
  }
  return result.value;
}

function workspace(id: string, tenantId = 'tnt_acme'): WorkspaceSnapshot {
  const result = createWorkspace({ id, tenantId, name: `ws ${id}`, createdAt: CREATED_AT });
  if (!result.ok) {
    throw new Error('fixture is invalid');
  }
  return result.value;
}

const ALICE_MEMBERSHIP = membership();
const MAIN = workspace('wsp_main');
const SIBLING = workspace('wsp_sibling');

function context(overrides: Partial<GrantIssuanceContext> = {}): GrantIssuanceContext {
  return {
    memberships: [ALICE_MEMBERSHIP],
    workspaces: [MAIN, SIBLING],
    grants: [],
    ...overrides,
  };
}

function tenantGrant(): PermissionGrant {
  const result = createGrant(
    {
      tenantId: 'tnt_acme',
      membershipId: ALICE_MEMBERSHIP.id,
      permission: 'workspace.read',
      scope: { kind: 'tenant' },
      grantedAt: CREATED_AT,
    },
    context(),
  );
  if (!result.ok) {
    throw new Error('fixture is invalid');
  }
  return result.value;
}

describe('grant issuance', () => {
  it('grants a tenant-scoped permission directly to an active membership', () => {
    const result = createGrant(
      {
        tenantId: 'tnt_acme',
        membershipId: ALICE_MEMBERSHIP.id,
        permission: 'workspace.read',
        scope: { kind: 'tenant' },
        grantedAt: CREATED_AT,
      },
      context(),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { scope: { kind: 'tenant' }, membershipId: 'mbr_acme_alice' },
    });
    expect(result.ok && isPermissionGrant(result.value)).toBe(true);
  });

  it('does not key the grant on the account alone', () => {
    // Grant khoá theo `membershipId`, không theo `sub`: hai lần membership của
    // cùng một `sub` là hai chủ thể quyền độc lập.
    expect(Object.hasOwn(tenantGrant(), 'actor')).toBe(false);
  });

  it('grants a workspace-scoped permission only for a workspace of the same tenant', () => {
    const result = createGrant(
      {
        tenantId: 'tnt_acme',
        membershipId: ALICE_MEMBERSHIP.id,
        permission: 'workspace.read',
        scope: { kind: 'workspace', workspaceId: createWorkspaceId('wsp_main') },
        grantedAt: CREATED_AT,
      },
      context(),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a workspace grant pointing at another tenant workspace', () => {
    const result = createGrant(
      {
        tenantId: 'tnt_acme',
        membershipId: ALICE_MEMBERSHIP.id,
        permission: 'workspace.read',
        scope: { kind: 'workspace', workspaceId: 'wsp_foreign' },
        grantedAt: CREATED_AT,
      },
      context(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'workspace_not_in_tenant' } });
  });

  it('rejects a grant for a membership that does not exist in the tenant', () => {
    expect(
      createGrant(
        {
          tenantId: 'tnt_acme',
          membershipId: 'mbr_acme_ghost',
          permission: 'workspace.read',
          scope: { kind: 'tenant' },
          grantedAt: CREATED_AT,
        },
        context(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'membership_not_found' } });
  });

  it('rejects a grant for a revoked membership', () => {
    const revoked = revokeMembership({
      membership: membership('mbr_acme_carol', 'sub_carol'),
      revokedAt: REVOKED_AT,
    });
    if (!revoked.ok) {
      throw new Error('fixture is invalid');
    }
    expect(
      createGrant(
        {
          tenantId: 'tnt_acme',
          membershipId: revoked.value.id,
          permission: 'workspace.read',
          scope: { kind: 'tenant' },
          grantedAt: CREATED_AT,
        },
        context({ memberships: [revoked.value] }),
      ),
    ).toMatchObject({ ok: false, error: { code: 'membership_not_found' } });
  });

  it('rejects duplicate grants with the same membership, permission and scope', () => {
    const contextWithGrant = context({ grants: [tenantGrant()] });
    expect(
      createGrant(
        {
          tenantId: 'tnt_acme',
          membershipId: ALICE_MEMBERSHIP.id,
          permission: 'workspace.read',
          scope: { kind: 'tenant' },
          grantedAt: CREATED_AT,
        },
        contextWithGrant,
      ),
    ).toMatchObject({ ok: false, error: { code: 'duplicate_grant' } });
  });

  it('keeps tenant-scope and workspace-scope grants as separate scopes', () => {
    const contextWithGrant = context({ grants: [tenantGrant()] });
    const workspaceGrant = createGrant(
      {
        tenantId: 'tnt_acme',
        membershipId: ALICE_MEMBERSHIP.id,
        permission: 'workspace.read',
        scope: { kind: 'workspace', workspaceId: createWorkspaceId('wsp_main') },
        grantedAt: CREATED_AT,
      },
      contextWithGrant,
    );
    expect(workspaceGrant).toMatchObject({
      ok: true,
      value: { scope: { kind: 'workspace', workspaceId: 'wsp_main' } },
    });
  });

  it('treats the same grant on a different membership as a distinct grant', () => {
    const second = membership('mbr_acme_alice_again', 'sub_alice');
    // Chỉ một membership active cho mỗi `(tenant, actor)` — fixture này cố ý
    // dựng tập hỏng để chứng minh khoá trùng lặp là `membershipId`.
    const result = createGrant(
      {
        tenantId: 'tnt_acme',
        membershipId: second.id,
        permission: 'workspace.read',
        scope: { kind: 'tenant' },
        grantedAt: CREATED_AT,
      },
      context({ memberships: [ALICE_MEMBERSHIP, second], grants: [tenantGrant()] }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects unknown scopes, wildcard permissions and malformed identities', () => {
    expect(
      createGrant(
        {
          tenantId: 'tnt_acme',
          membershipId: ALICE_MEMBERSHIP.id,
          permission: 'workspace.read',
          scope: { kind: 'project' },
          grantedAt: CREATED_AT,
        },
        context(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'invalid_permission_policy' } });
    expect(
      createGrant(
        {
          tenantId: 'tnt_acme',
          membershipId: ALICE_MEMBERSHIP.id,
          permission: '*',
          scope: { kind: 'tenant' },
          grantedAt: CREATED_AT,
        },
        context(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'invalid_permission_id' } });
    expect(
      createGrant(
        {
          tenantId: 'tnt_acme',
          membershipId: '',
          permission: 'workspace.read',
          scope: { kind: 'tenant' },
          grantedAt: CREATED_AT,
        },
        context(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'invalid_membership_id' } });
  });

  it('fails closed when the issuance context mixes tenants', () => {
    expect(
      createGrant(
        {
          tenantId: 'tnt_acme',
          membershipId: ALICE_MEMBERSHIP.id,
          permission: 'workspace.read',
          scope: { kind: 'workspace', workspaceId: createWorkspaceId('wsp_other') },
          grantedAt: CREATED_AT,
        },
        context({ workspaces: [MAIN, workspace('wsp_other', 'tnt_other')] }),
      ),
    ).toMatchObject({ ok: false, error: { code: 'inconsistent_context' } });
  });
});

describe('grant effectiveness', () => {
  it('is effective only for the membership it was issued to', () => {
    const grant = tenantGrant();
    expect(isGrantEffectiveForMembership(grant, ALICE_MEMBERSHIP)).toBe(true);
    expect(
      isGrantEffectiveForMembership(grant, {
        ...ALICE_MEMBERSHIP,
        id: createMembershipId('mbr_acme_alice_again'),
      }),
    ).toBe(false);
  });

  it('stops being effective when that membership is revoked', () => {
    const revoked = revokeMembership({ membership: ALICE_MEMBERSHIP, revokedAt: REVOKED_AT });
    if (!revoked.ok) {
      throw new Error('fixture is invalid');
    }
    expect(isGrantEffectiveForMembership(tenantGrant(), revoked.value)).toBe(false);
  });
});

const validBase = () => ({
  tenantId: createTenantId('tnt_acme'),
  membershipId: ALICE_MEMBERSHIP.id,
  permission: createPermissionId('workspace.read'),
  grantedAt: CREATED_AT,
});

describe('grant shape guard', () => {
  it('rejects grants whose scope or membership identity is unreadable', () => {
    expect(
      isPermissionGrant({
        ...validBase(),
        scope: { kind: 'workspace' },
        status: 'active',
        revokedAt: null,
      }),
    ).toBe(false);
    expect(
      isPermissionGrant({
        ...validBase(),
        scope: { kind: 'tenant' },
        status: 'active',
        revokedAt: null,
        membershipId: '' as MembershipId,
      }),
    ).toBe(false);
    expect(
      isPermissionGrant({
        ...validBase(),
        scope: { kind: 'workspace', workspaceId: 'wsp_main' as WorkspaceId },
        status: 'active',
        revokedAt: null,
      }),
    ).toBe(true);
    expect(
      isPermissionGrant({
        ...validBase(),
        scope: { kind: 'tenant' },
        status: 'active',
        revokedAt: null,
        permission: 'Workspace.Read' as PermissionId,
      }),
    ).toBe(false);
  });

  it('rejects grants whose status and revokedAt disagree', () => {
    // Bản active không được mang revokedAt; bản revoked phải mang revokedAt đọc được.
    expect(
      isPermissionGrant({
        ...validBase(),
        scope: { kind: 'tenant' },
        status: 'active',
        revokedAt: REVOKED_AT,
      }),
    ).toBe(false);
    expect(
      isPermissionGrant({
        ...validBase(),
        scope: { kind: 'tenant' },
        status: 'revoked',
        revokedAt: null,
      }),
    ).toBe(false);
    expect(
      isPermissionGrant({
        ...validBase(),
        scope: { kind: 'tenant' },
        status: 'revoked',
        revokedAt: REVOKED_AT,
      }),
    ).toBe(true);
    expect(
      isPermissionGrant({
        ...validBase(),
        scope: { kind: 'tenant' },
        status: 'frozen',
        revokedAt: null,
      }),
    ).toBe(false);
    expect(
      isPermissionGrant({
        ...validBase(),
        scope: { kind: 'tenant' },
        status: 'active',
        revokedAt: null,
        grantedAt: Number.NaN,
      }),
    ).toBe(false);
  });
});

describe('grant revocation', () => {
  it('revokes an active grant and keeps the record as history', () => {
    const grant = tenantGrant();
    const result = revokeGrant({ grant, revokedAt: REVOKED_AT });
    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'revoked',
        revokedAt: REVOKED_AT,
        membershipId: ALICE_MEMBERSHIP.id,
        scope: { kind: 'tenant' },
        grantedAt: CREATED_AT,
      },
    });
    if (!result.ok) {
      throw new Error('fixture is invalid');
    }
    expect(isGrantEffectiveForMembership(result.value, ALICE_MEMBERSHIP)).toBe(false);
    expect(isPermissionGrant(result.value)).toBe(true);
  });

  it('stops counting a revoked grant for authorization effectiveness', () => {
    const grant = tenantGrant();
    expect(isGrantEffectiveForMembership(grant, ALICE_MEMBERSHIP)).toBe(true);
    const revoked = revokeGrant({ grant, revokedAt: REVOKED_AT });
    if (!revoked.ok) {
      throw new Error('fixture is invalid');
    }
    expect(isGrantEffectiveForMembership(revoked.value, ALICE_MEMBERSHIP)).toBe(false);
  });

  it('rejects a second revoke instead of overwriting the original revokedAt', () => {
    const revoked = revokeGrant({ grant: tenantGrant(), revokedAt: REVOKED_AT });
    if (!revoked.ok) {
      throw new Error('fixture is invalid');
    }
    expect(revokeGrant({ grant: revoked.value, revokedAt: REVOKED_AT + 1 })).toMatchObject({
      ok: false,
      error: { code: 'grant_already_revoked' },
    });
  });

  it('rejects a corrupted grant whose status and revokedAt disagree', () => {
    const corrupted = {
      ...tenantGrant(),
      status: 'active' as const,
      revokedAt: REVOKED_AT,
    };
    expect(revokeGrant({ grant: corrupted, revokedAt: REVOKED_AT + 1 })).toMatchObject({
      ok: false,
      error: { code: 'invalid_grant' },
    });
  });

  it('rejects a revoke timestamp before the grant was issued', () => {
    expect(revokeGrant({ grant: tenantGrant(), revokedAt: CREATED_AT - 1 })).toMatchObject({
      ok: false,
      error: { code: 'invalid_timestamp' },
    });
  });

  it('rejects unreadable revoke timestamps and grant records', () => {
    for (const bad of [undefined, null, Number.NaN, 1.5, 'soon']) {
      expect(revokeGrant({ grant: tenantGrant(), revokedAt: bad })).toMatchObject({
        ok: false,
        error: { code: 'invalid_timestamp' },
      });
    }
    expect(revokeGrant({ grant: null as never, revokedAt: REVOKED_AT })).toMatchObject({
      ok: false,
      error: { code: 'invalid_grant' },
    });
  });

  it('still refuses a duplicate of a revoked grant key but allows re-granting after revoke', () => {
    const revoked = revokeGrant({ grant: tenantGrant(), revokedAt: REVOKED_AT });
    if (!revoked.ok) {
      throw new Error('fixture is invalid');
    }
    // Grant active mới cùng key không còn bị chặn bởi bản đã revoke.
    const regranted = createGrant(
      {
        tenantId: 'tnt_acme',
        membershipId: ALICE_MEMBERSHIP.id,
        permission: 'workspace.read',
        scope: { kind: 'tenant' },
        grantedAt: REVOKED_AT + 1,
      },
      context({ grants: [revoked.value] }),
    );
    expect(regranted).toMatchObject({ ok: true, value: { status: 'active' } });
  });
});
