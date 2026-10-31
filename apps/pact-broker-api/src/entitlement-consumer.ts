/**
 * Queue consumer của `ecoma-staff-access-entitlement-events` — áp dụng event
 * entitlement vào membership Pact Broker (roadmap P3.2, issue #457).
 *
 * ⚠️ Chỉ có `queue` entrypoint: worker này có cả `fetch` (API) và `queue`
 * (consumer). `queue` nhận batch message từ Cloudflare Queues, mỗi message là
 * envelope `EntitlementEvent` đã được Staff Access-relay publish (P2.2).
 *
 * Mỗi message xử lý tuần tự: parse envelope → `shouldApplyEntitlementEvent`
 * (compare-and-drop theo revision) → nếu áp dụng được, ensure tenant
 * `ecoma-internal` + upsert membership role `Member` (sub = event.staff_id)
 * → ghi revision đã áp dụng. Ném lỗi khi port vi phạm hợp đồng để Queue
 * retry theo `max_retries` + DLQ (không nuốt thành ack).
 *
 * ⚠️ Không log envelope đầy đủ — chỉ tổng kết một dòng JSON mỗi batch.
 */

import type { Pool } from 'pg';

import {
  provisionEntitlementMembership,
  type EntitlementSyncRepo,
  type MembershipRepo,
} from '@ecoma-io/pact-broker-api-application';
import {
  createPool,
  isConnectionTerminatedError,
  PgEntitlementSyncRepo,
  PgTenantRepo,
} from '@ecoma-io/pact-broker-api-infrastructure';
import { validateEntitlementEvent } from '@ecoma-io/staff-access-contracts';

/** Log một dòng JSON (pattern `writeLog` của auth-nonce-prune-job / relay). */
function writeLog(event: Record<string, unknown>): void {
  try {
    // oxlint-disable-next-line no-console
    console.log(JSON.stringify(event));
  } catch {
    // Cố tình im lặng — observability không được nằm trên serving path.
  }
}

/** Pool pg của Hyperdrive binding — cùng pattern relay/transactional-mailer-job. */
function createEntitlementPool(connectionString: string): Pool {
  const pool = createPool(connectionString);
  pool.on('error', (error: unknown) => {
    if (isConnectionTerminatedError(error)) {
      writeLog({ event: 'entitlement_consumer.db_pool.idle_client_error' });
    }
  });
  return pool;
}

/** Adapter repo Membership: delegate PgTenantRepo + ensureTenant. */
function membershipRepoAdapter(pool: Pool): MembershipRepo {
  const tenantRepo = new PgTenantRepo(pool);
  return {
    ensureTenant: (name: string) => tenantRepo.ensureTenant(name),
    upsertMember: (tenantId: string, sub: string, role: string) =>
      tenantRepo.upsertMember(tenantId, sub, role),
  };
}

/** Xử lý một message entitlement event — trả kết quả để caller quyết định ack/retry. */
async function handleMessage(
  message: { body: unknown; ack(): Promise<void>; retry(): Promise<void> },
  deps: { membership: MembershipRepo; sync: EntitlementSyncRepo },
): Promise<void> {
  // Parse envelope: không phải event hợp lệ là dữ liệu hỏng → ack (không retry
  // vì payload lỗi sẽ không bao giờ thành công), ghi log-level failure.
  // `message.body` có thể là object (runtime Cloudflare) hoặc string (đã
  // stringify). `validateEntitlementEvent` mong đợi object nên parse JSON
  // trước khi validate, nếu là string.
  let candidate: unknown = message.body;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      // Giữ nguyên chuỗi — validateEntitlementEvent sẽ trả invalid_payload.
    }
  }
  const parsed = validateEntitlementEvent(candidate);
  if (!parsed.ok) {
    writeLog({
      event: 'entitlement_consumer.invalid_payload',
      reason: parsed.reason,
      detail: parsed.detail,
    });
    await message.ack();
    return;
  }

  const event = parsed.payload;
  const result = await provisionEntitlementMembership(event, deps);

  writeLog({
    event: 'entitlement_consumer.message',
    event_id: event.event_id,
    type: event.type,
    product: event.product,
    staff_id: event.staff_id,
    revision: event.revision,
    applied: result.applied,
    reason: result.reason,
  });

  // Event đã được xử lý (dù áp dụng hay bỏ qua duplicate/stale/not-product) → ack.
  // Chỉ ném khi port vi phạm hợp đồng (DB lỗi) để Queue retry.
  await message.ack();
}

/**
 * Handler queue của Cloudflare Queues — MỘT message mỗi lần, tuần tự (không
 * `Promise.all` trên batch): state entitlement là single-writer theo cặp
 * (staff_id, product) qua revision, song song là hai execution tranh cùng row.
 */
export async function entitlementQueueBatch(
  batch: {
    queue: string | undefined;
    messages: readonly {
      id: string;
      body: unknown;
      ack(): Promise<void>;
      retry(): Promise<void>;
    }[];
  },
  env: { ENTITLEMENT_EVENTS_QUEUE?: unknown; HYPERDRIVE?: { connectionString: string } },
): Promise<void> {
  void batch.queue; // tên queue đã được runtime đảm bảo khớp binding khai báo
  if (batch.messages.length === 0) return;

  const connectionString = env.HYPERDRIVE?.connectionString;
  if (typeof connectionString !== 'string' || connectionString === '') {
    throw new Error(
      'Hyperdrive binding HYPERDRIVE khong co connectionString; entitlement consumer fail-closed',
    );
  }
  const pool = createEntitlementPool(connectionString);
  try {
    const deps = {
      membership: membershipRepoAdapter(pool),
      sync: new PgEntitlementSyncRepo(pool),
    };

    // Tuần tự: mỗi message một lần xử lý, ack/retry có kiểm soát từng message.
    // Không throw giữa batch — một message lỗi không làm gián đoạn các message
    // còn lại (pattern transactional-mailer-job).
    for (const message of batch.messages) {
      try {
        await handleMessage(message, deps);
      } catch {
        await message.retry();
      }
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}
