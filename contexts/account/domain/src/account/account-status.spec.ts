import {
  ACCOUNT_STATUS,
  ACCOUNT_STATUSES,
  isAccountStatus,
  isTerminalStatus,
  isTombstone,
} from '../account/account-status';

describe('accountStatus', () => {
  it('exposes exactly the three documented states', () => {
    expect.hasAssertions();
    expect(ACCOUNT_STATUSES).toHaveLength(3);
    expect(ACCOUNT_STATUSES).toContain('active');
    expect(ACCOUNT_STATUSES).toContain('suspended');
    expect(ACCOUNT_STATUSES).toContain('deleted');
  });

  it('maps the const object to the documented wire values', () => {
    expect.hasAssertions();
    expect(ACCOUNT_STATUS.Active).toBe('active');
    expect(ACCOUNT_STATUS.Suspended).toBe('suspended');
    expect(ACCOUNT_STATUS.Deleted).toBe('deleted');
  });
});

describe('isAccountStatus', () => {
  it.each([...ACCOUNT_STATUSES])('accepts %s', (status) => {
    expect.hasAssertions();
    expect(isAccountStatus(status)).toBe(true);
  });

  it.each([
    ['not_found', 'not_found'],
    ['pending', 'pending'],
    ['DELETED', 'DELETED'],
    ['empty string', ''],
    ['number', 1],
    ['null', undefined],
    ['undefined', undefined],
    ['array', ['active']],
  ])('rejects %s', (_label, value) => {
    expect.hasAssertions();
    expect(isAccountStatus(value)).toBeFalsy();
  });
});

describe('terminality', () => {
  it('treats deleted as the only terminal state', () => {
    expect.hasAssertions();
    expect(isTerminalStatus(ACCOUNT_STATUS.Deleted)).toBe(true);
    expect(isTerminalStatus(ACCOUNT_STATUS.Suspended)).toBeFalsy();
    expect(isTerminalStatus(ACCOUNT_STATUS.Active)).toBeFalsy();
  });

  it('keeps suspended non-terminal so it can return to active', () => {
    expect.hasAssertions();
    expect(ACCOUNT_STATUSES.filter((s) => isTerminalStatus(s))).toStrictEqual([
      ACCOUNT_STATUS.Deleted,
    ]);
  });

  it('exposes terminality under the tombstone name as well', () => {
    expect.hasAssertions();
    for (const status of ACCOUNT_STATUSES) {
      expect(isTombstone(status)).toBe(isTerminalStatus(status));
    }
    expect(isTombstone(ACCOUNT_STATUS.Deleted)).toBe(true);
  });
});
