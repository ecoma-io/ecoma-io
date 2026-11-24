/**
 * Dispatch + phân loại evidence cho serving path (quy tắc F1–F6; ADR-0028 §5
 * compensation C).
 *
 * Quy tắc evidence (ADR-0027 §8, llm-inference-domain evidence vocabulary):
 * - HTTP status **không phải** evidence. Structured error envelope của provider
 *   ở 4xx (400/401/403/404/422) và 429 CHỨNG MINH request bị từ chối trước khi
 *   thực thi → `confirmed_not_executed` → release giữ tiền + giữ quota.
 * - Timeout / network error / abort / status khác / body không JSON →
 *   `may_have_executed` (fail-safe): KHÔNG blind retry, capture bị cap tại
 *   held, usage_status `missing`, escalate (F5).
 * - 200 parse được + shape đúng → `confirmed_completed`; usage parse fail →
 *   `missing`/`malformed`, KHÔNG BAO GIỜ ngầm tính 0 (invariant 6).
 *
 * Bất biến platform: body upstream KHÔNG BAO GIỜ đi vào log; credential
 * plaintext chỉ đi vào header `Authorization` của một dispatch qua
 * {@link UpstreamProvider}.
 */
import { canTransitionEvidence, type ExecutionEvidence } from '@ecoma-io/llm-inference-domain';
import { normalizeUsage, type NormalizedUsage } from '@ecoma-io/llm-usage-domain';

import type { Command } from '@ecoma-io/usecase-primitives';

import type { UpstreamProvider, RawUpstreamOutcome } from '../ports/upstream-provider.js';

/** Version normalizer usage của serving path (tham số của `normalizeUsage`). */
export const USAGE_NORMALIZER_VERSION = 'llm-serving-usecase-chat-completions@1';

/** Phần completion parse được từ body 200 đúng shape OpenAI. */
export interface UpstreamCompletion {
  readonly content: string;
  readonly finishReason: string | null;
  readonly upstreamModel: string | null;
}

/** Usage parse từ body upstream — `missing`/`malformed` không bao giờ thành 0. */
export type UpstreamUsageResolution =
  | { readonly status: 'known'; readonly usage: NormalizedUsage; readonly rawUsage: unknown }
  | { readonly status: 'missing' }
  | { readonly status: 'malformed' };

/** Outcome đã phân loại — orchestration map thẳng sang settle/release + response. */
export interface ClassifiedUpstreamOutcome {
  readonly evidence: DispatchedExecutionEvidence;
  /** Non-null chỉ khi `confirmed_completed` và body shape đúng (content string). */
  readonly completion: UpstreamCompletion | null;
  readonly usage: UpstreamUsageResolution;
  /** Retry-After hợp lệ forward từ upstream 429 (1..3600 giây); còn lại null. */
  readonly retryAfterSeconds: number | null;
}

/**
 * Evidence có thể có SAU khi dispatch đã chạy — `not_sent` chỉ tồn tại trước
 * dispatch, nên `classifyUpstreamOutcome` (luôn post-dispatch) không bao giờ
 * trả nó; type này giữ invariant đó ở mức type thay vì kiểm runtime.
 */
export type DispatchedExecutionEvidence = Exclude<ExecutionEvidence, 'not_sent'>;

/** Status 4xx mà structured error envelope của provider chứng minh không thực thi. */
const PROVIDER_REFUSAL_STATUSES: ReadonlySet<number> = new Set([400, 401, 403, 404, 422]);

/** Retry-After hợp lệ để forward: integer 1..3600 giây. */
function parseRetryAfter(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3600) {
    return null;
  }
  return parsed;
}

/**
 * Đếm token provider: `undefined`/`null` → `null` (thiếu), giá trị khác số
 * nguyên không âm finite → ném TypeError (caller bắt thành usage `malformed`,
 * không bao giờ clamp ngầm 0 — invariant 6). Token count là số nguyên theo
 * định nghĩa — fractional là dữ liệu provider hỏng, không phải usage thật.
 */
function asProviderCount(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new TypeError('invalid provider token count');
  }
  return value;
}

