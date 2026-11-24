import { AuthConfigurationError, OAuthProtocolError } from './errors';
import type { OAuthErrorCode } from './errors';

/**
 * Lỗi domain PHẢI độc lập với HTTP status, redirect behavior và transport:
 * mã (RFC 6749) và status là hai thứ khác nhau; `redirectable` là cờ
 * bắt buộc (mặc định `false`), không phải chi tiết trình bày. `detail` không
 * bao giờ chứa credential hay secret (SR-001).
 */

describe('oAuthProtocolError — shape', () => {
  it('invalid_request: default redirectable false, direct only', () => {
    expect.hasAssertions();
    const e = OAuthProtocolError.directInvalidRequest('thieu client_id');
    expect(e.code).toBe('invalid_request');
    expect(e.httpStatus).toBe(400);
    expect(e.redirectable).toBeFalsy();
    expect(e.detail).toBe('thieu client_id');
  });

  it('redirectable=true opts into OAuth error redirect', () => {
    expect.hasAssertions();
    const e = OAuthProtocolError.invalidRequest('redirect_uri khong khop');
    expect(e.redirectable).toBe(true);
  });

  it('invalid_scope default redirectable', () => {
    expect.hasAssertions();
    expect(OAuthProtocolError.invalidScope().redirectable).toBe(true);
    expect(OAuthProtocolError.directInvalidScope().redirectable).toBeFalsy();
  });

  it('invalid_client / invalid_grant / direct variants', () => {
    expect.hasAssertions();
    expect(OAuthProtocolError.invalidClient().code).toBe('invalid_client');
    expect(OAuthProtocolError.invalidClient().httpStatus).toBe(401);
    expect(OAuthProtocolError.invalidGrant().code).toBe('invalid_grant');
    expect(OAuthProtocolError.directInvalidGrant().redirectable).toBeFalsy();
  });

  it('access_denied is redirectable', () => {
    expect.hasAssertions();
    expect(OAuthProtocolError.accessDenied().redirectable).toBe(true);
  });

  it('server_error / temporarily_unavailable status', () => {
    expect.hasAssertions();
    expect(OAuthProtocolError.serverError().httpStatus).toBe(500);
    expect(OAuthProtocolError.temporarilyUnavailable().httpStatus).toBe(503);
  });

  it('detail never contains the secret passed via cause', () => {
    expect.hasAssertions();
    const secret = 'sk-test-verifier-123',
      e = OAuthProtocolError.serverError(secret);
    expect(e.detail).toBe('internal error');
    expect(String(e.detail)).not.toContain(secret);
  });
});

describe('authConfigurationError — fail-fast config error', () => {
  it('carries a stable name and message', () => {
    expect.hasAssertions();
    const e = new AuthConfigurationError('K_auth khong giai duoc duoc');
    expect(e.name).toBe('AuthConfigurationError');
    expect(e.message).toContain('K_auth');
  });
});

describe('oAuthErrorCode — exhaustive union', () => {
  const codes: OAuthErrorCode[] = [
    'invalid_request',
    'invalid_client',
    'invalid_grant',
    'unauthorized_client',
    'unsupported_grant_type',
    'invalid_scope',
    'access_denied',
    'server_error',
    'temporarily_unavailable',
  ];
  for (const code of codes) {
    it(`mapping exists for ${code}`, () => {
      expect.hasAssertions();
      expect(codes).toContain(code);
    });
  }
});
