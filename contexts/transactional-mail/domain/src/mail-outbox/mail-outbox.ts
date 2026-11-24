/**
 * Entity `MailOutbox` — bản ghi bàn giao một `Mail Command` cho delivery plane.
 *
 * Publish lifecycle (§5.2) — **execution state**, KHÔNG phải trạng
 * thái delivery (§5.3):
 * ```
 * pending ──> publishing ──> published
 *                  │
 *                  └──> failed (bỏ cuộc tự động, còn phục hồi được)
 * ```
 *
 * Hai layer trạng thái độc lập: outbox state là **việc đã bàn giao delivery cho
 * delivery plane hay chưa**; message state là kết quả giao thư. Outbox "bỏ cuộc tự
 * động" KHÔNG phải mất delivery intent — recovery là repair + replay có kiểm soát.
 *
 * Invariants:
 * - Với mỗi `deliveryId`, tối đa một outbox record đang chờ bàn giao được tồn tại
 *   (ràng buộc chống dồn intent) — uniqueness enforce ở DB, domain chỉ mô hình hoá.
 * - Mỗi outbox item được claim bởi đúng một publisher — lease token, claim/publish
 *   luôn sau commit (invariant 11).
 * - Publish state không bao giờ ghi lên delivery outcome.
 * - `publishAttempts` là số lần thử trong chu kỳ publish **hiện tại**; reset về 0 khi
 *   re-enqueue. KHÔNG phải recovery cycle guard — ngân sách A nằm ở `MailMessage`.
 */

import { Entity } from '@ecoma-io/domain-primitives';
import type { Brand } from '@ecoma-io/domain-primitives';

import { mailDomainError } from '../shared/errors';
import type { MailDomainError } from '../shared/errors';
import type { DeliveryId } from '../mail-message/mail-message';

/** Id của outbox row — `obx_` theo §4.3. */
export type MailOutboxId = Brand<string, 'MailOutboxId'>;

/** Trạng thái publish của outbox. */
export type MailOutboxStatus = 'pending' | 'publishing' | 'published' | 'failed';

/** Bảng transition tường minh. */
export const MAIL_OUTBOX_TRANSITIONS: Record<MailOutboxStatus, readonly MailOutboxStatus[]> = {
  failed: ['pending'],
  pending: ['publishing'],
  published: [],
  publishing: ['published', 'failed'],
};

