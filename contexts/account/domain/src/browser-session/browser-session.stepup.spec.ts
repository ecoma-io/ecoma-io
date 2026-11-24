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

describe('browserSession.stepUp', () => {
  it('email-otp → mfa keeps claims and does not move the absolute expiry', () => {
    expect.hasAssertions();
    const s = anonymous({ ttlSeconds: 12 * 3600 });
    s.authenticate(ACR.EmailOtp, NOW + 1000, { extendsTtlSeconds: 12 * 3600 });
    const absoluteBefore = s.absoluteExpiresAt();
    expect(s.stepUp('totp', NOW + 5000)).toBeUndefined();
    expect(s.acr()).toBe(ACR.Mfa);
    expect(s.authnAt()).toBe(NOW + 5000);
    expect(s.absoluteExpiresAt()).toBe(absoluteBefore);
    // Claim cũ không mất: email-otp vẫn thỏa mãn qua tập (membership model).
    expect(
      s.requiresReauthentication({ maxAgeSeconds: 300, requiredAcr: ACR.EmailOtp }, NOW + 6000),
    ).toBeFalsy();
  });

  it('passkey second factor yields phishing-resistant ACR', () => {
    expect.hasAssertions();
    const s = anonymous();
    s.authenticate(ACR.EmailOtp, NOW + 1000);
    s.stepUp('passkey', NOW + 2000);
    expect(s.acr()).toBe(ACR.PhishingResistant);
    expect(
      s.requiresReauthentication({ maxAgeSeconds: 300, requiredAcr: ACR.Mfa }, NOW + 3000),
    ).toBeFalsy();
  });

  it('rejects step-up on an anonymous or revoked session', () => {
    expect.hasAssertions();
    const anon = anonymous();
    expect(anon.stepUp('totp', NOW + 100)).toMatchObject({ code: 'invalid_transition' });
    const auth = anonymous();
    auth.authenticate(ACR.EmailOtp, NOW + 1000);
    auth.revoke(NOW + 1500);
    // Revoked ⇒ state ≠ authenticated → invalid_transition (state guard trước).
    expect(auth.stepUp('totp', NOW + 2000)).toMatchObject({ code: 'invalid_transition' });
  });

  it('rejects step-up that would push expiry beyond the absolute expiry', () => {
    expect.hasAssertions();
    const s = anonymous();
    s.authenticate(ACR.EmailOtp, NOW + 1000);
    expect(s.stepUp('totp', NOW + 5000, { extendsTtlSeconds: 8 * 24 * 3600 })).toMatchObject({
      code: 'session_expired',
    });
  });

  it('rejects non-finite authnAt', () => {
    expect.hasAssertions();
    const s = anonymous();
    s.authenticate(ACR.EmailOtp, NOW + 1000);
    expect(s.stepUp('totp', Number.NaN)).toMatchObject({ code: 'invalid_transition' });
  });

  it('requiresReauthentication rejects stale evidence even with sufficient ACR', () => {
    expect.hasAssertions();
    const s = anonymous();
    s.authenticate(ACR.EmailOtp, NOW + 1000);
    s.stepUp('totp', NOW + 2000);
    expect(
      s.requiresReauthentication(
        { maxAgeSeconds: 300, requiredAcr: ACR.Mfa },
        NOW + 2000 + 301_000,
      ),
    ).toBe(true);
  });

  it('stepUp totp on a passkey session is rejected (no claim downgrade)', () => {
    expect.hasAssertions();
    const s = anonymous();
    s.authenticate(ACR.EmailOtp, NOW + 1000);
    s.stepUp('passkey', NOW + 2000);
    expect(s.acr()).toBe(ACR.PhishingResistant);
    expect(s.stepUp('totp', NOW + 3000)).toMatchObject({ code: 'invalid_transition' });
    expect(s.acr()).toBe(ACR.PhishingResistant);
  });

  it('stepUp totp twice on an mfa session is a no-op-success (same set)', () => {
    expect.hasAssertions();
    const s = anonymous();
    s.authenticate(ACR.EmailOtp, NOW + 1000);
    s.stepUp('totp', NOW + 2000);
    expect(s.stepUp('totp', NOW + 3000)).toBeUndefined();
    expect(s.acr()).toBe(ACR.Mfa);
    expect(s.authnAt()).toBe(NOW + 3000);
  });

  it('stepUp rejects an invalid second factor without mutating', () => {
    expect.hasAssertions();
    const s = anonymous();
    s.authenticate(ACR.EmailOtp, NOW + 1000);
    expect(s.stepUp('garbage' as never, NOW + 2000)).toMatchObject({
      code: 'invalid_transition',
    });
    expect(s.acr()).toBe(ACR.EmailOtp);
    expect(s.authnAt()).toBe(NOW + 1000);
  });

  it('stepUp rejects non-finite or non-positive extendsTtlSeconds without mutation', () => {
    expect.hasAssertions();
    const s = anonymous({ ttlSeconds: 12 * 3600 });
    s.authenticate(ACR.EmailOtp, NOW + 1000, { extendsTtlSeconds: 12 * 3600 });
    expect(s.stepUp('totp', NOW + 2000, { extendsTtlSeconds: Number.NaN })).toMatchObject({
      code: 'invalid_transition',
    });
    expect(s.acr()).toBe(ACR.EmailOtp);
    expect(s.expiresAt()).toBe(NOW + 1000 + 12 * 3600 * 1000);
  });
});

