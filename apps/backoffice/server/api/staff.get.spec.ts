/**
 * Unit test của merge `displayName` trong `GET /api/staff` (issue #325) —
 * classification nhánh **controlled degrade** tách khỏi suite integration:
 * cache module-level được reset giữa các test qua
 * {@link resetDisplayNameCacheForTests}, và Service Binding là mock duy nhất.
 *
 * ⚠️ Suite integration (read-routes.spec.ts) seed PostgreSQL thật; suite này
 * ghim các quyết định chính sách: hit cache không tạo call, miss tạo đúng một
 * batch, account hỏng ⇒ 200 với `displayName: null` + log `staff.account_degraded`.
 */

import { createApp, createRouter, defineEventHandler, toWebHandler } from 'h3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { accountProfilesResponse } from '@ecoma-io/account-contracts';
import { resetDisplayNameCacheForTests, storeDisplayNames } from '@ecoma-io/backoffice-application';
import {
  ACCOUNT_SERVICE_BINDING_NAME,
  AUTH_INTERNAL_SECRET_ENV,
} from '@ecoma-io/backoffice-infrastructure';

import { PRINCIPAL_CONTEXT_KEY } from '../principal';
import staffRoute from './staff.get';

const writeLog = vi.fn<(entry: Record<string, unknown>) => void>();
vi.mock('../log', () => ({ writeLog: (...args: unknown[]) => writeLog(...args) }));

// Khung enforcement giữ allow — subject của suite này là merge + degrade, không
// phải permission checkpoint (có spec riêng).
vi.mock('../authorization', () => ({
  requirePermission: async () => ({
    allowed: true,
    stale: false,
    denial: null,
    riskClass: 'normal',
  }),
}));

vi.mock('../db', () => ({
  readWorkerEnv: () => readEnv,
}));

// Pool `pg` giả trả một sổ staff cứng — query thật thuộc suite integration.
// ⚠️ `vi.mock` thay thế **toàn bộ** module: mọi export mà route import phải có
// mặt trong factory, kể cả `listStaff` (thiếu nó là TypeError ở route, bị
// `failClosedOnDatabaseError` nuốt thành 503 — đúng lỗi mà dòng này từng gây).
// Các hàm client account (`accountClientConfig`, `fetchAccountProfiles`) giữ
// bản **thật** qua `importOriginal` — mock chỉ nhắm phần pool/authorization;
// signing + validator thật là chủ đề unit suite của chính client trong lib.
vi.mock('@ecoma-io/backoffice-infrastructure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ecoma-io/backoffice-infrastructure')>();
  return {
    ...actual,
    backofficeHyperdrive: (env: unknown) =>
      (env as { DB_BACKOFFICE?: unknown })?.DB_BACKOFFICE ?? null,
    loadPrincipalAuthorization: async () => ({ assignments: [] }),
    listStaff: async (client: { query: (text: string) => Promise<{ rows: typeof STAFF_ROWS }> }) =>
      (await client.query('SELECT sub, status FROM backoffice.staff ORDER BY sub')).rows,
    withBackofficePool: async <T>(_hyperdrive: unknown, callback: (pool: unknown) => Promise<T>) =>
      callback({
        connect: async () => ({
          release: () => undefined,
          query: async (text: string) => {
            if (text.includes('FROM backoffice.staff')) {
              return { rows: STAFF_ROWS, rowCount: STAFF_ROWS.length };
            }
            return { rows: [], rowCount: 0 };
          },
        }),
      }),
  };
});

let readEnv: Record<string, unknown> = {};

const SUB_A = 'sub_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SUB_B = 'sub_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SECRET = 'unit-test-internal-secret-0123456789abcdef';

const STAFF_ROWS = [
  { sub: SUB_A, status: 'active' },
  { sub: SUB_B, status: 'suspended' },
];

