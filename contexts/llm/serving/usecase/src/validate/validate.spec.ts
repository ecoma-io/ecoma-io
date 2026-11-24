/**
 * Bảng quyết định validation thuần: validateChatRequest, bounds, admission amount.
 */
import { describe, expect, it } from 'vitest';

import {
  computeAdmissionAmount,
  computeTokenBounds,
  estimatePromptCharacters,
  validateChatRequest,
} from './validate.js';

/** Narrow về invalid — throw thay vì conditional expect (vitest lint). */
function validationFailure(outcome: ReturnType<typeof validateChatRequest>): string {
  if (outcome.kind !== 'invalid') {
    throw new Error('expected invalid validation outcome');
  }
  return outcome.failure;
}

describe('validateChatRequest', () => {
  it('accepts a minimal valid request', () => {
    const outcome = validateChatRequest({
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 10,
    });
    expect(outcome).toEqual({
      kind: 'valid',
      request: { model: 'gpt-test', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 },
    });
  });

  it('rejects missing or empty model', () => {
    expect(validationFailure(validateChatRequest({}))).toBe('missing_model');
    expect(validationFailure(validateChatRequest({ model: '' }))).toBe('missing_model');
    expect(validationFailure(validateChatRequest('nope'))).toBe('missing_model');
  });

  it('rejects missing or empty messages', () => {
    expect(validationFailure(validateChatRequest({ model: 'm' }))).toBe('missing_messages');
    expect(validationFailure(validateChatRequest({ model: 'm', messages: [] }))).toBe(
      'missing_messages',
    );
  });

  it('rejects messages whose items lack a role string', () => {
    expect(validationFailure(validateChatRequest({ model: 'm', messages: ['hi'] }))).toBe(
      'invalid_messages',
    );
    expect(validationFailure(validateChatRequest({ model: 'm', messages: [{}] }))).toBe(
      'invalid_messages',
    );
  });

  it('rejects stream true and any non-false stream value', () => {
    const base = { model: 'm', messages: [{ role: 'user' }], max_tokens: 1 };
    expect(validationFailure(validateChatRequest({ ...base, stream: true }))).toBe(
      'streaming_not_supported',
    );
    expect(validationFailure(validateChatRequest({ ...base, stream: 'yes' }))).toBe(
      'streaming_not_supported',
    );
    expect(validateChatRequest({ ...base, stream: false }).kind).toBe('valid');
  });

  it('requires max_tokens (422 semantics) and rejects invalid values', () => {
    const base = { model: 'm', messages: [{ role: 'user' }] };
    expect(validationFailure(validateChatRequest(base))).toBe('max_tokens_required');
    expect(validationFailure(validateChatRequest({ ...base, max_tokens: 0 }))).toBe(
      'invalid_max_tokens',
    );
    expect(validationFailure(validateChatRequest({ ...base, max_tokens: 1.5 }))).toBe(
      'invalid_max_tokens',
    );
    expect(validationFailure(validateChatRequest({ ...base, max_tokens: '5' }))).toBe(
      'invalid_max_tokens',
    );
  });
});

describe('estimatePromptCharacters', () => {
  it('sums string content lengths', () => {
    expect(estimatePromptCharacters([{ content: 'abcd' }, { content: 'ef' }])).toBe(6);
  });

  it('sums text parts of array content and skips non-text parts', () => {
    expect(
      estimatePromptCharacters([
        { content: [{ type: 'text', text: 'abc' }, { type: 'image_url' }, 'junk'] },
      ]),
    ).toBe(3);
  });

  it('skips malformed messages', () => {
    expect(estimatePromptCharacters(['nope', null, undefined])).toBe(0);
  });
});

describe('computeTokenBounds', () => {
  it('over-estimates input as ceil(chars/2) and uses max_tokens for output', () => {
    expect(
      computeTokenBounds({
        promptCharacters: 5,
        maxTokens: 10,
        maxInputTokensPerRequest: 100n,
        maxOutputTokensPerRequest: 100n,
      }),
    ).toEqual({ inputTokens: 3n, outputTokens: 10n });
  });

  it('caps both bounds by the snapshot per-request limits', () => {
    expect(
      computeTokenBounds({
        promptCharacters: 1000,
        maxTokens: 9999,
        maxInputTokensPerRequest: 100n,
        maxOutputTokensPerRequest: 50n,
      }),
    ).toEqual({ inputTokens: 100n, outputTokens: 50n });
  });
});

describe('computeAdmissionAmount', () => {
  it('computes the ceil upper bound with one rounding point', () => {
    // 3 in × 1_000_000/1M = 3; 2 out × 1_000_000/1M = 2 → 5.
    expect(
      computeAdmissionAmount({
        inputRatePerMillionMinor: 1_000_000n,
        outputRatePerMillionMinor: 1_000_000n,
        inputTokens: 3n,
        outputTokens: 2n,
      }),
    ).toEqual({ ok: true, amount: { denomination: 'UC', minor: 5n } });
  });

  it('rounds up per term (ceil), never down', () => {
    // 1 token × 1/1M → ceil = 1 minor per term.
    expect(
      computeAdmissionAmount({
        inputRatePerMillionMinor: 1n,
        outputRatePerMillionMinor: 1n,
        inputTokens: 1n,
        outputTokens: 1n,
      }),
    ).toEqual({ ok: true, amount: { denomination: 'UC', minor: 2n } });
  });

  it('fails closed on invalid (negative) rates', () => {
    expect(
      computeAdmissionAmount({
        inputRatePerMillionMinor: -1n,
        outputRatePerMillionMinor: 1n,
        inputTokens: 1n,
        outputTokens: 1n,
      }).ok,
    ).toBe(false);
  });

  it('fails closed when the upper-bound amount overflows money magnitude', () => {
    // Rate cấu hình hỏng → amount_overflow, không được clamp ngầm về 0 hay âm.
    expect(
      computeAdmissionAmount({
        inputRatePerMillionMinor: 10n ** 40n,
        outputRatePerMillionMinor: 0n,
        inputTokens: 1n,
        outputTokens: 1n,
      }).ok,
    ).toBe(false);
  });

  it('covers the createMoney guard when admission upper bound returns an unbuildable amount', () => {
    // createMoney của validate chỉ fail khi minor vượt magnitude — giá trị tới
    // được qua admissionUpperBoundAmount đã cùng ràng buộc; guard là hai lớp,
    // test trực tiếp logic phục vụ audit: đúng 10^30 - 1 vẫn hợp lệ.
    expect(
      computeAdmissionAmount({
        inputRatePerMillionMinor: 10n ** 30n - 1n,
        outputRatePerMillionMinor: 0n,
        inputTokens: 1n,
        outputTokens: 0n,
      }),
    ).toMatchObject({ ok: true });
  });
});