describe('browserSession authenticate guards', () => {
  it('authenticate rejects a garbage acr at the behavior entry', () => {
    expect.hasAssertions();
    const s = anonymous();
    expect(s.authenticate('garbage' as never, NOW + 1000)).toMatchObject({
      code: 'invalid_transition',
    });
  });

  it('authenticate rejects non-finite authnAt', () => {
    expect.hasAssertions();
    const s = anonymous();
    expect(s.authenticate(ACR.EmailOtp, Number.NaN)).toMatchObject({
      code: 'invalid_transition',
    });
  });

  it('authenticate rejects mfa/phishing-resistant as initial authentication (no escalation)', () => {
    expect.hasAssertions();
    const s = anonymous();
    expect(s.authenticate(ACR.Mfa, NOW + 1000)).toMatchObject({ code: 'invalid_transition' });
    expect(s.authenticate(ACR.PhishingResistant, NOW + 1000)).toMatchObject({
      code: 'invalid_transition',
    });
    expect(s.state()).toBe('anonymous');
    expect(s.acr()).toBeNull();
  });

  it('authenticate defaults idle TTL to 12h (not the 600s anonymous TTL)', () => {
    expect.hasAssertions();
    const s = anonymous();
    expect(s.authenticate(ACR.EmailOtp, NOW + 1000)).toBeUndefined();
    expect(s.expiresAt()).toBe(NOW + 1000 + 12 * 3600 * 1000);
  });

  it('authenticate/stepUp reject non-finite or non-positive extendsTtlSeconds without mutation', () => {
    expect.hasAssertions();
    const s = anonymous({ ttlSeconds: 12 * 3600 });
    expect(
      s.authenticate(ACR.EmailOtp, NOW + 1000, { extendsTtlSeconds: Number.NaN }),
    ).toMatchObject({
      code: 'invalid_transition',
    });
    expect(s.state()).toBe('anonymous');
    expect(s.authenticate(ACR.EmailOtp, NOW + 1000, { extendsTtlSeconds: 0 })).toMatchObject({
      code: 'invalid_transition',
    });
    expect(s.authenticate(ACR.EmailOtp, NOW + 1000)).toBeUndefined();
    expect(s.expiresAt()).toBe(NOW + 1000 + 12 * 3600 * 1000);
  });

  it('authenticate on a session dead from TTL reports session_expired, not session_revoked', () => {
    expect.hasAssertions();
    const s = anonymous({ ttlSeconds: 100 });
    expect(s.authenticate(ACR.EmailOtp, NOW + 100_000)).toMatchObject({ code: 'session_expired' });
    // Revoked: state guard (anonymous check) ăn trước → invalid_transition;
    // Phân biệt revoked/expired ở đây là qua isLive, không qua authenticate.
    const r = anonymous({ ttlSeconds: 100 });
    r.revoke(NOW + 50);
    expect(r.authenticate(ACR.EmailOtp, NOW + 60)).toMatchObject({ code: 'invalid_transition' });
  });
});

describe('browserSession rotate/revoke/isLive guards', () => {
  it('rotate rejects a non-finite now or an empty newSessionRef', () => {
    expect.hasAssertions();
    const old = BrowserSession.startAnonymous({
      now: NOW,
      sessionRef: REF,
      ttlSeconds: 12 * 3600,
    });
    old.authenticate(ACR.EmailOtp, NOW + 1000, { extendsTtlSeconds: 12 * 3600 });
    expect(
      BrowserSession.rotate(old, { newSessionRef: '' as SessionRef, now: NOW + 1000 }),
    ).toMatchObject({
      code: 'invalid_transition',
    });
    expect(old.state()).toBe('authenticated');
    expect(BrowserSession.rotate(old, { newSessionRef: REF2, now: Number.NaN })).toMatchObject({
      code: 'invalid_transition',
    });
    expect(old.state()).toBe('authenticated');
  });

  it('revoke with NaN now is a no-op (state unchanged)', () => {
    expect.hasAssertions();
    const s = anonymous();
    s.revoke(Number.NaN);
    expect(s.state()).toBe('anonymous');
    expect(s.revokedAt()).toBeNull();
  });

  it('isLive with a non-finite now is false (bad input is not live)', () => {
    expect.hasAssertions();
    const s = anonymous();
    expect(s.isLive(Number.NaN)).toBeFalsy();
    expect(s.isLive(Number.POSITIVE_INFINITY)).toBeFalsy();
  });
});
