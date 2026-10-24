import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  localDeployTaskSequence,
  localDestroyStackOrder,
  localLaneConfigurationNames,
  localUpProjectSequence,
  LocalLaneGraphError,
  LOCAL_LANE_PROJECTS,
  readProjectLaneTargets,
  type JsonTargetSpec,
} from './local-deploy-graph.js';
import { ROOT_DIR } from '../../utils.js';

/**
 * Spec cấu trúc Task Graph của lane local — kiểm trên CHÍNH KHAI BÁO Nx
 * (package.json của từng deploy project + nx.json) chứ không snapshot mảng: mảng trả về
 * bởi module là dữ liệu dẫn xuất, khai báo mới là nguồn. Một thay đổi
 * `dependsOn` phá bất biến sẽ đỏ tại đây TRƯỚC khi orchestration chạy.
 */

/** Chuẩn hoá entry dependsOn Nx thành chuỗi "project:target" — dùng ở nhiều test. */
function dependsOnNames(deps: NonNullable<JsonTargetSpec['dependsOn']>): string[] {
  return deps.map((d) =>
    typeof d === 'string' ? d : `${(d.projects ?? []).join('|')}:${d.target ?? ''}`,
  );
}

/** Hàng đợi topo của chính spec — KHÔNG dùng code production để tự kiểm. */
function specTopoSequence(
  deps: Readonly<Record<string, readonly string[]>>,
  nodes: readonly string[],
): string[] {
  const inDegree = new Map<string, number>(nodes.map((n) => [n, (deps[n] ?? []).length]));
  const dependents = new Map<string, string[]>(nodes.map((n) => [n, []]));
  for (const [node, ds] of Object.entries(deps)) {
    for (const d of ds) dependents.get(d)?.push(node);
  }
  const queue = nodes.filter((n) => (inDegree.get(n) ?? 0) === 0);
  const out: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift() as string;
    out.push(node);
    for (const dependent of dependents.get(node) ?? []) {
      const next = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }
  return out;
}

describe('local lane Nx declarations (source of truth)', () => {
  it('every lane project declares a local-up target with a total dependsOn chain', () => {
    // Không conditional expect: chia hai assert phẳng — unit nào thiếu dependsOn
    // tường minh sẽ làm tập này lệch, message là danh sách project vi phạm.
    const withoutExplicitDependsOn = LOCAL_LANE_PROJECTS.filter((project) => {
      if (project === 'platform-deploy') return false; // chain head — được phép không khai
      const deps = readProjectLaneTargets(project)['local-up'].dependsOn;
      return !Array.isArray(deps);
    });
    expect(withoutExplicitDependsOn).toEqual([]);
    for (const project of LOCAL_LANE_PROJECTS) {
      expect(readProjectLaneTargets(project)['local-up'].executor).toBe('nx:run-commands');
    }
    // Chain head: platform-deploy KHÔNG phụ thuộc unit nào.
    expect(readProjectLaneTargets('platform-deploy')['local-up'].dependsOn).toBeUndefined();
  });

  it('home depends on platform local-up AND platform local-env (needs .env artifacts)', () => {
    const deps = readProjectLaneTargets('home-deploy')['local-up'].dependsOn ?? [];
    const normalized = deps.map((d) =>
      typeof d === 'string' ? d : `${(d.projects ?? []).join('|')}:${d.target ?? ''}`,
    );
    expect(normalized).toContain('platform-deploy:local-up');
    expect(normalized).toContain('platform-deploy:local-env');
  });

  it('account depends on backoffice; auth depends on account (identity invariant)', () => {
    const accountDeps = readProjectLaneTargets('account-deploy')['local-up'].dependsOn ?? [];
    const authDeps = readProjectLaneTargets('auth-deploy')['local-up'].dependsOn ?? [];
    expect(dependsOnNames(accountDeps)).toContain('backoffice-deploy:local-up');
    expect(dependsOnNames(authDeps)).toContain('account-deploy:local-up');
  });

  it('platform local-smoke depends on auth local-up (smoke runs after the whole chain)', () => {
    const deps = readProjectLaneTargets('platform-deploy')['local-smoke'].dependsOn ?? [];
    const names = deps.map((d) =>
      typeof d === 'string' ? d : `${(d.projects ?? []).join('|')}:${d.target ?? ''}`,
    );
    expect(names).toContain('auth-deploy:local-up');
  });

  it('platform local-env declares a RAW dependsOn edge on platform local-up (outputs exist only after up)', () => {
    // Quy ước "dependsOn local-up" phải là FIELD thật trong khai báo Nx, không
    // chỉ lời hứa trong comment: không có field này Nx đặt local-env SONG SONG
    // local-up (parallel level 0) — worktree mới exit 1 (guard chưa deploy),
    // worktree cũ đọc outputs CŨ khi platform đang replace resource. Test đọc
    // dependsOn THÔ từ package.json (không qua module derive) nên một xoá field
    // "cho gọn" sẽ đỏ tại đây, không cần graph Nx thật.
    const envDeps = readProjectLaneTargets('platform-deploy')['local-env'].dependsOn;
    if (!Array.isArray(envDeps)) {
      throw new Error('local-env: dependsOn phai la mang khai bao Nx tường minh');
    }
    const edges = envDeps.filter(
      (d) =>
        typeof d !== 'string' && d.target === 'local-up' && d.projects?.[0] === 'platform-deploy',
    );
    expect(edges).toHaveLength(1);
    // Chỉ đúng MỘT edge lên local-up cùng project — env không được treo thêm
    // dependency nào khác (nó cần duy nhất outputs của platform up).
    expect(dependsOnNames(envDeps)).toEqual(['platform-deploy:local-up']);
  });
});

