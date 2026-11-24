import {
  LOGIN_HANDOFF_TRANSITIONS,
  LOGIN_HANDOFF_TTL_SECONDS,
  LoginHandoff,
} from './login-handoff';
import type { HandleHash, LoginHandoffSnapshot } from './login-handoff';
import type { SessionRef } from '../browser-session/browser-session';

const HANDLE = 'a'.repeat(64) as HandleHash,
  NOW = 1_700_000_000_000,
  REF_A = 'session-a' as SessionRef,
  REF_B = 'session-b' as SessionRef;

function bound(overrides?: { now?: number; ttlSeconds?: number }): LoginHandoff {
  const result = LoginHandoff.fromFirstBind({
    handleHash: HANDLE,
    now: overrides?.now ?? NOW,
    sessionRef: REF_A,
    ttlSeconds: overrides?.ttlSeconds,
    won: true,
  });
  return result as LoginHandoff;
}

function reconstitute(
  snapshot: Partial<LoginHandoffSnapshot> &
    Pick<LoginHandoffSnapshot, 'handleHash' | 'sessionRef' | 'state'>,
): LoginHandoff {
  return LoginHandoff.reconstitute({
    expiresAt: NOW + LOGIN_HANDOFF_TTL_SECONDS * 1000,
    ...snapshot,
  });
}

describe('loginHandoff.fromFirstBind', () => {
  it('winner gets a bound aggregate', () => {
    expect.hasAssertions();
    const h = bound();
    expect(h.state()).toBe('bound');
    expect(h.handleHash()).toBe(HANDLE);
    expect(h.sessionRef()).toBe(REF_A);
    expect(h.expiresAt()).toBe(NOW + LOGIN_HANDOFF_TTL_SECONDS * 1000);
  });

  it('loser gets the winner identity, not an aggregate', () => {
    expect.hasAssertions();
    const result = LoginHandoff.fromFirstBind({
      handleHash: HANDLE,
      now: NOW,
      sessionRef: REF_B,
      winnerSessionRef: REF_A,
      won: false,
    });
    expect(result).toStrictEqual({ alreadyBound: REF_A });
  });

  it('loser without winnerSessionRef is a protocol violation', () => {
    expect.hasAssertions();
    expect(() =>
      LoginHandoff.fromFirstBind({
        handleHash: HANDLE,
        now: NOW,
        sessionRef: REF_B,
        won: false,
      }),
    ).toThrow(TypeError);
  });
});

describe('loginHandoff.rotateTo', () => {
  it('bound → session_rotated once, carrying the new session', () => {
    expect.hasAssertions();
    const h = bound();
    h.rotateTo(REF_B, NOW + 1000);
    expect(h.state()).toBe('session_rotated');
    expect(h.sessionRef()).toBe(REF_B);
  });

  it('second rotation returns invalid_transition (protocol violation)', () => {
    expect.hasAssertions();
    const h = bound();
    expect(h.rotateTo(REF_B, NOW + 1000)).toBeUndefined();
    expect(h.rotateTo(REF_A, NOW + 1000)).toMatchObject({ code: 'invalid_transition' });
  });

  it('rotation after TTL returns domain error', () => {
    expect.hasAssertions();
    const h = bound({ ttlSeconds: 1 }),
      err = h.rotateTo(REF_B, NOW + 2000);
    expect(err).toMatchObject({ code: 'session_expired' });
  });
});

describe('loginHandoff.consume — classification order', () => {
  it('consumes with the bound session ref', () => {
    expect.hasAssertions();
    const h = bound();
    expect(h.consume(REF_A, NOW + 1000)).toStrictEqual({ consumed: true });
    expect(h.state()).toBe('consumed');
  });

  it('binding mismatch before expiry/terminal classification', () => {
    expect.hasAssertions();
    const h = bound();
    expect(h.consume(REF_B, NOW + 1000)).toStrictEqual({ rejected: 'binding_mismatch' });
    expect(h.state()).toBe('bound');
  });

  it('wrong session on an expired handoff still reports mismatch, not expired', () => {
    expect.hasAssertions();
    const h = bound({ ttlSeconds: 1 });
    expect(h.consume(REF_B, NOW + 2000)).toStrictEqual({ rejected: 'binding_mismatch' });
  });

  it('wrong session on a consumed handoff still reports mismatch, not terminal', () => {
    expect.hasAssertions();
    const h = bound();
    h.consume(REF_A, NOW + 1000);
    expect(h.consume(REF_B, NOW + 1000)).toStrictEqual({ rejected: 'binding_mismatch' });
  });

  it('expired handoff is rejected even with the right ref', () => {
    expect.hasAssertions();
    const h = bound({ ttlSeconds: 1 });
    expect(h.consume(REF_A, NOW + 2000)).toStrictEqual({ rejected: 'expired' });
  });

  it('consumed handoff is terminal', () => {
    expect.hasAssertions();
    const h = bound();
    h.consume(REF_A, NOW + 1000);
    expect(h.consume(REF_A, NOW + 1000)).toStrictEqual({ rejected: 'terminal' });
  });

  it('consume after rotation uses the NEW session ref', () => {
    expect.hasAssertions();
    const h = bound();
    h.rotateTo(REF_B, NOW + 1000);
    expect(h.consume(REF_A, NOW + 1000)).toStrictEqual({ rejected: 'binding_mismatch' });
    expect(h.consume(REF_B, NOW + 1000)).toStrictEqual({ consumed: true });
  });
});

