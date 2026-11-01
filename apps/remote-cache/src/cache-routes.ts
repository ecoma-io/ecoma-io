/**
 * Data plane routes cua Worker `remote-cache` — P4.2 (issue #454).
 *
 * - `PUT /v1/cache/:hash` — upload artifact (write scope).
 * - `GET /v1/cache/:hash` — download artifact (read scope).
 *
 * Namespace isolation: moi request resolve `project_id` tu API key da xac thuc;
 * moi read/write filter theo `project_id`. Cross-project khong doc duoc.
 *
 * Immutability: re-PUT cua hash da ton tai bi 409 — enforce o schema (UNIQUE
 * project_id+hash) va o storage (conditional creation if-none-match *).
 *
 * Storage fail-closed: thieu storage config → 503, khong doan.
 */
import { Hono } from 'hono';
import type { AppEnv } from './types';
import { S3ObjectStorage } from './storage';
import {
  getApiKeyByTokenHash,
  getCacheEntryByProjectAndHash,
  getProjectById,
  insertCacheEntry,
  withRemoteCacheClient,
  type RemoteCacheClient,
} from '@ecoma-io/remote-cache-infrastructure';
import type { CacheObjectStorage } from './storage';
import type { RemoteCacheApiKeyScope } from '@ecoma-io/remote-cache-domain';
import { enforceTenantLifecycle } from './lifecycle';
import { isRemoteCacheDomainError } from '@ecoma-io/remote-cache-domain';

interface HttpError {
  readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 503;
  readonly body: { error: string; message: string };
}

function unauthorized(): HttpError {
  return { status: 401, body: { error: 'Unauthorized', message: 'A valid API key is required.' } };
}
function forbidden(message: string): HttpError {
  return { status: 403, body: { error: 'Forbidden', message } };
}
function notFound(): HttpError {
  return { status: 404, body: { error: 'Not Found', message: 'Cache entry not found.' } };
}
function conflict(): HttpError {
  return {
    status: 409,
    body: { error: 'Conflict', message: 'Cache entry already exists and is immutable.' },
  };
}
function payloadTooLarge(limit: number): HttpError {
  return {
    status: 413,
    body: {
      error: 'Payload Too Large',
      message: `Artifact exceeds maximum size of ${limit} bytes.`,
    },
  };
}
function serviceUnavailable(): HttpError {
  return {
    status: 503,
    body: { error: 'Service Unavailable', message: 'Object storage is not configured.' },
  };
}
function badRequest(message: string): HttpError {
  return { status: 400, body: { error: 'Bad Request', message } };
}

