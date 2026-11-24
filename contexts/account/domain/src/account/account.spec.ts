import { ACCOUNT_STATUS } from './account-status';
import { Account } from './account';
import type { AccountSnapshot } from './account';
import type { EmailAddressKey } from '../email-address/email-address-key';
import { createSubject } from './subject';

const SUB = createSubject('abcdefghijklmnopqrstuvwxyz234567'),
  EMAIL = 'a'.repeat(64) as EmailAddressKey,
  EMAIL2 = 'b'.repeat(64) as EmailAddressKey,
  NOW = 1_700_000_000_000;

function account(): Account {
  return Account.provisionFromInvitation({
    emailKey: EMAIL,
    now: NOW,
    subject: SUB,
  });
}

function snapshotWith(overrides: Partial<AccountSnapshot>): AccountSnapshot {
  return { createdAt: NOW, emails: [], status: 'active', subject: SUB, ...overrides };
}

describe('account.provisionFromInvitation', () => {
  it('starts active with one verified email', () => {
    expect.hasAssertions();
    const a = account();
    expect(a.id).toBe(SUB);
    expect(a.status()).toBe('active');
    expect(a.hasVerifiedEmail()).toBe(true);
    expect(a.emails()).toHaveLength(1);
    expect(a.emails()[0]?.state).toBe('verified');
    expect(a.emails()[0]?.verifiedAt).toBe(NOW);
  });
});

describe('account lifecycle', () => {
  it('active → suspended → active', () => {
    expect.hasAssertions();
    const a = account();
    expect(a.suspend()).toBeUndefined();
    expect(a.status()).toBe('suspended');
    expect(a.reactivate()).toBeUndefined();
    expect(a.status()).toBe('active');
  });

  it('suspend on suspended returns invalid_transition', () => {
    expect.hasAssertions();
    const a = account();
    a.suspend();
    expect(a.suspend()).toMatchObject({ code: 'invalid_transition' });
  });

  it('reactivate on active returns invalid_transition', () => {
    expect.hasAssertions();
    expect(account().reactivate()).toMatchObject({ code: 'invalid_transition' });
  });

  it('active → deleted, and deleted is terminal', () => {
    expect.hasAssertions();
    const a = account();
    expect(a.delete()).toBeUndefined();
    expect(a.status()).toBe(ACCOUNT_STATUS.Deleted);
    expect(a.suspend()).toMatchObject({ code: 'account_deleted' });
    expect(a.reactivate()).toMatchObject({ code: 'account_deleted' });
    expect(a.delete()).toMatchObject({ code: 'account_deleted' });
  });
});

describe('account email collection', () => {
  it('registers a pending email', () => {
    expect.hasAssertions();
    const a = account();
    expect(a.registerEmail(EMAIL2, NOW + 1000)).toBeUndefined();
    const view = a.emails().find((e) => e.key === EMAIL2);
    expect(view?.state).toBe('pending');
  });

  it('rejects duplicate registration', () => {
    expect.hasAssertions();
    const a = account(),
      err = a.registerEmail(EMAIL, NOW + 1000);
    expect(err).toMatchObject({ code: 'email_already_registered' });
  });

  it('pending → verified', () => {
    expect.hasAssertions();
    const a = account();
    a.registerEmail(EMAIL2, NOW + 1000);
    expect(a.markEmailVerified(EMAIL2, NOW + 2000)).toBeUndefined();
    expect(a.emails().find((e) => e.key === EMAIL2)?.state).toBe('verified');
  });

  it('markEmailVerified rejects non-pending and unknown emails', () => {
    expect.hasAssertions();
    const a = account();
    expect(a.markEmailVerified(EMAIL2, NOW + 1000)).toMatchObject({ code: 'email_not_found' });
    expect(a.markEmailVerified(EMAIL, NOW + 1000)).toMatchObject({ code: 'email_not_pending' });
  });

  it('blocks revoking the last verified email', () => {
    expect.hasAssertions();
    const a = account(),
      err = a.revokeEmail(EMAIL, NOW + 1000);
    expect(err).toMatchObject({ code: 'last_verified_email' });
    expect(a.hasVerifiedEmail()).toBe(true);
  });

  it('allows revoking when another verified email exists', () => {
    expect.hasAssertions();
    const a = account();
    a.registerEmail(EMAIL2, NOW + 1000);
    a.markEmailVerified(EMAIL2, NOW + 2000);
    expect(a.revokeEmail(EMAIL, NOW + 3000)).toBeUndefined();
    expect(a.emails().find((e) => e.key === EMAIL)?.state).toBe('revoked');
    expect(a.hasVerifiedEmail()).toBe(true);
  });

  it('revoke is idempotent on already-revoked', () => {
    expect.hasAssertions();
    const a = account();
    a.registerEmail(EMAIL2, NOW + 1000);
    a.markEmailVerified(EMAIL2, NOW + 2000);
    a.revokeEmail(EMAIL, NOW + 3000);
    expect(a.revokeEmail(EMAIL, NOW + 4000)).toBeUndefined();
  });

  it('pending → revoked directly is allowed', () => {
    expect.hasAssertions();
    const a = account();
    a.registerEmail(EMAIL2, NOW + 1000);
    expect(a.revokeEmail(EMAIL2, NOW + 2000)).toBeUndefined();
    expect(a.emails().find((e) => e.key === EMAIL2)?.state).toBe('revoked');
  });

  it('no email mutations on a tombstone', () => {
    expect.hasAssertions();
    const a = account();
    a.delete();
    expect(a.registerEmail(EMAIL2, NOW + 2000)).toMatchObject({ code: 'account_deleted' });
    expect(a.markEmailVerified(EMAIL, NOW + 2000)).toMatchObject({ code: 'account_deleted' });
    expect(a.revokeEmail(EMAIL, NOW + 2000)).toMatchObject({ code: 'account_deleted' });
  });
});

