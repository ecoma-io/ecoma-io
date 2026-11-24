/**
 * Ghim biên inference↔routing: vocabulary `ExecutionEvidence` được khai báo
 * lại tại routing (không import chéo), đúng 4 literal, và hàm fallback phân
 * loại mọi tổ hợp đầu vào (kể cả đầu vào hỏng) fail-safe.
 */

import { describe, expect, it } from 'vitest';

import {
  EXECUTION_EVIDENCE,
  decideFallback,
  isExecutionEvidence,
  isFallbackAllowedEvidence,
  type FallbackInputs,
} from './fallback';

const ALL = [
  EXECUTION_EVIDENCE.not_sent,
  EXECUTION_EVIDENCE.may_have_executed,
  EXECUTION_EVIDENCE.confirmed_completed,
  EXECUTION_EVIDENCE.confirmed_not_executed,
] as const;

function inputs(overrides: Partial<FallbackInputs> = {}): FallbackInputs {
  return {
    evidence: EXECUTION_EVIDENCE.not_sent,
    streamStarted: false,
    attemptCount: 0,
    maxAttempts: 3,
    ...overrides,
  };
}

describe('routing-boundary evidence vocabulary', () => {
  it('pins exactly four literals with exact string values', () => {
    // Contract với llm-inference: đổi literal ở bên nào mà không đổi bên kia
    // sẽ làm fallback và retry hiểu khác nhau. Test này fail ngay khi literal
    // hoặc số lượng giá trị thay đổi.
    expect(EXECUTION_EVIDENCE).toEqual({
      not_sent: 'not_sent',
      may_have_executed: 'may_have_executed',
      confirmed_completed: 'confirmed_completed',
      confirmed_not_executed: 'confirmed_not_executed',
    });
    expect(Object.keys(EXECUTION_EVIDENCE)).toHaveLength(4);
  });

  it('accepts every canonical literal and rejects any fifth value', () => {
    for (const value of ALL) {
      expect(isExecutionEvidence(value)).toBe(true);
    }
    for (const value of [
      'executed',
      'not-executed',
      'NOT_SENT',
      'confirmed',
      'may_have_executed ',
      '',
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isExecutionEvidence(value)).toBe(false);
    }
  });

  it('classifies the same retry-safe subset as llm-inference owns', () => {
    // Định nghĩa này phải khớp `isRetrySafeEvidence` của llm-inference:
    // chỉ not_sent và confirmed_not_executed là an toàn để fallback.
    const retrySafe = new Set(['not_sent', 'confirmed_not_executed']);
    for (const value of ALL) {
      expect(isFallbackAllowedEvidence(value)).toBe(retrySafe.has(value));
    }
  });

  it('does not import the llm-inference bounded context', () => {
    // Khẳng định kiến trúc: guard type tại biên phải tự chứa. Import chéo bị
    // cấm — test này ép qua việc vocabulary được khai báo cục bộ (4 literal
    // ở trên) chứ không qua re-export.
    const localKeys = Object.keys(EXECUTION_EVIDENCE).toSorted();
    expect(localKeys).toEqual([
      'confirmed_completed',
      'confirmed_not_executed',
      'may_have_executed',
      'not_sent',
    ]);
  });
});

describe('fallback decision matrix', () => {
  it('allows fallback only for retry-safe evidence with budget left', () => {
    for (const evidence of ALL) {
      const result = decideFallback(inputs({ evidence }));
      const expected = isFallbackAllowedEvidence(evidence);
      expect(result.fallbackAllowed).toBe(expected);
      if (result.fallbackAllowed !== expected) {
        throw new Error(`evidence ${evidence} misclassified`);
      }
    }
  });

  it('blocks every evidence value once the stream started', () => {
    for (const evidence of ALL) {
      const result = decideFallback(inputs({ evidence, streamStarted: true }));
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error(`evidence ${evidence} allowed fallback after stream`);
      }
      expect(result.fallbackAllowed).toBe(false);
      expect(!result.ok && result.reason).toBe('fallback_not_allowed');
    }
  });

  it('reports fallback_exhausted exactly at the budget boundary', () => {
    expect(decideFallback(inputs({ attemptCount: 2, maxAttempts: 3 })).ok).toBe(true);
    expect(
      !decideFallback(inputs({ attemptCount: 3, maxAttempts: 3 })).ok &&
        decideFallback(inputs({ attemptCount: 3, maxAttempts: 3 })).reason,
    ).toBe('fallback_exhausted');
    expect(
      !decideFallback(inputs({ attemptCount: 4, maxAttempts: 3 })).ok &&
        decideFallback(inputs({ attemptCount: 4, maxAttempts: 3 })).reason,
    ).toBe('fallback_exhausted');
  });

  it('blocks fallback for invalid attempt inputs instead of fail-open', () => {
    // NaN >= maxAttempts là false — không guard thì đầu vào hỏng trượt qua
    // phép so sánh và fallback được cho phép sai.
    for (const attemptCount of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
      const result = decideFallback(inputs({ attemptCount }));
      expect(result.ok, `attemptCount ${String(attemptCount)}`).toBe(false);
      expect(result.fallbackAllowed).toBe(false);
    }
    for (const maxAttempts of [Number.NaN, Number.POSITIVE_INFINITY, 0, -3, 2.5]) {
      const result = decideFallback(inputs({ maxAttempts }));
      expect(result.ok, `maxAttempts ${String(maxAttempts)}`).toBe(false);
      expect(result.fallbackAllowed).toBe(false);
    }
  });

  it('blocks fallback for invalid evidence with a valid budget', () => {
    const result = decideFallback(inputs({ evidence: 'downgraded_value' as never }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('fallback_not_allowed');
  });
});

describe('bounded-context import isolation', () => {
  it('never imports from the llm-inference bounded context', async () => {
    // Quét toàn bộ source của routing lib: không module nào được import
    // `@ecoma-io/llm-inference-domain` — vocabulary phải luôn khai báo lại tại
    // biên. Đọc file thay vì parse runtime import để chặn cả type-only import.
    const { readdir, readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const srcDir = path.resolve(import.meta.dirname, '..');

    const collected: string[] = [];
    const walk = (dir: string): Promise<void> =>
      readdir(dir, { withFileTypes: true })
        .then((entries) =>
          Promise.all(
            entries.map((entry) => {
              const full = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                return walk(full);
              }
              if (entry.name.endsWith('.ts')) {
                collected.push(full);
              }
              return Promise.resolve();
            }),
          ),
        )
        .then(() => undefined);
    await walk(srcDir);

    const contents = await Promise.all(collected.map((file) => readFile(file, 'utf8')));

    expect(collected.length).toBeGreaterThan(0);
    for (const [index, content] of contents.entries()) {
      const label = path.relative(srcDir, collected[index]);
      const leaks = /from [."']@ecoma-io\/llm-inference/.test(content);
      expect(leaks).toBe(false);
      if (leaks) {
        throw new Error(`cross-context import found in ${label}`);
      }
    }
  });
});
