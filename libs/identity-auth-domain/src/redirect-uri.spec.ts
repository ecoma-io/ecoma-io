import { describe, expect, it } from 'vitest';

import { assertWellFormedRedirectUri, redirectUriMatches } from './redirect-uri';
import { assertRegisteredRedirectUri } from './authorize-request';
import { OAuthProtocolError } from './errors';

describe('redirectUriMatches (exact)', () => {
  it('khop khi chuoi bang nhau', () => {
    expect(redirectUriMatches('https://app.example/cb', 'https://app.example/cb')).toBe(true);
  });

  it('TU CHOI prefix — ranh gioi duong dan la dau /, khong phai ky tu ke tiep (T-04)', () => {
    // Dang ky `https://app.example/cb` thi KHONG duoc khop
    // `https://app.example/cb-attacker.example/`. Day la cach redirect URI
    // attack chuan khai thac.
    expect(
      redirectUriMatches('https://app.example/cb-attacker.example/', 'https://app.example/cb'),
    ).toBe(false);
  });

  it('TU CHOI bo qua query string', () => {
    expect(
      redirectUriMatches(
        'https://app.example/cb?next=https://evil.example',
        'https://app.example/cb',
      ),
    ).toBe(false);
  });

  it('TU CHOI bo qua trailing slash', () => {
    expect(redirectUriMatches('https://app.example/cb/', 'https://app.example/cb')).toBe(false);
  });

  it('TU CHOI lech chu hoa chu thuong', () => {
    expect(redirectUriMatches('https://app.example/CB', 'https://app.example/cb')).toBe(false);
    expect(redirectUriMatches('https://APP.example/cb', 'https://app.example/cb')).toBe(false);
  });

  it('TU CHOI lech scheme', () => {
    expect(redirectUriMatches('http://app.example/cb', 'https://app.example/cb')).toBe(false);
  });

  it('TU CHOI protocol-relative `//evil.example` — dang duong nhay nang cao', () => {
    expect(redirectUriMatches('//evil.example/cb', 'https://app.example/cb')).toBe(false);
  });

  it('TU CHOI subdomain — wildcard la khong duoc phep', () => {
    expect(redirectUriMatches('https://evil.app.example/cb', 'https://app.example/cb')).toBe(false);
  });

  it('TU CHOI userinfo: `https://app.example@evil.example` tro ve evil', () => {
    expect(
      redirectUriMatches('https://app.example@evil.example/cb', 'https://app.example/cb'),
    ).toBe(false);
  });

  it('TU CHOI port khac', () => {
    expect(redirectUriMatches('https://app.example:8443/cb', 'https://app.example/cb')).toBe(false);
  });
});

describe('redirectUriMatches (loopback, client native)', () => {
  const policy = {
    kind: 'loopback-port-variable' as const,
    allowedHosts: new Set(['127.0.0.1', '::1']),
  };

  it('cho phep doi CONG', () => {
    expect(
      redirectUriMatches('http://127.0.0.1:55555/cb', 'http://127.0.0.1:12345/cb', policy),
    ).toBe(true);
  });

  it('TU CHOI doi HOST', () => {
    // Chi cong duoc doi. Host la ranh gioi duyet may.
    expect(
      redirectUriMatches('http://evil.example:12345/cb', 'http://127.0.0.1:12345/cb', policy),
    ).toBe(false);
  });

  it('TU CHOI doi PATH', () => {
    expect(
      redirectUriMatches('http://127.0.0.1:12345/other', 'http://127.0.0.1:12345/cb', policy),
    ).toBe(false);
  });

  it('TU CHOI doi SCHEME', () => {
    expect(
      redirectUriMatches('https://127.0.0.1:12345/cb', 'http://127.0.0.1:12345/cb', policy),
    ).toBe(false);
  });

  it('TU CHOI host khong nam trong allowlist', () => {
    expect(
      redirectUriMatches('http://localhost:12345/cb', 'http://127.0.0.1:12345/cb', policy),
    ).toBe(false);
  });
});

describe('assertWellFormedRedirectUri', () => {
  it('chap nhan https', () => {
    expect(() => assertWellFormedRedirectUri('https://app.example/cb')).not.toThrow();
  });

  it('TU CHOI fragment — browser cat fragment khi chuyen huong nen no khong bao gio toi duoc server', () => {
    expect(() => assertWellFormedRedirectUri('https://app.example/cb#frag')).toThrow(/fragment/u);
  });

  it('TU CHOI http tru loopback', () => {
    expect(() => assertWellFormedRedirectUri('http://app.example/cb')).toThrow(/loopback/u);
  });

  it('chap nhan http loopback', () => {
    expect(() => assertWellFormedRedirectUri('http://127.0.0.1:12345/cb')).not.toThrow();
    expect(() => assertWellFormedRedirectUri('http://localhost:12345/cb')).not.toThrow();
  });

  it('TU CHOI scheme khac http(s) — javascript:, data: la XSS/open redirect', () => {
    // Hai chuoi nay VAN parse duoc thanh URL hop le (protocol `javascript:` /
    // `data:`), nen bo qua kiem tra protocol se cho chung qua.
    expect(() => assertWellFormedRedirectUri('javascript:alert(1)')).toThrow(/http hoac https/u);
    expect(() => assertWellFormedRedirectUri('data:text/html,<script>alert(1)</script>')).toThrow(
      /http hoac https/u,
    );
  });

  it('TU CHOI chuoi khong phai URL', () => {
    expect(() => assertWellFormedRedirectUri('khong-phai-url')).toThrow(/URL hop le/u);
  });
});

describe('assertRegisteredRedirectUri', () => {
  it('qua khi URI nam trong danh sach dang ky', () => {
    expect(() =>
      assertRegisteredRedirectUri('https://app.example/cb', ['https://app.example/cb'], {
        kind: 'exact',
      }),
    ).not.toThrow();
  });

  it('TU CHOI URI khong dang ky', () => {
    expect(() =>
      assertRegisteredRedirectUri('https://evil.example/cb', ['https://app.example/cb'], {
        kind: 'exact',
      }),
    ).toThrow(OAuthProtocolError);
  });

  it('TU CHOI khi danh sach rong', () => {
    expect(() =>
      assertRegisteredRedirectUri('https://app.example/cb', [], { kind: 'exact' }),
    ).toThrow(OAuthProtocolError);
  });

  it('khong bao gio redirect khi URI hong — redirectable phai false', () => {
    // Loi sai kinh dien: handler nao do bat loi roi redirect toi redirect_uri
    // chua duoc xac minh => open redirect. Loi phai ra `redirectable=false`.
    let thrown: unknown;
    try {
      assertRegisteredRedirectUri('https://evil.example/cb', ['https://app.example/cb'], {
        kind: 'exact',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(OAuthProtocolError);
    expect((thrown as OAuthProtocolError).redirectable).toBe(false);
  });

  it('chi mot trong nhieu URI dang ky khop duoc chon', () => {
    const registered = ['https://a.example/cb', 'https://b.example/cb'];
    expect(() =>
      assertRegisteredRedirectUri('https://b.example/cb', registered, { kind: 'exact' }),
    ).not.toThrow();
  });
});
