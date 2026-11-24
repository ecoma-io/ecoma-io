/**
 * Aggregate `MailMessage` — lá thư đã render, aggregate root của context transactional-mail.
 *
 * Business lifecycle (§5.1):
 * ```
 * accepted ──> queued ──> sent
 *                  │        └──> failed (terminal, per-message)
 *                  └──> blocked (non-terminal, system-level)
 * ```
 *
 * - `accepted` = request đã được chấp nhận bền vững; publisher chưa ghi nhận bàn giao.
 * - `queued` = generation hiện tại đã authorize và đang in-flight.
 * - `sent` = provider đã chấp nhận gửi (KHÔNG phải bằng chứng thư tới inbox).
 * - `failed` = terminal per-message.
 * - `blocked` = non-terminal, system-level; redrive được — nhưng **không bao giờ tự
 *   gửi lại chỉ vì hết thời gian** (§9): redrive là thao tác control-plane có authorize
 *   tường minh qua {@link MailMessage.redrive}, không phải việc xoá marker ngầm hiểu.
 *
 * Invariants chính:
 * - Hai layer trạng thái độc lập (§5.3): message state là **trạng thái của delivery**;
 *   publish state của outbox KHÔNG BAO GIỜ ghi lên message và ngược lại. Outcome callback
 *   không bao giờ lùi trạng thái hay ghi đè outcome của generation mới hơn.
 * - Fencing qua `dispatchGeneration`: chỉ redrive có authorize tăng nó; callback generation
 *   lệch là `stale` — không ghi gì.
 * - Ngân sách A `recoveryCycleCount` **chỉ tăng, không reset** (invariant 14, §8).
 * - Terminal parity: `terminalAt` khác null ⇔ trạng thái là `sent`/`failed` — `blocked`
 *   là non-terminal nên vẫn null.
 * - Không persist `variables` — chỉ `templateVersion` đã chọn + nội dung đã render (FR-007).
 * - `failureReason` chỉ chứa `error_class` đã validate — không bao giờ chuỗi tự do.
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';
import type { Brand } from '@ecoma-io/domain-primitives';

import { mailDomainError } from '../shared/errors';
import type { MailDomainError } from '../shared/errors';
import type { Recipient } from './recipient';
import type { NormalizedLocale } from './normalized-locale';

/** Định danh message — `msg_` theo §4.2; id strategy là decision mở của tầng application. */
export type MailMessageId = Brand<string, 'MailMessageId'>;

/** Định danh logical của việc giao — một message có đúng một `delivery_id` (UNIQUE). */
export type DeliveryId = Brand<string, 'DeliveryId'>;

/** Trạng thái nghiệp vụ của message — `accepted | queued | sent | failed | blocked`. */
export type MailMessageStatus = 'accepted' | 'queued' | 'sent' | 'failed' | 'blocked';

/** Outcome của delivery plane — đúng năm giá trị canonical. */
export type MailOutcome = 'sent' | 'failed' | 'blocked';

/** Lớp lỗi canonical — tập đóng, chỉ mở rộng khi có quyết định ở canonical contract. */
export type MailErrorClass =
  | 'provider_rejected'
  | 'provider_unavailable'
  | 'invalid_content'
  | 'recipient_rejected'
  | 'system_error';

/** Trạng thái terminal của message — parity với `terminal_at IS NOT NULL`. */
const TERMINAL_STATUSES: ReadonlySet<MailMessageStatus> = new Set(['sent', 'failed']);

/** Bảng transition tường minh — nguồn cho table-driven state tests. */
export const MAIL_MESSAGE_TRANSITIONS: Record<MailMessageStatus, readonly MailMessageStatus[]> = {
  accepted: ['queued', 'blocked'],
  queued: ['sent', 'failed', 'blocked'],
  sent: [],
  failed: [],
  blocked: ['queued'],
};

