/**
 * Integration test của composition root `src/main.ts` trên **D1 thật** (miniflare/workerd
 * qua `wrangler.getPlatformProxy`), không mock SQL: route FR-001 qua HMAC envelope thật,
 * idempotency replay/conflict trên row thật, outcome guarded transition, publish loop qua
 * Queue binding giả, và redispatch adapter hai statement (statement (1) trả 0 hàng ⇒
 * statement (2) không chạy — `budget-exhausted` phải dừng hẳn).
 *
 * Nguồn canonical: `docs/services/transactional-mail/01-architecture.md` §6.1–§6.2.2, §6.5,
 * §7.2; `02-requirements.md` FR-001. Harness migrations theo `mail-d1.spec.ts` (wrangler
 * CLI `d1 migrations apply` — đúng công cụ production dùng).
 *
 * Ranh giới của suite này: KHÔNG chứng minh exactly-once provider, KHÔNG chứng minh
 * behaviour của Cloudflare Queues runtime thật (Queue ở đây là fake in-memory capture);
 * những điều đó thuộc về runtime verification (01-architecture.md, release gate).
 */

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { signRequest } from '@ecoma-io/identity-auth-contracts';

import worker from './main';
import { FINGERPRINT_KEYRING_ENV, type TransactionalMailEnv } from './config';

// Không gửi telemetri khi spawn wrangler trong test.
process.env['WRANGLER_SEND_METRICS'] = 'false';

const requireFromSpec = createRequire(import.meta.url);
// `wrangler` là devDependency ở root; getPlatformProxy khởi động workerd/miniflare trong
// tiến trình, cho D1 binding thật với bound parameter.
const { getPlatformProxy } = requireFromSpec('wrangler') as typeof import('wrangler');

const appDir = join(import.meta.dirname, '..');
const wranglerConfig = join(appDir, 'wrangler.jsonc');
const wranglerCli = requireFromSpec.resolve('wrangler');

/** Mốc thời gian tuyệt đối cho seed — envelope timestamp thì theo đồng hồ thật (skew check). */
const NOW_MS = 1_790_000_000_000;

const SECRET_ACCOUNT = 'secret-svc-account-main-spec';
const SECRET_MAILER_JOB = 'secret-svc-mailer-job-main-spec';
const KEY_A = 'b'.repeat(64);

/** Thân POST /v1/messages canonical — OTP hợp lệ theo schema của template seed. */
const TEMPLATE_BODY = JSON.stringify({
  template: 'welcome',
  recipient: 'user@example.test',
  variables: { otp: '123456' },
});

type MailEnv = { readonly mail: unknown; readonly QUEUE: unknown };

let proxy: { env: MailEnv; dispose(): Promise<unknown> } | null = null;
let persistDir = '';

/**
 * Env đầy đủ cho cả `getConfig` lẫn bindings.
 *
 * ⚠️ `main.ts` cache config promise ở module scope (một isolate một lần nạp), nên MỌI test
 * trong file này dùng chung một bộ giá trị config — không test nào được override env config.
 */
function makeEnv(d1: unknown, queue: unknown): TransactionalMailEnv {
  return {
    [FINGERPRINT_KEYRING_ENV]: JSON.stringify({ current: 'p1.k1', keys: { 'p1.k1': KEY_A } }),
    MAIL_INTERNAL_AUTH_SECRET_SVC_ACCOUNT: SECRET_ACCOUNT,
    MAIL_INTERNAL_AUTH_SECRET_SVC_AUTH: 'secret-svc-auth-main-spec',
    MAIL_INTERNAL_AUTH_SECRET_SVC_PAYMENT: 'secret-svc-payment-main-spec',
    MAIL_INTERNAL_AUTH_SECRET_SVC_TRANSACTIONAL_MAILER_JOB: SECRET_MAILER_JOB,
    MAIL_RATE_LIMIT_PRINCIPAL_LIMIT: '60',
    MAIL_RATE_LIMIT_PRINCIPAL_WINDOW_MS: '60000',
    MAIL_RATE_LIMIT_SYSTEM_LIMIT: '10000',
    MAIL_RATE_LIMIT_SYSTEM_WINDOW_MS: '60000',
    MAIL_RATE_LIMIT_KEY_LIMIT: '20',
    MAIL_RATE_LIMIT_KEY_WINDOW_MS: '60000',
    MAIL_RENDER_MAX_BYTES: '64000',
    MAIL_PUBLISH_LEASE_MS: '30000',
    MAIL_PUBLISH_BATCH_LIMIT: '10',
    MAIL_PUBLISH_MAX_ATTEMPTS: '5',
    MAIL_PUBLISH_BACKOFF_BASE_MS: '1000',
    MAIL_RECONCILER_MAX_AGE_MS: '600000',
    MAIL_RECONCILER_BATCH_LIMIT: '50',
    MAIL_RECOVERY_MAX_CYCLES: '2',
    MAIL_NONCE_PRUNE_BATCH_LIMIT: '500',
    MAIL_RETENTION_CONTENT_MS: '2592000000',
    MAIL_RETENTION_STALE_ALERT_MS: '86400000',
    mail: d1,
    QUEUE: queue,
  } as unknown as TransactionalMailEnv;
}

