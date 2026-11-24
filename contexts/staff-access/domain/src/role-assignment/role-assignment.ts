/**
 * Aggregate `RoleAssignment` — gán một role cho một staff member, kèm scope,
 * cửa sổ hiệu lực và revocation.
 *
 * - Một staff có thể có **nhiều** assignment; mỗi assignment là một aggregate
 *   riêng (không nhét toàn bộ assignments của staff vào một aggregate lớn).
 * - Cửa sổ hiệu lực: `effectiveFrom` (null = hiệu lực ngay) /
 *   `effectiveUntil` (null = không hết hạn) — read-time filter, row giữ lại
 *   để audit.
 * - **Revocation là UPDATE có audit, không DELETE**: `revoke()` set
 *   `revokedAt` một chiều; un-revoke không có API nào.
 * - `grantedBy` phục vụ audit và chống self-elevation: application layer +
 *   DB trigger (`role_assignment_no_self_elevation`) enforce; aggregate chỉ
 *   ghi nhận.
 * - Job title không tạo quyền — chỉ assignment tạo quyền.
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';
import type { Brand } from '@ecoma-io/domain-primitives';

import { isStaffId } from '../staff/staff-id';
import type { StaffId } from '../staff/staff-id';
import type { RoleId } from '../role/role';
import { domainError } from '../shared/errors';
import type { DomainError } from '../shared/errors';

export type RoleAssignmentId = Brand<string, 'RoleAssignmentId'>;

/**
 * Scope của assignment — proposed shape, pending confirmation (khớp cột
 * `scope jsonb NULL` của persistence; NULL = global). Lib thuần giữ nguyên
 * hình JSON value; ngữ nghĩa scope chi tiết là việc của enforcement.
 */
export type AssignmentScope = Record<string, unknown> | null;

export interface RoleAssignmentSnapshot {
  readonly id: RoleAssignmentId;
  readonly staffId: StaffId;
  readonly roleId: RoleId;
  readonly scope: AssignmentScope;
  readonly effectiveFrom: number | null;
  readonly effectiveUntil: number | null;
  readonly grantedBy: StaffId | null;
  readonly createdAt: number;
  readonly revokedAt: number | null;
}

/**
 * Kiểm tra hình thức + cửa sổ hiệu lực của tham số `assign`. Self-elevation
 * bị chặn tại đây — khớp trigger `role_assignment_no_self_elevation`.
 */
function assertAssignArgs(args: Parameters<typeof RoleAssignment.assign>[0]): void {
  if (typeof args.id !== 'string' || args.id.length === 0) {
    throw new TypeError('RoleAssignment assign: id không hợp lệ.');
  }
  if (!isStaffId(args.staffId)) {
    throw new TypeError('RoleAssignment assign: staffId không hợp lệ.');
  }
  if (typeof args.roleId !== 'string' || args.roleId.length === 0) {
    throw new TypeError('RoleAssignment assign: roleId không hợp lệ.');
  }
  if (args.grantedBy !== null && !isStaffId(args.grantedBy)) {
    throw new TypeError('RoleAssignment assign: grantedBy không hợp lệ.');
  }
  if (args.grantedBy !== null && args.grantedBy === args.staffId) {
    throw new TypeError('RoleAssignment assign: self-elevation bị từ chối.');
  }
  const effectiveFrom = args.effectiveFrom ?? null,
    effectiveUntil = args.effectiveUntil ?? null;
  for (const ts of [effectiveFrom, effectiveUntil]) {
    if (ts !== null && !Number.isFinite(ts)) {
      throw new TypeError('RoleAssignment assign: cửa sổ hiệu lực phải là số hữu hạn hoặc null.');
    }
  }
  if (effectiveFrom !== null && effectiveUntil !== null && effectiveUntil <= effectiveFrom) {
    throw new TypeError(
      'RoleAssignment assign: effectiveUntil phải sau effectiveFrom (khớp CHECK effective_window).',
    );
  }
  if (!Number.isFinite(args.now)) {
    throw new TypeError('RoleAssignment assign: now phải là số hữu hạn.');
  }
}

export class RoleAssignment extends AggregateRoot<RoleAssignmentId> {
  readonly #id: RoleAssignmentId;
  readonly #staffId: StaffId;
  readonly #roleId: RoleId;
  readonly #scope: AssignmentScope;
  readonly #effectiveFrom: number | null;
  readonly #effectiveUntil: number | null;
  readonly #grantedBy: StaffId | null;
  readonly #createdAt: number;
  #revokedAt: number | null;

  private constructor(
    id: RoleAssignmentId,
    staffId: StaffId,
    roleId: RoleId,
    scope: AssignmentScope,
    effectiveFrom: number | null,
    effectiveUntil: number | null,
    grantedBy: StaffId | null,
    createdAt: number,
    revokedAt: number | null,
  ) {
    super(id);
    this.#id = id;
    this.#staffId = staffId;
    this.#roleId = roleId;
    this.#scope = scope;
    this.#effectiveFrom = effectiveFrom;
    this.#effectiveUntil = effectiveUntil;
    this.#grantedBy = grantedBy;
    this.#createdAt = createdAt;
    this.#revokedAt = revokedAt;
  }

