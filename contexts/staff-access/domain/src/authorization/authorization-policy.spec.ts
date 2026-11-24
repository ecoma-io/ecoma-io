/**
 * Ghim policy `can()` ở cả bốn nhánh deny + nhánh allow + marker `stale`.
 *
 * ⚠️ Đây là test cho policy THUẦN — fail-closed phải đỏ ngay khi ai đó thêm
 * nhánh allow ngầm (mutation evidence của AC: bỏ một lớp lọc dưới đây phải
 * làm test tương ứng đỏ, không phải xanh nhờ test khác).
 */

import type { GrantedAssignment } from './authorization-policy';
import { REVOCATION_FRESHNESS_TTL_SECONDS, can } from './authorization-policy';

/** Mốc thời gian cố định — domain không đọc đồng hồ nên caller truyền. */
const NOW = new Date('2026-11-01T12:00:00.000Z'),
  PERM = 'staff.read';

/** Mốc fetch = now — dữ liệu vừa đọc, mặc định không stale (true nghĩa là STALE). */
function assignment(overrides: Partial<GrantedAssignment> = {}): GrantedAssignment {
  return {
    fetchedAt: NOW,
    permissions: [PERM],
    revokedAt: null,
    staffStatus: 'active',
    validUntil: null,
    ...overrides,
  };
}

describe('deny-by-default', () => {
  it('denies an empty assignment set with permission_not_granted', () => {
    expect.hasAssertions();
    expect(can(PERM, [], NOW)).toStrictEqual({
      allowed: false,
      denial: 'permission_not_granted',
      riskClass: 'normal',
      stale: false,
    });
  });

  it('denies a permission the assignments do not grant', () => {
    expect.hasAssertions();
    const decision = can('other.action', [assignment({ permissions: ['role.read'] })], NOW);
    expect(decision).toMatchObject({ allowed: false, denial: 'permission_not_granted' });
  });
});

describe('staff status gate (invariant 5)', () => {
  it('denies while staff is suspended even though the token would still be valid', () => {
    expect.hasAssertions();
    const decision = can(PERM, [assignment({ staffStatus: 'suspended' })], NOW);
    expect(decision).toMatchObject({ allowed: false, denial: 'staff_not_active' });
  });

  it('denies while staff is terminated', () => {
    expect.hasAssertions();
    const decision = can(PERM, [assignment({ staffStatus: 'terminated' })], NOW);
    expect(decision).toMatchObject({ allowed: false, denial: 'staff_not_active' });
  });

  it('denies an unreadable staff status label rather than treating it as active', () => {
    expect.hasAssertions();
    const decision = can(PERM, [assignment({ staffStatus: 'corrupt' as never })], NOW);
    expect(decision).toMatchObject({ allowed: false, denial: 'staff_not_active' });
  });

  it('denies when only one fetched snapshot shows a non-active status (stale wins)', () => {
    expect.hasAssertions();
    const decision = can(PERM, [assignment(), assignment({ staffStatus: 'terminated' })], NOW);
    expect(decision).toMatchObject({ allowed: false, denial: 'staff_not_active' });
  });
});

describe('assignment time window (read-time filter)', () => {
  it('denies an assignment whose valid_until has passed (AC-018)', () => {
    expect.hasAssertions();
    const decision = can(
      PERM,
      [assignment({ validUntil: new Date('2026-10-31T00:00:00.000Z') })],
      NOW,
    );
    expect(decision).toMatchObject({ allowed: false, denial: 'assignment_expired' });
  });

  it('allows an assignment whose windows are still open even by one millisecond', () => {
    expect.hasAssertions();
    // Boundary: valid_until == now vẫn hết hạn (điều kiện là `>` ngoài).
    const decision = can(PERM, [assignment({ validUntil: NOW })], NOW);
    expect(decision.allowed).toBeFalsy();

    const oneMsAfter = new Date(NOW.getTime() + 1);
    expect(can(PERM, [assignment({ validUntil: oneMsAfter })], NOW).allowed).toBe(true);
  });
});

