/**
 * Orchestration của **một** Queue command `mail.send`: parse → validate → resolve authority →
 * claim → gọi provider → persist kết quả → báo outcome.
 *
 * Nguồn canonical: `docs/services/transactional-mailer-job/01-architecture.md` §9.2.1 (lease
 * protocol), §9.2.2 (ma trận transition), §9.4 (blocked/redrive), §9.5 (vòng đời báo outcome),
 * `03-operations.md` §3.1 (bảng xử lý theo nhóm).
 *
 * ## Hàm này là nơi duy nhất quyết định ack hay retry
 *
 * Port (`MailJobRepository`, `MailDeliveryGateway`, `MailProviderPort`) **không** quyết định:
 * chúng trả nguyên kết quả và phân loại denial. Chỉ {@link processMailCommand} ánh xạ kết quả
 * đó thành {@link MailCommandOutcome}, và chỉ composition root (Queue consumer) map
 * `ack-processed`/`quarantined`/`internal-blocked` thành `ack()` và `retry` thành
 * `message.retry()`.
 *
 * ## Invariant "một command, một lần gọi provider"
 *
 * Provider **chỉ** được gọi sau khi đã claim được lease và re-validate được lease đó ngay
 * trước lúc gọi (§9.2.1: "trước khi gọi provider, owner **phải** re-validate"). Mọi nhánh dừng
 * trước bước đó — quarantine, `not-found`, mọi denial của claim — đều **không** chạm provider.
 *
 * ## Invariant "ack không bao giờ là đường mất intent duy nhất"
 *
 * Mọi `ack-processed` đều để lại một đường recovery bền vững: state terminal ở `mail_jobs`, hoặc
 * `outcome_report_state` còn `pending` cho report sweep, hoặc intent bền vững ở control plane
 * (delivery vẫn non-terminal → reconciler re-dispatch). `retry` chỉ dùng khi **chưa** có gì bền
 * vững để mất.
 *
 * ## Ràng buộc quan sát được
 *
 * - **Không** log raw body, recipient, subject, body hay `providerMessageId`.
 * - **Không** `waitUntil`, **không** sleep, **không** retry nội bộ: mỗi message một lần gọi,
 *   backoff là việc của Queue.
 * - **Không** state nào sống ngoài stack của lần gọi này: mọi thứ đi qua tham số và qua
 *   durable state của `mail_jobs`.
 * - **Chỉ** Web API (qua `quarantine-digest`) — không `node:*`.
 */
import { validateMailSendCommand } from '@ecoma-io/transactional-mail-contracts';

import type {
  DeliveryLookupResult,
  DeliveryMaterial,
  MailDeliveryGateway,
  OutcomeReportRequest,
  OutcomeReportResult,
} from './mail-delivery-gateway';
import type { MailJobRecord, QuarantineReason } from './mail-job-model';
import {
  canPersistExecutionResultFor,
  dispositionForControlPlaneOutcome,
  type ControlPlaneOutcomeSignal,
  type GenerationAdvanceDenial,
  type OutcomeReportDisposition,
  type SameGenerationClaimDenial,
} from './mail-job-rules';
import type { MailJobRepository, QuarantineRepository } from './mail-job-repository-port';
import type {
  MailProviderErrorClass,
  MailProviderPort,
  MailProviderSendRequest,
  MailProviderSendResult,
} from './mail-provider-port';
import {
  QUARANTINE_UNKNOWN_FIELD_NAME,
  computeQuarantineId,
  encodeUtf8,
  optionalSanitizedFieldName,
  quarantineReasonFor,
} from './quarantine-digest';

/** Dependency của orchestration — toàn bộ seam, không có I/O ẩn. */
export type ProcessMailCommandDeps = {
  readonly jobs: MailJobRepository;
  readonly quarantine: QuarantineRepository;
  readonly gateway: MailDeliveryGateway;
  readonly provider: MailProviderPort;
};

/**
 * Giá trị vận hành của orchestration.
 *
 * Mọi số ở đây là **tham số bắt buộc, không có default** (`03-operations.md` §3): một default
 * ngầm ở đường execution là một ngân sách/lease tự chọn mà không ai review.
 *
 * @typeParam executionLeaseMs Độ dài execution lease (§9.2.1). Phải lớn hơn tổng worst-case của
 * runtime resolution + provider timeout + ghi D1 + margin.
 * @typeParam maxExecutionAttempts Ngân sách B của **một** generation (>= `max_retries + 1`).
 * @typeParam providerTimeoutMs Trần cứng của một lần gọi provider, theo `mail-provider-port.ts`.
 * @typeParam reportLeaseMs Độ dài report-lease (§9.2.1 đường (d)). Nó thuộc cùng nhóm cấu hình vận
 * hành với `executionLeaseMs` ở `03-operations.md` §1, và `acquireReportLease` bắt buộc cần nó.
 * @typeParam owner Token fencing của execution này (UUID sinh local). Mỗi lần claim có
 * `execution_generation` riêng nên owner có thể được tái dùng chỉ khác token claim.
 * @typeParam quarantineKeyHex Worker Secret `MAIL_QUARANTINE_HMAC_KEY` dạng hex.
 * @typeParam nowMs Mốc thời gian của lần xử lý này — truyền vào, không đọc đồng hồ, để mọi mốc
 * ghi xuống row là **cùng một** mốc.
 */
export type ProcessMailCommandConfig = {
  readonly executionLeaseMs: number;
  readonly maxExecutionAttempts: number;
  readonly providerTimeoutMs: number;
  readonly reportLeaseMs: number;
  readonly owner: string;
  readonly quarantineKeyHex: string;
  readonly nowMs: number;
};

/**
 * Kết quả của một lần xử lý message, theo góc nhìn của Queue consumer.
 *
 * Đây là **toàn bộ** hợp đồng giữa orchestration và consumer: không có trường nào ở đây để tùy
 * tiện quyết định thêm.
 */