/** Parse usage object kiểu OpenAI chat completion qua llm-usage-domain. */
function parseUpstreamUsage(body: Record<string, unknown>): UpstreamUsageResolution {
  const rawUsage = body['usage'];
  if (typeof rawUsage !== 'object' || rawUsage === null) {
    return { status: 'missing' };
  }
  const usage = rawUsage as Record<string, unknown>;
  const inputTokens = usage['prompt_tokens'];
  const outputTokens = usage['completion_tokens'];
  if (inputTokens === undefined && outputTokens === undefined) {
    return { status: 'missing' };
  }
  const promptDetails =
    typeof usage['prompt_tokens_details'] === 'object' && usage['prompt_tokens_details'] !== null
      ? (usage['prompt_tokens_details'] as Record<string, unknown>)
      : undefined;
  const completionDetails =
    typeof usage['completion_tokens_details'] === 'object' &&
    usage['completion_tokens_details'] !== null
      ? (usage['completion_tokens_details'] as Record<string, unknown>)
      : undefined;
  // Mọi lần đọc count nằm TRONG try: giá trị sai hình (âm, non-finite,
  // non-number) ném TypeError và được bắt thành usage `malformed` — không bao
  // giờ để lỗi thoát ra ngoài lớp classify (invariant 6).
  try {
    const input = asProviderCount(inputTokens);
    const output = asProviderCount(outputTokens);
    const normalized = normalizeUsage(
      {
        provider: 'upstream',
        model: typeof body['model'] === 'string' ? body['model'] : '',
        input_tokens: input,
        output_tokens: output,
        cached_tokens:
          promptDetails === undefined ? null : asProviderCount(promptDetails['cached_tokens']),
        reasoning_tokens:
          completionDetails === undefined
            ? null
            : asProviderCount(completionDetails['reasoning_tokens']),
        request_count: null,
        raw_usage: rawUsage,
      },
      USAGE_NORMALIZER_VERSION,
    );
    // 'known' đòi CẢ hai count chính diện: thiếu một (null) là usage không đủ
    // để charge — không bao giờ ngầm tính 0 cho phía thiếu (invariant 6).
    if (normalized.input_tokens === null || normalized.output_tokens === null) {
      return { status: 'missing' };
    }
    return { status: 'known', usage: normalized, rawUsage };
  } catch {
    return { status: 'malformed' };
  }
}

/** Parse một completion 200 đúng shape OpenAI; sai shape → completion null (→ malformed). */
function parseCompletionBody(bodyText: string): {
  completion: UpstreamCompletion | null;
  usage: UpstreamUsageResolution;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch {
    return { completion: null, usage: { status: 'malformed' } };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { completion: null, usage: { status: 'malformed' } };
  }
  const body = parsed as Record<string, unknown>;
  const firstChoice = extractFirstChoice(body);
  const completion =
    firstChoice === null
      ? null
      : {
          content: firstChoice.content,
          finishReason: firstChoice.finishReason,
          upstreamModel: typeof body['model'] === 'string' ? body['model'] : null,
        };
  return { completion, usage: parseUpstreamUsage(body) };
}

/** `choices[0].message.content` khi đúng shape string; còn lại `null`. */
function extractFirstChoice(
  body: Record<string, unknown>,
): { content: string; finishReason: string | null } | null {
  const choices = body['choices'];
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const choice = choices[0];
  if (typeof choice !== 'object' || choice === null) {
    return null;
  }
  const message = (choice as Record<string, unknown>)['message'];
  if (typeof message !== 'object' || message === null) {
    return null;
  }
  const content = (message as Record<string, unknown>)['content'];
  if (typeof content !== 'string') {
    return null;
  }
  const finishReason = (choice as Record<string, unknown>)['finish_reason'];
  return {
    content,
    finishReason: typeof finishReason === 'string' ? finishReason : null,
  };
}

/**
 * Phân loại outcome raw thành evidence + completion + usage — hàm thuần, bảng
 * quyết định của invariant 6/F5 ghim ở đây. HTTP status một mình KHÔNG BAO GIỜ
 * cho ra `confirmed_not_executed`: 429 là provider semantics (rate limit từ
 * chối trước thực thi), 4xx chỉ chứng minh khi body là JSON object; mọi case
 * khác → `may_have_executed`.
 */
