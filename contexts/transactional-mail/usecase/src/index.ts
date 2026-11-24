/**
 * `@ecoma-io/transactional-mail-usecase` — Application use cases của bounded
 * context `transactional-mail`: orchestration phối hợp với
 * `@ecoma-io/transactional-mail-domain`, phân loại Command/Query theo
 * `@ecoma-io/usecase-primitives`.
 *
 * Usecase KHÔNG chứa business rule — nó gọi pure functions/aggregates của domain
 * qua ports; mọi side effect (crypto, storage, alert) đi qua port inject.
 */

export * from './ports/index.js';

export {
  CreateMailMessageUseCase,
  type CreateMailMessageConfig,
  type CreateMailMessageDeps,
  type CreateMailMessageInput,
  type CreateMailMessageResult,
} from './create-mail-message/create-mail-message.js';

export {
  ApplyMailDeliveryOutcomeUseCase,
  type ApplyMailDeliveryOutcomeDeps,
  type ApplyMailDeliveryOutcomeInput,
  type ApplyMailDeliveryOutcomeResult,
} from './apply-delivery-outcome/apply-delivery-outcome.js';

export { renderMail, type MailRenderResult } from './mail-render.js';
export {
  parseTemplateSchema,
  validateVariablesAgainstSchema,
  type TemplateSchemaValidation,
} from './template-schema.js';
