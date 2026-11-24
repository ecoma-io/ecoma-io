import { DOMAIN_ERROR_MESSAGES, domainError, isDomainError } from './errors';
import type { DomainErrorCode } from './errors';

const ALL_CODES = Object.keys(DOMAIN_ERROR_MESSAGES) as DomainErrorCode[];

describe('domainError', () => {
  it('returns a stable code with a short Vietnamese message', () => {
    expect.hasAssertions();
    const error = domainError('session_expired');
    expect(error.code).toBe('session_expired');
    expect(error.message).toBe('Phiên đã hết hạn.');
  });

  it('gives every taxonomy code a non-empty message', () => {
    expect.hasAssertions();
    for (const code of ALL_CODES) {
      const error = domainError(code);
      expect(error.message.length).toBeGreaterThan(0);
      expect(error.message).toBe(DOMAIN_ERROR_MESSAGES[code]);
    }
  });

  it('is deterministic: the same code always yields the same object shape', () => {
    expect.hasAssertions();
    for (const code of ALL_CODES) {
      expect(domainError(code)).toStrictEqual(domainError(code));
    }
  });

  it('carries only code and message — no field for secrets or identifiers', () => {
    expect.hasAssertions();
    // Bảo vệ invariant 9 (không log cookie/token/handle/code_verifier): error đi
    // Thẳng ra log và ra response, nên nó không được mang thêm chỗ cho dữ liệu.
    for (const code of ALL_CODES) {
      const keys = Object.keys(domainError(code));
      expect(keys).toHaveLength(2);
      expect(keys).toContain('code');
      expect(keys).toContain('message');
    }
  });

  it('rejects a code outside the taxonomy', () => {
    expect.hasAssertions();
    expect(() => domainError('nope' as DomainErrorCode)).toThrow(TypeError);
  });

  it('does not let a caller smuggle data through the message', () => {
    expect.hasAssertions();
    // Không có tham số tuỳ ý nào ở đây — đó là chủ ý, xem JSDoc module.
    expect(domainError).toHaveLength(1);
  });
});

describe('DOMAIN_ERROR_MESSAGES', () => {
  it('covers the codes the identity domain actually raises', () => {
    expect.hasAssertions();
    expect(ALL_CODES).toContain('invalid_subject');
    expect(ALL_CODES).toContain('session_expired');
    expect(ALL_CODES).toContain('session_revoked');
    expect(ALL_CODES).toContain('reauthentication_required');
    expect(ALL_CODES).toContain('acr_insufficient');
    expect(ALL_CODES).toContain('account_deleted');
    expect(ALL_CODES).toContain('account_suspended');
    expect(ALL_CODES).toContain('invalid_transition');
  });
});

describe('isDomainError', () => {
  it('accepts an error built by domainError', () => {
    expect.hasAssertions();
    for (const code of ALL_CODES) {
      expect(isDomainError(domainError(code))).toBe(true);
    }
  });

  it.each([
    ['a plain object with an unknown code', { code: 'not_a_code', message: 'x' }],
    ['a plain object with no code', { message: 'x' }],
    ['a string', 'session_expired'],
    ['null', undefined],
    ['undefined', undefined],
    ['a number', 1],
    ['an Error instance', new Error('boom')],
  ])('rejects %s', (_label, value) => {
    expect.hasAssertions();
    expect(isDomainError(value)).toBeFalsy();
  });

  it.each([['toString'], ['constructor'], ['hasOwnProperty']])(
    'rejects an object whose code is the inherited Object.prototype key %s',
    (code) => {
      expect.hasAssertions();
      // `in` sẽ đi prototype chain và trả true sai cho những key này; guard phải
      // Chỉ nhìn own property của taxonomy.
      expect(isDomainError({ code, message: 'x' })).toBeFalsy();
    },
  );
});

describe('isDomainError full-contract guard (F8)', () => {
  it('rejects an object with a valid code but a tampered message', () => {
    expect.hasAssertions();
    expect(isDomainError({ code: 'session_expired', message: 'tùy ý' })).toBeFalsy();
  });

  it('accepts errors produced by domainError()', () => {
    expect.hasAssertions();
    expect(isDomainError(domainError('session_expired'))).toBe(true);
  });

  it('dOMAIN_ERROR_MESSAGES is frozen', () => {
    expect.hasAssertions();
    expect(Object.isFrozen(DOMAIN_ERROR_MESSAGES)).toBe(true);
  });
});
