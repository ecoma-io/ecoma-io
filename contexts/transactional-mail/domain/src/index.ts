/**
 * `@ecoma-io/transactional-mail-domain` — Rich Domain Model của bounded context
 * `transactional-mail` (Mail Template, Mail Message, Mail Outbox và value object).
 *
 * Thư viện này **chỉ** import `@ecoma-io/domain-primitives` (type-level helpers),
 * **không** SQL, **không** Node builtin và **không** I/O. Mọi tham số thời gian
 * (`nowMs`) do caller truyền vào; domain không đọc đồng hồ.
 *
 * Nguon chan ly hien nay la chinh lib nay: lifecycle (§5), policy/invariant
 * (§6), redrive/repair (§9) đuọc mo ta truc tiep trong JSDoc tung module.
 *
 * Mã nguồn tổ chức theo domain concept (`mail-message/`, `mail-outbox/`,
 * `mail-template/`, `shared/`) — API công khai duy nhất là file này; không barrel
 * index trong từng thư mục con.
 */

// — shared —
export {
  MAIL_DOMAIN_ERROR_MESSAGES,
  isMailDomainError,
  mailDomainError,
  type MailDomainError,
  type MailDomainErrorCode,
} from './shared/errors';

// — mail-message —
export {
  MAIL_MESSAGE_TRANSITIONS,
  MailMessage,
  isMailMessageTerminal,
  type DeliveryId,
  type MailErrorClass,
  type MailMessageId,
  type MailMessageSnapshot,
  type MailMessageStatus,
  type MailOutcome,
  type OutcomeRejection,
} from './mail-message/mail-message';
export {
  normalizeRecipient,
  type Recipient,
  type RecipientNormalization,
} from './mail-message/recipient';
export {
  DEFAULT_LOCALE,
  MAX_LOCALE_LENGTH,
  normalizeLocale,
  type LocaleNormalization,
  type NormalizedLocale,
} from './mail-message/normalized-locale';
export {
  FINGERPRINT_HEX_LENGTH,
  parseStoredFingerprint,
  type RequestFingerprint,
  type StoredFingerprintParse,
} from './mail-message/request-fingerprint';

// — mail-outbox —
export {
  MAIL_OUTBOX_TRANSITIONS,
  MailOutbox,
  type MailOutboxId,
  type MailOutboxSnapshot,
  type MailOutboxStatus,
} from './mail-outbox/mail-outbox';

// — mail-template —
export {
  MailTemplate,
  type MailTemplateId,
  type MailTemplateSnapshot,
  type MailTemplateStatus,
  type TemplateName,
} from './mail-template/mail-template';
