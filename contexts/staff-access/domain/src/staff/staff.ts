/**
 * Aggregate `Staff` — thành viên trong staff directory của bounded context
 * `staff-access`.
 *
 * Định danh nội bộ là `StaffId` (do staff-access phát hành); `AccountSubject`
 * chỉ là **reference** opaque sang BC `account` (1:1, không tái phát hành) —
 * aggregate giữ nó bất biến sau khi tạo (khớp trigger
 * `staff_identity_and_terminal_guard`: sub không được đổi trên hàng đã tồn tại).
 *
 * Staff status là **trục độc lập** với account status: không có method nào
 * suy status từ account hay ngược lại. State machine:
 *   active ⇄ suspended → terminated (terminal, không đường ra — khôi phục
 *   membership là thao tác mới có audit, tức staff entry mới).
 *
 * `displayName` là nhãn hiển thị directory-local, do staff-access sở hữu,
 * không sync từ account (ADR-0029).
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';

import { isAccountSubject } from './account-subject';
import type { AccountSubject } from './account-subject';
import { isStaffId } from './staff-id';
import type { StaffId } from './staff-id';
import { STAFF_ACCESS_STAFF_STATUS, STAFF_ACCESS_STAFF_TRANSITIONS } from './staff-status';
import type { StaffAccessStaffStatus } from './staff-status';
import { domainError } from '../shared/errors';
import type { DomainError } from '../shared/errors';

/** Độ dài tối đa của display name — directory-local label, không phải profile. */
export const STAFF_DISPLAY_NAME_MAX_LENGTH = 200;

export interface StaffSnapshot {
  readonly id: StaffId;
  readonly accountSubject: AccountSubject;
  readonly displayName: string;
  readonly status: StaffAccessStaffStatus;
  readonly createdAt: number;
  readonly suspendedAt: number | null;
  readonly terminatedAt: number | null;
}

const STAFF_STATUSES: ReadonlySet<string> = new Set(Object.values(STAFF_ACCESS_STAFF_STATUS));

/**
 * Hình thức snapshot: các trường có kiểu/độ dài hợp lệ. Pair-parity giữa
 * status và mốc thời gian nằm ở {@link assertStaffSnapshotParity}.
 */
function assertStaffSnapshotShape(snapshot: StaffSnapshot): void {
  if (
    !isStaffId(snapshot.id) ||
    !isAccountSubject(snapshot.accountSubject) ||
    typeof snapshot.displayName !== 'string' ||
    snapshot.displayName.length > STAFF_DISPLAY_NAME_MAX_LENGTH ||
    !STAFF_STATUSES.has(snapshot.status) ||
    !Number.isFinite(snapshot.createdAt) ||
    (snapshot.suspendedAt !== null && !Number.isFinite(snapshot.suspendedAt)) ||
    (snapshot.terminatedAt !== null && !Number.isFinite(snapshot.terminatedAt))
  ) {
    throw new TypeError('Staff snapshot không hợp lệ.');
  }
}

/**
 * Pair-parity khớp CHECK/trigger của persistence:
 * Suspended ⟹ có suspendedAt; terminated ⟹ có terminatedAt.
 * SuspendedAt CÓ THỂ còn trên snapshot terminated (suspend rồi terminate —
 * lịch sử giữ lại); chỉ chặn khi status `suspended` mà thiếu suspendedAt,
 * hoặc status không suspended mà suspendedAt xuất hiện ma (chỉ khi chưa
 * từng suspend — không kiểm được trên snapshot đơn lẻ, nên parity chặt
 * chỉ áp cho chính status suspended/terminated hiện tại).
 */
function assertStaffSnapshotParity(snapshot: StaffSnapshot): void {
  const isSuspended = snapshot.status === STAFF_ACCESS_STAFF_STATUS.Suspended,
    isTerminated = snapshot.status === STAFF_ACCESS_STAFF_STATUS.Terminated;
  // Suspended ⟹ có suspendedAt; active ⟹ không có suspendedAt; terminated
  // Cho phép cả hai (suspend rồi terminate — lịch sử giữ lại).
  if (isSuspended !== (snapshot.suspendedAt !== null) && !isTerminated) {
    throw new TypeError('Staff snapshot không hợp lệ: suspendedAt không khớp status.');
  }
  if (isTerminated !== (snapshot.terminatedAt !== null)) {
    throw new TypeError('Staff snapshot không hợp lệ: terminatedAt không khớp status.');
  }
  if (snapshot.suspendedAt !== null && snapshot.suspendedAt < snapshot.createdAt) {
    throw new TypeError('Staff snapshot không hợp lệ: suspendedAt trước createdAt.');
  }
  if (snapshot.terminatedAt !== null && snapshot.terminatedAt < snapshot.createdAt) {
    throw new TypeError('Staff snapshot không hợp lệ: terminatedAt trước createdAt.');
  }
  // Terminated là terminal: snapshot terminated kèm suspendedAt có thể xảy
  // Ra hợp lệ (suspend rồi terminate), nhưng suspendedAt sau terminatedAt
  // Là dữ liệu hỏng.
  if (
    snapshot.terminatedAt !== null &&
    snapshot.suspendedAt !== null &&
    snapshot.suspendedAt > snapshot.terminatedAt
  ) {
    throw new TypeError('Staff snapshot không hợp lệ: suspendedAt sau terminatedAt.');
  }
}

export class Staff extends AggregateRoot<StaffId> {
  readonly #id: StaffId;
  readonly #accountSubject: AccountSubject;
  #displayName: string;
  #status: StaffAccessStaffStatus;
  readonly #createdAt: number;
  #suspendedAt: number | null;
  #terminatedAt: number | null;

