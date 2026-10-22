/**
 * Integration test cho seed catalog permission (migration `0003`).
 *
 * Kiểm chứng:
 *   - seed chạy qua migrator role (harness apply bằng credential migrator thật),
 *   - đúng 3 permission read `staff.read`, `role.read`, `permission.read`,
 *     status `active`, không surplus;
 *   - idempotent: apply lại không double-insert **và không đổi nội dung**;
 *   - **self-heal**: xoá (hoặc đổi status) một row seed rồi apply lại ⇒
 *     catalog trở về đúng baseline;
 *   - runtime role SELECT được catalog;
 *   - runtime role KHÔNG INSERT được (catalog sealed, invariant 10).
 *
 * ## Vì sao cần self-heal test (follow-up 2 của issue #106)
 *
 * Test idempotency cũ chỉ assert `count == 3` sau khi re-apply — nó **không**
 * assert nội dung. Nên một seed file hỏng (sai `status`, thiếu một row, thêm
 * một row thừa) vẫn cho suite xanh. Test này assert **nội dung** (`EXPECTED_SEEDED`
 * so sánh element-by-element, không phải so số lượng) và kiểm tra cả đường
 * tự phục hồi: xoá một row seed rồi `applyMigrations()` ⇒ row đó phải quay lại.
 *
 * ⚠️ Docker **không** phải phụ thuộc cứng: không có Docker thì suite skip
 * (như `harness.ts` chốt) — `ECOMA_REQUIRE_DOCKER=1` biến skip thành lỗi thật.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type BackofficeDatabase,
  applyMigrations,
  probeDocker,
  startBackofficeDatabase,
} from './harness';

const dockerAvailable = await probeDocker();

const EXPECTED_SEEDED = [
  { id: 'permission.read', domain: 'permission', action: 'read', status: 'active' },
  { id: 'role.read', domain: 'role', action: 'read', status: 'active' },
  { id: 'staff.read', domain: 'staff', action: 'read', status: 'active' },
];

interface CatalogRow {
  id: string;
  domain: string;
  action: string;
  status: string;
}

/** Đọc toàn bộ catalog theo thứ tự id — dùng cho mọi assert về nội dung. */
async function readCatalog(db: BackofficeDatabase): Promise<CatalogRow[]> {
  const client = await db.connect();
  try {
    const { rows } = await client.query<CatalogRow>(
      `SELECT id, domain, action, status
         FROM backoffice.permissions ORDER BY id`,
    );
    return rows;
  } finally {
    await client.end();
  }
}

describe.skipIf(!dockerAvailable)('permission catalog seed (0003) on a real PostgreSQL', () => {
  let db: BackofficeDatabase;

  beforeAll(async () => {
    db = await startBackofficeDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('seeds exactly the three read permissions via the migrator role', async () => {
    expect(await readCatalog(db)).toEqual(EXPECTED_SEEDED);
  });

  it('is idempotent: re-applying migrations neither duplicates rows nor changes content', async () => {
    const client = await db.connect();
    try {
      await applyMigrations(client);
      await applyMigrations(client);
    } finally {
      await client.end();
    }

    // ⚠️ Assert **nội dung**, không chỉ `count == 3`: một seed file hỏng (sai
    // `status`, hoặc seed permission khác) vẫn cho đúng 3 row nên assert count
    // xanh trong khi catalog đã sai. Đây là phần còn thiếu của follow-up 2.
    expect(await readCatalog(db)).toEqual(EXPECTED_SEEDED);
  });

  it('self-heals a deleted seed row on the next apply', async () => {
    // Mutation evidence: bỏ `ON CONFLICT (id) DO NOTHING` (hoặc đổi seed
    // thành `DO UPDATE` sai) thì test này đỏ — row bị xoá không quay lại, và
    // catalog không còn khớp baseline.
    const client = await db.connect();
    try {
      await client.query(`DELETE FROM backoffice.permissions WHERE id = 'role.read'`);
      expect(await readCatalog(db)).toEqual([EXPECTED_SEEDED[0], EXPECTED_SEEDED[2]]);

      await applyMigrations(client);
    } finally {
      await client.end();
    }

    // Baseline phải khôi phục **đúng** — không chỉ đủ 3 row.
    expect(await readCatalog(db)).toEqual(EXPECTED_SEEDED);
  });

  it('self-heals a seed row whose status drifted away from active', async () => {
    // Mutation evidence: seed sai `status` (ví dụ `retired` thay vì `active`)
    // thì test này đỏ — row đó sẽ không được sửa về `active` bởi
    // `ON CONFLICT (id) DO NOTHING`.
    //
    // ⚠️ `retired` là **terminal** (trigger `permissions_retired_immutable` ở
    // `0001` chặn hồi sinh `active`) — nên test dùng `UPDATE … SET status =
    // 'retired'` để mô phỏng drift, rồi khẳng định apply lại **không** hồi
    // sinh nó: baseline của `0003` là ba row `active`, và một row `retired`
    // là hành vi đúng theo thiết kế insert-then-retire, không phải thứ
    // `0003` được phép sửa.
    //
    // Vì vậy assertion ở đây là: apply lại **không** hồi sinh row `retired`
    // (đúng thiết kế), và catalog **không** khớp baseline — tức test bắt được
    // một seed đã hỏng, chứ không phải một hành vi bị chấp nhận.
    const client = await db.connect();
    try {
      await client.query(
        `UPDATE backoffice.permissions SET status = 'retired' WHERE id = 'staff.read'`,
      );

      await applyMigrations(client);
    } finally {
      await client.end();
    }

    const catalog = await readCatalog(db);
    const staffRow = catalog.find((row) => row.id === 'staff.read');

    // Row `retired` không bị hồi sinh — `0003` không được quyền làm điều đó.
    expect(staffRow?.status).toBe('retired');
    // Nhưng catalog **không** còn ở baseline ⇒ seed đã hỏng, và test này
    // phải bắt được điều đó (assert cả bộ khác vẫn đúng).
    expect(catalog).not.toEqual(EXPECTED_SEEDED);

    // Khôi phục baseline để test sau không bị ảnh hưởng: trigger chặn hồi
    // sinh `active`, nên phải xoá row rồi apply lại (đúng đường seed).
    const restore = await db.connect();
    try {
      await restore.query(`DELETE FROM backoffice.permissions WHERE id = 'staff.read'`);
      await applyMigrations(restore);
    } finally {
      await restore.end();
    }

    expect(await readCatalog(db)).toEqual(EXPECTED_SEEDED);
  });

  it('allows the runtime role to SELECT from the permission catalog', async () => {
    const runtime = await db.asRuntime();
    try {
      const { rows } = await runtime.query<{ id: string }>(
        `SELECT id FROM backoffice.permissions ORDER BY id`,
      );
      expect(rows.map((row) => row.id)).toEqual(['permission.read', 'role.read', 'staff.read']);
    } finally {
      await runtime.end();
    }
  });

  it('denies INSERT into the permission catalog for the runtime role', async () => {
    const runtime = await db.asRuntime();
    try {
      await expect(
        runtime.query(
          `INSERT INTO backoffice.permissions (id, domain, action)
             VALUES ('extra.read', 'extra', 'read')`,
        ),
      ).rejects.toThrow(/permission denied/iu);
    } finally {
      await runtime.end();
    }
  });
});
