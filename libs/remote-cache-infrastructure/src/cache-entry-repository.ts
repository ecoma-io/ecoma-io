import type { RemoteCacheQueryable } from './postgres';

/**
 * Repository cua bang `remote_cache.cache_entries` — metadata cua mot artifact
 * cache da luu tren object storage, pham vi project (P4.2 data plane).
 *
 * Moi thao tac loc theo `project_id` cua API key da xac thuc — day la chot
 * chan namespace isolation. Khong co duong nao resolve row ma khong co
 * `project_id` trong predicate.
 */

/** Mot hang cache entry nhu schema tra ve. */
export interface CacheEntryRow {
  readonly id: string;
  readonly project_id: string;
  readonly hash: string;
  readonly object_key: string;
  readonly size_bytes: string;
  readonly content_type: string | null;
  readonly created_at: string;
}

/** Lay entry theo project + hash — duong read-side. NULL khi miss. */
export async function getCacheEntryByProjectAndHash(
  db: RemoteCacheQueryable,
  projectId: string,
  hash: string,
): Promise<CacheEntryRow | null> {
  const rows = await db.unsafe<CacheEntryRow>(
    `SELECT id, project_id, hash, object_key, size_bytes, content_type, created_at
       FROM remote_cache.cache_entries
      WHERE project_id = $1 AND hash = $2`,
    [projectId, hash],
  );
  return rows[0] ?? null;
}

/** Danh sach entry cua mot project (danh cho test, khong nam tren serving path). */
export async function listCacheEntriesByProject(
  db: RemoteCacheQueryable,
  projectId: string,
): Promise<readonly CacheEntryRow[]> {
  return db.unsafe<CacheEntryRow>(
    `SELECT id, project_id, hash, object_key, size_bytes, content_type, created_at
       FROM remote_cache.cache_entries
      WHERE project_id = $1
      ORDER BY created_at, id`,
    [projectId],
  );
}

/**
 * Chen mot entry moi. `ON CONFLICT DO NOTHING` la lop chan race giua hai upload
 * dong thoi cung hash: mot hang thang, hang sau tra ve 0 ma khong nem. Loi khac
 * (vi pham CHECK, mat ket noi) van nem ra ngoai — khong duoc nuot.
 */
export async function insertCacheEntry(
  db: RemoteCacheQueryable,
  entry: {
    readonly projectId: string;
    readonly hash: string;
    readonly objectKey: string;
    readonly sizeBytes: number;
    readonly contentType: string | null;
  },
): Promise<number> {
  const result = await db.unsafe<{ inserted: string }>(
    `WITH inserted AS (
       INSERT INTO remote_cache.cache_entries (project_id, hash, object_key, size_bytes, content_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (project_id, hash) DO NOTHING
       RETURNING 1 AS one
     )
     SELECT count(*)::text AS inserted FROM inserted`,
    [entry.projectId, entry.hash, entry.objectKey, entry.sizeBytes, entry.contentType],
  );
  return Number(result[0]?.inserted ?? '0');
}
