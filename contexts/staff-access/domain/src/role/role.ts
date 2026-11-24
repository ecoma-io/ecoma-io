/**
 * Aggregate `Role` — một tập permission có tên.
 *
 * Không bypass role: mọi role là tập permission hữu hạn (SR-016). Không role
 * hierarchy — gán phẳng (ADR-0007). `kind` phân biệt `system` (định danh
 * canonical, ví dụ `system-administrator`, nội dung sealed qua seed migration)
 * và `custom`; custom role administration **không bật** giai đoạn này
 * (ADR-0004) — aggregate vẫn mô hình hóa kind vì CHECK của persistence có,
 * nhưng không có API nào quản trị nội dung role custom.
 *
 * Role `retired` là terminal (insert-then-retire, cùng hình với permission
 * catalog — ADR-0010).
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';
import type { Brand } from '@ecoma-io/domain-primitives';

import { isPermissionId } from '../permission/permission-id';
import type { PermissionId } from '../permission/permission-id';
import { domainError } from '../shared/errors';
import type { DomainError } from '../shared/errors';

export type RoleId = Brand<string, 'RoleId'>;

export const ROLE_KIND = {
  Custom: 'custom',
  System: 'system',
} as const;
export type RoleKind = (typeof ROLE_KIND)[keyof typeof ROLE_KIND];

export const ROLE_STATE = {
  Active: 'active',
  Retired: 'retired',
} as const;
export type RoleState = (typeof ROLE_STATE)[keyof typeof ROLE_STATE];

export const ROLE_TRANSITIONS: Record<RoleState, readonly RoleState[]> = {
  active: [ROLE_STATE.Retired],
  retired: [],
};

/** Tên role: non-empty, tối đa 100 ký tự. Nội dung canonical do seed chốt. */
export const ROLE_NAME_MAX_LENGTH = 100;

export interface RoleSnapshot {
  readonly id: RoleId;
  readonly name: string;
  readonly kind: RoleKind;
  readonly state: RoleState;
  readonly permissions: readonly PermissionId[];
  readonly createdAt: number;
  readonly retiredAt: number | null;
}

const ROLE_KINDS: ReadonlySet<string> = new Set(Object.values(ROLE_KIND)),
  ROLE_STATES: ReadonlySet<string> = new Set(Object.values(ROLE_STATE));

export class Role extends AggregateRoot<RoleId> {
  readonly #id: RoleId;
  readonly #name: string;
  readonly #kind: RoleKind;
  #state: RoleState;
  readonly #permissions: Set<PermissionId>;
  readonly #createdAt: number;
  #retiredAt: number | null;

  private constructor(
    id: RoleId,
    name: string,
    kind: RoleKind,
    state: RoleState,
    permissions: Iterable<PermissionId>,
    createdAt: number,
    retiredAt: number | null,
  ) {
    super(id);
    this.#id = id;
    this.#name = name;
    this.#kind = kind;
    this.#state = state;
    this.#permissions = new Set(permissions);
    this.#createdAt = createdAt;
    this.#retiredAt = retiredAt;
  }

  /**
   * Tạo role mới. Permission phải hợp lệ về hình thức; việc permission có
   * thuộc catalog là kiểm tra cross-aggregate của application layer (catalog
   * sealed ở persistence — aggregate không tự thấy catalog).
   */
  public static define(args: {
    id: RoleId;
    name: string;
    kind: RoleKind;
    permissions: readonly PermissionId[];
    now: number;
  }): Role {
    if (typeof args.id !== 'string' || args.id.length === 0) {
      throw new TypeError('Role define: id không hợp lệ.');
    }
    if (
      typeof args.name !== 'string' ||
      args.name.length === 0 ||
      args.name.length > ROLE_NAME_MAX_LENGTH
    ) {
      throw new TypeError(`Role define: name phải là chuỗi 1–${ROLE_NAME_MAX_LENGTH} ký tự.`);
    }
    if (!ROLE_KINDS.has(args.kind)) {
      throw new TypeError('Role define: kind không hợp lệ.');
    }
    if (!Number.isFinite(args.now)) {
      throw new TypeError('Role define: now phải là số hữu hạn.');
    }
    for (const permission of args.permissions) {
      if (!isPermissionId(permission)) {
        throw new TypeError('Role define: permission không hợp lệ.');
      }
    }
    return new Role(
      args.id,
      args.name,
      args.kind,
      ROLE_STATE.Active,
      args.permissions,
      args.now,
      null,
    );
  }

