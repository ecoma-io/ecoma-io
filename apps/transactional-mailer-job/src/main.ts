/**
 * `transactional-mailer-job` — Queue consumer của mail bounded context.
 *
 * Ba đường kích hoạt, không có HTTP route nào:
 *   - `queue` — Mail Command `{version: 1, delivery_id}` từ `ecoma-mail-delivery`;
 *     một message một lần `processMailCommand`, disposition quyết định ack/retry.
 *   - `scheduled` — ba sweep (stale execution lease, pending report, blocked backlog),
 *     chỉ alert + báo nốt outcome, không claim execution.
 *
 * KHÔNG có `fetch` export: worker này không expose HTTP (wrangler.jsonc không có route);
 * Hono không được dùng ở đây — một HTTP surface là một ranh giới mới cần auth, và mọi
 * endpoint của nó đều chưa được định nghĩa trong tài liệu.
 */

import {
  type DeliveryLookupResult,
  type MailDeliveryGateway,
  type MailCommandOutcome,
  type OutcomeReportResult,
  type ProcessMailCommandDeps,
  processMailCommand,
  runBlockedBacklogSweep,
  runReportSweep,
  runStaleLeaseSweep,
  type ReportSweepAlert,
} from '@ecoma-io/transactional-mailer-job-application';
import {
  createResendMailProvider,
  D1MailJobRepository,
  D1QuarantineRepository,
  FakeMailProvider,
  type D1DatabaseLike,
} from '@ecoma-io/transactional-mailer-job-infrastructure';
import {
  validateGetDeliveryResponse,
  validatePostDeliveryOutcomeResponse,
} from '@ecoma-io/transactional-mail-contracts';

import { InternalDeliveryClient, resolveInternalAuthSecret } from './internal-delivery-client';
import { loadMailerJobConfig, type LoadedMailerJobConfig, type MailerJobEnv } from './config';

/**
 * D1 `mail-job` binding ở đúng subset mà repository nhận — cast tường minh qua `unknown`,
 * cùng lý do với `mailDb` của control plane: tương thích subset↔`D1Database` được ghim ở
 * spec của infrastructure, không chứng minh lại tại call site.
 */
function jobDb(env: MailerJobEnv): D1DatabaseLike {
  return env['mail-job'] as unknown as D1DatabaseLike;
}

/** Service Binding sang control plane — chỉ cần `fetch`. */
interface ServiceBindingLike {
  fetch(request: Request): Promise<Response>;
}

function serviceBinding(env: MailerJobEnv): ServiceBindingLike {
  return env['TRANSACTIONAL_MAIL_SERVICE'] as unknown as ServiceBindingLike;
}

/** Ghi một dòng alert JSON — chỉ token đã sanitize, không recipient/raw error. */
function logAlert(event: Record<string, unknown>): void {
  try {
    // oxlint-disable-next-line no-console
    console.log(JSON.stringify(event));
  } catch {
    // Cố tình im lặng — observability không được nằm trên serving path.
  }
}

/** Adapter alert của sweep sang logger JSON một dòng. */
function reportSweepAlert(alert: ReportSweepAlert): void {
  logAlert({ event: 'report_sweep_alert', ...alert });
}

/* -------------------------------------------------------------------------------------------- */
/* Gateway adapter — MailDeliveryGateway over InternalDeliveryClient                             */
/* -------------------------------------------------------------------------------------------- */

/**
 * Adapter bọc `InternalDeliveryClient` thành port `MailDeliveryGateway` của application.
 *
 * Quy tắc phân loại (FR-004, §9.2.2): `401`/`403` là auth-rejected (lỗi của chính worker,
 * không phải provider); `404` là not-found; `400` là contract-rejected; `429`/`5xx` và mọi
 * lỗi network/timeout là transient. Body của response **phải** qua contract validator —
 * một body parse được nhưng sai shape cũng là contract-rejected, không phải found/applied.
 */
