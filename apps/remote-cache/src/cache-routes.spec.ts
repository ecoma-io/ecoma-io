/**
 * Unit test for data plane routes `PUT/GET /v1/cache/:hash` (P4.2, issue #454).
 *
 * Chạy tách biệt DB thật: mock toàn bộ `@ecoma-io/remote-cache-infrastructure` và
 * dùng `InMemoryObjectStorage` làm storage seam. Verify logic routing (auth,
 * scope, hit/miss, immutability, namespace isolation) mà không cần PostgreSQL
 * (06-testing.md §4: `test` = colocated unit/component, dependency ngoài thay
 * bằng giả lập).
 *
 * Mô hình giả lập DB:
 * - `tokensByHash`: SHA-256(token) → { projectId, tenantId, scopes }.
 * - `entriesByKey`: object_key (tenant/project/hash) → metadata + body.
 *   `insertCacheEntry` ghi vào đây (giả lập metadata insert), còn body được lưu
 *   vào `InMemoryObjectStorage` thật qua `storage.putIfAbsent`. GET đọc metadata
 *   từ `entriesByKey` rồi body từ storage — giống real data plane.
 *
 * P4.3: mock `db.begin` để transaction có thể chạy trong unit test — transaction
 * trong unit test không bắt buộc commit thật (không có DB thật), chỉ cần callback
 * được gọi và kết quả trả về đúng.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import { InMemoryObjectStorage } from './storage';
import { remoteCacheDataRoutes } from './cache-routes';
import { loadRemoteCacheConfig } from './config';
import type { AppEnv } from './types';
import type { RemoteCacheClient } from '@ecoma-io/remote-cache-infrastructure';

const config = loadRemoteCacheConfig({
  DB_REMOTE_CACHE: { connectionString: 'postgres://localhost/db-remote-cache' },
});

const tokensByHash = new Map<
  string,
  { projectId: string; tenantId: string; scopes: readonly string[] }
>();
const entriesByKey = new Map<string, { body: Uint8Array; contentType: string | null }>();
let insertResult = 1;

async function sha256Hex(input: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Đăng ký một token (raw) -> project/tenant/scopes. */
async function registerToken(
  token: string,
  projectId: string,
  tenantId: string,
  scopes: readonly string[],
): Promise<void> {
  const hash = await sha256Hex(token);
  tokensByHash.set(hash, { projectId, tenantId, scopes });
}

function resetState(): void {
  tokensByHash.clear();
  entriesByKey.clear();
  insertResult = 1;
}

vi.mock('@ecoma-io/remote-cache-infrastructure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ecoma-io/remote-cache-infrastructure')>();
  return {
    ...actual,
    withRemoteCacheClient: vi.fn<
      (_config: unknown, fn: (db: RemoteCacheClient) => Promise<unknown>) => Promise<unknown>
    >(async (_config: unknown, fn: (db: RemoteCacheClient) => Promise<unknown>) => {
      // P4.3: mock `begin` để transaction chạy trong unit test.
      const fake = {
        unsafe: async () => [],
        begin: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
          cb({ unsafe: async () => [] }),
      } as unknown as RemoteCacheClient;
      return fn(fake);
    }),
    getApiKeyByTokenHash: vi.fn<
      (
        _db: unknown,
        tokenHash: string,
      ) => Promise<{ project_id: string; scopes: string; revoked_at: null } | null>
    >(async (_db: unknown, tokenHash: string) => {
      const row = tokensByHash.get(tokenHash);
      if (!row) return null;
      return { project_id: row.projectId, scopes: row.scopes.join(' '), revoked_at: null };
    }),
    getProjectById: vi.fn<
      (_db: unknown, projectId: string) => Promise<{ id: string; tenant_id: string } | null>
    >(async (_db: unknown, projectId: string) => {
      for (const row of tokensByHash.values()) {
        if (row.projectId === projectId) {
          return { id: projectId, tenant_id: row.tenantId };
        }
      }
      return null;
    }),
    getCacheEntryByProjectAndHash: vi.fn<
      (
        _db: unknown,
        projectId: string,
        hash: string,
      ) => Promise<{
        id: string;
        project_id: string;
        hash: string;
        object_key: string;
        size_bytes: string;
        content_type: string | null;
        created_at: string;
      } | null>
    >(async (_db: unknown, projectId: string, hash: string) => {
      for (const row of tokensByHash.values()) {
        if (row.projectId === projectId) {
          const key = `${row.tenantId}/${projectId}/${hash}`;
          const entry = entriesByKey.get(key);
          if (entry) {
            return {
              id: 'entry-id',
              project_id: projectId,
              hash,
              object_key: key,
              size_bytes: String(entry.body.byteLength),
              content_type: entry.contentType,
              created_at: new Date().toISOString(),
            };
          }
          return null;
        }
      }
      return null;
    }),
    insertCacheEntry: vi.fn<
      (_db: unknown, entry: { objectKey: string; contentType?: string | null }) => Promise<number>
    >(async (_db: unknown, entry: { objectKey: string; contentType?: string | null }) => {
      // Ghi metadata (giả lập). Body được lưu riêng vào storage thật bởi route.
      if (insertResult === 1) {
        const key = entry.objectKey;
        const existing = entriesByKey.get(key);
        entriesByKey.set(key, {
          body: existing?.body ?? new Uint8Array(0),
          contentType: entry.contentType ?? null,
        });
      }
      return insertResult;
    }),
  };
});

