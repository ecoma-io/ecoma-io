import type { Pool } from 'pg';

import type {
  OutboxReconcileRepository,
  StalePublishedEvent,
  ListStalePublishedInput,
} from '@ecoma-io/staff-access-reconciler-application';

interface RawStaleRow {
  readonly event_id: string;
  readonly event_type: string;
  readonly occurred_at: Date | string;
  readonly published_at: Date | string;
  readonly attempts: number | string;
  readonly last_error: string | null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function createPostgresOutboxReconcileRepository(pool: Pool): OutboxReconcileRepository {
  return {
    async listStalePublished(
      input: ListStalePublishedInput,
    ): Promise<readonly StalePublishedEvent[]> {
      // ⚠️ Chỉ SELECT — không UPDATE/claim/redrive. Runtime role đã có SELECT
      // trên bảng (migration 0004), không cần grant mới.
      //
      // Điều kiện stale: published_at IS NOT NULL AND published_at < now - staleAfterMs.
      // `attempts`/`last_error` chỉ để chẩn đoán, không phải lệnh replay.
      const cutoff = new Date(input.nowMs - input.staleAfterMs).toISOString();
      const result = await pool.query<RawStaleRow>(
        `SELECT event_id, event_type, occurred_at, published_at, attempts, last_error
           FROM staff_access.entitlement_outbox_events
          WHERE published_at IS NOT NULL
            AND published_at < $1::timestamptz
          ORDER BY published_at
          LIMIT $2`,
        [cutoff, input.limit],
      );
      return result.rows.map((raw) => ({
        event_id: raw.event_id,
        event_type: raw.event_type,
        occurred_at: iso(raw.occurred_at),
        published_at: iso(raw.published_at),
        attempts: Number(raw.attempts),
        last_error: raw.last_error,
      }));
    },
  };
}
