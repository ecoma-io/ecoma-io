/**
 * Port sinh request id khi caller không gửi `x-request-id` (UUID fallback).
 * Ids admission khác (quota/financial reservation, settlement, charge) là
 * TẤT ĐỊNH — KHÔNG dùng port này cho chúng (invariant 9, §11).
 */
export interface RequestIdGenerator {
  newRequestId(): string;
}
