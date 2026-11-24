/**
 * Taxonomy lỗi của tầng domain `llm-usage`.
 *
 * Pattern: `libs/account-domain/src/shared/errors.ts` — một domain error chỉ mang
 * `code` ổn định + `message` tiếng Anh ngắn gọn, không field nào cho
 * identifier/token/secret hay payload tuỳ ý. Message là runtime string do developer
 * viết (ngôn ngữ English theo language policy của repo), không được dịch sang tiếng Việt.
 */

/** Mã lỗi ổn định — contract với consumer, không đổi nghĩa theo thời gian. */
export type DomainErrorCode =
  | 'invalid_usage'
  | 'invalid_token_count'
  | 'invalid_correction'
  | 'unknown_normalizer_version'
  | 'usage_missing'
  | 'usage_malformed';

/** Message tiếng Anh của từng mã — bảng nguồn duy nhất của factory. */
export const LLM_USAGE_DOMAIN_ERROR_MESSAGES: Readonly<Record<DomainErrorCode, string>> =
  Object.freeze({
    invalid_usage: 'Usage value is not valid.',
    invalid_token_count: 'Token count is not valid.',
    invalid_correction: 'Correction is not valid.',
    unknown_normalizer_version: 'Normalizer version is not recognized.',
    usage_missing: 'Usage is missing from provider.',
    usage_malformed: 'Usage from provider is malformed.',
  });

/** Error domain: `code` ổn định + `message` tiếng Anh ngắn gọn. */
export interface LLMUsageDomainError {
  readonly code: DomainErrorCode;
  readonly message: string;
}

/**
 * Dựng domain error từ mã — message lấy từ bảng nguồn duy nhất.
 *
 * @throws TypeError nếu `code` không có trong taxonomy.
 */
export function llmUsageDomainError(code: DomainErrorCode): LLMUsageDomainError {
  const message = LLM_USAGE_DOMAIN_ERROR_MESSAGES[code];
  if (message === undefined) {
    throw new TypeError(`Unknown domain error code: ${String(code)}`);
  }
  return { code, message };
}

/**
 * Type guard: có phải domain error của context này không.
 *
 * Kiểm `code` bằng `Object.hasOwn` (không đi prototype chain) và `message` là
 * string — object tự chế `{ code, message: tùy ý }` không được nhận.
 */
export function isLLMUsageDomainError(value: unknown): value is LLMUsageDomainError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as LLMUsageDomainError).code === 'string' &&
    Object.hasOwn(LLM_USAGE_DOMAIN_ERROR_MESSAGES, (value as LLMUsageDomainError).code) &&
    typeof (value as LLMUsageDomainError).message === 'string'
  );
}

/** Một domain error không chứa field nào ngoài `code` và `message`. */
export function domainErrorKeys(error: LLMUsageDomainError): readonly string[] {
  return Object.keys(error) as readonly string[];
}
