import { hashAddressKey, isEmailAddressKey } from './email-address-key';
import { isNormalizedEmailAddress, normalizeEmailAddress } from './normalized-email-address';

describe('normalizeEmailAddress', () => {
  it('normalizes trim, lowercase and NFC', () => {
    expect.hasAssertions();
    expect(normalizeEmailAddress('  USER@Example.COM  ')).toBe('user@example.com');
    const composed = 'éuser@example.com';
    expect(normalizeEmailAddress(composed)).toBe('éuser@example.com');
  });

  it.each([[''], ['   '], [123], [undefined], [undefined], [{}]])(
    'rejects %s',
    (_label, ...args) => {
      expect.hasAssertions();
      expect(() => normalizeEmailAddress(args[0] as unknown as string)).toThrow(TypeError);
    },
  );
});

describe('isNormalizedEmailAddress', () => {
  it('accepts an already-normalized address', () => {
    expect.hasAssertions();
    expect(isNormalizedEmailAddress('user@example.com')).toBe(true);
  });

  it.each([[' User@Example.COM '], [''], [123], [undefined]])('rejects %s', (_label, ...args) => {
    expect.hasAssertions();
    expect(isNormalizedEmailAddress(args[0])).toBeFalsy();
  });
});

describe('hashAddressKey', () => {
  it('produces a stable 64-hex digest of the normalized address', async () => {
    expect.hasAssertions();
    const a = await hashAddressKey(normalizeEmailAddress('USER@Example.COM')),
      b = await hashAddressKey(normalizeEmailAddress('user@example.com'));
    expect(a).toBe(b);
    expect(isEmailAddressKey(a)).toBe(true);
  });

  it('different addresses hash differently', async () => {
    expect.hasAssertions();
    const a = await hashAddressKey(normalizeEmailAddress('a@example.com')),
      b = await hashAddressKey(normalizeEmailAddress('b@example.com'));
    expect(a).not.toBe(b);
  });
});

describe('isEmailAddressKey', () => {
  it('accepts a 64-hex key', async () => {
    expect.hasAssertions();
    expect(
      isEmailAddressKey(await hashAddressKey(normalizeEmailAddress('user@example.com'))),
    ).toBeTruthy();
  });

  it.each([
    ['user@example.com'],
    [' User@Example.COM '],
    [''],
    ['ABCDEF'],
    ['zzzz'.repeat(16)],
    [123],
    [undefined],
  ])('rejects %s', (_label, ...args) => {
    expect.hasAssertions();
    expect(isEmailAddressKey(args[0])).toBeFalsy();
  });
});
