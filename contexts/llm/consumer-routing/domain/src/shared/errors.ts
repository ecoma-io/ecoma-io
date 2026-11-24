/**
 * Taxonomy lỗi của tầng domain `llm-consumer-routing`.
 *
 * Pattern: `libs/account-domain/src/shared/errors.ts` — một domain error chỉ
 * mang `code` ổn định + `message` ngắn gọn, không field nào cho
 * identifier/token/secret hay payload tuỳ ý. Một error object đi thẳng ra log
 * và ra response, nên cho phép mang token hay API key trong message là biến
 * log thành kênh thu thập secret không kiểm soát.
 *
 * Message là ENGLISH theo language policy của repo (runtime string, không
 * phải documentation).
 */

export type RoutingDomainErrorCode =
  | 'invalid_alias'
  | 'alias_not_found'
  | 'alias_retired'
  | 'invalid_policy_version'
  | 'invalid_candidate'
  | 'no_eligible_candidate'
  | 'fallback_not_allowed'
  | 'fallback_exhausted'
  | 'invalid_strategy_input'
  | 'invalid_snapshot';

export const ROUTING_DOMAIN_ERROR_MESSAGES: Record<RoutingDomainErrorCode, string> = Object.freeze({
  invalid_alias: 'The model alias is not valid.',
  alias_not_found: 'The model alias was not found.',
  alias_retired: 'The model alias has been retired.',
  invalid_policy_version: 'The routing policy version is not valid.',
  invalid_candidate: 'The routing candidate is not valid.',
  no_eligible_candidate: 'No eligible routing candidate exists.',
  fallback_not_allowed: 'Fallback is not allowed for the current attempt evidence.',
  fallback_exhausted: 'All routing fallback candidates are exhausted.',
  invalid_strategy_input: 'The routing strategy input is not valid.',
  invalid_snapshot: 'The routing snapshot is not valid.',
});

export interface RoutingDomainError {
  readonly code: RoutingDomainErrorCode;
  readonly message: string;
}

export function isRoutingDomainError(value: unknown): value is RoutingDomainError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  // `Object.hasOwn`, không dùng `in`: `in` đi cả prototype chain nên
  // `{ code: 'toString' }` sẽ lọt guard trong khi factory không sinh code đó.
  const code = (value as RoutingDomainError).code;
  return (
    typeof code === 'string' &&
    Object.hasOwn(ROUTING_DOMAIN_ERROR_MESSAGES, code) &&
    typeof (value as RoutingDomainError).message === 'string'
  );
}

export function routingDomainError(code: RoutingDomainErrorCode): RoutingDomainError {
  return { code, message: ROUTING_DOMAIN_ERROR_MESSAGES[code] };
}
