-- 0003_permission_catalog_seed.sql — seed catalog permission read cho backoffice.
--
-- Source of truth đã đọc trước khi viết:
--   * `docs/services/backoffice/adr/0010-permission-naming-and-read-catalog.md`
--     (ADR-0010) — quy ước đặt tên `domain.action` dot-style và 3 permission read.
--   * `docs/services/backoffice/01-architecture.md` §4.3, §9 invariant 10:
--     catalog là nguồn sự thật duy nhất; thêm/đổi/bỏ permission là governance action
--     có audit (ADR từ git).
--   * `apps/backoffice/db/migrations/0001_backoffice_domain.sql` — schema
--     `backoffice.permissions` (PK `id`, UNIQUE (domain, action), status CHECK).
--   * `apps/backoffice/db/migrations/0002_roles_and_grants.sql` — runtime role chỉ
--     SELECT trên `permissions`; INSERT/UPDATE thuộc migrator.
--
-- ⚠️ Phạm vi ý định của file này — **chỉ seed permission**:
--   * INSERT 3 permission read: `staff.read`, `role.read`, `permission.read`,
--     status `active`.
--   * KHÔNG INSERT role, role_permissions, role_assignments, staff. System-defined
--     role là quyết định riêng (ADR-0004), phải xuất phát từ catalog thực tế —
--     không phát minh ở đây.
--   * KHÔNG surplus: đúng ba permission route read của #99 cần
--     (`GET /api/staff`, `GET /api/roles`, `GET /api/permissions`). Không thêm
--     permission "cho chắc", không thêm permission chưa được route nào dùng.
--
-- Idempotent: `INSERT … ON CONFLICT (id) DO NOTHING` — apply lại là no-op, đúng
-- quy ước migration của `db-backoffice` (forward-only, không down-migration).
-- Chạy bằng migrator (role khác runtime); runtime role vẫn chỉ SELECT được.

BEGIN;

INSERT INTO backoffice.permissions (id, domain, action, status)
VALUES
  ('staff.read', 'staff', 'read', 'active'),
  ('role.read', 'role', 'read', 'active'),
  ('permission.read', 'permission', 'read', 'active')
ON CONFLICT (id) DO NOTHING;

COMMIT;
