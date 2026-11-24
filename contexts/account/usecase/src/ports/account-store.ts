import type { AccountSnapshot, Subject } from '@ecoma-io/account-domain';

import type { TransactionHandle } from './unit-of-work.js';

/**
 * Port persistence cho Account (tập users + email_addresses của reference).
 *
 * Bất biến thiết kế:
 * - `provisionFromInvitation` chỉ được gọi trong transaction acceptance — store
 *   ghi snapshot KHÔNG kiểm tra điều kiện đó (không thể tự kiểm); trigger
 *   `users_invitation_birth_guard` của DB là trọng tài thật. Port method đặt
 *   tên `insertWithinAcceptanceTx` để lộ ràng buộc tại call-site.
 * - "Một owner verified duy nhất trên toàn hệ thống" là invariant DB-owned
 *   (partial unique) — store chỉ persist, không tự enforce.
 * - Địa chỉ đã revoked có thể được account khác reclaim — không guard thêm.
 */
export interface AccountStore {
  /**
   * Ghi account mới trong transaction acceptance (state active, email đầu
   * tiên verified). Trả false nếu subject đã tồn tại (không bao giờ xảy ra với
   * entropy 160-bit — coi như 500-class).
   */
  insertWithinAcceptanceTx(snapshot: AccountSnapshot, tx: TransactionHandle): Promise<boolean>;

  /** Đọc snapshot theo subject; undefined nếu không tồn tại. */
  findById(subject: Subject, tx?: TransactionHandle): Promise<AccountSnapshot | undefined>;

  /** Persist status + tập email sau khi aggregate mutate (CAS theo subject). */
  save(snapshot: AccountSnapshot, tx?: TransactionHandle): Promise<void>;

  /**
   * Tra cứu account bằng addressKey đã verified (chỉ các row `verified` của
   * email_addresses). Pending/revoked/suspended/deleted không trả về —
   * caller coi như không tồn tại (anti-enumeration, khớp
   * `lookupVerifiedAddress` của reference).
   */
  findByVerifiedAddressKey(
    addressKey: string,
    tx?: TransactionHandle,
  ): Promise<{ subject: Subject; snapshot: AccountSnapshot } | undefined>;
}
