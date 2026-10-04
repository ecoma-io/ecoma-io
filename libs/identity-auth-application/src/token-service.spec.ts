import { decodeProtectedHeader, exportPKCS8, generateKeyPair, importJWK, jwtVerify } from 'jose';
import { expect, it, describe } from 'vitest';

import { SigningKeyProvider } from '@ecoma-io/identity-auth-domain';

import {
  JWT_SIGNING_ALG,
  DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
  MAX_ACCESS_TOKEN_TTL_SECONDS,
  assertAccessTokenTtl,
  buildJwks,
  createRefreshToken,
  issueAccessToken,
} from './token-service';

/** Sinh khoa that de test chay tren cung duong code voi production. */
async function makeSigningKey(): Promise<SigningKeyProvider> {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  const pem = await exportPKCS8(privateKey);
  return SigningKeyProvider.fromPem({ pem, kid: 'kid-test' });
}

describe('assertAccessTokenTtl — tran TTL la do tre thu hoi', () => {
  it('chap nhan TTL trong tran', () => {
    expect(() => assertAccessTokenTtl(300)).not.toThrow();
    expect(() => assertAccessTokenTtl(MAX_ACCESS_TOKEN_TTL_SECONDS)).not.toThrow();
  });

  it('TU CHOI TTL vuot tran — vi tran bang do tre thu hoi', () => {
    // Access token verify offline nen khong the thu hoi som. Mot TTL 24h
    // nghia la grant bi thu hoi van dung duoc 24h nua.
    expect(() => assertAccessTokenTtl(86400)).toThrow(/vuot tran|do tre thu hoi/u);
  });

  it('TU CHOI TTL khong duong hoac khong nguyen', () => {
    expect(() => assertAccessTokenTtl(0)).toThrow(/nguyen duong/u);
    expect(() => assertAccessTokenTtl(-1)).toThrow(/nguyen duong/u);
    expect(() => assertAccessTokenTtl(1.5)).toThrow(/nguyen duong/u);
  });
});

describe('createRefreshToken — opaque, chi luu ban bam', () => {
  it('plaintext va hash KHAC nhau, va hash khong chua plaintext', async () => {
    const token = await createRefreshToken({ familyId: 'fam-1' });

    // Bat bien quan trong nhat: ban luu KHONG duoc la ban dung. Neu hash ===
    // plaintext thi mot lan doc bang la mot lan mao danh duoc moi phien.
    expect(token.hash).not.toBe(token.plaintext);
    expect(token.hash).not.toContain(token.plaintext);
    expect(token.plaintext).not.toContain(token.hash);
  });

  it('hai lan sinh cho plaintext khac nhau', async () => {
    const a = await createRefreshToken({ familyId: 'fam-1' });
    const b = await createRefreshToken({ familyId: 'fam-1' });
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toBe(b.hash);
  });

  it('plaintext du entropy va dung charset base64url', async () => {
    const token = await createRefreshToken({ familyId: 'fam-1' });
    // 32 byte -> 43 ky tu base64url khong padding.
    expect(token.plaintext).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it('family id duoc giu nguyen de thu hoi ca ho', async () => {
    const token = await createRefreshToken({ familyId: 'fam-abc' });
    expect(token.familyId).toBe('fam-abc');
  });
});

describe('buildJwks — chi cong bo khoa cong khai', () => {
  it('khong bao gio chua truong `d`', () => {
    // Bat bien cua JWKS. Mot truong `d` trong response cong khai la mot lan ro
    // private key ra internet.
    const jwks = buildJwks([
      { kty: 'EC', crv: 'P-256', x: 'aaa', y: 'bbb', alg: 'ES256', use: 'sig', kid: 'k1' },
    ]);

    expect(jwks.keys).toHaveLength(1);
    for (const key of jwks.keys) {
      expect(key).not.toHaveProperty('d');
      expect(Object.keys(key).toSorted()).toEqual(['alg', 'crv', 'kid', 'kty', 'use', 'x', 'y']);
    }
  });
});

describe('issueAccessToken — ky ES256, claims day du', () => {
  it('token verify duoc bang public key tu JWKS — tuc la offline validation', async () => {
    const signingKey = await makeSigningKey();
    // ⚠️ Dung thoi gian THAT, khong truyen `currentDate` cho `jwtVerify`. Mot
    // moc thoi gian gia se khien test kiem tra duong `jwtVerify` da bi goi
    // loi — va do la thu duy nhat no dang kiem. Truyen `now` gia vao day thi
    // test chi con chung minh rang ta biet cach truyen tham so.
    const now = new Date();
    const nowSeconds = Math.floor(now.getTime() / 1000);

    const token = await issueAccessToken({
      signingKey,
      claims: {
        sub: 'account-1',
        aud: 'https://api.ecoma.io',
        iss: 'https://auth.ecoma.io',
        iat: nowSeconds,
        nbf: nowSeconds,
        exp: nowSeconds + DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
        client_id: 'client-1',
        scope: 'openid profile',
        transaction_id: 'tx-1',
      },
    });

    // Verify CHI bang public JWK — khong goi auth, khong doc database. Day
    // chinh la tinh chat khien token dung duoc o resource server.
    const jwk = await signingKey.publicJwk();
    const publicKey = await importJWK(jwk, JWT_SIGNING_ALG);
    const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
      issuer: 'https://auth.ecoma.io',
      audience: 'https://api.ecoma.io',
    });

    expect(payload.sub).toBe('account-1');
    expect(payload['client_id']).toBe('client-1');
    expect(protectedHeader.alg).toBe(JWT_SIGNING_ALG);
  });

  it('header co `kid` de chon dung khoa trong JWKS khi xoay khoa', async () => {
    const signingKey = await makeSigningKey();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await issueAccessToken({
      signingKey,
      claims: {
        sub: 'account-1',
        aud: 'https://api.ecoma.io',
        iss: 'https://auth.ecoma.io',
        iat: nowSeconds,
        nbf: nowSeconds,
        exp: nowSeconds + 300,
        client_id: 'client-1',
        scope: 'openid',
        transaction_id: 'tx-1',
      },
    });

    const header = decodeProtectedHeader(token);
    expect(header.kid).toBe('kid-test');
    // `at+jwt` (RFC 9068) de resource server phan biet voi id token — khong co
    // no thi mot id token co the bi dung nhu access token.
    expect(header.typ).toBe('at+jwt');
  });

  it('TU CHOI ky mot token co TTL vuot tran', async () => {
    const signingKey = await makeSigningKey();
    const nowSeconds = Math.floor(Date.now() / 1000);
    await expect(
      issueAccessToken({
        signingKey,
        claims: {
          sub: 'account-1',
          aud: 'https://api.ecoma.io',
          iss: 'https://auth.ecoma.io',
          iat: nowSeconds,
          nbf: nowSeconds,
          exp: nowSeconds + 86400,
          client_id: 'client-1',
          scope: 'openid',
          transaction_id: 'tx-1',
        },
      }),
    ).rejects.toThrow(/vuot tran|do tre thu hoi/u);
  });
});