export type MailCommandOutcome =
  /** Command bị reject vĩnh viễn: bản ghi quarantine đã ghi, ack (không retry — §3.1). */
  | { readonly kind: 'quarantined'; readonly reason: QuarantineReason }
  /**
   * State đã bền vững (terminal, hoặc no-op idempotent) — ack.
   *
   * Cũng gồm "việc này đã có người khác làm / không còn việc để làm": duplicate command khi job
   * terminal, execution khác đang giữ lease, job `blocked` cùng generation. Không phải mọi
   * `ack-processed` đều là "vừa gửi thư".
   */
  | { readonly kind: 'ack-processed' }
  /** Chưa có gì bền vững để mất — caller **phải** gọi `retry()` của Queue. */
  | { readonly kind: 'retry' }
  /**
   * Ngân sách B kiệt: job đã ở `blocked` bền vững ⇒ **ack**, không retry.
   *
   * Tách khỏi `ack-processed` vì đây là trạng thái vận hành khác: nó cần metric/alert của ngân
   * sách B và đường redrive có authorize (§9.4), không phải "xử lý xong một việc".
   */
  | { readonly kind: 'internal-blocked' };

/** Outcome không mang payload, dùng cho các nhánh không cần thêm thông tin. */
const ACK_PROCESSED: MailCommandOutcome = { kind: 'ack-processed' };
const RETRY: MailCommandOutcome = { kind: 'retry' };

/**
 * `last_error_class` cho lỗi của **chính worker** ở đường lookup, không phải lỗi provider.
 *
 * Hai giá trị này là `error_class` canonical của contract, nhưng chúng **không** phát sinh từ
 * provider port — port cấm chúng bằng cấu trúc type (`mail-provider-port.ts`). Ở đường lookup
 * chúng chỉ được ghi vào `last_error_class` để điều tra; execution này không báo outcome ở nhánh
 * này, nên chúng không đi ra control plane.
 */
const INTERNAL_AUTH_ERROR_CLASS = 'internal-auth';
const CONTRACT_ERROR_CLASS = 'contract';

/**
 * `errorCode` khi adapter **throw** thay vì resolve.
 *
 * Contract của provider port là resolve (§11.1), nên đây là lỗi hệ thống chưa biểu diễn được bằng
 * result contract. Token này là `last_error` hợp lệ (lowercase kebab-case) để operator phân
 * biệt "adapter hỏng" với "provider từ chối".
 */
const PROVIDER_EXCEPTION_ERROR_CODE = 'provider-exception';

/**
 * Prefix của token `report_lease_owner` mà execution này dùng.
 *
 * `report_lease_owner` là một **cột riêng**, không phải `lease_owner`: statement (d) guard nó
 * độc lập với execution lease (§9.2.1), nên cùng một token vẫn hợp lệ ở cả hai cột. Vẫn phân
 * biệt bằng prefix để một report lease không bị đọc nhầm là execution lease (và ngược lại) khi
 * điều tra một row — hai vòng đời có timeout khác nhau và khác bị chặn bởi.
 *
 * ⚠️ Prefix **cắt ngắn**: `assertLeaseOwner` giới hạn `report_lease_owner` ở 128 code point
 * (`mail-job-model.ts`), và `owner` đã có thể dài tới 128. Nối thêm 7 ký tự sẽ vi phạm bound đó
 * ở một cấu hình hợp lệ — lỗi chỉ lộ ra khi report lease *thực sự* được acquire. Xem
 * {@link reportOwnerToken}.
 */
const REPORT_OWNER_PREFIX = 'report:';

/** Chiều dài tối đa của `lease_owner`/`report_lease_owner`, theo `assertLeaseOwner`. */
const MAX_LEASE_OWNER_LENGTH = 128;

/** Giá trị thay thế khi owner dài đến mức prefix làm vượt bound. */
const OWNER_OVERFLOW_FALLBACK = 'report-owner-overflow';

/**
 * `report_lease_owner` cho lần xử lý này.
 *
 * Ở đường bình thường nó là `` `${REPORT_OWNER_PREFIX}${owner}` `` để phân biệt vòng đời report
 * với vòng đời execution. Khi làm vượt {@link MAX_LEASE_OWNER_LENGTH}, ta **không** cắt bớt
 * (một token cắt ngắn có thể trùng với execution khác) mà thay bằng một hằng riêng: report
 * lease vẫn là một lease riêng, và hằng đó đủ để guard `report_lease_owner` làm việc.
 *
 * @param owner `owner` của execution này.
 * @returns Token ghi vào `report_lease_owner`.
 */
export function reportOwnerToken(owner: string): string {
  const prefixed = `${REPORT_OWNER_PREFIX}${owner}`;
  return [...prefixed].length <= MAX_LEASE_OWNER_LENGTH ? prefixed : OWNER_OVERFLOW_FALLBACK;
}

/**
 * Xử lý **một** Queue message và trả về hành động mà consumer phải làm.
 *
 * @param rawBody Thân message dạng chuỗi, **nguyên văn** — đây là byte mà digest quarantine
 * phải băm, nên không được re-serialize trước.
 * @param queueMessageId `message.id` của Cloudflare Queues; là khoá chính thứ hai của bảng
 * quarantine.
 * @param deps Các port đã inject.
 * @param config Giá trị vận hành; xem {@link ProcessMailCommandConfig}.
 * @returns {@link MailCommandOutcome}.
 * @throws Chỉ khi một port **vi phạm** hợp đồng của nó (throw thay vì resolve, hoặc trả kết quả
 * không có trong union mà port khai). Đường hạnh ứng dụng bình thường **không** throw — nó
 * phân loại thành `retry` hoặc `quarantined` để consumer xử lý tiếp.
 */
