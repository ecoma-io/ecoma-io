/**
 * SellerTenant — aggregate root của bounded context `llm-seller`.
 *
 * Quy ước nguồn: ADR-0001 (ownership and transfer), ADR-0002 (existence vs eligibility).
 *
 * Quy tắc:
 * - **Đúng một owner**, luôn có. Owner là một `sub` trên tenant — không phải
 *   membership role, không phải permission grant.
 * - Tenant **không** mang `status`/`archivedAt`/`deletedAt`. Tồn tại, operational
 *   eligibility, verification và restriction là bốn trục độc lập; ba trục sau
 *   là **giá trị suy ra** (xem `restriction.ts`, `verification.ts`).
 * - Transfer là operation tường minh: owner mới phải là member active, owner cũ
 *   trở thành member, output luôn có đúng một owner.
 *
 * Aggregate root có persistent identity nên kế thừa `AggregateRoot<SellerTenantId>`:
 * private constructor, factory `issue()` (create) và `reconstitute()` (validate
 * snapshot, từ chối dữ liệu tự mâu thuẫn), và `snapshot()` để persistence đọc.
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';

import {
  isEpochMillis,
  isMembershipId,
  isSellerActorId,
  isSellerTenantId,
  isSellerText,
  llmSellerFailure,
  llmSellerOk,
  type LlmSellerResult,
  type SellerActorId,
  type SellerTenantId,
} from '../shared/shared';
import {
  isMembershipActive,
  isSellerMembership,
  type SellerMembership,
  type ProvisionMembershipInput,
  provisionMembership,
} from '../membership/membership';

/** Snapshot toàn bộ trạng thái của `SellerTenant` — shape dữ liệu persist/load. */
export interface SellerTenantSnapshot {
  readonly id: SellerTenantId;
  readonly name: string;
  readonly owner: SellerActorId;
  readonly createdAt: number;
}

/** Input tạo Seller tenant. Field `unknown` để boundary từ chối mọi thứ. */
export interface CreateSellerTenantInput {
  readonly id: unknown;
  readonly name: unknown;
  readonly owner: unknown;
  readonly createdAt: unknown;
}

export class SellerTenant extends AggregateRoot<SellerTenantId> {
  readonly #name: string;
  readonly #owner: SellerActorId;
  readonly #createdAt: number;

  private constructor(id: SellerTenantId, name: string, owner: SellerActorId, createdAt: number) {
    super(id);
    this.#name = name;
    this.#owner = owner;
    this.#createdAt = createdAt;
  }

  /**
   * Tạo Seller tenant ở trạng thái tồn tại và operational-active ngay.
   *
   * Không có trạng thái `pending` và không có điều kiện onboarding approval:
   * verification/onboarding được đánh giá riêng như giá trị suy ra (ADR-0002).
   */
  public static issue(input: CreateSellerTenantInput): LlmSellerResult<SellerTenant> {
    if (!isSellerTenantId(input.id)) {
      return llmSellerFailure('invalid_seller_tenant_id');
    }
    if (!isSellerText(input.name)) {
      return llmSellerFailure('invalid_seller_tenant_name');
    }
    if (!isSellerActorId(input.owner)) {
      return llmSellerFailure('invalid_actor');
    }
    if (!isEpochMillis(input.createdAt)) {
      return llmSellerFailure('invalid_timestamp');
    }
    return llmSellerOk(new SellerTenant(input.id, input.name, input.owner, input.createdAt));
  }

  /**
   * Tái lập tenant từ snapshot đọc ở storage. Snapshot tự mâu thuẫn (id/owner
   * sai shape, name không hợp lệ, timestamp không phải epoch millis) bị từ chối
   * thay vì được tin.
   *
   * @throws TypeError khi snapshot không hợp lệ.
   */
  public static reconstitute(snapshot: SellerTenantSnapshot): SellerTenant {
    if (
      !isSellerTenantId(snapshot.id) ||
      !isSellerText(snapshot.name) ||
      !isSellerActorId(snapshot.owner) ||
      !isEpochMillis(snapshot.createdAt)
    ) {
      throw new TypeError('Seller tenant snapshot is not valid.');
    }
    return new SellerTenant(snapshot.id, snapshot.name, snapshot.owner, snapshot.createdAt);
  }

  public name(): string {
    return this.#name;
  }

  public owner(): SellerActorId {
    return this.#owner;
  }

  public createdAt(): number {
    return this.#createdAt;
  }

  public snapshot(): SellerTenantSnapshot {
    return Object.freeze({
      id: this.id,
      name: this.#name,
      owner: this.#owner,
      createdAt: this.#createdAt,
    });
  }
}

/** Actor có phải owner của tenant này không. Owner authority không đi xuyên tenant. */
export function isSellerOwner(tenant: SellerTenant, actor: SellerActorId): boolean {
  return isSellerTenant(tenant) && tenant.owner() === actor;
}

/**
 * Shape guard cho `SellerTenant` đọc từ storage/contract.
 *
 * Adapter phải gọi trước khi dùng tenant cho transfer/authorization.
 */
export function isSellerTenant(value: unknown): value is SellerTenant {
  return value instanceof SellerTenant;
}

