import type { MailMessageStatus } from '@ecoma-io/transactional-mail-contracts';

/**
 * Dựng trạng thái mà một đường retention/ops cần biết để **ra quyết định** — không phải để
 * hiển thị hay trả về caller ngoài.
 *
 * ⚠️ Projection hẹp có chủ đích: không `recipient`, không `subjectRendered`, không
 * `bodyRendered`, không `idempotencyKey`, không `requestFingerprint`. FR-007 tách recipient +
 * nội dung render (sensitive content) khỏi operational metadata; một query chỉ-đọc để *quyết
 * định* content nào quá hạn không có lý do nào để kéo chính content đó ra khỏi database.
 */
export interface MailContentRetentionCandidate {
  readonly messageId: string;
  readonly deliveryId: string;
  readonly terminalAtMs: number;
}

/**
 * Dựng trạng thái một delivery đang dở quá tuổi — input của **alert**, không phải của một
 * lệnh xoá (FR-007: "Delivery dở quá tuổi tối đa → sinh alert (không im lặng)").
 *
 * Không chứa content: việc điều tra và remediation là việc của operator sau khi có alert.
 */
export interface MailStaleNonTerminalCandidate {
  readonly messageId: string;
  readonly deliveryId: string;
  readonly status: MailMessageStatus;
  readonly updatedAtMs: number;
}

/**
 * Truy vấn retention/expiry cho `mail_messages`.
 *
 * ⚠️ C1 chỉ cung cấp **truy vấn**. Không có method ghi nào ở đây: xoá/redact content, alert
 * và mọi thao tác destructive đều nằm ngoài phạm vi C1 (§5 của lệnh) và thuộc về PR khi
 * policy retention được chốt (`02-requirements.md` FR-007 ghi rõ các giá trị hiện tại là
 * **đề xuất cần validate**, không phải cam kết).
 */
export interface MailRetentionQueries {
  /**
   * Message đã terminal (`sent`/`failed`) trước `terminalBeforeMs` — ứng viên bị xoá/redact
   * content.
   *
   * Predicate dùng đúng mốc mà schema giữ cho row terminal (`terminal_at`), không dùng
   * `updated_at`: `updated_at` đổi khi bất kỳ cột nào đổi, nên theo nó thì một row terminal
   * bị chạm bởi một UPDATE vô hại sẽ "trẻ lại" và bị bỏ qua — hoặc ngược lại, một row
   * non-terminal không bao giờ lọt vào đây: `terminal_at IS NULL` nên `terminal_at < ?`
   * không bao giờ đúng.
   *
   * `blocked` **không** lọt vào danh sách này: nó là non-terminal nên `terminal_at IS NULL`
   * (constraint `mail_messages_terminal_at_parity_check`) và câu này không chọn nó. Giữ
   * content của một delivery còn redrive được là hành động đúng — FR-007 xử lý nó bằng đường
   * "delivery non-terminal quá tuổi → alert", tức là {@link listStaleNonTerminalMessages}.
   *
   * `limit` bắt buộc vì đây là đường quét theo lô, không bao giờ quét toàn bảng trong một
   * lệnh.
   */
  listContentRetentionCandidates(
    input: ListMailContentRetentionCandidatesInput,
  ): Promise<readonly MailContentRetentionCandidate[]>;

  /**
   * Message chưa terminal mà `updated_at` cũ hơn `updatedBeforeMs` — ứng viên alert theo
   * FR-007 ("Delivery non-terminal tồn đọng không được im lặng").
   *
   * Phạm vi đúng ba trạng thái non-terminal của §4.2: `accepted`, `queued`, `blocked`.
   * `limit` bắt buộc, cùng lý lẽ với {@link listContentRetentionCandidates}.
   */
  listStaleNonTerminalMessages(
    input: ListMailStaleNonTerminalMessagesInput,
  ): Promise<readonly MailStaleNonTerminalCandidate[]>;
}

/** Input của {@link MailRetentionQueries.listContentRetentionCandidates}. */
export interface ListMailContentRetentionCandidatesInput {
  /** Epoch ms — chỉ lấy row có `terminal_at < terminalBeforeMs`. */
  readonly terminalBeforeMs: number;
  /** Số hàng tối đa; `<= 0` trả rỗng, không quét. */
  readonly limit: number;
}

/** Input của {@link MailRetentionQueries.listStaleNonTerminalMessages}. */
export interface ListMailStaleNonTerminalMessagesInput {
  /** Epoch ms — chỉ lấy row có `updated_at < updatedBeforeMs`. */
  readonly updatedBeforeMs: number;
  /** Số hàng tối đa; `<= 0` trả rỗng, không quét. */
  readonly limit: number;
}
