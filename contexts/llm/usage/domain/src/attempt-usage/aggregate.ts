/**
 * Usage measurement là dữ liệu đo lường tiêu thụ, KHÔNG phải financial charge
 * (tính tiền). Charge là quyết định tài chính do authority/quota/settlement xử
 * lý — nằm ở `llm-financial`, không ở đây.
 *
 * `aggregateAttemptUsage` — tổng hợp attempt-level usage thành request-level usage.
 *
 * Chỉ các attempt có status `known` (completed) được tính vào tổng request-level.
 * Attempt `missing` / `malformed` / `partial` phục vụ audit / reconciliation, KHÔNG
 * cộng vào request-level.
 *
 * Tổng theo `sum` của các attempt completed — đây là hành vi interim theo DoF
 * (U-1 chưa chốt: sum vs last-wins còn mở; nếu business chọn khác, hàm này
 * phải được điều chỉnh, không được âm thầm coi sum là quyết định cuối cùng).
 */

import type { RequestId } from '../shared/ids';
import type {
  AttemptUsage,
  NormalizedUsage,
  RequestUsage,
  TokenCount,
  UsageStatus,
} from '../shared/types';
import { isNormalizedUsage } from '../normalized-usage/normalized-usage';

type TokenCountLike = number | null | undefined;

/** Cộng hai `NormalizedUsage` theo thành phần; null truyền lan (tổng của unknown là unknown). */
function sumUsage(a: NormalizedUsage, b: NormalizedUsage): NormalizedUsage {
  return {
    input_tokens: addToken(a.input_tokens, b.input_tokens),
    output_tokens: addToken(a.output_tokens, b.output_tokens),
    cached_tokens: addToken(a.cached_tokens, b.cached_tokens),
    reasoning_tokens: addToken(a.reasoning_tokens, b.reasoning_tokens),
    request_count: addToken(a.request_count, b.request_count),
  } as NormalizedUsage;
}

function addToken(a: TokenCountLike, b: TokenCountLike): TokenCount {
  if (a === null || a === undefined || b === null || b === undefined) {
    return null;
  }
  return a + b;
}

/** Tạo `NormalizedUsage` rỗng (tất cả 0) dùng làm giá trị khởi đầu cho sum.
 * Null thành phần của attempt sẽ truyền lan thành null cho tổng (unknown),
 * nhưng accumulator khởi đầu bằng 0 để phép cộng số hoàn toàn được.
 */
function emptyUsage(): NormalizedUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cached_tokens: 0,
    reasoning_tokens: 0,
    request_count: 0,
  } as NormalizedUsage;
}

/**
 * Xác định status tổng hợp của request-level usage từ danh sách attempt.
 *
 * - Tất cả attempts `missing` → `missing`
 * - Có ít nhất một `malformed` → `malformed`
 * - Có ít nhất một `partial` và không có `malformed` → `partial`
 * - Có ít nhất một `known` → `known`
 * - Danh sách rỗng → `missing`
 */
function aggregateStatus(attempts: readonly AttemptUsage[]): UsageStatus {
  if (attempts.length === 0) {
    return 'missing';
  }
  let hasKnown = false;
  let hasPartial = false;
  for (const attempt of attempts) {
    if (attempt.status === 'known') {
      hasKnown = true;
    } else if (attempt.status === 'malformed') {
      return 'malformed';
    } else if (attempt.status === 'partial') {
      hasPartial = true;
    }
  }
  if (hasKnown) {
    return 'known';
  }
  if (hasPartial) {
    return 'partial';
  }
  return 'missing';
}

/**
 * Tổng hợp attempt-level thành request-level.
 *
 * @returns `RequestUsage` với `aggregated` là sum của các attempt completed,
 *   hoặc `null` khi không có attempt completed nào.
 */
export function aggregateAttemptUsage(attempts: readonly AttemptUsage[]): RequestUsage {
  // Attempt đánh dấu `known` nhưng usage sai hình (NaN, âm, thiếu field) là dữ
  // liệu hỏng: loại khỏi tổng và ép status `malformed` — không để NaN/âm lan
  // vào tổng request-level dưới nhãn `known`.
  let hasInvalidKnown = false;
  const knownAttempts = attempts.filter((a) => {
    if (a.status !== 'known') {
      return false;
    }
    if (!isNormalizedUsage(a.usage)) {
      hasInvalidKnown = true;
      return false;
    }
    return true;
  });
  const aggregated =
    knownAttempts.length === 0
      ? null
      : knownAttempts.reduce((acc, attempt) => sumUsage(acc, attempt.usage), emptyUsage());

  return {
    request_id: attempts.length > 0 ? attempts[0].provenance.request_id : ('' as RequestId | ''),
    attempts,
    aggregated,
    status: hasInvalidKnown ? 'malformed' : aggregateStatus(attempts),
  };
}
