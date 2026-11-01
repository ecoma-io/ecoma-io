import type { RemoteCacheQueryable } from './postgres';

/**
 * Repository cua bang `remote_cache.audit_log` — nhat ky su kien quota/retention
 * (P4.3 MVP). Append-only: chi INSERT, khong UPDATE/DELETE (R15).
 */

export interface AuditLogRow {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  readonly target: string;
  readonly time: string;
  readonly outcome: string;
  readonly details: string | null;
  readonly project_id: string | null;
}

/** Them mot ghi nhat ky audit. Tra id cua hang moi. */
export async function insertAuditLog(
  db: RemoteCacheQueryable,
  entry: {
    readonly actor: string;
    readonly action: string;
    readonly target: string;
    readonly outcome: string;
    readonly details?: string | null;
    readonly projectId?: string | null;
  },
): Promise<string> {
  const rows = await db.unsafe<{ id: string }>(
    `INSERT INTO remote_cache.audit_log (actor, action, target, outcome, details, project_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      entry.actor,
      entry.action,
      entry.target,
      entry.outcome,
      entry.details ?? null,
      entry.projectId ?? null,
    ],
  );
  return rows[0]?.id ?? '';
}
