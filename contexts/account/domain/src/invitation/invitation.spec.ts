import type { EmailAddressKey } from '../email-address/email-address-key';
import { hashAddressKey } from '../email-address/email-address-key';
import { normalizeEmailAddress } from '../email-address/normalized-email-address';
import type { InvitationId, InvitationState } from './invitation';
import { INVITATION_TRANSITIONS, Invitation } from './invitation';
import { createSubject } from '../account/subject';

const ID = 'inv-1' as InvitationId,
  SUB = createSubject('abcdefghijklmnopqrstuvwxyz234567'),
  NOW = 1_700_000_000_000;

let addressKey: EmailAddressKey;

beforeAll(async () => {
  addressKey = await hashAddressKey(normalizeEmailAddress('user@example.com'));
});

function issued(overrides?: { now?: number; ttlSeconds?: number }): Invitation {
  return Invitation.issue({
    addressKey,
    id: ID,
    now: overrides?.now ?? NOW,
    ttlSeconds: overrides?.ttlSeconds,
  });
}

describe('invitation.issue', () => {
  it('starts open with 7-day default TTL', () => {
    expect.hasAssertions();
    const inv = issued();
    expect(inv.state()).toBe('open');
    expect(inv.addressKey()).toBe(addressKey);
    expect(inv.issuedAt()).toBe(NOW);
    expect(inv.expiresAt()).toBe(NOW + 7 * 24 * 3600 * 1000);
  });

  it('rejects a non-finite now', () => {
    expect.hasAssertions();
    expect(() => Invitation.issue({ addressKey, id: ID, now: Number.NaN })).toThrow(TypeError);
  });
});

describe('invitation.accept', () => {
  it('open + unexpired → accepted', () => {
    expect.hasAssertions();
    const inv = issued();
    expect(inv.accept(NOW + 1000, SUB)).toStrictEqual({ accepted: true });
    expect(inv.state()).toBe('accepted');
  });

  it('expired invitation is rejected even when open', () => {
    expect.hasAssertions();
    const inv = issued({ ttlSeconds: 1 });
    expect(inv.accept(NOW + 2000, SUB)).toStrictEqual({ rejected: 'expired' });
    expect(inv.state()).toBe('open');
  });

  it('accepted invitation cannot be accepted again', () => {
    expect.hasAssertions();
    const inv = issued();
    inv.accept(NOW + 1000, SUB);
    expect(inv.accept(NOW + 1000, SUB)).toStrictEqual({ rejected: 'not_open' });
  });

  it('revoked invitation is rejected as not_open', () => {
    expect.hasAssertions();
    const inv = issued();
    inv.revoke();
    expect(inv.accept(NOW + 1000, SUB)).toStrictEqual({ rejected: 'not_open' });
  });
});

describe('invitation.isAcceptable', () => {
  it('true only for open, unexpired', () => {
    expect.hasAssertions();
    const inv = issued();
    expect(inv.isAcceptable(NOW + 1000)).toBe(true);
    inv.revoke();
    expect(inv.isAcceptable(NOW + 1000)).toBeFalsy();
  });

  it('false after expiry', () => {
    expect.hasAssertions();
    const inv = issued({ ttlSeconds: 1 });
    expect(inv.isAcceptable(NOW + 2000)).toBeFalsy();
  });
});

describe('invitation.revoke', () => {
  it('open → revoked', () => {
    expect.hasAssertions();
    const inv = issued();
    inv.revoke();
    expect(inv.state()).toBe('revoked');
  });

  it('returns domain error on non-open (protocol violation)', () => {
    expect.hasAssertions();
    const inv = issued();
    inv.revoke();
    expect(inv.revoke()).toMatchObject({ code: 'invalid_transition' });
  });
});

describe('invitation.expireIfExpired', () => {
  it('transitions once at expiry, false otherwise', () => {
    expect.hasAssertions();
    const inv = issued({ ttlSeconds: 1 });
    expect(inv.expireIfExpired(NOW)).toBeFalsy();
    expect(inv.expireIfExpired(NOW + 1000)).toBe(true);
    expect(inv.state()).toBe('expired');
    expect(inv.expireIfExpired(NOW + 1000)).toBeFalsy();
  });

  it('does not overwrite accepted', () => {
    expect.hasAssertions();
    const inv = issued({ ttlSeconds: 1 });
    inv.accept(NOW, SUB);
    expect(inv.expireIfExpired(NOW + 2000)).toBeFalsy();
    expect(inv.state()).toBe('accepted');
  });
});

