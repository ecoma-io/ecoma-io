import { describe, expect, it } from 'vitest';

import { loadAuthConfig, type AuthConfig } from './config';
import { handleAuthorize, type AuthorizeQuery } from './browser-handlers';
import type { AuthStore, RegisteredClient } from '@ecoma-io/identity-auth-application';

/**
 * Unit cho glue `/authorize` — phần chọn `resource` theo client_id (registry
 * `AUTH_RESOURCES`). Các đường persistence thật (PostgreSQL, provider) thuộc
 * suite integration; ở đây chỉ khóa hình dạng mapping trong glue.
 */

/** Store stub: chỉ `findClient` được gọi trên đường begin — trả client public. */
function stubStore(clientId: string, matchAny = false): AuthStore {
  const client: RegisteredClient = {
    client_id: clientId,
    client_type: 'public',
    redirect_uris: ['https://rp.example.com/cb'],
    allowed_scopes: ['openid', 'offline_access'],
    isActive: true,
  };
  return {
    findTransactionByHandleX: async () => undefined,
    createTransaction: async () => undefined,
    transition: async () => true,
    insertAuthorizationCode: async () => undefined,
    findGrant: async () => undefined,
    findClient: async (id: string) => (matchAny || id === clientId ? client : undefined),
    checkRevocation: async () => 'not_revoked',
  };
}

async function makeConfig(): Promise<AuthConfig> {
  // PEM không được chạm: đường `handleAuthorize` chỉ dùng handle key + resources.
  // Khoá signing chỉ cần pass qua `loadAuthConfig` — một PEM PKCS#8 hợp lệ.
  const { exportPKCS8, generateKeyPair } = await import('jose');
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  const pem = await exportPKCS8(privateKey);
  return await loadAuthConfig({
    HYPERDRIVE: { connectionString: 'hyperdrive-internal-placeholder' },
    ACCOUNT_SERVICE: { fetch: async () => new Response('{}') },
    AUTH_SIGNING_KEY: pem,
    AUTH_SIGNING_KEY_ID: 'kid-browser-handlers',
    AUTH_HANDLE_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    AUTH_HANDLE_KEY_VERSION: '1',
    AUTH_INTERNAL_SECRET: 'internal-secret-test',
    AUTH_ISSUER: 'https://auth.ecoma.io',
    AUTH_AUDIENCE: 'https://api.ecoma.io',
    AUTH_RESOURCES: JSON.stringify([
      { audience: 'https://api.ecoma.io', clientIds: [] },
      { audience: 'https://backoffice.ecoma.io', clientIds: ['backoffice'] },
    ]),
    AUTH_COOKIE_KEYS: 'test-cookie-key-1',
    AUTH_ACCOUNT_BASE_URL: 'https://account.ecoma.io',
  });
}

function baseQuery(clientId: string | string[]): AuthorizeQuery {
  const challenge = 'a'.repeat(43);
  return {
    response_type: 'code',
    // Ghi đè kiểu của AuthorizeQuery: đây chính là ca "query lặp tham số"
    // mà glue phải chuẩn hoá.
    client_id: clientId as string,
    redirect_uri: 'https://rp.example.com/cb',
    scope: 'openid offline_access',
    state: 'st-1',
    nonce: 'n-1',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  };
}

describe('handleAuthorize — resource selection by client_id', () => {
  it('maps a plain-string client_id to its registered audience', async () => {
    const config = await makeConfig();
    const response = await handleAuthorize({
      config,
      store: stubStore('backoffice'),
      query: baseQuery('backoffice'),
      cookieHeader: undefined,
      now: new Date(),
    });
    expect(response.status).toBe(302);
    const target = new URL(response.headers.get('location') as string);
    expect(target.searchParams.get('resource')).toBe('https://backoffice.ecoma.io');
  });

  it('falls back to the primary audience for an unmapped client', async () => {
    const config = await makeConfig();
    const response = await handleAuthorize({
      config,
      store: stubStore('other-client'),
      query: baseQuery('other-client'),
      cookieHeader: undefined,
      now: new Date(),
    });
    expect(response.status).toBe(302);
    const target = new URL(response.headers.get('location') as string);
    expect(target.searchParams.get('resource')).toBe('https://api.ecoma.io');
  });

  it('normalizes a repeated client_id (array) and maps via any candidate', async () => {
    // Hono `c.req.query()` trả `Record<string, string>` nhưng nguồn thật là
    // URLSearchParams — glue phải tự phòng ca mảng. Array-form candidate là
    // một chính sách phòng thủ, KHÔNG phải hợp đồng của hono.
    const config = await makeConfig();
    // beginAuthorization nhận raw `client_id` (chưa chuẩn hoá) rồi đẩy thẳng
    // vào `findClient`; stub so sánh chuỗi sẽ không khớp mảng. Test này nhắm
    // vào mapping resource, không phải resolution client ⇒ `matchAny` để đường
    // chạy đi tới được phần glue cần khóa.
    const response = await handleAuthorize({
      config,
      store: stubStore('backoffice', true),
      query: baseQuery(['unknown-client', 'backoffice'] as unknown as string),
      cookieHeader: undefined,
      now: new Date(),
    });
    expect(response.status).toBe(302);
    const target = new URL(response.headers.get('location') as string);
    expect(target.searchParams.get('resource')).toBe('https://backoffice.ecoma.io');
  });
});
