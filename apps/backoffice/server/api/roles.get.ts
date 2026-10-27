/**
 * `GET /api/roles` — danh sách role catalog, qua enforcement của workstream B
 * (issue #99).
 *
 * Permission: `role.read` — định danh có thật trong sealed catalog
 * (`0003_permission_catalog_seed.sql`, ADR-0010). Không phát minh permission.
 *
 * Trả `{ roles: RoleRow[] }` — `id` + `isSystem` (đã map ở tầng JS), đúng
 * allowlist của {@link listRoles}.
 *
 * Fail-closed: principal không verify được ⇒ `503` (ADR-0010 — không `401`);
 * binding DB vắng / DB unreachable ⇒ `503`; `can()` deny ⇒ `403` sau khi audit
 * đã ghi. Xem {@link withReadEnforcement}.
 */

import { defineEventHandler } from 'h3';
import type { PoolClient } from 'pg';

import { listRoles } from '@ecoma-io/backoffice-infrastructure';
import { withReadEnforcement } from '../read-route';

export default defineEventHandler((event) =>
  withReadEnforcement(event, 'role.read', async (client: PoolClient) => ({
    roles: await listRoles(client),
  })),
);