/** Input chuyển ownership. */
export interface TransferSellerOwnershipInput {
  readonly tenant: SellerTenant;
  readonly memberships: readonly SellerMembership[];
  readonly newOwner: unknown;
  readonly transferredBy: unknown;
  readonly transferredAt: unknown;
  /**
   * Membership ID dùng để giữ owner cũ làm member khi owner cũ **chưa** có
   * membership active. Bỏ qua khi owner cũ đã có membership active.
   */
  readonly formerOwnerMembershipId?: unknown;
}

/** Kết quả chuyển ownership: tenant mới + tập membership sau transfer. */
export interface SellerOwnershipTransfer {
  readonly tenant: SellerTenant;
  readonly memberships: readonly SellerMembership[];
  readonly previousOwner: SellerActorId;
  readonly newOwner: SellerActorId;
  readonly transferredAt: number;
}

/**
 * Chuyển ownership của Seller tenant.
 *
 * Guard (fail closed, theo thứ tự):
 * 1. `newOwner`, `transferredBy`, `transferredAt` đọc được.
 * 2. `transferredBy` là owner hiện tại — không có đường nào để non-owner tự
 *    chuyển tenant sang mình.
 * 3. `newOwner` khác owner hiện tại.
 * 4. `newOwner` có membership **active** trong tenant này.
 * 5. Mọi membership trong input thuộc đúng tenant.
 * 6. Nếu owner cũ chưa có membership active, phải cấp `formerOwnerMembershipId`;
 *    ID đó không được trùng membership đã có.
 *
 * Hệ quả: tenant có owner mới; owner cũ trở thành member active; grant hiện có
 * không bị đổi (grant thuộc membership, không thuộc owner). Không có trạng thái
 * trung gian ownerless.
 */
export function transferSellerOwnership(
  input: TransferSellerOwnershipInput,
): LlmSellerResult<SellerOwnershipTransfer> {
  if (!isSellerActorId(input.newOwner)) {
    return llmSellerFailure('invalid_actor');
  }
  if (!isSellerActorId(input.transferredBy)) {
    return llmSellerFailure('invalid_actor');
  }
  if (!isEpochMillis(input.transferredAt)) {
    return llmSellerFailure('invalid_timestamp');
  }
  if (!isSellerTenant(input.tenant)) {
    return llmSellerFailure('invalid_seller_tenant');
  }
  if (!Array.isArray(input.memberships)) {
    return llmSellerFailure('ambiguous_context');
  }
  if (input.transferredBy !== input.tenant.owner()) {
    return llmSellerFailure('actor_not_owner');
  }
  if (input.newOwner === input.tenant.owner()) {
    return llmSellerFailure('owner_already_owner');
  }
  if (
    input.memberships.some(
      (membership) => !isSellerMembership(membership) || membership.tenantId !== input.tenant.id,
    )
  ) {
    return llmSellerFailure('inconsistent_context');
  }
  const newOwnerMemberships = input.memberships.filter(
    (membership) => membership.actor === input.newOwner && isMembershipActive(membership),
  );
  if (newOwnerMemberships.length === 0) {
    return llmSellerFailure('new_owner_not_active_member');
  }
  const previousOwner = input.tenant.owner();
  const previousOwnerMemberships = input.memberships.filter(
    (membership) => membership.actor === previousOwner && isMembershipActive(membership),
  );
  if (newOwnerMemberships.length > 1 || previousOwnerMemberships.length > 1) {
    // Cùng lý do `membership_ambiguous` ở authorization: adapter đúng với
    // partial unique index không tạo ra trường hợp này, nhưng transfer không
    // được biến dữ liệu hỏng thành owner không dùng được grant nào.
    return llmSellerFailure('ambiguous_context');
  }
  const previousOwnerMembership = previousOwnerMemberships[0];

  let memberships: readonly SellerMembership[] = Object.freeze([...input.memberships]);
  if (previousOwnerMembership === undefined) {
    if (!isMembershipId(input.formerOwnerMembershipId)) {
      return llmSellerFailure('missing_former_owner_membership');
    }
    if (input.memberships.some((membership) => membership.id === input.formerOwnerMembershipId)) {
      return llmSellerFailure('duplicate_membership_id');
    }
    const provisionInput: ProvisionMembershipInput = {
      id: input.formerOwnerMembershipId,
      tenantId: input.tenant.id,
      actor: previousOwner,
      createdAt: input.transferredAt,
    };
    const provisioned = provisionMembership(provisionInput, input.memberships);
    if (!provisioned.ok) {
      return provisioned;
    }
    memberships = Object.freeze([...input.memberships, provisioned.value]);
  }

  // Aggregate là immutable theo operation: transfer trả về một instance mới
  // với owner mới, instance gốc không bị mutate. Dựng qua reconstitute —
  // đường công khai duy nhất dựng instance với owner khác, không có helper
  // public nào cho phép gán owner bỏ qua guard của transfer này.
  const transferredTenant = SellerTenant.reconstitute({
    ...input.tenant.snapshot(),
    owner: input.newOwner,
  });
  return llmSellerOk(
    Object.freeze({
      tenant: transferredTenant,
      memberships,
      previousOwner,
      newOwner: input.newOwner,
      transferredAt: input.transferredAt,
    }),
  );
}