export async function processMailCommand(
  rawBody: string,
  queueMessageId: string,
  deps: ProcessMailCommandDeps,
  config: ProcessMailCommandConfig,
): Promise<MailCommandOutcome> {
  const parsed = await rejectOrExtractDeliveryId(rawBody, queueMessageId, deps, config);
  if (parsed.kind === 'quarantine') {
    return { kind: 'quarantined', reason: parsed.reason };
  }

  const deliveryId = parsed.deliveryId;
  const lookup = await safeGetDelivery(deps.gateway, deliveryId);
  const authority = await resolveAuthority(deps, config, deliveryId, lookup);
  if (authority.kind === 'stop') {
    return authority.outcome;
  }

  const claim = await claimDelivery(deps, config, deliveryId, authority.delivery);
  if (claim.kind === 'not-claimed') {
    return claim.outcome;
  }

  return await executeClaimedDelivery(deps, config, deliveryId, authority.delivery, claim.record);
}

/** Kết quả bước 1: command bị reject, hoặc đã có `delivery_id` hợp lệ. */
type ParsedCommand =
  | { readonly kind: 'quarantine'; readonly reason: QuarantineReason }
  | { readonly kind: 'accepted'; readonly deliveryId: string };

/** Kết quả bước 2: đã resolve được authority, hoặc phải dừng. */
type AuthorityResolution =
  | { readonly kind: 'resolved'; readonly delivery: DeliveryMaterial }
  | { readonly kind: 'stop'; readonly outcome: MailCommandOutcome };

/** Kết quả bước 3: đã giữ lease, hoặc phải dừng. */
type ClaimResult =
  | { readonly kind: 'claimed'; readonly record: MailJobRecord }
  | { readonly kind: 'not-claimed'; readonly outcome: MailCommandOutcome };

/** Guard của mọi write sau claim — cùng một bộ kỳ vọng cho persist và release. */
type ExecutionExpectation = {
  readonly owner: string;
  readonly executionGeneration: number;
  readonly dispatchGeneration: number;
};

/** `last_error_class` mà execution này được phép ghi ở đường lookup. */
type LookupErrorClass = typeof INTERNAL_AUTH_ERROR_CLASS | typeof CONTRACT_ERROR_CLASS;

/**
 * Đọc runtime material, không để exception thoát ra.
 *
 * Contract của gateway là **resolve** (`mail-delivery-gateway.ts`): một lỗi network đã được
 * adapter phân loại thành `transient` rồi mới trả về. Exception ở đây là vi phạm hợp đồng, nhưng
 * nó vẫn phải có một hành động: không có gì bền vững được ghi, nên `transient` (⇒ `retry`) là
 * tín hiệu đúng. Để nó nổi lên thành exception không xử lý được chỉ khiến Queue retry theo
 * chính sách của nó, còn ta mất khả năng ghi `last_error` để biết client đã hỏng.
 */
async function safeGetDelivery(
  gateway: MailDeliveryGateway,
  deliveryId: string,
): Promise<DeliveryLookupResult> {
  try {
    return await gateway.getDelivery(deliveryId);
  } catch {
    return { kind: 'transient' };
  }
}

/**
 * Bước 1 — parse + validate command; command không canonical thì quarantine rồi dừng.
 *
 * Mọi lý do fail — JSON hỏng, thiếu field, sai kiểu, version lạ, field cấm — đều đi cùng một
 * đường: ghi **một** bản ghi quarantine đã sanitize rồi ack. Lý do là §3.1: command không
 * canonical **không bao giờ** được retry (retry không sửa được nó, và raw payload không được
 * phép đi vào DLQ), nên `retry` ở đây chỉ đốt ngân sách retry của Queue để đổi lấy không gì.
 *
 * @returns `quarantine` kèm lý do đã map, hoặc `accepted` kèm `delivery_id` đã trim.
 */
async function rejectOrExtractDeliveryId(
  rawBody: string,
  queueMessageId: string,
  deps: ProcessMailCommandDeps,
  config: ProcessMailCommandConfig,
): Promise<ParsedCommand> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return quarantineCommand(rawBody, queueMessageId, deps, config, 'unparseable-body', undefined);
  }

  const validation = validateMailSendCommand(parsed);
  if (!validation.ok) {
    return quarantineCommand(
      rawBody,
      queueMessageId,
      deps,
      config,
      quarantineReasonFor(validation.reason, validation.detail),
      validation.detail,
    );
  }

  return { kind: 'accepted', deliveryId: validation.command.delivery_id };
}

/**
 * Ghi bản ghi quarantine và trả về lý do đã map.
 *
 * Không chạm provider, không tạo job row, không log raw body: bản ghi chỉ có digest, id của
 * Queue message, `reason`, và **tên** field vi phạm (`03-operations.md` §3.1).
 *
 * @param fieldNameDetail `detail` thô của validator; chỉ dùng tên **đã sanitize**.
 */
async function quarantineCommand(
  rawBody: string,
  queueMessageId: string,
  deps: ProcessMailCommandDeps,
  config: ProcessMailCommandConfig,
  reason: QuarantineReason,
  fieldNameDetail: string | undefined,
): Promise<{ readonly kind: 'quarantine'; readonly reason: QuarantineReason }> {
  const quarantineId = await computeQuarantineId({
    keyHex: config.quarantineKeyHex,
    rawBody: encodeUtf8(rawBody),
  });

  await deps.quarantine.upsertQuarantineRecord({
    quarantineId,
    queueMessageId,
    reason,
    fieldName: fieldNameFor(reason, fieldNameDetail),
    nowMs: config.nowMs,
  });

  return { kind: 'quarantine', reason };
}

