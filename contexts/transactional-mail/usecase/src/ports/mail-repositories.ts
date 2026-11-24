/**
 * Port persistence của `mail_messages` — conditional write, batch nguyên tử.
 *
 * Tất cả method ghi đều là **conditional write**: predicate nằm trong WHERE của câu
 * UPDATE, và "affected rows = 0" nghĩa là *đã lệch*, không phải *đã ghi* (§6.2.2).
 * Không method nào đọc trạng thái rồi ghi không guard.
 */
export interface MailMessageRepositoryPort {
  /**
   * Tạo message + outbox row trong **một** batch — hoặc cả hai, hoặc không.
   *
   * ⚠️ Ngay cả khi khoá đã tồn tại, port **không** trả nhánh tên `replay` hay
   * `equivalent`: UNIQUE `(principal_id, idempotency_key)` chỉ chứng minh *"cùng khoá,
   * một hàng"*, KHÔNG chứng minh *"cùng request"*. Caller phải tự so
   * `requestFingerprint` của bản ghi trả về rồi mới quyết định replay-match hay
   * conflict — persistence không có canonical request nên không thể so (FR-002).
   */
  createWithOutbox(input: {
    readonly messageId: string;
    readonly outboxId: string;
    readonly deliveryId: string;
    readonly app: string;
    readonly principalId: string;
    readonly templateId: string;
    readonly templateName: string;
    readonly templateVersion: number;
    readonly locale: string;
    /** Nhạy cảm — không đưa vào log, queue payload hay error message. */
    readonly recipient: string;
    readonly subjectRendered: string;
    readonly bodyRendered: string;
    readonly idempotencyKey: string;
    /** HMAC có khoá — không phải hash trần. */
    readonly requestFingerprint: string;
    readonly correlationId: string | null;
    readonly nowMs: number;
  }): Promise<
    | { readonly kind: 'created'; readonly fingerprint: string | null }
    | { readonly kind: 'already-exists' }
  >;

  /** Tra theo scope uniqueness `(principalId, idempotencyKey)` — không tra key một mình. */
  findByIdempotencyKey(
    principalId: string,
    idempotencyKey: string,
  ): Promise<{ readonly requestFingerprint: string } | null>;
}

/**
 * Port persistence của `mail_outbox` — claim và publish luôn sau commit (invariant 11),
 * không network call nào nằm trong batch nguyên tử (invariant 10).
 */
export interface MailOutboxRepositoryPort {
  /**
   * Ghi trạng thái publish của generation — publisher chỉ ghi outbox + message
   * `queued`, KHÔNG BAO GIỜ ghi `sent`/`failed`/`blocked` (invariant 15).
   * Conditional write: predicate `status = 'publishing'`.
   */
  markPublished(input: {
    readonly outboxId: string;
    readonly publisherId: string;
    readonly nowMs: number;
  }): Promise<boolean>;
}
