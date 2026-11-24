/**
 * Model alias va lifecycle. Alias la dinh danh logic ma client goi; resolve
 * sang mot routing policy + tap candidate. Alias co the tao, cap nhat (doi
 * policy/tap candidate) va retire. Alias da retire khong con eligible cho
 * request moi; request dang in-flight giu snapshot cu.
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';
import type { Brand } from '@ecoma-io/domain-primitives';

import type { RoutingPolicyId } from '../policy/policy';
import { isRoutingPolicyId } from '../policy/policy';
import type { RoutingPolicyVersion } from '../snapshot/snapshot';
import { isRoutingPolicyVersion } from '../snapshot/snapshot';
import type { DomainOk, DomainRejection } from '../shared/shared';
import { isNonEmptyString } from '../shared/shared';
import { routingDomainError } from '../shared/errors';
import type { RoutingDomainError } from '../shared/errors';

/** Định danh model alias — do caller sinh, domain chỉ validate hình dạng. */
export type ModelAlias = Brand<string, 'ModelAlias'>;

export type AliasStatus = 'active' | 'retired';

export const ALIAS_STATUS = {
  active: 'active',
  retired: 'retired',
} as const;

export type AliasRecord = {
  readonly alias: ModelAlias;
  readonly status: AliasStatus;
  readonly policyId: RoutingPolicyId;
  readonly policyVersion: RoutingPolicyVersion;
  readonly createdAt: number; // epoch millis
  readonly updatedAt: number; // epoch millis
};

export function isModelAlias(value: unknown): value is ModelAlias {
  return isNonEmptyString(value);
}

export function isAliasStatus(value: unknown): value is AliasStatus {
  return (
    typeof value === 'string' && (value === ALIAS_STATUS.active || value === ALIAS_STATUS.retired)
  );
}

export function isAliasRecord(value: unknown): value is AliasRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    isModelAlias((value as AliasRecord).alias) &&
    isAliasStatus((value as AliasRecord).status) &&
    isRoutingPolicyId((value as AliasRecord).policyId) &&
    isRoutingPolicyVersion((value as AliasRecord).policyVersion) &&
    typeof (value as AliasRecord).createdAt === 'number' &&
    Number.isSafeInteger((value as AliasRecord).createdAt) &&
    typeof (value as AliasRecord).updatedAt === 'number' &&
    Number.isSafeInteger((value as AliasRecord).updatedAt)
  );
}

export type ResolveAliasResult =
  | DomainOk<{
      readonly alias: ModelAlias;
      readonly policyId: RoutingPolicyId;
      readonly policyVersion: RoutingPolicyVersion;
    }>
  | DomainRejection<'alias_not_found' | 'alias_retired' | 'invalid_alias'>;

export function resolveAlias(alias: unknown, aliases: readonly AliasRecord[]): ResolveAliasResult {
  if (!isModelAlias(alias)) {
    return {
      ok: false,
      reason: 'invalid_alias',
      detail: 'Model alias invalid — must be a non-empty string.',
    };
  }

  const record = aliases.find((a) => a.alias === alias);
  if (!record) {
    return {
      ok: false,
      reason: 'alias_not_found',
      detail: 'Model alias not found.',
    };
  }

  if (record.status === ALIAS_STATUS.retired) {
    return {
      ok: false,
      reason: 'alias_retired',
      detail: 'Model alias retired — not eligible for new requests.',
    };
  }

  return {
    ok: true,
    alias: record.alias,
    policyId: record.policyId,
    policyVersion: record.policyVersion,
  };
}

export type RetireAliasResult =
  | DomainOk<{ readonly alias: ModelAlias; readonly status: AliasStatus }>
  | DomainRejection<'alias_not_found' | 'invalid_alias'>;

export function retireAlias(alias: unknown, aliases: readonly AliasRecord[]): RetireAliasResult {
  if (!isModelAlias(alias)) {
    return {
      ok: false,
      reason: 'invalid_alias',
      detail: 'Model alias invalid — must be a non-empty string.',
    };
  }

  const record = aliases.find((a) => a.alias === alias);
  if (!record) {
    return {
      ok: false,
      reason: 'alias_not_found',
      detail: 'Model alias not found.',
    };
  }

  return { ok: true, alias: record.alias, status: ALIAS_STATUS.retired };
}

// ---------------------------------------------------------------------------
// ModelAlias — aggregate root
// ---------------------------------------------------------------------------

/** Snapshot serialize được của aggregate {@link ModelAlias} (khớp {@link AliasRecord}). */
export interface ModelAliasSnapshot extends AliasRecord {}

/**
 * Aggregate `ModelAlias` — vòng đời `active → retired` của một alias routing.
 *
 * Identity là `ModelAlias` (branded). Retire là chuyển đổi terminal cho request
 * mới: alias đã retired không còn eligible cho admission; request đang in-flight
 * giữ snapshot đã bind tại admission (nguồn sự thật của request đó).
 *
 * Guard thuần (validate hình dạng) được tái dùng từ các hàm module phía trên;
 * aggregate không tự sinh id hay timestamp — entropy/thời gian do caller truyền.
 */
export class ModelAliasAggregate extends AggregateRoot<ModelAlias> {
  #status: AliasStatus;
  #policyId: RoutingPolicyId;
  #policyVersion: RoutingPolicyVersion;
  readonly #createdAt: number;
  #updatedAt: number;

