/**
 * Bảng quyết định evidence của classifyUpstreamOutcome — invariant 6/F5:
 * HTTP status một mình KHÔNG BAO GIỜ cho `confirmed_not_executed`.
 */
import { describe, expect, it } from 'vitest';

import {
  buildUpstreamPayload,
  classifyUpstreamOutcome,
  DispatchAttemptCommand,
} from './dispatch.js';
import { FakeUpstream } from '../testing/fake-ports.js';
import type { UpstreamUsageResolution } from './dispatch.js';

function raw(input: Partial<Parameters<typeof classifyUpstreamOutcome>[0]> = {}) {
  return {
    failureKind: null,
    httpStatus: 200,
    bodyText: null,
    retryAfterHeader: null,
    ...input,
  };
}

/** Narrow usage về known — throw thay vì conditional expect (vitest lint). */
function assertKnownUsage(
  usage: UpstreamUsageResolution,
): asserts usage is Extract<UpstreamUsageResolution, { status: 'known' }> {
  if (usage.status !== 'known') {
    throw new Error(`expected known usage, got ${usage.status}`);
  }
}

describe('classifyUpstreamOutcome evidence mapping', () => {
  it('timeout/network/failure → may_have_executed (never blind-retry)', () => {
    for (const failureKind of ['timeout', 'network'] as const) {
      const outcome = classifyUpstreamOutcome(raw({ failureKind, httpStatus: null }));
      expect(outcome.evidence).toBe('may_have_executed');
      expect(outcome.completion).toBeNull();
      expect(outcome.usage).toEqual({ status: 'missing' });
    }
  });

  it('429 with provider semantics → confirmed_not_executed + Retry-After forward', () => {
    const outcome = classifyUpstreamOutcome(raw({ httpStatus: 429, retryAfterHeader: '30' }));
    expect(outcome.evidence).toBe('confirmed_not_executed');
    expect(outcome.retryAfterSeconds).toBe(30);
  });

  it('429 with invalid Retry-After forwards null', () => {
    expect(
      classifyUpstreamOutcome(raw({ httpStatus: 429, retryAfterHeader: 'nope' })).retryAfterSeconds,
    ).toBeNull();
    expect(
      classifyUpstreamOutcome(raw({ httpStatus: 429, retryAfterHeader: '9999' })).retryAfterSeconds,
    ).toBeNull();
  });

  it('200 parseable body → confirmed_completed with completion and usage', () => {
    const outcome = classifyUpstreamOutcome(
      raw({
        httpStatus: 200,
        bodyText: JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
          model: 'm',
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        }),
      }),
    );
    expect(outcome.evidence).toBe('confirmed_completed');
    expect(outcome.completion).toEqual({
      content: 'hi',
      finishReason: 'stop',
      upstreamModel: 'm',
    });
    expect(outcome.usage.status).toBe('known');
    assertKnownUsage(outcome.usage);
    expect(outcome.usage.usage.input_tokens).toBe(3);
    expect(outcome.usage.usage.output_tokens).toBe(4);
  });

  it('200 with usage missing → confirmed_completed + usage missing (never implicit 0)', () => {
    const outcome = classifyUpstreamOutcome(
      raw({
        httpStatus: 200,
        bodyText: JSON.stringify({ choices: [{ message: { content: 'hi' } }] }),
      }),
    );
    expect(outcome.evidence).toBe('confirmed_completed');
    expect(outcome.usage.status).toBe('missing');
  });

  it('200 with malformed usage values → usage malformed (invariant 6)', () => {
    const outcome = classifyUpstreamOutcome(
      raw({
        httpStatus: 200,
        bodyText: JSON.stringify({
          choices: [{ message: { content: 'hi' } }],
          usage: { prompt_tokens: -5, completion_tokens: 2 },
        }),
      }),
    );
    expect(outcome.usage.status).toBe('malformed');
  });

  it('200 with only one of the two main counts → usage missing (never 0 for the missing side)', () => {
    const outcome = classifyUpstreamOutcome(
      raw({
        httpStatus: 200,
        bodyText: JSON.stringify({
          choices: [{ message: { content: 'hi' } }],
          usage: { prompt_tokens: 3 },
        }),
      }),
    );
    expect(outcome.usage.status).toBe('missing');
  });

  it('4xx refusal statuses need a JSON object body to prove not-executed', () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const structured = classifyUpstreamOutcome(
        raw({ httpStatus: status, bodyText: '{"error":{"message":"bad"}}' }),
      );
      expect(structured.evidence).toBe('confirmed_not_executed');

      const html = classifyUpstreamOutcome(raw({ httpStatus: status, bodyText: '<html/>' }));
      expect(html.evidence).toBe('may_have_executed');

      const empty = classifyUpstreamOutcome(raw({ httpStatus: status, bodyText: null }));
      expect(empty.evidence).toBe('may_have_executed');
    }
  });

  it('429 without a JSON body is still provider rate-limit semantics (never executed)', () => {
    // 429 là semantics của provider (rate limit từ chối trước thực thi) — body
    // HTML/rỗng/null không đổi kết luận: nguồn throttle không thể rơi vào executed.
    for (const bodyText of [null, '', '<html>Too Many Requests</html>']) {
      const outcome = classifyUpstreamOutcome(raw({ httpStatus: 429, bodyText }));
      expect(outcome.evidence).toBe('confirmed_not_executed');
      expect(outcome.completion).toBeNull();
      expect(outcome.retryAfterSeconds).toBeNull();
    }
  });

  it('429 with a JSON error body still confirms not_executed and stays non-executed', () => {
    const outcome = classifyUpstreamOutcome(
      raw({ httpStatus: 429, bodyText: '{"error":{"message":"rate limited"}}' }),
    );
    expect(outcome.evidence).toBe('confirmed_not_executed');
  });

  it('500 with structured JSON body never lands as confirmed_not_executed', () => {
    const outcome = classifyUpstreamOutcome(
      raw({ httpStatus: 500, bodyText: '{"error":{"message":"oops"}}' }),
    );
    expect(outcome.evidence).toBe('may_have_executed');
  });

  it('reset/timeout outcomes with stray httpStatus never produce not_executed (failureKind wins)', () => {
    // Port trả failureKind kèm httpStatus trôi (adapter hỏng) — failureKind
    // phải thắng: không bao giờ kết luận không thực thi khi transport chưa rõ.
    const outcome = classifyUpstreamOutcome(
      raw({ failureKind: 'timeout', httpStatus: 429, retryAfterHeader: '10' }),
    );
    expect(outcome.evidence).toBe('may_have_executed');
    expect(outcome.retryAfterSeconds).toBeNull();
  });

  it('200 with an empty body is completed-but-malformed, never a completed charge', () => {
    const outcome = classifyUpstreamOutcome(raw({ httpStatus: 200, bodyText: '' }));
    expect(outcome.evidence).toBe('confirmed_completed');
    expect(outcome.completion).toBeNull();
    expect(outcome.usage.status).toBe('malformed');
  });

  it('200 body that is a JSON scalar (not object) is malformed, not completed', () => {
    const outcome = classifyUpstreamOutcome(raw({ httpStatus: 200, bodyText: '"ok"' }));
    expect(outcome.completion).toBeNull();
    expect(outcome.usage.status).toBe('malformed');
  });

  it('200 with an empty usage object → missing (never implicit 0)', () => {
    const outcome = classifyUpstreamOutcome(
      raw({
        httpStatus: 200,
        bodyText: JSON.stringify({
          choices: [{ message: { content: 'hi' } }],
          usage: {},
        }),
      }),
    );
    expect(outcome.usage.status).toBe('missing');
  });

  it('200 with usage not an object → missing', () => {
    const outcome = classifyUpstreamOutcome(
      raw({
        httpStatus: 200,
        bodyText: JSON.stringify({
          choices: [{ message: { content: 'hi' } }],
          usage: 5,
        }),
      }),
    );
    expect(outcome.usage.status).toBe('missing');
  });

  it('200 with wrong choice shapes yields null completion but still parses usage', () => {
    const shapes = [
      JSON.stringify({ choices: [] }),
      JSON.stringify({ choices: ['nope'] }),
      JSON.stringify({ choices: [{ message: 'nope' }] }),
      JSON.stringify({ choices: [{ message: { content: 42 } }] }),
      JSON.stringify({ choices: null }),
    ];
    for (const bodyText of shapes) {
      const outcome = classifyUpstreamOutcome(raw({ httpStatus: 200, bodyText }));
      expect(outcome.completion).toBeNull();
    }
  });

  it('200 keeps a non-string finish_reason as null', () => {
    const outcome = classifyUpstreamOutcome(
      raw({
        httpStatus: 200,
        bodyText: JSON.stringify({
          choices: [{ message: { content: 'hi' }, finish_reason: 7 }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      }),
    );
    expect(outcome.completion?.finishReason).toBeNull();
  });

  it('200 with non-integer usage counts is malformed (never clamped)', () => {
    const outcome = classifyUpstreamOutcome(
      raw({
        httpStatus: 200,
        bodyText: JSON.stringify({
          choices: [{ message: { content: 'hi' } }],
          usage: { prompt_tokens: 1.5, completion_tokens: 2 },
        }),
      }),
    );
    expect(outcome.usage.status).toBe('malformed');
  });

  it('HTTP status alone must not produce confirmed_not_executed (non-refusal statuses)', () => {
    for (const status of [201, 301, 404 - 3, 500, 502, 503]) {
      const outcome = classifyUpstreamOutcome(raw({ httpStatus: status, bodyText: null }));
      expect(outcome.evidence).toBe('may_have_executed');
    }
  });

  it('500 even with a JSON body stays may_have_executed (only 4xx refusals count)', () => {
    const outcome = classifyUpstreamOutcome(
      raw({ httpStatus: 500, bodyText: '{"error":{"message":"oops"}}' }),
    );
    expect(outcome.evidence).toBe('may_have_executed');
  });
});

describe('buildUpstreamPayload', () => {
  it('sends only model, messages and max_tokens', () => {
    expect(
      buildUpstreamPayload({
        upstreamModel: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 7,
      }),
    ).toBe('{"model":"m","messages":[{"role":"user","content":"hi"}],"max_tokens":7}');
  });
});

describe('DispatchAttemptCommand', () => {
  it('passes plaintext credential only to the port and classifies the raw outcome', async () => {
    const upstream = new FakeUpstream();
    const command = new DispatchAttemptCommand(upstream);
    const outcome = await command.execute({
      url: 'https://upstream.example',
      credentialPlaintext: 'secret-plaintext',
      upstreamModel: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 5,
    });
    expect(upstream.lastCredentialPlaintext).toBe('secret-plaintext');
    expect(JSON.parse(upstream.lastPayloadText ?? '{}')).toEqual({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
    });
    expect(outcome.evidence).toBe('confirmed_completed');
  });

  it('propagates a port throw instead of swallowing it into a classification', async () => {
    const upstream = new FakeUpstream();
    upstream.failDispatch = true;
    const command = new DispatchAttemptCommand(upstream);
    // Lỗi hạ tầng port (fetch throw) không được nuốt thành evidence — caller
    // phải thấy lỗi để tự quyết định fail-safe.
    await expect(
      command.execute({
        url: 'https://upstream.example',
        credentialPlaintext: 'secret-plaintext',
        upstreamModel: 'm',
        messages: [],
        maxTokens: 5,
      }),
    ).rejects.toThrow('dispatch failed');
  });
});
