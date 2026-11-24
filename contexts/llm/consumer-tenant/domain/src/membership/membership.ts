/**
 * Membership — quan hệ giữa một account (`sub`) và một tenant.
 *
 * Quy tắc:
 * - Provision **tường minh**; signup/login không tạo membership.
 * - Một actor có **tối đa một** membership `active` trên một tenant. Provision
 *   trùng actor khi đã có membership active bị từ chối, không âm thầm ghi đè.
 * - Revoke là terminal cho **bản ghi đó**: không có `revoked → active`. Cấp lại
 *   là một membership **mới** với `id` mới; bản ghi cũ nằm lại làm lịch sử.
 * - Mỗi membership có `id` riêng. Grant trỏ tới `id` này, nên quyền của một
 *   lần membership đã revoke **không** sống lại khi actor được provision lại —
 *   đây là lý do membership phải có danh tính, không chỉ `(tenant, actor)`.
 * - Owner là quan hệ riêng trên tenant (`../tenant/tenant`), **không** phải một
 *   membership có "role owner": membership không mang role, chỉ nhận
 *   permission grant trực tiếp (`../grants/grants`).
 *
 * Một `sub` có thể là owner của nhiều tenant và là member của nhiều tenant
 * khác; mọi hàm ở đây làm việc trên **một** tập membership của **một** tenant,
 * nên membership tenant A không bao giờ được đọc như membership tenant B.
 *
 * Membership là aggregate có persistent identity nên có class
 * {@link Membership} kế thừa `AggregateRoot<MembershipId>` (private constructor,
 * `issue()`/`revoke()`/`reconstitute()`/`snapshot()`); các hàm thuần phía dưới
 * làm việc trên {@link MembershipSnapshot} — shape dữ liệu persist/load — cho
 * các collection flow không cần instance.
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';

import {
  isEpochMillis,
  isMembershipId,
  isTenantActorId,
  isTenantId,
  llmTenantFailure,
  llmTenantOk,
  type LlmTenantResult,
  type MembershipId,
  type TenantActorId,
  type TenantId,
} from '../shared/shared';

/** Trạng thái membership — chỉ hai nhãn, không có nhãn "pending" chưa chốt. */
export const LLM_TENANT_MEMBERSHIP_STATUS = {
  Active: 'active',
  Revoked: 'revoked',
} as const;

/** Union trạng thái membership. */
export type MembershipStatus =
  (typeof LLM_TENANT_MEMBERSHIP_STATUS)[keyof typeof LLM_TENANT_MEMBERSHIP_STATUS];

/** Danh sách trạng thái, thứ tự không mang ý nghĩa nghiệp vụ. */
export const LLM_TENANT_MEMBERSHIP_STATUSES = [
  LLM_TENANT_MEMBERSHIP_STATUS.Active,
  LLM_TENANT_MEMBERSHIP_STATUS.Revoked,
] as const;

/** Type guard cho `MembershipStatus` — dữ liệu đọc từ DB/contract qua hàm này. */
export function isMembershipStatus(value: unknown): value is MembershipStatus {
  return (
    typeof value === 'string' &&
    (LLM_TENANT_MEMBERSHIP_STATUSES as readonly string[]).includes(value)
  );
}

/** Snapshot toàn bộ trạng thái của `Membership` — shape dữ liệu persist/load. */
export interface MembershipSnapshot {
  /** Danh tính của **lần** membership này — grant trỏ tới đây. */
  readonly id: MembershipId;
  readonly tenantId: TenantId;
  readonly actor: TenantActorId;
  readonly status: MembershipStatus;
  readonly createdAt: number;
  readonly revokedAt: number | null;
}

/** Input provision membership — explicit, không có đường tự động. */
export interface ProvisionMembershipInput {
  readonly id: unknown;
  readonly tenantId: unknown;
  readonly actor: unknown;
  readonly createdAt: unknown;
}