/**
 * Tên field ghi vào bản ghi quarantine.
 *
 * `forbidden-field` là lý do duy nhất mà `detail` là key **do producer gửi**, và CHECK của
 * schema bắt buộc `field_name IS NOT NULL` cho lý do đó (migration `0002`). Khi key đó không
 * vượt qua sanitizer, ta ghi hằng của worker thay vì key thật: hằng không suy diễn gì về nội
 * dung command, còn một key gần như hợp lệ thì có thể — và bản ghi vẫn trả lời được "vì sao bị
 * reject". Các lý do còn lại có `detail` là hằng của contract nên gán bình thường, hoặc không có
 * gì để ghi thì bỏ trống (CHECK không đòi).
 *
 * @returns Tên field đã sanitize, hằng dự phòng, hoặc `undefined` (bỏ trống).
 */
function fieldNameFor(
  reason: QuarantineReason,
  fieldNameDetail: string | undefined,
): string | undefined {
  const sanitized = optionalSanitizedFieldName(fieldNameDetail);
  if (sanitized !== undefined) {
    return sanitized;
  }
  return reason === 'forbidden-field' ? QUARANTINE_UNKNOWN_FIELD_NAME : undefined;
}

/**
 * Bước 2 — resolve authority (`dispatch_generation` + runtime material) từ control plane.
 *
 * Command **không** mang generation, nên đây là nguồn duy nhất của `dispatch_generation` và của
 * mọi thứ cần để gọi provider (§9.2).
 *
 * ## Quyết định: `not-found` + chưa có job row ⇒ `ack-processed`
 *
 * `404` nghĩa là delivery không tồn tại ở control plane. Khi **chưa có** job row, ta ack và
 * **không** tạo job: một job row cho một delivery không tồn tại là một row mồ côi — không có chỗ
 * nào để ghi `failed`/`delivery-not-found` của §3 hàng 6, không có `message_id`, và nó sẽ nằm
 * đó chờ một execution mà không bao giờ tới (command này đã là command cuối của nó).
 *
 * Vì sao **không** tạo row rồi persist `failed` như `03-operations.md` §3 hàng 6 nói:
 * `persistExecutionResult` guard `lease_owner` + `execution_generation`, mà ta **chưa** claim
 * được lease — không có runtime material để gửi nên claim vô nghĩa — nên không có đường hợp lệ
 * nào để ghi `failed` cho một row vừa tạo. Đường duy nhất còn lại là `createPendingJob` rồi
 * ack, và kết quả là một row `processing` với lease không ai giữ; một redrive về sau phải chờ
 * `lease_expires_at` mới đi tiếp được. Bỏ qua tạo row tránh đúng cái đó.
 *
 * Đây là **kết luận của tôi**, không phải một dòng tài liệu: §3.1 và §9.2.1 không mô tả riêng
 * trường hợp `404` **trước** khi job row tồn tại. Nó được chọn vì fail-safe theo hướng không mất
 * gì: intent bền vững nằm ở control plane.
 *
 * Khi job row **đã** có mà delivery thì không: đó là orphan mà §3 hàng 6 muốn kết thúc ở
 * `failed`, nhưng ta không có lease để ghi nên không thể làm đúng phần việc đó. Ta **không**
 * sửa `outcome_report_state`: giữ nguyên để report sweep — đường duy nhất còn execution lease
 * hợp lệ — quyết định, và ack.
 *
 * ## Quyết định: `auth-rejected` / `contract-rejected` + chưa có job row ⇒ không tạo row
 *
 * §9.2.2 hàng 19 nói lookup `401`/`403` phải `retry()` bounded. Tạo job row ở đây sẽ **đốt
 * `attempts`** của ngân sách B cho một command mà ta còn chưa biết là gì — credential hỏng là
 * điều kiện hệ thống, và mỗi lần redelivery lại tạo một row mới làm hỏng budget. Nên khi chưa có
 * row: `retry`, không ghi gì.
 *
 * @param deliveryId `delivery_id` đã validate từ command.
 * @param lookup Kết quả `getDelivery` đã phân loại.
 */
async function resolveAuthority(
  deps: ProcessMailCommandDeps,
  config: ProcessMailCommandConfig,
  deliveryId: string,
  lookup: DeliveryLookupResult,
): Promise<AuthorityResolution> {
  switch (lookup.kind) {
    case 'found':
      return { kind: 'resolved', delivery: lookup.delivery };

    case 'not-found':
      return { kind: 'stop', outcome: ACK_PROCESSED };

    case 'auth-rejected':
      await recordLookupFailure(deps, config, deliveryId, INTERNAL_AUTH_ERROR_CLASS);
      return { kind: 'stop', outcome: RETRY };

    case 'contract-rejected':
      await recordLookupFailure(deps, config, deliveryId, CONTRACT_ERROR_CLASS);
      return { kind: 'stop', outcome: RETRY };

    case 'transient':
      return { kind: 'stop', outcome: RETRY };
  }
}

/**
 * Ghi `last_error_class` của lỗi chính worker ở đường lookup, theo hàng 19 của §9.2.2.
 *
 * ⚠️ Đường lookup chạy **trước** `claimDelivery`, nên execution này **chưa giữ lease nào** —
 * không thể ghi qua `releaseExecutionLease` (guard `lease_owner` khớp token sẽ luôn từ chối,
 * và hàm này sẽ thành code chết: `config.owner` là token sinh mới mỗi invocation). Ghi qua
 * **conditional update riêng** không đụng lease: chỉ nhận `status = 'processing' AND
 * outcome_report_state = 'none'` — row đang có execution khác giữ lease vẫn được ghi
 * `last_error_class` vì hai execution đọc cùng authority `401`/`400` là cùng nguyên nhân hệ
 * thống, không phải hai lỗi riêng; ngược lại row ở trạng thái khác (`sent`/`failed`/
 * `blocked`, hoặc report đang dở) thì **không** ghi — state đó thuộc về execution/report
 * khác và việc ghi đè là vi phạm guard theo nghĩa rộng.
 *
 * Khi **chưa có** job row thì không có gì để ghi, và ta cố ý không tạo row — xem
 * {@link resolveAuthority}. Kết quả "không ghi được gì" không phân biệt được nguyên nhân từ
 * bên ngoài — operator đọc `last_error_class` kèm trạng thái row của DLQ entry.
 *
 * @param errorClass `internal-auth` hoặc `contract`.
 */
