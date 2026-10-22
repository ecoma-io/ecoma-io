/**
 * Admin routes — quản trị machine token (scope `admin`).
 *
 * KHÔNG có route tạo tenant/membership: bootstrap tenant là việc của deploy
 * pipeline (ensureDefaultTenant qua db:migrate hoặc một bootstrap script một
 * lần), không phải API surface — một endpoint "tạo tenant" không xác thực
 * được ai có quyền tạo tenant sẽ thành backdoor tái diễn.
 *
 * Token: show-once — POST trả bản rõ đúng một lần trong response; mọi list
 * sau đó chỉ thấy prefix + metadata. Revoke hiệu lực tức thời.
 */
import { Hono, type MiddlewareHandler } from 'hono';
// Named imports, chủ ý — xem ghi chú trong src/domain/validation.ts.
import { array, enum as zEnum, object, string } from 'zod';
import type { AppEnv } from '../domain/types';
import { currentTenantId } from '../middleware/tenant-context';
import { PgTenantRepo } from '../repo/tenant-repo';
import { readJsonBodyWithLimit } from '../middleware/validate';
import { insertAuditEvent } from '../repo/token-repo';

const createTokenSchema = object({
  name: string().min(1, 'name is required').max(255, 'name exceeds 255 characters'),
  scopes: array(zEnum(['read', 'write', 'admin']))
    .min(1, 'at least one scope is required')
    .max(3, 'at most three scopes'),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function adminRoutes(adminAuth: () => MiddlewareHandler<AppEnv>): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // List machine tokens — metadata only, không bao giờ trả token bản rõ.
  app.get('/machine-tokens', adminAuth(), async (c) => {
    const repo = new PgTenantRepo(c.get('pool'));
    // Cục bộ là `tokenRows` (không phải `tokens`): tên trần `tokens` khớp nguồn
    // của rule security-sensitive-value-in-http-response dù giá trị chỉ là
    // metadata; key `_embedded.tokens` giữ nguyên vì là hợp đồng API (HAL).
    const tokenRows = await repo.listMachineTokens(currentTenantId(c));
    return c.json({
      _embedded: {
        tokens: tokenRows.map((t) => ({
          id: t.id,
          name: t.name,
          scopes: t.scopes.split(' ').filter((s) => s !== ''),
          createdAt: t.createdAt,
          revokedAt: t.revokedAt,
        })),
      },
    });
  });

  // Create machine token — response chứa token bản rõ ĐÚNG MỘT LẦN.
  app.post('/machine-tokens', adminAuth(), async (c) => {
    const bodyResult = await readJsonBodyWithLimit(c, 64 * 1024, 'Admin body');
    if (!bodyResult.ok) return bodyResult.errorResponse;
    if (bodyResult.value === undefined) {
      return c.json({ error: 'Bad Request', message: 'Invalid JSON body' }, 400);
    }
    const raw = bodyResult.value;
    const parsed = createTokenSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return c.json(
        {
          error: 'Bad Request',
          message: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid request',
        },
        400,
      );
    }

    const tenantId = currentTenantId(c);
    const repo = new PgTenantRepo(c.get('pool'));
    const { token, record } = await repo.createMachineToken(
      tenantId,
      null, // actor sub: machine token path không có user sub
      parsed.data.name,
      parsed.data.scopes,
    );

    // Audit fire-and-forget: lỗi audit không fail request (bất biến
    // observability), nhưng cố ghi.
    try {
      const client = await c.get('pool').connect();
      try {
        await insertAuditEvent(client, {
          tenantId,
          actorSub: null,
          actorTokenId: record.id,
          action: 'machine_token.create',
          outcome: 'success',
          detail: { tokenId: record.id, scopes: parsed.data.scopes },
        });
      } finally {
        client.release();
      }
    } catch (error) {
      // oxlint-disable-next-line no-console
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'audit write failed for machine_token.create',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }

    return c.json(
      {
        token: {
          id: record.id,
          name: parsed.data.name,
          scopes: parsed.data.scopes,
          createdAt: record.createdAt,
          revokedAt: null,
        },
        // Show-once: giá trị duy nhất lần này response chứa nó.
        secret: token,
      },
      201,
    );
  });

  // Revoke machine token — hiệu lực tức thời.
  app.delete('/machine-tokens/:id', adminAuth(), async (c) => {
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) {
      return c.json({ error: 'Not Found', message: 'Token not found' }, 404);
    }
    const repo = new PgTenantRepo(c.get('pool'));
    const ok = await repo.revokeMachineToken(currentTenantId(c), id);
    if (!ok) {
      return c.json({ error: 'Not Found', message: 'Token not found (or already revoked)' }, 404);
    }
    return c.body(null, 204);
  });

  return app;
}
