import type { BrowserSessionSnapshot, SessionRef, Subject } from '@ecoma-io/account-domain';

import type { TransactionHandle } from './unit-of-work.js';

/**
 * Port persistence cho BrowserSession.
 *
 * Bất biến thiết kế (từ reference `lib/session.ts`):
 * - Identity là `session_ref` = SHA-256 của cookie value — cookie value KHÔNG
 *   BAO GIỜ persist (SR-006: session_ref không vào URL/log/audit).
 * - `subject` là thuộc tính persistence của phiên (cột `user_sub` của reference)
 *   nhưng KHÔNG nằm trong `BrowserSessionSnapshot` của domain (domain không cần
 *   nó cho invariants) — do đó `insert`/`rotateWithinTx` nhận subject riêng.
 * - Rotation là MỘT transaction: revoke phiên cũ + INSERT phiên mới (+ carry
 *   handoff binding ở layer trên, FR-006c4). `now` truyền vào để revoked_at của
 *   phiên cũ là timestamp thật — không bao giờ fudge từ createdAt.
 * - Revoke-all là CAS bulk theo subject — chỉ các row còn live bị revoke.
 */
export interface BrowserSessionStore {
  /** Ghi phiên mới gắn với subject. Trả false nếu session_ref trùng. */
  insertWithinTx(input: {
    subject: Subject;
    snapshot: BrowserSessionSnapshot;
    tx?: TransactionHandle;
  }): Promise<boolean>;

  /** Đọc snapshot theo session_ref; undefined nếu không tồn tại. */
  findById(
    sessionRef: SessionRef,
    tx?: TransactionHandle,
  ): Promise<BrowserSessionSnapshot | undefined>;

  /**
   * Đọc subject sở hữu phiên (cho authorization check của revoke/list) —
   * tách khỏi findById để snapshot domain giữ nguyên không có subject.
   */
  findOwnerByRef(sessionRef: SessionRef, tx?: TransactionHandle): Promise<Subject | undefined>;

  /** Persist state sau mutation (authenticate/stepUp/revoke). */
  save(snapshot: BrowserSessionSnapshot, tx?: TransactionHandle): Promise<void>;

  /**
   * Rotation trong MỘT transaction: revoke phiên cũ (CAS: vẫn live, revoked_at
   * = now truyền vào) + INSERT phiên mới gắn với subject. Trả false nếu phiên
   * old đã bị revoke/hết hạn trước CAS (thua race — use case từ chối với
   * outcome nghiệp vụ, không phải lỗi).
   */
  rotateWithinTx(input: {
    oldSessionRef: SessionRef;
    subject: Subject;
    newSnapshot: BrowserSessionSnapshot;
    now: number;
    tx: TransactionHandle;
  }): Promise<boolean>;

  /** Danh sách phiên live của subject (đã sắp theo createdAt giảm dần). */
  listLiveBySubject(
    subject: Subject,
    now: number,
    tx?: TransactionHandle,
  ): Promise<readonly BrowserSessionSnapshot[]>;

  /** Revoke MỘT phiên (CAS: revoked_at IS NULL). Trả false nếu đã revoke. */
  revokeOne(sessionRef: SessionRef, now: number, tx?: TransactionHandle): Promise<boolean>;

  /** Revoke TẤT CẢ phiên live của subject. Trả số phiên đã revoke. */
  revokeAllBySubject(subject: Subject, now: number, tx?: TransactionHandle): Promise<number>;
}
