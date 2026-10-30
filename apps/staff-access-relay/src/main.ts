/**
 * Composition root của `staff-access-relay` — cron Worker relay outbox
 * entitlement sang Cloudflare Queues (P2.2, issue #449).
 *
 * ⚠️ **Chỉ có MỘT entrypoint: `scheduled`.** KHÔNG có `fetch` export — worker
 * này không expose HTTP (cùng lập luận với auth-nonce-prune-job: một HTTP
 * surface là một ranh giới mới cần auth, mà không endpoint nào được định nghĩa).
 *
 * ⚠️ **KHÔNG `ctx.waitUntil` cho đường chính** — handler `await` trực tiếp:
 * lỗi của handler là status của cron invocation, hiển thị ở Cron dashboard →
 * Past events. `waitUntil` sẽ che một lỗi ra khỏi trạng thái invocation.
 *
 * ⚠️ **Idempotency key = event_id**: envelope được parse từ chuỗi JSON đã commit
 * trong outbox (nguồn sự thật) rồi gửi kèm key `event_id` — consumer dedupe
 * theo key này; relay an toàn trước at-least-once của Queue.
 *
 * ⚠️ **KHÔNG log prompt/response body hay envelope đầy đủ** — log tổng kết một
 * dòng JSON mỗi run (claimed/published/failed/dlq/retried); chi tiết envelope
 * sống trong Queue message, không trong log.
 */

import { Pool } from 'pg';

import { runRelayCycle, type RelayCycleDeps } from '@ecoma-io/staff-access-relay-application';
import { createPostgresOutboxRepository } from '@ecoma-io/staff-access-relay-infrastructure';

import {
  loadRelayConfig,
  RelayConfigError,
  type HyperdriveBindingLike,
  type QueueBindingLike,
  type RelayEnv,
} from './config';

/** Ngưỡng vận hành của relay — hằng số thuật toán ghim ở composition root. */
const RELAY_MAX_ATTEMPTS = 5;
const RELAY_BATCH_SIZE = 100;
const RELAY_BACKOFF_BASE_MS = 250;
const RELAY_BACKOFF_CAP_MS = 4_000;
const RELAY_MAX_IN_RUN_RETRIES = 3;

/** Log một dòng JSON (pattern `writeLog` của auth-nonce-prune-job). */
function writeLog(event: Record<string, unknown>): void {
  try {
    // oxlint-disable-next-line no-console
    console.log(JSON.stringify(event));
  } catch {
    // Cố tình im lặng — observability không được nằm trên serving path.
  }
}

/**
 * Pool `pg` của Hyperdrive binding — pattern `apps/auth-nonce-prune-job/src/main.ts`
 * (cùng ba mốc pooling; từ khóa để grep: `idleTimeoutMillis`).
 */
function createPoolFor(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 600_000,
    connectionTimeoutMillis: 15_000,
  });
  // Listener `error` của pool bắt buộc: idle client bị Hyperdrive đóng (HD10)
  // phát `error` trên EventEmitter — không listener là crash isolate. Handler
  // log redacted rồi nuốt, không re-throw.
  pool.on('error', () => {
    writeLog({ event: 'db_pool.idle_client_error', error_code: 'idle_client_error' });
  });
  return pool;
}

/**
 * Adapter Queue: bọc binding Cloudflare Queues thành {@link QueuePublisher} của
 * application port. Idempotency key đi qua option `idempotency_key` — Queue
 * runtime của Workers nhận option này cho dedupe phía producer (QU facts);
 * consumer vẫn dedupe theo `event_id` trong envelope nên key bị bỏ qua ở một
 * platform version nào đó không mất tính đúng đắn (at-least-once từ cả hai phía).
 */
function createQueuePublisher(binding: QueueBindingLike): {
  send(message: unknown, idempotencyKey: string): Promise<void>;
} {
  return {
    async send(message: unknown, idempotencyKey: string): Promise<void> {
      await binding.send(message, { idempotency_key: idempotencyKey });
    },
  };
}

/**
 * Handler thật của một run — được `scheduled` gọi, đúng một lần cho mỗi cron tick.
 *
 * ⚠️ Throw rời handler: config thiếu binding hay database/queue unreachable đều
 * phải đỏ run — relay KHÔNG có "đỏ một nửa thành công". Event backlog chưa
 * publish sẽ được claim lần cron sau (outbox là nguồn sự thật), nhưng tình trạng
 * hỏng phải thấy được ở Past events.
 */
export async function runOnce(env: RelayEnv, startedAtMs: number): Promise<void> {
  const config = loadRelayConfig(env);
  const pool = createPoolFor((config.db as HyperdriveBindingLike).connectionString);
  try {
    const outbox = createPostgresOutboxRepository(pool);
    const queue = createQueuePublisher(config.queue);
    const deps: RelayCycleDeps = {
      outbox,
      queue,
      maxAttempts: RELAY_MAX_ATTEMPTS,
      batchSize: RELAY_BATCH_SIZE,
      backoffBaseMs: RELAY_BACKOFF_BASE_MS,
      backoffCapMs: RELAY_BACKOFF_CAP_MS,
      maxInRunRetries: RELAY_MAX_IN_RUN_RETRIES,
    };
    const result = await runRelayCycle(deps, startedAtMs);
    writeLog({
      event: 'entitlement_relay_cycle',
      claimed: result.claimed,
      published: result.published,
      failed: result.failed,
      dlq: result.dlq,
      retried: result.retried,
    });
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/**
 * `scheduled()` của platform — adapter mỏng giữa Cron runtime và {@link runOnce}.
 *
 * ⚠️ Object thay vì `export default` một function — thiếu một entrypoint là một
 * `undefined` ở đây thay vì một Worker deploy chạy nhưng không bao giờ nhận cron
 * tick (pattern auth-nonce-prune-job / web-push-notification-job).
 */
export default {
  async scheduled(
    controller: { readonly cron: string },
    env: RelayEnv,
    ctx?: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void> {
    void controller.cron;
    void ctx;
    try {
      await runOnce(env, Date.now());
    } catch (error) {
      if (error instanceof RelayConfigError) {
        // Config thiếu binding: một dòng riêng có tên binding — đủ cho runbook.
        writeLog({
          event: 'entitlement_relay_error',
          outcome: 'not_configured',
          message: error.message,
        });
      }
      throw error;
    }
  },
};
