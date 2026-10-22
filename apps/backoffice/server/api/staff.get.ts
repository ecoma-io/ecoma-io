/**
 * `GET /api/staff` — danh sách staff directory, qua enforcement của
 * workstream B (issue #99).
 *
 * Permission: `staff.read` — định danh có thật trong sealed catalog
 * (`0003_permission_catalog_seed.sql`, ADR-0010). Không phát minh permission.
 *
 * Trả `{ staff: StaffRow[] }` — đúng những cột allowlist của
 * {@link listStaff} (`sub`, `status`), không format UI.
 *
 * Fail-closed: principal không verify được ⇒ `503` (ADR-0010 — không `401`);
 * binding DB vắng / DB unreachable ⇒ `503`; `can()` deny ⇒ `403` sau khi audit
 * đã ghi. Xem {@link withReadEnforcement}.
 */

import { defineEventHandler } from 'h3';
import type { PoolClient } from 'pg';

import { listStaff } from '../queries';
import { withReadEnforcement } from '../read-route';

export default defineEventHandler((event) =>
  withReadEnforcement(event, 'staff.read', async (client: PoolClient) => ({
    staff: await listStaff(client),
  })),
);
