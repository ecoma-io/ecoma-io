import { describe, expect, it } from 'vitest';

import { evaluateStaleGuard, type CompetingRun } from './runner-guard';

const SHA = 'a'.repeat(40);
const NEWER = 'c'.repeat(40);
const UNRELATED = 'd'.repeat(40);

/** Lịch sử tuyến tính: UNRELATED → SHA → NEWER (NEWER là con của SHA). */
function linearHistory(ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true;
  if (ancestor === UNRELATED) return false;
  if (ancestor === SHA && descendant === NEWER) return true;
  return false;
}

function run(
  headSha: string,
  runId: number,
  status: CompetingRun['status'] = 'in_progress',
): CompetingRun {
  return { headSha, runId, status };
}

describe('evaluateStaleGuard', () => {
  it('cho deploy khi không có run cạnh tranh', () => {
    expect(evaluateStaleGuard(SHA, 10, [], linearHistory)).toEqual({ action: 'deploy' });
  });

  it('run cũ hơn nhường khi cùng SHA có run re-run mới hơn đang chạy', () => {
    const verdict = evaluateStaleGuard(SHA, 10, [run(SHA, 11)], linearHistory);
    expect(verdict).toEqual({
      action: 'skip',
      reason: expect.stringContaining('owns the deploy'),
    });
  });

  it('run re-run (id lớn hơn) vẫn deploy khi cùng SHA có run cũ hơn', () => {
    expect(evaluateStaleGuard(SHA, 12, [run(SHA, 11)], linearHistory)).toEqual({
      action: 'deploy',
    });
  });

  it('skip khi có SHA mới hơn đang được deploy — revision này đã stale', () => {
    const verdict = evaluateStaleGuard(SHA, 10, [run(NEWER, 11)], linearHistory);
    expect(verdict).toMatchObject({
      action: 'skip',
      reason: expect.stringContaining('is stale'),
    });
  });

  it('vẫn deploy khi run cạnh tranh là revision cũ hơn (mình mới hơn)', () => {
    expect(evaluateStaleGuard(NEWER, 20, [run(SHA, 19)], linearHistory)).toEqual({
      action: 'deploy',
    });
  });

  it('abort fail-closed khi không xác định được quan hệ tổ tiên', () => {
    const verdict = evaluateStaleGuard(SHA, 10, [run(UNRELATED, 11)], linearHistory);
    expect(verdict).toMatchObject({
      action: 'abort',
      reason: expect.stringContaining('failing closed'),
    });
  });

  it('abort thắng skip khi có nhiều run bất trật tự', () => {
    const verdict = evaluateStaleGuard(
      SHA,
      10,
      [run(NEWER, 11), run(UNRELATED, 12)],
      linearHistory,
    );
    expect(verdict.action).toBe('abort');
  });

  it('queued run cũng tính là cạnh tranh', () => {
    const verdict = evaluateStaleGuard(SHA, 10, [run(NEWER, 11, 'queued')], linearHistory);
    expect(verdict.action).toBe('skip');
  });
});
