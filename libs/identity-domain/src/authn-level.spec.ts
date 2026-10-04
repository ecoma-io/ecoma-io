import { describe, expect, it } from 'vitest';

import {
  AUTHN_LEVEL,
  AUTHN_LEVELS,
  authnLevelRank,
  authnLevelSatisfies,
  compareAuthnLevels,
  isAuthnLevel,
  meetsAuthnLevel,
  type AuthnLevel,
} from './authn-level';

describe('AuthnLevel ladder', () => {
  it('orders anonymous < password < totp < passkey', () => {
    expect(AUTHN_LEVELS).toEqual([
      AUTHN_LEVEL.Anonymous,
      AUTHN_LEVEL.Password,
      AUTHN_LEVEL.Totp,
      AUTHN_LEVEL.Passkey,
    ]);
  });

  it('maps the const object to the documented wire values', () => {
    expect(AUTHN_LEVEL.Anonymous).toBe('anonymous');
    expect(AUTHN_LEVEL.Password).toBe('password');
    expect(AUTHN_LEVEL.Totp).toBe('totp');
    expect(AUTHN_LEVEL.Passkey).toBe('passkey');
  });

  it('assigns strictly increasing ranks', () => {
    const ranks = AUTHN_LEVELS.map(authnLevelRank);
    expect(ranks).toEqual([0, 1, 2, 3]);
    const increasing = ranks.every((rank, index) => index === 0 || rank > (ranks[index - 1] ?? -1));
    expect(increasing).toBe(true);
  });
});

describe('isAuthnLevel', () => {
  it.each([...AUTHN_LEVELS])('accepts %s', (level) => {
    expect(isAuthnLevel(level)).toBe(true);
  });

  it.each([
    ['a stronger level not in the ladder', 'webauthn'],
    ['uppercase', 'PASSWORD'],
    ['empty string', ''],
    ['number', 3],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(isAuthnLevel(value)).toBe(false);
  });
});

describe('compareAuthnLevels', () => {
  it('returns zero for equal levels', () => {
    expect(compareAuthnLevels(AUTHN_LEVEL.Totp, AUTHN_LEVEL.Totp)).toBe(0);
  });

  it('returns a negative number when a is weaker than b', () => {
    expect(compareAuthnLevels(AUTHN_LEVEL.Password, AUTHN_LEVEL.Passkey)).toBeLessThan(0);
  });

  it('returns a positive number when a is stronger than b', () => {
    expect(compareAuthnLevels(AUTHN_LEVEL.Passkey, AUTHN_LEVEL.Anonymous)).toBeGreaterThan(0);
  });

  it('is antisymmetric for every ordered pair', () => {
    for (const a of AUTHN_LEVELS) {
      for (const b of AUTHN_LEVELS) {
        // So bằng TỔNG chứ không bằng `-x`: với phần tử bằng nhau, cả hai vế đều là
        // 0 và `-0` so bằng `Object.is` với `0` là false (signed zero).
        const forward = Math.sign(compareAuthnLevels(a, b));
        const backward = Math.sign(compareAuthnLevels(b, a));
        expect(forward + backward).toBe(0);
      }
    }
  });

  it('compares every distinct pair consistently with the ladder order', () => {
    for (let i = 0; i < AUTHN_LEVELS.length; i++) {
      for (let j = 0; j < AUTHN_LEVELS.length; j++) {
        const a = AUTHN_LEVELS[i] as AuthnLevel;
        const b = AUTHN_LEVELS[j] as AuthnLevel;
        expect(Math.sign(compareAuthnLevels(a, b))).toBe(Math.sign(i - j));
      }
    }
  });
});

describe('authnLevelSatisfies / meetsAuthnLevel', () => {
  const cases: readonly [AuthnLevel, AuthnLevel, boolean][] = [
    [AUTHN_LEVEL.Passkey, AUTHN_LEVEL.Password, true],
    [AUTHN_LEVEL.Password, AUTHN_LEVEL.Passkey, false],
    [AUTHN_LEVEL.Totp, AUTHN_LEVEL.Totp, true],
    [AUTHN_LEVEL.Anonymous, AUTHN_LEVEL.Anonymous, true],
    [AUTHN_LEVEL.Anonymous, AUTHN_LEVEL.Password, false],
    [AUTHN_LEVEL.Totp, AUTHN_LEVEL.Password, true],
    [AUTHN_LEVEL.Password, AUTHN_LEVEL.Totp, false],
  ];

  it.each(cases)('%s vs required %s -> %s', (actual, required, expected) => {
    expect(authnLevelSatisfies(actual, required)).toBe(expected);
    expect(meetsAuthnLevel(actual, required)).toBe(expected);
  });

  it('treats anonymous as satisfying nothing above itself', () => {
    const aboveAnonymous = AUTHN_LEVELS.filter(
      (level) => level !== AUTHN_LEVEL.Anonymous,
    ) as readonly AuthnLevel[];
    for (const required of aboveAnonymous) {
      expect(authnLevelSatisfies(AUTHN_LEVEL.Anonymous, required)).toBe(false);
    }
  });
});