/** Env CỐ Ý không có binding nào — cho ca chứng minh /health không chạm D1/Queue. */
function makeBindinglessEnv(): TransactionalMailEnv {
  return {
    [FINGERPRINT_KEYRING_ENV]: JSON.stringify({ current: 'p1.k1', keys: { 'p1.k1': KEY_A } }),
    MAIL_INTERNAL_AUTH_SECRET_SVC_ACCOUNT: SECRET_ACCOUNT,
    MAIL_INTERNAL_AUTH_SECRET_SVC_AUTH: 'secret-svc-auth-main-spec',
    MAIL_INTERNAL_AUTH_SECRET_SVC_PAYMENT: 'secret-svc-payment-main-spec',
    MAIL_INTERNAL_AUTH_SECRET_SVC_TRANSACTIONAL_MAILER_JOB: SECRET_MAILER_JOB,
    MAIL_RATE_LIMIT_PRINCIPAL_LIMIT: '60',
    MAIL_RATE_LIMIT_PRINCIPAL_WINDOW_MS: '60000',
    MAIL_RATE_LIMIT_SYSTEM_LIMIT: '10000',
    MAIL_RATE_LIMIT_SYSTEM_WINDOW_MS: '60000',
    MAIL_RATE_LIMIT_KEY_LIMIT: '20',
    MAIL_RATE_LIMIT_KEY_WINDOW_MS: '60000',
    MAIL_RENDER_MAX_BYTES: '64000',
    MAIL_PUBLISH_LEASE_MS: '30000',
    MAIL_PUBLISH_BATCH_LIMIT: '10',
    MAIL_PUBLISH_MAX_ATTEMPTS: '5',
    MAIL_PUBLISH_BACKOFF_BASE_MS: '1000',
    MAIL_RECONCILER_MAX_AGE_MS: '600000',
    MAIL_RECONCILER_BATCH_LIMIT: '50',
    MAIL_RECOVERY_MAX_CYCLES: '2',
    MAIL_NONCE_PRUNE_BATCH_LIMIT: '500',
    MAIL_RETENTION_CONTENT_MS: '2592000000',
    MAIL_RETENTION_STALE_ALERT_MS: '86400000',
  } as unknown as TransactionalMailEnv;
}

/** ExecutionContext mock đầy đủ hình — handler chỉ gọi `waitUntil`, còn lại là no-op. */
const executionContext = {
  waitUntil: (_promise: Promise<unknown>): void => undefined,
  passThroughOnException: (): void => undefined,
  props: {},
};

/** Ký bằng secret của MJ và gửi tới worker entrypoint — envelope HMAC thật của contract. */
async function mjFetch(
  env: TransactionalMailEnv,
  options: {
    readonly method: 'POST' | 'GET';
    readonly path: string;
    readonly body?: Uint8Array | null;
    readonly headers?: Record<string, string>;
  },
): Promise<Response> {
  const headers = await signRequest({
    method: options.method,
    path: options.path,
    body: options.body ?? null,
    secret: SECRET_MAILER_JOB,
    timestamp: String(Math.floor(Date.now() / 1000)),
  });
  const request = new Request(`https://mail.internal${options.path}`, {
    method: options.method,
    headers: new Headers({ ...headers, ...options.headers }),
    body:
      options.body === undefined || options.body === null ? undefined : (options.body as BodyInit),
  });
  return await worker.fetch(request, env, executionContext);
}

