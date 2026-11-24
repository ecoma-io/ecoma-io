import { assertWellFormedRedirectUri, redirectUriMatches } from './redirect-uri';
import { assertRegisteredRedirectUri } from './authorize-request';
import { OAuthProtocolError } from '../shared/errors';

describe('redirectUriMatches (exact)', () => {
  it('matches when the strings are equal', () => {
    expect.hasAssertions();
    expect(redirectUriMatches('https://app.example/cb', 'https://app.example/cb')).toBe(true);
  });

  it('rEJECTS a prefix — the path boundary is the leading /, not the next character (T-04)', () => {
    expect.hasAssertions();
    // Dang ky `https://app.example/cb` thi KHONG duoc khop
    // `https://app.example/cb-attacker.example/`. Day la cach redirect URI
    // Attack chuan khai thac.
    expect(
      redirectUriMatches('https://app.example/cb-attacker.example/', 'https://app.example/cb'),
    ).toBeFalsy();
  });

  it('rEJECTS ignoring the query string', () => {
    expect.hasAssertions();
    expect(
      redirectUriMatches(
        'https://app.example/cb?next=https://evil.example',
        'https://app.example/cb',
      ),
    ).toBeFalsy();
  });

  it('rEJECTS ignoring a trailing slash', () => {
    expect.hasAssertions();
    expect(redirectUriMatches('https://app.example/cb/', 'https://app.example/cb')).toBeFalsy();
  });

  it('rEJECTS a letter-case difference', () => {
    expect.hasAssertions();
    expect(redirectUriMatches('https://app.example/CB', 'https://app.example/cb')).toBeFalsy();
    expect(redirectUriMatches('https://APP.example/cb', 'https://app.example/cb')).toBeFalsy();
  });

  it('rEJECTS a scheme difference', () => {
    expect.hasAssertions();
    expect(redirectUriMatches('http://app.example/cb', 'https://app.example/cb')).toBeFalsy();
  });

  it('rEJECTS protocol-relative `//evil.example` — a high-severity attack form', () => {
    expect.hasAssertions();
    expect(redirectUriMatches('//evil.example/cb', 'https://app.example/cb')).toBeFalsy();
  });

  it('rEJECTS a subdomain — wildcards are not allowed', () => {
    expect.hasAssertions();
    expect(redirectUriMatches('https://evil.app.example/cb', 'https://app.example/cb')).toBeFalsy();
  });

  it('rEJECTS userinfo: `https://app.example@evil.example` resolves to evil', () => {
    expect.hasAssertions();
    expect(
      redirectUriMatches('https://app.example@evil.example/cb', 'https://app.example/cb'),
    ).toBeFalsy();
  });

  it('rEJECTS a different port', () => {
    expect.hasAssertions();
    expect(redirectUriMatches('https://app.example:8443/cb', 'https://app.example/cb')).toBeFalsy();
  });
});

describe('redirectUriMatches (loopback, client native)', () => {
  const policy = {
    allowedHosts: new Set(['127.0.0.1', '::1']),
    kind: 'loopback-port-variable' as const,
  };

  it('allows a PORT change', () => {
    expect.hasAssertions();
    expect(
      redirectUriMatches('http://127.0.0.1:55555/cb', 'http://127.0.0.1:12345/cb', policy),
    ).toBe(true);
  });

  it('rEJECTS a HOST change', () => {
    expect.hasAssertions();
    // Chi cong duoc doi. Host la ranh gioi duyet may.
    expect(
      redirectUriMatches('http://evil.example:12345/cb', 'http://127.0.0.1:12345/cb', policy),
    ).toBeFalsy();
  });

  it('rEJECTS a PATH change', () => {
    expect.hasAssertions();
    expect(
      redirectUriMatches('http://127.0.0.1:12345/other', 'http://127.0.0.1:12345/cb', policy),
    ).toBeFalsy();
  });

  it('rEJECTS a SCHEME change', () => {
    expect.hasAssertions();
    expect(
      redirectUriMatches('https://127.0.0.1:12345/cb', 'http://127.0.0.1:12345/cb', policy),
    ).toBeFalsy();
  });

  it('rEJECTS a host not in the allowlist', () => {
    expect.hasAssertions();
    expect(
      redirectUriMatches('http://localhost:12345/cb', 'http://127.0.0.1:12345/cb', policy),
    ).toBeFalsy();
  });
});

