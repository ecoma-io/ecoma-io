/**
 * Port đọc + ghi có guard trạng thái message — tách khỏi `MailMessageRepositoryPort`
 * (tạo message) để usecase outcome không có quyền tạo row mới (least privilege:
 * worker callback không được tạo message hay outbox).
 */
export interface MailMessageStateReaderPort {
  /** Trạng thái hiện tại theo `delivery_id` (UNIQUE) — đường tra của private interface. */
  findStateByDeliveryId(deliveryId: string): Promise<{
    readonly status: string;
    readonly dispatchGeneration: number;
  } | null>;

  /**
   * Conditional update duy nhất: `UPDATE … WHERE delivery_id = ? AND
   * dispatch_generation = ? AND status IN ('accepted','queued')`.
   * Trả `false` khi 0 hàng — *đã lệch*, không phải *đã ghi*.
   */
  applyOutcome(input: {
    readonly deliveryId: string;
    readonly outcome: string;
    readonly dispatchGeneration: number;
    readonly errorClass: string | null;
    readonly nowMs: number;
  }): Promise<boolean>;
}
