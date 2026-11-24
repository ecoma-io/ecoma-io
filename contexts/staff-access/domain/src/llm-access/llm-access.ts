/**
 * Aggregate `LlmAccess` — entitlement truy cập LLM product của một staff.
 *
 * Product scope: Staff Access trong repo này chỉ quản lý quyền truy cập nội
 * bộ vào **LLM product** — không Pact Broker, không Remote Cache (các product
 * đó đã bị loại khỏi repo; không mô hình hóa lại).
 *
 * Entitlement trả lời đúng một câu hỏi: "staff X có được dùng LLM product
 * không" — product availability nhị phân. Nó KHÔNG mang verdict allow/deny
 * per-operation, KHÔNG mang permission list, KHÔNG mang per-resource scope
 * (ADR-0009: entitlement ≠ authorization; authorization thuộc enforcement
 * của resource-owning backend).
 *
 * `revision` tăng đơn điệu theo cặp (staffId, product) — khớp trigger
 * `entitlements_revision_monotonic` của persistence; status `revoked` là
 * terminal của entry hiện hành (không có API un-revoke).
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';

import { isStaffId } from '../staff/staff-id';
import type { StaffId } from '../staff/staff-id';
import { domainError } from '../shared/errors';
import type { DomainError } from '../shared/errors';

/** Product duy nhất trong scope của Staff Access ở repo này. */
export const LLM_PRODUCT = 'llm' as const;
export type LlmProduct = typeof LLM_PRODUCT;

export const LLM_ACCESS_STATE = {
  Entitled: 'entitled',
  Revoked: 'revoked',
} as const;
export type LlmAccessState = (typeof LLM_ACCESS_STATE)[keyof typeof LLM_ACCESS_STATE];

export const LLM_ACCESS_TRANSITIONS: Record<LlmAccessState, readonly LlmAccessState[]> = {
  entitled: [LLM_ACCESS_STATE.Revoked],
  revoked: [],
};

export interface LlmAccessSnapshot {
  readonly staffId: StaffId;
  readonly product: LlmProduct;
  readonly state: LlmAccessState;
  readonly revision: number;
  readonly occurredAt: number;
  readonly createdAt: number;
}

const LLM_ACCESS_STATES: ReadonlySet<string> = new Set(Object.values(LLM_ACCESS_STATE));

/**
 * Identity của aggregate là cặp (staffId, product) — khớp PK
 * `entitlements_pk (staff_id, product)` của persistence; product chỉ có một
 * giá trị hợp lệ là `llm`.
 */
export class LlmAccess extends AggregateRoot<StaffId> {
  readonly #staffId: StaffId;
  readonly #product: LlmProduct;
  #state: LlmAccessState;
  #revision: number;
  #occurredAt: number;
  readonly #createdAt: number;

  private constructor(
    staffId: StaffId,
    product: LlmProduct,
    state: LlmAccessState,
    revision: number,
    occurredAt: number,
    createdAt: number,
  ) {
    super(staffId);
    this.#staffId = staffId;
    this.#product = product;
    this.#state = state;
    this.#revision = revision;
    this.#occurredAt = occurredAt;
    this.#createdAt = createdAt;
  }

  /** Cấp entitlement LLM product lần đầu cho staff. */
  public static grant(args: { staffId: StaffId; now: number }): LlmAccess {
    if (!isStaffId(args.staffId)) {
      throw new TypeError('LlmAccess grant: staffId không hợp lệ.');
    }
    if (!Number.isFinite(args.now)) {
      throw new TypeError('LlmAccess grant: now phải là số hữu hạn.');
    }
    return new LlmAccess(
      args.staffId,
      LLM_PRODUCT,
      LLM_ACCESS_STATE.Entitled,
      1,
      args.now,
      args.now,
    );
  }

  public static reconstitute(snapshot: LlmAccessSnapshot): LlmAccess {
    if (
      !isStaffId(snapshot.staffId) ||
      snapshot.product !== LLM_PRODUCT ||
      !LLM_ACCESS_STATES.has(snapshot.state) ||
      !Number.isInteger(snapshot.revision) ||
      snapshot.revision < 1 ||
      !Number.isFinite(snapshot.occurredAt) ||
      !Number.isFinite(snapshot.createdAt) ||
      snapshot.occurredAt < snapshot.createdAt
    ) {
      throw new TypeError('LlmAccess snapshot không hợp lệ.');
    }
    // Pair-parity: revoked ⟹ occurredAt là mốc revoke; revision tăng ít nhất
    // Lên 2 sau một lần thay đổi trạng thái (khớp trigger monotonic).
    if (
      snapshot.state === LLM_ACCESS_STATE.Revoked &&
      (snapshot.revision < 2 || snapshot.occurredAt === snapshot.createdAt)
    ) {
      throw new TypeError('LlmAccess snapshot không hợp lệ: revoked revision không nhất quán.');
    }
    return new LlmAccess(
      snapshot.staffId,
      snapshot.product,
      snapshot.state,
      snapshot.revision,
      snapshot.occurredAt,
      snapshot.createdAt,
    );
  }

  /** Business key của entitlement — cặp (staff, product). */
  public businessKey(): { staffId: StaffId; product: LlmProduct } {
    return { product: this.#product, staffId: this.#staffId };
  }

  public state(): LlmAccessState {
    return this.#state;
  }

  public revision(): number {
    return this.#revision;
  }

  public occurredAt(): number {
    return this.#occurredAt;
  }

  public createdAt(): number {
    return this.#createdAt;
  }

  public isEntitled(): boolean {
    return this.#state === LLM_ACCESS_STATE.Entitled;
  }

  /**
   * Thu hồi entitlement — xóa bỏ tính khả dụng sản phẩm; KHÔNG tự tính hay
   * truyền verdict authorization nào về resource cụ thể (ADR-0009).
   * `revoked` là terminal của entry hiện hành.
   */
  public revoke(now: number): undefined | DomainError {
    if (!Number.isFinite(now)) {
      throw new TypeError('LlmAccess revoke: now phải là số hữu hạn.');
    }
    if (this.#state === LLM_ACCESS_STATE.Revoked) {
      return domainError('invalid_transition');
    }
    this.#state = LLM_ACCESS_STATE.Revoked;
    this.#revision += 1;
    this.#occurredAt = now;
    return undefined;
  }

  public snapshot(): LlmAccessSnapshot {
    return {
      createdAt: this.#createdAt,
      occurredAt: this.#occurredAt,
      product: this.#product,
      revision: this.#revision,
      staffId: this.#staffId,
      state: this.#state,
    };
  }
}
