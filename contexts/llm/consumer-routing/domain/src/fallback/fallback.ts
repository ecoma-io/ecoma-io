/**
 * Fallback decision — routing trả lời "có candidate kế tiếp để fallback hay
 * không", không trả lời "execution có được tiếp tục hay không".
 *
 * Ranh giới với `llm-inference`:
 *
 * - **Routing** sở hữu *which*: alias, eligibility, strategy, thứ tự fallback
 *   endpoint/offer. Hàm dưới đây chỉ kiểm tra routing còn candidate và cấu hình
 *   fallback còn budget hay không.
 * - **Inference** sở hữu *whether*: `evaluateRetryAdmissibility` trong
 *   `@ecoma-io/llm-inference-domain` là **cơ quan duy nhất** quyết định request
 *   có được append attempt mới hay không. Khi cả hai cùng cho phép, application
 *   mới thực hiện fallback.
 *
 * Domain không import xuyên bounded context, nên vocabulary `ExecutionEvidence`
 * được khai báo lại ở biên này. Semantics của bốn giá trị do `llm-inference`
 * sở hữu; `fallback.spec.ts` ghim đúng bốn literal để hai khai báo không lệch
 * nhau âm thầm. Không thêm giá trị thứ năm ở đây.
 */
import type { DomainOk, DomainRejection } from '../shared/shared';

/**
 * Vocabulary bằng chứng thực thi — **khai báo lại tại biên**, không phải nguồn
 * sự thật; nguồn sự thật là vocabulary `ExecutionEvidence` của `llm-inference`.
 */
export type ExecutionEvidence =
  | 'not_sent'
  | 'may_have_executed'
  | 'confirmed_completed'
  | 'confirmed_not_executed';

/** Giá trị canonical của vocabulary — khớp đúng bốn literal ở trên. */
export const EXECUTION_EVIDENCE = {
  not_sent: 'not_sent',
  may_have_executed: 'may_have_executed',
  confirmed_completed: 'confirmed_completed',
  confirmed_not_executed: 'confirmed_not_executed',
} as const;

/** Type guard cho vocabulary tại biên routing. */
export function isExecutionEvidence(value: unknown): value is ExecutionEvidence {
  return (
    typeof value === 'string' &&
    (value === EXECUTION_EVIDENCE.not_sent ||
      value === EXECUTION_EVIDENCE.may_have_executed ||
      value === EXECUTION_EVIDENCE.confirmed_completed ||
      value === EXECUTION_EVIDENCE.confirmed_not_executed)
  );
}

/** Kết quả quyết định fallback của routing. */
export type FallbackDecision =
  | DomainOk<{ readonly fallbackAllowed: true; readonly reason: 'explicit_allowed' }>
  | (DomainRejection<'fallback_not_allowed' | 'fallback_exhausted'> & {
      readonly fallbackAllowed: false;
    });

/** Input của quyết định fallback — mọi fact do caller cung cấp. */
export type FallbackInputs = {
  readonly evidence: ExecutionEvidence;
  readonly streamStarted: boolean;
  readonly attemptCount: number;
  readonly maxAttempts: number;
};

/**
 * Quyết định routing có được phép fallback hay không.
 *
 * Đây **không** phải luật retry: kể cả khi hàm này trả `fallbackAllowed: true`,
 * application vẫn phải gọi `evaluateRetryAdmissibility` của `llm-inference`,
 * vì chỉ inference biết request đã terminal chưa, còn bất định chưa reconcile
 * hay không, và deadline thực tế.
 *
 * Thứ tự kiểm tra:
 * 1. Evidence không hợp lệ → chặn.
 * 2. Stream đã bắt đầu → chặn (không transparent provider switch sau bytes).
 * 3. Evidence `may_have_executed` / `confirmed_completed` → chặn (không blind
 *    retry sau possible execution).
 * 4. `attemptCount >= maxAttempts` → `fallback_exhausted`.
 */
export function decideFallback(inputs: FallbackInputs): FallbackDecision {
  // Guard đầu vào tại ranh giới: số lần attempt và budget phải là số nguyên
  // hợp lệ. Không thừa nhận đầu vào hỏng — fail-safe chặn fallback thay vì
  // để `NaN`/`Infinity` trượt qua phép so sánh (`NaN >= maxAttempts` là false).
  if (
    !Number.isSafeInteger(inputs.attemptCount) ||
    inputs.attemptCount < 0 ||
    !Number.isSafeInteger(inputs.maxAttempts) ||
    inputs.maxAttempts < 1
  ) {
    return {
      ok: false,
      fallbackAllowed: false,
      reason: 'fallback_not_allowed',
      detail: 'Fallback inputs invalid — attempt counts must be non-negative safe integers.',
    };
  }

  if (!isExecutionEvidence(inputs.evidence)) {
    return {
      ok: false,
      fallbackAllowed: false,
      reason: 'fallback_not_allowed',
      detail: 'Invalid execution evidence — cannot decide fallback.',
    };
  }

  // Stream đã bắt đầu: không transparent provider switch sau khi đã stream bytes.
  if (inputs.streamStarted) {
    return {
      ok: false,
      fallbackAllowed: false,
      reason: 'fallback_not_allowed',
      detail: 'Stream already started — no transparent provider switch.',
    };
  }

  // may_have_executed / confirmed_completed -> không fallback (tránh duplicate side effect).
  if (
    inputs.evidence === EXECUTION_EVIDENCE.may_have_executed ||
    inputs.evidence === EXECUTION_EVIDENCE.confirmed_completed
  ) {
    return {
      ok: false,
      fallbackAllowed: false,
      reason: 'fallback_not_allowed',
      detail: `Evidence ${inputs.evidence} blocks fallback (no blind retry).`,
    };
  }

  // not_sent / confirmed_not_executed -> fallback được phép nếu chưa quá max attempts.
  if (inputs.attemptCount >= inputs.maxAttempts) {
    return {
      ok: false,
      fallbackAllowed: false,
      reason: 'fallback_exhausted',
      detail: 'All fallback attempts exhausted — attempt count beyond limit.',
    };
  }

  return {
    ok: true,
    fallbackAllowed: true,
    reason: 'explicit_allowed',
  };
}

/**
 * Evidence chứng minh provider không thực thi, nên fallback không tạo side
 * effect trùng. Đây là **cùng** phân loại với `isRetrySafeEvidence` của
 * `llm-inference`; định nghĩa ở đây chỉ để routing tự đọc vocabulary tại biên.
 */
export function isFallbackAllowedEvidence(evidence: ExecutionEvidence): boolean {
  return (
    evidence === EXECUTION_EVIDENCE.not_sent ||
    evidence === EXECUTION_EVIDENCE.confirmed_not_executed
  );
}
