/**
 * Logical request — aggregate root của bounded context `llm-inference`.
 *
 * Aggregate này sở hữu vòng đời của một yêu cầu suy luận: trạng thái, các
 * provider attempt, dữ kiện delivery tới client, và quyết định xem có được phép
 * thêm attempt hay không. Nó **không** sở hữu quota, usage, tiền tệ, chọn
 * candidate, xếp thứ tự fallback, persistence hay idempotency bền — tất cả là
 * input của caller hoặc thuộc bounded context khác.
 *
 * Fail-safe: mọi ngã mà domain không đủ căn cứ để kết luận đều bị từ chối bằng
 * domain error, không được suy diễn thành "provider đã dừng".
 *
 * Aggregate được dịch từ kiểu dữ liệu thuần cũ sang `AggregateRoot<RequestId>`
 * của `@ecoma-io/domain-primitives`: constructor private, static factory
 * `create()` và `reconstitute()` (validate snapshot, từ chối data tự ngược nhau),
 * `snapshot()` trả state readonly frozen. Các mutation phương thức thay đổi
 * state nội bộ và trả `InferenceResult<void>` thay vì trả instance mới.
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';

import {
  classifyAttemptOutcome,
  isAttemptOpen,
  isAttemptUncertain,
  isProviderAttempt,
  type AttemptOutcome,
  type ProviderAttempt,
} from '../attempt/attempt';
import {
  commitClientResponse,
  hasClientOutputCommitted,
  INITIAL_CLIENT_DELIVERY,
  isClientDelivery,
  recordClientDisconnect,
  type ClientDelivery,
} from '../delivery/delivery';
import {
  canTransitionEvidence,
  EXECUTION_EVIDENCE,
  isExecutionEvidence,
  type ExecutionEvidence,
} from '../evidence/evidence';
import { isExecutionPolicy, validateExecutionPolicy, type ExecutionPolicy } from '../policy/policy';
import {
  inferenceFailure,
  inferenceOk,
  isAttemptId,
  isEpochMillis,
  isOpaqueId,
  isRequestId,
  type InferenceResult,
  type RequestId,
} from '../shared/shared';

// ---------------------------------------------------------------------------
// Trạng thái và hoàn tất
// ---------------------------------------------------------------------------

/**
 * Trạng thái vòng đời của logical request.
 *
 * - `open` — còn có thể append attempt; chưa terminal.
 * - `reconciling` — còn attempt `may_have_executed` chưa được provider xác
 *   nhận; **không** append attempt mới, **không** terminal. Trạng thái này giữ
 *   cho "chưa xác định" khác biệt với "đã thất bại".
 * - `completed` / `failed` / `cancelled` — terminal.
 */
export type LogicalRequestStatus = 'open' | 'reconciling' | 'completed' | 'failed' | 'cancelled';

/** Lý do request kết thúc không thành công. */
export type RequestCancellationReason =
  | 'client_cancelled'
  | 'deadline_exceeded'
  | 'policy_cancelled';

/** Bản ghi kết thúc của logical request. */
export interface RequestCompletion {
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly closedAt: number;
  readonly reason: RequestCancellationReason | null;
}

/** State readonly của aggregate — dùng cho view function và rehydrate. */
export interface LogicalRequestSnapshot {
  readonly requestId: RequestId;
  readonly admittedAt: number;
  readonly policy: ExecutionPolicy;
  readonly status: LogicalRequestStatus;
  /** Attempt theo thứ tự `sequence` tăng dần; phần tử cuối là attempt mới nhất. */
  readonly attempts: readonly ProviderAttempt[];
  readonly delivery: ClientDelivery;
  /** Chỉ khác `null` khi request đã terminal. */
  readonly completion: RequestCompletion | null;
}

/** Structural view của state, dùng cho các pure-function module. */
export interface LogicalRequestView {
  readonly status: LogicalRequestStatus;
  readonly policy: ExecutionPolicy;
  readonly attempts: readonly ProviderAttempt[];
  readonly delivery: ClientDelivery;
}