async function recordLookupFailure(
  deps: ProcessMailCommandDeps,
  config: ProcessMailCommandConfig,
  deliveryId: string,
  errorClass: LookupErrorClass,
): Promise<void> {
  const job = await deps.jobs.loadJobByDeliveryId(deliveryId);
  if (job === null || job.status !== 'processing' || job.outcomeReportState !== 'none') {
    return;
  }

  // Conditional update không đụng lease: predicate chỉ là trạng thái row, không có token
  // owner nào vì execution này chưa từng claim. Trả `denied` (row đổi giữa hai lệnh gọi) là
  // kết quả hợp lệ — execution vừa chốt terminal, `last_error_class` của nó quan trọng hơn.
  await deps.jobs.recordLookupError({
    deliveryId,
    dispatchGeneration: job.dispatchGeneration,
    nowMs: config.nowMs,
    lastErrorClass: errorClass,
  });
}

/**
 * Bước 3 — tạo job row nếu chưa có, rồi claim bằng đúng đường mà authority chỉ định.
 *
 * Job row **không** tự mang generation: `dispatch_generation` của row là **authority đọc từ
 * control plane**, và hai đường claim được chọn bằng cách so row với authority đó (§9.2.1).
 *
 * @returns `claimed` kèm row sau claim, hoặc `not-claimed` kèm outcome.
 */
async function claimDelivery(
  deps: ProcessMailCommandDeps,
  config: ProcessMailCommandConfig,
  deliveryId: string,
  delivery: DeliveryMaterial,
): Promise<ClaimResult> {
  const authorityGeneration = delivery.dispatchGeneration;
  let job = await deps.jobs.loadJobByDeliveryId(deliveryId);

  if (job === null) {
    await deps.jobs.createPendingJob({
      deliveryId,
      messageId: delivery.messageId,
      dispatchGeneration: authorityGeneration,
      createdAt: config.nowMs,
      updatedAt: config.nowMs,
    });

    // Đọc lại sau insert: `createPendingJob` có thể trả `duplicate` khi một execution khác vừa
    // tạo row trước đó, và claim phải dựa trên row **thật** chứ không trên giả định "vừa tạo xong
    // nên chắc chắn tồn tại" — nếu không, ta sẽ claim bằng generation của mình khi row thật đang
    // ở generation khác.
    job = await deps.jobs.loadJobByDeliveryId(deliveryId);
    if (job === null) {
      // Insert trả `created` mà đọc lại không thấy: vi phạm hợp đồng của repository, nhưng
      // orchestration vẫn phải có một hành động để consumer làm. Không có row để claim ⇒ không
      // ghi được gì bền vững ⇒ `retry` để Queue giao lại.
      return { kind: 'not-claimed', outcome: RETRY };
    }
  }

  if (job.dispatchGeneration < authorityGeneration) {
    return await claimGenerationAdvance(deps, config, deliveryId, authorityGeneration);
  }

  if (job.dispatchGeneration > authorityGeneration) {
    // Row đang ở generation **cao hơn** authority. Đường (b) guard strict
    // `dispatch_generation < :new_generation` nên không bao giờ reset row về generation cũ, và
    // đường (a) đòi khớp chính xác. Một command tới muộn không được quyền hạ generation
    // (§9.4) — nó chỉ là trigger để resolve lại. Vậy nên ack, không retry: retry sẽ chỉ thấy
    // lại đúng generation đó.
    return { kind: 'not-claimed', outcome: ACK_PROCESSED };
  }

  return await claimSameGeneration(deps, config, deliveryId, authorityGeneration);
}

/**
 * Đường (b) — generation-advance claim: authority đã lớn hơn generation của row.
 *
 * Chỉ có một hướng: generation **lớn hơn**. Không có đường hồi sinh về generation cũ, vì command
 * không mang generation và không thể authorize cái gì.
 */
async function claimGenerationAdvance(
  deps: ProcessMailCommandDeps,
  config: ProcessMailCommandConfig,
  deliveryId: string,
  newDispatchGeneration: number,
): Promise<ClaimResult> {
  const claim = await deps.jobs.claimGenerationAdvance({
    deliveryId,
    newDispatchGeneration,
    owner: config.owner,
    nowMs: config.nowMs,
    leaseMs: config.executionLeaseMs,
  });

  if (claim.kind === 'claimed') {
    return { kind: 'claimed', record: claim.record };
  }

  return {
    kind: 'not-claimed',
    outcome: outcomeForGenerationAdvanceDenial(claim.reason),
  };
}

/**
 * Hành động theo từng lý do bị từ chối của đường (b).
 *
 * `lease-active` ⇒ execution khác đang chạy; command này chỉ là wake-up của authority mới nên
 * ack (hàng 17: "command wake-up ack nếu chưa claim được"). `terminal`/`generation-not-newer`/
 * `missing-job` ⇒ row đã ở trạng thái mà generation mới không áp cho nó; ack. `inconsistent` ⇒
 * row đổi giữa lúc đọc và lúc claim, không suy ra được gì — phải thử lại từ đầu.
 */
function outcomeForGenerationAdvanceDenial(reason: GenerationAdvanceDenial): MailCommandOutcome {
  switch (reason) {
    case 'lease-active':
    case 'terminal':
    case 'generation-not-newer':
    case 'missing-job':
      return ACK_PROCESSED;
    case 'inconsistent':
      return RETRY;
  }
}

