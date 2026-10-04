import { describe, expect, it } from 'vitest';

import {
  assertValidCodeVerifier,
  computeS256Challenge,
  parseCodeChallenge,
  verifyCodeChallenge,
} from './pkce';
import { OAuthProtocolError } from './errors';

/** Verifier hợp lệ theo RFC 7636: 43 ký tự trong bảng ký tự cho phép. */
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

describe('parseCodeChallenge', () => {
  it('chap nhan S256 voi challenge 43 ky tu', () => {
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    const parsed = parseCodeChallenge({ codeChallenge: challenge, codeChallengeMethod: 'S256' });
    expect(parsed.codeChallenge).toBe(challenge);
    expect(parsed.codeChallengeMethod).toBe('S256');
  });

  it('tu choi plain (FR-010 / AC-007)', () => {
    // PKCE downgrade sang plain la T-03.
    expect(() =>
      parseCodeChallenge({ codeChallenge: VERIFIER, codeChallengeMethod: 'plain' }),
    ).toThrow(OAuthProtocolError);
  });

  it('tu choi thieu code_challenge_method — khong co mac dinh', () => {
    // Mac dinh ngam la duong downgrade: client cu khong gui method, server cho qua.
    expect(() =>
      parseCodeChallenge({ codeChallenge: VERIFIER, codeChallengeMethod: undefined }),
    ).toThrow(/thieu code_challenge_method/u);
  });

  it('tu choi thieu code_challenge', () => {
    expect(() =>
      parseCodeChallenge({ codeChallenge: undefined, codeChallengeMethod: 'S256' }),
    ).toThrow(/thieu code_challenge/u);
  });

  it('tu choi challenge sai do dai (khong phai 43 ky tu)', () => {
    expect(() => parseCodeChallenge({ codeChallenge: 'abc', codeChallengeMethod: 'S256' })).toThrow(
      /khong dung dinh dang S256/u,
    );
  });

  it('tu choi challenge co padding base64', () => {
    expect(() =>
      parseCodeChallenge({ codeChallenge: `${'a'.repeat(42)}=`, codeChallengeMethod: 'S256' }),
    ).toThrow(/khong dung dinh dang S256/u);
  });
});

describe('computeS256Challenge / verifyCodeChallenge', () => {
  it('khop voi vector kiem chung RFC 7636 appendix B', async () => {
    // Vector chinh thuc cua RFC: verifier -> challenge.
    const challenge = await computeS256Challenge(VERIFIER);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('verifier dung challenge da luu: khop', async () => {
    const challenge = await computeS256Challenge(VERIFIER);
    await expect(
      verifyCodeChallenge({ codeVerifier: VERIFIER, expectedChallenge: challenge }),
    ).resolves.toBe(true);
  });

  it('verifier sai: khong khop', async () => {
    const challenge = await computeS256Challenge(VERIFIER);
    await expect(
      verifyCodeChallenge({
        codeVerifier: 'yWjZS1sT2FT1RSW1Z1Y1d3R4yWjZS1sT2FT1RSWQ',
        expectedChallenge: challenge,
      }),
    ).resolves.toBe(false);
  });

  it('challenge dung 43 ky tu base64url khong padding', async () => {
    const challenge = await computeS256Challenge(VERIFIER);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });
});

describe('assertValidCodeVerifier', () => {
  it('chap nhan verifier 43 ky tu', () => {
    expect(() => assertValidCodeVerifier(VERIFIER)).not.toThrow();
  });

  it('chap nhan verifier 128 ky tu', () => {
    expect(() => assertValidCodeVerifier('a'.repeat(128))).not.toThrow();
  });

  it('tu choi verifier ngan hon 43', () => {
    expect(() => assertValidCodeVerifier('a'.repeat(42))).toThrow(OAuthProtocolError);
  });

  it('tu choi verifier dai hon 128', () => {
    expect(() => assertValidCodeVerifier('a'.repeat(129))).toThrow(OAuthProtocolError);
  });

  it('tu choi ky tu ngoai bang charset RFC 7636', () => {
    // '+' va '/' la base64 chuan, khong thuocc [A-Za-z0-9-._~].
    expect(() => assertValidCodeVerifier(`${'a'.repeat(42)}+`)).toThrow(OAuthProtocolError);
    expect(() => assertValidCodeVerifier(`${'a'.repeat(42)}/`)).toThrow(OAuthProtocolError);
    expect(() => assertValidCodeVerifier(`${'a'.repeat(42)}=`)).toThrow(OAuthProtocolError);
  });

  it('tu choi verifier rong', () => {
    expect(() => assertValidCodeVerifier('')).toThrow(OAuthProtocolError);
  });
});
