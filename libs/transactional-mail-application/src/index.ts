/**
 * Barrel exports cho `@ecoma-io/transactional-mail-application`.
 *
 * Contract boundary: chỉ export **public entrypoints** (theo `exports["."]` trong
 * `package.json`). Consumer chỉ phụ thuộc vào package root, không import deep-path.
 *
 * Đây là lib **ports**: interface và record thuần type, không có implementation, không có
 * runtime export nào. Infrastructure cài các port này; application layer chỉ gọi qua chúng.
 * Không có type nào ở đây rò rỉ binding của Cloudflare (`D1Database`, `Env`), type của Hono
 * hay type của driver SQL — đó là ranh giới mà `pnpm dx arch-check` và spec trong lib này
 * cùng giữ.
 *
 * Tài liệu tham chiếu:
 * - `docs/services/transactional-mail/01-architecture.md` §4, §6, §7.4, §8
 * - `docs/services/transactional-mail/02-requirements.md` FR-002, FR-004, FR-006, FR-007
 */

export type {
  MailMessageRecord,
  MailOutboxRecord,
  MailOutboxStatus,
  MailRateLimitConsumeResult,
  MailRateLimitScope,
  MailTemplateRecord,
  MailTemplateStatus,
} from './records';

export type { MailTemplateRepository } from './mail-template-repository';

export type {
  ApplyMailDeliveryOutcomeInput,
  ApplyMailDeliveryOutcomeResult,
  CreateMailMessageWithOutboxInput,
  CreateMailMessageWithOutboxResult,
  MailMessageRepository,
} from './mail-message-repository';

export type {
  ClaimMailOutboxInput,
  MarkMailOutboxPublishedInput,
  MarkMailOutboxPublishedResult,
  MailOutboxRepository,
  RecordMailOutboxPublishFailureInput,
  RenewMailOutboxLeaseInput,
} from './mail-outbox-repository';

export type {
  ClaimMailNonceInput,
  DeleteExpiredMailNoncesInput,
  InternalNonceStore,
} from './internal-nonce-store';

export type { MailRateLimitStore, TryConsumeMailRateLimitInput } from './mail-rate-limit-store';

export type {
  ListMailContentRetentionCandidatesInput,
  ListMailStaleNonTerminalMessagesInput,
  MailContentRetentionCandidate,
  MailRetentionQueries,
  MailStaleNonTerminalCandidate,
} from './mail-retention-queries';
