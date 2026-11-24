/**
 * Routing policy — cau hinh xac dinh tap candidate eligible, strategy chon
 * candidate, va fallback config. Moi thay doi tao version moi (monotonic).
 *
 * Version tang strictly; khong cho phep downgrade/skip version de bypass audit.
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';
import type { Brand } from '@ecoma-io/domain-primitives';

import type { CandidateId } from '../candidate/candidate';
import { isCandidateId } from '../candidate/candidate';
import type { FallbackConfig } from '../snapshot/snapshot';
import type { RoutingStrategy } from '../strategy/strategy';
import { isRoutingStrategy } from '../strategy/strategy';
import type { DomainOk, DomainRejection } from '../shared/shared';
import { isPositiveInteger } from '../shared/shared';
import { routingDomainError } from '../shared/errors';
import type { RoutingDomainError } from '../shared/errors';

/** Định danh routing policy — do caller sinh, domain chỉ validate hình dạng. */
export type RoutingPolicyId = Brand<string, 'RoutingPolicyId'>;

export type RoutingPolicy = {
  readonly policyId: RoutingPolicyId;
  readonly version: number; // monotonic
  readonly candidates: readonly CandidateId[];
  readonly strategy: RoutingStrategy;
  readonly fallbackConfig: FallbackConfig;
  readonly updatedAt: number; // epoch millis
};