const TERMINAL_STATUSES: readonly LogicalRequestStatus[] = Object.freeze([
  'completed',
  'failed',
  'cancelled',
]);

/** Trạng thái đã terminal — không attempt mới, không chuyển trạng thái nữa. */
export function isTerminalStatus(status: LogicalRequestStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Request đã terminal. */
export function isRequestTerminal(view: LogicalRequestView): boolean {
  return isTerminalStatus(view.status);
}

/** Attempt cuối cùng theo thứ tự ghi nhận, nếu có. */
export function latestAttempt(attempts: readonly ProviderAttempt[]): ProviderAttempt | null {
  return attempts.length === 0 ? null : attempts[attempts.length - 1];
}

/** Attempt đang mở (tối đa một), nếu có. */
export function findOpenAttempt(attempts: readonly ProviderAttempt[]): ProviderAttempt | null {
  return attempts.find(isAttemptOpen) ?? null;
}

/** Có attempt `may_have_executed` chưa được reconcile hay không. */
export function hasUnresolvedUncertainty(attempts: readonly ProviderAttempt[]): boolean {
  return attempts.some(isAttemptUncertain);
}

/** Tìm attempt theo định danh; `null` khi không thuộc request này. */
export function findAttempt(
  attempts: readonly ProviderAttempt[],
  attemptId: unknown,
): ProviderAttempt | null {
  if (!isAttemptId(attemptId)) {
    return null;
  }
  return attempts.find((attempt) => attempt.attemptId === attemptId) ?? null;
}

/** Type guard cho `LogicalRequestSnapshot` — dùng khi rehydrate từ persistence. */
export function isLogicalRequestSnapshot(value: unknown): value is LogicalRequestSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const request = value as LogicalRequestSnapshot;
  if (
    !isRequestId(request.requestId) ||
    !isEpochMillis(request.admittedAt) ||
    !isExecutionPolicy(request.policy) ||
    !isClientDelivery(request.delivery) ||
    !Array.isArray(request.attempts) ||
    !request.attempts.every(isProviderAttempt)
  ) {
    return false;
  }
  if (request.policy.deadlineAt <= request.admittedAt) {
    return false;
  }
  // Attempt phải liên tục 1..n và không trùng định danh — domain luôn sinh như vậy.
  const ids = new Set<string>();
  let lastRecordedAt = request.admittedAt;
  for (const [index, attempt] of request.attempts.entries()) {
    if (attempt.sequence !== index + 1 || ids.has(attempt.attemptId)) {
      return false;
    }
    if (attempt.recordedAt < lastRecordedAt) {
      return false;
    }
    ids.add(attempt.attemptId);
    lastRecordedAt = attempt.recordedAt;
  }
  if (request.delivery.committedAt !== null && request.delivery.committedAt < request.admittedAt) {
    return false;
  }
  if (
    request.delivery.disconnectedAt !== null &&
    request.delivery.disconnectedAt < request.admittedAt
  ) {
    return false;
  }

  if (
    request.status !== 'open' &&
    request.status !== 'reconciling' &&
    !isTerminalStatus(request.status)
  ) {
    return false;
  }

  if (request.status === 'open') {
    return request.completion === null;
  }
  if (request.status === 'reconciling') {
    // Chỉ tồn tại sau `awaitReconciliation`: không attempt mở, còn bất định.
    return (
      request.completion === null &&
      findOpenAttempt(request.attempts) === null &&
      hasUnresolvedUncertainty(request.attempts)
    );
  }

  const completion = request.completion;
  if (completion === null) {
    return false;
  }
  if (
    completion.status !== request.status ||
    !isEpochMillis(completion.closedAt) ||
    completion.closedAt < request.admittedAt ||
    completion.closedAt < lastRecordedAt
  ) {
    return false;
  }
  if (request.status === 'cancelled' ? completion.reason === null : completion.reason !== null) {
    return false;
  }
  // Terminal không bao giờ còn attempt mở hay bất định chưa xử lý.
  if (findOpenAttempt(request.attempts) !== null || hasUnresolvedUncertainty(request.attempts)) {
    return false;
  }
  if (request.status === 'completed') {
    return request.attempts.some(
      (attempt) => attempt.evidence === EXECUTION_EVIDENCE.confirmed_completed,
    );
  }
  return true;
}