export function isMailMessageTerminal(status: MailMessageStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export interface MailMessageSnapshot {
  readonly id: MailMessageId;
  readonly deliveryId: DeliveryId;
  readonly app: string;
  readonly principalId: string;
  readonly templateName: string;
  readonly templateVersion: number;
  readonly locale: NormalizedLocale;
  /** Nhạy cảm — không đưa vào log, queue payload hay error message. */
  readonly recipient: Recipient;
  readonly subjectRendered: string;
  readonly bodyRendered: string;
  readonly status: MailMessageStatus;
  /** Fencing: chỉ redrive có authorize tăng nó. */
  readonly dispatchGeneration: number;
  /** Ngân sách A — chỉ tăng, không reset. */
  readonly recoveryCycleCount: number;
  /** Chỉ chứa `error_class` đã validate — không bao giờ là chuỗi tự do của caller. */
  readonly failureReason: MailErrorClass | null;
  /** Null đúng khi trạng thái KHÔNG terminal (parity constraint). */
  readonly terminalAtMs: number | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

/** Lý do outcome callback bị từ chối — thứ tự kiểm tra cố định của §6.2.2. */
export type OutcomeRejection = 'generation_mismatch' | 'terminal' | 'wrong_state';

/** Có ký tự control (C0, trừ tab; DEL) — loop code point, không control-regex. */
function subjectHasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const cp = value.codePointAt(i) ?? 0;
    if ((cp < 0x20 && cp !== 0x09) || cp === 0x7f) {
      return true;
    }
  }
  return false;
}

export class MailMessage extends AggregateRoot<MailMessageId> {
  #deliveryId: DeliveryId;
  readonly #app: string;
  readonly #principalId: string;
  readonly #templateName: string;
  readonly #templateVersion: number;
  readonly #locale: NormalizedLocale;
  readonly #recipient: Recipient;
  readonly #subjectRendered: string;
  readonly #bodyRendered: string;
  #status: MailMessageStatus;
  #dispatchGeneration: number;
  #recoveryCycleCount: number;
  #failureReason: MailErrorClass | null;
  #terminalAtMs: number | null;
  readonly #createdAtMs: number;
  #updatedAtMs: number;

  private constructor(snapshot: MailMessageSnapshot) {
    super(snapshot.id);
    this.#deliveryId = snapshot.deliveryId;
    this.#app = snapshot.app;
    this.#principalId = snapshot.principalId;
    this.#templateName = snapshot.templateName;
    this.#templateVersion = snapshot.templateVersion;
    this.#locale = snapshot.locale;
    this.#recipient = snapshot.recipient;
    this.#subjectRendered = snapshot.subjectRendered;
    this.#bodyRendered = snapshot.bodyRendered;
    this.#status = snapshot.status;
    this.#dispatchGeneration = snapshot.dispatchGeneration;
    this.#recoveryCycleCount = snapshot.recoveryCycleCount;
    this.#failureReason = snapshot.failureReason;
    this.#terminalAtMs = snapshot.terminalAtMs;
    this.#createdAtMs = snapshot.createdAtMs;
    this.#updatedAtMs = snapshot.updatedAtMs;
  }

  /**
   * Tạo message mới — generation 1, ngân sách phục hồi 0, trạng thái `accepted`.
   *
   * Validation ở entry point: mọi giá trị do caller cung cấp đều được kiểm, vì
   * issue() không được tạo state mà reconstitute() sẽ từ chối (convention §11).
   */
  public static issue(args: {
    id: MailMessageId;
    deliveryId: DeliveryId;
    app: string;
    principalId: string;
    templateName: string;
    templateVersion: number;
    locale: NormalizedLocale;
    recipient: Recipient;
    subjectRendered: string;
    bodyRendered: string;
    nowMs: number;
  }): MailMessage | MailDomainError {
    if (!Number.isFinite(args.nowMs)) {
      throw new TypeError('MailMessage issue: nowMs phải là số hữu hạn.');
    }
    if (
      args.id.length === 0 ||
      args.deliveryId.length === 0 ||
      args.app.length === 0 ||
      args.principalId.length === 0 ||
      args.templateName.length === 0
    ) {
      throw new TypeError('MailMessage issue: identifier không được rỗng.');
    }
    if (!Number.isSafeInteger(args.templateVersion) || args.templateVersion < 1) {
      throw new TypeError('MailMessage issue: templateVersion phải là safe integer dương.');
    }
    if (args.subjectRendered.length === 0 || args.bodyRendered.length === 0) {
      throw new TypeError('MailMessage issue: nội dung render không được rỗng.');
    }
    // Control character (trừ tab) trong subject là lỗi — CR/LF là header injection.
    if (subjectHasControlCharacter(args.subjectRendered)) {
      throw new TypeError('MailMessage issue: nội dung render không hợp lệ.');
    }
    return new MailMessage({
      app: args.app,
      bodyRendered: args.bodyRendered,
      createdAtMs: args.nowMs,
      deliveryId: args.deliveryId,
      dispatchGeneration: 1,
      failureReason: null,
      id: args.id,
      locale: args.locale,
      principalId: args.principalId,
      recipient: args.recipient,
      recoveryCycleCount: 0,
      status: 'accepted',
      subjectRendered: args.subjectRendered,
      templateName: args.templateName,
      templateVersion: args.templateVersion,
      terminalAtMs: null,
      updatedAtMs: args.nowMs,
    });
  }

