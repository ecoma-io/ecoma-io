import type { TransactionId } from './types.js';

/**
 * Port sinh identifier — Use Case không tự gọi crypto.randomUUID
 * (bất biến từ legacy: id phải 32 byte base64url ≥ 256 bit entropy).
 */
export interface IdGenerator {
  newTransactionId(): TransactionId;
}
