-- 0004_quota_usage_audit.sql — quota, retention, usage metering, audit (P4.3, issue #461).
--
-- Them vao schema remote_cache (db-remote-cache) cac bang ho tro P4.3:
--   quota_limits   — gioi han quota theo project (max storage bytes, max entry count)
--   usage_counters — bo dem su dung duong tinh, co tai xay lai tu cache_entries
--   audit_log      — nhat ky su kien quota/reteniton (actor, action, target, time, outcome)
-- Va them cot expires_at vao cache_entries de theo doi retention TTL.
--
-- Luu ý: storage lifecycle (B2) chinh la garbage collector chinh (02-requirements R8);
-- bang nay chi luu metadata de theo doi va cleanup co the duoc goi boi control plane,
-- KHONG chay tren request path cua data plane (invariant 10).
--
-- COMMENT ON du English (language policy: migration comments la English).

BEGIN;

-- ---------------------------------------------------------------------------
-- quota_limits — gioi han quota theo project
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS remote_cache.quota_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES remote_cache.projects (id),
  max_storage_bytes bigint NOT NULL DEFAULT 0,
  max_entry_count bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quota_limits_project_unique UNIQUE (project_id),
  CONSTRAINT quota_limits_nonnegative CHECK (max_storage_bytes >= 0 AND max_entry_count >= 0)
);

COMMENT ON TABLE remote_cache.quota_limits IS
  'Quota limit per project (P4.3 MVP). max_storage_bytes / max_entry_count cap writes; 0 means unlimited. One row per project.';
COMMENT ON COLUMN remote_cache.quota_limits.project_id IS
  'Owning project. FK to remote_cache.projects; quota is per (tenant/project) via project -> tenant.';
COMMENT ON COLUMN remote_cache.quota_limits.max_storage_bytes IS
  'Maximum total bytes of cache artifacts allowed for this project. 0 = no storage quota.';
COMMENT ON COLUMN remote_cache.quota_limits.max_entry_count IS
  'Maximum number of cache entries allowed for this project. 0 = no entry quota.';
COMMENT ON COLUMN remote_cache.quota_limits.created_at IS
  'When this quota limit row was created.';
COMMENT ON COLUMN remote_cache.quota_limits.updated_at IS
  'When this quota limit row was last updated.';

-- ---------------------------------------------------------------------------
-- usage_counters — bo dem su dung duong tinh, co tai xay lai tu cache_entries
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS remote_cache.usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES remote_cache.projects (id),
  storage_bytes_used bigint NOT NULL DEFAULT 0,
  entry_count bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_counters_project_unique UNIQUE (project_id),
  CONSTRAINT usage_counters_nonnegative CHECK (storage_bytes_used >= 0 AND entry_count >= 0)
);

COMMENT ON TABLE remote_cache.usage_counters IS
  'Durable usage counters per project (P4.3 MVP). Reconstructible from remote_cache.cache_entries (sum size_bytes, count *). Kept as cached counters for fast quota checks on the write path.';
COMMENT ON COLUMN remote_cache.usage_counters.project_id IS
  'Owning project. FK to remote_cache.projects.';
COMMENT ON COLUMN remote_cache.usage_counters.storage_bytes_used IS
  'Total bytes of cache artifacts currently stored for this project. Reconstructible: SELECT coalesce(sum(size_bytes), 0) FROM remote_cache.cache_entries WHERE project_id = $1.';
COMMENT ON COLUMN remote_cache.usage_counters.entry_count IS
  'Number of cache entries currently stored for this project. Reconstructible: SELECT count(*) FROM remote_cache.cache_entries WHERE project_id = $1.';
COMMENT ON COLUMN remote_cache.usage_counters.updated_at IS
  'When this usage counter row was last updated.';

-- ---------------------------------------------------------------------------
-- audit_log — nhat ky su kien quota / retention
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS remote_cache.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  time timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL,
  details text,
  project_id uuid REFERENCES remote_cache.projects (id)
);

COMMENT ON TABLE remote_cache.audit_log IS
  'Audit log of quota-relevant and retention-relevant events (P4.3 MVP). actor/action/target/time/outcome per R15. Appended only; never updated or deleted.';
COMMENT ON COLUMN remote_cache.audit_log.actor IS
  'Identity of the actor (API key id, admin id, or system). Not a secret — API key hashes are never stored here.';
COMMENT ON COLUMN remote_cache.audit_log.action IS
  'Action taken: e.g. quota_exceeded, quota_limit_set, retention_cleanup.';
COMMENT ON COLUMN remote_cache.audit_log.target IS
  'Target of the action: e.g. project id, cache entry hash.';
COMMENT ON COLUMN remote_cache.audit_log.time IS
  'Event timestamp (server clock).';
COMMENT ON COLUMN remote_cache.audit_log.outcome IS
  'Outcome: allowed | denied | error.';
COMMENT ON COLUMN remote_cache.audit_log.details IS
  'Human-readable details (English). May include sizes and counts, never secrets.';
COMMENT ON COLUMN remote_cache.audit_log.project_id IS
  'Owning project, if the event is project-scoped. Null for system-level events.';

-- ---------------------------------------------------------------------------
-- expires_at on cache_entries — retention TTL theo hash
-- ---------------------------------------------------------------------------

ALTER TABLE remote_cache.cache_entries
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

COMMENT ON COLUMN remote_cache.cache_entries.expires_at IS
  'Retention TTL expiration (P4.3). Null means no explicit expiration (uses storage lifecycle default). Entry is eligible for cleanup when expires_at < now(). Cleanup runs off the request path (control plane / background).';

-- ---------------------------------------------------------------------------
-- Grants cho runtime role tren cac bang moi — luat least-privilege cung 0002.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT ON remote_cache.quota_limits TO ecoma_remote_cache_runtime;
GRANT SELECT, INSERT, UPDATE ON remote_cache.usage_counters TO ecoma_remote_cache_runtime;
GRANT SELECT, INSERT ON remote_cache.audit_log TO ecoma_remote_cache_runtime;

REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON remote_cache.quota_limits FROM ecoma_remote_cache_runtime;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON remote_cache.usage_counters FROM ecoma_remote_cache_runtime;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON remote_cache.audit_log FROM ecoma_remote_cache_runtime;

COMMIT;