/** Ký bằng secret của principal `svc.account` và POST /v1/messages. */
async function accountPost(
  env: TransactionalMailEnv,
  body: string,
  idempotencyKey: string,
): Promise<Response> {
  const encoded = new TextEncoder().encode(body);
  const headers = await signRequest({
    method: 'POST',
    path: '/v1/messages',
    body: encoded,
    secret: SECRET_ACCOUNT,
    timestamp: String(Math.floor(Date.now() / 1000)),
  });
  const request = new Request('https://mail.internal/v1/messages', {
    method: 'POST',
    headers: new Headers({ ...headers, 'Idempotency-Key': idempotencyKey }),
    body: encoded as BodyInit,
  });
  return await worker.fetch(request, env, executionContext);
}

async function rawRows<T = Record<string, unknown>>(
  env: TransactionalMailEnv,
  sql: string,
  ...binds: unknown[]
): Promise<T[]> {
  const db = env['mail'] as {
    prepare(sql: string): { bind(...v: unknown[]): { all<T>(): Promise<{ results: T[] }> } };
  };
  const { results } = await db
    .prepare(sql)
    .bind(...binds)
    .all<T>();
  return results;
}

/** Queue giả — capture command theo thứ tự send. */
function captureQueue(): { readonly sent: string[]; readonly binding: unknown } {
  const sent: string[] = [];
  return {
    sent,
    binding: {
      send(message: string): Promise<void> {
        sent.push(message);
        return Promise.resolve();
      },
    },
  };
}

/**
 * Số command Queue đã send cho MỘT delivery — D1 dùng chung giữa các test nên publish
 * batch drain cả pending row của seed khác; assertion theo delivery mới là đúng nghĩa.
 */
function sentCountFor(sent: readonly string[], deliveryId: string): number {
  return sent.filter((entry) => {
    try {
      return (JSON.parse(entry) as { delivery_id?: string }).delivery_id === deliveryId;
    } catch {
      return false;
    }
  }).length;
}

beforeAll(async () => {
  persistDir = mkdtempSync(join(tmpdir(), 'tm-main-'));
  // CLI `--persist-to` ghi vào `<dir>/v3/d1/...` còn `getPlatformProxy` dùng path nguyên văn,
  // nên proxy phải trỏ vào con `v3` — cùng quy tắc `mail-d1.spec.ts` đã ghim.
  proxy = await getPlatformProxy<MailEnv>({
    configPath: wranglerConfig,
    persist: { path: join(persistDir, 'v3') },
  });
  // Áp migration bằng CLI — đúng công cụ production dùng.
  execFileSync(
    process.execPath,
    [
      wranglerCli,
      'd1',
      'migrations',
      'apply',
      'mail',
      '--local',
      '--config',
      wranglerConfig,
      '--persist-to',
      persistDir,
    ],
    {
      encoding: 'utf8',
      timeout: 180_000,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      maxBuffer: 32 * 1024 * 1024,
    },
  );

  // Migrations phải được áp đủ — nếu thiếu file nào thì mọi test dưới fail ầm ầm, fail sớm.
  const applied = readdirSync(join(persistDir, 'v3', 'd1')).length;
  if (applied === 0) {
    throw new Error(`expected migrations applied under ${persistDir}`);
  }

  // Template seed — active en v1, schema hai biến cùng hình `templateRecord` của application
  // spec dùng (otp bắt buộc max 8, cta_url tuỳ chọn format url).
  const db = proxy.env['mail'] as {
    prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown> } };
  };
  await db
    .prepare(
      `INSERT INTO mail_templates (id, name, locale, version, subject_template, body_template, ` +
        `variables_schema_json, status, created_at, updated_at) VALUES (?, ?, 'en', 1, ?, ?, ?, 'active', ?, ?)`,
    )
    .bind(
      'tpl-main-welcome-en',
      'welcome',
      'Reset code {{ otp }}',
      '<p>Your code is {{ otp }}</p>',
      JSON.stringify({
        schema_version: 1,
        variables: {
          otp: { type: 'string', required: true, max_length: 8 },
          cta_url: { type: 'string', required: false, max_length: 2048, format: 'url' },
        },
      }),
      NOW_MS,
      NOW_MS,
    )
    .run();
}, 120_000);