describe('assertWellFormedRedirectUri', () => {
  it('accepts https', () => {
    expect.hasAssertions();
    expect(() => assertWellFormedRedirectUri('https://app.example/cb')).not.toThrow();
  });

  it('rEJECTS a fragment — browsers strip it on redirect, so it never reaches the server', () => {
    expect.hasAssertions();
    expect(() => assertWellFormedRedirectUri('https://app.example/cb#frag')).toThrow(/fragment/u);
  });

  it('rEJECTS http outside loopback', () => {
    expect.hasAssertions();
    expect(() => assertWellFormedRedirectUri('http://app.example/cb')).toThrow(/loopback/u);
  });

  it('accepts http loopback', () => {
    expect.hasAssertions();
    expect(() => assertWellFormedRedirectUri('http://127.0.0.1:12345/cb')).not.toThrow();
    expect(() => assertWellFormedRedirectUri('http://localhost:12345/cb')).not.toThrow();
  });

  it('rEJECTS a non-http(s) scheme — javascript:, data: are XSS/open redirect', () => {
    expect.hasAssertions();
    // Hai chuoi nay VAN parse duoc thanh URL hop le (protocol `javascript:` /
    // `data:`), nen bo qua kiem tra protocol se cho chung qua.
    expect(() => assertWellFormedRedirectUri('javascript:alert(1)')).toThrow(/http hoac https/u);
    expect(() => assertWellFormedRedirectUri('data:text/html,<script>alert(1)</script>')).toThrow(
      /http hoac https/u,
    );
  });

  it('rEJECTS a string that is not a URL', () => {
    expect.hasAssertions();
    expect(() => assertWellFormedRedirectUri('khong-phai-url')).toThrow(/URL hop le/u);
  });
});

describe('assertRegisteredRedirectUri', () => {
  it('passes when the URI is in the registered list', () => {
    expect.hasAssertions();
    expect(() =>
      assertRegisteredRedirectUri('https://app.example/cb', ['https://app.example/cb'], {
        kind: 'exact',
      }),
    ).not.toThrow();
  });

  it('rEJECTS an unregistered URI', () => {
    expect.hasAssertions();
    expect(() =>
      assertRegisteredRedirectUri('https://evil.example/cb', ['https://app.example/cb'], {
        kind: 'exact',
      }),
    ).toThrow(OAuthProtocolError);
  });

  it('rEJECTS when the list is empty', () => {
    expect.hasAssertions();
    expect(() =>
      assertRegisteredRedirectUri('https://app.example/cb', [], { kind: 'exact' }),
    ).toThrow(OAuthProtocolError);
  });

  it('never redirects on an invalid URI — redirectable must be false', () => {
    expect.hasAssertions();
    // Loi sai kinh dien: handler nao do bat loi roi redirect toi redirect_uri
    // Chua duoc xac minh => open redirect. Loi phai ra `redirectable=false`.
    let thrown: unknown;
    try {
      assertRegisteredRedirectUri('https://evil.example/cb', ['https://app.example/cb'], {
        kind: 'exact',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(OAuthProtocolError);
    expect((thrown as OAuthProtocolError).redirectable).toBeFalsy();
  });

  it('only one of several registered URIs needs to match', () => {
    expect.hasAssertions();
    const registered = ['https://a.example/cb', 'https://b.example/cb'];
    expect(() =>
      assertRegisteredRedirectUri('https://b.example/cb', registered, { kind: 'exact' }),
    ).not.toThrow();
  });
});