describe('invitation.transition table', () => {
  it('open is the only non-terminal state', () => {
    expect.hasAssertions();
    expect(INVITATION_TRANSITIONS.open).toStrictEqual(['accepted', 'revoked', 'expired']);
    expect(INVITATION_TRANSITIONS.accepted).toStrictEqual([]);
    expect(INVITATION_TRANSITIONS.revoked).toStrictEqual([]);
    expect(INVITATION_TRANSITIONS.expired).toStrictEqual([]);
  });
});

describe('invitation.reconstitute', () => {
  it('round-trips through snapshot', () => {
    expect.hasAssertions();
    const inv = issued();
    inv.revoke();
    const restored = Invitation.reconstitute(inv.snapshot());
    expect(restored.equals(inv)).toBe(true);
    expect(restored.state()).toBe('revoked');
  });

  it('rejects unknown state and issuedAt > expiresAt', () => {
    expect.hasAssertions();
    expect(() =>
      Invitation.reconstitute({
        acceptedAt: null,
        acceptedSubject: null,
        addressKey,
        expiresAt: NOW + 1,
        id: ID,
        issuedAt: NOW,
        state: 'weird' as InvitationState,
      }),
    ).toThrow(TypeError);
    expect(() =>
      Invitation.reconstitute({
        acceptedAt: null,
        acceptedSubject: null,
        addressKey,
        expiresAt: NOW,
        id: ID,
        issuedAt: NOW + 10,
        state: 'open',
      }),
    ).toThrow(TypeError);
  });

  it('rejects NaN timestamps and a non-hash addressKey (adversarial fixes)', () => {
    expect.hasAssertions();
    expect(() =>
      Invitation.reconstitute({
        acceptedAt: null,
        acceptedSubject: null,
        addressKey,
        expiresAt: NOW + 1,
        id: ID,
        issuedAt: Number.NaN,
        state: 'open',
      }),
    ).toThrow(TypeError);
    expect(() =>
      Invitation.reconstitute({
        acceptedAt: null,
        acceptedSubject: null,
        addressKey: 'user@example.com' as never,
        expiresAt: NOW + 1,
        id: ID,
        issuedAt: NOW,
        state: 'open',
      }),
    ).toThrow(TypeError);
  });
});

describe('invitation identity', () => {
  it('equals by id; immutable fields do not change', () => {
    expect.hasAssertions();
    const a = issued(),
      b = issued();
    expect(a.equals(b)).toBe(true);
    const other = Invitation.issue({ addressKey, id: 'inv-2' as InvitationId, now: NOW });
    expect(a.equals(other)).toBeFalsy();
    expect(a.equals('nope')).toBeFalsy();
    const snapshot = a.snapshot();
    expect(snapshot.addressKey).toBe(addressKey);
    expect(snapshot.issuedAt).toBe(NOW);
  });
});

