/**
 * Repository port cho `mail_jobs` (execution + outcome reporting) và `quarantine`.
 *
 * Nguồn canonical: `docs/services/transactional-mailer-job/01-architecture.md` §9.2.1
 * (bốn statement conditional UPDATE), §9.2.2 (ma trận transition), §9.5 (vòng đời
 * báo outcome), §10 (ba đường sweep).
 *
 * Nguyên tắc chung của mọi operation:
 * - Mọi thao tác ghi là **một conditional UPDATE duy nhất** — không read-then-write;
 *   kết quả trả về phân biệt tường minh `applied`/`claimed`/`acquired` vs
 *   `denied` kèm lý do. Affected rows = 0 KHÔNG BAO GIỜ gộp thành thành công.
 * - Khi UPDATE trả 0 row, implementation đọc lại tối thiểu số trường cần thiết và
 *   phân loại bằng classifier thuần ở `mail-job-rules` (Xem `classify*Denial`).
 * - `dispatch_generation` truyền vào claim/advance là **authority đọc từ control plane**
 *   qua private interface — command Queue KHÔNG mang generation và không bao giờ
 *   là nguồn của tham số này (§9.2.1, FR-008).
 * - Port không có I/O; repository không gọi provider, không HTTP, không quyết định
 *   ack/retry — đó là việc của J2/J3 sau này.
 */
import type { MailJobRecord, QuarantineRecord } from './mail-job-model';
import type {
  BudgetExhaustedDenial,
  GenerationAdvanceDenial,
  LeaseOwnershipDenial,
  ReportCompletionDenial,
  ReportLeaseDenial,
  SameGenerationClaimDenial,
} from './mail-job-rules';

export type CreatePendingJobParams = {
  readonly deliveryId: string;
  readonly messageId?: string;
  readonly dispatchGeneration: number;
  readonly createdAt: number;
  readonly updatedAt: number;
};

/**
 * Kết quả insert row chưa giữ lease (§9.2.1).
 *
 * `duplicate` nghĩa là `INSERT ... ON CONFLICT (delivery_id) DO NOTHING` đã không ghi row
 * nào vì row **đã tồn tại** — tình huống bình thường khi hai execution cùng xử lý một
 * command, hoặc khi job được recovery lại. Nó **không** phải lỗi, và nó **không** là
 * bằng chứng hàng đợi đã được xử lý: caller phải claim lại bằng đường (a)/(b).
 */
export type CreatePendingJobResult = { readonly kind: 'created' } | { readonly kind: 'duplicate' };

export type ClaimSameGenerationParams = {
  readonly deliveryId: string;
  readonly dispatchGeneration: number;
  readonly owner: string;
  readonly nowMs: number;
  readonly leaseMs: number;
  readonly maxExecutionAttempts: number;
};

export type ClaimSameGenerationSuccess = {
  readonly kind: 'claimed';
  readonly record: MailJobRecord;
};

export type ClaimSameGenerationResult =
  | ClaimSameGenerationSuccess
  | { readonly kind: 'denied'; readonly reason: SameGenerationClaimDenial };

export type ClaimGenerationAdvanceParams = {
  readonly deliveryId: string;
  readonly newDispatchGeneration: number;
  readonly owner: string;
  readonly nowMs: number;
  readonly leaseMs: number;
};

export type ClaimGenerationAdvanceSuccess = {
  readonly kind: 'claimed';
  readonly record: MailJobRecord;
};

export type ClaimGenerationAdvanceResult =
  | ClaimGenerationAdvanceSuccess
  | { readonly kind: 'denied'; readonly reason: GenerationAdvanceDenial };

export type MarkBlockedBudgetExhaustedParams = {
  readonly deliveryId: string;
  readonly dispatchGeneration: number;
  readonly nowMs: number;
  readonly maxExecutionAttempts: number;
};

export type MarkBlockedBudgetExhaustedResult =
  | { readonly kind: 'applied'; readonly record: MailJobRecord }
  | { readonly kind: 'denied'; readonly reason: BudgetExhaustedDenial };

export type RenewExecutionLeaseParams = {
  readonly deliveryId: string;
  readonly owner: string;
  readonly executionGeneration: number;
  readonly nowMs: number;
  readonly leaseMs: number;
};