/**
 * Đường (a) — claim cùng generation, đường claim duy nhất tiêu ngân sách B.
 *
 * Đây là nơi duy nhất trong orchestration mà `attempts` tăng: `maxExecutionAttempts` là ngân
 * sách của **một** generation, và nó phải được tiêu ở lúc claim chứ không ở lúc persist lỗi
 * (§9.2.2 hàng 6).
 */
async function claimSameGeneration(
  deps: ProcessMailCommandDeps,
  config: ProcessMailCommandConfig,
  deliveryId: string,
  dispatchGeneration: number,
): Promise<ClaimResult> {
  const claim = await deps.jobs.claimSameGeneration({
    deliveryId,
    dispatchGeneration,
    owner: config.owner,
    nowMs: config.nowMs,
    leaseMs: config.executionLeaseMs,
    maxExecutionAttempts: config.maxExecutionAttempts,
  });

  if (claim.kind === 'claimed') {
    return { kind: 'claimed', record: claim.record };
  }

  const outcome = await outcomeForSameGenerationDenial(
    deps,
    config,
    deliveryId,
    dispatchGeneration,
    claim.reason,
  );
  return { kind: 'not-claimed', outcome };
}

/**
 * Hành động theo từng lý do bị từ chối của đường (a).
 *
 * `budget-exhausted` là lý do duy nhất dẫn tới đường (c): chốt `blocked` bằng **một** conditional
 * UPDATE khác, rồi ack — không phải retry, vì state đã bền vững và lần thử tiếp theo chỉ tiêu
 * thêm một slot B không thu hồi được (hàng 5 của §9.2.2).
 *
 * Khi (c) **không** áp dụng được, kết quả là `ack-processed`: nghĩa là đã `blocked` rồi
 * (idempotent) hoặc còn execution sống giữ lease (đường (c) cố ý không cắt ngang execution,
 * §9.2.1). Cả hai đều là "không còn việc cho message này" — retry ở đây chỉ tiêu thêm slot B cho
 * một kết luận không đổi.
 */
async function outcomeForSameGenerationDenial(
  deps: ProcessMailCommandDeps,
  config: ProcessMailCommandConfig,
  deliveryId: string,
  dispatchGeneration: number,
  reason: SameGenerationClaimDenial,
): Promise<MailCommandOutcome> {
  switch (reason) {
    case 'lease-active':
    case 'terminal':
    case 'blocked':
      return ACK_PROCESSED;
    case 'generation-mismatch':
    case 'inconsistent':
    case 'missing-job':
      return RETRY;
    case 'budget-exhausted': {
      const blocked = await deps.jobs.markBlockedBudgetExhausted({
        deliveryId,
        dispatchGeneration,
        nowMs: config.nowMs,
        maxExecutionAttempts: config.maxExecutionAttempts,
      });
      return blocked.kind === 'applied' ? { kind: 'internal-blocked' } : ACK_PROCESSED;
    }
  }
}

/**
 * Bước 4+5 — re-validate lease, gọi provider đúng một lần, persist kết quả, rồi báo outcome.
 *
 * @param delivery Runtime material từ `getDelivery` — nguồn **duy nhất** của
 * recipient/subject/body. `MailJobRecord` không mang chúng: đó là ranh giới dữ liệu của bảng
 * `mail_jobs` (state execution, không phải nội dung thư).
 * @param record Row **sau** claim; `executionGeneration` của nó là token fencing của lần thử
 * này và `leaseExpiresAt` là trần cứng của lần gọi provider.
 */
async function executeClaimedDelivery(
  deps: ProcessMailCommandDeps,
  config: ProcessMailCommandConfig,
  deliveryId: string,
  delivery: DeliveryMaterial,
  record: MailJobRecord,
): Promise<MailCommandOutcome> {
  const expectation: ExecutionExpectation = {
    owner: config.owner,
    executionGeneration: record.executionGeneration,
    dispatchGeneration: record.dispatchGeneration,
  };

  // Re-validate **ngay trước** provider call (§9.2.1). Claim vừa xong thì điều kiện này đúng; giữ
  // nó là để một generation mới supersede execution này trong lúc ta đang dựng request có cửa
  // sổ nhỏ nhất có thể, thay vì chỉ tin claim.
  if (
    !canPersistExecutionResultFor(record, {
      ...expectation,
      nowMs: config.nowMs,
    })
  ) {
    return RETRY;
  }

  // Trần cứng của lần gọi: `min(now + providerTimeoutMs, lease_expires_at)` theo
  // `mail-provider-port.ts`. Với lease vừa claim (`leaseExpiresAt = now + executionLeaseMs`),
  // nhánh thắng là nhánh lease khi `executionLeaseMs` lớn hơn `providerTimeoutMs` — đó chính là
  // điều kiện vận hành mà §9.2.1 đòi. Giữ đúng công thức `min` thay vì chọn một nhánh để ràng
  // buộc đó được kiểm ở một chỗ duy nhất.
  const deadlineMs = Math.min(
    config.nowMs + config.providerTimeoutMs,
    // `canPersistExecutionResultFor` đã bảo đảm `leaseExpiresAt` khác null ở trên; null được
    // thay bằng trần lớn để `Math.min` không nhận `NaN` từ phép so sánh với `undefined`.
    record.leaseExpiresAt ?? Number.MAX_SAFE_INTEGER,
  );

  const request: MailProviderSendRequest = {
    deliveryId,
    recipient: delivery.recipient,
    subject: delivery.subject,
    body: delivery.body,
    contentType: 'text/html',
    deadlineMs,
  };

  const result = await sendOnce(deps.provider, request);
  if (result.kind === 'rejected' && result.errorClass === 'retryable') {
    // §9.2.2 hàng 6: `attempts` **không** tăng ở đây (đã tăng lúc claim), `status` vẫn
    // `processing` để execution kế tiếp claim lại được ngay. Không có gì terminal để ghi, nên
    // đường duy nhất là release + retry.
    await releaseAfterRejection(deps, config, deliveryId, expectation, result.errorCode);
    return RETRY;
  }

  const accepted = result.kind === 'accepted';
  // `credential` ⇒ `blocked` (điều kiện system-level, §9.4); `permanent` ⇒ `failed` (lỗi
  // per-message). Hai nhánh đó là toàn bộ phần còn lại sau khi `retryable` đã thoát khỏi trên.
  const outcome: 'sent' | 'failed' | 'blocked' = accepted
    ? 'sent'
    : result.errorClass === 'permanent'
      ? 'failed'
      : 'blocked';

  const persisted = await deps.jobs.persistExecutionResult({
    deliveryId,
    owner: expectation.owner,
    executionGeneration: expectation.executionGeneration,
    dispatchGeneration: expectation.dispatchGeneration,
    nowMs: config.nowMs,
    outcome,
    providerMessageId: accepted ? orUndefined(result.providerMessageId) : undefined,
    lastError: accepted ? undefined : result.errorCode,
    lastErrorClass: accepted ? undefined : result.errorClass,
  });

  if (persisted.kind === 'denied') {
    return await outcomeAfterLostClaim(deps, deliveryId, expectation);
  }

  await reportOutcomeBestEffort(deps, config, deliveryId, record.dispatchGeneration, outcome, {
    accepted,
    errorClass: accepted ? undefined : result.errorClass,
  });

  return ACK_PROCESSED;
}

