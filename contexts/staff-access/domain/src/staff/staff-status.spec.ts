/**
 * Ghim vocabulary staff status va rang buoc terminal cua no o phia
 * `staff-access`, cung ghim su doi xung voi wire type cua contracts layer.
 *
 * ⚠️ Day la test cho **constraint type** o tang domain: staff status la truc
 * doc lap voi account status, `terminated` la terminal, va khong co policy
 * runtime nao (self-assignment, step-up, ...) song o lib thuan nay — policy
 * la viec cua tang application/service (SR-005).
 */

import {
  STAFF_ACCESS_STAFF_STATUS,
  STAFF_ACCESS_STAFF_STATUSES,
  isStaffAccessStaffStatus,
  isTerminalStaffAccessStatus,
} from './staff-status';

describe('staff status vocabulary', () => {
  it('declares exactly the three proposed labels', () => {
    expect.hasAssertions();
    expect([...STAFF_ACCESS_STAFF_STATUSES].toSorted()).toStrictEqual([
      'active',
      'suspended',
      'terminated',
    ]);
    expect(Object.keys(STAFF_ACCESS_STAFF_STATUS)).toHaveLength(
      Object.values(STAFF_ACCESS_STAFF_STATUS).length,
    );
    expect(Object.values(STAFF_ACCESS_STAFF_STATUS)).toStrictEqual([
      ...STAFF_ACCESS_STAFF_STATUSES,
    ]);
  });

  it('declares the axis as separate from account status, which cannot be smeared to staff', () => {
    expect.hasAssertions();
    // 'deleted' KHONG la gia tri cua staff status: hai truc khac han.
    // Neu mot ngay account doi vocabulary, lib
    // Nay phai khong bi keo theo.
    expect(STAFF_ACCESS_STAFF_STATUSES).not.toContain('deleted');
  });
});

describe('type guard', () => {
  it('accepts every declared label', () => {
    expect.hasAssertions();
    for (const status of STAFF_ACCESS_STAFF_STATUSES) {
      expect(isStaffAccessStaffStatus(status)).toBe(true);
    }
  });

  it('rejects account-only labels, core flags and non-strings', () => {
    expect.hasAssertions();
    expect(isStaffAccessStaffStatus('deleted')).toBeFalsy();
    expect(isStaffAccessStaffStatus('active ')).toBeFalsy();
    expect(isStaffAccessStaffStatus('Active')).toBeFalsy();
    expect(isStaffAccessStaffStatus(undefined)).toBeFalsy();
  });
});

describe('terminality of terminated', () => {
  it('marks only terminated as terminal among the three', () => {
    expect.hasAssertions();
    expect(isTerminalStaffAccessStatus('terminated')).toBe(true);
    expect(isTerminalStaffAccessStatus('active')).toBeFalsy();
    expect(isTerminalStaffAccessStatus('suspended')).toBeFalsy();
  });
  // ⚠️ Khong co transition `terminated → anything` o day, va cung khong can
  // Exception: "khoi phuc membership la thao tac moi co audit",
  // Tuc mot thao tac INSERT moi (staff entry moi), khong phai transition trong
  // Vocabulary nay. Module khong co ham nao chuyen terminal thanh duoc — do
  // Chinh la security property duoc bao ve.
});