/** Input admission của một logical request. */
export interface CreateLogicalRequestInput {
  readonly requestId: unknown;
  readonly admittedAt: unknown;
  readonly policy: unknown;
}

// ---------------------------------------------------------------------------
// Retry admissibility — luật duy nhất của domain (pure-function module)
// ---------------------------------------------------------------------------

/** Lý do một attempt mới không được phép. */
export type RetryRejectionReason =
  | 'request_closed'
  | 'requires_reconciliation'
  | 'attempt_in_flight'
  | 'client_output_committed'
  | 'deadline_exhausted'
  | 'attempts_exhausted'
  | 'previous_attempt_uncertain'
  | 'previous_attempt_completed';

/** Kết quả đánh giá quyền append attempt. */
export type RetryDecision =
  | { readonly admissible: true; readonly nextSequence: number }
  | { readonly admissible: false; readonly reason: RetryRejectionReason };

/**
 * Đánh giá **duy nhất** trong domain này về việc có được append thêm attempt
 * cho logical request hay không.
 *
 * Thứ tự kiểm tra là contract ổn định (xem domain design §6): terminal →
 * reconciling → attempt đang mở → byte đã tới client → deadline → hết budget →
 * evidence chặn retry.
 *
 * Hàm này trả lời "execution có được tiếp tục hay không". Nó **không** trả lời
 * "candidate nào kế tiếp" — đó là quyết định của `llm-consumer-routing`.
 */
export function evaluateRetryAdmissibility(
  request: LogicalRequestView,
  input: { readonly now: unknown },
): InferenceResult<RetryDecision> {
  if (!isEpochMillis(input.now)) {
    return inferenceFailure('invalid_timestamp');
  }
  const now = input.now;

  if (isTerminalStatus(request.status)) {
    return inferenceOk({ admissible: false, reason: 'request_closed' });
  }
  if (request.status === 'reconciling') {
    return inferenceOk({ admissible: false, reason: 'requires_reconciliation' });
  }
  if (findOpenAttempt(request.attempts) !== null) {
    return inferenceOk({ admissible: false, reason: 'attempt_in_flight' });
  }
  if (hasClientOutputCommitted(request.delivery)) {
    return inferenceOk({ admissible: false, reason: 'client_output_committed' });
  }
  if (now >= request.policy.deadlineAt) {
    return inferenceOk({ admissible: false, reason: 'deadline_exhausted' });
  }
  if (request.attempts.length >= request.policy.maxAttempts) {
    return inferenceOk({ admissible: false, reason: 'attempts_exhausted' });
  }
  const previous = latestAttempt(request.attempts);
  if (hasUnresolvedUncertainty(request.attempts)) {
    return inferenceOk({ admissible: false, reason: 'previous_attempt_uncertain' });
  }
  if (previous !== null && previous.evidence === EXECUTION_EVIDENCE.confirmed_completed) {
    return inferenceOk({ admissible: false, reason: 'previous_attempt_completed' });
  }
  return inferenceOk({ admissible: true, nextSequence: request.attempts.length + 1 });
}

// ---------------------------------------------------------------------------
// LogicalRequest — aggregate root
// ---------------------------------------------------------------------------

export class LogicalRequest extends AggregateRoot<RequestId> {
  readonly #admittedAt: number;
  readonly #policy: ExecutionPolicy;
  #status: LogicalRequestStatus;
  #attempts: readonly ProviderAttempt[];
  #delivery: ClientDelivery;
  #completion: RequestCompletion | null;

