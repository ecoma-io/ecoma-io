import { ACR } from '../authentication/acr';
import { BROWSER_SESSION_TRANSITIONS, BrowserSession } from './browser-session';
import type { SessionRef } from './browser-session';

const NOW = 1_700_000_000_000,
  REF = 'ref-1' as SessionRef,
  REF2 = 'ref-2' as SessionRef;

function anonymous(overrides?: { now?: number; ttlSeconds?: number }): BrowserSession {
  return BrowserSession.startAnonymous({
    now: overrides?.now ?? NOW,
    sessionRef: REF,
    ttlSeconds: overrides?.ttlSeconds,
  });
}

function authenticated(args?: { now?: number }): BrowserSession {
  const s = anonymous({ ttlSeconds: 12 * 3600 });
  s.authenticate(ACR.EmailOtp, args?.now ?? NOW + 1000, { extendsTtlSeconds: 12 * 3600 });
  return s;
}

describe('browserSession.startAnonymous', () => {
  it('starts anonymous with 600s default TTL and no evidence', () => {
    expect.hasAssertions();
    const s = anonymous();
    expect(s.state()).toBe('anonymous');
    expect(s.kind()).toBe('anonymous');
    expect(s.acr()).toBeNull();
    expect(s.authnAt()).toBeNull();
    expect(s.expiresAt()).toBe(NOW + 600 * 1000);
    expect(s.isLive(NOW)).toBe(true);
  });
});

describe('browserSession pair invariant', () => {
  it('reconstitute rejects acr without authnAt (and vice versa)', () => {
    expect.hasAssertions();
    const base = authenticated().snapshot();
    expect(() => BrowserSession.reconstitute({ ...base, authnAt: null })).toThrow(TypeError);
    expect(() => BrowserSession.reconstitute({ ...base, acr: null })).toThrow(TypeError);
  });

  it('rejects expiresAt <= createdAt', () => {
    expect.hasAssertions();
    expect(() =>
      BrowserSession.startAnonymous({ now: NOW, sessionRef: REF, ttlSeconds: 0 }),
    ).toThrow(TypeError);
  });
});

describe('browserSession.authenticate', () => {
  it('anonymous → authenticated, pair set together', () => {
    expect.hasAssertions();
    const s = anonymous();
    s.authenticate(ACR.EmailOtp, NOW + 1000, { extendsTtlSeconds: 12 * 3600 });
    expect(s.state()).toBe('authenticated');
    expect(s.acr()).toBe(ACR.EmailOtp);
    expect(s.authnAt()).toBe(NOW + 1000);
  });

  it('cannot authenticate twice', () => {
    expect.hasAssertions();
    const s = authenticated();
    expect(s.authenticate(ACR.EmailOtp, NOW + 2000)).toMatchObject({ code: 'invalid_transition' });
  });

  it('cannot authenticate a revoked session', () => {
    expect.hasAssertions();
    const s = anonymous();
    s.revoke(NOW);
    expect(s.authenticate(ACR.EmailOtp, NOW + 1000)).toMatchObject({ code: 'invalid_transition' });
  });
});

describe('browserSession.revoke — idempotent', () => {
  it('revokes once, keeps first revokedAt', () => {
    expect.hasAssertions();
    const s = authenticated();
    s.revoke(NOW + 1000);
    s.revoke(NOW + 2000);
    expect(s.revokedAt()).toBe(NOW + 1000);
    expect(s.state()).toBe('revoked');
    expect(s.isLive(NOW + 3000)).toBeFalsy();
  });
});

