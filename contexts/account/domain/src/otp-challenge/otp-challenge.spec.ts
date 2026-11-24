import { MAX_OTP_ATTEMPTS, OTP_TTL_SECONDS, OtpChallenge } from './otp-challenge';
import type { OtpChallengeId, OtpChallengeSnapshot, OtpDigest, OtpPurpose } from './otp-challenge';
import type { EmailAddressKey } from '../email-address/email-address-key';

const ID = '018f3c7e-8a1b-7c2d-9e4f-5a6b7c8d9e0f' as OtpChallengeId,
  KEY = 'a'.repeat(64) as EmailAddressKey,
  DIGEST_A = 'a'.repeat(64) as OtpDigest,
  DIGEST_B = 'b'.repeat(64) as OtpDigest,
  NOW = 1_700_000_000_000;

function issued(overrides?: { now?: number; ttlSeconds?: number }): OtpChallenge {
  return OtpChallenge.issue({
    addressKey: KEY,
    digest: DIGEST_A,
    id: ID,
    now: overrides?.now ?? NOW,
    purpose: 'login' satisfies OtpPurpose,
    ttlSeconds: overrides?.ttlSeconds,
  });
}

function reconstitute(
  snapshot: Partial<OtpChallengeSnapshot> & Pick<OtpChallengeSnapshot, 'addressKey'>,
): OtpChallenge {
  return OtpChallenge.reconstitute({
    attempts: 0,
    digest: DIGEST_A,
    expiresAt: NOW + OTP_TTL_SECONDS * 1000,
    id: ID,
    purpose: 'login',
    terminal: false,
    terminalReason: null,
    ...snapshot,
  });
}

describe('otpChallenge.issue', () => {
  it('starts pending with TTL and zero attempts', () => {
    expect.hasAssertions();
    const c = issued();
    expect(c.addressKey()).toBe(KEY);
    expect(c.purpose()).toBe('login');
    expect(c.attempts()).toBe(0);
    expect(c.isTerminal()).toBeFalsy();
    expect(c.expiresAt()).toBe(NOW + OTP_TTL_SECONDS * 1000);
    expect(c.isConsumable(NOW)).toBe(true);
  });

  it('honours a custom ttl', () => {
    expect.hasAssertions();
    const c = issued({ ttlSeconds: 1 });
    expect(c.expiresAt()).toBe(NOW + 1000);
  });
});

describe('otpChallenge.consume — terminal-first ordering', () => {
  it('consumes with the matching digest exactly once', () => {
    expect.hasAssertions();
    const c = issued();
    expect(c.consume(DIGEST_A, NOW + 1000)).toStrictEqual({ consumed: true });
    expect(c.isTerminal()).toBe(true);
    expect(c.terminalReason()).toBe('verified_ok');
  });

  it('second consume on a consumed challenge is terminal', () => {
    expect.hasAssertions();
    const c = issued();
    c.consume(DIGEST_A, NOW + 1000);
    expect(c.consume(DIGEST_A, NOW + 1000)).toStrictEqual({ rejected: 'terminal' });
  });

  it('expired + correct digest is still expired', () => {
    expect.hasAssertions();
    const c = issued(),
      atExpiry = NOW + OTP_TTL_SECONDS * 1000;
    expect(c.consume(DIGEST_A, atExpiry)).toStrictEqual({ rejected: 'expired' });
    expect(c.terminalReason()).toBe('expired');
  });

  it('expired + wrong digest is expired, not mismatch', () => {
    expect.hasAssertions();
    const c = issued();
    expect(c.consume(DIGEST_B, NOW + OTP_TTL_SECONDS * 1000 + 1)).toStrictEqual({
      rejected: 'expired',
    });
  });

  it('mismatch increments attempts and does not consume', () => {
    expect.hasAssertions();
    const c = issued();
    expect(c.consume(DIGEST_B, NOW + 1000)).toStrictEqual({ rejected: 'mismatch' });
    expect(c.attempts()).toBe(1);
    expect(c.isTerminal()).toBeFalsy();
  });

  it('locks at the attempt cap via consume', () => {
    expect.hasAssertions();
    const c = issued();
    for (let i = 1; i < MAX_OTP_ATTEMPTS; i += 1) {
      expect(c.consume(DIGEST_B, NOW + 1000)).toStrictEqual({ rejected: 'mismatch' });
    }
    expect(c.consume(DIGEST_B, NOW + 1000)).toStrictEqual({ rejected: 'mismatch' });
    expect(c.isTerminal()).toBe(true);
    expect(c.terminalReason()).toBe('attempt_cap');
    expect(c.consume(DIGEST_A, NOW + 1000)).toStrictEqual({ rejected: 'terminal' });
  });

  it('correct code after failures still consumes', () => {
    expect.hasAssertions();
    const c = issued();
    c.consume(DIGEST_B, NOW + 1000);
    c.consume(DIGEST_B, NOW + 1000);
    expect(c.consume(DIGEST_A, NOW + 1000)).toStrictEqual({ consumed: true });
  });
});

