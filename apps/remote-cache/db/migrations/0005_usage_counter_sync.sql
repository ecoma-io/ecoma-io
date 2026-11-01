-- 0005_usage_counter_sync.sql — keep usage_counters in sync with cache_entries (P4.3, issue #461).
--
-- Them trigger `usage_counter_sync()` va cac trigger AFTER INSERT / AFTER DELETE tren
-- bang `remote_cache.cache_entries` de cap nhat tu dong `remote_cache.usage_counters`
-- (tang/giam storage_bytes_used va entry_count) moi khi mot entry duoc them hoac xoa.
-- Bang nay duong tinh co tai xay lai tu cache_entries; trigger giup bo dem luon dong
-- bang voi du lieu chuong trinh duoc ghi vao cache_entries, tranh gia tri stale/zero
-- khi kiem tra quota doc tu usage_counters.
--
-- Tinh idempotent: `DROP TRIGGER IF EXISTS` truoc khi tao, `CREATE OR REPLACE FUNCTION`
-- de chay lai migration thanh no-op (pattern idempotency o 06-testing.md / migration runner).
-- Trigger chay voi quyen chu ham (SECURITY DEFINER mac dinh) = migrator, co quyen
-- UPDATE tren usage_counters (0004), nen runtime role khong can quyen TRIGGER (da
-- bi REVOKE o 0003/0004). Runtime chi can INSERT/DELETE tren cache_entries (co grant).

BEGIN;

-- ---------------------------------------------------------------------------
-- Ham trigger: dong bo usage_counters sau INSERT/DELETE tren cache_entries
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION remote_cache.usage_counter_sync()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO remote_cache.usage_counters (project_id, storage_bytes_used, entry_count, updated_at)
    VALUES (NEW.project_id, NEW.size_bytes, 1, now())
    ON CONFLICT (project_id) DO UPDATE
      SET storage_bytes_used = usage_counters.storage_bytes_used + EXCLUDED.storage_bytes_used,
          entry_count = usage_counters.entry_count + EXCLUDED.entry_count,
          updated_at = now();
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE remote_cache.usage_counters
      SET storage_bytes_used = GREATEST(usage_counters.storage_bytes_used - OLD.size_bytes, 0),
          entry_count = GREATEST(usage_counters.entry_count - 1, 0),
          updated_at = now()
    WHERE project_id = OLD.project_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Trigger sau khi chen mot cache entry: tang bo dem cua project chinh chu
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS cache_entries_after_insert_sync ON remote_cache.cache_entries;
CREATE TRIGGER cache_entries_after_insert_sync
  AFTER INSERT ON remote_cache.cache_entries
  FOR EACH ROW
  EXECUTE FUNCTION remote_cache.usage_counter_sync();

-- ---------------------------------------------------------------------------
-- Trigger sau khi xoa mot cache entry: giam bo dem cua project chinh chu
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS cache_entries_after_delete_sync ON remote_cache.cache_entries;
CREATE TRIGGER cache_entries_after_delete_sync
  AFTER DELETE ON remote_cache.cache_entries
  FOR EACH ROW
  EXECUTE FUNCTION remote_cache.usage_counter_sync();

COMMIT;
