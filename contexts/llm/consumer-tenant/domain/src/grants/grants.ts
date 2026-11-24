/**
 * Permission grant trực tiếp cho member — không có role entity, không có
 * custom-role administration.
 *
 * Quy ước nguồn: ADR-0001 (independent seller console tenant).
 *
 * Quy tắc scope:
 * - Grant có **đúng một** scope: `tenant` hoặc `workspace`.
 * - **Không có kế thừa ngầm.** Grant tenant scope **không** authorize thao tác
 *   trên một workspace — trừ khi permission đó được khai báo tường minh là
 *   tenant-wide workspace administration (`./authorization.ts`,
 *   `PermissionSemantics`).
 * - Grant workspace scope chỉ áp dụng cho **đúng** workspace đó, và workspace
 *   đó phải thuộc tenant của grant.
 *
 * Grant trỏ tới **một lần membership cụ thể** (`membershipId`), không chỉ tới
 * `sub`:
 * - Revoke membership làm mọi grant của lần đó mất hiệu lực ở đường
 *   authorization, và provision lại tạo `id` mới nên grant cũ **không** sống
 *   lại. Nếu grant chỉ khoá theo `sub`, revoke rồi provision lại sẽ khôi phục
 *   quyền cũ mà không có quyết định cấp quyền mới — đây là lý do membershipId
 *   là một phần danh tính của grant.
 * - Grant chỉ cấp cho membership **active** trong cùng tenant. Owner không cần
 *   grant: quyền owner là quan hệ riêng trên tenant.
 *
 * Grant có trạng thái vòng đời riêng: `active → revoked` (terminal). Thu hồi
 * là một operation của domain ({@link revokeGrant}), không phải xoá bản ghi ở
 * tầng application — bản ghi revoked nằm lại làm lịch sử audit và không còn
 * authorize. Cấp lại sau revoke là một grant **mới** qua {@link createGrant}.
 */

import {
  isEpochMillis,
  isMembershipId,
  isPermissionId,
  isTenantId,
  isWorkspaceId,
  llmTenantFailure,
  llmTenantOk,
  type LlmTenantResult,
  type MembershipId,
  type PermissionId,
  type TenantId,
  type WorkspaceId,
} from '../shared/shared';
import { isMembershipActive, type MembershipSnapshot } from '../membership/membership';
import { findWorkspace, type WorkspaceSnapshot } from '../workspace/workspace';

/** Scope tenant: áp dụng cho chính tenant, không cho workspace cụ thể. */
export interface TenantGrantScope {
  readonly kind: 'tenant';
}

/** Scope workspace: áp dụng cho đúng một workspace. */
export interface WorkspaceGrantScope {
  readonly kind: 'workspace';
  readonly workspaceId: WorkspaceId;
}

/** Scope của một grant. */
export type GrantScope = TenantGrantScope | WorkspaceGrantScope;

/**
 * Trạng thái grant — transition duy nhất là `active → revoked`, và `revoked` là
 * terminal (không có đường khôi phục; cấp lại là một grant mới qua
 * {@link createGrant}).
 */
export type PermissionGrantStatus = 'active' | 'revoked';

/** Một permission grant trực tiếp cho một membership trong một tenant. */
export interface PermissionGrant {
  readonly tenantId: TenantId;
  readonly membershipId: MembershipId;
  readonly permission: PermissionId;
  readonly scope: GrantScope;
  readonly status: PermissionGrantStatus;
  readonly grantedAt: number;
  readonly revokedAt: number | null;
}

/** Input tạo grant. */
export interface CreateGrantInput {
  readonly tenantId: unknown;
  readonly membershipId: unknown;
  readonly permission: unknown;
  readonly scope: unknown;
  readonly grantedAt: unknown;
}

/** Bối cảnh cần để kiểm grant mới có hợp lệ không. */
export interface GrantIssuanceContext {
  /** Membership của **cùng tenant**. */
  readonly memberships: readonly MembershipSnapshot[];
  /** Workspace của **cùng tenant**. */
  readonly workspaces: readonly WorkspaceSnapshot[];
  /** Grant hiện có của **cùng tenant**. */
  readonly grants: readonly PermissionGrant[];
}

function isGrantScope(value: unknown): value is GrantScope {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const scope = value as { kind?: unknown; workspaceId?: unknown };
  if (scope.kind === 'tenant') {
    return !Object.hasOwn(scope, 'workspaceId');
  }
  return scope.kind === 'workspace' && isWorkspaceId(scope.workspaceId);
}

function sameScope(left: GrantScope, right: GrantScope): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  return left.kind === 'tenant' || left.workspaceId === (right as WorkspaceGrantScope).workspaceId;
}

/**
 * Tạo một permission grant.
 *
 * Từ chối khi:
 * - định danh/permission/scope/timestamp không đọc được (`invalid_*`,
 *   `invalid_permission_id`);
 * - bối cảnh lẫn tenant khác (`inconsistent_context`);
 * - membership không tồn tại hoặc không active (`membership_not_found`);
 * - grant workspace scope trỏ tới workspace không thuộc tenant
 *   (`workspace_not_in_tenant`);
 * - đã tồn tại grant **active** cùng `(membershipId, permission, scope)`
 *   (`duplicate_grant`) — trùng lặp là dữ liệu mâu thuẫn, không âm thầm
 *   idempotent. Grant đã revoke không chặn cấp lại: bản mới có `grantedAt`
 *   riêng và giữ lịch sử.
 *
 * Grant của hai membership khác nhau (dù cùng `sub`) không phải trùng lặp:
 * chúng thuộc hai lần membership khác nhau và có hiệu lực độc lập.
 */
