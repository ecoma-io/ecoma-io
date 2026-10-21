/**
 * Integration test cho seed catalog permission (migration `0003`).
 *
 * Kiểm chứng:
 *   - seed chạy qua migrator role (harness apply bằng credential migrator thật),
 *   - đúng 3 permission read `staff.read`, `role.read`, `permission.read`,
 *     status `active`, không surplus;
 *   - idempotent: apply lại không double-insert;
 *   - runtime role SELECT được catalog;
 *   - runtime role KHÔNG INSERT được (catalog sealed, invariant 10).
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

describe.skipIf(!dockerAvailable)('permission catalog seed (0003) on a real PostgreSQL', () => {
  let db: BackofficeDatabase;

  beforeAll(async () => {
    db = await startBackofficeDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('seeds exactly the three read permissions via the migrator role', async () => {
    const client = await db.connect();
    try {
      const { rows } = await client.query<{
        id: string;
        domain: string;
        action: string;
        status: string;
      }>(
        `SELECT id, domain, action, status
           FROM backoffice.permissions ORDER BY id`,
      );
      expect(rows).toEqual(EXPECTED_SEEDED);
    } finally {
      await client.end();
    }
  });

  it('is idempotent: re-applying migrations does not duplicate rows', async () => {
    const client = await db.connect();
    try {
      await applyMigrations(client);
      await applyMigrations(client);
    } finally {
      await client.end();
    }

    const reader = await db.connect();
    try {
      const { rows } = await reader.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM backoffice.permissions`,
      );
      expect(rows[0]?.count).toBe('3');
    } finally {
      await reader.end();
    }
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
