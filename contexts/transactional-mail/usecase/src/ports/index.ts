export type {
  AuthenticatedPrincipal,
  DeliveryId,
  MailErrorClass,
  MailMessageId,
  MailOutcome,
  MailOutboxId,
} from './types.js';
export type { MailMessageRepositoryPort, MailOutboxRepositoryPort } from './mail-repositories.js';
export type { MailMessageStateReaderPort } from './message-state-reader.js';
export type { MailRateLimitPolicy, MailRateLimitStorePort } from './rate-limit-store.js';
export type { MailTemplateRepositoryPort } from './template-repository.js';
