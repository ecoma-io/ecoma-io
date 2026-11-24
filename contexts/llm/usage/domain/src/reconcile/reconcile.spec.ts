import { describe, expect, it } from 'vitest';

import { reconcile, type NormalizedUsage, type RequestUsage } from '../index';

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

function requestUsage(overrides: Partial<RequestUsage> = {}): RequestUsage {
  return {
    request_id: 'req-1' as RequestUsage['request_id'],
    attempts: [],
    aggregated: usage(),
    status: 'known',
    ...overrides,
  } as RequestUsage;
}

describe('reconcile', () => {
  it('matches when request == attempt total == settlement', () => {
    const result = reconcile({
      requestUsage: requestUsage({ aggregated: usage({ input_tokens: 100, output_tokens: 50 }) }),
      attemptUsages: [
        usage({ input_tokens: 60, output_tokens: 30 }),
        usage({ input_tokens: 40, output_tokens: 20 }),
      ],
      settlement: usage({ input_tokens: 100, output_tokens: 50 }),
    });
    expect(result.outcome).toBe('match');
    expect(result.detail).toContain('matches');
  });

  it('mismatches when request != attempt total', () => {
    const result = reconcile({
      requestUsage: requestUsage({ aggregated: usage({ input_tokens: 100, output_tokens: 50 }) }),
      attemptUsages: [usage({ input_tokens: 60, output_tokens: 30 })],
      settlement: null,
    });
    expect(result.outcome).toBe('mismatch');
  });

  it('mismatches when settlement differs', () => {
    const result = reconcile({
      requestUsage: requestUsage({ aggregated: usage({ input_tokens: 100, output_tokens: 50 }) }),
      attemptUsages: [usage({ input_tokens: 100, output_tokens: 50 })],
      settlement: usage({ input_tokens: 90, output_tokens: 40 }),
    });
    expect(result.outcome).toBe('mismatch');
  });

  it('is incomplete when no data at all', () => {
    const result = reconcile({
      requestUsage: requestUsage({ aggregated: null }),
      attemptUsages: [],
      settlement: null,
    });
    expect(result.outcome).toBe('incomplete');
  });

  it('matches when request matches attempt but settlement is null', () => {
    const result = reconcile({
      requestUsage: requestUsage({ aggregated: usage({ input_tokens: 100, output_tokens: 50 }) }),
      attemptUsages: [usage({ input_tokens: 100, output_tokens: 50 })],
      settlement: null,
    });
    expect(result.outcome).toBe('match');
  });

  it('does not mutate inputs', () => {
    const ru = requestUsage();
    const au = [usage(), usage()];
    const s = usage();
    const beforeRu = JSON.stringify(ru);
    const beforeAu = au.map((u) => JSON.stringify(u));
    const beforeS = JSON.stringify(s);
    reconcile({ requestUsage: ru, attemptUsages: au, settlement: s });
    expect(JSON.stringify(ru)).toBe(beforeRu);
    expect(au.map((u) => JSON.stringify(u))).toEqual(beforeAu);
    expect(JSON.stringify(s)).toBe(beforeS);
  });

  // Hardening: reconcile so sánh CHỈ total (input+output) — hai cấu trúc usage
  // khác nhau nhưng cùng tổng vẫn match. Đây là quyết định thiết kế (exact
  // compare theo §7, U-4 mở), ghim ở đây để mọi thay đổi sau là có chủ ý.
  it('totals-only comparison: same total with different structure still matches (documented design)', () => {
    const result = reconcile({
      requestUsage: requestUsage({ aggregated: usage({ input_tokens: 100, output_tokens: 0 }) }),
      attemptUsages: [usage({ input_tokens: 60, output_tokens: 40 })],
      settlement: null,
    });
    expect(result.outcome).toBe('match');
  });

  it('one attempt with null input makes attempt total unknown → incomplete when nothing else comparable', () => {
    const result = reconcile({
      requestUsage: requestUsage({ aggregated: null }),
      attemptUsages: [usage({ input_tokens: null })],
      settlement: null,
    });
    expect(result.outcome).toBe('incomplete');
  });

  it('settlement with null output makes pair incomparable → mismatch only when other pairs compare', () => {
    // request và attempt đều 150, settlement null-output → chỉ cặp request/attempt so được.
    const incompleteOnly = reconcile({
      requestUsage: requestUsage({ aggregated: usage({ input_tokens: 100, output_tokens: 50 }) }),
      attemptUsages: [usage({ input_tokens: 100, output_tokens: 50 })],
      settlement: usage({ input_tokens: 100, output_tokens: null }),
    });
    expect(incompleteOnly.outcome).toBe('match');
  });

  it('empty attempt list with known request usage → match against settlement, not incomplete', () => {
    const result = reconcile({
      requestUsage: requestUsage({ aggregated: usage({ input_tokens: 100, output_tokens: 50 }) }),
      attemptUsages: [],
      settlement: usage({ input_tokens: 100, output_tokens: 50 }),
    });
    expect(result.outcome).toBe('match');
  });

  it('mismatch is exact: one token difference is a mismatch (no tolerance, U-4 open)', () => {
    const result = reconcile({
      requestUsage: requestUsage({ aggregated: usage({ input_tokens: 100, output_tokens: 50 }) }),
      attemptUsages: [usage({ input_tokens: 100, output_tokens: 49 })],
      settlement: null,
    });
    expect(result.outcome).toBe('mismatch');
  });
});