export function createGrant(
  input: CreateGrantInput,
  context: GrantIssuanceContext,
): LlmTenantResult<PermissionGrant> {
  if (!isTenantId(input.tenantId)) {
    return llmTenantFailure('invalid_tenant_id');
  }
  if (!isMembershipId(input.membershipId)) {
    return llmTenantFailure('invalid_membership_id');
  }
  if (!isPermissionId(input.permission)) {
    return llmTenantFailure('invalid_permission_id');
  }
  if (!isGrantScope(input.scope)) {
    return llmTenantFailure('invalid_permission_policy');
  }
  if (!isEpochMillis(input.grantedAt)) {
    return llmTenantFailure('invalid_timestamp');
  }
  if (
    context.memberships.some((membership) => membership.tenantId !== input.tenantId) ||
    context.workspaces.some((workspace) => workspace.tenantId !== input.tenantId) ||
    context.grants.some((grant) => grant.tenantId !== input.tenantId)
  ) {
    return llmTenantFailure('inconsistent_context');
  }

  const membership = context.memberships.find(
    (candidate) => candidate.id === input.membershipId && candidate.tenantId === input.tenantId,
  );
  if (membership === undefined || !isMembershipActive(membership)) {
    return llmTenantFailure('membership_not_found');
  }

  if (
    input.scope.kind === 'workspace' &&
    findWorkspace(context.workspaces, input.tenantId, input.scope.workspaceId) === undefined
  ) {
    return llmTenantFailure('workspace_not_in_tenant');
  }

  const duplicated = context.grants.some(
    (grant) =>
      grant.status !== 'revoked' &&
      grant.tenantId === input.tenantId &&
      grant.membershipId === input.membershipId &&
      grant.permission === input.permission &&
      sameScope(grant.scope, input.scope as GrantScope),
  );
  if (duplicated) {
    return llmTenantFailure('duplicate_grant');
  }

  return llmTenantOk(
    Object.freeze({
      tenantId: input.tenantId,
      membershipId: input.membershipId,
      permission: input.permission,
      scope: Object.freeze({ ...input.scope }) as GrantScope,
      status: 'active' as const,
      grantedAt: input.grantedAt,
      revokedAt: null,
    }),
  );
}

/** Input revoke grant. */
export interface RevokeGrantInput {
  readonly grant: PermissionGrant;
  readonly revokedAt: unknown;
}

/**
 * Revoke một grant **active** — transition `active → revoked`, `revoked` là
 * terminal. Revoke lần hai bị từ chối (`grant_already_revoked`) thay vì ghi đè
 * `revokedAt` — cùng fail-closed idempotency với `revokeMembership`:
 * `revokedAt` đã tồn tại nghĩa là đã từng bị thu hồi, ghi đè sẽ làm mất thời
 * điểm thật kể cả khi `status` bị hỏng thành `active`.
 */
export function revokeGrant(input: RevokeGrantInput): LlmTenantResult<PermissionGrant> {
  if (!isEpochMillis(input.revokedAt)) {
    return llmTenantFailure('invalid_timestamp');
  }
  if (!isPermissionGrant(input.grant)) {
    return llmTenantFailure('invalid_grant');
  }
  if (input.grant.status === 'revoked' || input.grant.revokedAt !== null) {
    return llmTenantFailure('grant_already_revoked');
  }
  if (input.revokedAt < input.grant.grantedAt) {
    return llmTenantFailure('invalid_timestamp');
  }
  return llmTenantOk(
    Object.freeze({
      ...input.grant,
      status: 'revoked' as const,
      revokedAt: input.revokedAt,
    }),
  );
}

/** Type guard cho `PermissionGrant` đọc từ storage/contract. */
export function isPermissionGrant(value: unknown): value is PermissionGrant {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const grant = value as Partial<PermissionGrant>;
  if (
    !(
      isTenantId(grant.tenantId) &&
      isMembershipId(grant.membershipId) &&
      isPermissionId(grant.permission) &&
      isGrantScope(grant.scope) &&
      isEpochMillis(grant.grantedAt)
    )
  ) {
    return false;
  }
  // Status và revokedAt phải tự nhất quán: bản active không mang revokedAt,
  // bản revoked phải mang một revokedAt đọc được.
  if (grant.status === 'active') {
    return grant.revokedAt === null;
  }
  return grant.status === 'revoked' && isEpochMillis(grant.revokedAt);
}

/**
 * Grant có còn hiệu lực cho một membership **đang active** không.
 *
 * Hàm chỉ trả `true` khi grant trỏ đúng `membershipId` đó — grant của một lần
 * membership đã revoke không bao giờ được tính cho lần membership mới. Caller
 * phải truyền membership active đã resolve; hàm không tự chọn membership.
 */
export function isGrantEffectiveForMembership(
  grant: PermissionGrant,
  membership: MembershipSnapshot,
): boolean {
  return (
    grant.status !== 'revoked' &&
    grant.revokedAt === null &&
    grant.tenantId === membership.tenantId &&
    grant.membershipId === membership.id &&
    isMembershipActive(membership)
  );
}