  /**
   * Tái tạo từ persistence — kiểm **đầy đủ** tính tựConsistency của snapshot.
   * Dữ liệu tự mâu thuẫn từ DB là dữ liệu hỏng: từ chối, không tin persistence.
   */
  public static reconstitute(snapshot: MailMessageSnapshot): MailMessage {
    if (
      snapshot.id.length === 0 ||
      snapshot.deliveryId.length === 0 ||
      !Number.isSafeInteger(snapshot.dispatchGeneration) ||
      snapshot.dispatchGeneration < 1 ||
      !Number.isSafeInteger(snapshot.recoveryCycleCount) ||
      snapshot.recoveryCycleCount < 0 ||
      !Number.isSafeInteger(snapshot.templateVersion) ||
      snapshot.templateVersion < 1 ||
      !Number.isFinite(snapshot.createdAtMs) ||
      !Number.isFinite(snapshot.updatedAtMs) ||
      snapshot.updatedAtMs < snapshot.createdAtMs
    ) {
      throw new TypeError('MailMessage snapshot không hợp lệ.');
    }
    // Terminal parity: terminal ⇔ terminalAtMs khác null (blocked vẫn null).
    const terminal = isMailMessageTerminal(snapshot.status);
    if (terminal !== (snapshot.terminalAtMs !== null)) {
      throw new TypeError('MailMessage snapshot: terminal parity bị vi phạm.');
    }
    // Terminal phải có failureReason khi failed.
    if (snapshot.status === 'failed' && snapshot.failureReason === null) {
      throw new TypeError('MailMessage snapshot: failed phải có failureReason.');
    }
    if (snapshot.status !== 'failed' && snapshot.failureReason !== null) {
      throw new TypeError('MailMessage snapshot: failureReason chỉ tồn tại ở failed.');
    }
    return new MailMessage(snapshot);
  }

  /** Định danh aggregate (`msg_id`). */
  public override get id(): MailMessageId {
    return super.id;
  }

  public deliveryId(): DeliveryId {
    return this.#deliveryId;
  }

  public status(): MailMessageStatus {
    return this.#status;
  }

  public dispatchGeneration(): number {
    return this.#dispatchGeneration;
  }

  public recoveryCycleCount(): number {
    return this.#recoveryCycleCount;
  }

  public failureReason(): MailErrorClass | null {
    return this.#failureReason;
  }

  public snapshot(): MailMessageSnapshot {
    return {
      app: this.#app,
      bodyRendered: this.#bodyRendered,
      createdAtMs: this.#createdAtMs,
      deliveryId: this.#deliveryId,
      dispatchGeneration: this.#dispatchGeneration,
      failureReason: this.#failureReason,
      id: this.id,
      locale: this.#locale,
      principalId: this.#principalId,
      recipient: this.#recipient,
      recoveryCycleCount: this.#recoveryCycleCount,
      status: this.#status,
      subjectRendered: this.#subjectRendered,
      templateName: this.#templateName,
      templateVersion: this.#templateVersion,
      terminalAtMs: this.#terminalAtMs,
      updatedAtMs: this.#updatedAtMs,
    };
  }

