import {
  FAIL_CLOSED_ONLY_AT_ISSUANCE,
  allowsIssuance,
  assertGrantCoversScope,
  assertRevocationCacheTtl,
  assertUsableClient,
  assessRiskLevel,
  isActiveClient,
  isIssuable,
  needsConsent,
} from '../index';
import type { RevocationCheckResult } from '../index';

describe('allowsIssuance', () => {
  it('issues only for active status', () => {
    expect.hasAssertions();
    expect(allowsIssuance('active')).toBe(true);
  });

  it.each(['suspended', 'deleted'] as const)('blocks issuance for %s', (status) => {
    expect.hasAssertions();
    expect(allowsIssuance(status)).toBeFalsy();
  });
});

describe('assertUsableClient', () => {
  it('accepts an active client', () => {
    expect.hasAssertions();
    expect(() => assertUsableClient({ isActive: true })).not.toThrow();
  });

  it('rejects an inactive client — client bị thu hồi không được đẩy vào consent', () => {
    expect.hasAssertions();
    expect(() => assertUsableClient({ isActive: false })).toThrow(/khong hoat dong/u);
  });

  it('isActiveClient mirrors the predicate', () => {
    expect.hasAssertions();
    expect(isActiveClient({ isActive: true })).toBe(true);
    expect(isActiveClient({ isActive: false })).toBeFalsy();
  });
});

describe('needsConsent', () => {
  it('asks for consent when no grant exists', () => {
    expect.hasAssertions();
    expect(needsConsent({ existingGrant: undefined, requestedScope: ['openid'] })).toBe(true);
  });

  it('asks for consent when the grant is inactive', () => {
    expect.hasAssertions();
    expect(
      needsConsent({
        existingGrant: { isActive: false, scopes: ['openid'] },
        requestedScope: ['openid'],
      }),
    ).toBe(true);
  });

  it('skips consent when the grant covers the full requested scope', () => {
    expect.hasAssertions();
    expect(
      needsConsent({
        existingGrant: { isActive: true, scopes: ['openid', 'profile'] },
        requestedScope: ['openid'],
      }),
    ).toBeFalsy();
  });

  it('asks for consent for ANY scope outside the grant', () => {
    expect.hasAssertions();
    expect(
      needsConsent({
        existingGrant: { isActive: true, scopes: ['openid'] },
        requestedScope: ['openid', 'email'],
      }),
    ).toBe(true);
  });

  it('skips consent when the grant covers the requested scope exactly', () => {
    expect.hasAssertions();
    expect(
      needsConsent({
        existingGrant: { isActive: true, scopes: ['openid', 'profile'] },
        requestedScope: ['profile'],
      }),
    ).toBeFalsy();
  });
});

describe('assertGrantCoversScope', () => {
  it('passes when the grant is active and covers the scope', () => {
    expect.hasAssertions();
    expect(() =>
      assertGrantCoversScope({ isActive: true, scopes: ['openid'] }, ['openid']),
    ).not.toThrow();
  });

  it('rejects when the grant is missing or inactive', () => {
    expect.hasAssertions();
    expect(() => assertGrantCoversScope(undefined, ['openid'])).toThrow(/khong con hieu luc/u);
    expect(() =>
      assertGrantCoversScope({ isActive: false, scopes: ['openid'] }, ['openid']),
    ).toThrow(/khong con hieu luc/u);
  });

  it('rejects when the grant misses any requested scope', () => {
    expect.hasAssertions();
    expect(() =>
      assertGrantCoversScope({ isActive: true, scopes: ['openid'] }, ['openid', 'email']),
    ).toThrow(/khong du scope/u);
  });
});

describe('assessRiskLevel', () => {
  it('low when nothing is new', () => {
    expect.hasAssertions();
    expect(
      assessRiskLevel({ isAuthenticationFresh: true, isNewClient: false, isNewScope: false }),
    ).toBe('low');
  });

  it('elevated for exactly one signal', () => {
    expect.hasAssertions();
    expect(
      assessRiskLevel({ isAuthenticationFresh: true, isNewClient: true, isNewScope: false }),
    ).toBe('elevated');
  });

  it('high for two or more signals', () => {
    expect.hasAssertions();
    expect(
      assessRiskLevel({ isAuthenticationFresh: true, isNewClient: true, isNewScope: true }),
    ).toBe('high');
    expect(
      assessRiskLevel({ isAuthenticationFresh: false, isNewClient: true, isNewScope: true }),
    ).toBe('high');
  });
});

describe('isIssuable', () => {
  it('issues only on not_revoked — unknown và unavailable đều fail-closed (FR-017)', () => {
    expect.hasAssertions();
    const results: RevocationCheckResult[] = ['not_revoked', 'revoked', 'unknown', 'unavailable'];
    expect(results.filter(isIssuable)).toStrictEqual(['not_revoked']);
  });
});

describe('assertRevocationCacheTtl', () => {
  it('accepts a cache TTL within the access token TTL', () => {
    expect.hasAssertions();
    expect(() => assertRevocationCacheTtl(60, 300)).not.toThrow();
    expect(() => assertRevocationCacheTtl(300, 300)).not.toThrow();
  });

  it('rejects a cache TTL longer than the access token TTL (FR-017b)', () => {
    expect.hasAssertions();
    expect(() => assertRevocationCacheTtl(301, 300)).toThrow(/khong duoc dai hon/u);
  });
});

describe('fail closed only at issuance', () => {
  it('declares the honest boundary: no offline fail-closed claim', () => {
    expect.hasAssertions();
    expect(FAIL_CLOSED_ONLY_AT_ISSUANCE).toBe(true);
  });
});