export interface MailOutboxSnapshot {
  readonly id: MailOutboxId;
  readonly deliveryId: DeliveryId;
  /** Bản sao generation của lần dispatch mà row này đại diện. */
  readonly dispatchGeneration: number;
  readonly status: MailOutboxStatus;
  /** Số lần thử trong chu kỳ publish hiện tại; reset về 0 khi re-enqueue. */
  readonly publishAttempts: number;
  /** Epoch ms sớm nhất được claim; publish retry đẩy ra sau theo backoff. */
  readonly availableAtMs: number;
  readonly claimedAtMs: number | null;
  /** Token fencing của lease — cùng null hoặc cùng có (lease pair constraint). */
  readonly claimedBy: string | null;
  readonly publishedAtMs: number | null;
  /** Error code/token đã sanitize — không chứa recipient, nội dung render hay credential. */
  readonly lastError: string | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export class MailOutbox extends Entity<MailOutboxId> {
  #deliveryId: DeliveryId;
  #dispatchGeneration: number;
  #status: MailOutboxStatus;
  #publishAttempts: number;
  #availableAtMs: number;
  #claimedAtMs: number | null;
  #claimedBy: string | null;
  #publishedAtMs: number | null;
  #lastError: string | null;
  readonly #createdAtMs: number;
  #updatedAtMs: number;

  private constructor(snapshot: MailOutboxSnapshot) {
    super(snapshot.id);
    this.#deliveryId = snapshot.deliveryId;
    this.#dispatchGeneration = snapshot.dispatchGeneration;
    this.#status = snapshot.status;
    this.#publishAttempts = snapshot.publishAttempts;
    this.#availableAtMs = snapshot.availableAtMs;
    this.#claimedAtMs = snapshot.claimedAtMs;
    this.#claimedBy = snapshot.claimedBy;
    this.#publishedAtMs = snapshot.publishedAtMs;
    this.#lastError = snapshot.lastError;
    this.#createdAtMs = snapshot.createdAtMs;
    this.#updatedAtMs = snapshot.updatedAtMs;
  }

  /**
   * Tạo outbox row mới — cùng lượt với message, `status = pending`.
   * Statement 2 của `createWithOutbox` cố ý không có ON CONFLICT DO NOTHING:
   * `deliveryId` trùng là bug phía caller — ràng buộc vỡ làm toàn bộ batch rollback
   * (fail closed, không nuốt lỗi) — điều đó thuộc tầng persistence; domain chỉ
   * đảm bảo không tự tạo row ở trạng thái khác `pending`.
   */
  public static issue(args: {
    id: MailOutboxId;
    deliveryId: DeliveryId;
    dispatchGeneration: number;
    availableAtMs: number;
    nowMs: number;
  }): MailOutbox {
    if (!Number.isFinite(args.nowMs) || !Number.isFinite(args.availableAtMs)) {
      throw new TypeError('MailOutbox issue: timestamp phải là số hữu hạn.');
    }
    if (!Number.isSafeInteger(args.dispatchGeneration) || args.dispatchGeneration < 1) {
      throw new TypeError('MailOutbox issue: dispatchGeneration phải là safe integer dương.');
    }
    if (args.id.length === 0 || args.deliveryId.length === 0) {
      throw new TypeError('MailOutbox issue: identifier không được rỗng.');
    }
    return new MailOutbox({
      availableAtMs: args.availableAtMs,
      claimedAtMs: null,
      claimedBy: null,
      createdAtMs: args.nowMs,
      deliveryId: args.deliveryId,
      dispatchGeneration: args.dispatchGeneration,
      id: args.id,
      lastError: null,
      publishAttempts: 0,
      publishedAtMs: null,
      status: 'pending',
      updatedAtMs: args.nowMs,
    });
  }

  /**
   * Tái tạo từ persistence — kiểm parity lease (claimedAtMs và claimedBy cùng null
   * hoặc cùng có) và parity published (publishedAtMs ⇔ status published).
   */
  public static reconstitute(snapshot: MailOutboxSnapshot): MailOutbox {
    if (
      snapshot.id.length === 0 ||
      snapshot.deliveryId.length === 0 ||
      !Number.isSafeInteger(snapshot.dispatchGeneration) ||
      snapshot.dispatchGeneration < 1 ||
      !Number.isSafeInteger(snapshot.publishAttempts) ||
      snapshot.publishAttempts < 0 ||
      !Number.isFinite(snapshot.createdAtMs) ||
      !Number.isFinite(snapshot.updatedAtMs) ||
      !Number.isFinite(snapshot.availableAtMs)
    ) {
      throw new TypeError('MailOutbox snapshot không hợp lệ.');
    }
    // Lease pair: cùng null hoặc cùng có.
    if ((snapshot.claimedAtMs === null) !== (snapshot.claimedBy === null)) {
      throw new TypeError('MailOutbox snapshot: lease pair bị vi phạm.');
    }
    // Publishing bắt buộc đang lease.
    if (snapshot.status === 'publishing' && snapshot.claimedBy === null) {
      throw new TypeError('MailOutbox snapshot: publishing phải đang được claim.');
    }
    // Published parity.
    if ((snapshot.status === 'published') !== (snapshot.publishedAtMs !== null)) {
      throw new TypeError('MailOutbox snapshot: published parity bị vi phạm.');
    }
    return new MailOutbox(snapshot);
  }

  public status(): MailOutboxStatus {
    return this.#status;
  }

  public deliveryId(): DeliveryId {
    return this.#deliveryId;
  }

  public dispatchGeneration(): number {
    return this.#dispatchGeneration;
  }

  public publishAttempts(): number {
    return this.#publishAttempts;
  }

  public claimedBy(): string | null {
    return this.#claimedBy;
  }

  public snapshot(): MailOutboxSnapshot {
    return {
      availableAtMs: this.#availableAtMs,
      claimedAtMs: this.#claimedAtMs,
      claimedBy: this.#claimedBy,
      createdAtMs: this.#createdAtMs,
      deliveryId: this.#deliveryId,
      dispatchGeneration: this.#dispatchGeneration,
      id: this.id,
      lastError: this.#lastError,
      publishAttempts: this.#publishAttempts,
      publishedAtMs: this.#publishedAtMs,
      status: this.#status,
      updatedAtMs: this.#updatedAtMs,
    };
  }

  /**
   * Publisher claim row — `pending → publishing`, gắn lease token.
   * Claim là conditional-write ở persistence (predicate `status = 'pending'`); domain
   * chỉ nhận khi chưa claim và chưa published.
   */
  public claim(publisherId: string, nowMs: number): void | MailDomainError {
    if (!Number.isFinite(nowMs)) {
      throw new TypeError('MailOutbox claim: nowMs phải là số hữu hạn.');
    }
    if (publisherId.length === 0) {
      throw new TypeError('MailOutbox claim: publisherId không được rỗng.');
    }
    if (this.#status !== 'pending') {
      return mailDomainError('invalid_transition');
    }
    this.#status = 'publishing';
    this.#claimedBy = publisherId;
    this.#claimedAtMs = nowMs;
    this.#publishAttempts += 1;
    this.#updatedAtMs = Math.max(nowMs, this.#updatedAtMs);
  }

  /**
   * Bàn giao thành công — `publishing → published`.
   * Publisher chỉ ghi outbox; KHÔNG BAO GIỜ ghi message `sent`/`failed`/`blocked`
   * (invariant 15) — việc đó là của outcome callback trên MailMessage.
   */
  public markPublished(nowMs: number): void | MailDomainError {
    if (!Number.isFinite(nowMs)) {
      throw new TypeError('MailOutbox markPublished: nowMs phải là số hữu hạn.');
    }
    if (this.#status !== 'publishing') {
      return mailDomainError('invalid_transition');
    }
    this.#status = 'published';
    this.#publishedAtMs = nowMs;
    this.#updatedAtMs = Math.max(nowMs, this.#updatedAtMs);
  }

  /**
   * Bỏ cuộc tự động sau ngưỡng — `publishing → failed`, kèm error token đã sanitize.
   * "Bỏ cuộc" KHÔNG phải mất delivery intent: record và message vẫn còn; recovery là
   * repair ({@link repair}) có authorize.
   */
  public markFailed(sanitizedError: string, nowMs: number): void | MailDomainError {
    if (!Number.isFinite(nowMs)) {
      throw new TypeError('MailOutbox markFailed: nowMs phải là số hữu hạn.');
    }
    if (this.#status !== 'publishing') {
      return mailDomainError('invalid_transition');
    }
    if (sanitizedError.length === 0) {
      throw new TypeError('MailOutbox markFailed: sanitizedError không được rỗng.');
    }
    this.#status = 'failed';
    this.#lastError = sanitizedError;
    this.#updatedAtMs = Math.max(nowMs, this.#updatedAtMs);
  }

  /**
   * Repair — đường DUY NHẤT reset trạng thái bỏ cuộc (`failed → pending`), cùng
   * `deliveryId`, cùng generation, tiêu một slot của ngân sách phục hồi chu kỳ
   * (việc charge ngân sách nằm ở {@link MailMessage.chargeRecoveryCycle}; method này
   * chỉ reset publish state).
   */
  public repair(backoffMs: number, nowMs: number): void | MailDomainError {
    if (!Number.isFinite(nowMs) || !Number.isFinite(backoffMs) || backoffMs < 0) {
      throw new TypeError('MailOutbox repair: timestamp phải là số hữu hạn không âm.');
    }
    if (this.#status !== 'failed') {
      return mailDomainError('invalid_transition');
    }
    this.#status = 'pending';
    this.#claimedBy = null;
    this.#claimedAtMs = null;
    this.#publishAttempts = 0;
    this.#availableAtMs = nowMs + backoffMs;
    this.#updatedAtMs = Math.max(nowMs, this.#updatedAtMs);
  }
}