describe('revocation vs expiry denial precedence', () => {
  it('denies an assignment revoked earlier and keeps a revoked reason over expiry', () => {
    expect.hasAssertions();
    // Cả revoked lẫn expired trong tập: revoked là dấu hiệu thu hồi có chủ
    // Đích (T-05) nên reason ưu tiên nó — việc này dễ bỏ sót khi refactor
    // Mảng lọc, nên ghim riêng.
    const decision = can(
      PERM,
      [
        assignment({ validUntil: new Date('2026-10-31T00:00:00.000Z') }),
        assignment({
          revokedAt: new Date('2026-10-30T00:00:00.000Z'),
        }),
      ],
      NOW,
    );
    expect(decision).toMatchObject({ allowed: false, denial: 'assignment_revoked' });
  });

  it('does not let an unrelated revoked assignment mask an expired denial (S3)', () => {
    expect.hasAssertions();
    // S3 (issue #102): assignment của permission KHÁC bị revoke không phải là
    // Bằng chứng về permission đang hỏi. Trước fix, `can()` quét
    // `assignments.some(a => a.revokedAt !== null)` trên TOÀN tập nên denial
    // `assignment_expired` của permission này bị ghi nhầm thành
    // `assignment_revoked` — hai sự kiện khác nhau bị trộn làm một, và cơ chế
    // Điều tra đọc sai nguyên nhân.
    const decision = can(
      PERM,
      [
        assignment({
          permissions: ['other.action'],
          revokedAt: new Date('2026-10-30T00:00:00.000Z'),
        }),
        assignment({ validUntil: new Date('2026-10-31T00:00:00.000Z') }),
      ],
      NOW,
    );
    expect(decision).toMatchObject({ allowed: false, denial: 'assignment_expired' });
  });

  it('still reports a revoked denial when the revoked assignment carries the permission', () => {
    expect.hasAssertions();
    // Đối chiếu trực diện với case trên: cùng tập đó, nhưng assignment bị
    // Revoke BÂY GIỜ mang đúng permission → lý do phải là revoke, không phải
    // Expiry. Bỏ lọc theo permission thì test này vẫn xanh, nên cả hai phải
    // Đứng cạnh nhau.
    const decision = can(
      PERM,
      [
        assignment({
          permissions: ['other.action'],
          revokedAt: new Date('2026-10-30T00:00:00.000Z'),
        }),
        assignment({ revokedAt: new Date('2026-10-30T00:00:00.000Z') }),
      ],
      NOW,
    );
    expect(decision).toMatchObject({ allowed: false, denial: 'assignment_revoked' });
  });
});

describe('live assignment filter (AC-003)', () => {
  it('allows when at least one live assignment carries the permission (AC-003)', () => {
    expect.hasAssertions();
    // Hai role, một có permission một không — chỉ live có permission quyết định.
    const decision = can(PERM, [assignment({ permissions: ['other.action'] }), assignment()], NOW);
    expect(decision.allowed).toBe(true);
  });

  it('treats a wrong-direction window check as expired, never allows', () => {
    expect.hasAssertions();
    // Đặt valid_until dưới revoked_at cùng quá khứ — lọc phải loại cả hai
    // Hàng; mutation nào bỏ một trong hai điều kiện sẽ làm test này xanh
    // Sai nếu chỉ giữ lại một mốc. Vì vậy cả hai mốc cùng tồn tại ở hàng:
    const decision = can(
      PERM,
      [
        assignment({
          revokedAt: new Date('2026-10-29T00:00:00.000Z'),
          validUntil: new Date('2026-10-30T00:00:00.000Z'),
        }),
      ],
      NOW,
    );
    // Expiry trước revoke về mốc thời gian, nhưng policy ưu tiên báo
    // Revoked (thu hồi có chủ đích, T-05) — ghim hành vi ưu tiên đó.
    expect(decision).toMatchObject({ allowed: false, denial: 'assignment_revoked' });
  });
});

