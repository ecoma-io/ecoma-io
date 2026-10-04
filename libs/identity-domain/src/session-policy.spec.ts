import { describe, expect, it } from 'vitest';

import { AUTHN_LEVEL } from './authn-level';
import { isExpired, isFresh, isRevoked, requiresReauthentication } from './session-policy';

/** Mốc thời gian cố định cho mọi case — module này thuần, không đọc đồng hồ. */
const NOW = 1_700_000_000_000;
const SECOND = 1000;

describe('isExpired', () => {
  it('is false strictly before the expiry instant', () => {
    expect(isExpired({ expiresAt: NOW + 1 }, NOW)).toBe(false);
  });

  it('is true at exactly the expiry instant', () => {
    expect(isExpired({ expiresAt: NOW }, NOW)).toBe(true);
  });

  it('is true after the expiry instant', () => {
    expect(isExpired({ expiresAt: NOW - 1 }, NOW)).toBe(true);
  });

  it('ignores revocation when only measuring expiry', () => {
    expect(isExpired({ expiresAt: NOW + SECOND, revokedAt: NOW - SECOND }, NOW)).toBe(false);
  });
});

describe('isRevoked', () => {
  it('is false when never revoked', () => {
    expect(isRevoked({ expiresAt: NOW + SECOND }, NOW)).toBe(false);
  });

  it('is false when revokedAt is explicitly null', () => {
    expect(isRevoked({ expiresAt: NOW + SECOND, revokedAt: null }, NOW)).toBe(false);
  });

  it('is true once the revocation instant is reached', () => {
    expect(isRevoked({ expiresAt: NOW + SECOND, revokedAt: NOW }, NOW)).toBe(true);
  });

  it('is false before a future revocation instant', () => {
    expect(isRevoked({ expiresAt: NOW + SECOND, revokedAt: NOW + SECOND }, NOW)).toBe(false);
  });
});

describe('isFresh', () => {
  it('is true at exactly the max-age boundary', () => {
    expect(isFresh(NOW - 60 * SECOND, NOW, 60)).toBe(true);
  });

  it('is false one millisecond past the boundary', () => {
    expect(isFresh(NOW - 60 * SECOND - 1, NOW, 60)).toBe(false);
  });

  it('is true for an instant authentication', () => {
    expect(isFresh(NOW, NOW, 60)).toBe(true);
  });

  it('is false for evidence from the future', () => {
    expect(isFresh(NOW + 1, NOW, 60)).toBe(false);
  });

  it('is false for a negative max-age, which can never be satisfied', () => {
    expect(isFresh(NOW, NOW, -1)).toBe(false);
  });

  it('is true for a zero max-age at the same instant only', () => {
    expect(isFresh(NOW, NOW, 0)).toBe(true);
    expect(isFresh(NOW - 1, NOW, 0)).toBe(false);
  });
});

describe('requiresReauthentication', () => {
  const freshAuthn = NOW - SECOND;
  const staleAuthn = NOW - 600 * SECOND;

  it('does not require reauthentication for strong enough and fresh evidence', () => {
    expect(
      requiresReauthentication(AUTHN_LEVEL.Passkey, freshAuthn, NOW, {
        requiredLevel: AUTHN_LEVEL.Password,
        maxAgeSeconds: 300,
      }),
    ).toBe(false);
  });

  it('requires reauthentication when the level is too weak, however fresh', () => {
    expect(
      requiresReauthentication(AUTHN_LEVEL.Password, freshAuthn, NOW, {
        requiredLevel: AUTHN_LEVEL.Passkey,
        maxAgeSeconds: 300,
      }),
    ).toBe(true);
  });

  it('requires reauthentication when the level is strong enough but the evidence is stale', () => {
    expect(
      requiresReauthentication(AUTHN_LEVEL.Passkey, staleAuthn, NOW, {
        requiredLevel: AUTHN_LEVEL.Password,
        maxAgeSeconds: 300,
      }),
    ).toBe(true);
  });

  it('requires reauthentication for anonymous evidence against any real level', () => {
    expect(
      requiresReauthentication(AUTHN_LEVEL.Anonymous, freshAuthn, NOW, {
        requiredLevel: AUTHN_LEVEL.Password,
        maxAgeSeconds: 300,
      }),
    ).toBe(true);
  });

  it('does not treat fresh-but-weak evidence as sufficient (level and age are independent)', () => {
    // totp vừa xác thực nhưng yêu cầu passkey -> vẫn phải xác thực lại.
    expect(
      requiresReauthentication(AUTHN_LEVEL.Totp, freshAuthn, NOW, {
        requiredLevel: AUTHN_LEVEL.Passkey,
        maxAgeSeconds: 300,
      }),
    ).toBe(true);
  });

  it('measures evidence age rather than session age (FR-004b)', () => {
    // `authn_at` cũ nhưng session vẫn sống: vẫn phải xác thực lại.
    expect(
      requiresReauthentication(AUTHN_LEVEL.Password, staleAuthn, NOW, {
        requiredLevel: AUTHN_LEVEL.Password,
        maxAgeSeconds: 300,
      }),
    ).toBe(true);
  });

  it('rejects an anonymous requirement as trivially satisfied by any level', () => {
    for (const level of [AUTHN_LEVEL.Password, AUTHN_LEVEL.Totp, AUTHN_LEVEL.Passkey]) {
      expect(
        requiresReauthentication(level, freshAuthn, NOW, {
          requiredLevel: AUTHN_LEVEL.Anonymous,
          maxAgeSeconds: 300,
        }),
      ).toBe(false);
    }
  });
});