  private constructor(
    requestId: RequestId,
    admittedAt: number,
    policy: ExecutionPolicy,
    status: LogicalRequestStatus,
    attempts: readonly ProviderAttempt[],
    delivery: ClientDelivery,
    completion: RequestCompletion | null,
  ) {
    super(requestId);
    this.#admittedAt = admittedAt;
    this.#policy = policy;
    this.#status = status;
    this.#attempts = attempts;
    this.#delivery = delivery;
    this.#completion = completion;
  }

  /**
   * Tạo logical request đã được admit, ở trạng thái `open`, chưa có attempt.
   *
   * Admission (auth + quota reserve) đã xảy ra trước đó và do `llm-api` sở hữu;
   * operation này chỉ validate phần dữ kiện mà domain inference cần.
   *
   * @throws TypeError khi `requestId`/`admittedAt` không hợp lệ (dùng
   *   {@link createRequestId} nếu caller muốn ném exception thay vì domain error).
   */
  public static create(input: CreateLogicalRequestInput): InferenceResult<LogicalRequest> {
    if (!isRequestId(input.requestId)) {
      return inferenceFailure('invalid_request_id');
    }
    if (!isEpochMillis(input.admittedAt)) {
      return inferenceFailure('invalid_timestamp');
    }
    const policy = validateExecutionPolicy(input.policy, input.admittedAt);
    if (!policy.ok) {
      return policy;
    }
    return inferenceOk(
      new LogicalRequest(
        input.requestId,
        input.admittedAt,
        policy.value,
        'open',
        Object.freeze([]),
        INITIAL_CLIENT_DELIVERY,
        null,
      ),
    );
  }

  /**
   * Khôi phục aggregate từ snapshot (ví dụ đọc từ persistence).
   *
   * Snapshot được validate đầy đủ; data tự ngược nhau bị từ chối bằng
   * `TypeError`. Đây là duy nhất đường tạo aggregate ngoài `create()`.
   *
   * @throws TypeError khi snapshot vi phạm invariant của aggregate.
   */
  public static reconstitute(snapshot: unknown): LogicalRequest {
    if (!isLogicalRequestSnapshot(snapshot)) {
      throw new TypeError('LogicalRequest snapshot is not valid.');
    }
    return new LogicalRequest(
      snapshot.requestId,
      snapshot.admittedAt,
      snapshot.policy,
      snapshot.status,
      snapshot.attempts,
      snapshot.delivery,
      snapshot.completion,
    );
  }

  /**
   * Trả snapshot readonly (frozen) của state hiện tại — dùng cho persistence
   * và view. Trả object mới mỗi lần gọi; caller không thể mutate state bên trong.
   */
  public snapshot(): LogicalRequestSnapshot {
    return Object.freeze({
      requestId: this.id,
      admittedAt: this.#admittedAt,
      policy: this.#policy,
      status: this.#status,
      attempts: this.#attempts,
      delivery: this.#delivery,
      completion: this.#completion,
    });
  }

  public admittedAt(): number {
    return this.#admittedAt;
  }

  public policy(): ExecutionPolicy {
    return this.#policy;
  }

  public status(): LogicalRequestStatus {
    return this.#status;
  }

  public attempts(): readonly ProviderAttempt[] {
    return this.#attempts;
  }

  public delivery(): ClientDelivery {
    return this.#delivery;
  }

  public completion(): RequestCompletion | null {
    return this.#completion;
  }

