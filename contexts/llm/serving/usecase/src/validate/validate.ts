/**
 * Validation THUẦN của body chat completions — step 5 và 9 của pipeline.
 * Không env, không DB, không fetch; gọi `admissionUpperBoundAmount` của
 * llm-financial-domain cho admission amount (một điểm làm tròn duy nhất).
 */

import { admissionUpperBoundAmount, createMoney, type Money } from '@ecoma-io/llm-financial-domain';

/** Denomination serving của MVP: UC (denomination duy nhất bootstrap cấp). */
export const SERVING_DENOMINATION = 'UC' as const;

/** Mã lỗi validation — transport map sang HTTP error tương ứng. */
export type ChatRequestFailure =
  | 'missing_model'
  | 'missing_messages'
  | 'invalid_messages'
  | 'streaming_not_supported'
  | 'max_tokens_required'
  | 'invalid_max_tokens';

/** Request chat đã hợp lệ: các field serving dùng (phần còn lại không truyền upstream). */
export interface ValidatedChatRequest {
  readonly model: string;
  readonly messages: readonly unknown[];
  readonly maxTokens: number;
}

/** Kết quả validate body chat completions. */
export type ChatRequestValidation =
  | { readonly kind: 'valid'; readonly request: ValidatedChatRequest }
  | { readonly kind: 'invalid'; readonly failure: ChatRequestFailure };

/**
 * Validate body của POST /v1/chat/completions:
 * - `model` string không rỗng — bắt buộc.
 * - `messages` array không rỗng, mỗi item là object có `role` string — bắt buộc.
 * - `max_tokens` integer ≥ 1 — BẮT BUỘC (output bound không có tokenizer, lấy
 *   trực tiếp từ client; thiếu là 422 ổn định).
 * - `stream` chỉ nhận vắng mặt/`false` — streaming là non-goal, từ chối ổn
 *   định thay vì im lặng downgrade.
 * Các field khác (temperature, tools, ...) không đọc — MVP passthrough tối
 * thiểu, payload upstream chỉ gồm model/messages/max_tokens.
 */
export function validateChatRequest(body: unknown): ChatRequestValidation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { kind: 'invalid', failure: 'missing_model' };
  }
  const record = body as Record<string, unknown>;
  if (typeof record['model'] !== 'string' || record['model'].length === 0) {
    return { kind: 'invalid', failure: 'missing_model' };
  }
  const messages = record['messages'];
  if (!Array.isArray(messages) || messages.length === 0) {
    return { kind: 'invalid', failure: 'missing_messages' };
  }
  for (const message of messages) {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      return { kind: 'invalid', failure: 'invalid_messages' };
    }
    if (typeof (message as Record<string, unknown>)['role'] !== 'string') {
      return { kind: 'invalid', failure: 'invalid_messages' };
    }
  }
  if (record['stream'] === true) {
    return { kind: 'invalid', failure: 'streaming_not_supported' };
  }
  if (record['stream'] !== undefined && record['stream'] !== false) {
    return { kind: 'invalid', failure: 'streaming_not_supported' };
  }
  const maxTokens = record['max_tokens'];
  if (maxTokens === undefined || maxTokens === null) {
    return { kind: 'invalid', failure: 'max_tokens_required' };
  }
  if (
    typeof maxTokens !== 'number' ||
    !Number.isInteger(maxTokens) ||
    maxTokens < 1 ||
    maxTokens > Number.MAX_SAFE_INTEGER
  ) {
    return { kind: 'invalid', failure: 'invalid_max_tokens' };
  }
  return {
    kind: 'valid',
    request: { model: record['model'], messages, maxTokens },
  };
}

/**
 * Ước lượng ký tự prompt — determinstic, KHÔNG tokenizer (MVP limitation được
 * ghi nhận): cộng độ dài `content` dạng string hoặc mảng text part
 * (`{type:'text', text}`) của mỗi message.
 */
export function estimatePromptCharacters(messages: readonly unknown[]): number {
  let total = 0;
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) {
      continue;
    }
    const content = (message as Record<string, unknown>)['content'];
    if (typeof content === 'string') {
      total += content.length;
      continue;
    }
    if (Array.isArray(content)) {
      for (const part of content) {
        if (
          typeof part === 'object' &&
          part !== null &&
          (part as Record<string, unknown>)['type'] === 'text' &&
          typeof (part as Record<string, unknown>)['text'] === 'string'
        ) {
          total += ((part as Record<string, unknown>)['text'] as string).length;
        }
      }
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Token bounds + admission hold
// ---------------------------------------------------------------------------

/** Cận token của một request sau khi qua cap của pricing snapshot. */
export interface TokenBounds {
  /** min(ceil(ký tự prompt / 2), cap input của snapshot). */
  readonly inputTokens: bigint;
  /** min(max_tokens client, cap output của snapshot). */
  readonly outputTokens: bigint;
}

/**
 * Hai cận token admission:
 * - input bound = ceil(ký tự prompt / 2) — over-estimate determinstic, không
 *   phụ thuộc tokenizer; byte-length an toàn hơn nhưng chars là đơn vị người
 *   đọc được ghi trong DECISION.
 * - output bound = `max_tokens` client (bắt buộc).
 * Cả hai bị CAP bởi per-request bounds của snapshot TRƯỚC khi tính giá
 * (hold = min(bound, cap) × rate); vượt cap không chặn request — charge thật
 * vượt hold bị cap tại held + audit `financial_charge_capped` (ADR-0028 §5).
 */
export function computeTokenBounds(input: {
  promptCharacters: number;
  maxTokens: number;
  maxInputTokensPerRequest: bigint;
  maxOutputTokensPerRequest: bigint;
}): TokenBounds {
  const inputEstimate = BigInt(Math.ceil(input.promptCharacters / 2));
  const clientOutput = BigInt(input.maxTokens);
  return {
    inputTokens:
      inputEstimate < input.maxInputTokensPerRequest
        ? inputEstimate
        : input.maxInputTokensPerRequest,
    outputTokens:
      clientOutput < input.maxOutputTokensPerRequest
        ? clientOutput
        : input.maxOutputTokensPerRequest,
  };
}

/** Kết quả tính admission amount: Money hoặc failure (lỗi cấu hình serving). */
export type AdmissionAmountResolution =
  | { readonly ok: true; readonly amount: Money }
  | { readonly ok: false; readonly errorCode: string };

/**
 * Admission amount (ADR-0028 §5) — cận trên số tiền một attempt có thể charge,
 * tính TRƯỚC khi dispatch, một điểm làm tròn qua `admissionUpperBoundAmount`
 * của llm-financial-domain. Lỗi compute (rate cấu hình hỏng/overflow) là lỗi
 * cấu hình serving, không phải lỗi client — caller fail-closed.
 */
export function computeAdmissionAmount(input: {
  inputRatePerMillionMinor: bigint;
  outputRatePerMillionMinor: bigint;
  inputTokens: bigint;
  outputTokens: bigint;
}): AdmissionAmountResolution {
  const outcome = admissionUpperBoundAmount({
    denomination: SERVING_DENOMINATION,
    perRequestMinor: 0n,
    inputRatePerMillionMinor: input.inputRatePerMillionMinor,
    outputRatePerMillionMinor: input.outputRatePerMillionMinor,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
  });
  if (!outcome.ok) {
    return { ok: false, errorCode: outcome.error.code };
  }
  const money = createMoney(SERVING_DENOMINATION, outcome.value.minor);
  if (!money.ok) {
    return { ok: false, errorCode: money.error.code };
  }
  return { ok: true, amount: money.value };
}
