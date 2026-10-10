import { describe, expect, it } from 'vitest';

import {
  evaluatePromotionGate,
  type PromotionVerdict,
  type ReleaseCandidate,
} from './promotion-gate';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

function candidate(overrides: Partial<ReleaseCandidate> = {}): ReleaseCandidate {
  return {
    tag: '@ecoma-io/home@0.0.2',
    sha: SHA,
    versionAtSha: '0.0.2',
    versionFromTag: '0.0.2',
    mainHistory: [SHA, OTHER_SHA],
    staging: { context: 'home/staging-verified', state: 'success', sha: SHA },
    ...overrides,
  };
}

/**
 * Coerce verdict về nhánh fail cho assertion reason — helper test giữ spec
 * phẳng, tránh `expect` trong nhánh if (vitest/no-conditional-expect).
 */
function failReasons(verdict: PromotionVerdict): readonly string[] {
  if (verdict.ok) {
    throw new Error('expected gate to reject, but it passed');
  }
  return verdict.reasons;
}

describe('evaluatePromotionGate', () => {
  it('pass với release candidate hợp lệ đầy đủ', () => {
    expect(evaluatePromotionGate(candidate())).toEqual({ ok: true });
  });

  it('fail khi tag không đúng pattern release', () => {
    const verdict = evaluatePromotionGate(candidate({ tag: 'v0.0.2' }));
    expect(verdict.ok).toBe(false);
    expect(failReasons(verdict).join(' ')).toContain('does not match');
  });

  it('fail khi tag thuộc project khác', () => {
    const verdict = evaluatePromotionGate(candidate({ tag: '@ecoma-io/docs@0.0.2' }));
    expect(verdict.ok).toBe(false);
  });

  it('fail khi tag SHA không phải full 40 hex', () => {
    const verdict = evaluatePromotionGate(candidate({ sha: 'abc123' }));
    expect(verdict.ok).toBe(false);
    expect(failReasons(verdict).join(' ')).toContain('40-hex');
  });

  it('fail khi version tại SHA khác version trong tag — tag trước release commit là lỗi', () => {
    const verdict = evaluatePromotionGate(candidate({ versionAtSha: '0.0.1', sha: SHA }));
    expect(verdict.ok).toBe(false);
    expect(failReasons(verdict).join(' ')).toContain('declares version');
  });

  it('fail khi tag SHA không thuộc lịch sử main', () => {
    const verdict = evaluatePromotionGate(candidate({ mainHistory: [OTHER_SHA], sha: SHA }));
    expect(verdict.ok).toBe(false);
    expect(failReasons(verdict).join(' ')).toContain('not reachable from main');
  });

  it('fail khi không có staging evidence', () => {
    const verdict = evaluatePromotionGate(candidate({ staging: undefined }));
    expect(verdict.ok).toBe(false);
    expect(failReasons(verdict).join(' ')).toContain('No staging verification evidence');
  });

  it('fail khi evidence gắn SHA khác — không chấp nhận "commit cha đã pass"', () => {
    const verdict = evaluatePromotionGate(
      candidate({
        staging: { context: 'home/staging-verified', state: 'success', sha: OTHER_SHA },
      }),
    );
    expect(verdict.ok).toBe(false);
    expect(failReasons(verdict).join(' ')).toContain('exact revision');
  });

  it('fail khi staging evidence không phải success', () => {
    const verdict = evaluatePromotionGate(
      candidate({
        staging: { context: 'home/staging-verified', state: 'failure', sha: SHA },
      }),
    );
    expect(verdict.ok).toBe(false);
    expect(failReasons(verdict).join(' ')).toContain('not "success"');
  });

  it('gom nhiều lý do trong một lần chạy', () => {
    const verdict = evaluatePromotionGate(
      candidate({
        tag: 'v0.0.2',
        sha: 'zz',
        staging: undefined,
      }),
    );
    expect(verdict.ok).toBe(false);
    expect(failReasons(verdict).length).toBeGreaterThanOrEqual(3);
  });
});
