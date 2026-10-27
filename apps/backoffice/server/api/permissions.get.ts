/**
 * `GET /api/permissions` — danh sách permission catalog, qua enforcement của
 * workstream B (issue #99).
 *
 * Permission: `permission.read` — định danh có thật trong sealed catalog
 * (`0003_permission_catalog_seed.sql`, ADR-0010). Không phát minh permission.
 *
 * Trả `{ permissions: ... }` — `id`/`domain`/`action`/`status`, đúng
 * allowlist của {@link listPermissions}. Có thể gồm row `retired`: catalog là
 * sealed history, lọc ở UI là quyết định hiển thị.
 *
 * Fail-closed: principal không verify được ⇒ `503` (ADR-0010 — không `401`);
 * binding DB vắng / DB unreachable ⇒ `503`; `can()` deny ⇒ `403` sau khi audit
 * đã ghi. Xem {@link withReadEnforcement}.
 */

import { defineEventHandler } from 'h3';
import type { PoolClient } from 'pg';

import { listPermissions } from '@ecoma-io/backoffice-infrastructure';
import { withReadEnforcement } from '../read-route';

export default defineEventHandler((event) =>
  withReadEnforcement(event, 'permission.read', async (client: PoolClient) => ({
    permissions: await listPermissions(client),
  })),
);
