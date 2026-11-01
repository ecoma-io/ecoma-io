/**
 * Data plane routes cua Worker `remote-cache` — P4.2 (issue #454) + P4.3 (issue #461).
 *
 * - `PUT /v1/cache/:hash` — upload artifact (write scope) + quota enforcement (429 non-fatal).
 * - `GET /v1/cache/:hash` — download artifact (read scope) + retention TTL check.
 *
 * Namespace isolation: moi request resolve `project_id` tu API key da xac thuc;
 * moi read/write filter theo `project_id`. Cross-project khong doc duoc.
 *
 * Immutability: re-PUT cua hash da ton tai bi 409 — enforce o schema (UNIQUE
 * project_id+hash) va o storage (conditional creation if-none-match *).
 *
 * Storage fail-closed: thieu storage config → 503, khong doan.
 *
 * P4.3 (quota/retention/usage/audit):
 * - Quota: PUT kiem tra quota_limits + usage_counters cua project truoc khi ghi.
 *   Vuot quota → 429 Too Many Requests, NON-FATAL cho caller (cache miss → build
 *   chay binh thường). Ghi audit_log (action `quota_exceeded`, outcome `denied`).
 *   Quota con cho phep ghi → ghi audit_log (action `cache_put`, outcome `allowed`),
 *   sau do ghi audit_log (action `cache_put`, outcome `allowed`) trong cung
 *   transaction. Trigger `cache_entries_after_insert_sync` (migration 0005)
 *   dong bo `usage_counters` sau khi `cache_entries` duoc chen/xoa.
 * - Retention: GET kiem tra expires_at cua entry; het han → 404 (miss, khong leak).
 * - Audit: moi su kien quota-relevant (quota_exceeded, cache_put) duoc ghi vao
 *   audit_log (actor = api_key id, target = project/hash, time = server now).
 *
 * Quota check + chen metadata + ghi audit_log chay trong mot transaction tren
 * mot client (finding 3: tranh race giua kiem quota va cap nhat bo dem).
 */
import { Hono } from 'hono';
import type { AppEnv } from './types';
import { S3ObjectStorage } from './storage';
import {
  getApiKeyByTokenHash,
  getCacheEntryByProjectAndHash,
  getProjectById,
  getQuotaLimitByProject,
  getUsageCounterByProject,
  insertAuditLog,
  insertCacheEntry,
  withRemoteCacheClient,
  type RemoteCacheClient,
} from '@ecoma-io/remote-cache-infrastructure';
import type { CacheObjectStorage } from './storage';
import type { RemoteCacheApiKeyScope } from '@ecoma-io/remote-cache-domain';