describe('browserSession.rotate', () => {
  it('revokes old, issues new carrying evidence and rotatedFrom', () => {
    expect.hasAssertions();
    const old = authenticated(),
      next = BrowserSession.rotate(old, { newSessionRef: REF2, now: NOW + 2000 });
    expect(old.state()).toBe('revoked');
    expect((next as BrowserSession).sessionRef()).toBe(REF2);
    expect((next as BrowserSession).rotatedFrom()).toBe(REF);
    expect((next as BrowserSession).acr()).toBe(ACR.EmailOtp);
    expect((next as BrowserSession).isLive(NOW + 2000)).toBe(true);
  });

  it('rejects rotation of a non-authenticated session', () => {
    expect.hasAssertions();
    const s = anonymous();
    expect(BrowserSession.rotate(s, { newSessionRef: REF2, now: NOW + 100 })).toMatchObject({
      code: 'invalid_transition',
    });
  });

  it('rejects rotation of a dead session', () => {
    expect.hasAssertions();
    const s = authenticated();
    s.revoke(NOW + 100);
    expect(BrowserSession.rotate(s, { newSessionRef: REF2, now: NOW + 200 })).toMatchObject({
      code: 'invalid_transition',
    });
  });
});

describe('browserSession.expiry', () => {
  it('isLive dies at the exact expiry boundary', () => {
    expect.hasAssertions();
    const s = anonymous(),
      atExpiry = s.expiresAt();
    expect(s.isLive(atExpiry - 1)).toBe(true);
    expect(s.isLive(atExpiry)).toBeFalsy();
  });
});

describe('browserSession.requiresReauthentication', () => {
  const rule = { maxAgeSeconds: 300, requiredAcr: ACR.EmailOtp };

  it('anonymous session always requires re-auth', () => {
    expect.hasAssertions();
    expect(anonymous().requiresReauthentication(rule, NOW + 100)).toBe(true);
  });

  it('fresh authenticated session does not', () => {
    expect.hasAssertions();
    const s = authenticated({ now: NOW + 1000 });
    expect(s.requiresReauthentication(rule, NOW + 1500)).toBeFalsy();
  });

  it('stale evidence requires re-auth', () => {
    expect.hasAssertions();
    const s = authenticated({ now: NOW + 1000 });
    expect(s.requiresReauthentication(rule, NOW + 1000 + 301_000)).toBe(true);
  });

  it('insufficient ACR requires re-auth', () => {
    expect.hasAssertions();
    const s = authenticated();
    expect(
      s.requiresReauthentication({ maxAgeSeconds: 300, requiredAcr: ACR.Mfa }, NOW + 1500),
    ).toBe(true);
  });
});

describe('browserSession.transition table', () => {
  it('matches the lifecycle', () => {
    expect.hasAssertions();
    expect(BROWSER_SESSION_TRANSITIONS.anonymous).toStrictEqual(['authenticated', 'revoked']);
    expect(BROWSER_SESSION_TRANSITIONS.authenticated).toStrictEqual(['revoked']);
    expect(BROWSER_SESSION_TRANSITIONS.revoked).toStrictEqual([]);
    expect('expired' in BROWSER_SESSION_TRANSITIONS).toBeFalsy();
  });
});

describe('browserSession.reconstitute + identity', () => {
  it('round-trips and equals by sessionRef', () => {
    expect.hasAssertions();
    const s = authenticated(),
      restored = BrowserSession.reconstitute(s.snapshot());
    expect(restored.equals(s)).toBe(true);
    expect(
      restored.equals(
        BrowserSession.startAnonymous({ now: NOW, sessionRef: 'other' as SessionRef }),
      ),
    ).toBeFalsy();
    expect(restored.equals('nope')).toBeFalsy();
  });

  it('rejects an unknown state', () => {
    expect.hasAssertions();
    const base = authenticated().snapshot();
    expect(() =>
      BrowserSession.reconstitute({ ...base, state: 'weird' as typeof base.state }),
    ).toThrow(TypeError);
  });
});

test('startAnonymous rejects an empty sessionRef', () => {
  expect.hasAssertions();
  expect(() => BrowserSession.startAnonymous({ now: NOW, sessionRef: '' as SessionRef })).toThrow(
    TypeError,
  );
});
