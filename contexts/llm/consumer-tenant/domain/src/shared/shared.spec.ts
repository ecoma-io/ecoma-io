/**
 * Các guard trong `shared.ts` phải thả quyền cho kernel tenant
 * (`@ecoma-io/tenant-kernel-domain`): cùng ngữ nghĩa, không chồng chéo
 * implementation riêng của bounded context này.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_OPAQUE_ID_LENGTH,
  createPermissionId,
  isEpochMillis,
  isPermissionId,
  isTenantActorId,
  isTenantId,
} from './shared';

describe('shared guards delegate to @ecoma-io/tenant-kernel-domain', () => {
  it('MAX_OPAQUE_ID_LENGTH stays 200', () => {
    expect(MAX_OPAQUE_ID_LENGTH).toBe(200);
  });

  it('rejects an opaque id over the limit, padded or empty', () => {
    const overLong = 'a'.repeat(201);
    expect(isTenantId(overLong)).toBe(false);
    expect(isTenantActorId(overLong)).toBe(false);
    expect(isTenantId(' tnt_acme')).toBe(false);
    expect(isTenantActorId(' sub_alice')).toBe(false);
    expect(isTenantId('')).toBe(false);
    expect(isTenantActorId('')).toBe(false);
  });

  it('accepts valid opaque ids', () => {
    expect(isTenantId('tnt_acme')).toBe(true);
    expect(isTenantActorId('sub_alice')).toBe(true);
  });

  it('isEpochMillis rejects strings and unsafe numbers', () => {
    expect(isEpochMillis('1700000000000')).toBe(false);
    expect(isEpochMillis(Number.NaN)).toBe(false);
    expect(isEpochMillis(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isEpochMillis(2 ** 53)).toBe(false);
    expect(isEpochMillis(1.5)).toBe(false);
    expect(isEpochMillis(null)).toBe(false);
    expect(isEpochMillis(1_700_000_000_000)).toBe(true);
  });

  it('accepts unicode opaque ids but rejects padded ones', () => {
    expect(isTenantId('tnt_khách_hàng')).toBe(true);
    expect(isTenantActorId('sub_khách_hàng')).toBe(true);
    expect(isTenantId('tnt_khách ')).toBe(false);
    expect(isTenantActorId(' sub_khách')).toBe(false);
  });
});

describe('PermissionId (dot-style domain.action)', () => {
  it('accepts multi-level action names and single-letter segments', () => {
    expect(isPermissionId('billing.manage')).toBe(true);
    expect(isPermissionId('workspace.settings.update')).toBe(true);
    expect(isPermissionId('a.b')).toBe(true);
  });

  it('rejects wildcards, wrong case, and missing or extra separators', () => {
    expect(isPermissionId('*')).toBe(false);
    expect(isPermissionId('billing.*')).toBe(false);
    expect(isPermissionId('Workspace.Read')).toBe(false);
    expect(isPermissionId('billing')).toBe(false);
    expect(isPermissionId('.manage')).toBe(false);
    expect(isPermissionId('billing.')).toBe(false);
    expect(isPermissionId('billing..manage')).toBe(false);
    expect(isPermissionId('1billing.manage')).toBe(false);
  });

  it('rejects ids over the opaque-id length limit', () => {
    expect(isPermissionId(`a.${'b'.repeat(200)}`)).toBe(false);
  });

  it('createPermissionId throws a TypeError on a malformed identifier', () => {
    expect(() => createPermissionId('Not.Valid')).toThrow(TypeError);
    expect(() => createPermissionId('billing.manage')).not.toThrow();
  });
});