  private constructor(
    alias: ModelAlias,
    status: AliasStatus,
    policyId: RoutingPolicyId,
    policyVersion: RoutingPolicyVersion,
    createdAt: number,
    updatedAt: number,
  ) {
    super(alias);
    this.#status = status;
    this.#policyId = policyId;
    this.#policyVersion = policyVersion;
    this.#createdAt = createdAt;
    this.#updatedAt = updatedAt;
  }

  /**
   * Phát hành alias mới ở trạng thái `active`, trỏ tới một policy version cụ thể.
   *
   * @throws TypeError khi id/policy/timestamp vi phạm guard — sai dữ liệu tạo là
   *   lỗi lập trình ở caller (aggregate không trả result cho đường sinh).
   */
  public static issue(args: {
    alias: unknown;
    policyId: unknown;
    policyVersion: unknown;
    createdAt: number;
  }): ModelAliasAggregate {
    if (!isModelAlias(args.alias)) {
      throw new TypeError('ModelAlias.issue: alias is not valid — must be a non-empty string.');
    }
    if (!isRoutingPolicyId(args.policyId)) {
      throw new TypeError('ModelAlias.issue: policyId is not valid.');
    }
    if (!isRoutingPolicyVersion(args.policyVersion)) {
      throw new TypeError('ModelAlias.issue: policyVersion is not valid.');
    }
    if (!Number.isSafeInteger(args.createdAt)) {
      throw new TypeError('ModelAlias.issue: createdAt is not a safe integer.');
    }
    return new ModelAliasAggregate(
      args.alias,
      ALIAS_STATUS.active,
      args.policyId,
      args.policyVersion,
      args.createdAt,
      args.createdAt,
    );
  }

  /**
   * Tái lập aggregate từ snapshot đã persist. Snapshot không tự nhất quán
   * (status sai vocabulary, timestamp không safe integer) là dữ liệu hỏng và
   * bị từ chối, không âm thầm sửa.
   *
   * @throws TypeError khi snapshot không hợp lệ.
   */
  public static reconstitute(snapshot: ModelAliasSnapshot): ModelAliasAggregate {
    if (!isAliasRecord(snapshot) || snapshot.updatedAt < snapshot.createdAt) {
      throw new TypeError('ModelAlias snapshot is not valid.');
    }
    return new ModelAliasAggregate(
      snapshot.alias,
      snapshot.status,
      snapshot.policyId,
      snapshot.policyVersion,
      snapshot.createdAt,
      snapshot.updatedAt,
    );
  }

  public alias(): ModelAlias {
    return this.id;
  }

  public status(): AliasStatus {
    return this.#status;
  }

  public policyId(): RoutingPolicyId {
    return this.#policyId;
  }

  public policyVersion(): RoutingPolicyVersion {
    return this.#policyVersion;
  }

  public createdAt(): number {
    return this.#createdAt;
  }

  public updatedAt(): number {
    return this.#updatedAt;
  }

  /** Alias còn eligible cho request mới hay không — chỉ `active` là eligible. */
  public isEligibleForNewRequests(): boolean {
    return this.#status === ALIAS_STATUS.active;
  }

  /**
   * Cập nhật alias trỏ sang policy (hoặc version mới của policy) — chỉ khi
   * alias còn `active`; alias đã retired là terminal cho cấu hình mới.
   */
  public retargetPolicy(args: {
    policyId: RoutingPolicyId;
    policyVersion: RoutingPolicyVersion;
    updatedAt: number;
  }): undefined | RoutingDomainError {
    if (!isRoutingPolicyId(args.policyId) || !isRoutingPolicyVersion(args.policyVersion)) {
      return routingDomainError('invalid_policy_version');
    }
    if (!Number.isSafeInteger(args.updatedAt) || args.updatedAt < this.#updatedAt) {
      return routingDomainError('invalid_policy_version');
    }
    if (this.#status === ALIAS_STATUS.retired) {
      return routingDomainError('alias_retired');
    }
    // Đổi alias trỏ sang policy khác là một cập nhật hợp lệ của lifecycle
    // ("cập nhật (đổi policy/tap candidate)" — domain model §1): policyId
    // mutable sau khi issue.
    this.#policyId = args.policyId;
    this.#policyVersion = args.policyVersion;
    this.#updatedAt = args.updatedAt;
    return undefined;
  }

  /**
   * Retire alias — terminal cho request mới. Request đang in-flight giữ
   * snapshot cũ (domain không thu hồi snapshot đã bind).
   */
  public retire(updatedAt: number): undefined | RoutingDomainError {
    if (!Number.isSafeInteger(updatedAt) || updatedAt < this.#updatedAt) {
      return routingDomainError('invalid_alias');
    }
    if (this.#status === ALIAS_STATUS.retired) {
      return routingDomainError('alias_retired');
    }
    this.#status = ALIAS_STATUS.retired;
    this.#updatedAt = updatedAt;
    return undefined;
  }

  /** Toàn bộ trạng thái hiện tại dưới dạng snapshot serialize được (frozen). */
  public snapshot(): ModelAliasSnapshot {
    return Object.freeze({
      alias: this.id,
      status: this.#status,
      policyId: this.#policyId,
      policyVersion: this.#policyVersion,
      createdAt: this.#createdAt,
      updatedAt: this.#updatedAt,
    });
  }
}