  public isRequestTerminal(): boolean {
    return isTerminalStatus(this.#status);
  }

  public latestAttempt(): ProviderAttempt | null {
    return latestAttempt(this.#attempts);
  }

  public findAttempt(attemptId: unknown): ProviderAttempt | null {
    return findAttempt(this.#attempts, attemptId);
  }

  public hasUnresolvedUncertainty(): boolean {
    return hasUnresolvedUncertainty(this.#attempts);
  }

  /**
   * Đánh giá quyền append thêm attempt cho request này. Xem
   * `evaluateRetryAdmissibility` (pure-function module) cho thứ tự kiểm tra.
   */
  public evaluateRetryAdmissibility(input: {
    readonly now: unknown;
  }): InferenceResult<RetryDecision> {
    return evaluateRetryAdmissibility(
      {
        status: this.#status,
        policy: this.#policy,
        attempts: this.#attempts,
        delivery: this.#delivery,
      },
      input,
    );
  }

  /**
   * Tóm describe progress phục vụ audit/truy vấn — view, không phải state.
   *
   * `clientDisconnected` chỉ là dữ kiện delivery: nó xuất hiện cạnh trạng thái
   * thực thi, không thay thế trạng thái đó.
   */
  public describeRequestProgress(): RequestProgress {
    return describeRequestProgressView({
      status: this.#status,
      policy: this.#policy,
      attempts: this.#attempts,
      delivery: this.#delivery,
    });
  }

  // ---------------------------------------------------------------------------
  // Provider attempt
  // ---------------------------------------------------------------------------

  /** Input ghi nhận dispatch intent của một attempt. */
  public recordDispatchIntent(input: {
    readonly attemptId: unknown;
    readonly candidateRef: unknown;
    readonly endpointRef: unknown;
    readonly recordedAt: unknown;
  }): InferenceResult<void> {
    if (!isAttemptId(input.attemptId)) {
      return inferenceFailure('invalid_attempt_id');
    }
    if (!isOpaqueId(input.candidateRef)) {
      return inferenceFailure('invalid_candidate_ref');
    }
    if (input.endpointRef !== null && !isOpaqueId(input.endpointRef)) {
      return inferenceFailure('invalid_candidate_ref');
    }
    if (!isEpochMillis(input.recordedAt)) {
      return inferenceFailure('invalid_timestamp');
    }
    if (input.recordedAt < this.#admittedAt) {
      return inferenceFailure('timestamp_regression');
    }

    const existing = findAttempt(this.#attempts, input.attemptId);
    if (existing !== null) {
      const identical =
        existing.candidateRef === input.candidateRef &&
        existing.endpointRef === input.endpointRef &&
        existing.recordedAt === input.recordedAt;
      return identical ? inferenceOk(undefined) : inferenceFailure('duplicate_attempt_id');
    }

    const admission = evaluateRetryAdmissibility(
      {
        status: this.#status,
        policy: this.#policy,
        attempts: this.#attempts,
        delivery: this.#delivery,
      },
      { now: input.recordedAt },
    );
    if (!admission.ok) {
      return admission;
    }
    if (!admission.value.admissible) {
      return inferenceFailure(admission.value.reason);
    }

    const attempt: ProviderAttempt = Object.freeze({
      attemptId: input.attemptId,
      sequence: admission.value.nextSequence,
      candidateRef: input.candidateRef,
      endpointRef: input.endpointRef,
      recordedAt: input.recordedAt,
      evidence: EXECUTION_EVIDENCE.not_sent,
      evidenceRecordedAt: null,
      endedAt: null,
    });

    this.#attempts = Object.freeze([...this.#attempts, attempt]);
    return inferenceOk(undefined);
  }

  /** Input ghi nhận evidence của một attempt. */
  public recordAttemptEvidence(input: {
    readonly attemptId: unknown;
    readonly evidence: unknown;
    readonly recordedAt: unknown;
  }): InferenceResult<void> {
    const attempt = findAttempt(this.#attempts, input.attemptId);
    if (attempt === null) {
      return inferenceFailure('attempt_not_found');
    }
    if (!isExecutionEvidence(input.evidence)) {
      return inferenceFailure('invalid_evidence');
    }
    if (!isEpochMillis(input.recordedAt)) {
      return inferenceFailure('invalid_timestamp');
    }
    if (attempt.evidence === input.evidence && attempt.evidenceRecordedAt === input.recordedAt) {
      return inferenceOk(undefined);
    }
    if (!isAttemptOpen(attempt)) {
      return inferenceFailure('attempt_not_in_flight');
    }
    return this.#updateEvidence(attempt, input.evidence, input.recordedAt, attempt.endedAt);
  }

  /** Input đóng một attempt. */
  public closeAttempt(input: {
    readonly attemptId: unknown;
    readonly evidence: unknown;
    readonly endedAt: unknown;
  }): InferenceResult<void> {
    const attempt = findAttempt(this.#attempts, input.attemptId);
    if (attempt === null) {
      return inferenceFailure('attempt_not_found');
    }
    if (!isExecutionEvidence(input.evidence)) {
      return inferenceFailure('invalid_evidence');
    }
    if (!isEpochMillis(input.endedAt)) {
      return inferenceFailure('invalid_timestamp');
    }
    if (!isAttemptOpen(attempt)) {
      const identical = attempt.evidence === input.evidence && attempt.endedAt === input.endedAt;
      return identical ? inferenceOk(undefined) : inferenceFailure('attempt_not_in_flight');
    }
    return this.#updateEvidence(attempt, input.evidence, input.endedAt, input.endedAt);
  }

  #updateEvidence(
    attempt: ProviderAttempt,
    evidence: ExecutionEvidence,
    recordedAt: number,
    endedAt: number | null,
  ): InferenceResult<void> {
    if (recordedAt < attempt.recordedAt) {
      return inferenceFailure('timestamp_regression');
    }
    if (attempt.evidenceRecordedAt !== null && recordedAt < attempt.evidenceRecordedAt) {
      return inferenceFailure('timestamp_regression');
    }
    if (!canTransitionEvidence(attempt.evidence, evidence)) {
      return inferenceFailure('invalid_evidence_transition');
    }
    this.#replaceAttempt({
      ...attempt,
      evidence,
      evidenceRecordedAt: recordedAt,
      endedAt,
    });
    return inferenceOk(undefined);
  }

  #replaceAttempt(replacement: ProviderAttempt): void {
    this.#attempts = Object.freeze(
      this.#attempts.map((attempt) =>
        attempt.attemptId === replacement.attemptId ? Object.freeze(replacement) : attempt,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Delivery tới client
  // ---------------------------------------------------------------------------

  /**
   * Ghi nhận byte response đầu tiên đã tới client.
   *
   * Từ thời điểm này không được append attempt mới cho cùng request (xem
   * `evaluateRetryAdmissibility`).
   */
  public recordClientOutputCommitted(input: {
    readonly committedAt: unknown;
  }): InferenceResult<void> {
    const delivery = commitClientResponse(this.#delivery, input);
    if (!delivery.ok) {
      return delivery;
    }
    if (delivery.value !== this.#delivery) {
      this.#delivery = delivery.value;
    }
    return inferenceOk(undefined);
  }

  /**
   * Ghi nhận client ngắt kết nối.
   *
   * Chỉ là dữ kiện: trạng thái request không đổi, không attempt nào bị coi là đã
   * dừng, và không retry nào được kích hoạt.
   */
  public recordClientDisconnectEvent(input: {
    readonly disconnectedAt: unknown;
  }): InferenceResult<void> {
    const delivery = recordClientDisconnect(this.#delivery, input);
    if (!delivery.ok) {
      return delivery;
    }
    if (delivery.value !== this.#delivery) {
      this.#delivery = delivery.value;
    }
    return inferenceOk(undefined);
  }

  // ---------------------------------------------------------------------------
  // Reconciliation
  // ---------------------------------------------------------------------------

  /**
   * Chuyển request sang `reconciling` khi không thể tiếp tục nhưng còn attempt
   * chưa xác định.
   *
   * Yêu cầu: request đang `open`, không có attempt đang mở, và có ít nhất một
   * attempt `may_have_executed`.
   */
  public awaitReconciliation(): InferenceResult<void> {
    if (isTerminalStatus(this.#status)) {
      return inferenceFailure('request_closed');
    }
    if (this.#status !== 'open') {
      return inferenceFailure('inconsistent_execution_state');
    }
    if (findOpenAttempt(this.#attempts) !== null) {
      return inferenceFailure('attempt_in_flight');
    }
    if (!hasUnresolvedUncertainty(this.#attempts)) {
      return inferenceFailure('no_uncertainty_to_reconcile');
    }
    this.#status = 'reconciling';
    return inferenceOk(undefined);
  }

  /** Input reconcile một attempt bất định bằng bằng chứng authoritative. */
  public reconcileUncertainAttempt(input: {
    readonly attemptId: unknown;
    readonly evidence: unknown;
    readonly recordedAt: unknown;
  }): InferenceResult<void> {
    if (this.#status !== 'reconciling') {
      return inferenceFailure('reconciliation_not_pending');
    }
    const attempt = findAttempt(this.#attempts, input.attemptId);
    if (attempt === null) {
      return inferenceFailure('attempt_not_found');
    }
    if (!isAttemptUncertain(attempt)) {
      return inferenceFailure('attempt_not_uncertain');
    }
    if (!isExecutionEvidence(input.evidence)) {
      return inferenceFailure('invalid_evidence');
    }
    if (!isEpochMillis(input.recordedAt)) {
      return inferenceFailure('invalid_timestamp');
    }
    if (
      input.evidence !== EXECUTION_EVIDENCE.confirmed_completed &&
      input.evidence !== EXECUTION_EVIDENCE.confirmed_not_executed
    ) {
      return inferenceFailure('reconciliation_requires_confirmation');
    }

    const updated = this.#updateEvidence(
      attempt,
      input.evidence,
      input.recordedAt,
      attempt.endedAt ?? input.recordedAt,
    );
    if (!updated.ok) {
      return updated;
    }
    if (input.evidence === EXECUTION_EVIDENCE.confirmed_completed) {
      return this.#closeRequest('completed', input.recordedAt, null);
    }
    this.#status = 'open';
    return inferenceOk(undefined);
  }

  // ---------------------------------------------------------------------------
  // Kết thúc
  // ---------------------------------------------------------------------------

  /**
   * Hoàn tất request vì một attempt đã `confirmed_completed`.
   *
   * Yêu cầu attempt cuối cùng đã đóng với evidence `confirmed_completed`. Gọi lặp
   * với cùng `completedAt` là idempotent; khác thời điểm hoặc trạng thái terminal
   * khác bị từ chối.
   */
  public completeRequest(input: { readonly completedAt: unknown }): InferenceResult<void> {
    if (!isEpochMillis(input.completedAt)) {
      return inferenceFailure('invalid_timestamp');
    }
    const replay = this.#replayTerminal('completed', input.completedAt, null);
    if (replay !== null) {
      return replay;
    }
    if (findOpenAttempt(this.#attempts) !== null) {
      return inferenceFailure('attempt_in_flight');
    }
    const previous = latestAttempt(this.#attempts);
    if (previous === null || previous.evidence !== EXECUTION_EVIDENCE.confirmed_completed) {
      return inferenceFailure('completion_requires_completed_attempt');
    }
    return this.#closeRequest('completed', input.completedAt, null);
  }

  /**
   * Kết thúc request là thất bại.
   *
   * Chỉ hợp lệ khi mọi attempt đã đóng và **không** attempt nào có thể đã thực
   * thi. Một attempt `may_have_executed` phải đi qua `awaitReconciliation` +
   * `reconcileUncertainAttempt` trước.
   */
  public failRequest(input: { readonly failedAt: unknown }): InferenceResult<void> {
    if (!isEpochMillis(input.failedAt)) {
      return inferenceFailure('invalid_timestamp');
    }
    const replay = this.#replayTerminal('failed', input.failedAt, null);
    if (replay !== null) {
      return replay;
    }
    if (findOpenAttempt(this.#attempts) !== null) {
      return inferenceFailure('attempt_in_flight');
    }
    if (hasUnresolvedUncertainty(this.#attempts)) {
      return inferenceFailure('uncertain_execution_unresolved');
    }
    return this.#closeRequest('failed', input.failedAt, null);
  }

  /** Input huỷ request. */
  public cancelRequest(input: {
    readonly cancelledAt: unknown;
    readonly reason: unknown;
  }): InferenceResult<void> {
    if (!isEpochMillis(input.cancelledAt)) {
      return inferenceFailure('invalid_timestamp');
    }
    if (!isCancellationReason(input.reason)) {
      return inferenceFailure('invalid_cancellation_reason');
    }
    const replay = this.#replayTerminal('cancelled', input.cancelledAt, input.reason);
    if (replay !== null) {
      return replay;
    }
    if (findOpenAttempt(this.#attempts) !== null) {
      return inferenceFailure('attempt_in_flight');
    }
    if (hasUnresolvedUncertainty(this.#attempts)) {
      return inferenceFailure('uncertain_execution_unresolved');
    }
    return this.#closeRequest('cancelled', input.cancelledAt, input.reason);
  }

  /**
   * Trả kết quả cho lệnh terminal lặp lại; `null` khi đây là lần kết thúc đầu
   * tiên. Idempotency này ở mức **semantics**: persistence vẫn cần khoá bền của
   * nó ở tầng application.
   */
  #replayTerminal(
    status: 'completed' | 'failed' | 'cancelled',
    closedAt: number,
    reason: RequestCancellationReason | null,
  ): InferenceResult<void> | null {
    if (!isTerminalStatus(this.#status)) {
      return null;
    }
    const completion = this.#completion;
    if (
      this.#status === status &&
      completion !== null &&
      completion.closedAt === closedAt &&
      completion.reason === reason
    ) {
      return inferenceOk(undefined);
    }
    return inferenceFailure('request_closed');
  }

  #closeRequest(
    status: 'completed' | 'failed' | 'cancelled',
    closedAt: number,
    reason: RequestCancellationReason | null,
  ): InferenceResult<void> {
    if (closedAt < this.#admittedAt) {
      return inferenceFailure('timestamp_regression');
    }
    const last = latestAttempt(this.#attempts);
    if (last !== null && last.recordedAt > closedAt) {
      return inferenceFailure('timestamp_regression');
    }
    this.#completion = Object.freeze({ status, closedAt, reason });
    this.#status = status;
    return inferenceOk(undefined);
  }
}

function isCancellationReason(value: unknown): value is RequestCancellationReason {
  return (
    value === 'client_cancelled' || value === 'deadline_exceeded' || value === 'policy_cancelled'
  );
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

/** Tiến trình request, đọc lại từ state — không phải nguồn sự thật thứ hai. */
export interface RequestProgress {
  readonly status: LogicalRequestStatus;
  readonly attemptCount: number;
  readonly attemptOutcomes: readonly AttemptOutcome[];
  readonly clientOutputCommitted: boolean;
  readonly clientDisconnected: boolean;
}

/**
 * Tổng hợp view phục vụ audit/truy vấn.
 *
 * `clientDisconnected` chỉ là dữ kiện delivery: nó xuất hiện cạnh trạng thái
 * thực thi, không thay thế trạng thái đó.
 */
export function describeRequestProgressView(request: LogicalRequestView): RequestProgress {
  return Object.freeze({
    status: request.status,
    attemptCount: request.attempts.length,
    attemptOutcomes: Object.freeze(request.attempts.map(classifyAttemptOutcome)),
    clientOutputCommitted: hasClientOutputCommitted(request.delivery),
    clientDisconnected: request.delivery.disconnectedAt !== null,
  });
}
