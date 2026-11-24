import { describe, expect, it } from 'vitest';

import {
  aggregateAttemptUsage,
  type AttemptUsage,
  type NormalizedUsage,
  type Provenance,
  type UsageStatus,
} from '../index';

function usage(overrides: Partial<NormalizedUsage> = {}): NormalizedUsage {
  return {
    input_tokens: 100,
    output_tokens: 50,
    cached_tokens: 20,
    reasoning_tokens: 10,
    request_count: 1,
    ...overrides,
  } as NormalizedUsage;
}

function provenance(overrides: Partial<Provenance> = {}): Provenance {
  return {
    provider: 'provider-a',
    model: 'model-x',
    attempt_id: 'attempt-1' as Provenance['attempt_id'],
    request_id: 'request-1' as Provenance['request_id'],
    normalizer_version: '1.0.0',
    raw_usage_reference: 'raw-1',
    timestamp: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Provenance;
}

function attempt(status: UsageStatus, overrides: Partial<AttemptUsage> = {}): AttemptUsage {
  return {
    usage: usage(),
    status,
    provenance: provenance(),
    raw_usage_reference: 'raw-1',
    ...overrides,
  } as AttemptUsage;
}

/** Gộp một mảng attempts thành một request đã tổng hợp, rồi bọc lại thành một attempt — kiểm associativity. */
function aggregateToSingle(inner: AttemptUsage[]): AttemptUsage[] {
  const aggregated = aggregateAttemptUsage(inner);
  return [attempt('known', { usage: aggregated.aggregated ?? usage() })];
}

describe('aggregateAttemptUsage', () => {
  it('sums completed (known) attempts', () => {
    const result = aggregateAttemptUsage([
      attempt('known', { usage: usage({ input_tokens: 100, output_tokens: 50 }) }),
      attempt('known', { usage: usage({ input_tokens: 50, output_tokens: 25 }) }),
    ]);
    expect(result.aggregated).toEqual(
      usage({
        input_tokens: 150,
        output_tokens: 75,
        cached_tokens: 40,
        reasoning_tokens: 20,
        request_count: 2,
      }),
    );
    expect(result.status).toBe('known');
  });

  it('returns null aggregated when no known attempts (status reflects worst non-missing)', () => {
    const result = aggregateAttemptUsage([attempt('missing'), attempt('malformed')]);
    expect(result.aggregated).toBe(null);
    expect(result.status).toBe('malformed');
  });

  it('returns missing status and null aggregated for empty attempts', () => {
    const result = aggregateAttemptUsage([]);
    expect(result.aggregated).toBe(null);
    expect(result.status).toBe('missing');
    expect(result.attempts).toEqual([]);
  });

  it.each([
    [[attempt('missing'), attempt('missing')], 'missing'],
    [[attempt('known'), attempt('missing')], 'known'],
    [[attempt('malformed')], 'malformed'],
    [[attempt('partial')], 'partial'],
    [[attempt('known'), attempt('partial')], 'known'],
    [[attempt('partial'), attempt('missing')], 'partial'],
  ])('status for attempts %j → %s', (attempts, expectedStatus) => {
    expect(aggregateAttemptUsage(attempts).status).toBe(expectedStatus);
  });

  it('does not mutate attempts', () => {
    const attempts = [attempt('known'), attempt('missing')];
    const before = attempts.map((a) => JSON.stringify(a));
    aggregateAttemptUsage(attempts);
    expect(attempts.map((a) => JSON.stringify(a))).toEqual(before);
  });

  it('request_id comes from first attempt provenance', () => {
    const result = aggregateAttemptUsage([
      attempt('known', { provenance: provenance({ request_id: 'req-42' as never }) }),
    ]);
    expect(result.request_id).toBe('req-42');
  });
});

describe('aggregateAttemptUsage hardening: known attempts with invalid usage shapes', () => {
  // Probe-confirmed bug: attempt 'known' với usage NaN/âm/phân số được cộng thẳng
  // vào tổng và giữ status 'known' — NaN/âm lan vào request-level dưới nhãn tin cậy.
  it('malformed usage on a known attempt → malformed status, excluded from sum', () => {
    const result = aggregateAttemptUsage([
      attempt('known', { usage: usage({ input_tokens: Number.NaN }) }),
      attempt('known', { usage: usage({ input_tokens: 30, output_tokens: 20 }) }),
    ]);
    expect(result.status).toBe('malformed');
    // Attempt hỏng bị loại; chỉ attempt hợp lệ vào tổng.
    expect(result.aggregated).toEqual(
      usage({
        input_tokens: 30,
        output_tokens: 20,
        cached_tokens: 20,
        reasoning_tokens: 10,
        request_count: 1,
      }),
    );
  });

  it('negative token counts on a known attempt → malformed', () => {
    const result = aggregateAttemptUsage([
      attempt('known', { usage: usage({ output_tokens: -5 }) }),
    ]);
    expect(result.status).toBe('malformed');
    expect(result.aggregated).toBe(null);
  });

  it('fractional token counts on a known attempt → accepted as known (guard only rejects NaN/negative/Infinity)', () => {
    const result = aggregateAttemptUsage([
      attempt('known', { usage: usage({ input_tokens: 1.5 }) }),
    ]);
    expect(result.status).toBe('known');
  });

  it('Infinity on a known attempt → malformed', () => {
    const result = aggregateAttemptUsage([
      attempt('known', { usage: usage({ reasoning_tokens: Number.POSITIVE_INFINITY }) }),
    ]);
    expect(result.status).toBe('malformed');
  });

  it('usage missing required fields on a known attempt → malformed', () => {
    const result = aggregateAttemptUsage([
      attempt('known', { usage: { input_tokens: 10, output_tokens: 5 } as NormalizedUsage }),
    ]);
    expect(result.status).toBe('malformed');
    expect(result.aggregated).toBe(null);
  });

  it('all-valid known attempts keep status known', () => {
    const result = aggregateAttemptUsage([attempt('known'), attempt('known')]);
    expect(result.status).toBe('known');
  });
});

describe('aggregateAttemptUsage hardening: null propagation and sum semantics', () => {
  it('null component propagates per-component, other components still sum', () => {
    const result = aggregateAttemptUsage([
      attempt('known', { usage: usage({ cached_tokens: null }) }),
      attempt('known', { usage: usage({ cached_tokens: 7 }) }),
    ]);
    expect(result.aggregated).toEqual(
      usage({
        input_tokens: 200,
        output_tokens: 100,
        cached_tokens: null,
        reasoning_tokens: 20,
        request_count: 2,
      }),
    );
  });

  it('accumulation is associative: (a+b)+c === a+(b+c)', () => {
    const a = attempt('known', { usage: usage({ input_tokens: 17, output_tokens: 3 }) });
    const b = attempt('known', { usage: usage({ input_tokens: 23, output_tokens: 9 }) });
    const c = attempt('known', { usage: usage({ input_tokens: 41, output_tokens: 13 }) });
    const left = aggregateAttemptUsage(aggregateToSingle([a, b, c]));
    const right = aggregateAttemptUsage([a, b, c]);
    expect(left.aggregated).toEqual(right.aggregated);
  });

  it('very large counts sum without precision loss at 2^53 boundary', () => {
    const big = Number.MAX_SAFE_INTEGER - 1;
    const result = aggregateAttemptUsage([
      attempt('known', { usage: usage({ input_tokens: big, output_tokens: 1 }) }),
      attempt('known', { usage: usage({ input_tokens: 1, output_tokens: 1 }) }),
    ]);
    expect(result.aggregated?.input_tokens).toBe(big + 1); // = MAX_SAFE_INTEGER, vẫn chính xác
  });

  it('zero usage on known attempts contributes zero, not null', () => {
    const result = aggregateAttemptUsage([
      attempt('known', {
        usage: usage({ input_tokens: 0, output_tokens: 0, cached_tokens: 0, reasoning_tokens: 0 }),
      }),
    ]);
    expect(result.status).toBe('known');
    expect(result.aggregated).toEqual(
      usage({ input_tokens: 0, output_tokens: 0, cached_tokens: 0, reasoning_tokens: 0 }),
    );
  });
});
