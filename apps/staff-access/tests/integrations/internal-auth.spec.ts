import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signRequest } from '@ecoma-io/internal-auth-contracts';
import { buildApp, resetCachedConfig } from '../../src/main';
import { type StaffAccessDatabase, startStaffAccessDatabase } from './harness.ts';

describe('internal HMAC envelope authentication', () => {
  let db: StaffAccessDatabase;
  beforeAll(async () => {
    db = await startStaffAccessDatabase();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  it('enforces missing, invalid, valid, and replayed envelopes at the management boundary', async () => {
    resetCachedConfig();
    const app = buildApp();
    const env = {
      DB_STAFF_ACCESS: {
        connectionString: `postgresql://ecoma_staff_access_runtime:${db.rolePassword}@${db.host}:${db.port}/db-staff-access`,
      },
      AUTH_INTERNAL_SECRET: 'endpoint-internal-secret',
    };
    const body = JSON.stringify({ id: '00000000-0000-0000-0000-000000000001' });
    const common = {
      method: 'POST',
      path: '/assignments/revoke',
      body: new TextEncoder().encode(body),
      secret: env.AUTH_INTERNAL_SECRET,
      timestamp: String(Math.floor(Date.now() / 1000)),
      nonce: `endpoint-valid-${crypto.randomUUID()}`,
    } as const;
    expect((await app.request('/assignments/revoke', { method: 'POST', body }, env)).status).toBe(
      401,
    );
    const invalid = {
      ...(await signRequest({ ...common, nonce: `endpoint-invalid-${crypto.randomUUID()}` })),
      'x-ecoma-internal-signature': 'v1=invalid',
    };
    expect(
      (await app.request('/assignments/revoke', { method: 'POST', body, headers: invalid }, env))
        .status,
    ).toBe(401);
    const signed = await signRequest(common);
    const valid = await app.request(
      '/assignments/revoke',
      { method: 'POST', body, headers: signed },
      env,
    );
    expect(valid.status).toBe(404);
    const replay = await app.request(
      '/assignments/revoke',
      { method: 'POST', body, headers: signed },
      env,
    );
    expect(replay.status).toBe(401);
  });
});