afterAll(async () => {
  await proxy?.dispose();
  if (persistDir !== '') {
    rmSync(persistDir, { recursive: true, force: true });
  }
});

describe('GET /health (smoke, no auth, no D1)', () => {
  it('returns 200 ok on an env without any binding touched', async () => {
    // Env CỐ Ý không có `mail`/`QUEUE`: /health phải không đọc binding nào (runbook phân
    // biệt "không boot" với "còn sống" — xem main.ts JSDoc của route). Nếu route chạm D1,
    // ca này chết ngay với binding undefined.
    const response = await worker.fetch(
      new Request('https://mail.internal/health'),
      makeBindinglessEnv(),
      executionContext,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { service: string; status: string };
    expect(body.service).toBe('transactional-mail');
    expect(body.status).toBe('ok');
  });
});

describe('POST /v1/messages (FR-001 end to end on real D1)', () => {
  it('creates a message and outbox atomically through the authenticated route', async () => {
    const env = makeEnv(proxy?.env['mail'], proxy?.env['QUEUE']);
    const response = await accountPost(env, TEMPLATE_BODY, 'main-spec-key-1');

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      readonly id: string;
      readonly delivery_id: string;
      readonly app: string;
      readonly status: string;
      readonly created: boolean;
    };
    // `app` suy từ principal `svc.account` — server-controlled, không phải dữ liệu caller.
    expect(body.app).toBe('account');
    expect(body.created).toBe(true);
    expect(body.status).toBe('accepted');
    expect(body.delivery_id).toMatch(/^dlv_/u);
    expect(body.id).toMatch(/^msg_/u);

    const rows = await rawRows<{ status: string }>(
      env,
      'SELECT status FROM mail_outbox WHERE delivery_id = ?',
      body.delivery_id,
    );
    expect(rows).toEqual([{ status: 'pending' }]);
  });

  it('replays the same logical result and creates no second row for the same key', async () => {
    const env = makeEnv(proxy?.env['mail'], proxy?.env['QUEUE']);
    const first = await accountPost(env, TEMPLATE_BODY, 'main-spec-key-2');
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { readonly delivery_id: string };

    const replay = await accountPost(env, TEMPLATE_BODY, 'main-spec-key-2');
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as {
      readonly delivery_id: string;
      readonly created: boolean;
    };
    expect(replayBody.delivery_id).toBe(firstBody.delivery_id);
    expect(replayBody.created).toBe(false);

    const outboxRows = await rawRows<{ delivery_id: string }>(
      env,
      'SELECT delivery_id FROM mail_outbox WHERE delivery_id = ?',
      firstBody.delivery_id,
    );
    expect(outboxRows).toEqual([{ delivery_id: firstBody.delivery_id }]);
  });

  it('returns 409 for the same key with a different payload', async () => {
    const env = makeEnv(proxy?.env['mail'], proxy?.env['QUEUE']);
    const conflictBody = JSON.stringify({
      template: 'welcome',
      recipient: 'other@example.test',
      variables: { otp: '654321' },
    });
    const conflict = await accountPost(env, conflictBody, 'main-spec-key-2');
    expect(conflict.status).toBe(409);
    const conflictJson = (await conflict.json()) as { readonly error: { readonly code: string } };
    expect(conflictJson.error.code).toBe('idempotency_key_conflict');
  });

  it('rejects an unsigned request with the unified 401 and never reaches the use case', async () => {
    const env = makeEnv(proxy?.env['mail'], proxy?.env['QUEUE']);
    const request = new Request('https://mail.internal/v1/messages', {
      method: 'POST',
      headers: new Headers({ 'Idempotency-Key': 'unsigned-key' }),
      body: TEMPLATE_BODY,
    });
    const response = await worker.fetch(request, env, executionContext);
    expect(response.status).toBe(401);
    const rows = await rawRows<{ n: number }>(
      env,
      "SELECT COUNT(*) AS n FROM mail_messages WHERE idempotency_key = 'unsigned-key'",
    );
    expect(rows).toEqual([{ n: 0 }]);
  });

  it('rejects a request with a query string before any use-case work, with the unified 401', async () => {
    const env = makeEnv(proxy?.env['mail'], proxy?.env['QUEUE']);
    const encoded = new TextEncoder().encode(TEMPLATE_BODY);
    const headers = await signRequest({
      method: 'POST',
      path: '/v1/messages',
      body: encoded,
      secret: SECRET_ACCOUNT,
      timestamp: String(Math.floor(Date.now() / 1000)),
    });
    const request = new Request('https://mail.internal/v1/messages?debug=1', {
      method: 'POST',
      headers: new Headers({ ...headers, 'Idempotency-Key': 'query-key' }),
      body: encoded as BodyInit,
    });
    const response = await worker.fetch(request, env, executionContext);
    expect(response.status).toBe(401);
    // `invalid_field` không được hoá ra 401 oracle — mã public vẫn là `unauthorized`.
    const body = (await response.json()) as { readonly error: { readonly code: string } };
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns 400 for a missing Idempotency-Key only after successful authentication', async () => {
    const env = makeEnv(proxy?.env['mail'], proxy?.env['QUEUE']);
    const encoded = new TextEncoder().encode(TEMPLATE_BODY);
    const headers = await signRequest({
      method: 'POST',
      path: '/v1/messages',
      body: encoded,
      secret: SECRET_ACCOUNT,
      timestamp: String(Math.floor(Date.now() / 1000)),
    });
    const request = new Request('https://mail.internal/v1/messages', {
      method: 'POST',
      headers: new Headers(headers),
      body: encoded as BodyInit,
    });
    const response = await worker.fetch(request, env, executionContext);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { readonly error: { readonly code: string } };
    expect(body.error.code).toBe('invalid_request');
  });

  it('returns 403 when the authenticated principal lacks message.create', async () => {
    const env = makeEnv(proxy?.env['mail'], proxy?.env['QUEUE']);
    // `svc.transactional-mailer-job` chỉ có delivery-read + delivery-outcome, không message-create.
    const encoded = new TextEncoder().encode(TEMPLATE_BODY);
    const headers = await signRequest({
      method: 'POST',
      path: '/v1/messages',
      body: encoded,
      secret: SECRET_MAILER_JOB,
      timestamp: String(Math.floor(Date.now() / 1000)),
    });
    const request = new Request('https://mail.internal/v1/messages', {
      method: 'POST',
      headers: new Headers({ ...headers, 'Idempotency-Key': 'wrong-permission-key' }),
      body: encoded as BodyInit,
    });
    const response = await worker.fetch(request, env, executionContext);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { readonly error: { readonly code: string } };
    expect(body.error.code).toBe('forbidden');
  });

  it('returns 404 template_not_found when no active template matches', async () => {
    const env = makeEnv(proxy?.env['mail'], proxy?.env['QUEUE']);
    const response = await accountPost(
      env,
      JSON.stringify({ template: 'missing-template', recipient: 'u@example.test', variables: {} }),
      'template-missing-key',
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { readonly error: { readonly code: string } };
    expect(body.error.code).toBe('template_not_found');
  });

  it('rejects a payload beyond the declared render bound as payload_too_large', async () => {
    const env = makeEnv(proxy?.env['mail'], proxy?.env['QUEUE']);
    // 64 KiB là trần render (`MAIL_RENDER_MAX_BYTES`); body 70 KiB vượt trước khi chạm use case.
    const huge = JSON.stringify({
      template: 'welcome',
      recipient: 'user@example.test',
      variables: { otp: '1'.repeat(70_000) },
    });
    const response = await accountPost(env, huge, 'payload-too-large-key');
    expect(response.status).toBe(413);
    const body = (await response.json()) as { readonly error: { readonly code: string } };
    expect(body.error.code).toBe('payload_too_large');
  });
});

describe('internal delivery routes on real D1 (§7.2, §6.2.2)', () => {
  let env: TransactionalMailEnv;
  let deliveryId = '';

  beforeAll(async () => {
    env = makeEnv(proxy?.env['mail'], proxy?.env['QUEUE']);
    const response = await accountPost(env, TEMPLATE_BODY, 'routes-seed-key');
    // beforeAll không phải test block với `vitest/no-standalone-expect`; assert thủ công.
    if (response.status !== 201) {
      throw new Error(`seed request failed with status ${response.status}`);
    }
    const body = (await response.json()) as { readonly delivery_id: string };
    deliveryId = body.delivery_id;
  });

  it('GET envelope carries exactly the eight message fields plus dispatch_generation', async () => {
    const response = await mjFetch(env, {
      method: 'GET',
      path: `/internal/deliveries/${deliveryId}`,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      readonly message: Record<string, string>;
      readonly dispatch_generation: number;
    };
    expect(Object.keys(body.message).toSorted()).toEqual(
      [
        'app',
        'body',
        'content_type',
        'delivery_id',
        'message_id',
        'recipient',
        'status',
        'subject',
      ].toSorted(),
    );
    expect(body.message.content_type).toBe('text/html');
    expect(body.message.recipient).toBe('user@example.test');
    expect(body.message.subject).toBe('Reset code 123456');
    expect(body.message.status).toBe('accepted');
    expect(body.dispatch_generation).toBe(1);
  });

  it('GET returns 404 for an unknown delivery without echoing the id in the message', async () => {
    const response = await mjFetch(env, {
      method: 'GET',
      path: '/internal/deliveries/dlv_does-not-exist',
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { readonly error: { readonly message: string } };
    expect(body.error.message).not.toContain('dlv_does-not-exist');
  });

  it('outcome applies once, replays as duplicate, and stale on a lower generation', async () => {
    const first = await mjFetch(env, {
      method: 'POST',
      path: `/internal/deliveries/${deliveryId}/outcome`,
      body: new TextEncoder().encode(JSON.stringify({ outcome: 'sent', dispatch_generation: 1 })),
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ result: 'applied', status: 'sent' });

    const duplicate = await mjFetch(env, {
      method: 'POST',
      path: `/internal/deliveries/${deliveryId}/outcome`,
      body: new TextEncoder().encode(JSON.stringify({ outcome: 'sent', dispatch_generation: 1 })),
    });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual({ result: 'duplicate', status: 'sent' });

    const stale = await mjFetch(env, {
      method: 'POST',
      path: `/internal/deliveries/${deliveryId}/outcome`,
      body: new TextEncoder().encode(
        JSON.stringify({ outcome: 'failed', dispatch_generation: 1, error_class: 'permanent' }),
      ),
    });
    expect(stale.status).toBe(200);
    expect(await stale.json()).toEqual({
      result: 'stale',
      status: 'sent',
      current_dispatch_generation: 1,
    });

    // Outcome sau `sent` không lùi trạng thái — lớp outcome không bị ghi đè.
    const rows = await rawRows<{ status: string; failure_reason: string | null }>(
      env,
      'SELECT status, failure_reason FROM mail_messages WHERE delivery_id = ?',
      deliveryId,
    );
    expect(rows).toEqual([{ status: 'sent', failure_reason: null }]);
  });

  it('outcome for an unknown delivery is 404', async () => {
    const response = await mjFetch(env, {
      method: 'POST',
      path: '/internal/deliveries/dlv_unknown/outcome',
      body: new TextEncoder().encode(JSON.stringify({ outcome: 'sent', dispatch_generation: 1 })),
    });
    expect(response.status).toBe(404);
  });

  it('outcome with a malformed body is 400 after authentication', async () => {
    const response = await mjFetch(env, {
      method: 'POST',
      path: `/internal/deliveries/${deliveryId}/outcome`,
      body: new TextEncoder().encode(JSON.stringify({ outcome: 'exploded' })),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { readonly error: { readonly code: string } };
    expect(body.error.code).toBe('invalid_request');
  });
});

describe('scheduled handler (publish loop + redispatch budget A)', () => {
  it('publish loop drains a pending outbox row through the queue binding and marks it queued', async () => {
    const queue = captureQueue();
    const env = makeEnv(proxy?.env['mail'], queue.binding);

    const response = await accountPost(env, TEMPLATE_BODY, 'scheduled-seed-key');
    expect(response.status).toBe(201);
    const { delivery_id: deliveryId } = (await response.json()) as { readonly delivery_id: string };

    await worker.scheduled({ cron: '*/5 * * * *' }, env, executionContext);

    // Command canonical đúng hình §5 — chỉ `version` + `delivery_id` (D1 dùng chung nên
    // publish batch có thể drain cả pending row của test khác; đếm theo delivery này).
    const ownSends = queue.sent.filter((entry) => {
      try {
        return (JSON.parse(entry) as { delivery_id?: string }).delivery_id === deliveryId;
      } catch {
        return false;
      }
    });
    expect(ownSends).toEqual([JSON.stringify({ version: 1, delivery_id: deliveryId })]);

    const outbox = await rawRows<{ status: string }>(
      env,
      'SELECT status FROM mail_outbox WHERE delivery_id = ?',
      deliveryId,
    );
    expect(outbox).toEqual([{ status: 'published' }]);
    const message = await rawRows<{ status: string }>(
      env,
      'SELECT status FROM mail_messages WHERE delivery_id = ?',
      deliveryId,
    );
    expect(message).toEqual([{ status: 'queued' }]);
  });

  it('redispatch cycles consume budget A without a generation bump and stop at the cap', async () => {
    const queue = captureQueue();
    const env = makeEnv(proxy?.env['mail'], queue.binding);

    const response = await accountPost(env, TEMPLATE_BODY, 'redispatch-seed-key');
    expect(response.status).toBe(201);
    const { delivery_id: deliveryId } = (await response.json()) as { readonly delivery_id: string };

    // Cron 1: publish pha claim row pending → QUEUE.send; message queued, outbox published.
    await worker.scheduled({ cron: '*/5 * * * *' }, env, executionContext);
    expect(sentCountFor(queue.sent, deliveryId)).toBe(1);

    const age = async (): Promise<void> => {
      // `updated_at` của message lùi về quá khứ xa — vượt `MAIL_RECONCILER_MAX_AGE_MS`.
      const db = proxy?.env['mail'] as {
        prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown> } };
      };
      await db
        .prepare('UPDATE mail_messages SET updated_at = ? WHERE delivery_id = ?')
        .bind(NOW_MS - 10_000_000, deliveryId)
        .run();
    };
    const counters = async (): Promise<{
      readonly recovery_cycle_count: number;
      readonly dispatch_generation: number;
    }> => {
      const rows = await rawRows<{
        recovery_cycle_count: number;
        dispatch_generation: number;
      }>(
        env,
        'SELECT recovery_cycle_count, dispatch_generation FROM mail_messages WHERE delivery_id = ?',
        deliveryId,
      );
      const first = rows[0];
      if (first === undefined) {
        throw new Error(`expected a mail_messages row for the delivery under test`);
      }
      return {
        recovery_cycle_count: first.recovery_cycle_count,
        dispatch_generation: first.dispatch_generation,
      };
    };

    // Chu kỳ redispatch 1: age → cron (reconciler thấy queued + quá tuổi + outbox published
    // → redispatch: A=1, generation giữ nguyên, outbox về pending → publish pha của cron
    // KẾ TIẾP claim row pending đó → QUEUE.send lần 2).
    await age();
    await worker.scheduled({ cron: '*/5 * * * *' }, env, executionContext);
    expect(await counters()).toEqual({ recovery_cycle_count: 1, dispatch_generation: 1 });
    await worker.scheduled({ cron: '*/5 * * * *' }, env, executionContext);
    expect(sentCountFor(queue.sent, deliveryId)).toBe(2);

    // Chu kỳ redispatch 2: tiêu slot A cuối (A=2), generation vẫn không đổi.
    await age();
    await worker.scheduled({ cron: '*/5 * * * *' }, env, executionContext);
    expect(await counters()).toEqual({ recovery_cycle_count: 2, dispatch_generation: 1 });
    await worker.scheduled({ cron: '*/5 * * * *' }, env, executionContext);
    expect(sentCountFor(queue.sent, deliveryId)).toBe(3);

    // Chu kỳ 3: ngân sách A cạn (max = 2). Reconciler dừng hẳn: không redispatch, outbox
    // KHÔNG bị reset về pending — statement (2) không chạy khi statement (1) trả 0 hàng.
    await age();
    await worker.scheduled({ cron: '*/5 * * * *' }, env, executionContext);
    expect(await counters()).toEqual({ recovery_cycle_count: 2, dispatch_generation: 1 });
    expect(sentCountFor(queue.sent, deliveryId)).toBe(3);

    const outboxStatuses = await rawRows<{ status: string }>(
      env,
      'SELECT status FROM mail_outbox WHERE delivery_id = ?',
      deliveryId,
    );
    expect(outboxStatuses).toEqual([{ status: 'published' }]);
  });
});