describe('otpChallenge.recordFailedAttempt', () => {
  it('locks exactly at the cap', () => {
    expect.hasAssertions();
    const c = issued();
    for (let i = 1; i < MAX_OTP_ATTEMPTS; i += 1) {
      expect(c.recordFailedAttempt(NOW)).toStrictEqual({ locked: false });
    }
    expect(c.recordFailedAttempt(NOW)).toStrictEqual({ locked: true });
    expect(c.terminalReason()).toBe('attempt_cap');
  });

  it('returns domain error on an already-terminal challenge (protocol violation)', () => {
    expect.hasAssertions();
    const c = issued();
    c.consume(DIGEST_A, NOW + 1000);
    expect(c.recordFailedAttempt(NOW)).toMatchObject({ code: 'invalid_transition' });
  });

  it('a challenge past TTL transitions to expired, attempts unchanged, further calls error', () => {
    expect.hasAssertions();
    const c = issued(),
      atExpiry = NOW + OTP_TTL_SECONDS * 1000;
    expect(c.recordFailedAttempt(atExpiry)).toMatchObject({ code: 'invalid_transition' });
    expect(c.terminalReason()).toBe('expired');
    expect(c.attempts()).toBe(0);
    expect(c.recordFailedAttempt(atExpiry + 1)).toMatchObject({ code: 'invalid_transition' });
  });
});

describe('otpChallenge.expireIfExpired', () => {
  it('returns false before expiry and true once, at expiry', () => {
    expect.hasAssertions();
    const c = issued();
    expect(c.expireIfExpired(NOW)).toBeFalsy();
    const atExpiry = NOW + OTP_TTL_SECONDS * 1000;
    expect(c.expireIfExpired(atExpiry)).toBe(true);
    expect(c.expireIfExpired(atExpiry)).toBeFalsy();
    expect(c.terminalReason()).toBe('expired');
  });

  it('does not overwrite a consumed challenge', () => {
    expect.hasAssertions();
    const c = issued();
    c.consume(DIGEST_A, NOW + 1000);
    expect(c.expireIfExpired(NOW + OTP_TTL_SECONDS * 1000 + 5)).toBeFalsy();
    expect(c.terminalReason()).toBe('verified_ok');
  });
});

