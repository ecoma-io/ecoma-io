/**
 * Apply migration `db-staff-access` qua **runner canonical** (`db/apply.mts`)
 * trên PostgreSQL thật.
 *
 * ⚠️ Không dùng `describe.skipIf`: suite PG của repo đã đổi sang fail-loud —
 * `globalSetup` probe Docker một lần mỗi lần chạy và vắng Docker là lỗi thật,
 * không phải nửa suite skip với exit 0. `beforeAll` gọi
 * `startStaffAccessDatabase()`; probe không đạt thì toàn bộ lần chạy đỏ từ
 * `globalSetup` trước khi worker nào kịp báo xanh giả.
 *
 * ⚠️ Đường code được test là ĐÚNG hàm mà CLI `db:migrate` chạy —
 * `applyAllMigrations` của `db/apply.mts`, gồm advisory lock, assert
 * `current_database()` và đếm bảng sau apply. Runner này không có bảng ledger:
 * tính idempotent của DDL là thứ làm re-apply thành no-op, và catalog sau apply
 * là nguồn sự thật.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyAllMigrations } from '../../db/apply.mts';
import { STAFF_ACCESS_DATABASE, listMigrations } from '../../db/migrate.mts';
import { type StaffAccessDatabase, startStaffAccessDatabase } from '../integrations/harness.ts';

let db: StaffAccessDatabase;

beforeAll(async () => {
  db = await startStaffAccessDatabase();
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('staff-access migration runner on a real PostgreSQL', () => {
  it('applies every migration file from an empty database, leaving the catalog as truth', async () => {
    const migrator = await db.connectAsMigrator();
    try {
      const files = listMigrations();
      const result = await applyAllMigrations(migrator);

      expect(result.applied).toBe(files.length);

      // Không có bảng lịch sử để đối chiếu: catalog là nguồn sự thật duy nhất —
      // đếm bảng `CREATE TABLE staff_access.*` (7 bảng data) qua catalog thật.
      // Gom relname phía JS thay vì `array_agg`: pg trả array qua nhiều hàng
      // là hình dạng dễ assert và không phụ thuộc parser của type `_text`.
      const { rows } = await migrator.query<{ relname: string }>(
        `SELECT c.relname
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'staff_access' AND c.relkind IN ('r', 'p')
          ORDER BY c.relname`,
      );
      expect(rows.map((row) => row.relname)).toEqual(
        [
          'authorization_audit',
          'entitlements',
          'permissions',
          'role_assignments',
          'role_permissions',
          'roles',
          'staff',
        ].toSorted(),
      );
      expect(result.tablesInStaffAccessSchema).toBe(7);
    } finally {
      await migrator.end();
    }
  });

  it('re-running applies every file again as a no-op (idempotent DDL, no ledger)', async () => {
    // Runner không có ledger — nó chạy LẠI mọi file. Tính idempotent của DDL
    // (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`) là thứ
    // làm lần chạy thứ hai thành công mà không đổi gì: applied = số file,
    // schema vẫn 7 bảng. Một migration mất idempotency lộ ngay ở đây.
    const migrator = await db.connectAsMigrator();
    try {
      const result = await applyAllMigrations(migrator);
      expect(result.applied).toBe(listMigrations().length);
      expect(result.tablesInStaffAccessSchema).toBe(7);
    } finally {
      await migrator.end();
    }
  });

  it('takes the advisory lock keyed to db-staff-access, distinct from the db-account key', async () => {
    // Khóa là `hashtext('db-staff-access')` phía server — test giữ chính khóa
    // đó ở session khác; runner lấy đúng key ⇒ apply bị chặn bởi lock, và
    // `lock_timeout` ngắn biến chỗ bị chặn thành lỗi đo được thay vì treo suite.
    const holder = await db.connect();
    const runner = await db.connectAsMigrator();
    try {
      await holder.query('SELECT pg_advisory_lock(hashtext($1))', [STAFF_ACCESS_DATABASE]);

      await runner.query(`SET lock_timeout = '500ms'`);
      await expect(applyAllMigrations(runner)).rejects.toThrow(/lock timeout/iu);

      // Khóa đối xứng: hai database khác nhau không tranh cùng một khóa —
      // giữ khóa db-staff-access xong, khóa db-account vẫn lấy được từ session khác.
      await holder.query('SELECT pg_advisory_lock(hashtext($1))', ['db-account']);
      await holder.query('SELECT pg_advisory_unlock(hashtext($1))', ['db-account']);
    } finally {
      await runner.query('RESET lock_timeout').catch(() => undefined);
      await holder.query('SELECT pg_advisory_unlock(hashtext($1))', [STAFF_ACCESS_DATABASE]);
      await holder.end();
      await runner.end();
    }
  });

  it('refuses to run against a different database (current_database guard)', async () => {
    // Guard #101 (pattern backoffice): runner pin tên database — `DATABASE_URL`
    // trỏ nhầm database khác phải fail-loud trước khi một DDL nào chạm đích.
    // `postgres` database có sẵn trong mọi image PostgreSQL và KHÔNG phải
    // `db-staff-access` — đúng hình "URL trỏ sai".
    const pg = (await import('pg')).default;
    const wrongDb = new pg.Client({
      host: db.host,
      port: db.port,
      user: 'ecoma_staff_access_migrator',
      password: db.rolePassword,
      database: 'postgres',
      application_name: 'ecoma-staff-access-itest-wrongdb',
    });
    await wrongDb.connect();
    try {
      await expect(applyAllMigrations(wrongDb)).rejects.toThrow(
        /expected database "db-staff-access"/u,
      );
    } finally {
      await wrongDb.end();
    }
  });

  it('leaves schema staff_access owned by the migrator', async () => {
    // `CREATE SCHEMA` chạy từ session migrator: owner phải là
    // `ecoma_staff_access_migrator` — điều kiện để các lần chạy sau của chính
    // runner luôn ghi được DDL mà không cần ai cấp quyền thêm.
    const client = await db.connect();
    try {
      const { rows } = await client.query<{ nspowner: string }>(
        `SELECT pg_get_userbyid(n.nspowner) AS nspowner
           FROM pg_namespace n WHERE n.nspname = 'staff_access'`,
      );
      expect(rows[0]?.nspowner).toBe('ecoma_staff_access_migrator');
    } finally {
      await client.end();
    }
  });

  it('seeds exactly the three read permissions of the ADR-0010 catalog', async () => {
    const client = await db.connect();
    try {
      const { rows } = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM staff_access.permissions ORDER BY id`,
      );
      expect(rows).toEqual([
        { id: 'permission.read', status: 'active' },
        { id: 'role.read', status: 'active' },
        { id: 'staff.read', status: 'active' },
      ]);
    } finally {
      await client.end();
    }
  });
});
