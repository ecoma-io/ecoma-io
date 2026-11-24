/**
 * Ghim workspace thuộc đúng một tenant, và mọi tra cứu workspace xuyên tenant
 * fail closed.
 */

import { describe, expect, it } from 'vitest';

import { createTenantId, createWorkspaceId, type WorkspaceId } from '../shared/shared';
import {
  Workspace,
  assertWorkspaceBelongsToTenant,
  createWorkspace,
  findWorkspace,
  type WorkspaceSnapshot,
} from './workspace';

const CREATED_AT = 1_775_000_000_000;

const acmeMain: WorkspaceSnapshot = (() => {
  const result = createWorkspace({
    id: 'wsp_main',
    tenantId: 'tnt_acme',
    name: 'Main',
    createdAt: CREATED_AT,
  });
  if (!result.ok) {
    throw new Error('fixture is invalid');
  }
  return result.value;
})();

const otherMain: WorkspaceSnapshot = (() => {
  const result = createWorkspace({
    id: 'wsp_main',
    tenantId: 'tnt_other',
    name: 'Main',
    createdAt: CREATED_AT,
  });
  if (!result.ok) {
    throw new Error('fixture is invalid');
  }
  return result.value;
})();

describe('workspace ownership', () => {
  it('binds every workspace to exactly one tenant', () => {
    expect(acmeMain.tenantId).toBe('tnt_acme');
    expect(Object.hasOwn(acmeMain, 'status')).toBe(false);
  });

  it('rejects a duplicate workspace id inside the same tenant', () => {
    expect(
      createWorkspace(
        { id: 'wsp_main', tenantId: 'tnt_acme', name: 'Other', createdAt: CREATED_AT },
        [acmeMain],
      ),
    ).toMatchObject({ ok: false, error: { code: 'duplicate_workspace_id' } });
  });

  it('rejects a mixed-tenant workspace set instead of guessing the tenant', () => {
    expect(
      createWorkspace({ id: 'wsp_new', tenantId: 'tnt_acme', name: 'New', createdAt: CREATED_AT }, [
        acmeMain,
        otherMain,
      ]),
    ).toMatchObject({ ok: false, error: { code: 'inconsistent_context' } });
  });

  it('does not let two tenants share one workspace row', () => {
    // Cùng `workspaceId` nhưng khác tenant: tra cứu phải trả đúng bản ghi của
    // tenant đang chọn và không thấy bản ghi của tenant kia.
    const found = findWorkspace(
      [acmeMain, otherMain],
      createTenantId('tnt_acme'),
      'wsp_main' as WorkspaceId,
    );
    expect(found).toBe(acmeMain);
    expect(
      findWorkspace([acmeMain], createTenantId('tnt_other'), 'wsp_main' as WorkspaceId),
    ).toBeUndefined();
  });
});

describe('cross-tenant reference rejection', () => {
  it('fails closed when the workspace belongs to another tenant', () => {
    expect(
      assertWorkspaceBelongsToTenant(
        [otherMain],
        createTenantId('tnt_acme'),
        createWorkspaceId('wsp_main'),
      ),
    ).toMatchObject({ ok: false, error: { code: 'workspace_not_in_tenant' } });
  });

  it('fails closed when the workspace does not exist at all', () => {
    expect(
      assertWorkspaceBelongsToTenant(
        [acmeMain],
        createTenantId('tnt_acme'),
        createWorkspaceId('wsp_ghost'),
      ),
    ).toMatchObject({ ok: false, error: { code: 'workspace_not_in_tenant' } });
  });

  it('accepts a workspace that belongs to the selected tenant', () => {
    const result = assertWorkspaceBelongsToTenant(
      [acmeMain],
      createTenantId('tnt_acme'),
      createWorkspaceId('wsp_main'),
    );
    expect(result).toMatchObject({ ok: true, value: { id: 'wsp_main', tenantId: 'tnt_acme' } });
  });
});

describe('Workspace aggregate', () => {
  it('issue creates a workspace bound to one tenant and reuses createWorkspace rules', () => {
    const result = Workspace.issue({
      id: 'wsp_agg',
      tenantId: 'tnt_acme',
      name: 'Agg',
      createdAt: CREATED_AT,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('fixture is invalid');
    }
    expect(result.value.tenantId()).toBe('tnt_acme');
    // Cùng taxonomy lỗi với đường tạo thuần.
    expect(
      Workspace.issue({ id: '', tenantId: 'tnt_acme', name: 'Agg', createdAt: CREATED_AT }),
    ).toMatchObject({ ok: false, error: { code: 'invalid_workspace_id' } });
  });

  it('snapshot returns the frozen full state', () => {
    const result = Workspace.issue({
      id: 'wsp_agg',
      tenantId: 'tnt_acme',
      name: 'Agg',
      createdAt: CREATED_AT,
    });
    if (!result.ok) {
      throw new Error('fixture is invalid');
    }
    const snapshot = result.value.snapshot();
    expect(snapshot).toEqual({
      id: 'wsp_agg',
      tenantId: 'tnt_acme',
      name: 'Agg',
      createdAt: CREATED_AT,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('reconstitute restores an identical aggregate and rejects a corrupt snapshot', () => {
    const result = Workspace.issue({
      id: 'wsp_agg',
      tenantId: 'tnt_acme',
      name: 'Agg',
      createdAt: CREATED_AT,
    });
    if (!result.ok) {
      throw new Error('fixture is invalid');
    }
    const restored = Workspace.reconstitute(result.value.snapshot());
    expect(restored.snapshot()).toEqual(result.value.snapshot());
    expect(() => Workspace.reconstitute({ ...result.value.snapshot(), name: ' padded ' })).toThrow(
      TypeError,
    );
  });

  it('reconstitute rejects a self-inconsistent snapshot for every invariant field', () => {
    // Mỗi trường bất biến bị hỏng đều bị từ chối, không tin dữ liệu persist.
    for (const corrupt of [
      { ...acmeMain, id: '' },
      { ...acmeMain, tenantId: '' },
      { ...acmeMain, name: '' },
      { ...acmeMain, name: 'a'.repeat(201) },
      { ...acmeMain, createdAt: Number.NaN },
      { ...acmeMain, createdAt: 2 ** 53 },
    ]) {
      expect(() => Workspace.reconstitute(corrupt as WorkspaceSnapshot)).toThrow(TypeError);
    }
  });
});