async function sha256Hex(input: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface AuthenticatedKey {
  readonly projectId: string;
  readonly tenantId: string;
  readonly scopes: readonly RemoteCacheApiKeyScope[];
  /** true neu key la credential CI tin cahy (duoc phep ghi neu co scope write). */
  readonly trustedCi: boolean;
}

async function requireApiKey(
  db: RemoteCacheClient,
  authorizationHeader: string | undefined,
  useCache: boolean,
): Promise<AuthenticatedKey | HttpError> {
  const bearerPrefix = 'Bearer ';
  if (
    typeof authorizationHeader !== 'string' ||
    !authorizationHeader.startsWith(bearerPrefix) ||
    authorizationHeader.slice(bearerPrefix.length).trim() === ''
  ) {
    return unauthorized();
  }
  const token = authorizationHeader.slice(bearerPrefix.length).trim();
  const tokenHash = await sha256Hex(token);
  const row = await getApiKeyByTokenHash(db, tokenHash);
  if (row === null || row.revoked_at !== null) {
    return unauthorized();
  }
  const project = await getProjectById(db, row.project_id);
  if (project === null) {
    return unauthorized();
  }

  // Enforce tenant lifecycle — fail-closed: tenant phai active moi duoc phep
  // doc/ghi. Doc duong su dung cache (useCache=true); ghi duong luon re-check
  // tu DB (useCache=false, bat bo cache). Domain error (tenant bi tu choi)
  // chuyen thanh HttpError de Worker tra lai status hop le thay 500.
  try {
    await enforceTenantLifecycle(db, project.tenant_id, useCache);
  } catch (error) {
    if (isRemoteCacheDomainError(error)) {
      return {
        status: 409 as const,
        body: { error: 'Conflict', message: `Tenant lifecycle rejected: ${error.message}` },
      };
    }
    throw error;
  }

  return {
    projectId: project.id,
    tenantId: project.tenant_id,
    scopes: row.scopes.split(' ') as RemoteCacheApiKeyScope[],
    trustedCi: row.trusted_ci,
  };
}

function objectKey(tenantId: string, projectId: string, hash: string): string {
  return `${tenantId}/${projectId}/${hash}`;
}

function hasScope(
  scopes: readonly RemoteCacheApiKeyScope[],
  scope: RemoteCacheApiKeyScope,
): boolean {
  return scopes.includes(scope);
}

/** Tao storage tu config hoac null neu thieu binding. */
function buildStorage(config: {
  storage: {
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  } | null;
}): CacheObjectStorage | null {
  if (config.storage === null) return null;
  return new S3ObjectStorage({ ...config.storage, region: 'auto' });
}

/** Stream dem byte va cat khi vuot gioi han. */
function sizeLimitedStream(
  source: ReadableStream<Uint8Array>,
  limit: number,
): ReadableStream<Uint8Array> {
  let total = 0;
  const reader = source.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      if (value !== undefined) {
        total += value.byteLength;
        if (total > limit) {
          controller.error(new Error('payload_too_large'));
          await reader.cancel().catch(() => undefined);
          return;
        }
        controller.enqueue(value);
      }
    },
    cancel() {
      return reader.cancel();
    },
  });
}