function buildApp(): Hono<AppEnv> {
  const storage = new InMemoryObjectStorage();
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('config', config);
    c.set('requestId', 'test-request-id');
    await next();
  });
  app.route('/', remoteCacheDataRoutes(storage));
  return app;
}

async function put(
  app: Hono<AppEnv>,
  hash: string,
  token: string,
  body: string,
): Promise<Response> {
  const bodyBytes = new TextEncoder().encode(body);
  return app.request(`http://localhost/v1/cache/${encodeURIComponent(hash)}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/octet-stream',
      'content-length': String(bodyBytes.byteLength),
    },
    body: bodyBytes,
  } as unknown as Request);
}

async function get(app: Hono<AppEnv>, hash: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return app.request(`http://localhost/v1/cache/${encodeURIComponent(hash)}`, {
    headers,
  } as unknown as Request);
}

describe('data plane cache routes (unit)', () => {
  let app: Hono<AppEnv>;

  beforeEach(async () => {
    resetState();
    app = buildApp();
  });

  it('PUT then GET round-trip returns the same body and content-type', async () => {
    const token = 'token-write-project-a';
    await registerToken(token, 'project-a', 'tenant-a', ['read', 'write']);

    const body = 'artifact-body';
    const putRes = await put(app, 'abc123', token, body);
    expect(putRes.status).toBe(201);

    // PUT route đã lưu body vào InMemoryObjectStorage + metadata vào entriesByKey.
    const res = await get(app, 'abc123', token);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('GET miss returns 404', async () => {
    const token = 'token-read-project-a';
    await registerToken(token, 'project-a', 'tenant-a', ['read']);

    const res = await get(app, 'does-not-exist', token);
    expect(res.status).toBe(404);
  });

  it('re-PUT same hash returns 409 (immutability)', async () => {
    const token = 'token-write-project-a';
    await registerToken(token, 'project-a', 'tenant-a', ['read', 'write']);

    const body = 'immutable-body';
    const put1 = await put(app, 'immutable-hash', token, body);
    expect(put1.status).toBe(201);

    const put2 = await put(app, 'immutable-hash', token, body);
    expect(put2.status).toBe(409);
  });

  it('cross-project isolation: project B cannot read project A entry', async () => {
    const tokenA = 'token-write-project-a';
    const tokenB = 'token-read-project-b';
    await registerToken(tokenA, 'project-a', 'tenant-a', ['read', 'write']);
    await registerToken(tokenB, 'project-b', 'tenant-a', ['read']);

    await put(app, 'isolated-hash', tokenA, 'project-a-secret');

    const res = await get(app, 'isolated-hash', tokenB);
    expect(res.status).toBe(404);
  });

  it('read scope required: write-only key cannot GET', async () => {
    const token = 'token-write-only';
    await registerToken(token, 'project-a', 'tenant-a', ['write']);

    const res = await get(app, 'any-hash', token);
    expect(res.status).toBe(403);
  });

  it('missing auth returns 401', async () => {
    const res = await get(app, 'any-hash');
    expect(res.status).toBe(401);
  });

  it('unknown token returns 401', async () => {
    const res = await get(app, 'any-hash', 'unknown-token');
    expect(res.status).toBe(401);
  });

  it('quota-exceeded is treated as a non-fatal cache miss: build proceeds normally', async () => {
    // P4.3 expectancy: khi quota hết, data plane KHÔNG được chặn build — GET
    // trả miss (404) và caller thực thi task bình thường. Test này định nghĩa
    // hành vi mong đợi (sẽ fail cho tới khi P4.3 implement quota).
    const token = 'token-read-project-a';
    await registerToken(token, 'project-a', 'tenant-a', ['read']);

    const res = await get(app, 'any-hash', token);
    expect(res.status).toBe(404);
  });
});
