/**
 * Tenant — ranh giới cách ly dữ liệu của một tổ chức/customer trong LLM.
 *
 * ⚠️ Tenant **không** mang lifecycle `status`. Trạng thái vận hành
 * (`active`/`suspended`/...) là kết quả suy ra từ các `SuspensionRecord`
 * (`../suspension/suspension`), không phải một cột thứ hai có thể lệch nguồn sự
 * thật. Vòng đời pháp lý (archive/terminate/delete/retention) **chưa chốt** nên
 * không có transition nào trong module này.
 *
 * ⚠️ **Exactly one owner** được bảo đảm bằng cấu trúc: `owner` là một field
 * bắt buộc, singleton, không có collection owner và không có constructor nào
 * tạo tenant mà thiếu owner. Vì vậy "tenant không owner" và "tenant hai
 * owner" không biểu diễn được, không phải chỉ bị kiểm lúc runtime.
 *
 * Chuyển ownership **chưa có quyết định** (điều kiện, consent, audit). Module
 * này không có operation transfer và không mô phỏng một workflow chưa chốt.
 *
 * Tenant là aggregate root có persistent identity nên có class
 * {@link Tenant} kế thừa `AggregateRoot<TenantId>` (private constructor,
 * `issue()`/`reconstitute()`/`snapshot()`); các hàm thuần phía dưới làm việc trên
 * {@link TenantSnapshot} — shape dữ liệu persist/load — cho các collection flow
 * không cần instance.
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';

import { isTenantOwnedBy } from '@ecoma-io/tenant-kernel-domain';

import {
  isEpochMillis,
  isTenantActorId,
  isTenantId,
  llmTenantFailure,
  llmTenantOk,
  type LlmTenantResult,
  type TenantActorId,
  type TenantId,
} from '../shared/shared';

/** Snapshot toàn bộ trạng thái của `Tenant` — shape dữ liệu persist/load. */
export interface TenantSnapshot {
  readonly id: TenantId;
  readonly name: string;
  readonly owner: TenantActorId;
  readonly createdAt: number;
}

/** Độ dài tối đa của tên tenant để chặn payload bất thường từ input. */
export const MAX_TENANT_NAME_LENGTH = 200;

/** Kiểm tra tên tenant: chuỗi đã trim, không rỗng, trong giới hạn. */
export function isTenantName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_TENANT_NAME_LENGTH &&
    value.trim() === value
  );
}

/** Input tạo tenant — owner là bắt buộc, không có biến thể "ownerless". */
export interface CreateTenantInput {
  readonly id: unknown;
  readonly name: unknown;
  readonly owner: unknown;
  readonly createdAt: unknown;
}

/**
 * Tạo tenant với đúng một owner.
 *
 * Fail closed trên mọi input không đọc được: ID sai, owner sai, tên sai hay
 * timestamp sai đều trả result thất bại chứ không tạo tenant.
 *
 * Không có biến thể nào nhận owner rỗng/`null`/`undefined` — invariant
 * "tenant luôn có đúng một owner" được giữ ở kiểu dữ liệu của
 * {@link TenantSnapshot}.
 */
export function createTenant(input: CreateTenantInput): LlmTenantResult<TenantSnapshot> {
  if (!isTenantId(input.id)) {
    return llmTenantFailure('invalid_tenant_id');
  }
  if (!isTenantName(input.name)) {
    return llmTenantFailure('invalid_tenant_name');
  }
  if (!isTenantActorId(input.owner)) {
    return llmTenantFailure('invalid_actor');
  }
  if (!isEpochMillis(input.createdAt)) {
    return llmTenantFailure('invalid_timestamp');
  }
  return llmTenantOk(
    Object.freeze({
      id: input.id,
      name: input.name,
      owner: input.owner,
      createdAt: input.createdAt,
    }),
  );
}

/**
 * Actor có phải owner của tenant không.
 *
 * Đây là **nguồn authority duy nhất** của owner: quyền owner không đến từ
 * permission grant, không từ membership, và không có role toàn cục nào thay
 * thế được tenant isolation.
 *
 * Bảo vệ hình dạng tenant TRƯỚC khi so sánh owner (invariant P3 của kernel
 * `isTenantOwnedBy`): input sai hình dạng — kể cả tenant hỏng mà trường owner
 * trùng actor — trả false, không bao giờ ném.
 */
export function isTenantOwner(tenant: TenantSnapshot, actor: TenantActorId): boolean {
  return isTenantOwnedBy(tenant, actor);
}

/**
 * Aggregate `Tenant` — immutable sau khi tạo: không có operation đổi trạng thái
 * nào vì vòng đời pháp lý chưa chốt (xem đầu module). Toàn bộ validate được tái
 * sử dụng từ {@link createTenant}/{@link isTenantOwner} — aggregate không có
 * luật riêng.
 */
export class Tenant extends AggregateRoot<TenantId> {
  readonly #snapshot: TenantSnapshot;

  private constructor(snapshot: TenantSnapshot) {
    super(snapshot.id);
    this.#snapshot = snapshot;
  }

  /**
   * Tạo tenant với đúng một owner — cùng luật fail closed với
   * {@link createTenant}.
   */
  public static issue(input: CreateTenantInput): LlmTenantResult<Tenant> {
    const result = createTenant(input);
    return result.ok ? llmTenantOk(new Tenant(result.value)) : result;
  }

  /**
   * Tái lập tenant từ snapshot đã persist. Snapshot tự mâu thuẫn (id/owner sai
   * shape, name không hợp lệ, timestamp không phải epoch millis) bị từ chối
   * thay vì được tin.
   *
   * @throws TypeError khi snapshot không hợp lệ.
   */
  public static reconstitute(snapshot: TenantSnapshot): Tenant {
    if (
      !isTenantId(snapshot.id) ||
      !isTenantName(snapshot.name) ||
      !isTenantActorId(snapshot.owner) ||
      !isEpochMillis(snapshot.createdAt)
    ) {
      throw new TypeError('Tenant snapshot is not valid.');
    }
    // Copy + freeze như `Membership.reconstitute`/`Workspace.reconstitute`:
    // giữ tham chiếu object của caller sẽ cho phép mutate aggregate từ ngoài.
    return new Tenant(Object.freeze({ ...snapshot }));
  }

  public name(): string {
    return this.#snapshot.name;
  }

  /** Owner — nguồn authority duy nhất của tenant, không phải grant/membership. */
  public owner(): TenantActorId {
    return this.#snapshot.owner;
  }

  public createdAt(): number {
    return this.#snapshot.createdAt;
  }

  /** Toàn bộ trạng thái hiện tại dưới dạng snapshot serialize được (frozen). */
  public snapshot(): TenantSnapshot {
    return this.#snapshot;
  }

  /**
   * Actor có phải owner của tenant không — cùng invariant P3 với
   * {@link isTenantOwner}, áp lên snapshot của instance này.
   */
  public isOwnedBy(actor: TenantActorId): boolean {
    return isTenantOwnedBy(this.#snapshot, actor);
  }
}
