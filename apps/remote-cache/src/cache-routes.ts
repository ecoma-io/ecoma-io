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
 *   Quota con cho phep ghi → ghi audit_log (action `cache_put`, outcome `allowed`)
 *   trong cung transaction. Trigger `cache_entries_after_insert_sync` (migration 0005)
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
  type RemoteCacheQueryable,
} from '@ecoma-io/remote-cache-infrastructure';
import type { CacheObjectStorage } from './storage';
import type { RemoteCacheApiKeyScope } from '@ecoma-io/remote-cache-domain';
import { enforceTenantLifecycle } from './lifecycle';
import { isRemoteCacheDomainError } from '@ecoma-io/remote-cache-domain';

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

/** Parse counter value from DB; throw (fail-closed) if non-numeric. */
function parseCounterValue(value: string, projectId: string, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`usage_counters for project ${projectId} has non-numeric ${field}`);
  }
  return n;
}

/** Kiem quota: neu write se vuot han → tra 'exceeded'; nguoc lai 'ok' voi usage hien tai.
 *  `maxBytes`/`maxCount` ap dung default tu config neu project chua co hang
 *  quota_limits (Finding 2: khong co row => van ap dung han che mac dinh). */
async function checkQuota(
  db: RemoteCacheQueryable,
  projectId: string,
  artifactSize: number,
  defaults: { defaultMaxStorageBytes: number; defaultMaxEntryCount: number },
): Promise<{ status: 'ok' | 'exceeded'; currentBytes: number; currentCount: number }> {
  const [quota, usage] = await Promise.all([
    getQuotaLimitByProject(db, projectId),
    getUsageCounterByProject(db, projectId),
  ]);

  const currentBytesRaw = usage ? usage.storage_bytes_used : '0';
  const currentCountRaw = usage ? usage.entry_count : '0';
  const currentBytes = parseCounterValue(currentBytesRaw, projectId, 'storage_bytes_used');
  const currentCount = parseCounterValue(currentCountRaw, projectId, 'entry_count');

  // Ap dung default tu config neu chua co hang quota_limits.
  // Neu chua co hang usage_counters, bat dau tu 0.
  // Neu gia tri tu DB khong phai so hop le, nem loi (fail-closed) thay bo qua kiem tra.
  let maxBytes: number | null = defaults.defaultMaxStorageBytes ?? null;
  let maxCount: number | null = defaults.defaultMaxEntryCount ?? null;
  if (quota) {
    const maxBytesRaw = Number(quota.max_storage_bytes);
    const maxCountRaw = Number(quota.max_entry_count);
    if (!Number.isFinite(maxBytesRaw) || !Number.isFinite(maxCountRaw)) {
      throw new Error(
        `quota_limits for project ${projectId} has non-numeric max_storage_bytes/max_entry_count`,
      );
    }
    maxBytes = maxBytesRaw;
    maxCount = maxCountRaw;
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

    // Auth truoc khi doc body de tranh DoS: client chua xac thuc khong the buoc
    // server buffer payload lon (maxArtifactSize mac dinh 512 MiB) (Finding security high).
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

    // Doc va dem so byte thuc tu body stream DE XAC THUC voi declaredSize sau khi auth.
    const limited = sizeLimitedStream(bodyStream, config.maxArtifactSize);
    const bodyChunks: Uint8Array[] = [];
    const limitedReader = limited.getReader();
    while (true) {
      const { value, done } = await limitedReader.read();
      if (done) break;
      if (value !== undefined) bodyChunks.push(value);
    }
    const actualSize = bodyChunks.reduce((n, chunk) => n + chunk.byteLength, 0);
    const bodyBuffer = new Uint8Array(actualSize);
    let bodyOffset = 0;
    for (const chunk of bodyChunks) {
      bodyBuffer.set(chunk, bodyOffset);
      bodyOffset += chunk.byteLength;
    }
    const bodyStreamForStorage = new ReadableStream<Uint8Array>({
      start(controller: ReadableStreamDefaultController<Uint8Array>): void {
        controller.enqueue(bodyBuffer);
        controller.close();
      },
    });

    // P4.3 quota check + luu storage + chen metadata + ghi audit_log.
    // Tat ca chay trong mot transaction (db.begin) de tranh race giua kiem quota
    // va cap nhat bo dem, va de ghi audit_log nhat qua voi cache_entries
    // (Finding 3). Trigger `cache_entries_after_insert_sync` (migration 0005)
    // dong bo usage_counters sau khi insertCacheEntry, nen khong can goi
    // upsertUsageCounter lien tiep.
    // Kich thuoc su dung cho quota/metering/response la `actualSize` (byte thuc te doc duoc
    // tu body stream), khong phai `declaredSize` tu header (co the bi client
    // khai bao sai de bypass quota hoac gay tu choi sai).
    const putOutcome = await withRemoteCacheClient(config, async (db) => {
      // 1. Kiem quota TRONG transaction (FOR UPDATE tren usage_counters dam bao
      //    mo dong, tranh race giua cac request cung project).
      const quotaCheck = await db.begin(async (tx) => {
        await tx.unsafe(
          `SELECT 1 FROM remote_cache.usage_counters WHERE project_id = $1 FOR UPDATE`,
          [auth.projectId],
        );
        return checkQuota(tx, auth.projectId, actualSize, config.quota);
      });
      if (quotaCheck.status === 'exceeded') {
        // Ghi audit_log quota_exceeded o cung tx voi cache_put — neu ghi audit
        // bi loi, khong doi 429 thanh 500 (quota-exceeded la non-fatal).
        try {
          await db.begin(async (tx) => {
            await insertAuditLog(tx, {
              actor: `api_key:${auth.projectId}`,
              action: 'quota_exceeded',
              target: `project:${auth.projectId}/hash:${hash}`,
              outcome: 'denied',
              details: `PUT ${hash} size ${actualSize} bytes would exceed project quota (current ${quotaCheck.currentBytes} bytes / ${quotaCheck.currentCount} entries).`,
              projectId: auth.projectId,
            });
          });
        } catch {
          // Audit log failure must not convert non-fatal 429 into 500.
        }
        return { status: 'exceeded' as const, quotaCheck };
      }

      const key = objectKey(auth.tenantId, auth.projectId, hash);

      // Retention TTL: neu co default TTL, tinh expires_at.
      const expiresAt =
        config.retention.defaultTtlSeconds !== null
          ? new Date(Date.now() + config.retention.defaultTtlSeconds * 1000).toISOString()
          : null;

      // 2. Luu storage SAU khi DB metadata da duoc chen thanh cong trong transaction.
      //    Neu storage that bai, xoa metadata vua chen de tranh object mo coi.
      const insertResult: { wasInsert: boolean } = await db.begin(async (tx) => {
        const inserted = await insertCacheEntry(tx, {
          projectId: auth.projectId,
          hash,
          objectKey: key,
          sizeBytes: actualSize,
          contentType,
          expiresAt,
        });
        if (!inserted.wasInsert) {
          return inserted;
        }
        await insertAuditLog(tx, {
          actor: `api_key:${auth.projectId}`,
          action: 'cache_put',
          target: `project:${auth.projectId}/hash:${hash}`,
          outcome: 'allowed',
          details: `PUT ${hash} size ${actualSize} bytes; project now uses ${quotaCheck.currentBytes + actualSize} bytes / ${quotaCheck.currentCount + 1} entries.`,
          projectId: auth.projectId,
        });
        return inserted;
      });

      if (!insertResult.wasInsert) {
        // Race: metadata da ton tai — conflict (immutability).
        return { status: 'exists' as const };
      }

      // 3. Ghi storage (dung payload actualSize, khong phai declaredSize).
      let putResult: 'created' | 'exists';
      try {
        putResult = await storage.putIfAbsent(key, bodyStreamForStorage, actualSize, contentType);
      } catch (error) {
        // Neu storage that lai sau khi DB da chen metadata, xoa metadata vua chen
        // de tranh hash bi ket: PUT sau tra 409, GET tra 404.
        try {
          await withRemoteCacheClient(config, async (db2) => {
            await db2.begin(async (tx) => {
              await tx.unsafe(
                `DELETE FROM remote_cache.cache_entries WHERE project_id = $1 AND hash = $2`,
                [auth.projectId, hash],
              );
            });
          });
        } catch {
          // Best-effort cleanup; khong lam thay doi ket qua loi storage.
        }
        throw error;
      }

      if (putResult === 'exists') {
        // Storage da co object — xoa metadata vua chen de dam bao consistency.
        try {
          await withRemoteCacheClient(config, async (db2) => {
            await db2.begin(async (tx) => {
              await tx.unsafe(
                `DELETE FROM remote_cache.cache_entries WHERE project_id = $1 AND hash = $2`,
                [auth.projectId, hash],
              );
            });
          });
        } catch {
          // Best-effort cleanup.
        }
        return { status: 'exists' as const };
      }

      return { status: 'ok' as const, quotaCheck };
    });

    if (putOutcome.status === 'exceeded') {
      // 429 non-fatal: caller nhan cache miss, thuc hien task binh thuong.
      return c.json(quotaExceeded().body, 429);
    }
    if (putOutcome.status === 'exists') {
      return c.json(conflict().body, 409);
    }
    return c.json({ hash, size: actualSize }, 201);
  });

  return app;
}