describe('account encapsulation', () => {
  it('emails() returns copies, not live references', () => {
    expect.hasAssertions();
    const a = account(),
      views = a.emails(),
      view = a.emails()[0];
    if (view) {
      (view as { state: string }).state = 'revoked';
    }
    expect(a.emails()[0]?.state).toBe('verified');
    expect(views).not.toBe(a.emails());
  });
});

describe('account.reconstitute', () => {
  it('round-trips through snapshot', () => {
    expect.hasAssertions();
    const a = account();
    a.registerEmail(EMAIL2, NOW + 1000);
    const restored = Account.reconstitute(a.snapshot());
    expect(restored.id).toBe(SUB);
    expect(restored.status()).toBe('active');
    expect(restored.emails()).toStrictEqual(a.emails());
  });

  it('rejects an unknown status', () => {
    expect.hasAssertions();
    expect(() =>
      Account.reconstitute({ ...snapshotWith({ status: 'weird' as AccountSnapshot['status'] }) }),
    ).toThrow(TypeError);
  });

  it('rejects corrupt email snapshots (pair-check)', () => {
    expect.hasAssertions();
    expect(() =>
      Account.reconstitute(
        snapshotWith({
          emails: [
            {
              addedAt: NOW,
              key: EMAIL,
              revokedAt: null,
              state: 'verified',
              verifiedAt: null,
            },
          ],
        }),
      ),
    ).toThrow(TypeError);
    expect(() =>
      Account.reconstitute(
        snapshotWith({
          emails: [
            { addedAt: NOW, key: EMAIL, revokedAt: null, state: 'pending', verifiedAt: NOW },
          ],
        }),
      ),
    ).toThrow(TypeError);
    expect(() =>
      Account.reconstitute(
        snapshotWith({
          emails: [
            {
              addedAt: NOW,
              key: EMAIL,
              revokedAt: null,
              state: 'revoked',
              verifiedAt: null,
            },
          ],
        }),
      ),
    ).toThrow(TypeError);
  });
});

describe('account.provisionFromInvitation guards (adversarial fixes)', () => {
  it('rejects a garbage subject and a non-hash emailKey', () => {
    expect.hasAssertions();
    expect(() =>
      Account.provisionFromInvitation({
        emailKey: EMAIL,
        now: NOW,
        subject: 'x' as never,
      }),
    ).toThrow(TypeError);
    expect(() =>
      Account.provisionFromInvitation({
        emailKey: 'not-a-hash' as never,
        now: NOW,
        subject: SUB,
      }),
    ).toThrow(TypeError);
    expect(() =>
      Account.provisionFromInvitation({
        emailKey: EMAIL,
        now: Number.NaN,
        subject: SUB,
      }),
    ).toThrow(TypeError);
  });

  it('rejects a snapshot email whose key is not a hash (via reconstitute)', () => {
    expect.hasAssertions();
    expect(() =>
      Account.reconstitute(
        snapshotWith({
          emails: [
            {
              addedAt: NOW,
              key: 'plain@example.com' as never,
              revokedAt: null,
              state: 'pending',
              verifiedAt: null,
            },
          ],
        }),
      ),
    ).toThrow(TypeError);
  });
});