describe('invitation acceptance pair (F4)', () => {
  it('accept records acceptedAt + acceptedSubject together', () => {
    expect.hasAssertions();
    const inv = issued();
    expect(inv.accept(NOW + 1000, SUB)).toStrictEqual({ accepted: true });
    expect(inv.acceptedAt()).toBe(NOW + 1000);
    expect(inv.acceptedSubject()).toBe(SUB);
    const snap = inv.snapshot();
    expect(snap.acceptedAt).toBe(NOW + 1000);
    expect(snap.acceptedSubject).toBe(SUB);
  });

  it('reconstitute round-trips an accepted invitation', () => {
    expect.hasAssertions();
    const inv = issued();
    inv.accept(NOW + 1000, SUB);
    const restored = Invitation.reconstitute(inv.snapshot());
    expect(restored.state()).toBe('accepted');
    expect(restored.acceptedAt()).toBe(NOW + 1000);
    expect(restored.acceptedSubject()).toBe(SUB);
  });

  it('reconstitute rejects accepted state without the pair', () => {
    expect.hasAssertions();
    expect(() =>
      Invitation.reconstitute({
        acceptedAt: null,
        acceptedSubject: null,
        addressKey,
        expiresAt: NOW + 1000,
        id: ID,
        issuedAt: NOW,
        state: 'accepted',
      }),
    ).toThrow(TypeError);
    expect(() =>
      Invitation.reconstitute({
        acceptedAt: NOW + 100,
        acceptedSubject: null,
        addressKey,
        expiresAt: NOW + 1000,
        id: ID,
        issuedAt: NOW,
        state: 'accepted',
      }),
    ).toThrow(TypeError);
    expect(() =>
      Invitation.reconstitute({
        acceptedAt: null,
        acceptedSubject: SUB,
        addressKey,
        expiresAt: NOW + 1000,
        id: ID,
        issuedAt: NOW,
        state: 'accepted',
      }),
    ).toThrow(TypeError);
  });

  it('reconstitute rejects non-accepted state carrying the pair', () => {
    expect.hasAssertions();
    expect(() =>
      Invitation.reconstitute({
        acceptedAt: NOW + 100,
        acceptedSubject: SUB,
        addressKey,
        expiresAt: NOW + 1000,
        id: ID,
        issuedAt: NOW,
        state: 'open',
      }),
    ).toThrow(TypeError);
  });

  it('reconstitute rejects acceptedAt before issuedAt', () => {
    expect.hasAssertions();
    expect(() =>
      Invitation.reconstitute({
        acceptedAt: NOW - 1,
        acceptedSubject: SUB,
        addressKey,
        expiresAt: NOW + 1000,
        id: ID,
        issuedAt: NOW,
        state: 'accepted',
      }),
    ).toThrow(TypeError);
  });

  it('reconstitute rejects issuedAt === expiresAt (zero-length)', () => {
    expect.hasAssertions();
    expect(() =>
      Invitation.reconstitute({
        acceptedAt: null,
        acceptedSubject: null,
        addressKey,
        expiresAt: NOW,
        id: ID,
        issuedAt: NOW,
        state: 'open',
      }),
    ).toThrow(TypeError);
  });

  it('issue rejects a non-finite or non-positive ttlSeconds', () => {
    expect.hasAssertions();
    expect(() =>
      Invitation.issue({ addressKey, id: ID, now: NOW, ttlSeconds: Number.NaN }),
    ).toThrow(TypeError);
    expect(() => Invitation.issue({ addressKey, id: ID, now: NOW, ttlSeconds: 0 })).toThrow(
      TypeError,
    );
  });

  it('issue rejects an empty id and a non-hash addressKey', () => {
    expect.hasAssertions();
    expect(() => Invitation.issue({ addressKey, id: '' as InvitationId, now: NOW })).toThrow(
      TypeError,
    );
    expect(() =>
      Invitation.issue({ addressKey: 'not-a-hash' as EmailAddressKey, id: ID, now: NOW }),
    ).toThrow(TypeError);
  });
});

describe('invitation invalid-input guards (adversarial P1)', () => {
  it('accept with non-finite now or a garbage subject rejects without mutation', () => {
    expect.hasAssertions();
    const inv = issued();
    expect(inv.accept(Number.NaN, SUB)).toStrictEqual({ rejected: 'not_open' });
    expect(inv.accept(NOW, 'garbage' as never)).toStrictEqual({ rejected: 'not_open' });
    expect(inv.state()).toBe('open');
    expect(inv.acceptedAt()).toBeNull();
  });

  it('accept before issuedAt is rejected (would create un-reconstitutable acceptedAt)', () => {
    expect.hasAssertions();
    const inv = issued();
    expect(inv.accept(NOW - 1, SUB)).toStrictEqual({ rejected: 'not_open' });
    expect(inv.state()).toBe('open');
    expect(inv.acceptedAt()).toBeNull();
  });

  it('issue rejects a ttlSeconds that overflows expiresAt to Infinity', () => {
    expect.hasAssertions();
    expect(() => Invitation.issue({ addressKey, id: ID, now: NOW, ttlSeconds: 1e308 })).toThrow(
      TypeError,
    );
  });

  it('accept after expiry is rejected as expired', () => {
    expect.hasAssertions();
    const inv = issued({ ttlSeconds: 100 });
    expect(inv.accept(NOW + 100_000, SUB)).toStrictEqual({ rejected: 'expired' });
    expect(inv.state()).toBe('open');
  });

  it('expireIfExpired with non-finite now does not transition', () => {
    expect.hasAssertions();
    const inv = issued();
    expect(inv.expireIfExpired(Number.NaN)).toBeFalsy();
    expect(inv.state()).toBe('open');
    expect(inv.expireIfExpired(Number.POSITIVE_INFINITY)).toBeFalsy();
    expect(inv.state()).toBe('open');
  });

  it('reconstitute rejects acceptedAt === expiresAt (accept must precede expiry)', () => {
    expect.hasAssertions();
    expect(() =>
      Invitation.reconstitute({
        acceptedAt: NOW + 1000,
        acceptedSubject: SUB,
        addressKey,
        expiresAt: NOW + 1000,
        id: ID,
        issuedAt: NOW,
        state: 'accepted',
      }),
    ).toThrow(TypeError);
  });
});