export type RenewExecutionLeaseResult =
  | { readonly kind: 'applied'; readonly record: MailJobRecord }
  | { readonly kind: 'denied'; readonly reason: LeaseOwnershipDenial };

export type ExecutionResultOutcome = 'sent' | 'failed' | 'blocked';

/**
 * Tham số của lần persist kết quả provider (§9.2.2 hàng 1–4).
 *
 * Statement release execution lease trong **cùng** UPDATE, nên ở đây **không** có
 * `leaseMs`: không còn lease nào để gia hạn sau khi kết quả đã persist.
 *
 * `lastError`/`lastErrorClass` là hai token đã sanitize (`errorCode`/`errorClass` của
 * §11.1). Chúng được ghi **đúng như caller truyền**: một `sent` không mang lỗi thì hai
 * cột này là NULL, không giữ lại lỗi của attempt trước — bản ghi terminal phải mô tả
 * chính attempt đã kết thúc generation này, không phải lịch sử.
 */
export type PersistExecutionResultParams = {
  readonly deliveryId: string;
  readonly owner: string;
  readonly executionGeneration: number;
  readonly dispatchGeneration: number;
  readonly nowMs: number;
  readonly outcome: ExecutionResultOutcome;
  readonly providerMessageId?: string;
  readonly lastError?: string;
  readonly lastErrorClass?: string;
};

export type PersistExecutionResultResult =
  | { readonly kind: 'applied'; readonly record: MailJobRecord }
  | { readonly kind: 'denied'; readonly reason: LeaseOwnershipDenial };

/**
 * Tham số của lần release execution lease **không** kèm kết quả provider (§9.2.2 hàng 6, 7).
 *
 * Dùng cho đường retryable: execution kết thúc attempt mà không có gì để chốt terminal —
 * ví dụ private API không sẵn sàng **trước** provider call (hàng 7), hoặc provider trả
 * lỗi retryable (hàng 6). `attempts` **không** tăng ở đây (nó đã tăng lúc claim), và
 * `status` vẫn `processing` để execution kế tiếp claim lại được ngay.
 *
 * `lastError`/`lastErrorClass` ghi lý do attempt này kết thúc, cùng semantics với
 * {@link PersistExecutionResultParams}: caller truyền gì thì ghi đúng cái đó, bỏ trống
 * nghĩa là attempt này không ghi lỗi nào.
 */
export type ReleaseExecutionLeaseParams = {
  readonly deliveryId: string;
  readonly owner: string;
  readonly executionGeneration: number;
  readonly dispatchGeneration: number;
  readonly nowMs: number;
  readonly lastError?: string;
  readonly lastErrorClass?: string;
};

export type ReleaseExecutionLeaseResult =
  | { readonly kind: 'applied'; readonly record: MailJobRecord }
  | { readonly kind: 'denied'; readonly reason: LeaseOwnershipDenial };

export type AcquireReportLeaseParams = {
  readonly deliveryId: string;
  readonly dispatchGeneration: number;
  readonly owner: string;
  readonly nowMs: number;
  readonly reportLeaseMs: number;
};

export type AcquireReportLeaseSuccess = {
  readonly kind: 'acquired';
  readonly record: MailJobRecord;
};

export type AcquireReportLeaseResult =
  | AcquireReportLeaseSuccess
  | { readonly kind: 'denied'; readonly reason: ReportLeaseDenial };

export type CompleteReportDisposition = 'reported' | 'superseded' | 'orphaned';

export type CompleteReportParams = {
  readonly deliveryId: string;
  readonly dispatchGeneration: number;
  readonly owner: string;
  readonly nowMs: number;
  readonly disposition: CompleteReportDisposition;
};

export type CompleteReportResult =
  | { readonly kind: 'applied'; readonly record: MailJobRecord }
  | { readonly kind: 'denied'; readonly reason: ReportCompletionDenial };

export type KeepReportPendingParams = {
  readonly deliveryId: string;
  readonly dispatchGeneration: number;
  readonly owner: string;
  readonly nowMs: number;
};

export type KeepReportPendingResult =
  | { readonly kind: 'applied'; readonly record: MailJobRecord }
  | { readonly kind: 'denied'; readonly reason: ReportCompletionDenial };

