/**
 * `normalizeUsage` — chuẩn hóa định dạng provider sang normalized usage schema.
 *
 * Input là `ParsedProviderUsage` đã được parse bởi lớp adapter/infrastructure;
 * domain KHÔNG đọc raw HTTP payload và KHÔNG phụ thuộc provider SDK.
 *
 * Thuần, deterministic, versioned: cùng input + cùng normalizer_version → cùng output.
 * Version là tham số do caller cung cấp; domain không sinh version.
 */

import type { NormalizedUsage, ParsedProviderUsage, TokenCount } from '../shared/types';
import { isValidTokenCount } from './normalized-usage';

/** Kiểm một chuỗi normalizer_version có dạng hợp lệ không (không rỗng, không whitespace). */
function isValidNormalizerVersion(version: string): boolean {
  return typeof version === 'string' && version.trim().length > 0;
}

/** Chuẩn hóa một `TokenCount` từ giá trị số (có thể undefined/null). */
function toTokenCount(value: number | null | undefined): TokenCount {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isValidTokenCount(value)) {
    throw new TypeError(
      `Token count must be a non-negative finite number or null, received: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Chuẩn hóa `ParsedProviderUsage` thành `NormalizedUsage`.
 *
 * @throws TypeError nếu `normalizer_version` không hợp lệ (rỗng/whitespace).
 */
export function normalizeUsage(
  providerUsage: ParsedProviderUsage,
  normalizer_version: string,
): NormalizedUsage {
  if (!isValidNormalizerVersion(normalizer_version)) {
    throw new TypeError(
      `normalizer_version must be a non-empty string, received: ${JSON.stringify(normalizer_version)}`,
    );
  }

  return {
    input_tokens: toTokenCount(providerUsage.input_tokens),
    output_tokens: toTokenCount(providerUsage.output_tokens),
    cached_tokens: toTokenCount(providerUsage.cached_tokens),
    reasoning_tokens: toTokenCount(providerUsage.reasoning_tokens),
    request_count: toTokenCount(providerUsage.request_count),
  } as NormalizedUsage;
}
