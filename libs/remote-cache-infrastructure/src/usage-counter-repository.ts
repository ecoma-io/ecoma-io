import type { RemoteCacheQueryable } from './postgres';

/**
 * Repository cua bang `remote_cache.usage_counters` — bo dem su dung duong tinh
 * theo project (P4.3 MVP). Duong tinh co tai xay lai tu `cache_entries`.
 */

export interface UsageCounterRow {
  readonly id: string;
  readonly project_id: string;
  readonly storage_bytes_used: string;
  readonly entry_count: string;
  readonly updated_at: string;
}

/** Lay bo dem su dung cua mot project. NULL neu chua cau hinh. */
export async function getUsageCounterByProject(
  db: RemoteCacheQueryable,
  projectId: string,
): Promise<UsageCounterRow | null> {
  const rows = await db.unsafe<UsageCounterRow>(
    `SELECT id, project_id, storage_bytes_used, entry_count, updated_at
       FROM remote_cache.usage_counters
      WHERE project_id = $1`,
    [projectId],
  );
  return rows[0] ?? null;
}

/** Cap nhat bo dem su dung (upsert). storage_bytes_used / entry_count la gia tri tuyet doi. */
export async function upsertUsageCounter(
  db: RemoteCacheQueryable,
  entry: {
    readonly projectId: string;
    readonly storageBytesUsed: number;
    readonly entryCount: number;
  },
): Promise<void> {
  await db.unsafe(
    `INSERT INTO remote_cache.usage_counters (project_id, storage_bytes_used, entry_count)
     VALUES ($1, $2, $3)
     ON CONFLICT (project_id) DO UPDATE
       SET storage_bytes_used = EXCLUDED.storage_bytes_used,
           entry_count = EXCLUDED.entry_count,
           updated_at = now()`,
    [entry.projectId, entry.storageBytesUsed, entry.entryCount],
  );
}

/** Tai xay lai bo dem su dung tu cache_entries va cap nhat bang usage_counters.
 *  Tra ve gia tri tai xay lai. Dung cho xac thuc hoac repair toi bo. */
export async function rebuildUsageCounter(
  db: RemoteCacheQueryable,
  projectId: string,
): Promise<{ storageBytesUsed: number; entryCount: number }> {
  const rows = await db.unsafe<{ total: string; count: string }>(
    `SELECT coalesce(sum(size_bytes)::text, '0') AS total, count(*)::text AS count
       FROM remote_cache.cache_entries
      WHERE project_id = $1`,
    [projectId],
  );
  const row = rows[0];
  const storageBytesUsed = Number(row?.total ?? '0');
  const entryCount = Number(row?.count ?? '0');

  await db.unsafe(
    `INSERT INTO remote_cache.usage_counters (project_id, storage_bytes_used, entry_count)
     VALUES ($1, $2, $3)
     ON CONFLICT (project_id) DO UPDATE
       SET storage_bytes_used = EXCLUDED.storage_bytes_used,
           entry_count = EXCLUDED.entry_count,
           updated_at = now()`,
    [projectId, storageBytesUsed, entryCount],
  );

  return { storageBytesUsed, entryCount };
}