/**
 * Gọi provider đúng một lần, không bao giờ để exception thoát ra.
 *
 * Contract của provider port là **resolve** (§11.1): throw chỉ dành cho bug nội bộ không biểu
 * diễn được bằng result contract. Ở đây những throw đó bị hạ xuống thành `rejected` +
 * `retryable` — vì một adapter hỏng không được phép làm hỏng cả consumer: nếu lỗi đó nổi lên
 * thành exception không xử lý được thì Queue sẽ retry theo chính sách của nó, còn ta mất khả
 * năng ghi `last_error` để người sau đó biết adapter đã ném.
 */
async function sendOnce(
  provider: MailProviderPort,
  request: MailProviderSendRequest,
): Promise<MailProviderSendResult> {
  try {
    return await provider.send(request);
  } catch {
    return {
      kind: 'rejected',
      errorClass: 'retryable',
      retryAfterMs: null,
      errorCode: PROVIDER_EXCEPTION_ERROR_CODE,
    };
  }
}

/**
 * Chuỗi rỗng hoặc chỉ có whitespace từ adapter không phải một `providerMessageId` đáng ghi.
 *
 * `mail-provider-port.ts` chốt "chuỗi rỗng hoặc chỉ có whitespace cũng tính là không có", và
 * `assertBoundedOptionalString` chỉ chặn `''` — nên nếu lọc bằng `length === 0` thì một id
 * toàn khoảng trắng vẫn đi vào `provider_message_id`, nơi không có ý nghĩa gì và khó phân
 * biệt với việc adapter **không** trả id. Biến `undefined` (không đưa key vào params) để
 * writer ghi `NULL`, đúng như mọi trường hợp adapter không cho id.
 */
function orUndefined(value: string | null): string | undefined {
  return value === null || value.trim().length === 0 ? undefined : value;
}

/** Release lease sau một rejection không terminal, dùng chung guard của lần claim. */
async function releaseAfterRejection(
  deps: ProcessMailCommandDeps,
  config: ProcessMailCommandConfig,
  deliveryId: string,
  expectation: ExecutionExpectation,
  lastError: string,
): Promise<void> {
  await deps.jobs.releaseExecutionLease({
    deliveryId,
    owner: expectation.owner,
    executionGeneration: expectation.executionGeneration,
    dispatchGeneration: expectation.dispatchGeneration,
    nowMs: config.nowMs,
    lastError,
    lastErrorClass: 'retryable',
  });
}

/**
 * Hành động khi `persistExecutionResult` bị từ chối — nghĩa là execution **đã mất claim**.
 *
 * Provider **đã** được gọi, nên không thể "gửi lại" một lần nữa trong cùng message này: đó là
 * cách sinh duplicate mail. Điều còn làm được là quyết định ack hay retry dựa trên **row hiện
 * tại**:
 *
 * - Row đã ở `pending` ⇒ một execution khác đã persist kết quả và đang chờ báo outcome. Việc
 *   của message này đã xong: ack, còn report sweep lo phần còn lại.
 * - Row ở generation khác ⇒ authority đã tiến, và việc của generation mới không thuộc message
 *   này: ack.
 * - Còn lại (row vẫn `processing`, hoặc không đọc được) ⇒ `retry`, để một lần Queue
 *   redelivery gặp lại đúng state đó và xử lý tiếp.
 *
 * ⚠️ **Residual duplicate hazard** (§9.2 "giới hạn — KHÔNG có exactly-once"): nếu lần gọi
 * provider đã rời khỏi Worker và một execution mới claim lại sau `lease_expires_at`, mail có thể
 * được gửi hai lần. Không guard nào ở tầng database chặn được cửa sổ này; nó được chấp nhận
 * tường minh và chỉ được **giảm** (không phải loại bỏ) bằng provider-side idempotency key
 * (§9.3 — trạng thái capability hiện tại của provider chưa xác minh).
 */
