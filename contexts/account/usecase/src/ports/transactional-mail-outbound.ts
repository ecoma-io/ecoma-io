import type { Brand } from '@ecoma-io/domain-primitives';

/** Brand cho Idempotency-Key của mail gửi OTP (anti-duplicate send). */
export type MailIdempotencyKey = Brand<string, 'MailIdempotencyKey'>;

/** Thư transactional — nội dung do caller dựng, port chỉ định tuyến. */
export interface TransactionalMail {
  /** Địa chỉ nhận đã normalized (không phải addressKey hash — mail cần địa chỉ thật). */
  readonly to: string;
  readonly templateId: string;
  /** Payload template — đã qua sanitization ở use case (không secret raw). */
  readonly payload: Readonly<Record<string, string>>;
}

/**
 * Outbound port cho transactional mail (proposal: "không gửi mail trước khi
 * commit"). Use case PHẢI gọi sau khi transaction commit thành công — port
 * không tự chờ/retry; duplicate guard theo `idempotencyKey` (giống
 * Idempotency-Key từ challenge UUID của reference).
 */
export interface TransactionalMailOutbound {
  send(mail: TransactionalMail, idempotencyKey: MailIdempotencyKey): Promise<void>;
}