  /**
   * Ghi outcome của worker — đường DUY NHẤT ghi các trạng thái `sent`/`failed`/`blocked`.
   *
   * Thứ tự kiểm tra cố định (§6.2.2) — không phụ thuộc thứ tự callback đến:
   * 1. `dispatchGeneration` lệch → `generation_mismatch` (stale) — không ghi gì.
   * 2. trạng thái đã bằng chính outcome đó → duplicate — không ghi gì, trả `undefined`.
   * 3. trạng thái ∈ {accepted, queued} → áp dụng outcome.
   * 4. còn lại (blocked non-terminal với outcome khác, sent/failed terminal) → stale.
   *
   * ⚠️ `stale` không phải success: caller (application layer) phân loại HTTP response
   * và không ghi gì lên trạng thái.
   *
   * @returns `null` khi duplicate (đã bằng outcome); `MailDomainError` khi stale.
   */
  public applyOutcome(
    outcome: MailOutcome,
    dispatchGeneration: number,
    errorClass: MailErrorClass | null,
    nowMs: number,
  ): 'applied' | 'duplicate' | MailDomainError {
    if (!Number.isFinite(nowMs)) {
      throw new TypeError('MailMessage applyOutcome: nowMs phải là số hữu hạn.');
    }
    // 1. Fencing — generation lệch là stale, không ghi gì.
    if (dispatchGeneration !== this.#dispatchGeneration) {
      return mailDomainError('generation_mismatch');
    }
    // 2. Duplicate — cùng outcome trên cùng generation là no-op.
    if (this.#status === outcome) {
      return 'duplicate';
    }
    // 3. Chỉ accepted/queued nhận outcome — predicate chống lùi trạng thái.
    if (this.#status !== 'accepted' && this.#status !== 'queued') {
      return mailDomainError('invalid_transition');
    }
    // failed bắt buộc kèm error_class; sent/blocked không có.
    if (outcome === 'failed' && errorClass === null) {
      throw new TypeError('MailMessage applyOutcome: failed phải kèm errorClass.');
    }
    if (outcome !== 'failed' && errorClass !== null) {
      throw new TypeError('MailMessage applyOutcome: errorClass chỉ có ở failed.');
    }
    this.#status = outcome;
    this.#failureReason = outcome === 'failed' ? errorClass : null;
    if (outcome === 'sent' || outcome === 'failed') {
      this.#terminalAtMs = nowMs;
    }
    this.#updatedAtMs = Math.max(nowMs, this.#updatedAtMs);
    return 'applied';
  }

  /**
   * Publisher đánh dấu generation hiện tại đang in-flight: `accepted → queued`.
   * ⚠️ Publisher KHÔNG BAO GIỜ ghi `queued` đè `sent`/`failed`/`blocked` (invariant 15)
   * — mọi trạng thái khác `accepted` đều từ chối.
   */
  public markQueued(nowMs: number): void | MailDomainError {
    if (!Number.isFinite(nowMs)) {
      throw new TypeError('MailMessage markQueued: nowMs phải là số hữu hạn.');
    }
    if (this.#status !== 'accepted') {
      return mailDomainError('invalid_transition');
    }
    this.#status = 'queued';
    this.#updatedAtMs = Math.max(nowMs, this.#updatedAtMs);
  }

  /**
   * Redrive (`blocked → queued`) — thao tác control-plane có authorize tường minh.
   *
   * Mở một generation mới đúng một bước (dispatchGeneration + 1), KHÔNG tạo delivery
   * mới, KHÔNG reset ngân sách phục hồi — bộ đếm chỉ tăng (§8, invariant 14).
   * Chỉ áp dụng khi `status = blocked`; `sent`/`failed` → từ chối.
   */
  public redrive(nowMs: number): void | MailDomainError {
    if (!Number.isFinite(nowMs)) {
      throw new TypeError('MailMessage redrive: nowMs phải là số hữu hạn.');
    }
    if (this.#status !== 'blocked') {
      return mailDomainError('not_blocked');
    }
    this.#status = 'queued';
    this.#dispatchGeneration += 1;
    this.#updatedAtMs = Math.max(nowMs, this.#updatedAtMs);
  }

  /**
   * Tiêu một slot của ngân sách phục hồi chu kỳ — repair gọi; **chỉ tăng** (§8).
   * Ngân sách kiệt do application layer kiểm trước khi gọi (giá trị cấu hình ở deploy);
   * method này chỉ bảo đảm monotonicity.
   */
  public chargeRecoveryCycle(): void {
    this.#recoveryCycleCount += 1;
  }
}