export function isRoutingPolicyId(value: unknown): value is RoutingPolicyId {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isRoutingPolicy(value: unknown): value is RoutingPolicy {
  return (
    typeof value === 'object' &&
    value !== null &&
    isRoutingPolicyId((value as RoutingPolicy).policyId) &&
    isPositiveInteger((value as RoutingPolicy).version) &&
    Array.isArray((value as RoutingPolicy).candidates) &&
    (value as RoutingPolicy).candidates.every((c: unknown) => isCandidateId(c)) &&
    isRoutingStrategy((value as RoutingPolicy).strategy) &&
    typeof (value as RoutingPolicy).fallbackConfig === 'object' &&
    (value as RoutingPolicy).fallbackConfig !== null &&
    typeof (value as RoutingPolicy).fallbackConfig.endpointFallback === 'boolean' &&
    typeof (value as RoutingPolicy).fallbackConfig.offerFallback === 'boolean' &&
    Number.isSafeInteger((value as RoutingPolicy).fallbackConfig.maxAttempts) &&
    (value as RoutingPolicy).fallbackConfig.maxAttempts > 0 &&
    typeof (value as RoutingPolicy).updatedAt === 'number' &&
    Number.isSafeInteger((value as RoutingPolicy).updatedAt)
  );
}

export type CreatePolicyResult =
  | DomainOk<{ readonly policy: RoutingPolicy; readonly nextVersion: number }>
  | DomainRejection<
      | 'invalid_policy_id'
      | 'invalid_policy_version'
      | 'invalid_candidates'
      | 'invalid_strategy'
      | 'invalid_fallback_config'
      | 'invalid_updated_at'
    >;

export function createPolicy(inputs: {
  readonly policyId: string;
  readonly candidates: readonly string[];
  readonly strategy: RoutingStrategy;
  readonly fallbackConfig: FallbackConfig;
  readonly currentVersion: number;
  readonly updatedAt: number;
}): CreatePolicyResult {
  if (typeof inputs.policyId !== 'string' || inputs.policyId.trim().length === 0) {
    return {
      ok: false,
      reason: 'invalid_policy_id',
      detail: 'Policy id invalid — must be a non-empty string.',
    };
  }
  if (!Number.isSafeInteger(inputs.currentVersion) || inputs.currentVersion < 1) {
    return {
      ok: false,
      reason: 'invalid_policy_version',
      detail: 'Policy version invalid — must be a positive integer.',
    };
  }
  if (!Array.isArray(inputs.candidates) || inputs.candidates.length === 0) {
    return {
      ok: false,
      reason: 'invalid_candidates',
      detail: 'Policy must have at least one candidate.',
    };
  }
  if (!inputs.strategy || !isRoutingStrategy(inputs.strategy)) {
    return {
      ok: false,
      reason: 'invalid_strategy',
      detail: 'Routing strategy not supported.',
    };
  }
  if (
    !inputs.fallbackConfig ||
    typeof inputs.fallbackConfig.endpointFallback !== 'boolean' ||
    typeof inputs.fallbackConfig.offerFallback !== 'boolean' ||
    !Number.isSafeInteger(inputs.fallbackConfig.maxAttempts) ||
    inputs.fallbackConfig.maxAttempts <= 0
  ) {
    return {
      ok: false,
      reason: 'invalid_fallback_config',
      detail: 'Fallback config invalid.',
    };
  }
  if (!Number.isSafeInteger(inputs.updatedAt)) {
    return {
      ok: false,
      reason: 'invalid_updated_at',
      detail: 'updatedAt invalid.',
    };
  }

  const nextVersion = inputs.currentVersion + 1;
  const policy: RoutingPolicy = {
    policyId: inputs.policyId as RoutingPolicyId,
    version: nextVersion,
    candidates: inputs.candidates.map((c) => c as CandidateId),
    strategy: inputs.strategy,
    fallbackConfig: { ...inputs.fallbackConfig },
    updatedAt: inputs.updatedAt,
  };

  return { ok: true, policy, nextVersion };
}

// ---------------------------------------------------------------------------
// RoutingPolicy — aggregate root
// ---------------------------------------------------------------------------

/** Snapshot serialize được của aggregate {@link RoutingPolicyAggregate} (khớp {@link RoutingPolicy}). */
export interface RoutingPolicySnapshot extends RoutingPolicy {}

/**
 * Aggregate `RoutingPolicy` — cấu hình routing versioned, version tăng
 * monotonic (+1 mỗi thay đổi, không downgrade/skip — §8 của domain model).
 *
 * Guard thuần được tái dùng từ {@link isRoutingPolicy}; aggregate không tự sinh
 * id/timestamp. Immutable sau build nghĩa là: snapshot bind tại admission gắn
 * đúng version đã đọc — thay đổi policy tạo version mới, không đổi version cũ.
 */
export class RoutingPolicyAggregate extends AggregateRoot<RoutingPolicyId> {
  #version: number;
  #candidates: readonly CandidateId[];
  #strategy: RoutingStrategy;
  #fallbackConfig: FallbackConfig;
  #updatedAt: number;

  private constructor(
    policyId: RoutingPolicyId,
    version: number,
    candidates: readonly CandidateId[],
    strategy: RoutingStrategy,
    fallbackConfig: FallbackConfig,
    updatedAt: number,
  ) {
    super(policyId);
    this.#version = version;
    this.#candidates = candidates;
    this.#strategy = strategy;
    this.#fallbackConfig = fallbackConfig;
    this.#updatedAt = updatedAt;
  }

  /**
   * Phát hành policy mới ở version 1.
   *
   * @throws TypeError khi id/candidates/strategy/fallbackConfig/timestamp vi phạm
   *   guard — sai dữ liệu tạo là lỗi lập trình ở caller.
   */
  public static issue(args: {
    policyId: unknown;
    candidates: readonly unknown[];
    strategy: unknown;
    fallbackConfig: unknown;
    issuedAt: number;
  }): RoutingPolicyAggregate {
    if (!isRoutingPolicyId(args.policyId)) {
      throw new TypeError('RoutingPolicy.issue: policyId is not valid.');
    }
    if (!Array.isArray(args.candidates) || args.candidates.length === 0) {
      throw new TypeError('RoutingPolicy.issue: policy must have at least one candidate.');
    }
    if (!args.candidates.every((c) => isCandidateId(c))) {
      throw new TypeError('RoutingPolicy.issue: candidate id is not valid.');
    }
    if (!isRoutingStrategy(args.strategy)) {
      throw new TypeError('RoutingPolicy.issue: routing strategy not supported.');
    }
    if (!isValidFallbackConfig(args.fallbackConfig)) {
      throw new TypeError('RoutingPolicy.issue: fallback config invalid.');
    }
    if (!Number.isSafeInteger(args.issuedAt)) {
      throw new TypeError('RoutingPolicy.issue: issuedAt is not a safe integer.');
    }
    return new RoutingPolicyAggregate(
      args.policyId as RoutingPolicyId,
      1,
      (args.candidates as string[]).map((c) => c as CandidateId),
      args.strategy,
      { ...(args.fallbackConfig as FallbackConfig) },
      args.issuedAt,
    );
  }

  /**
   * Tái lập aggregate từ snapshot đã persist. Snapshot không tự nhất quán là
   * dữ liệu hỏng và bị từ chối, không âm thầm sửa.
   *
   * @throws TypeError khi snapshot không hợp lệ.
   */
  public static reconstitute(snapshot: RoutingPolicySnapshot): RoutingPolicyAggregate {
    if (!isRoutingPolicy(snapshot)) {
      throw new TypeError('RoutingPolicy snapshot is not valid.');
    }
    return new RoutingPolicyAggregate(
      snapshot.policyId,
      snapshot.version,
      [...snapshot.candidates],
      snapshot.strategy,
      { ...snapshot.fallbackConfig },
      snapshot.updatedAt,
    );
  }

  public policyId(): RoutingPolicyId {
    return this.id;
  }

  public version(): number {
    return this.#version;
  }

  public candidates(): readonly CandidateId[] {
    return this.#candidates;
  }

  public strategy(): RoutingStrategy {
    return this.#strategy;
  }

  public fallbackConfig(): FallbackConfig {
    return this.#fallbackConfig;
  }

  public updatedAt(): number {
    return this.#updatedAt;
  }

  /** Policy còn dùng được cho admission mới — versioned config không có terminal. */
  public isEligibleForNewRequests(): boolean {
    return true;
  }

  /**
   * Áp thay đổi cấu hình: version tăng đúng +1 (monotonic). Caller phải truyền
   * version hiện tại mà nó nhìn thấy — lệch version (optimistic-concurrency
   * guard, chống skip/downgrade) hoặc timestamp lùi bị từ chối.
   */
  public applyChange(args: {
    readonly expectedVersion: number;
    readonly candidates: readonly CandidateId[];
    readonly strategy: RoutingStrategy;
    readonly fallbackConfig: FallbackConfig;
    readonly updatedAt: number;
  }): undefined | RoutingDomainError {
    if (!Number.isSafeInteger(args.expectedVersion) || args.expectedVersion !== this.#version) {
      return routingDomainError('invalid_policy_version');
    }
    if (!Array.isArray(args.candidates) || args.candidates.length === 0) {
      return routingDomainError('invalid_candidate');
    }
    if (!args.candidates.every((c) => isCandidateId(c))) {
      return routingDomainError('invalid_candidate');
    }
    if (!isRoutingStrategy(args.strategy)) {
      return routingDomainError('invalid_strategy_input');
    }
    if (!isValidFallbackConfig(args.fallbackConfig)) {
      return routingDomainError('invalid_snapshot');
    }
    if (!Number.isSafeInteger(args.updatedAt) || args.updatedAt < this.#updatedAt) {
      return routingDomainError('invalid_policy_version');
    }
    this.#version = this.#version + 1;
    this.#candidates = [...args.candidates];
    this.#strategy = args.strategy;
    this.#fallbackConfig = { ...args.fallbackConfig };
    this.#updatedAt = args.updatedAt;
    return undefined;
  }

  /** Toàn bộ trạng thái hiện tại dưới dạng snapshot serialize được (frozen). */
  public snapshot(): RoutingPolicySnapshot {
    return Object.freeze({
      policyId: this.id,
      version: this.#version,
      candidates: Object.freeze([...this.#candidates]),
      strategy: this.#strategy,
      fallbackConfig: Object.freeze({ ...this.#fallbackConfig }),
      updatedAt: this.#updatedAt,
    });
  }
}

/** Guard nội bộ dùng chung cho shape `FallbackConfig`. */
function isValidFallbackConfig(value: unknown): value is FallbackConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as FallbackConfig).endpointFallback === 'boolean' &&
    typeof (value as FallbackConfig).offerFallback === 'boolean' &&
    Number.isSafeInteger((value as FallbackConfig).maxAttempts) &&
    (value as FallbackConfig).maxAttempts > 0
  );
}
