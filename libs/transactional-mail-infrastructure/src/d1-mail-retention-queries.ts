import type {
  ListMailContentRetentionCandidatesInput,
  ListMailStaleNonTerminalMessagesInput,
  MailContentRetentionCandidate,
  MailRetentionQueries,
  MailStaleNonTerminalCandidate,
} from '@ecoma-io/transactional-mail-application';

import type { D1SubsetDatabase } from './d1-surface';

/**
 * Chỉ-đọc cho FR-007.
 *
 * `status IN ('sent','failed')` **thừa** về mặt logic (parity CHECK đã gán `terminal_at NOT
 * NULL` đúng cho hai trạng thái đó) nhưng **không thừa về mặt index**: `mail_messages_status_
 * terminal_idx` là `(status, terminal_at)`, và SQLite chỉ seek được theo cột leading khi nó bị
 * ràng buộc. Không có vế `status` thì câu này quét index theo cột thứ hai — chậm dần theo số
 * row terminal, đúng kiểu vô hại lúc dev và thành lỗi vận hành lúc production.
 */
const LIST_CONTENT_RETENTION_CANDIDATES = `
SELECT id, delivery_id, terminal_at
FROM mail_messages
WHERE status IN ('sent', 'failed')
  AND terminal_at < ?
ORDER BY terminal_at, id
LIMIT ?
`;

/** Ba trạng thái non-terminal của §4.2 — đây là danh sách ứng viên **alert**, không phải xoá. */
const LIST_STALE_NON_TERMINAL = `
SELECT id, delivery_id, status, updated_at
FROM mail_messages
WHERE status IN ('accepted', 'queued', 'blocked')
  AND updated_at < ?
ORDER BY updated_at, id
LIMIT ?
`;

interface ContentRetentionRow {
  readonly id: string;
  readonly delivery_id: string;
  readonly terminal_at: number;
}

interface StaleNonTerminalRow {
  readonly id: string;
  readonly delivery_id: string;
  readonly status: MailStaleNonTerminalCandidate['status'];
  readonly updated_at: number;
}

/** Truy vấn retention/expiry của D1 `mail` — chỉ-đọc, đúng như port. */
export class D1MailRetentionQueries implements MailRetentionQueries {
  readonly #db: D1SubsetDatabase;

  constructor(db: D1SubsetDatabase) {
    this.#db = db;
  }

  async listContentRetentionCandidates(
    input: ListMailContentRetentionCandidatesInput,
  ): Promise<readonly MailContentRetentionCandidate[]> {
    if (input.limit < 1) {
      return [];
    }

    const found = await this.#db
      .prepare(LIST_CONTENT_RETENTION_CANDIDATES)
      .bind(input.terminalBeforeMs, input.limit)
      .all<ContentRetentionRow>();

    return found.results.map((row) => ({
      messageId: row.id,
      deliveryId: row.delivery_id,
      terminalAtMs: row.terminal_at,
    }));
  }

  async listStaleNonTerminalMessages(
    input: ListMailStaleNonTerminalMessagesInput,
  ): Promise<readonly MailStaleNonTerminalCandidate[]> {
    if (input.limit < 1) {
      return [];
    }

    const found = await this.#db
      .prepare(LIST_STALE_NON_TERMINAL)
      .bind(input.updatedBeforeMs, input.limit)
      .all<StaleNonTerminalRow>();

    return found.results.map((row) => ({
      messageId: row.id,
      deliveryId: row.delivery_id,
      status: row.status,
      updatedAtMs: row.updated_at,
    }));
  }
}