async function outcomeAfterLostClaim(
  deps: ProcessMailCommandDeps,
  deliveryId: string,
  expectation: ExecutionExpectation,
): Promise<MailCommandOutcome> {
  const current = await deps.jobs.loadJobByDeliveryId(deliveryId);
  if (current === null) {
    return RETRY;
  }

  const superseded = current.dispatchGeneration !== expectation.dispatchGeneration;
  if (superseded || current.outcomeReportState === 'pending') {
    return ACK_PROCESSED;
  }

  return RETRY;
}

/**
 * Báo outcome ngay trong lần xử lý này, best-effort.
 *
 * Vì sao báo **ở đây** chứ không để sweep lo hết: `report_attempts` là counter bền vững
 * (`maxReportAttempts` chặn auto-retry) và sweep chỉ chạy theo cron, nên một report bị hoãn sẽ
 * đốt một slot của bound đó cho một thứ mà lần này đã có thể gửi. Báo ngay giữ phần lớn report ở
 * lần gọi đầu; sweep chỉ đón phần còn lại.
 *
 * **Không** `waitUntil`, **không** retry nội bộ: mọi nhánh đều kết thúc ở `ack-processed`, vì
 * job đã terminal bền vững và `outcome_report_state` là đường recovery của nó (§9.2.2 quy tắc
 * "báo lại outcome không bao giờ kéo theo gửi lại mail").
 *
 * @param dispatchGeneration Generation lấy từ row sau claim — **không** đọc lại: vừa persist
 * xong thì chính row đó là nguồn đúng nhất, và một lần đọc thêm chỉ mở thêm cửa sổ để authority
 * tiến trong lúc ta đang báo.
 */
async function reportOutcomeBestEffort(
  deps: ProcessMailCommandDeps,
  config: ProcessMailCommandConfig,
  deliveryId: string,
  dispatchGeneration: number,
  outcome: 'sent' | 'failed' | 'blocked',
  failure: { readonly accepted: boolean; readonly errorClass: MailProviderErrorClass | undefined },
): Promise<void> {
  const reportOwner = reportOwnerToken(config.owner);
  const acquired = await deps.jobs.acquireReportLease({
    deliveryId,
    dispatchGeneration,
    owner: reportOwner,
    nowMs: config.nowMs,
    reportLeaseMs: config.reportLeaseMs,
  });

  if (acquired.kind === 'denied') {
    // Không ai báo được: hoặc report đã chốt, hoặc một sweeper đang giữ report lease. Cả hai đều
    // nghĩa là "không còn việc cho message này" — không phải lỗi, và tuyệt đối không phải lý do
    // để kéo `sent` về `retry` (sẽ tạo retry-storm trên một việc đã xong).
    return;
  }

  const reported = await reportOutcomeOnce(deps.gateway, deliveryId, {
    outcome,
    dispatchGeneration,
    ...(failure.errorClass === undefined ? {} : { errorClass: failure.errorClass }),
  });

  await completeOrKeepReport(
    deps,
    config,
    deliveryId,
    dispatchGeneration,
    reportOwner,
    dispositionForControlPlaneOutcome(reported),
  );
}

/**
 * Gọi `POST .../outcome` một lần, không để exception thoát ra.
 *
 * Đường này chạy **sau** khi kết quả đã persist bền vững, nên một exception ở đây không được đổi
 * hành vi của job — cũng giống provider adapter. `transient` là tín hiệu đúng cho một exception
 * đó: report phải được báo lại, và `dispositionForControlPlaneOutcome` sẽ giữ `pending` để
 * sweep đón.
 */
async function reportOutcomeOnce(
  gateway: MailDeliveryGateway,
  deliveryId: string,
  report: OutcomeReportRequest,
): Promise<ControlPlaneOutcomeSignal> {
  try {
    return controlPlaneSignalOf(await gateway.reportOutcome(deliveryId, report));
  } catch {
    return 'transient';
  }
}

/**
 * Chốt (hoặc giữ) `outcome_report_state` theo signal của control plane.
 *
 * Dùng đúng {@link dispositionForControlPlaneOutcome} của `mail-job-rules` thay vì viết lại
 * bảng: đó là nguồn duy nhất, và nó đã phân biệt `stale`/`404` (terminal) với
 * `transient`/`400`/`401`/`403` (giữ `pending`) — bốn nhánh đó có hậu quả vận hành khác nhau và
 * viết tay lại chắc chắn sẽ lệch ở một chỗ.
 */
async function completeOrKeepReport(
  deps: ProcessMailCommandDeps,
  config: ProcessMailCommandConfig,
  deliveryId: string,
  dispatchGeneration: number,
  reportOwner: string,
  disposition: OutcomeReportDisposition,
): Promise<void> {
  if (disposition.kind === 'keep-pending') {
    await deps.jobs.keepReportPending({
      deliveryId,
      dispatchGeneration,
      owner: reportOwner,
      nowMs: config.nowMs,
    });
    return;
  }

  await deps.jobs.completeReport({
    deliveryId,
    dispatchGeneration,
    owner: reportOwner,
    nowMs: config.nowMs,
    disposition: disposition.kind,
  });
}

/**
 * `OutcomeReportResult` của gateway → {@link ControlPlaneOutcomeSignal} của rules.
 *
 * Cả hai union đều khai đúng bảy nhánh và ánh xạ 1-1 theo tên, nên đây là một bảng tra cứu thuần
 * chứ không phải một quyết định: viết tay lại nó chỉ tạo thêm một chỗ để lệch.
 */
function controlPlaneSignalOf(result: OutcomeReportResult): ControlPlaneOutcomeSignal {
  switch (result.kind) {
    case 'applied':
      return 'applied';
    case 'duplicate':
      return 'duplicate';
    case 'stale':
      return 'stale';
    case 'not-found':
      return 'not-found';
    case 'auth-rejected':
      return 'auth-rejected';
    case 'contract-rejected':
      return 'contract-rejected';
    case 'transient':
      return 'transient';
  }
}