  /**
   * Gán role cho staff. Self-elevation (grantedBy === staffId) bị chặn tại
   * aggregate — cùng invariant với DB trigger; bootstrap/migrator tạo row
   * với grantedBy null.
   */
  public static assign(args: {
    id: RoleAssignmentId;
    staffId: StaffId;
    roleId: RoleId;
    scope?: AssignmentScope;
    effectiveFrom?: number | null;
    effectiveUntil?: number | null;
    grantedBy: StaffId | null;
    now: number;
  }): RoleAssignment {
    assertAssignArgs(args);
    return new RoleAssignment(
      args.id,
      args.staffId,
      args.roleId,
      args.scope ?? null,
      args.effectiveFrom ?? null,
      args.effectiveUntil ?? null,
      args.grantedBy,
      args.now,
      null,
    );
  }

  public static reconstitute(snapshot: RoleAssignmentSnapshot): RoleAssignment {
    if (
      typeof snapshot.id !== 'string' ||
      snapshot.id.length === 0 ||
      !isStaffId(snapshot.staffId) ||
      typeof snapshot.roleId !== 'string' ||
      snapshot.roleId.length === 0 ||
      !Number.isFinite(snapshot.createdAt) ||
      (snapshot.effectiveFrom !== null && !Number.isFinite(snapshot.effectiveFrom)) ||
      (snapshot.effectiveUntil !== null && !Number.isFinite(snapshot.effectiveUntil)) ||
      (snapshot.grantedBy !== null && !isStaffId(snapshot.grantedBy)) ||
      (snapshot.revokedAt !== null && !Number.isFinite(snapshot.revokedAt))
    ) {
      throw new TypeError('RoleAssignment snapshot không hợp lệ.');
    }
    if (
      snapshot.effectiveFrom !== null &&
      snapshot.effectiveUntil !== null &&
      snapshot.effectiveUntil <= snapshot.effectiveFrom
    ) {
      throw new TypeError('RoleAssignment snapshot không hợp lệ: cửa sổ hiệu lực ngược.');
    }
    if (snapshot.revokedAt !== null && snapshot.revokedAt < snapshot.createdAt) {
      throw new TypeError('RoleAssignment snapshot không hợp lệ: revokedAt trước createdAt.');
    }
    if (snapshot.grantedBy !== null && snapshot.grantedBy === snapshot.staffId) {
      throw new TypeError('RoleAssignment snapshot không hợp lệ: self-elevation.');
    }
    return new RoleAssignment(
      snapshot.id,
      snapshot.staffId,
      snapshot.roleId,
      snapshot.scope ?? null,
      snapshot.effectiveFrom,
      snapshot.effectiveUntil,
      snapshot.grantedBy,
      snapshot.createdAt,
      snapshot.revokedAt,
    );
  }

  public staffId(): StaffId {
    return this.#staffId;
  }

  public roleId(): RoleId {
    return this.#roleId;
  }

  public scope(): AssignmentScope {
    return this.#scope;
  }

  public effectiveFrom(): number | null {
    return this.#effectiveFrom;
  }

  public effectiveUntil(): number | null {
    return this.#effectiveUntil;
  }

  public grantedBy(): StaffId | null {
    return this.#grantedBy;
  }

  public createdAt(): number {
    return this.#createdAt;
  }

  public revokedAt(): number | null {
    return this.#revokedAt;
  }

  /**
   * Đang hiệu lực tại `now` — read-time filter của cửa sổ tự nhiên, KHÔNG
   * tính revoked (revoked là sự kiện có chủ đích, tách khỏi expiry).
   */
  public isInEffectAt(now: number): boolean {
    if (!Number.isFinite(now)) {
      throw new TypeError('RoleAssignment isInEffectAt: now phải là số hữu hạn.');
    }
    if (this.#revokedAt !== null) {
      return false;
    }
    if (this.#effectiveFrom !== null && now < this.#effectiveFrom) {
      return false;
    }
    if (this.#effectiveUntil !== null && now >= this.#effectiveUntil) {
      return false;
    }
    return true;
  }

  public isRevoked(): boolean {
    return this.#revokedAt !== null;
  }

  /**
   * Thu hồi có chủ đích: `revokedAt` được set một lần. Idempotent-safe:
   * revoke lần nữa trả `invalid_transition` — không đường un-revoke.
   */
  public revoke(now: number): undefined | DomainError {
    if (!Number.isFinite(now)) {
      throw new TypeError('RoleAssignment revoke: now phải là số hữu hạn.');
    }
    if (this.#revokedAt !== null) {
      return domainError('invalid_transition');
    }
    this.#revokedAt = now;
    return undefined;
  }

  public snapshot(): RoleAssignmentSnapshot {
    return {
      createdAt: this.#createdAt,
      effectiveFrom: this.#effectiveFrom,
      effectiveUntil: this.#effectiveUntil,
      grantedBy: this.#grantedBy,
      id: this.#id,
      revokedAt: this.#revokedAt,
      roleId: this.#roleId,
      scope: this.#scope,
      staffId: this.#staffId,
    };
  }
}