describe('localUpProjectSequence — structural invariants', () => {
  it('platform comes before EVERY unit (single topological sequence)', () => {
    const sequence = localUpProjectSequence();
    expect(sequence[0]).toBe('platform-deploy');
    const platformIndex = sequence.indexOf('platform-deploy');
    const units: Array<'home-deploy' | 'backoffice-deploy' | 'account-deploy' | 'auth-deploy'> = [
      'home-deploy',
      'backoffice-deploy',
      'account-deploy',
      'auth-deploy',
    ];
    for (const unit of units) {
      expect(sequence.indexOf(unit)).toBeGreaterThan(platformIndex);
    }
  });

  it('account before auth (identity invariant: owner password role + WIC upstream)', () => {
    const sequence = localUpProjectSequence();
    expect(sequence.indexOf('account-deploy')).toBeLessThan(sequence.indexOf('auth-deploy'));
  });

  it('sequence agrees with an INDEPENDENT topological sort of the declared dependsOn graph', () => {
    // Spec tự dựng đồ thị từ khai báo thô (đọc file trực tiếp), rồi so với
    // kết quả của module — hai phép tính độc lập cùng kết luận là bằng chứng
    // cấu trúc, không phải snapshot mảng.
    const declared: Record<string, string[]> = {};
    for (const project of LOCAL_LANE_PROJECTS) {
      const deps = readProjectLaneTargets(project)['local-up'].dependsOn ?? [];
      declared[project] = deps.map((d) =>
        typeof d === 'string' ? d : ((d.projects ?? [])[0] ?? ''),
      );
    }
    const expected = specTopoSequence(declared, [...LOCAL_LANE_PROJECTS]);
    expect(localUpProjectSequence()).toEqual(expected);
    expect(expected).toHaveLength(5);
  });

  it('covers exactly the five local stacks — destroy must not inherit a silently smaller set', () => {
    expect([...LOCAL_LANE_PROJECTS]).toEqual([
      'platform-deploy',
      'home-deploy',
      'backoffice-deploy',
      'account-deploy',
      'auth-deploy',
    ]);
  });
});

