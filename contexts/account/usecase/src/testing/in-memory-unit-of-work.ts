import type { TransactionHandle, UnitOfWork } from '../ports/unit-of-work.js';

/**
 * Fake UnitOfWork cho unit tests — chạy `work` trực tiếp, commit trên resolve,
 * rollback (throw lại) trên reject. Dùng để test "rollback trên rejection"
 * của acceptance flow: spec ném lỗi trong `work` để kiểm tra entire tx bị vứt.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  public shouldRollback = false;

  public async run<T>(work: (tx: TransactionHandle) => Promise<T>): Promise<T> {
    const tx: TransactionHandle = 'tx' as TransactionHandle;
    if (this.shouldRollback) {
      // Rollback giả: reject của work lan truyền lên caller sau khi tx đã vứt.
      await work(tx);
      // Không xảy ra: shouldRollback=true ⇒ work luôn ném.
      throw new Error('expected work to reject');
    }
    return work(tx);
  }
}