describe('future-dated revocation', () => {
  it('treats a future-dated revocation as not yet revoked when the window has expired', () => {
    expect.hasAssertions();
    // `revoked_at` lập trình cho tương lai chưa có hiệu lực: lý do thực sự của
    // Denial lúc này là **hết hạn tự nhiên**, không phải thu hồi. Điều kiện
    // Cũ (`revokedAt !== null`) gọi một lần thu hồi tương lai là "đã bị thu
    // Hồi" — audit ghi sai nguyên nhân cho một sự kiện chưa xảy ra.
    const decision = can(
      PERM,
      [
        assignment({
          revokedAt: new Date(NOW.getTime() + 60_000),
          validUntil: new Date('2026-10-31T00:00:00.000Z'),
        }),
      ],
      NOW,
    );
    expect(decision).toMatchObject({ allowed: false, denial: 'assignment_expired' });
  });

  it('allows a permission whose only revocation is dated in the future', () => {
    expect.hasAssertions();
    // Nửa đối chiếu: một lần thu hồi lập trình cho tương lai chưa có hiệu lực
    // Thì assignment VẪN sống — bộ lọc `live` giữ nó, policy không deny.
    const decision = can(PERM, [assignment({ revokedAt: new Date(NOW.getTime() + 60_000) })], NOW);
    expect(decision.allowed).toBe(true);
  });
});

describe('allow path', () => {
  it('allows a live assignment with the requested permission', () => {
    expect.hasAssertions();
    const decision = can(PERM, [assignment()], NOW);
    expect(decision).toStrictEqual({ allowed: true, riskClass: 'normal', stale: false });
  });
});

describe('revocation freshness (ADR-0002)', () => {
  it('pins the TTL values to the ADR targets', () => {
    expect.hasAssertions();
    expect(REVOCATION_FRESHNESS_TTL_SECONDS).toStrictEqual({ high: 5, normal: 60 });
  });

  it('marks normal-class data older than 60s as stale but still decides on it', () => {
    expect.hasAssertions();
    const decision = can(PERM, [assignment({ fetchedAt: new Date(NOW.getTime() - 61_000) })], NOW);
    expect(decision.allowed).toBe(true);
    expect(decision.stale).toBe(true);
  });

  it('marks normal-class data fetched exactly 60s ago as fresh', () => {
    expect.hasAssertions();
    const fetchedAt = new Date(NOW.getTime() - 60_000);
    expect(can(PERM, [assignment({ fetchedAt })], NOW).stale).toBeFalsy();
  });

  it('marks high-class data older than 5s as stale (target not met by mechanism yet)', () => {
    expect.hasAssertions();
    const decision = can(
      PERM,
      [assignment({ fetchedAt: new Date(NOW.getTime() - 6000) })],
      NOW,
      'high',
    );
    // Marker `stale` phải xuất hiện trên CẢ allow lẫn deny — caller fail
    // Closed với nó, policy không biến stale thành allow ẩn.
    expect(decision.allowed).toBe(true);
    expect(decision.stale).toBe(true);
  });

  it('marks high-class data fetched within 5s as fresh', () => {
    expect.hasAssertions();
    const fetchedAt = new Date(NOW.getTime() - 5000);
    expect(can(PERM, [assignment({ fetchedAt })], NOW, 'high').stale).toBeFalsy();
  });
});

describe('revocation freshness marker on decisions', () => {
  it('carries the stale marker on a denial for old data, never a silent allow', () => {
    expect.hasAssertions();
    const decision = can(
      'other.action',
      [assignment({ fetchedAt: new Date(NOW.getTime() - 61_000) })],
      NOW,
    );
    expect(decision).toMatchObject({
      allowed: false,
      denial: 'permission_not_granted',
      stale: true,
    });
  });

  it('treats the whole set as stale when the oldest snapshot exceeds the TTL', () => {
    expect.hasAssertions();
    // Một ảnh fresher không cứu ảnh cũ: mốc so là snapshot cũ nhất.
    const decision = can(
      PERM,
      [assignment(), assignment({ fetchedAt: new Date(NOW.getTime() - 61_000) })],
      NOW,
    );
    expect(decision.stale).toBe(true);
  });
});
