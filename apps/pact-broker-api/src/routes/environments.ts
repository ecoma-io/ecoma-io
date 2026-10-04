/**
 * Environments routes — port từ upstream `src/routes/environments.ts`
 * (ADAPT: DO → PG repo, thêm tenant scope). HTTP status giữ nguyên: POST 201
 * application/hal+json, PUT luôn 201 application/json, GET 200.
 */
import { Hono, type MiddlewareHandler } from 'hono';
import type { AppEnv } from '../domain/types';
import { currentTenantId } from '../middleware/tenant-context';
import { HalBuilder, getBaseUrl } from '../domain/hal';
import { environmentNameSchema } from '../domain/validation';
import { validateParam } from '../middleware/validate';
import { PgEnvironmentRepo } from '../repo/environment-repo';

export function environmentRoutes(
  readAuth: () => MiddlewareHandler<AppEnv>,
  writeAuth: () => MiddlewareHandler<AppEnv>,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // List — `pact-broker-client` tìm environment theo link `name`
  // (record_release.rb#environment_exists?), không phải _embedded.
  app.get('/', readAuth(), async (c) => {
    const repo = new PgEnvironmentRepo(c.get('pool'));
    const envs = await repo.getAllEnvironments(currentTenantId(c));
    const hal = new HalBuilder(getBaseUrl(c.req.raw));

    return c.json({
      _links: {
        self: hal.link('/environments'),
        'pb:environments': envs.map((e) => ({
          ...hal.link(`/environments/${encodeURIComponent(e.name)}`, e.displayName ?? e.name),
          name: e.name,
        })),
      },
      _embedded: {
        environments: envs.map((e) => ({
          name: e.name,
          displayName: e.displayName,
          production: e.production,
          createdAt: e.createdAt,
          _links: hal.environment(e.name),
        })),
      },
    });
  });

  // Create — `pact-broker create-environment` POSTs collection.
  app.post('/', writeAuth(), async (c) => {
    let body: { name?: unknown; displayName?: unknown; production?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Bad Request', message: 'Invalid JSON body' }, 400);
    }

    const nameResult = validateParam(
      c,
      environmentNameSchema,
      typeof body.name === 'string' ? body.name : undefined,
      'name',
    );
    if (!nameResult.valid) return nameResult.errorResponse;

    const repo = new PgEnvironmentRepo(c.get('pool'));
    const { environment } = await repo.getOrCreate(
      currentTenantId(c),
      nameResult.value,
      typeof body.displayName === 'string' ? body.displayName : undefined,
      typeof body.production === 'boolean' ? body.production : undefined,
    );

    const hal = new HalBuilder(getBaseUrl(c.req.raw));
    return c.json(
      {
        name: environment.name,
        displayName: environment.displayName,
        production: environment.production,
        createdAt: environment.createdAt,
        _links: hal.environment(environment.name),
      },
      201,
      { 'Content-Type': 'application/hal+json' },
    );
  });

  // Get một environment.
  app.get('/:name', readAuth(), async (c) => {
    const nameResult = validateParam(c, environmentNameSchema, c.req.param('name'), 'name');
    if (!nameResult.valid) return nameResult.errorResponse;

    const repo = new PgEnvironmentRepo(c.get('pool'));
    const environment = await repo.getEnvironment(currentTenantId(c), nameResult.value);
    if (environment === null) {
      return c.json({ error: 'Not Found', message: 'Environment not found' }, 404);
    }

    const hal = new HalBuilder(getBaseUrl(c.req.raw));
    return c.json({
      name: environment.name,
      displayName: environment.displayName,
      production: environment.production,
      createdAt: environment.createdAt,
      _links: hal.environment(environment.name),
    });
  });

  // Create or update — upstream PUT luôn 201, body rỗng hợp lệ.
  app.put('/:name', writeAuth(), async (c) => {
    const nameResult = validateParam(c, environmentNameSchema, c.req.param('name'), 'name');
    if (!nameResult.valid) return nameResult.errorResponse;

    let body: { displayName?: unknown; production?: unknown } = {};
    try {
      body = await c.req.json();
    } catch {
      // Empty body is valid
    }

    const repo = new PgEnvironmentRepo(c.get('pool'));
    const { environment } = await repo.getOrCreate(
      currentTenantId(c),
      nameResult.value,
      typeof body.displayName === 'string' ? body.displayName : undefined,
      typeof body.production === 'boolean' ? body.production : undefined,
    );

    const hal = new HalBuilder(getBaseUrl(c.req.raw));
    return c.json(
      {
        name: environment.name,
        displayName: environment.displayName,
        production: environment.production,
        createdAt: environment.createdAt,
        _links: hal.environment(environment.name),
      },
      201,
    );
  });

  return app;
}
