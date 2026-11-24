import type { HandleHash, LoginHandoffSnapshot, SessionRef } from '@ecoma-io/account-domain';

import type { TransactionHandle } from './unit-of-work.js';

/**
 * Port persistence cho LoginHandoff.
 *
 * Bất biến thiết kế (từ reference `lib/handoff.ts`):
 * - First-binding-wins: PK `handle_hash` + `INSERT ... ON CONFLICT DO NOTHING`.
 *   Phía thắng nhận aggregate; phía thua nhận session_ref của winner để SO
 *   SÁNH — real rejection diễn ra ở handoff route khi so sánh không khớp, KHÔNG
 *   phải exception tại bind.
 * - Chỉ đường rotation được phép đổi session_ref của binding (carry handoff),
 *   và nó phải chạy trong CÙNG transaction rotation của session (FR-006c4).
 * - Consume là CAS với state IN (`bound`, `session_rotated`) + TTL check bên trong.
 */
export interface LoginHandoffStore {
  /**
   * INSERT ... ON CONFLICT DO NOTHING theo PK handle_hash. Trả `{ won: true }`
   * khi mới bind; `{ won: false, winnerSessionRef }` khi đã có binding — chỉ để
   * so sánh, KHÔNG phải lỗi.
   */
  bindFirst(input: {
    handleHash: HandleHash;
    sessionRef: SessionRef;
    now: number;
    ttlSeconds: number;
    tx?: TransactionHandle;
  }): Promise<{ won: true } | { won: false; winnerSessionRef: SessionRef }>;

  /** Đọc snapshot theo handle_hash; undefined nếu không tồn tại. */
  findById(
    handleHash: HandleHash,
    tx?: TransactionHandle,
  ): Promise<LoginHandoffSnapshot | undefined>;

  /**
   * Carry binding sang phiên mới — chỉ gọi trong transaction rotation session
   * (CAS: state `bound`, chưa hết hạn). Đổi session_ref của binding.
   */
  rotateToWithinTx(input: {
    handleHash: HandleHash;
    newSessionRef: SessionRef;
    now: number;
    tx: TransactionHandle;
  }): Promise<boolean>;

  /**
   * Carry binding theo session_ref (FR-006c4): tìm binding đang trỏ tới
   * `fromSessionRef` (state `bound`, chưa hết hạn) và đổi sang `toSessionRef`
   * trong CÙNG transaction rotation session. Không có binding trỏ tới phiên cũ
   * ⇒ UPDATE khớp 0 hàng ⇒ trả false — caller rotate đi tiếp bình thường.
   */
  carryBindingWithinTx(input: {
    fromSessionRef: SessionRef;
    toSessionRef: SessionRef;
    now: number;
    tx: TransactionHandle;
  }): Promise<boolean>;

  /**
   * CAS consume: state IN (`bound`, `session_rotated`), chưa hết hạn. Expiry
   * kiểm tra BÊN TRONG CAS. Trả false nếu thua (đã consume/expired).
   */
  consume(handleHash: HandleHash, now: number, tx?: TransactionHandle): Promise<boolean>;
}