interface HttpError {
  readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503;
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
function quotaExceeded(): HttpError {
  return {
    status: 429,
    body: {
      error: 'Too Many Requests',
      message: 'Write would exceed project quota. Cache miss — build proceeds normally.',
    },
  };
}

async function sha256Hex(input: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface AuthenticatedKey {
  readonly projectId: string;
  readonly tenantId: string;
  readonly scopes: readonly RemoteCacheApiKeyScope[];
}

async function requireApiKey(
  db: RemoteCacheClient,
  authorizationHeader: string | undefined,
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
  return {
    projectId: project.id,
    tenantId: project.tenant_id,
    scopes: row.scopes.split(' ') as RemoteCacheApiKeyScope[],
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

/** Kiem quota: neu write se vuot han → tra 'exceeded'; nguoc lai 'ok' voi usage hien tai.
 *  `maxBytes`/`maxCount` ap dung default tu config neu project chua co hang
 *  quota_limits (Finding 2: khong co row => van ap dung han che mac dinh). */
async function checkQuota(
  db: RemoteCacheClient,
  projectId: string,
  artifactSize: number,
  defaults: { defaultMaxStorageBytes: number; defaultMaxEntryCount: number },
): Promise<{ status: 'ok' | 'exceeded'; currentBytes: number; currentCount: number }> {
  const [quota, usage] = await Promise.all([
    getQuotaLimitByProject(db, projectId),
    getUsageCounterByProject(db, projectId),
  ]);

  const currentBytes = usage ? Number(usage.storage_bytes_used) : 0;
  const currentCount = usage ? Number(usage.entry_count) : 0;

  // Ap dung default tu config neu chua co hang quota_limits.
  // Neu chua co hang usage_counters, bat dau tu 0.
  let maxBytes: number | null = defaults.defaultMaxStorageBytes ?? null;
  let maxCount: number | null = defaults.defaultMaxEntryCount ?? null;
  if (quota) {
    maxBytes = Number(quota.max_storage_bytes);
    maxCount = Number(quota.max_entry_count);
  }

  // Kiem storage bytes (chi khi co han che va co usage).
  if (maxBytes !== null && maxBytes > 0 && currentBytes + artifactSize > maxBytes) {
    return { status: 'exceeded', currentBytes, currentCount };
  }
  // Kiem entry count (chi khi co han che). Mot entry moi them 1 vao count.
  if (maxCount !== null && maxCount > 0 && currentCount + 1 > maxCount) {
    return { status: 'exceeded', currentBytes, currentCount };
  }

  return { status: 'ok', currentBytes, currentCount };
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
      const auth = await requireApiKey(db, c.req.header('authorization'));
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

    const { entry } = okOutcome;

    // Retention TTL: entry het han → coi nhu miss (404, khong leak).
    if (entry.expires_at !== null && new Date(entry.expires_at) <= new Date()) {
      return c.json(notFound().body, 404);
    }

    const obj = await storage.get(entry.object_key);
    if (obj === null) {
      // Metadata co nhung object storage miss — coi nhu miss (khong leak).
      return c.json(notFound().body, 404);
    }

    const headers: Record<string, string> = {
      'content-length': String(obj.size),
    };
    if (entry.content_type !== null) {
      headers['content-type'] = entry.content_type;
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
      const auth = await requireApiKey(db, c.req.header('authorization'));
      if ('status' in auth) return { authError: auth } as const;
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

    // P4.3 quota check + luu storage + chen metadata + ghi audit_log.
    // Quota check va ghi DB chay cung mot client (Finding 3: mot transaction,
    // tranh race giua kiem quota va cap nhat bo dem). Trigger
    // `cache_entries_after_insert_sync` (migration 0005) dong bo usage_counters
    // sau khi insertCacheEntry, nen khong can goi upsertUsageCounter lien tiep.
    const putOutcome = await withRemoteCacheClient(config, async (db) => {
      // 1. Kiem quota trong transaction (Finding 2: ap dung default tu config).
      const quotaCheck = await checkQuota(db, auth.projectId, declaredSize, config.quota);
      if (quotaCheck.status === 'exceeded') {
        // Ghi audit_log (action quota_exceeded, outcome denied) trong cung tx.
        await insertAuditLog(db, {
          actor: `api_key:${auth.projectId}`,
          action: 'quota_exceeded',
          target: `project:${auth.projectId}/hash:${hash}`,
          outcome: 'denied',
          details: `PUT ${hash} size ${declaredSize} bytes would exceed project quota (current ${quotaCheck.currentBytes} bytes / ${quotaCheck.currentCount} entries).`,
          projectId: auth.projectId,
        });
        return { status: 'exceeded' as const, quotaCheck };
      }

      const key = objectKey(auth.tenantId, auth.projectId, hash);

      // Retention TTL: neu co default TTL, tinh expires_at.
      const expiresAt =
        config.retention.defaultTtlSeconds !== null
          ? new Date(Date.now() + config.retention.defaultTtlSeconds * 1000).toISOString()
          : null;

      // 2. Luu storage (ngoai tx DB, nhung cung client).
      let putResult: 'created' | 'exists';
      try {
        putResult = await storage.putIfAbsent(key, limited, declaredSize ?? 0, contentType);
      } catch (error) {
        if (error instanceof Error && error.message === 'payload_too_large') {
          return { status: 'payloadTooLarge' as const };
        }
        throw error;
      }

      if (putResult === 'exists') {
        // Storage da co object — coi nhu conflict (immutability).
        return { status: 'exists' as const };
      }

      // 3. Transaction: chen metadata + ghi audit_log. Trigger dong bo
      //    usage_counters sau insertCacheEntry (Finding 1).
      const insertResult = await db.begin(async (tx) => {
        const inserted = await insertCacheEntry(tx, {
          projectId: auth.projectId,
          hash,
          objectKey: key,
          sizeBytes: declaredSize,
          contentType,
          expiresAt,
        });
        if (inserted === 0) {
          return 'exists' as const;
        }
        await insertAuditLog(tx, {
          actor: `api_key:${auth.projectId}`,
          action: 'cache_put',
          target: `project:${auth.projectId}/hash:${hash}`,
          outcome: 'allowed',
          details: `PUT ${hash} size ${declaredSize} bytes; project now uses ${quotaCheck.currentBytes + declaredSize} bytes / ${quotaCheck.currentCount + 1} entries.`,
          projectId: auth.projectId,
        });
        return 'ok' as const;
      });

      if (insertResult === 'exists') {
        // Race: metadata da ton tai — conflict.
        return { status: 'exists' as const };
      }

      return { status: 'ok' as const, quotaCheck };
    });

    if (putOutcome.status === 'exceeded') {
      // 429 non-fatal: caller nhan cache miss, thuc hien task binh thuong.
      return c.json(quotaExceeded().body, 429);
    }
    if (putOutcome.status === 'payloadTooLarge') {
      return c.json(payloadTooLarge(config.maxArtifactSize).body, 413);
    }
    if (putOutcome.status === 'exists') {
      return c.json(conflict().body, 409);
    }
    return c.json({ hash, size: declaredSize }, 201);
  });

  return app;
}