describe('localDeployTaskSequence — 8-step parity with DEPLOY_STEPS', () => {
  it('task sequence is the Nx mirror of the legacy hard-coded order', async () => {
    // Import muộn để song song hoá rõ hai nguồn: DEPLOY_STEPS (bản hard-coded)
    // và task sequence (dẫn xuất từ khai báo Nx).
    const { DEPLOY_STEPS, STEP_TO_TASK } = await import('./local-deploy.js');
    const tasks = localDeployTaskSequence().map((t) => `${t.project}:${t.target}`);

    // Mỗi step legacy ánh xạ sang đúng task, và THỨ TỰ hai danh sách tương đương.
    const mapped = DEPLOY_STEPS.map((step) => STEP_TO_TASK[step]);
    // Hai bước read-outputs + update-env gộp thành MỘT task local-env (outputs
    // và ghi .env là một biến đổi dữ liệu) — nên mapped có 8 phần tử, tasks có 7.
    expect(mapped).toHaveLength(8);
    expect(tasks).toHaveLength(7);
    expect(mapped[0]).toBe(tasks[0]); // platform-up == platform-deploy:local-up
    expect(mapped[1]).toBe(tasks[1]); // read-outputs == platform-deploy:local-env
    expect(mapped[2]).toBe(tasks[1]); // update-env == platform-deploy:local-env (gộp)
    expect(mapped.slice(3, 7)).toEqual(tasks.slice(2, 6)); // 4 unit up, đúng thứ tự
    expect(mapped[7]).toBe(tasks[6]); // smoke-https == platform-deploy:local-smoke
    // Bất biến chính nằm trong mapped (chứng minh parity): account trước auth.
    expect(mapped.indexOf('account-deploy:local-up')).toBeLessThan(
      mapped.indexOf('auth-deploy:local-up'),
    );
  });

  it('local-env comes right after platform local-up; local-smoke is last', () => {
    const tasks = localDeployTaskSequence();
    expect(tasks[0]).toEqual({ project: 'platform-deploy', target: 'local-up' });
    expect(tasks[1]).toEqual({ project: 'platform-deploy', target: 'local-env' });
    expect(tasks[tasks.length - 1]).toEqual({ project: 'platform-deploy', target: 'local-smoke' });
  });

  it('skipSmoke variant drops the smoke task only', async () => {
    const { buildNxOrchestrationPlan } = await import('./local-deploy.js');
    const withSmoke = buildNxOrchestrationPlan();
    const withoutSmoke = buildNxOrchestrationPlan({ skipSmoke: true });
    expect(withSmoke.taskSequence.at(-1)).toBe('platform-deploy:local-smoke');
    expect(withoutSmoke.taskSequence).not.toContain('platform-deploy:local-smoke');
    expect(withoutSmoke.taskSequence).toHaveLength(withSmoke.taskSequence.length - 1);
    // Lệnh run-many vẫn khoá đúng tập project/target sau khi lọc smoke.
    expect(withoutSmoke.args).toContain('-c');
    expect(withoutSmoke.args[withoutSmoke.args.indexOf('-c') + 1]).toBe('local');
  });
});

describe('localDestroyStackOrder — reverse dependency order', () => {
  it('destroys dependents first and platform LAST (auth → account → backoffice → home → platform)', () => {
    expect(localDestroyStackOrder()).toEqual([
      'auth-deploy',
      'account-deploy',
      'backoffice-deploy',
      'home-deploy',
      'platform-deploy',
    ]);
  });

  it('is exactly the reverse of the up sequence — one source of order, two directions', () => {
    const up = localUpProjectSequence();
    const down = localDestroyStackOrder();
    // target es2022 không có toReversed: copy rồi đảo tại chỗ.
    const upReversed = up.slice();
    upReversed.reverse();
    expect(down).toEqual(upReversed);
  });
});

describe('local lane safety — single configuration, never cacheable', () => {
  it('every lane target exposes ONLY the "local" configuration (no staging/production lane)', () => {
    for (const project of LOCAL_LANE_PROJECTS) {
      expect(localLaneConfigurationNames(project)).toEqual(['local']);
    }
  });

  it('nx.json targetDefaults keep every local-* target out of the cache', () => {
    const nxJson = JSON.parse(readFileSync(join(ROOT_DIR, 'nx.json'), 'utf8')) as {
      targetDefaults: Record<string, Array<{ cache?: boolean }>>;
    };
    for (const target of ['local-up', 'local-env', 'local-smoke']) {
      const defaults = nxJson.targetDefaults[target];
      expect(Array.isArray(defaults), `${target} must have targetDefaults`).toBe(true);
      for (const entry of defaults ?? []) {
        expect(entry.cache, `${target} must never be cacheable (side-effecting)`).toBe(false);
      }
    }
  });

  it('nx.json does NOT attach dependsOn to local-up (order lives in project declarations)', () => {
    const nxJson = JSON.parse(readFileSync(join(ROOT_DIR, 'nx.json'), 'utf8')) as {
      targetDefaults: Record<string, Array<{ dependsOn?: unknown }>>;
    };
    for (const entry of nxJson.targetDefaults['local-up'] ?? []) {
      expect(entry.dependsOn).toBeUndefined();
    }
  });
});

describe('readProjectLaneTargets — fail-closed on broken declarations', () => {
  it('throws LocalLaneGraphError when a lane target is missing', () => {
    // Project ngoài danh sách lane không có target local → module phải ném lỗi
    // tường minh (không trả về spec rỗng cho caller "đoán" tiếp).
    expect(() => readProjectLaneTargets('pact-broker-api-deploy')).toThrowError(
      new LocalLaneGraphError(
        'pact-broker-api-deploy thiếu target local-up — khai báo Nx là nguồn sự thật thứ tự lane local',
      ),
    );
  });
});
