export {
  FAKE_PROVIDER_MESSAGE_ID,
  FAKE_RETRY_AFTER_MS,
  FakeMailProvider,
  type FakeMailProviderOptions,
} from './fake-mail-provider';

export type {
  D1DatabaseLike,
  D1BoundStatement,
  D1PreparedStatement,
  D1ResultMeta,
  D1RunResult,
} from './d1-database-like';
export { readChanges } from './d1-database-like';
export { D1MailJobRepository, type D1MailJobRepositoryOptions } from './d1-mail-job-repository';
export {
  D1QuarantineRepository,
  type D1QuarantineRepositoryOptions,
} from './d1-quarantine-repository';
export {
  decodeMailJobRow,
  decodeQuarantineRow,
  MAIL_JOB_COLUMNS,
  QUARANTINE_COLUMNS,
} from './mail-job-row';

/**
 * Provider adapter Resend — cài `MailProviderPort` của application.
 *
 * Composition root (`apps/transactional-mailer-job/src/main.ts`) chọn adapter theo
 * `provider.kind` của config: `resend` → `createResendMailProvider`, `fake` →
 * `FakeMailProvider` (chỉ test/dev, không bao giờ production — 03-operations.md §3).
 */
export {
  type ProviderAbortController,
  type ProviderFetch,
  type ProviderRequestInit,
  type ProviderResponse,
  type ProviderResponseHeaders,
  type ResendMailProviderDeps,
  type ResendProviderConfig,
  createResendMailProvider,
} from './resend-mail-provider';