/** Binding giả ghi lại URL được gọi để assert batch width. */
function fakeBinding(body: unknown): { fetch: ReturnType<typeof vi.fn> } {
  return {
    fetch: vi.fn<(input: Request) => Promise<Response>>(async (request: Request) => {
      // Bridge thật trả body bất kể path; assert nội dung request nằm ở test.
      void request;
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  };
}

async function get(): Promise<{ status: number; body: unknown }> {
  const app = createApp();
  app.use(
    defineEventHandler((event) => {
      event.context.cloudflare = { env: readEnv };
      event.context[PRINCIPAL_CONTEXT_KEY] = { actorSub: SUB_A };
    }),
  );
  const router = createRouter();
  router.get('/api/staff', staffRoute);
  app.use(router.handler);

  const response = await toWebHandler(app)(new Request('http://localhost/api/staff'));
  const text = await response.text();
  return {
    status: response.status,
    body: text.length === 0 ? null : (JSON.parse(text) as unknown),
  };
}

describe('GET /api/staff — displayName merge (#325)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDisplayNameCacheForTests();
    // Enforcement khung đòi binding `DB_BACKOFFICE` trong env (fail-closed 503
    // khi vắng) — mọi case ở đây đều có DB sống; biến số của suite là phần
    // `ACCOUNT_SERVICE`/`AUTH_INTERNAL_SECRET` của env.
    readEnv = { DB_BACKOFFICE: { connectionString: 'postgres://fake' } };
  });

  it('answers 200 with displayName null for every row when account is unconfigured', async () => {
    const { status, body } = await get();

    expect(status).toBe(200);
    expect(body).toEqual({
      staff: [
        { sub: SUB_A, status: 'active', displayName: null },
        { sub: SUB_B, status: 'suspended', displayName: null },
      ],
    });
    expect(writeLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'staff.account_degraded',
        reason: 'account_client_unconfigured',
      }),
    );
  });

  it('answers 200 with displayName null when the account call fails, and logs one degrade line', async () => {
    const binding = {
      fetch: vi.fn<() => Promise<Response>>(async () => {
        throw new Error('network down');
      }),
    };
    readEnv = {
      DB_BACKOFFICE: { connectionString: 'postgres://fake' },
      [ACCOUNT_SERVICE_BINDING_NAME]: binding,
      [AUTH_INTERNAL_SECRET_ENV]: SECRET,
    };

    const { status, body } = await get();

    expect(status).toBe(200);
    expect(body).toEqual({
      staff: [
        { sub: SUB_A, status: 'active', displayName: null },
        { sub: SUB_B, status: 'suspended', displayName: null },
      ],
    });
    expect(writeLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'staff.account_degraded', reason: 'unreachable' }),
    );
  });

  it('merges display names from a successful batch call', async () => {
    const binding = fakeBinding(
      accountProfilesResponse([
        { sub: SUB_A, displayName: 'Nguyễn Văn A' },
        { sub: SUB_B, displayName: null },
      ]),
    );
    readEnv = {
      DB_BACKOFFICE: { connectionString: 'postgres://fake' },
      [ACCOUNT_SERVICE_BINDING_NAME]: binding,
      [AUTH_INTERNAL_SECRET_ENV]: SECRET,
    };

    const { status, body } = await get();

    expect(status).toBe(200);
    expect(body).toEqual({
      staff: [
        { sub: SUB_A, status: 'active', displayName: 'Nguyễn Văn A' },
        { sub: SUB_B, status: 'suspended', displayName: null },
      ],
    });
    expect(writeLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'staff.account_degraded' }),
    );
  });

  it('asks only for subs missing from the cache, in one batch', async () => {
    const binding = fakeBinding(accountProfilesResponse([{ sub: SUB_B, displayName: 'B' }]));
    readEnv = {
      DB_BACKOFFICE: { connectionString: 'postgres://fake' },
      [ACCOUNT_SERVICE_BINDING_NAME]: binding,
      [AUTH_INTERNAL_SECRET_ENV]: SECRET,
    };

    // SUB_A đã có tên tươi trong cache — batch chỉ còn SUB_B.
    storeDisplayNames([{ sub: SUB_A, displayName: 'Cached' }], Date.now());

    const { status, body } = await get();

    expect(status).toBe(200);
    expect(body).toEqual({
      staff: [
        { sub: SUB_A, status: 'active', displayName: 'Cached' },
        { sub: SUB_B, status: 'suspended', displayName: 'B' },
      ],
    });
    const request = binding.fetch.mock.calls[0]?.[0] as Request;
    expect(request.url).toContain(`subs=${SUB_B}`);
    expect(request.url).not.toContain(`${SUB_A}`);
  });

  it('does not call account at all when every sub is cached', async () => {
    const binding = fakeBinding(accountProfilesResponse([]));
    readEnv = {
      DB_BACKOFFICE: { connectionString: 'postgres://fake' },
      [ACCOUNT_SERVICE_BINDING_NAME]: binding,
      [AUTH_INTERNAL_SECRET_ENV]: SECRET,
    };

    storeDisplayNames(
      [
        { sub: SUB_A, displayName: 'A' },
        { sub: SUB_B, displayName: 'B' },
      ],
      Date.now(),
    );

    const { status, body } = await get();

    expect(status).toBe(200);
    expect(body).toEqual({
      staff: [
        { sub: SUB_A, status: 'active', displayName: 'A' },
        { sub: SUB_B, status: 'suspended', displayName: 'B' },
      ],
    });
    expect(binding.fetch).not.toHaveBeenCalled();
  });

  it('treats a cached null as fresh — no re-fetch within the TTL', async () => {
    const binding = fakeBinding(
      accountProfilesResponse([
        { sub: SUB_A, displayName: null },
        { sub: SUB_B, displayName: null },
      ]),
    );
    readEnv = {
      DB_BACKOFFICE: { connectionString: 'postgres://fake' },
      [ACCOUNT_SERVICE_BINDING_NAME]: binding,
      [AUTH_INTERNAL_SECRET_ENV]: SECRET,
    };

    await get();
    expect(binding.fetch).toHaveBeenCalledTimes(1);

    // Lần đọc thứ hai trong TTL: null vẫn tươi, không batch thứ hai.
    await get();
    expect(binding.fetch).toHaveBeenCalledTimes(1);
  });
});
