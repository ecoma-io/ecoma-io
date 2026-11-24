/**
 * Workspace — không gian làm việc thuộc **đúng một** tenant.
 *
 * Quy tắc:
 * - Mọi workspace thuộc đúng một tenant; `tenantId` là field bắt buộc và không
 *   đổi qua API của module này.
 * - Tham chiếu workspace xuyên tenant bị từ chối ở **mọi** hàm tra cứu: tìm
 *   workspace theo `(tenantId, workspaceId)` trả "không thấy" khi workspace
 *   tồn tại nhưng thuộc tenant khác.
 * - Vòng đời archive/delete **chưa chốt** nên workspace không có `status` và
 *   không có transition nào trong module này.
 *
 * Namespace/storage scope derive từ cặp `(tenantId, workspaceId)`; domain không
 * tự sinh khoá lưu trữ.
 *
 * Workspace có persistent identity nên có class {@link Workspace} kế thừa
 * `AggregateRoot<WorkspaceId>` (private constructor, `issue()`/
 * `reconstitute()`/`snapshot()`); các hàm thuần phía dưới làm việc trên
 * {@link WorkspaceSnapshot} — shape dữ liệu persist/load — cho các collection
 * flow không cần instance.
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';

import {
  isEpochMillis,
  isTenantId,
  isWorkspaceId,
  llmTenantFailure,
  llmTenantOk,
  type LlmTenantResult,
  type TenantId,
  type WorkspaceId,
} from '../shared/shared';
import { isTenantName } from '../tenant/tenant';

/** Snapshot toàn bộ trạng thái của `Workspace` — shape dữ liệu persist/load. */
export interface WorkspaceSnapshot {
  readonly id: WorkspaceId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly createdAt: number;
}

/** Input tạo workspace. */
export interface CreateWorkspaceInput {
  readonly id: unknown;
  readonly tenantId: unknown;
  readonly name: unknown;
  readonly createdAt: unknown;
}

/**
 * Tạo workspace trong một tenant.
 *
 * @param existing Các workspace hiện có của **cùng tenant**. Caller chịu trách
 *   nhiệm chỉ truyền workspace của tenant đang xét; hàm kiểm lại từng phần tử
 *   và fail closed khi tập input lẫn tenant khác (`inconsistent_context`).
 *   Trùng `id` trong cùng tenant bị từ chối (`duplicate_workspace_id`).
 */
export function createWorkspace(
  input: CreateWorkspaceInput,
  existing: readonly WorkspaceSnapshot[] = [],
): LlmTenantResult<WorkspaceSnapshot> {
  if (!isWorkspaceId(input.id)) {
    return llmTenantFailure('invalid_workspace_id');
  }
  if (!isTenantId(input.tenantId)) {
    return llmTenantFailure('invalid_tenant_id');
  }
  if (!isTenantName(input.name)) {
    return llmTenantFailure('invalid_tenant_name');
  }
  if (!isEpochMillis(input.createdAt)) {
    return llmTenantFailure('invalid_timestamp');
  }
  if (existing.some((workspace) => workspace.tenantId !== input.tenantId)) {
    return llmTenantFailure('inconsistent_context');
  }
  if (existing.some((workspace) => workspace.id === input.id)) {
    return llmTenantFailure('duplicate_workspace_id');
  }
  return llmTenantOk(
    Object.freeze({
      id: input.id,
      tenantId: input.tenantId,
      name: input.name,
      createdAt: input.createdAt,
    }),
  );
}

/**
 * Tìm workspace trong một tenant.
 *
 * Chỉ trả workspace khi **cả** `tenantId` và `workspaceId` khớp. Một workspace
 * tồn tại ở tenant khác là "không thấy" trong ngữ cảnh này — không có đường
 * nào để đọc workspace xuyên tenant qua hàm này.
 */
export function findWorkspace(
  workspaces: readonly WorkspaceSnapshot[],
  tenantId: TenantId,
  workspaceId: WorkspaceId,
): WorkspaceSnapshot | undefined {
  return workspaces.find(
    (workspace) => workspace.tenantId === tenantId && workspace.id === workspaceId,
  );
}

/**
 * Xác nhận workspace thuộc tenant, dùng ở biên authorization.
 *
 * Fail closed khi workspace không có trong tập của tenant — kể cả khi
 * `workspaceId` tồn tại ở một tenant khác.
 */
export function assertWorkspaceBelongsToTenant(
  workspaces: readonly WorkspaceSnapshot[],
  tenantId: TenantId,
  workspaceId: WorkspaceId,
): LlmTenantResult<WorkspaceSnapshot> {
  const workspace = findWorkspace(workspaces, tenantId, workspaceId);
  return workspace === undefined
    ? llmTenantFailure('workspace_not_in_tenant')
    : llmTenantOk(workspace);
}

/**
 * Aggregate `Workspace` — immutable sau khi tạo: không có operation đổi trạng
 * thái nào vì vòng đời archive/delete chưa chốt (xem đầu module). Validate được
 * tái sử dụng từ {@link createWorkspace} — aggregate không có luật riêng.
 */
export class Workspace extends AggregateRoot<WorkspaceId> {
  readonly #snapshot: WorkspaceSnapshot;

  private constructor(snapshot: WorkspaceSnapshot) {
    super(snapshot.id);
    this.#snapshot = snapshot;
  }

  /** Tạo workspace trong một tenant — cùng luật với {@link createWorkspace}. */
  public static issue(
    input: CreateWorkspaceInput,
    existing: readonly WorkspaceSnapshot[] = [],
  ): LlmTenantResult<Workspace> {
    const result = createWorkspace(input, existing);
    return result.ok ? llmTenantOk(new Workspace(result.value)) : result;
  }

  /**
   * Tái lập workspace từ snapshot đã persist. Snapshot sai shape (id/tenant
   * sai, name không hợp lệ, timestamp không phải epoch millis) bị từ chối thay
   * vì được tin.
   *
   * @throws TypeError khi snapshot không hợp lệ.
   */
  public static reconstitute(snapshot: WorkspaceSnapshot): Workspace {
    if (
      !isWorkspaceId(snapshot.id) ||
      !isTenantId(snapshot.tenantId) ||
      !isTenantName(snapshot.name) ||
      !isEpochMillis(snapshot.createdAt)
    ) {
      throw new TypeError('Workspace snapshot is not valid.');
    }
    return new Workspace(Object.freeze({ ...snapshot }));
  }

  public tenantId(): TenantId {
    return this.#snapshot.tenantId;
  }

  public name(): string {
    return this.#snapshot.name;
  }

  public createdAt(): number {
    return this.#snapshot.createdAt;
  }

  /** Toàn bộ trạng thái hiện tại dưới dạng snapshot serialize được (frozen). */
  public snapshot(): WorkspaceSnapshot {
    return this.#snapshot;
  }
}