/**
 * Provision một membership active.
 *
 * Từ chối khi:
 * - id/tenant/actor/timestamp không đọc được (`invalid_*`);
 * - một membership khác trong tập đã dùng cùng `id`
 *   (`duplicate_membership_id`);
 * - actor đã có membership **active** trên tenant (`membership_already_active`).
 *
 * Cho phép khi actor chỉ có membership **revoked**: lần provision này tạo một
 * membership **mới** với `id` khác. Grant cũ trỏ tới `id` cũ nên không được
 * tính cho lần membership mới — không có quyền nào sống lại.
 *
 * @param existing Các membership hiện có của **cùng tenant**. Caller chịu trách
 *   nhiệm chỉ truyền membership của tenant đang xét; hàm còn kiểm lại
 *   `tenantId` của từng phần tử và fail closed nếu lệch
 *   (`inconsistent_context`).
 */
export function provisionMembership(
  input: ProvisionMembershipInput,
  existing: readonly MembershipSnapshot[] = [],
): LlmTenantResult<MembershipSnapshot> {
  if (!isMembershipId(input.id)) {
    return llmTenantFailure('invalid_membership_id');
  }
  if (!isTenantId(input.tenantId)) {
    return llmTenantFailure('invalid_tenant_id');
  }
  if (!isTenantActorId(input.actor)) {
    return llmTenantFailure('invalid_actor');
  }
  if (!isEpochMillis(input.createdAt)) {
    return llmTenantFailure('invalid_timestamp');
  }
  if (existing.some((membership) => membership.tenantId !== input.tenantId)) {
    return llmTenantFailure('inconsistent_context');
  }
  if (existing.some((membership) => membership.id === input.id)) {
    return llmTenantFailure('duplicate_membership_id');
  }

  const activeForActor = existing.some(
    (membership) =>
      membership.actor === input.actor && membership.status === LLM_TENANT_MEMBERSHIP_STATUS.Active,
  );
  if (activeForActor) {
    return llmTenantFailure('membership_already_active');
  }

  return llmTenantOk(
    Object.freeze({
      id: input.id,
      tenantId: input.tenantId,
      actor: input.actor,
      status: LLM_TENANT_MEMBERSHIP_STATUS.Active,
      createdAt: input.createdAt,
      revokedAt: null,
    }),
  );
}

/** Input revoke membership. */
export interface RevokeMembershipInput {
  readonly membership: MembershipSnapshot;
  readonly revokedAt: unknown;
}

/**
 * Revoke một membership active. Idempotent-unsafe theo hướng fail closed:
 * revoke lần hai bị từ chối (`membership_already_revoked`) thay vì ghi lại
 * `revokedAt` mới.
 *
 * Revoke không xoá membership và không xoá grant — grant của actor trên tenant
 * vẫn tồn tại như dữ liệu audit, nhưng không còn authorize vì
 * {@link isMembershipActive} là điều kiện tiên quyết của mọi quyết định
 * authorization (`../authorization/authorization`).
 */
export function revokeMembership(
  input: RevokeMembershipInput,
): LlmTenantResult<MembershipSnapshot> {
  if (!isEpochMillis(input.revokedAt)) {
    return llmTenantFailure('invalid_timestamp');
  }
  if (input.membership.status === LLM_TENANT_MEMBERSHIP_STATUS.Revoked) {
    return llmTenantFailure('membership_already_revoked');
  }
  if (input.revokedAt < input.membership.createdAt) {
    return llmTenantFailure('invalid_timestamp');
  }
  return llmTenantOk(
    Object.freeze({
      ...input.membership,
      status: LLM_TENANT_MEMBERSHIP_STATUS.Revoked,
      revokedAt: input.revokedAt,
    }),
  );
}

/** Kiểm tra membership còn hiệu lực authorization không. */
export function isMembershipActive(membership: MembershipSnapshot): boolean {
  return membership.status === LLM_TENANT_MEMBERSHIP_STATUS.Active;
}

/**
 * Tìm membership **active** của một actor trong **một** tenant.
 *
 * Chọn theo trạng thái active, không theo "bản ghi đầu tiên": tập có thể chứa
 * membership cũ đã revoke cùng actor. Trả `undefined` khi không có bản ghi
 * active — hướng fail closed. Nếu có nhiều hơn một bản ghi active (dữ liệu
 * hỏng), trả `undefined` thay vì chọn một cách tuỳ ý.
 */