export function classifyUpstreamOutcome(raw: RawUpstreamOutcome): ClassifiedUpstreamOutcome {
  if (raw.failureKind !== null || raw.httpStatus === null) {
    return {
      evidence: 'may_have_executed',
      completion: null,
      usage: { status: 'missing' },
      retryAfterSeconds: null,
    };
  }
  if (raw.httpStatus === 429) {
    return {
      evidence: 'confirmed_not_executed',
      completion: null,
      usage: { status: 'missing' },
      retryAfterSeconds: parseRetryAfter(raw.retryAfterHeader),
    };
  }
  if (raw.httpStatus === 200) {
    const parsed =
      raw.bodyText === null
        ? { completion: null, usage: { status: 'malformed' as const } }
        : parseCompletionBody(raw.bodyText);
    return {
      evidence: 'confirmed_completed',
      completion: parsed.completion,
      usage: parsed.usage,
      retryAfterSeconds: null,
    };
  }
  if (PROVIDER_REFUSAL_STATUSES.has(raw.httpStatus)) {
    // Chỉ JSON object mới là structured refusal; body khác (HTML, rỗng) không
    // chứng minh gì → may_have_executed.
    let structured = false;
    if (raw.bodyText !== null) {
      try {
        const parsed: unknown = JSON.parse(raw.bodyText);
        structured = typeof parsed === 'object' && parsed !== null;
      } catch {
        structured = false;
      }
    }
    if (structured) {
      return {
        evidence: 'confirmed_not_executed',
        completion: null,
        usage: { status: 'missing' },
        retryAfterSeconds: null,
      };
    }
  }
  return {
    evidence: 'may_have_executed',
    completion: null,
    usage: { status: 'missing' },
    retryAfterSeconds: null,
  };
}

/** Payload upstream: chỉ các field serving đọc — model giữ identity upstream raw. */
export function buildUpstreamPayload(request: {
  upstreamModel: string;
  messages: readonly unknown[];
  maxTokens: number;
}): string {
  return JSON.stringify({
    model: request.upstreamModel,
    messages: request.messages,
    max_tokens: request.maxTokens,
  });
}

/** Guard transition evidence: evidence chỉ strengthen (llm-inference-domain). */
export function evidenceCanTransition(from: ExecutionEvidence, to: ExecutionEvidence): boolean {
  return canTransitionEvidence(from, to);
}

// ---------------------------------------------------------------------------
// DispatchAttempt Command
// ---------------------------------------------------------------------------

export interface DispatchAttemptInput {
  readonly url: string;
  /** Plaintext credential — opaque passthrough CHỈ cho port, không log/store. */
  readonly credentialPlaintext: string;
  readonly upstreamModel: string;
  readonly messages: readonly unknown[];
  readonly maxTokens: number;
}

/** Alias contract cho type-level test. */
export type DispatchAttemptUseCaseType = Command<DispatchAttemptInput, ClassifiedUpstreamOutcome>;

/**
 * Command dispatch MỘT attempt upstream qua port {@link UpstreamProvider}, rồi
 * phân loại outcome theo bảng evidence. Không retry, không clock — mọi quyết
 * định thời gian thuộc adapter fetch (timeout).
 */
export class DispatchAttemptCommand implements DispatchAttemptUseCaseType {
  readonly #upstream: UpstreamProvider;

  public constructor(upstream: UpstreamProvider) {
    this.#upstream = upstream;
  }

  public async execute(input: DispatchAttemptInput): Promise<ClassifiedUpstreamOutcome> {
    const raw = await this.#upstream.dispatch({
      url: input.url,
      credentialPlaintext: input.credentialPlaintext,
      payloadText: buildUpstreamPayload({
        upstreamModel: input.upstreamModel,
        messages: input.messages,
        maxTokens: input.maxTokens,
      }),
    });
    return classifyUpstreamOutcome(raw);
  }
}
