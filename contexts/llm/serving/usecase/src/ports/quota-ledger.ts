/**
 * Port quota ledger — quota authority bền (A7, invariant 16): reserve/settle/
 * release idempotent theo quota reservation id; mọi operation (đọc lẫn ghi) có
 * thể được gọi trong khi transaction gateway đang mở và PHẢI tham gia cùng
 * persistence transaction đó (hợp đồng Kịch bản A — atomicity là trách nhiệm
 * adapter). Implement thật là SQL
 * `llm_gateway.tenant_quota` + `llm_gateway.quota_reservations`.
 */

export interface QuotaRead {
  /** Trần token operational của tenant (ensure-row MVP default đã chạy ở adapter). */
  readonly tokenCeiling: bigint;
  /** Tổng token đã settle. */
  readonly settledTokens: bigint;
  /** Tổng token đang held bởi reservation active. */
  readonly heldActiveTokens: bigint;
}

/** Row reservation quota sau reserve (state `active`). */
export interface QuotaReservation {
  readonly reservationId: string;
  readonly tokenAmount: bigint;
}

export interface QuotaLedger {
  /**
   * Đọc trạng thái quota của tenant TRONG transaction gateway — ensure row
   * ceiling (MVP default) là trách nhiệm adapter. Lỗi truy cập → ném, caller
   * fail-closed.
   */
  read(tenantId: string): Promise<QuotaRead>;
  /** Reserve DURABLE một lượng token (identity từ request_id). Idempotent theo reservationId. */
  reserve(input: {
    reservationId: string;
    requestId: string;
    tenantId: string;
    tokenAmount: bigint;
  }): Promise<QuotaReservation>;
  /** Settle quota reservation — idempotent theo reservationId; token = usage thật hay cận hold. */
  settle(input: { reservationId: string; settledTokens: bigint }): Promise<void>;
  /** Release quota reservation — idempotent, compensation khi financial từ chối. */
  release(reservationId: string): Promise<void>;
}
