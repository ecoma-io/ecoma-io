import { OAuthProtocolError } from '../shared/errors';
import {
  MAX_NONCE_LENGTH_BYTES,
  MAX_STATE_LENGTH_BYTES,
  assertTransition,
  canTransition,
  filterAllowedScopes,
  isTerminal,
  parseAuthorizationRequest,
} from '../index';

/**
 * Trần byte cho `state`/`nonce` là một phần của hợp đồng persistence C1:
 * giá trị được lưu thẳng vào `db-auth` và phản chiếu vào `Location` header.
 * Trần phải tính bằng UTF-8 BYTE (không phải ký tự) — chuỗi Unicode ngắn về
 * ký tự vẫn có thể vượt byte, và chỉ kiểm `.length` là chặn hụt.
 */

const BASE_PARAMS = {
  clientId: 'client-1',
  codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  codeChallengeMethod: 'S256',
  redirectUri: 'https://app.example.com/cb',
  responseType: 'code',
  scope: 'openid',
} as const;

/** Bắt lỗi từ một hàm có thể ném, để assert ngoài khối ném — tránh `no-conditional-expect`. */
function captureProtocolError(thrower: () => unknown): unknown {
  try {
    thrower();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('parseAuthorizationRequest — state/nonce byte limits', () => {
  it('accepts state at exactly 512 bytes (boundary is inclusive)', () => {
    expect.hasAssertions();
    const request = parseAuthorizationRequest({
      ...BASE_PARAMS,
      nonce: undefined,
      state: 'a'.repeat(MAX_STATE_LENGTH_BYTES),
    });
    expect(request.state).toBe('a'.repeat(MAX_STATE_LENGTH_BYTES));
  });

  it('accepts nonce at exactly 512 bytes', () => {
    expect.hasAssertions();
    const request = parseAuthorizationRequest({
      ...BASE_PARAMS,
      nonce: 'n'.repeat(MAX_NONCE_LENGTH_BYTES),
      state: undefined,
    });
    expect(request.nonce).toBe('n'.repeat(MAX_NONCE_LENGTH_BYTES));
  });

  it('rejects state at 513 bytes — one over the limit', () => {
    expect.hasAssertions();
    expect(() =>
      parseAuthorizationRequest({
        ...BASE_PARAMS,
        state: 'a'.repeat(MAX_STATE_LENGTH_BYTES + 1),
      }),
    ).toThrow(OAuthProtocolError);
  });

  it('rejects a SHORT-character-count state that exceeds 512 UTF-8 bytes (multi-byte trap)', () => {
    expect.hasAssertions();
    // Mỗi 'ế' là 3 byte UTF-8. 171 ký tự x 3 = 513 byte > 512, trong khi
    // .length === 171 << 512. Đây chính là lỗi "chặn hụt" nếu ai đó đo bằng
    // .length thay vì byte.
    const multibyteState = 'ế'.repeat(171);
    expect(multibyteState.length).toBeLessThan(MAX_STATE_LENGTH_BYTES);
    expect(new TextEncoder().encode(multibyteState)).toHaveLength(MAX_STATE_LENGTH_BYTES + 1);
    expect(() =>
      parseAuthorizationRequest({
        ...BASE_PARAMS,
        state: multibyteState,
      }),
    ).toThrow(OAuthProtocolError);
  });

  it('accepts a multi-byte state within the byte limit', () => {
    expect.hasAssertions();
    const withinLimit = 'ế'.repeat(170), // 510 byte
      request = parseAuthorizationRequest({
        ...BASE_PARAMS,
        state: withinLimit,
      });
    expect(request.state).toBe(withinLimit);
  });

  it('rejects an over-limit nonce', () => {
    expect.hasAssertions();
    expect(() =>
      parseAuthorizationRequest({
        ...BASE_PARAMS,
        nonce: 'x'.repeat(MAX_NONCE_LENGTH_BYTES + 1),
      }),
    ).toThrow(OAuthProtocolError);
  });

  it('leaves both absent when the client sends neither (optional per RFC 6749)', () => {
    expect.hasAssertions();
    const request = parseAuthorizationRequest({
      ...BASE_PARAMS,
      nonce: undefined,
      state: undefined,
    });
    expect(request.state).toBeUndefined();
    expect(request.nonce).toBeUndefined();
  });

  it('still rejects malformed PKCE before the byte limit matters — order is unchanged', () => {
    expect.hasAssertions();
    // Trần byte nằm SAU PKCE parse; thiếu code_challenge phải vẫn là lỗi
    // Đầu tiên được thấy, không phải lỗi trần byte.
    expect(() =>
      parseAuthorizationRequest({
        ...BASE_PARAMS,
        codeChallenge: undefined,
        codeChallengeMethod: undefined,
        state: 'a'.repeat(MAX_STATE_LENGTH_BYTES + 1),
      }),
    ).toThrow(OAuthProtocolError);
  });
});

describe('filterAllowedScopes — invalid_scope policy', () => {
  it('rejects a scope outside the allowed list with invalid_scope, redirectable', () => {
    expect.hasAssertions();
    // ⚠️ Hàm này chạy SAU khi `redirect_uri` đã khớp bản đăng ký, nên mặc
    // Định lỗi được redirect về `redirect_uri` kèm mã `invalid_scope` theo
    // RFC 6749 §4.1.2.1 — không phải `invalid_request`.
    expect(() => filterAllowedScopes(['openid', 'admin'], ['openid', 'profile'])).toThrow(
      expect.objectContaining({ code: 'invalid_scope', redirectable: true }),
    );
  });

  it('returns a direct (non-redirectable) invalid_scope error when redirectable is false', () => {
    expect.hasAssertions();
    expect(() => filterAllowedScopes(['admin'], ['openid'], { redirectable: false })).toThrow(
      expect.objectContaining({ code: 'invalid_scope', redirectable: false }),
    );
  });

  it('passes an allowed list through unchanged and preserves order', () => {
    expect.hasAssertions();
    expect(filterAllowedScopes(['profile', 'openid'], ['openid', 'profile'])).toStrictEqual([
      'profile',
      'openid',
    ]);
  });
});

describe('parseAuthorizationRequest — scope is required (strict policy)', () => {
  it('rejects a missing scope with a direct invalid_request', () => {
    expect.hasAssertions();
    // ⚠️ Tại bước parse, `redirect_uri` CHƯA được xác minh với bản đăng ký,
    // Nên mọi lỗi đều không được redirect — kể cả lỗi scope.
    expect(() => parseAuthorizationRequest({ ...BASE_PARAMS, scope: undefined })).toThrow(
      expect.objectContaining({ code: 'invalid_request', redirectable: false }),
    );
  });

  it('rejects an empty scope with a direct invalid_request', () => {
    expect.hasAssertions();
    expect(() => parseAuthorizationRequest({ ...BASE_PARAMS, scope: '' })).toThrow(
      expect.objectContaining({ code: 'invalid_request', redirectable: false }),
    );
  });

  it('rejects a whitespace-only scope with a direct invalid_request', () => {
    expect.hasAssertions();
    expect(() => parseAuthorizationRequest({ ...BASE_PARAMS, scope: '   ' })).toThrow(
      expect.objectContaining({ code: 'invalid_request', redirectable: false }),
    );
  });

  it('splits the scope on spaces into an ordered list', () => {
    expect.hasAssertions();
    const request = parseAuthorizationRequest({ ...BASE_PARAMS, scope: 'openid profile' });
    expect(request.scope).toStrictEqual(['openid', 'profile']);
  });

  it('reports the scope error before a missing code_challenge — check order is unchanged', () => {
    expect.hasAssertions();
    // Khi cả `scope` lẫn PKCE đều sai, lỗi đầu tiên phải là lỗi scope: nó nằm
    // Trước parse PKCE trong chuỗi kiểm tra của parseAuthorizationRequest.
    const error = captureProtocolError(() =>
      parseAuthorizationRequest({
        ...BASE_PARAMS,
        codeChallenge: undefined,
        codeChallengeMethod: undefined,
        scope: '   ',
      }),
    );
    expect(error).toBeInstanceOf(OAuthProtocolError);
    expect((error as OAuthProtocolError).message).toContain('scope is required');
  });
});

describe('parseAuthorizationRequest — required params and unsupported values', () => {
  it('rejects a missing response_type with a direct invalid_request', () => {
    expect.hasAssertions();
    expect(() => parseAuthorizationRequest({ ...BASE_PARAMS, responseType: undefined })).toThrow(
      expect.objectContaining({ code: 'invalid_request', redirectable: false }),
    );
  });

  it('rejects an unsupported response_type (implicit is banned, §3.1)', () => {
    expect.hasAssertions();
    expect(() => parseAuthorizationRequest({ ...BASE_PARAMS, responseType: 'token' })).toThrow(
      expect.objectContaining({ code: 'invalid_request', redirectable: false }),
    );
  });

  it('rejects a missing client_id — no client to look up', () => {
    expect.hasAssertions();
    expect(() => parseAuthorizationRequest({ ...BASE_PARAMS, clientId: undefined })).toThrow(
      expect.objectContaining({ code: 'invalid_request', redirectable: false }),
    );
  });

  it('rejects an empty client_id', () => {
    expect.hasAssertions();
    expect(() => parseAuthorizationRequest({ ...BASE_PARAMS, clientId: '' })).toThrow(
      expect.objectContaining({ code: 'invalid_request', redirectable: false }),
    );
  });

  it('rejects a missing redirect_uri', () => {
    expect.hasAssertions();
    expect(() => parseAuthorizationRequest({ ...BASE_PARAMS, redirectUri: undefined })).toThrow(
      expect.objectContaining({ code: 'invalid_request', redirectable: false }),
    );
  });

  it('rejects a malformed redirect_uri (not a URL)', () => {
    expect.hasAssertions();
    expect(() => parseAuthorizationRequest({ ...BASE_PARAMS, redirectUri: 'not a url' })).toThrow(
      expect.objectContaining({ code: 'invalid_request', redirectable: false }),
    );
  });

  it('reports response_type before client_id — check order is unchanged', () => {
    expect.hasAssertions();
    const error = captureProtocolError(() =>
      parseAuthorizationRequest({
        ...BASE_PARAMS,
        clientId: undefined,
        redirectUri: undefined,
        responseType: undefined,
      }),
    );
    expect(error).toBeInstanceOf(OAuthProtocolError);
    expect((error as OAuthProtocolError).message).toContain('response_type');
  });
});

describe('authorization state machine — 6 canonical states (C1)', () => {
  // ⚠️ Bảng chuyển tiếp là một nửa hợp đồng state machine C1: CHECK trong
  // Db-auth chỉ là allowlist giá trị, còn "bước nào đi được tới đâu" nằm ở
  // Đây. Máy MỘT CHIỀU — terminal không có đường ra — là cái bảo đảm "code
  // Chỉ cấp một lần" là hệ quả của máy trạng thái chứ không phải một kiểm tra
  // Rời có thể quên.

  it('walks the happy path: pending_browser to completed, one legal step at a time', () => {
    expect.hasAssertions();
    expect(canTransition('pending_browser', 'browser_confirmed')).toBe(true);
    expect(canTransition('browser_confirmed', 'awaiting_consent')).toBe(true);
    expect(canTransition('awaiting_consent', 'ready_to_complete')).toBe(true);
    expect(canTransition('ready_to_complete', 'completed')).toBe(true);
  });

  it('allows the denied exits at every non-pending stage (access_denied path)', () => {
    expect.hasAssertions();
    expect(canTransition('browser_confirmed', 'denied')).toBe(true);
    expect(canTransition('awaiting_consent', 'denied')).toBe(true);
    expect(canTransition('ready_to_complete', 'denied')).toBe(true);
  });

  it('never exits a terminal state — completed and denied are sinks', () => {
    expect.hasAssertions();
    const all = [
      'pending_browser',
      'browser_confirmed',
      'awaiting_consent',
      'ready_to_complete',
      'completed',
      'denied',
    ] as const;
    for (const target of all) {
      expect(canTransition('completed', target)).toBeFalsy();
      expect(canTransition('denied', target)).toBeFalsy();
    }
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('denied')).toBe(true);
  });

  it('rejects backward jumps and skips — no reset to pending_browser', () => {
    expect.hasAssertions();
    // Một bug của repository mà reset transaction về `pending_browser` là làm
    // Transaction DÙNG LẠI ĐƯỢC. Bất kỳ đường lui nào cũng phải bị chặn.
    expect(canTransition('browser_confirmed', 'pending_browser')).toBeFalsy();
    expect(canTransition('awaiting_consent', 'pending_browser')).toBeFalsy();
    expect(canTransition('awaiting_consent', 'browser_confirmed')).toBeFalsy();
    expect(canTransition('completed', 'pending_browser')).toBeFalsy();
    // Nhảy cóc cũng bị chặn: pending_browser chỉ tới browser_confirmed.
    expect(canTransition('pending_browser', 'ready_to_complete')).toBeFalsy();
    expect(canTransition('pending_browser', 'completed')).toBeFalsy();
    expect(canTransition('browser_confirmed', 'completed')).toBeFalsy();
  });

  it('assertTransition throws a direct (non-redirectable) protocol error on an illegal step', () => {
    expect.hasAssertions();
    expect(() => assertTransition('denied', 'pending_browser')).toThrow(OAuthProtocolError);
  });
});