describe('otpChallenge.reconstitute', () => {
  it('round-trips through snapshot', () => {
    expect.hasAssertions();
    const c = issued();
    c.recordFailedAttempt(NOW);
    const restored = OtpChallenge.reconstitute(c.snapshot());
    expect(restored.equals(c)).toBe(true);
    expect(restored.attempts()).toBe(1);
  });

  it('rejects snapshots with terminal but no reason and vice versa', () => {
    expect.hasAssertions();
    expect(() => reconstitute({ addressKey: KEY, terminal: true, terminalReason: null })).toThrow(
      TypeError,
    );
    expect(() =>
      reconstitute({
        addressKey: 'b'.repeat(64) as EmailAddressKey,
        terminal: false,
        terminalReason: 'expired',
      }),
    ).toThrow(TypeError);
  });

  it('rejects negative attempts', () => {
    expect.hasAssertions();
    expect(() => reconstitute({ addressKey: KEY, attempts: -1 })).toThrow(TypeError);
  });

  it('rejects non-finite expiresAt and over-cap attempts (adversarial fixes)', () => {
    expect.hasAssertions();
    expect(() => reconstitute({ addressKey: KEY, expiresAt: Number.NaN })).toThrow(TypeError);
    expect(() => reconstitute({ addressKey: KEY, attempts: MAX_OTP_ATTEMPTS + 1 })).toThrow(
      TypeError,
    );
  });

  it('rejects terminal attempt_cap with attempts below the cap (self-contradictory)', () => {
    expect.hasAssertions();
    expect(() =>
      reconstitute({ addressKey: KEY, attempts: 2, terminal: true, terminalReason: 'attempt_cap' }),
    ).toThrow(TypeError);
  });

  it('rejects a digest that is not 64-hex', () => {
    expect.hasAssertions();
    expect(() => reconstitute({ addressKey: KEY, digest: 'not-a-digest' as OtpDigest })).toThrow(
      TypeError,
    );
    expect(() => reconstitute({ addressKey: KEY, digest: 'a'.repeat(63) as OtpDigest })).toThrow(
      TypeError,
    );
  });
});

describe('otpChallenge identity', () => {
  it('equals by aggregate id; different id or different business key is not equal', () => {
    expect.hasAssertions();
    const a = issued(),
      b = issued();
    a.recordFailedAttempt(NOW);
    expect(a.equals(b)).toBe(true);
    expect(a.businessKey()).toStrictEqual({ addressKey: KEY, purpose: 'login' });

    const otherId = OtpChallenge.issue({
      addressKey: KEY,
      digest: DIGEST_A,
      id: '018f3c7e-8a1b-7c2d-9e4f-5a6b7c8d9e99' as OtpChallengeId,
      now: NOW,
      purpose: 'login',
    });
    expect(a.equals(otherId)).toBeFalsy();
    expect(a.equals('not a challenge')).toBeFalsy();
  });
});

describe('otpChallenge reconstitute guards (adversarial fixes)', () => {
  it('rejects a non-terminal snapshot without digest', () => {
    expect.hasAssertions();
    expect(() =>
      OtpChallenge.reconstitute({
        addressKey: KEY,
        attempts: 0,
        digest: null,
        expiresAt: NOW + 60_000,
        id: ID,
        purpose: 'login',
        terminal: false,
        terminalReason: null,
      }),
    ).toThrow(TypeError);
  });

  it('rejects a non-UUID id', () => {
    expect.hasAssertions();
    expect(() => reconstitute({ addressKey: KEY, id: 'not-a-uuid' as OtpChallengeId })).toThrow(
      TypeError,
    );
  });

  it('rejects a non-integer attempts count (2.5)', () => {
    expect.hasAssertions();
    expect(() => reconstitute({ addressKey: KEY, attempts: 2.5 })).toThrow(TypeError);
  });

  it('issue rejects a non-finite or non-positive ttlSeconds', () => {
    expect.hasAssertions();
    expect(() =>
      OtpChallenge.issue({
        addressKey: KEY,
        digest: DIGEST_A,
        id: ID,
        now: NOW,
        purpose: 'login',
        ttlSeconds: Number.NaN,
      }),
    ).toThrow(TypeError);
    expect(() =>
      OtpChallenge.issue({
        addressKey: KEY,
        digest: DIGEST_A,
        id: ID,
        now: NOW,
        purpose: 'login',
        ttlSeconds: 0,
      }),
    ).toThrow(TypeError);
    expect(() =>
      OtpChallenge.issue({
        addressKey: KEY,
        digest: DIGEST_A,
        id: ID,
        now: NOW,
        purpose: 'login',
        ttlSeconds: -5,
      }),
    ).toThrow(TypeError);
  });
});