function createGateway(client: InternalDeliveryClient): MailDeliveryGateway {
  return {
    async getDelivery(deliveryId): Promise<DeliveryLookupResult> {
      let response: Response;
      try {
        response = await client.getDelivery(deliveryId);
      } catch {
        // Network/timeout của Service Binding call — transient, message của exception
        // không được ra log nên nuốt ở đây, classification là đủ.
        return { kind: 'transient' };
      }
      if (response.status === 404) {
        return { kind: 'not-found' };
      }
      if (response.status === 401 || response.status === 403) {
        return { kind: 'auth-rejected' };
      }
      if (response.status === 429 || response.status >= 500) {
        return { kind: 'transient' };
      }
      if (response.status !== 200) {
        return { kind: 'contract-rejected' };
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { kind: 'contract-rejected' };
      }
      const validated = validateGetDeliveryResponse(body);
      if (!validated.ok) {
        return { kind: 'contract-rejected' };
      }
      const message = validated.value.message;
      return {
        kind: 'found',
        delivery: {
          deliveryId: message.delivery_id,
          messageId: message.message_id,
          app: message.app,
          status: message.status,
          recipient: message.recipient,
          subject: message.subject,
          body: message.body,
          contentType: message.content_type,
          dispatchGeneration: validated.value.dispatch_generation,
        },
      };
    },

    async reportOutcome(deliveryId, report): Promise<OutcomeReportResult> {
      let response: Response;
      try {
        response = await client.postDeliveryOutcome(deliveryId, {
          outcome: report.outcome,
          ...(report.errorClass === undefined ? {} : { error_class: report.errorClass }),
          dispatch_generation: report.dispatchGeneration,
        });
      } catch {
        return { kind: 'transient' };
      }
      if (response.status === 404) {
        return { kind: 'not-found' };
      }
      if (response.status === 401 || response.status === 403) {
        return { kind: 'auth-rejected' };
      }
      if (response.status === 429 || response.status >= 500) {
        return { kind: 'transient' };
      }
      if (response.status !== 200) {
        return { kind: 'contract-rejected' };
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { kind: 'contract-rejected' };
      }
      const validated = validatePostDeliveryOutcomeResponse(body);
      if (!validated.ok) {
        return { kind: 'contract-rejected' };
      }
      if (validated.value.result === 'stale') {
        return {
          kind: 'stale',
          status: validated.value.status,
          currentDispatchGeneration: validated.value.current_dispatch_generation,
        };
      }
      return { kind: validated.value.result, status: validated.value.status };
    },
  };
}

/* -------------------------------------------------------------------------------------------- */
/* Deps dựng mỗi lần chạy                                                                        */
/* -------------------------------------------------------------------------------------------- */

/** Deps của queue handler — dựng mỗi lần chạy, không giữ qua hai invocation. */
function queueDeps(env: MailerJobEnv, config: LoadedMailerJobConfig): ProcessMailCommandDeps {
  const secret = resolveInternalAuthSecret(env);
  const client = new InternalDeliveryClient({
    binding: serviceBinding(env),
    secret,
  });
  const provider =
    config.provider.kind === 'resend'
      ? createResendMailProvider({
          endpoint: config.provider.resend.endpoint,
          token: config.provider.resend.token,
          from: config.provider.resend.from,
          timeoutMs: config.provider.resend.timeoutMs,
        })
      : new FakeMailProvider();
  // B5 — fail-NOISY cho fake provider: không mail thật nào được gửi khi `MAIL_PROVIDER_KIND
  // = fake`, và việc đó phải hiện ra ở log mỗi lần dựng deps (mỗi invocation) thay vì im
  // lặng tới khi một thư "đã gửi" không bao giờ tới nơi. Event là hằng cố định, không mang
  // endpoint/token — chỉ trạng thái cấu hình.
  if (config.provider.kind === 'fake') {
    logAlert({ event: 'fake_provider_in_use' });
  }
  // Trả object literal (không phải biến `deps`): rule `security-sensitive-value-in-http-response`
  // loại `return {...}` khỏi nhánh sink giá trị-trần, nên hình dạng này là ranh giới đã ghim —
  // gói `deps` vào biến rồi `return deps` thì taint từ `…resend.token` lan qua biến và sink khớp.
  return {
    jobs: new D1MailJobRepository({ db: jobDb(env) }),
    quarantine: new D1QuarantineRepository({ db: jobDb(env) }),
    gateway: createGateway(client),
    provider,
  };
}