  public static reconstitute(snapshot: RoleSnapshot): Role {
    if (
      typeof snapshot.id !== 'string' ||
      snapshot.id.length === 0 ||
      typeof snapshot.name !== 'string' ||
      snapshot.name.length === 0 ||
      snapshot.name.length > ROLE_NAME_MAX_LENGTH ||
      !ROLE_KINDS.has(snapshot.kind) ||
      !ROLE_STATES.has(snapshot.state) ||
      !Number.isFinite(snapshot.createdAt) ||
      (snapshot.retiredAt !== null && !Number.isFinite(snapshot.retiredAt)) ||
      !Array.isArray(snapshot.permissions)
    ) {
      throw new TypeError('Role snapshot không hợp lệ.');
    }
    for (const permission of snapshot.permissions) {
      if (!isPermissionId(permission)) {
        throw new TypeError('Role snapshot không hợp lệ: permission không hợp lệ.');
      }
    }
    // Pair-parity: retired ⟺ retiredAt; ordering created ≤ retired.
    const isRetired = snapshot.state === ROLE_STATE.Retired;
    if (isRetired !== (snapshot.retiredAt !== null)) {
      throw new TypeError('Role snapshot không hợp lệ: retiredAt không khớp state.');
    }
    if (snapshot.retiredAt !== null && snapshot.retiredAt < snapshot.createdAt) {
      throw new TypeError('Role snapshot không hợp lệ: retiredAt trước createdAt.');
    }
    return new Role(
      snapshot.id,
      snapshot.name,
      snapshot.kind,
      snapshot.state,
      snapshot.permissions,
      snapshot.createdAt,
      snapshot.retiredAt,
    );
  }

  public name(): string {
    return this.#name;
  }

  public kind(): RoleKind {
    return this.#kind;
  }

  public state(): RoleState {
    return this.#state;
  }

  public createdAt(): number {
    return this.#createdAt;
  }

  public retiredAt(): number | null {
    return this.#retiredAt;
  }

  public isRetired(): boolean {
    return this.#state === ROLE_STATE.Retired;
  }

  /** View readonly của tập permission — không expose Set nội bộ. */
  public permissions(): readonly PermissionId[] {
    return [...this.#permissions];
  }

  public hasPermission(permission: PermissionId): boolean {
    return this.#permissions.has(permission);
  }

  /**
   * Gán thêm permission vào role. Chỉ role system được thay đổi nội dung qua
   * API này — và chỉ qua seed migration + ADR theo governance (ADR-0010);
   * aggregate chỉ chặn retired, việc gọi từ đâu là trách nhiệm application.
   */
  public grantPermission(permission: PermissionId): undefined | DomainError {
    if (!isPermissionId(permission)) {
      throw new TypeError('Role grantPermission: permission không hợp lệ.');
    }
    if (this.#state === ROLE_STATE.Retired) {
      return domainError('invalid_transition');
    }
    this.#permissions.add(permission);
    return undefined;
  }

  public revokePermission(permission: PermissionId): undefined | DomainError {
    if (!isPermissionId(permission)) {
      throw new TypeError('Role revokePermission: permission không hợp lệ.');
    }
    if (this.#state === ROLE_STATE.Retired) {
      return domainError('invalid_transition');
    }
    this.#permissions.delete(permission);
    return undefined;
  }

  /** `active → retired`. Terminal. */
  public retire(now: number): undefined | DomainError {
    if (!Number.isFinite(now)) {
      throw new TypeError('Role retire: now phải là số hữu hạn.');
    }
    if (this.#state === ROLE_STATE.Retired) {
      return domainError('invalid_transition');
    }
    this.#state = ROLE_STATE.Retired;
    this.#retiredAt = now;
    return undefined;
  }

  public snapshot(): RoleSnapshot {
    return {
      createdAt: this.#createdAt,
      id: this.#id,
      kind: this.#kind,
      name: this.#name,
      permissions: this.permissions(),
      retiredAt: this.#retiredAt,
      state: this.#state,
    };
  }
}
