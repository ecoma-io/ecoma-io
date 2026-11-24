import { ACR, acrSatisfies, acrSetFor, isAcr, isAcrShape } from './acr';
import { isExpired, isFresh, isRevoked, requiresReauthentication } from './session-policy';

/** Mốc thời gian cố định cho mọi case — module này thuần, không đọc đồng hồ. */
const NOW = 1_700_000_000_000,
  SECOND = 1000;

describe('isExpired', () => {
  it('is false strictly before the expiry instant', () => {
    expect.hasAssertions();
    expect(isExpired({ expiresAt: NOW + 1 }, NOW)).toBeFalsy();
  });

  it('is true at exactly the expiry instant', () => {
    expect.hasAssertions();
    expect(isExpired({ expiresAt: NOW }, NOW)).toBe(true);
  });

  it('is true after the expiry instant', () => {
    expect.hasAssertions();
    expect(isExpired({ expiresAt: NOW - 1 }, NOW)).toBe(true);
  });

  it('ignores revocation when only measuring expiry', () => {
    expect.hasAssertions();
    expect(isExpired({ expiresAt: NOW + SECOND, revokedAt: NOW - SECOND }, NOW)).toBeFalsy();
  });
});

describe('isRevoked', () => {
  it('is false when never revoked', () => {
    expect.hasAssertions();
    expect(isRevoked({ expiresAt: NOW + SECOND }, NOW)).toBeFalsy();
  });

  it('is false when revokedAt is explicitly null', () => {
    expect.hasAssertions();
    expect(isRevoked({ expiresAt: NOW + SECOND, revokedAt: undefined }, NOW)).toBeFalsy();
  });

  it('is true once the revocation instant is reached', () => {
    expect.hasAssertions();
    expect(isRevoked({ expiresAt: NOW + SECOND, revokedAt: NOW }, NOW)).toBe(true);
  });

  it('is false before a future revocation instant', () => {
    expect.hasAssertions();
    expect(isRevoked({ expiresAt: NOW + SECOND, revokedAt: NOW + SECOND }, NOW)).toBeFalsy();
  });
});

describe('isFresh', () => {
  it('is true at exactly the max-age boundary', () => {
    expect.hasAssertions();
    expect(isFresh(NOW - 60 * SECOND, NOW, 60)).toBe(true);
  });

  it('is false one millisecond past the boundary', () => {
    expect.hasAssertions();
    expect(isFresh(NOW - 60 * SECOND - 1, NOW, 60)).toBeFalsy();
  });

  it('is true for an instant authentication', () => {
    expect.hasAssertions();
    expect(isFresh(NOW, NOW, 60)).toBe(true);
  });

  it('is false for evidence from the future', () => {
    expect.hasAssertions();
    expect(isFresh(NOW + 1, NOW, 60)).toBeFalsy();
  });

  it('is false for a negative max-age, which can never be satisfied', () => {
    expect.hasAssertions();
    expect(isFresh(NOW, NOW, -1)).toBeFalsy();
  });

  it('is true for a zero max-age at the same instant only', () => {
    expect.hasAssertions();
    expect(isFresh(NOW, NOW, 0)).toBe(true);
    expect(isFresh(NOW - 1, NOW, 0)).toBeFalsy();
  });
});

