import { ACR } from '../authentication/acr';
import { BrowserSession } from './browser-session';
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

describe('browserSession guards (adversarial fixes)', () => {
  it('rejects authenticated sessions beyond the absolute TTL', () => {
    expect.hasAssertions();
    const s = anonymous({ ttlSeconds: 12 * 3600 });
    expect(
      s.authenticate(ACR.EmailOtp, NOW + 1000, { extendsTtlSeconds: 8 * 24 * 3600 }),
    ).toMatchObject({
      code: 'session_expired',
    });
  });

  it('kind() reflects origin even after revoke', () => {
    expect.hasAssertions();
    const anon = anonymous();
    anon.revoke(NOW + 100);
    expect(anon.kind()).toBe('anonymous');
    const auth = authenticated();
    auth.revoke(NOW + 100);
    expect(auth.kind()).toBe('authenticated');
  });

  it('reconstitute rejects revokedAt/state mismatch', () => {
    expect.hasAssertions();
    const base = authenticated().snapshot();
    expect(() =>
      BrowserSession.reconstitute({ ...base, revokedAt: NOW, state: 'anonymous' }),
    ).toThrow(TypeError);
    expect(() =>
      BrowserSession.reconstitute({ ...base, revokedAt: null, state: 'revoked' }),
    ).toThrow(TypeError);
  });

  it('reconstitute rejects NaN timestamps and a garbage acr (adversarial fixes)', () => {
    expect.hasAssertions();
    const base = authenticated().snapshot();
    expect(() => BrowserSession.reconstitute({ ...base, createdAt: Number.NaN })).toThrow(
      TypeError,
    );
    expect(() => BrowserSession.reconstitute({ ...base, expiresAt: Number.NaN })).toThrow(
      TypeError,
    );
    expect(() =>
      BrowserSession.reconstitute({ ...base, acr: 'garbage' as typeof base.acr }),
    ).toThrow(TypeError);
    expect(() => BrowserSession.reconstitute({ ...base, authnAt: base.expiresAt + 1000 })).toThrow(
      TypeError,
    );
  });

  it('rotate clamps idle TTL to the inherited absolute expiry', () => {
    expect.hasAssertions();
    const old = authenticated(),
      // Phiên cũ có mốc tuyệt đối gần: idle TTL 12h bị clamp về mốc, không throw.
      base = old.snapshot(),
      aged = BrowserSession.reconstitute({
        ...base,
        absoluteExpiresAt: NOW + 2000,
        createdAt: NOW,
        expiresAt: NOW + 1000,
        sessionRef: 'ref-aged' as SessionRef,
      }),
      next = BrowserSession.rotate(aged, {
        newSessionRef: REF2,
        now: NOW + 500,
        ttlSeconds: 12 * 3600,
      });
    expect((next as BrowserSession).expiresAt()).toBe(NOW + 2000);
    // Phiên cũ vẫn bị revoke bình thường (constructor phiên mới không throw).
    expect(aged.state()).toBe('revoked');
  });

  it('rotation inherits the absolute expiry and clamps idle TTL to it', () => {
    expect.hasAssertions();
    const old = authenticated(),
      next = BrowserSession.rotate(old, {
        newSessionRef: REF2,
        now: NOW + 2000,
        ttlSeconds: 12 * 3600,
      }),
      n = next as BrowserSession;
    expect(n.absoluteExpiresAt()).toBe(old.absoluteExpiresAt());
    expect(n.expiresAt()).toBeLessThanOrEqual(old.absoluteExpiresAt() ?? 0);
  });

  it('absolute expiry does not extend across a rotation chain', () => {
    expect.hasAssertions();
    let s = authenticated();
    const originalAbsolute = s.absoluteExpiresAt();
    let ref: SessionRef = REF2;
    for (let i = 0; i < 5; i += 1) {
      const next = BrowserSession.rotate(s, { newSessionRef: ref, now: s.expiresAt() - 1000 });
      if (typeof next !== 'object' || !('sessionRef' in next)) {
        throw new Error('rotate failed');
      }
      s = next;
      ref = `r-${i}` as SessionRef;
    }
    expect(s.absoluteExpiresAt()).toBe(originalAbsolute);
  });
});

describe('browserSession reconstitute: absoluteExpiresAt guards', () => {
  it('rejects an authenticated snapshot without absoluteExpiresAt', () => {
    expect.hasAssertions();
    const base = authenticated().snapshot();
    expect(() => BrowserSession.reconstitute({ ...base, absoluteExpiresAt: null })).toThrow(
      TypeError,
    );
  });

  it('rejects absoluteExpiresAt before createdAt', () => {
    expect.hasAssertions();
    const base = authenticated().snapshot();
    expect(() =>
      BrowserSession.reconstitute({ ...base, absoluteExpiresAt: base.createdAt - 1 }),
    ).toThrow(TypeError);
  });

  it('reconstitute rejects an empty sessionRef', () => {
    expect.hasAssertions();
    const base = authenticated().snapshot();
    expect(() => BrowserSession.reconstitute({ ...base, sessionRef: '' as SessionRef })).toThrow(
      TypeError,
    );
  });

  it('reconstitute rejects an anonymous snapshot carrying an absoluteExpiresAt', () => {
    expect.hasAssertions();
    const base = anonymous().snapshot();
    expect(() =>
      BrowserSession.reconstitute({ ...base, absoluteExpiresAt: base.createdAt + 1000 }),
    ).toThrow(TypeError);
  });

  it('reconstitute rejects a revoked snapshot without absoluteExpiresAt', () => {
    expect.hasAssertions();
    const base = authenticated().snapshot(),
      revoked = { ...base, revokedAt: NOW + 5000, state: 'revoked' as const };
    expect(() => BrowserSession.reconstitute({ ...revoked, absoluteExpiresAt: null })).toThrow(
      TypeError,
    );
  });

  it('reconstitute rejects a non-finite or pre-createdAt revokedAt', () => {
    expect.hasAssertions();
    const base = authenticated().snapshot(),
      revoked = { ...base, revokedAt: NOW + 5000, state: 'revoked' as const };
    expect(() => BrowserSession.reconstitute({ ...revoked, revokedAt: Number.NaN })).toThrow(
      TypeError,
    );
    expect(() =>
      BrowserSession.reconstitute({ ...revoked, revokedAt: base.createdAt - 1 }),
    ).toThrow(TypeError);
  });

  it('reconstitute accepts a revoked anonymous session without absoluteExpiresAt', () => {
    expect.hasAssertions();
    const base = anonymous().snapshot(),
      restored = BrowserSession.reconstitute({
        ...base,
        absoluteExpiresAt: null,
        revokedAt: NOW + 100,
        state: 'revoked' as const,
      });
    expect(restored.state()).toBe('revoked');
    expect(restored.kind()).toBe('anonymous');
    expect(restored.absoluteExpiresAt()).toBeNull();
  });
});
