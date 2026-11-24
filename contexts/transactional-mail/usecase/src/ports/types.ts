/**
 * Application contracts dùng chung của tầng usecase transactional-mail.
 *
 * Tái dùng các brand identifier của domain thay vì định nghĩa lại — brand chỉ là
 * type-level nên không tạo coupling runtime.
 */
export type {
  DeliveryId,
  MailErrorClass,
  MailMessageId,
  MailOutcome,
} from '@ecoma-io/transactional-mail-domain';

/** Id của outbox row — `obx_` theo §4.3; brand riêng để không trộn với message id. */
export type MailOutboxId = string & { readonly __brand: 'MailOutboxId' };

/** Principal do server kiểm soát — không bao giờ lấy từ body hay header chưa verify. */
export interface AuthenticatedPrincipal {
  readonly id: string;
  readonly app: string;
}
