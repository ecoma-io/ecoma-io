/**
 * Model cua routing candidate — mot provider/endpoint (hoac offer) co the phuc
 * vu mot model alias, kèm dieu kien eligibility.
 *
 * Candidate chi chua tinh chat tinh static. Tat ca thong tin thuc chay
 * (health, policy, tenant scope) duoc truyen vao cua ham evaluateEligibility
 * nhu facts — domain khong truy vấn authorization/health ben ngoai.
 */

import type { Brand } from '@ecoma-io/domain-primitives';

import { isNonEmptyString } from '../shared/shared';

/** Định danh routing candidate — do caller sinh, domain chỉ validate hình dạng. */
export type CandidateId = Brand<string, 'CandidateId'>;

export type CandidateStatus = 'active' | 'disabled' | 'retired';

export const CANDIDATE_STATUS = {
  active: 'active',
  disabled: 'disabled',
  retired: 'retired',
} as const;

export type CandidateCapability = {
  readonly model: string;
  readonly streaming: boolean;
};

export type Candidate = {
  readonly candidateId: CandidateId;
  readonly status: CandidateStatus;
  readonly priority: number; // so nho = uu tien cao hon
  readonly capability: CandidateCapability;
  readonly endpoints: readonly string[];
  readonly offerId: string;
};

export function isCandidateId(value: unknown): value is CandidateId {
  return isNonEmptyString(value);
}

export function isCandidateStatus(value: unknown): value is CandidateStatus {
  return (
    typeof value === 'string' &&
    (value === CANDIDATE_STATUS.active ||
      value === CANDIDATE_STATUS.disabled ||
      value === CANDIDATE_STATUS.retired)
  );
}

export function isCandidateCapability(value: unknown): value is CandidateCapability {
  return (
    typeof value === 'object' &&
    value !== null &&
    isNonEmptyString((value as CandidateCapability).model) &&
    typeof (value as CandidateCapability).streaming === 'boolean'
  );
}

export function isCandidate(value: unknown): value is Candidate {
  return (
    typeof value === 'object' &&
    value !== null &&
    isCandidateId((value as Candidate).candidateId) &&
    isCandidateStatus((value as Candidate).status) &&
    typeof (value as Candidate).priority === 'number' &&
    Number.isSafeInteger((value as Candidate).priority) &&
    isCandidateCapability((value as Candidate).capability) &&
    Array.isArray((value as Candidate).endpoints) &&
    (value as Candidate).endpoints.every((e: unknown) => isNonEmptyString(e)) &&
    isNonEmptyString((value as Candidate).offerId)
  );
}

/**
 * Dựng `CandidateId` từ giá trị đã đọc ở boundary.
 * @throws TypeError khi giá trị không hợp lệ.
 */
export function createCandidateId(value: unknown): CandidateId {
  if (!isCandidateId(value)) {
    throw new TypeError('Candidate ID must be a non-empty string.');
  }
  return value as CandidateId;
}

/**
 * Aggregate context của candidate: các điều kiện eligibility đọc thành method
 * trên candidate thay vì access field lỏng lẻo. Candidate là value-like
 * (immutable record), không có lifecycle riêng ngoài status — nên giữ là class
 * mỏng bọc record, không phải AggregateRoot.
 */
export class CandidateAggregate {
  readonly #record: Candidate;

  /**
   * Dựng từ record đã qua {@link isCandidate}.
   * @throws TypeError khi record không hợp lệ.
   */
  constructor(record: unknown) {
    if (!isCandidate(record)) {
      throw new TypeError('Candidate record is not valid.');
    }
    this.#record = record;
  }

  public get candidateId(): CandidateId {
    return this.#record.candidateId;
  }

  public get status(): CandidateStatus {
    return this.#record.status;
  }

  public get priority(): number {
    return this.#record.priority;
  }

  public get capability(): CandidateCapability {
    return this.#record.capability;
  }

  public get endpoints(): readonly string[] {
    return this.#record.endpoints;
  }

  public get offerId(): string {
    return this.#record.offerId;
  }

  /** Candidate chỉ phục vụ request mới khi `active` (không disabled/retired). */
  public isActive(): boolean {
    return this.#record.status === CANDIDATE_STATUS.active;
  }

  /** Capability của candidate có khớp yêu cầu (model + streaming) hay không. */
  public matchesCapability(required: {
    readonly model: string;
    readonly streaming: boolean;
  }): boolean {
    return (
      this.#record.capability.model === required.model &&
      this.#record.capability.streaming === required.streaming
    );
  }

  /** Record thuần dưới dạng readonly — dùng cho strategy/snapshot modules. */
  public toRecord(): Candidate {
    return this.#record;
  }
}