describe('requiresReauthentication', () => {
  const freshAuthn = NOW - SECOND,
    staleAuthn = NOW - 600 * SECOND;

  it('does not require reauthentication when the ACR set contains the required ACR and evidence is fresh', () => {
    expect.hasAssertions();
    expect(
      requiresReauthentication(
        acrSetFor({ emailOtp: true, secondFactor: 'passkey' }),
        freshAuthn,
        NOW,
        {
          maxAgeSeconds: 300,
          requiredAcr: ACR.Mfa,
        },
      ),
    ).toBeFalsy();
  });

  it('requires reauthentication when the ACR set lacks the required ACR, however fresh', () => {
    expect.hasAssertions();
    expect(
      requiresReauthentication(acrSetFor({ emailOtp: true }), freshAuthn, NOW, {
        maxAgeSeconds: 300,
        requiredAcr: ACR.PhishingResistant,
      }),
    ).toBe(true);
  });

  it('requires reauthentication when the ACR set satisfies but the evidence is stale', () => {
    expect.hasAssertions();
    expect(
      requiresReauthentication(
        acrSetFor({ emailOtp: true, secondFactor: 'passkey' }),
        staleAuthn,
        NOW,
        {
          maxAgeSeconds: 300,
          requiredAcr: ACR.Mfa,
        },
      ),
    ).toBe(true);
  });

  it('requires reauthentication for an empty ACR set against any real ACR', () => {
    expect.hasAssertions();
    expect(
      requiresReauthentication(new Set(), freshAuthn, NOW, {
        maxAgeSeconds: 300,
        requiredAcr: ACR.EmailOtp,
      }),
    ).toBe(true);
  });

  it('does not let email-otp alone satisfy mfa (membership, not ranking)', () => {
    expect.hasAssertions();
    // Totp vừa xác thực nhưng yêu cầu passkey -> vẫn phải xác thực lại.
    expect(
      requiresReauthentication(
        acrSetFor({ emailOtp: true, secondFactor: 'totp' }),
        freshAuthn,
        NOW,
        {
          maxAgeSeconds: 300,
          requiredAcr: ACR.PhishingResistant,
        },
      ),
    ).toBe(true);
  });

  it('measures evidence age rather than session age (FR-004b)', () => {
    expect.hasAssertions();
    // `authn_at` cũ nhưng session vẫn sống: vẫn phải xác thực lại.
    expect(
      requiresReauthentication(acrSetFor({ emailOtp: true }), staleAuthn, NOW, {
        maxAgeSeconds: 300,
        requiredAcr: ACR.EmailOtp,
      }),
    ).toBe(true);
  });
});

describe('acrSetFor', () => {
  it('is empty when nothing was completed', () => {
    expect.hasAssertions();
    expect(acrSetFor({}).size).toBe(0);
    expect(acrSetFor({ emailOtp: false, secondFactor: 'totp' }).size).toBe(0);
  });

  it('contains only email-otp after OTP login', () => {
    expect.hasAssertions();
    const set = acrSetFor({ emailOtp: true });
    expect([...set]).toStrictEqual([ACR.EmailOtp]);
  });

  it('adds mfa but not phishing-resistant for TOTP as the second factor', () => {
    expect.hasAssertions();
    const set = acrSetFor({ emailOtp: true, secondFactor: 'totp' });
    expect(acrSatisfies(set, ACR.EmailOtp)).toBe(true);
    expect(acrSatisfies(set, ACR.Mfa)).toBe(true);
    expect(acrSatisfies(set, ACR.PhishingResistant)).toBeFalsy();
  });

  it('adds mfa and phishing-resistant for passkey as the second factor', () => {
    expect.hasAssertions();
    const set = acrSetFor({ emailOtp: true, secondFactor: 'passkey' });
    expect(acrSatisfies(set, ACR.EmailOtp)).toBe(true);
    expect(acrSatisfies(set, ACR.Mfa)).toBe(true);
    expect(acrSatisfies(set, ACR.PhishingResistant)).toBe(true);
  });

  it('never grants mfa without the OTP base', () => {
    expect.hasAssertions();
    // Yếu tố thứ hai mà không qua OTP không hợp lệ ở tầng policy; nếu vẫn truyền
    // Vào thì tập không được tự sinh `mfa` — việc đó thuộc tầng điều phối flow.
    const set = acrSetFor({ emailOtp: false, secondFactor: 'passkey' });
    expect(acrSatisfies(set, ACR.Mfa)).toBeFalsy();
    expect(acrSatisfies(set, ACR.PhishingResistant)).toBeFalsy();
  });
});

describe('isAcr / isAcrShape', () => {
  it('accepts every declared ACR URN', () => {
    expect.hasAssertions();
    for (const acr of [ACR.EmailOtp, ACR.Mfa, ACR.PhishingResistant]) {
      expect(isAcr(acr)).toBe(true);
      expect(isAcrShape(acr)).toBe(true);
    }
  });

  it('rejects unknown or malformed values', () => {
    expect.hasAssertions();
    expect(isAcr('urn:ecoma:acr:sms')).toBeFalsy();
    expect(isAcr('password')).toBeFalsy();
    expect(isAcr('')).toBeFalsy();
    expect(isAcr(undefined)).toBeFalsy();
    expect(isAcrShape('urn:ecoma:acr:')).toBeFalsy();
    expect(isAcrShape('urn:other:acr:email-otp')).toBeFalsy();
    expect(isAcrShape('urn:ecoma:acr:Email-Otp')).toBeFalsy();
  });
});
