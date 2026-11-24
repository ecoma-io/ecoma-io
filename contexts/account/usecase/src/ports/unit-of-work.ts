/**
 * Port transaction runner (UnitOfWork — proposal §7c).
 *
 * Acceptance flow bắt buộc MỘT transaction: consume-challenge → accept-invitation
 * → INSERT users (trigger `users_invitation_birth_guard` của DB phụ thuộc thứ tự
 * này). Persistence nhận handle do caller truyền vào — port này cấp handle đó.
 *
 * Nếu body throw/reject, implementation phải rollback; nếu resolve, commit.
 * Handle là opaque — chỉ có giá trị khi truyền lại vào các store cùng port.
 */
import type { Brand } from '@ecoma-io/domain-primitives';

export interface UnitOfWork {
  /**
   * Chạy `work` trong một transaction. Tất cả store call trong `work` nhận cùng
   * `tx` handle. Trả giá trị của `work`; reject/throw thì rollback rồi mới rethrow.
   */
  run<T>(work: (tx: TransactionHandle) => Promise<T>): Promise<T>;
}

/** Handle opaque của transaction đang mở — không thao tác gì ngoài truyền lại. */
export type TransactionHandle = Brand<string, 'TransactionHandle'>;