describe('otpChallenge issue entry validation (adversarial P3)', () => {
  it('issue rejects a malformed id and a malformed digest', () => {
    expect.hasAssertions();
    expect(() =>
      OtpChallenge.issue({
        addressKey: KEY,
        digest: DIGEST_A,
        id: 'nope' as OtpChallengeId,
        now: NOW,
        purpose: 'login',
      }),
    ).toThrow(TypeError);
    expect(() =>
      OtpChallenge.issue({
        addressKey: KEY,
        digest: 'xyz' as OtpDigest,
        id: ID,
        now: NOW,
        purpose: 'login',
      }),
    ).toThrow(TypeError);
  });

  it('issue rejects a non-hash addressKey and an unknown purpose', () => {
    expect.hasAssertions();
    expect(() =>
      OtpChallenge.issue({
        addressKey: 'not-a-hash' as EmailAddressKey,
        digest: DIGEST_A,
        id: ID,
        now: NOW,
        purpose: 'login',
      }),
    ).toThrow(TypeError);
    expect(() =>
      OtpChallenge.issue({
        addressKey: KEY,
        digest: DIGEST_A,
        id: ID,
        now: NOW,
        purpose: 'password_reset' as never,
      }),
    ).toThrow(TypeError);
    expect(() =>
      OtpChallenge.issue({
        addressKey: KEY,
        digest: DIGEST_A,
        id: ID,
        now: NOW,
        purpose: undefined as never,
      }),
    ).toThrow(TypeError);
  });
});

describe('otpChallenge invalid-now guards (adversarial P1)', () => {
  it('consume with NaN now rejects without mutation', () => {
    expect.hasAssertions();
    const c = issued();
    expect(c.consume(DIGEST_A, Number.NaN)).toStrictEqual({ rejected: 'mismatch' });
    expect(c.isTerminal()).toBeFalsy();
    expect(c.attempts()).toBe(0);
    // Challenge vẫn dùng được với now hợp lệ.
    expect(c.consume(DIGEST_A, NOW)).toStrictEqual({ consumed: true });
  });

  it('consume with Infinity now rejects without mutation (non-finite now is rejected)', () => {
    expect.hasAssertions();
    const c = issued();
    expect(c.consume(DIGEST_A, Number.POSITIVE_INFINITY)).toStrictEqual({ rejected: 'mismatch' });
    expect(c.isTerminal()).toBeFalsy();
    expect(c.attempts()).toBe(0);
  });

  it('recordFailedAttempt with NaN now returns a domain error without mutation', () => {
    expect.hasAssertions();
    const c = issued();
    expect(c.recordFailedAttempt(Number.NaN)).toMatchObject({ code: 'invalid_transition' });
    expect(c.attempts()).toBe(0);
    expect(c.isTerminal()).toBeFalsy();
  });

  it('expireIfExpired with NaN now does not terminate the challenge', () => {
    expect.hasAssertions();
    const c = issued();
    expect(c.expireIfExpired(Number.NaN)).toBeFalsy();
    expect(c.isTerminal()).toBeFalsy();
  });

  it('isConsumable with non-finite now is false', () => {
    expect.hasAssertions();
    const c = issued();
    expect(c.isConsumable(Number.NaN)).toBeFalsy();
    expect(c.isConsumable(Number.POSITIVE_INFINITY)).toBeFalsy();
  });
});

test('issue rejects a ttlSeconds that overflows expiresAt to Infinity', () => {
  expect.hasAssertions();
  expect(() =>
    OtpChallenge.issue({
      addressKey: KEY,
      digest: DIGEST_A,
      id: ID,
      now: NOW,
      purpose: 'login',
      ttlSeconds: 1e308,
    }),
  ).toThrow(TypeError);
});