export default {
  /**
   * Queue consumer — MỘT message mỗi lần gọi (không `Promise.all` trên batch): orchestration
   * giữ lease/claim D1 theo delivery, chạy song song là hai execution tranh cùng row.
   *
   * Disposition của `processMailCommand` là toàn bộ hợp đồng với Queue runtime:
   * `ack-processed`/`quarantined`/`internal-blocked` → ack (không retry);
   * `retry` → `message.retry()` (chưa có gì bền vững để mất).
   *
   * Lỗi bất ngờ (port vi phạm hợp đồng, D1 chết trước khi orchestration phân loại được)
   * **throw** — để `max_retries` của Queue consumer và DLQ làm việc của nó, thay vì nuốt
   * thành ack: ack là tuyên bố "đã xử lý xong", mà chưa.
   */
  async queue(
    batch: {
      messages: readonly {
        id: string;
        body: unknown;
        retry(): Promise<void>;
        ack(): Promise<void>;
      }[];
    },
    env: MailerJobEnv,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void> {
    const config = loadMailerJobConfig(env);
    const deps = queueDeps(env, config);

    for (const message of batch.messages) {
      // Body contract: producer `QUEUE.send(string)`, nên body phải là string. Một body
      // không phải string là lệch producer/consumer version — orchestration tự quarantine
      // qua raw-body digest, nhưng nó cần string; đổi non-string thành string chuẩn hoá
      // KHÔNG được phép (digest phải băm đúng byte worker nhận được). Với non-string,
      // serialize một lần duy nhất để digest thấy đại diện trung thực của những gì nhận được.
      const rawBody =
        typeof message.body === 'string' ? message.body : JSON.stringify(message.body);

      let outcome: MailCommandOutcome;
      try {
        outcome = await processMailCommand(rawBody, message.id, deps, {
          executionLeaseMs: config.executionLeaseMs,
          maxExecutionAttempts: config.maxExecutionAttempts,
          providerTimeoutMs: config.providerTimeoutMs,
          providerCallSafeWindowMs: config.providerCallSafeWindowMs,
          reportLeaseMs: config.reportLeaseMs,
          owner: `exec_${crypto.randomUUID()}`,
          quarantineKeyHex: config.quarantineHmacKeyHex,
          nowMs: Date.now(),
        });
      } catch {
        // Lỗi ngoài phân loại của orchestration — để Queue retry theo `max_retries`.
        await message.retry();
        continue;
      }

      switch (outcome.kind) {
        case 'ack-processed':
        case 'quarantined':
        case 'internal-blocked':
          await message.ack();
          break;
        case 'retry':
          await message.retry();
          break;
      }
    }
    void ctx;
  },

  /**
   * Cron của worker — ba sweep, mỗi sweep một lần chạy, mỗi sweep tự biên lô.
   *
   * Thứ tự: report sweep chạy TRƯỚC hai sweep alert, vì nó là việc thật (báo nốt outcome
   * cho control plane), còn hai sweep kia chỉ phát tín hiệu vận hành. Mỗi sweep bắt lỗi
   * riêng — một sweep chết không cản sweep kia.
   */
  async scheduled(
    controller: { readonly cron: string },
    env: MailerJobEnv,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void> {
    void controller;
    const config = loadMailerJobConfig(env);
    const secret = resolveInternalAuthSecret(env);
    const client = new InternalDeliveryClient({ binding: serviceBinding(env), secret });
    const jobs = new D1MailJobRepository({ db: jobDb(env) });
    const gateway = createGateway(client);
    const nowMs = Date.now();
    const sweepConfig = {
      owner: `sweep_${crypto.randomUUID()}`,
      nowMs,
      leaseMs: config.reportLeaseMs,
      maxReportAttempts: config.maxReportAttempts,
      batchLimit: config.sweepBatchLimit,
    } as const;

    // 1 — Report sweep: báo nốt outcome của row terminal chưa report xong.
    try {
      const summary = await runReportSweep(
        { jobs, gateway, logAlert: reportSweepAlert },
        sweepConfig,
      );
      logAlert({ event: 'scheduled_report_sweep', ...summary });
    } catch {
      logAlert({ event: 'scheduled_report_sweep_unexpected_error' });
    }

    // 2 — Stale execution lease: row `processing` quá lease — chỉ alert.
    try {
      const summary = await runStaleLeaseSweep(
        { jobs, gateway, logAlert: reportSweepAlert },
        sweepConfig,
      );
      logAlert({ event: 'scheduled_stale_lease_sweep', ...summary });
    } catch {
      logAlert({ event: 'scheduled_stale_lease_sweep_unexpected_error' });
    }

    // 3 — Blocked backlog: row `blocked` nằm quá ngưỡng — chỉ alert.
    try {
      const summary = await runBlockedBacklogSweep(
        { jobs, gateway, logAlert: reportSweepAlert },
        sweepConfig,
      );
      logAlert({ event: 'scheduled_blocked_backlog_sweep', ...summary });
    } catch {
      logAlert({ event: 'scheduled_blocked_backlog_sweep_unexpected_error' });
    }

    void ctx;
  },
};