  private constructor(
    id: StaffId,
    accountSubject: AccountSubject,
    displayName: string,
    status: StaffAccessStaffStatus,
    createdAt: number,
    suspendedAt: number | null,
    terminatedAt: number | null,
  ) {
    super(id);
    this.#id = id;
    this.#accountSubject = accountSubject;
    this.#displayName = displayName;
    this.#status = status;
    this.#createdAt = createdAt;
    this.#suspendedAt = suspendedAt;
    this.#terminatedAt = terminatedAt;
  }

  /**
   * Tạo staff entry mới. Mapping sub → staff là quyết định server-side có
   * audit (không tạo từ dữ liệu client gửi) — guarantee đó thuộc application
   * layer; aggregate chỉ kiểm tra hình thức.
   */
  public static create(args: {
    id: StaffId;
    accountSubject: AccountSubject;
    displayName: string;
    now: number;
  }): Staff {
    if (!isStaffId(args.id)) {
      throw new TypeError('Staff create: id không hợp lệ.');
    }
    if (!isAccountSubject(args.accountSubject)) {
      throw new TypeError('Staff create: accountSubject không hợp lệ.');
    }
    if (
      typeof args.displayName !== 'string' ||
      args.displayName.length > STAFF_DISPLAY_NAME_MAX_LENGTH
    ) {
      throw new TypeError(
        `Staff create: displayName phải là chuỗi tối đa ${STAFF_DISPLAY_NAME_MAX_LENGTH} ký tự.`,
      );
    }
    if (!Number.isFinite(args.now)) {
      throw new TypeError('Staff create: now phải là số hữu hạn.');
    }
    return new Staff(
      args.id,
      args.accountSubject,
      args.displayName,
      STAFF_ACCESS_STAFF_STATUS.Active,
      args.now,
      null,
      null,
    );
  }

  public static reconstitute(snapshot: StaffSnapshot): Staff {
    assertStaffSnapshotShape(snapshot);
    assertStaffSnapshotParity(snapshot);
    return new Staff(
      snapshot.id,
      snapshot.accountSubject,
      snapshot.displayName,
      snapshot.status,
      snapshot.createdAt,
      snapshot.suspendedAt,
      snapshot.terminatedAt,
    );
  }

  public accountSubject(): AccountSubject {
    return this.#accountSubject;
  }

  public displayName(): string {
    return this.#displayName;
  }

  public status(): StaffAccessStaffStatus {
    return this.#status;
  }

  public createdAt(): number {
    return this.#createdAt;
  }

  public suspendedAt(): number | null {
    return this.#suspendedAt;
  }

  public terminatedAt(): number | null {
    return this.#terminatedAt;
  }

  public isTerminated(): boolean {
    return this.#status === STAFF_ACCESS_STAFF_STATUS.Terminated;
  }

  /** Đổi nhãn hiển thị directory-local. Không đổi trên staff terminated. */
  public rename(displayName: string, now: number): undefined | DomainError {
    if (typeof displayName !== 'string' || displayName.length > STAFF_DISPLAY_NAME_MAX_LENGTH) {
      throw new TypeError(
        `Staff rename: displayName phải là chuỗi tối đa ${STAFF_DISPLAY_NAME_MAX_LENGTH} ký tự.`,
      );
    }
    if (!Number.isFinite(now)) {
      throw new TypeError('Staff rename: now phải là số hữu hạn.');
    }
    if (this.#status === STAFF_ACCESS_STAFF_STATUS.Terminated) {
      return domainError('staff_terminated');
    }
    this.#displayName = displayName;
    return undefined;
  }

  /** `active → suspended` (hoặc idempotent nếu đã suspended). */
  public suspend(now: number): undefined | DomainError {
    if (!Number.isFinite(now)) {
      throw new TypeError('Staff suspend: now phải là số hữu hạn.');
    }
    if (this.#status === STAFF_ACCESS_STAFF_STATUS.Suspended) {
      return undefined;
    }
    if (
      !STAFF_ACCESS_STAFF_TRANSITIONS[this.#status].includes(STAFF_ACCESS_STAFF_STATUS.Suspended)
    ) {
      return domainError('invalid_transition');
    }
    this.#status = STAFF_ACCESS_STAFF_STATUS.Suspended;
    this.#suspendedAt = now;
    return undefined;
  }

  /** `suspended → active` (hoặc idempotent nếu đã active). */
  public reactivate(now: number): undefined | DomainError {
    if (!Number.isFinite(now)) {
      throw new TypeError('Staff reactivate: now phải là số hữu hạn.');
    }
    if (this.#status === STAFF_ACCESS_STAFF_STATUS.Active) {
      return undefined;
    }
    if (!STAFF_ACCESS_STAFF_TRANSITIONS[this.#status].includes(STAFF_ACCESS_STAFF_STATUS.Active)) {
      return domainError('invalid_transition');
    }
    this.#status = STAFF_ACCESS_STAFF_STATUS.Active;
    this.#suspendedAt = null;
    return undefined;
  }

  /** `active|suspended → terminated`. Terminal — không đường ra. */
  public terminate(now: number): undefined | DomainError {
    if (!Number.isFinite(now)) {
      throw new TypeError('Staff terminate: now phải là số hữu hạn.');
    }
    if (this.#status === STAFF_ACCESS_STAFF_STATUS.Terminated) {
      return domainError('staff_terminated');
    }
    this.#status = STAFF_ACCESS_STAFF_STATUS.Terminated;
    this.#terminatedAt = now;
    return undefined;
  }

  public snapshot(): StaffSnapshot {
    return {
      accountSubject: this.#accountSubject,
      createdAt: this.#createdAt,
      displayName: this.#displayName,
      id: this.#id,
      status: this.#status,
      suspendedAt: this.#suspendedAt,
      terminatedAt: this.#terminatedAt,
    };
  }
}
