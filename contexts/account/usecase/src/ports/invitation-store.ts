import type { EmailAddressKey, InvitationId, InvitationSnapshot } from '@ecoma-io/account-domain';

import type { TransactionHandle } from './unit-of-work.js';

/**
 * Port persistence cho Invitation.
 *
 * Bất biến thiết kế (từ reference `lib/invitation.ts`):
 * - Phát hành invitation chạy serialization protocol tương tự OTP (proposal
 *   §7b): FOR UPDATE theo address → kiểm canonical/claim → INSERT với partial
 *   unique là trọng tài — race_lost là kết quả nghiệp vụ, không phải lỗi.
 * - Consume (accept) và revoke là CAS theo state `open` + `expires_at` —
 *   row hết hạn/không còn open không bao giờ transition được.
 * - Accept thực sự (consume + INSERT users trong MỘT tx) là việc của
 *   UnitOfWork + các store phối hợp — port này chỉ lưu lifecycle Invitation.
 */
export interface InvitationStore {
  /**
   * CAS consume invitation trong transaction acceptance: chỉ thắng khi state
   * `open` và chưa hết hạn. `expiresAt` kiểm tra BÊN TRONG CAS. Expiry quyết
   * định bằng `now` của use case — không dùng `now()` của DB tại đây.
   */
  consumeOpenWithinTx(input: {
    id: InvitationId;
    now: number;
    acceptedAt: number;
    acceptedSubject: string;
    tx: TransactionHandle;
  }): Promise<boolean>;

  /** Ghi invitation mới (state `open`). Trả false nếu id trùng (không bao giờ xảy ra với entropy đủ). */
  insertOpen(snapshot: InvitationSnapshot, tx?: TransactionHandle): Promise<boolean>;

  /** CAS revoke: chỉ thắng khi state còn `open`. */
  revoke(id: InvitationId, tx?: TransactionHandle): Promise<boolean>;

  /** CAS expire (lazy TTL): chỉ transition từ `open` khi `expires_at <= now`. */
  expireIfExpired(id: InvitationId, now: number, tx?: TransactionHandle): Promise<boolean>;

  /** Đọc snapshot theo id; undefined nếu không tồn tại. */
  findById(id: InvitationId, tx?: TransactionHandle): Promise<InvitationSnapshot | undefined>;

  /** Các invitation còn `open` của một địa chỉ (mọi issued_at, chưa lọc TTL). */
  findOpenByAddressKey(
    addressKey: EmailAddressKey,
    tx?: TransactionHandle,
  ): Promise<readonly InvitationSnapshot[]>;
}
