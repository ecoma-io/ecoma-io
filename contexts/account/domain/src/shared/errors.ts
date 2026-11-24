/**
 * Taxonomy lỗi của tầng domain `identity`.
 *
 * ⚠️ **Quy tắc bất di bất dịch: một domain error chỉ được mang `code` ổn định + `message`
 * tiếng Việt ngắn gọn.** Không field nào cho cookie, token, session identifier, handle,
 * `code_verifier`, secret hay bất kỳ giá trị nào đọc lại được từ nó.
 *
 * Lý do — invariant 9: không log password, session cookie,
 * `code_verifier`, token hay assertion. Một error object đi thẳng ra log, ra response
 * BFF và ra audit; nó là nơi dễ rò chính vì nó mang theo "ngữ cảnh" của lỗi. Nếu error
 * được phép mang `sub` hay `handle` thì log lỗi trở thành kênh thu thập identifier
 * mà không có kiểm soát nào.
 *
 * Vì vậy type {@link DomainErrorCode} là `string` thuần và {@link DomainError} không
 * có chỗ để đặt payload tuỳ ý. Muốn thêm ngữ cảnh cho việc chẩn đoán thì thêm mã mới
 * vào taxonomy, không gắn dữ liệu lạnh vào mã cũ.
 */

/** Mã lỗi ổn định — contract với consumer, không đổi nghĩa theo thời gian. */
export type DomainErrorCode =
  | 'invalid_subject'
  | 'session_expired'
  | 'session_revoked'
  | 'reauthentication_required'
  | 'acr_insufficient'
  | 'account_deleted'
  | 'account_suspended'
  | 'invalid_transition'
  | 'email_already_registered'
  | 'email_not_found'
  | 'email_not_pending'
  | 'last_verified_email';

/** Error domain: `code` ổn định + `message` tiếng Việt ngắn gọn. */
export interface DomainError {
  readonly code: DomainErrorCode;
  readonly message: string;
}

/**
 * Những lỗi không nhạy cảm theo nghĩa đen — không chứa dữ liệu định danh hay bí mật.
 * Frozen: consumer không được sửa message tại runtime — nếu bị sửa thì
 * `domainError(code)` sẽ phát ra nội dung tùy ý, phá vỡ claim "không có đường nào
 * lọt dữ liệu tuỳ ý vào message".
 */
export const DOMAIN_ERROR_MESSAGES: Readonly<Record<DomainErrorCode, string>> = Object.freeze({
  account_deleted: 'Tài khoản đã bị xoá.',
  account_suspended: 'Tài khoản đang bị tạm khoá.',
  acr_insufficient: 'Mức assurance (ACR) chưa đủ cho thao tác này.',
  email_already_registered: 'Địa chỉ email đã được đăng ký trên tài khoản.',
  email_not_found: 'Không tìm thấy địa chỉ email trên tài khoản.',
  email_not_pending: 'Địa chỉ email không ở trạng thái chờ xác thực.',
  invalid_subject: 'Subject không hợp lệ.',
  invalid_transition: 'Chuyển trạng thái không hợp lệ.',
  last_verified_email: 'Không thể thu hồi địa chỉ email xác thực duy nhất.',
  reauthentication_required: 'Cần xác thực lại trước khi tiếp tục.',
  session_expired: 'Phiên đã hết hạn.',
  session_revoked: 'Phiên đã bị thu hồi.',
});

/**
 * Dựng domain error.
 *
 * Constructor duy nhất của taxonomy: nó chỉ ghép `code` với message lấy từ
 * {@link DOMAIN_ERROR_MESSAGES}, nên **không có đường nào** để lọt dữ liệu tuỳ ý vào
 * message. Muốn đổi câu chữ thì sửa bảng, không sửa call site.
 *
 * @throws TypeError nếu `code` không có trong taxonomy.
 */
export function domainError(code: DomainErrorCode): DomainError {
  const message = DOMAIN_ERROR_MESSAGES[code];
  if (message === undefined) {
    throw new TypeError(`Domain error code không hợp lệ: ${String(code)}`);
  }
  return { code, message };
}

/**
 * Type guard: có phải object mang `code` thuộc taxonomy không — kiểm **đầy đủ
 * contract**: `code` có trong bảng (qua `Object.hasOwn`, không đi prototype
 * chain) VÀ `message` khớp đúng message của bảng. Kiểm message phát hiện
 * object tự chế `{ code, message: "tùy ý" }` — error ra log/response phải là
 * sản phẩm của {@link domainError} duy nhất.
 *
 * ⚠️ Phải dùng `Object.hasOwn`, không dùng `in`: `in` đi cả prototype chain, nên
 * `'toString' in DOMAIN_ERROR_MESSAGES` là `true` (kế thừa từ `Object.prototype`)
 * và guard sẽ nhận `{ code: 'toString' }` là domain error hợp lệ — trong khi
 * `domainError('toString' as DomainErrorCode)` lại ném `TypeError`. Hai hướng
 * ngược nhau trên cùng một taxonomy là cửa để caller lách kiểm taxonomy ở đầu
 * vào.
 */
export function isDomainError(value: unknown): value is DomainError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { code } = value as { code?: unknown };
  if (typeof code !== 'string' || !Object.hasOwn(DOMAIN_ERROR_MESSAGES, code)) {
    return false;
  }
  return (
    (value as { message?: unknown }).message === DOMAIN_ERROR_MESSAGES[code as DomainErrorCode]
  );
}