describe('account identity', () => {
  it('equals by Subject (inherited Entity equality)', () => {
    expect.hasAssertions();
    const a = account(),
      b = Account.reconstitute(a.snapshot());
    expect(a.equals(b)).toBe(true);
    const otherSub = createSubject('abcdefghij234567abcdefghij234567'),
      c = Account.provisionFromInvitation({
        emailKey: EMAIL as EmailAddressKey,
        now: NOW,
        subject: otherSub,
      });
    expect(a.equals(c)).toBeFalsy();
    expect(a.equals('nope')).toBeFalsy();
  });
});

const dupVerifiedEmail = (key: string) => ({
  addedAt: NOW,
  key: key as never,
  revokedAt: null,
  state: 'verified' as const,
  verifiedAt: NOW,
});

describe('account.reconstitute guards (adversarial fixes)', () => {
  it('rejects duplicate email keys instead of silently deduping', () => {
    expect.hasAssertions();
    expect(() =>
      Account.reconstitute({
        createdAt: NOW,
        emails: [dupVerifiedEmail('c'.repeat(64)), dupVerifiedEmail('c'.repeat(64))],
        status: 'active',
        subject: SUB,
      }),
    ).toThrow(TypeError);
  });
});

describe('account behavior-side ordering guards (F6)', () => {
  it('markEmailVerified rejects now before addedAt', () => {
    expect.hasAssertions();
    const a = account();
    a.registerEmail(EMAIL2, NOW + 1000);
    expect(a.markEmailVerified(EMAIL2, NOW + 999)).toMatchObject({ code: 'invalid_transition' });
    expect(a.emails().find((e) => e.key === EMAIL2)?.state).toBe('pending');
  });

  it('markEmailVerified rejects non-finite now', () => {
    expect.hasAssertions();
    const a = account();
    a.registerEmail(EMAIL2, NOW + 1000);
    expect(a.markEmailVerified(EMAIL2, Number.NaN)).toMatchObject({ code: 'invalid_transition' });
  });

  it('revokeEmail rejects now before addedAt', () => {
    expect.hasAssertions();
    const a = account();
    a.registerEmail(EMAIL2, NOW + 1000);
    expect(a.revokeEmail(EMAIL2, NOW + 999)).toMatchObject({ code: 'invalid_transition' });
    expect(a.emails().find((e) => e.key === EMAIL2)?.state).toBe('pending');
  });

  it('registerEmail rejects non-finite now', () => {
    expect.hasAssertions();
    const a = account();
    expect(a.registerEmail(EMAIL2, Number.NaN)).toMatchObject({ code: 'invalid_transition' });
  });

  it('round-trips an email registered after provisioning and verified later', () => {
    expect.hasAssertions();
    const a = account();
    a.registerEmail(EMAIL2, NOW + 1000);
    a.markEmailVerified(EMAIL2, NOW + 2000);
    const restored = Account.reconstitute(a.snapshot());
    expect(restored.emails()).toStrictEqual(a.emails());
    expect(restored.emails().find((e) => e.key === EMAIL2)?.state).toBe('verified');
  });

  it('reconstitute rejects verifiedAt before addedAt (ordering fix)', () => {
    expect.hasAssertions();
    expect(() =>
      Account.reconstitute(
        snapshotWith({
          emails: [
            {
              addedAt: NOW + 1000,
              key: EMAIL,
              revokedAt: null,
              state: 'verified',
              verifiedAt: NOW,
            },
          ],
        }),
      ),
    ).toThrow(TypeError);
  });
});

describe('account revokeEmail vs verifiedAt ordering (adversarial P1)', () => {
  it('rejects revoke with now before verifiedAt (would create un-reconstitutable snapshot)', () => {
    expect.hasAssertions();
    const a = account();
    a.registerEmail(EMAIL2, NOW + 1000);
    a.markEmailVerified(EMAIL2, NOW + 2000);
    expect(a.revokeEmail(EMAIL2, NOW + 1500)).toMatchObject({ code: 'invalid_transition' });
    // Email vẫn verified — không partial mutation.
    expect(a.emails().find((e) => e.key === EMAIL2)?.state).toBe('verified');
  });

  it('allows revoke with now after verifiedAt and round-trips', () => {
    expect.hasAssertions();
    const a = account();
    a.registerEmail(EMAIL2, NOW + 1000);
    a.markEmailVerified(EMAIL2, NOW + 2000);
    expect(a.revokeEmail(EMAIL2, NOW + 3000)).toBeUndefined();
    const restored = Account.reconstitute(a.snapshot());
    expect(restored.emails().find((e) => e.key === EMAIL2)?.state).toBe('revoked');
  });
});

test('registerEmail rejects a malformed key without mutation', () => {
  expect.hasAssertions();
  const a = account();
  expect(a.registerEmail('garbage' as never, NOW + 1)).toMatchObject({
    code: 'invalid_transition',
  });
  expect(a.emails()).toHaveLength(1);
});