export type StaleLeaseSweepItem = Pick<
  MailJobRecord,
  | 'deliveryId'
  | 'messageId'
  | 'dispatchGeneration'
  | 'executionGeneration'
  | 'status'
  | 'leaseExpiresAt'
  | 'leaseOwner'
  | 'attempts'
>;

export type ReportSweepItem = Pick<
  MailJobRecord,
  | 'deliveryId'
  | 'messageId'
  | 'dispatchGeneration'
  | 'status'
  | 'outcomeReportState'
  | 'reportAttempts'
  | 'reportLeaseOwner'
  | 'reportLeaseExpiresAt'
  | 'lastErrorClass'
>;

export type BlockedBacklogSweepItem = Pick<
  MailJobRecord,
  | 'deliveryId'
  | 'messageId'
  | 'dispatchGeneration'
  | 'status'
  | 'blockedAt'
  | 'attempts'
  | 'lastErrorClass'
>;

export type FindStaleLeaseCandidatesParams = {
  readonly nowMs: number;
  readonly limit: number;
};

export type FindReportSweepCandidatesParams = {
  readonly nowMs: number;
  readonly maxReportAttempts: number;
  readonly limit: number;
};

export type FindBlockedBacklogCandidatesParams = {
  readonly cutoffMs: number;
  readonly limit: number;
};

export type UpsertQuarantineRecordParams = {
  readonly quarantineId: string;
  readonly queueMessageId: string;
  readonly reason: QuarantineRecord['reason'];
  readonly fieldName?: string;
  readonly nowMs: number;
};

export type UpsertQuarantineRecordResult =
  | { readonly kind: 'created'; readonly record: QuarantineRecord }
  | { readonly kind: 'updated'; readonly record: QuarantineRecord };

export type GetQuarantineRecordParams = {
  readonly quarantineId: string;
  readonly queueMessageId: string;
};

export interface MailJobRepository {
  loadJobByDeliveryId(deliveryId: string): Promise<MailJobRecord | null>;
  createPendingJob(params: CreatePendingJobParams): Promise<CreatePendingJobResult>;
  claimSameGeneration(params: ClaimSameGenerationParams): Promise<ClaimSameGenerationResult>;
  claimGenerationAdvance(
    params: ClaimGenerationAdvanceParams,
  ): Promise<ClaimGenerationAdvanceResult>;
  markBlockedBudgetExhausted(
    params: MarkBlockedBudgetExhaustedParams,
  ): Promise<MarkBlockedBudgetExhaustedResult>;
  renewExecutionLease(params: RenewExecutionLeaseParams): Promise<RenewExecutionLeaseResult>;
  persistExecutionResult(
    params: PersistExecutionResultParams,
  ): Promise<PersistExecutionResultResult>;
  releaseExecutionLease(params: ReleaseExecutionLeaseParams): Promise<ReleaseExecutionLeaseResult>;
  acquireReportLease(params: AcquireReportLeaseParams): Promise<AcquireReportLeaseResult>;
  completeReport(params: CompleteReportParams): Promise<CompleteReportResult>;
  keepReportPending(params: KeepReportPendingParams): Promise<KeepReportPendingResult>;
  findStaleLeaseCandidates(
    params: FindStaleLeaseCandidatesParams,
  ): Promise<readonly StaleLeaseSweepItem[]>;
  findReportSweepCandidates(
    params: FindReportSweepCandidatesParams,
  ): Promise<readonly ReportSweepItem[]>;
  findBlockedBacklogCandidates(
    params: FindBlockedBacklogCandidatesParams,
  ): Promise<readonly BlockedBacklogSweepItem[]>;
}

export interface QuarantineRepository {
  upsertQuarantineRecord(
    params: UpsertQuarantineRecordParams,
  ): Promise<UpsertQuarantineRecordResult>;
  getQuarantineRecord(params: GetQuarantineRecordParams): Promise<QuarantineRecord | null>;
}

export type { MailJobRecord, QuarantineRecord };
export type {
  BudgetExhaustedDenial,
  GenerationAdvanceDenial,
  LeaseOwnershipDenial,
  ReportCompletionDenial,
  ReportLeaseDenial,
  SameGenerationClaimDenial,
} from './mail-job-rules';