export function remoteCacheDataRoutes(
  storageOverride: CacheObjectStorage | null = null,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // --------------------------------------------------------------- GET ------
  app.get('/v1/cache/:hash', async (c) => {
    const hash = c.req.param('hash');
    if (
      typeof hash !== 'string' ||
      hash.length === 0 ||
      hash.length > 256 ||
      !/^[A-Za-z0-9._-]+$/u.test(hash) ||
      hash === '.' ||
      hash === '..'
    ) {
      return c.json(badRequest('hash must be a non-empty safe string.').body, 400);
    }

    const config = c.get('config');
    const storage = storageOverride ?? buildStorage(config);
    if (storage === null) {
      return c.json(serviceUnavailable().body, 503);
    }

    const outcome = await withRemoteCacheClient(config, async (db) => {
      const auth = await requireApiKey(db, c.req.header('authorization'), true);
      if ('status' in auth) return { authError: auth } as const;
      if (!hasScope(auth.scopes, 'read')) {
        return { authError: forbidden('This API key does not carry the read scope.') } as const;
      }
      const entry = await getCacheEntryByProjectAndHash(db, auth.projectId, hash);
      if (entry === null) {
        return { miss: true } as const;
      }
      return { entry, auth } as const;
    });

    const okOutcome = 'authError' in outcome || 'miss' in outcome ? null : outcome;
    if (okOutcome === null) {
      if ('miss' in outcome) {
        return c.json(notFound().body, 404);
      }
      const { body, status } = outcome.authError as HttpError;
      return c.json(body, status);
    }

    const obj = await storage.get(okOutcome.entry.object_key);
    if (obj === null) {
      // Metadata co nhung object storage miss — coi nhu miss (khong leak).
      return c.json(notFound().body, 404);
    }

    const headers: Record<string, string> = {
      'content-length': String(obj.size),
    };
    if (okOutcome.entry.content_type !== null) {
      headers['content-type'] = okOutcome.entry.content_type;
    }
    return new Response(obj.body as unknown as BodyInit, { status: 200, headers });
  });

  // --------------------------------------------------------------- PUT ------
  app.put('/v1/cache/:hash', async (c) => {
    const hash = c.req.param('hash');
    if (
      typeof hash !== 'string' ||
      hash.length === 0 ||
      hash.length > 256 ||
      !/^[A-Za-z0-9._-]+$/u.test(hash) ||
      hash === '.' ||
      hash === '..'
    ) {
      return c.json(badRequest('hash must be a non-empty safe string.').body, 400);
    }

    const config = c.get('config');
    const storage = storageOverride ?? buildStorage(config);
    if (storage === null) {
      return c.json(serviceUnavailable().body, 503);
    }

    const contentType = c.req.header('content-type') ?? null;
    const contentLengthHeader = c.req.header('content-length');
    if (contentLengthHeader === undefined || !/^\d+$/u.test(contentLengthHeader)) {
      return c.json(badRequest('Content-Length is required.').body, 400);
    }
    const declaredSize = Number(contentLengthHeader);
    if (declaredSize > config.maxArtifactSize) {
      return c.json(payloadTooLarge(config.maxArtifactSize).body, 413);
    }
    if (declaredSize <= 0) {
      return c.json(badRequest('Content-Length must be positive.').body, 400);
    }

    const bodyStream = c.req.raw.body;
    if (bodyStream === null) {
      return c.json(badRequest('Request body is required.').body, 400);
    }

    const limited = sizeLimitedStream(bodyStream, config.maxArtifactSize);

    // Auth truoc khi upload.
    const authOutcome = await withRemoteCacheClient(config, async (db) => {
      const auth = await requireApiKey(db, c.req.header('authorization'), false);
      if ('status' in auth) return { authError: auth } as const;

      // Fork/PR write protection: key khong tin cahy (trustedCi=false) khong
      // bao gio duoc phep ghi, neu ngay ca co scope `write`.
      if (!auth.trustedCi) {
        return { authError: forbidden('This API key is not trusted for write access.') } as const;
      }

      if (!hasScope(auth.scopes, 'write')) {
        return { authError: forbidden('This API key does not carry the write scope.') } as const;
      }
      const existing = await getCacheEntryByProjectAndHash(db, auth.projectId, hash);
      if (existing !== null) {
        return { exists: true } as const;
      }
      return { auth } as const;
    });

    const okAuth = 'authError' in authOutcome || 'exists' in authOutcome ? null : authOutcome;
    if (okAuth === null) {
      if ('exists' in authOutcome) {
        return c.json(conflict().body, 409);
      }
      const { body, status } = authOutcome.authError as HttpError;
      return c.json(body, status);
    }
    const auth = okAuth.auth;

    const key = objectKey(auth.tenantId, auth.projectId, hash);

    let putResult: 'created' | 'exists';
    try {
      putResult = await storage.putIfAbsent(key, limited, declaredSize ?? 0, contentType);
    } catch (error) {
      if (error instanceof Error && error.message === 'payload_too_large') {
        return c.json(payloadTooLarge(config.maxArtifactSize).body, 413);
      }
      throw error;
    }

    if (putResult === 'exists') {
      // Storage da co object — coi nhu conflict (immutability).
      return c.json(conflict().body, 409);
    }

    // Metadata insert — ON CONFLICT DO NOTHING de chong race.
    const inserted = await withRemoteCacheClient(config, async (db) => {
      return insertCacheEntry(db, {
        projectId: auth.projectId,
        hash,
        objectKey: key,
        sizeBytes: declaredSize,
        contentType,
      });
    });

    if (inserted === 0) {
      // Race: metadata da ton tai — conflict. Object vua tao o storage la hop le
      // (khong orphan) vi metadata cung ton tai.
      return c.json(conflict().body, 409);
    }

    // ⚠️ Orphan object risk (can nang P4.3): neu insertCacheEntry n Errors (mat
    // ket noi DB, vi pham constraint) thay vi tra ve 0, object da duoc ghi vao
    // storage ma khong co metadata. PUT tiep theo cung hash se nhan 409 (storage
    // da co) va GET se tra 404 (DB khong co) — hash bi kẹt vĩnh viễn: không
    // upload lại được, không download được. Port hien khong co delete, mo rong
    // contract de cleanup la P4.3. Hien tai: fail-open cho storage, fail-closed
    // cho DB — loi DB se throw va request that bai, operator can thao tac tay.

    return c.json({ hash, size: declaredSize }, 201);
  });

  return app;
}