export function findMembership(
  memberships: readonly MembershipSnapshot[],
  tenantId: TenantId,
  actor: TenantActorId,
): MembershipSnapshot | undefined {
  const active = memberships.filter(
    (membership) =>
      membership.tenantId === tenantId &&
      membership.actor === actor &&
      membership.status === LLM_TENANT_MEMBERSHIP_STATUS.Active,
  );
  return active.length === 1 ? active[0] : undefined;
}

/**
 * Aggregate `Membership` — vòng đời `active → revoked` của một lần membership.
 * Revoke là terminal cho instance này; cấp lại là một instance mới với `id`
 * mới. Toàn bộ validate được tái sử dụng từ {@link provisionMembership}/
 * {@link revokeMembership} — aggregate không có luật riêng.
 */
export class Membership extends AggregateRoot<MembershipId> {
  #snapshot: MembershipSnapshot;

  private constructor(snapshot: MembershipSnapshot) {
    super(snapshot.id);
    this.#snapshot = snapshot;
  }

  /**
   * Provision một membership active — cùng luật với {@link provisionMembership}.
   *
   * @param existing Các membership hiện có của **cùng tenant** (snapshot).
   */
  public static issue(
    input: ProvisionMembershipInput,
    existing: readonly MembershipSnapshot[] = [],
  ): LlmTenantResult<Membership> {
    const result = provisionMembership(input, existing);
    return result.ok ? llmTenantOk(new Membership(result.value)) : result;
  }

  /**
   * Revoke membership — cùng luật với {@link revokeMembership}. Terminal cho
   * instance này: revoke lần hai bị từ chối.
   *
   * @returns `undefined` khi thành công, hoặc domain error khi revoke bị từ chối.
   */
  public revoke(revokedAt: unknown): LlmTenantResult<undefined> {
    const result = revokeMembership({ membership: this.#snapshot, revokedAt });
    if (!result.ok) {
      return result;
    }
    this.#snapshot = result.value;
    return llmTenantOk(undefined);
  }

  /**
   * Tái lập membership từ snapshot đã persist. Snapshot tự mâu thuẫn (status
   * sai vocabulary, `revokedAt` thiếu cho bản revoked hoặc tồn tại cho bản
   * active, timestamp không phải epoch millis) bị từ chối thay vì được tin.
   *
   * @throws TypeError khi snapshot không hợp lệ.
   */
  public static reconstitute(snapshot: MembershipSnapshot): Membership {
    if (
      !isMembershipId(snapshot.id) ||
      !isTenantId(snapshot.tenantId) ||
      !isTenantActorId(snapshot.actor) ||
      !isMembershipStatus(snapshot.status) ||
      !isEpochMillis(snapshot.createdAt)
    ) {
      throw new TypeError('Membership snapshot is not valid.');
    }
    if (snapshot.status === LLM_TENANT_MEMBERSHIP_STATUS.Revoked) {
      if (
        snapshot.revokedAt === null ||
        !isEpochMillis(snapshot.revokedAt) ||
        snapshot.revokedAt < snapshot.createdAt
      ) {
        throw new TypeError(
          'Membership snapshot is not valid: revoked requires a valid revokedAt.',
        );
      }
    } else if (snapshot.revokedAt !== null) {
      throw new TypeError('Membership snapshot is not valid: active must not carry a revokedAt.');
    }
    return new Membership(Object.freeze({ ...snapshot }));
  }

  public tenantId(): TenantId {
    return this.#snapshot.tenantId;
  }

  public actor(): TenantActorId {
    return this.#snapshot.actor;
  }

  public status(): MembershipStatus {
    return this.#snapshot.status;
  }

  public createdAt(): number {
    return this.#snapshot.createdAt;
  }

  public revokedAt(): number | null {
    return this.#snapshot.revokedAt;
  }

  /** Kiểm tra membership còn hiệu lực authorization không. */
  public isActive(): boolean {
    return isMembershipActive(this.#snapshot);
  }

  /** Toàn bộ trạng thái hiện tại dưới dạng snapshot serialize được (frozen). */
  public snapshot(): MembershipSnapshot {
    return this.#snapshot;
  }
}
