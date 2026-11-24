/**
 * Taxonomy lỗi của tầng domain `transactional-mail`.
 *
 * ⚠️ **Quy tắc bất di bất dịch: một domain error chỉ được mang `code` ổn định + `message`
 * tiếng Việt ngắn gọn.** Không field nào cho recipient, rendered content, idempotency key,
 * fingerprint hay bất kỳ giá trị nào đọc lại được từ nó.
 *
 * Lý do — invariant 6: recipient, rendered subject/body, variables,
 * verification token và provider credential không bao giờ nằm trong log hay error message.
 * Một error object đi thẳng ra log và ra response; nó là nơi dễ rò chính vì nó mang theo
 * "ngữ cảnh" của lỗi.
 *
 * Vì vậy type {@link MailDomainErrorCode} là `string` thuần và {@link MailDomainError} không
 * có chỗ để đặt payload tuỳ ý. Muốn thêm ngữ cảnh cho việc chẩn đoán thì thêm mã mới vào
 * taxonomy, không gắn dữ liệu lạnh vào mã cũ.
 */

/** Mã lỗi ổn định — contract với consumer, không đổi nghĩa theo thời gian. */
export type MailDomainErrorCode =
  | 'invalid_transition'
  | 'terminal_state'
  | 'generation_mismatch'
  | 'not_blocked'
  | 'recovery_budget_exhausted'
  | 'invalid_recipient'
  | 'invalid_locale'
  | 'invalid_variables'
  | 'payload_too_large';

/** Error domain: `code` ổn định + `message` tiếng Việt ngắn gọn. */
export interface MailDomainError {
  readonly code: MailDomainErrorCode;
  readonly message: string;
}

/**
 * Những lỗi không nhạy cảm theo nghĩa đen — không chứa dữ liệu định danh hay bí mật.
 * Frozen: consumer không được sửa message tại runtime — nếu bị sửa thì
 * `mailDomainError(code)` sẽ phát ra nội dung tuỳ ý, phá vỡ claim "không có đường nào
 * lọt dữ liệu tuỳ ý vào message".
 */
export const MAIL_DOMAIN_ERROR_MESSAGES: Readonly<Record<MailDomainErrorCode, string>> =
  Object.freeze({
    invalid_transition: 'Chuyển trạng thái không hợp lệ.',
    terminal_state: 'Message đã ở trạng thái terminal.',
    generation_mismatch: 'Generation của delivery không khớp.',
    not_blocked: 'Message không ở trạng thái blocked.',
    recovery_budget_exhausted: 'Ngân sách phục hồi đã kiệt.',
    invalid_recipient: 'Địa chỉ nhận không hợp lệ.',
    invalid_locale: 'Locale không hợp lệ.',
    invalid_variables: 'Biến của template không hợp lệ.',
    payload_too_large: 'Nội dung render vượt ngưỡng kích thước.',
  });

/**
 * Dựng domain error.
 *
 * Constructor duy nhất của taxonomy: nó chỉ ghép `code` với message lấy từ
 * {@link MAIL_DOMAIN_ERROR_MESSAGES}, nên **không có đường nào** để lọt dữ liệu tuỳ ý vào
 * message. Muốn đổi câu chữ thì sửa bảng, không sửa call site.
 *
 * @throws TypeError nếu `code` không có trong taxonomy.
 */
export function mailDomainError(code: MailDomainErrorCode): MailDomainError {
  const message = MAIL_DOMAIN_ERROR_MESSAGES[code];
  if (message === undefined) {
    throw new TypeError(`Mail domain error code không hợp lệ: ${String(code)}`);
  }
  return { code, message };
}

/**
 * Type guard: có phải object mang `code` thuộc taxonomy không — kiểm **đầy đủ
 * contract**: `code` có trong bảng (qua `Object.hasOwn`, không đi prototype
 * chain) VÀ `message` khớp đúng message của bảng.
 *
 * ⚠️ Phải dùng `Object.hasOwn`, không dùng `in`: `in` đi cả prototype chain, nên
 * `'toString' in MAIL_DOMAIN_ERROR_MESSAGES` là `true` và guard sẽ nhận
 * `{ code: 'toString' }` là domain error hợp lệ — trong khi
 * `mailDomainError('toString' as MailDomainErrorCode)` lại ném `TypeError`.
 */
export function isMailDomainError(value: unknown): value is MailDomainError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { code } = value as { code?: unknown };
  if (typeof code !== 'string' || !Object.hasOwn(MAIL_DOMAIN_ERROR_MESSAGES, code)) {
    return false;
  }
  return (
    (value as { message?: unknown }).message ===
    MAIL_DOMAIN_ERROR_MESSAGES[code as MailDomainErrorCode]
  );
}