describe('loginHandoff.transition table', () => {
  it('expired is not a persisted state — TTL is time-derived', () => {
    expect.hasAssertions();
    expect(LOGIN_HANDOFF_TRANSITIONS.bound).toStrictEqual(['session_rotated']);
    expect(LOGIN_HANDOFF_TRANSITIONS.session_rotated).toStrictEqual(['consumed']);
    expect(LOGIN_HANDOFF_TRANSITIONS.consumed).toStrictEqual([]);
  });

  it('reconstitute rejects a persisted expired state', () => {
    expect.hasAssertions();
    expect(() =>
      reconstitute({
        handleHash: HANDLE,
        sessionRef: REF_A,
        state: 'expired' as LoginHandoffSnapshot['state'],
      }),
    ).toThrow(TypeError);
  });
});

describe('loginHandoff.reconstitute', () => {
  it('round-trips through snapshot', () => {
    expect.hasAssertions();
    const h = bound();
    h.rotateTo(REF_B, NOW + 1000);
    const restored = reconstitute(h.snapshot());
    expect(restored.equals(h)).toBe(true);
    expect(restored.state()).toBe('session_rotated');
  });

  it('rejects an unknown state', () => {
    expect.hasAssertions();
    expect(() =>
      reconstitute({
        handleHash: HANDLE,
        sessionRef: REF_A,
        state: 'weird' as LoginHandoffSnapshot['state'],
      }),
    ).toThrow(TypeError);
  });
});

describe('loginHandoff identity', () => {
  it('equals by handle hash only', () => {
    expect.hasAssertions();
    const a = bound(),
      b = bound();
    a.rotateTo(REF_B, NOW + 1000);
    expect(a.equals(b)).toBe(true);
    const other = LoginHandoff.fromFirstBind({
      handleHash: 'b'.repeat(64) as HandleHash,
      now: NOW,
      sessionRef: REF_A,
      won: true,
    }) as LoginHandoff;
    expect(a.equals(other)).toBeFalsy();
    expect(a.equals('nope')).toBeFalsy();
  });
});

describe('loginHandoff validation (F5/Add#4)', () => {
  it('rejects a handleHash that is not 64-hex on reconstitute', () => {
    expect.hasAssertions();
    expect(() =>
      reconstitute({ handleHash: 'short' as HandleHash, sessionRef: REF_A, state: 'bound' }),
    ).toThrow(TypeError);
  });

  it('fromFirstBind rejects a non-finite or non-positive ttlSeconds', () => {
    expect.hasAssertions();
    expect(() =>
      LoginHandoff.fromFirstBind({
        handleHash: HANDLE,
        now: NOW,
        sessionRef: REF_A,
        ttlSeconds: Number.NaN,
        won: true,
      }),
    ).toThrow(TypeError);
    expect(() =>
      LoginHandoff.fromFirstBind({
        handleHash: HANDLE,
        now: NOW,
        sessionRef: REF_A,
        ttlSeconds: -1,
        won: true,
      }),
    ).toThrow(TypeError);
  });
});

describe('loginHandoff.fromFirstBind handleHash shape (adversarial P3)', () => {
  it('rejects a non-hex handleHash on the won branch', () => {
    expect.hasAssertions();
    expect(() =>
      LoginHandoff.fromFirstBind({
        handleHash: 'zzz' as HandleHash,
        now: NOW,
        sessionRef: REF_A,
        won: true,
      }),
    ).toThrow(TypeError);
  });
});

describe('loginHandoff invalid-input guards (adversarial P1)', () => {
  it('rotateTo with a non-finite now or an empty ref returns a domain error without mutation', () => {
    expect.hasAssertions();
    const h = bound();
    expect(h.rotateTo(REF_B, Number.NaN)).toMatchObject({ code: 'invalid_transition' });
    expect(h.rotateTo('' as SessionRef, NOW + 100)).toMatchObject({
      code: 'invalid_transition',
    });
    expect(h.state()).toBe('bound');
    expect(h.sessionRef()).toBe(REF_A);
    // Vẫn rotate được sau input hợp lệ.
    expect(h.rotateTo(REF_B, NOW + 100)).toBeUndefined();
  });

  it('rotateTo cannot rebind via invalid input after rotation (state guard still first-class)', () => {
    expect.hasAssertions();
    const h = bound();
    expect(h.rotateTo(REF_B, NOW + 100)).toBeUndefined();
    expect(h.rotateTo(REF_A, Number.NaN)).toMatchObject({ code: 'invalid_transition' });
    expect(h.sessionRef()).toBe(REF_B);
  });

  it('consume with a non-finite now or garbage ref is binding_mismatch without mutation', () => {
    expect.hasAssertions();
    const h = bound();
    expect(h.consume('' as SessionRef, NOW + 100)).toStrictEqual({ rejected: 'binding_mismatch' });
    expect(h.consume(REF_A, Number.NaN)).toStrictEqual({ rejected: 'binding_mismatch' });
    expect(h.state()).toBe('bound');
    // Không leak lifecycle: mismatch-first ngay cả khi input rác + terminal.
    const consumed = bound();
    expect(consumed.consume(REF_A, NOW)).toStrictEqual({ consumed: true });
    expect(consumed.consume('garbage' as SessionRef, Number.NaN)).toStrictEqual({
      rejected: 'binding_mismatch',
    });
  });
});

test('fromFirstBind rejects a ttlSeconds that overflows expiresAt to Infinity', () => {
  expect.hasAssertions();
  expect(() =>
    LoginHandoff.fromFirstBind({
      handleHash: HANDLE,
      now: NOW,
      sessionRef: REF_A,
      ttlSeconds: 1e308,
      won: true,
    }),
  ).toThrow(TypeError);
});

test('fromFirstBind rejects an empty sessionRef on the won branch', () => {
  expect.hasAssertions();
  expect(() =>
    LoginHandoff.fromFirstBind({
      handleHash: HANDLE,
      now: NOW,
      sessionRef: '' as SessionRef,
      won: true,
    }),
  ).toThrow(TypeError);
});
