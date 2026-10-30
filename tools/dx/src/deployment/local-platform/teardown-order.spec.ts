/**
 * Hợp đồng thứ tự teardown (reverse dependency ordering).
 *
 * Teardown phải chạy NGHỊCH của thứ tự deploy: consumer down trước provider,
 * platform-deploy down cuối cùng; các nhánh độc lập (nhánh pact, nhánh home,
 * lá wave-2) giữ được tính song song. Spec này ghim contract ở HAI TẦNG, vì
 * hai tầng đó trả lời hai câu hỏi khác nhau:
 *
 * 1. **Config level** — `dependsOn` trong package.json của từng deploy project
 *    phải bằng
 *    inverse chính xác của graph `local-up` (chỉ tính cạnh deploy-lifecycle;
 *    cạnh build-image KHÔNG tham gia teardown). Đây là tầng "đúng dữ liệu".
 * 2. **Resolved-graph level** — task graph mà Nx resolve THẬT cho invocation
 *    `nx run-many -t local-down -c local` phải đạt được thứ tự đó: mỗi consumer
 *    có đường đi tới provider của mình trong graph resolved, không có cycle,
 *    platform-deploy là sink duy nhất, và các nhánh độc lập không có cạnh ràng
 *    buộc nào giữa chúng. Đây là tầng "Nx đúng cách hiểu dữ liệu" — đủ để bắt
 *    regression kiểu "đổi nx.json làm lệch cách Nx merge targetDefaults" mà
 *    tầng config không thấy.
 *
 * Cả hai tầng đều bất cần daemon: tầng config đọc file JSON trực tiếp; tầng
 * resolved gọi `nx run-many -t local-down -c local --graph=<file>` — đường
 * `--graph` của Nx 23.3.1 trả về sau khi resolve task graph và TRƯỚC khi chạy
 * task đầu tiên (trong `node_modules/nx/dist/src/command-line/run-many.js`,
 * nhánh `nxArgs.graph` return `generateGraph(...)` và không bao giờ tới
 * `runCommand`), nên spec này an toàn trên máy đang có live stack mà không
 * chạm Docker/Pulumi nào.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gitEnv, ROOT_DIR } from '../../utils.js';

/** Deploy project có vòng đời local (`local-up`/`local-down`). */
const LANE_PROJECTS = [
  'platform-deploy',
  'home-deploy',
  'backoffice-deploy',
  'account-deploy',
  'auth-deploy',
  'pact-broker-api-deploy',
  'pact-broker-app-deploy',
  'transactional-mail-deploy',
  'push-notification-deploy',
] as const;

/** Deploy project chỉ build image job, không có target local nào. */
const JOB_ONLY_PROJECTS = [
  'transactional-mailer-job-deploy',
  'web-push-notification-job-deploy',
] as const;

/** Cạnh deploy-lifecycle của graph `local-up`, suy từ `dependsOn` projects-form trỏ target `local-up`. */
type UpEdges = ReadonlyMap<string, readonly string[]>;

interface ResolvedTaskGraph {
  roots: readonly string[];
  tasks: Readonly<Record<string, unknown>>;
  dependencies: Readonly<Record<string, readonly string[]>>;
  continuousDependencies?: Readonly<Record<string, readonly string[]>>;
}

interface NxGraphFile {
  tasks: ResolvedTaskGraph;
}

function packageJson(project: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(ROOT_DIR, 'deploys', project, 'package.json'), 'utf8'),
  ) as Record<string, unknown>;
}

function nxTargets(project: string): Record<string, Record<string, unknown>> {
  const pkg = packageJson(project);
  const nx = pkg['nx'] as { tags?: string[]; targets?: Record<string, Record<string, unknown>> };
  expect(nx['tags'], `${project} must be tagged type:deployment`).toContain('type:deployment');
  return nx['targets'] ?? {};
}

/**
 * Cạnh deploy-lifecycle của `local-up`: với mỗi consumer, tập provider nó trỏ
 * `local-up` tới (dạng `{projects: [...], target: 'local-up'}`). Cạnh
 * `{target: 'build'}` (build image/app) bị loại — build không tham gia teardown.
 * Fail-closed: mọi `dependsOn` entry của `local-up` phải thuộc một trong hai
 * dạng tường minh; dạng khác (vd `^target`, wildcard) là lỗi contract.
 */
function readUpEdges(): UpEdges {
  const edges = new Map<string, string[]>();
  for (const project of LANE_PROJECTS) {
    const target = nxTargets(project)['local-up'] as {
      dependsOn?: readonly unknown[];
    };
    const deps: string[] = [];
    for (const entry of target.dependsOn ?? []) {
      const dep = entry as {
        projects?: readonly string[];
        target?: string;
        dependencies?: boolean;
      };
      if (typeof dep !== 'object' || dep === null || typeof dep.target !== 'string') {
        throw new Error(
          `${project}:local-up has an unrecognized dependsOn entry — the deploy-lifecycle graph must use explicit {projects, target} form`,
        );
      }
      if (dep.dependencies === true) {
        throw new Error(
          `${project}:local-up uses '^' form dependsOn — project graph edges do not define task order and must not silently drive the deploy lane`,
        );
      }
      if (dep.projects === undefined) continue; // không phải cạnh project nào
      if (dep.target === 'local-up') {
        deps.push(...dep.projects);
      } else if (dep.target !== 'build') {
        throw new Error(
          `${project}:local-up depends on unexpected target "${dep.target}" — deploy lifecycle edges must be local-up, anything else must be build`,
        );
      }
    }
    edges.set(project, deps.toSorted());
  }
  return edges;
}

/** Inverse map: provider -> tập direct dependents (từ cạnh deploy-lifecycle `local-up`). */
function invert(edges: UpEdges): Map<string, string[]> {
  const inverse = new Map<string, string[]>(LANE_PROJECTS.map((p) => [p, []]));
  for (const [consumer, providers] of edges) {
    for (const provider of providers) {
      const list = inverse.get(provider);
      if (list === undefined) {
        throw new Error(
          `local-up edge ${consumer} -> ${provider}: provider is not a local-lane project`,
        );
      }
      list.push(consumer);
    }
  }
  for (const list of inverse.values()) list.sort();
  return inverse;
}

/**
 * Đọc `dependsOn` dạng projects của target `local-down` một project.
 * Trả tập project; fail-closed khi entry không phải `{projects, target}` hoặc
 * dùng chiều `^` (dependencies: true) — chiều đó là chiều deploy, sai cho teardown.
 */
function readDownDependsOnProjects(project: string): readonly string[] {
  const target = nxTargets(project)['local-down'] as {
    dependsOn?: readonly unknown[];
  };
  const projects: string[] = [];
  for (const entry of target.dependsOn ?? []) {
    const dep = entry as { projects?: readonly string[]; target?: string; dependencies?: boolean };
    if (typeof dep !== 'object' || dep === null || typeof dep.target !== 'string') {
      throw new Error(
        `${project}:local-down has an unrecognized dependsOn entry — teardown edges must use explicit {projects, target} form`,
      );
    }
    if (dep.dependencies === true) {
      throw new Error(
        `${project}:local-down uses '^' form dependsOn — that schedules the PROVIDER first, which is the deploy direction, wrong for teardown`,
      );
    }
    if (dep.target !== 'local-down') {
      throw new Error(
        `${project}:local-down depends on target "${dep.target}" — teardown edges must point at local-down`,
      );
    }
    if (dep.projects !== undefined) projects.push(...dep.projects);
  }
  return projects.toSorted();
}

/**
 * Resolve task graph thật của Nx cho `run-many -t local-down -c local` qua
 * `--graph=<file>` (file JSON: `tasks.roots/tasks/dependencies`). Chạy từ
 * workspace root với daemon tắt — test không phụ thuộc daemon sống hay graph
 * cache của một worktree khác.
 */
function resolveNxTaskGraph(): ResolvedTaskGraph {
  const outDir = mkdtempSync(join(tmpdir(), 'teardown-graph-'));
  const graphFile = join(outDir, 'graph.json');
  try {
    const result = spawnSync(
      'npx',
      ['nx', 'run-many', '-t', 'local-down', '-c', 'local', `--graph=${graphFile}`],
      {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        env: { ...gitEnv(), NX_DAEMON: 'false' },
        timeout: 300_000,
      },
    );
    if (result.status !== 0) {
      throw new Error(
        `nx run-many --graph exited ${result.status}:\n${result.stdout}\n${result.stderr}`,
      );
    }
    const parsed = JSON.parse(readFileSync(graphFile, 'utf8')) as NxGraphFile;
    expect(
      parsed.tasks,
      'graph JSON must carry the resolved task graph under "tasks"',
    ).toBeDefined();
    expect(
      Object.keys(parsed.tasks.tasks).length,
      'the resolved local-down task graph must contain all 9 lane projects',
    ).toBe(LANE_PROJECTS.length);
    return parsed.tasks;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/** Nhánh cần nối tới sink của topology, không đếm nút trùng qua DFS. */
function hasPath(
  dependencies: ResolvedTaskGraph['dependencies'],
  from: string,
  to: string,
  seen: Set<string> = new Set(),
): boolean {
  if (from === to) return true;
  for (const next of dependencies[from] ?? []) {
    if (seen.has(next)) continue;
    seen.add(next);
    if (hasPath(dependencies, next, to, seen)) return true;
  }
  return false;
}

/** Cycle detection trên resolved graph: DFS ba màu. */
function assertAcyclic(dependencies: ResolvedTaskGraph['dependencies']): void {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(Object.keys(dependencies).map((id) => [id, WHITE]));
  const visit = (id: string, stack: readonly string[]): void => {
    color.set(id, GRAY);
    for (const next of dependencies[id] ?? []) {
      const state = color.get(next) ?? BLACK;
      if (state === GRAY) {
        throw new Error(`task graph cycle detected: ${[...stack, id, next].join(' -> ')}`);
      }
      if (state === WHITE) visit(next, [...stack, id]);
    }
    color.set(id, BLACK);
  };
  for (const id of Object.keys(dependencies)) {
    if (color.get(id) === WHITE) visit(id, []);
  }
}

/** Cạnh deploy-lifecycle `local-up` đọc MỘT LẦN cho cả hai tầng test. */
const upEdges = readUpEdges();
/** Inverse của cạnh trên — danh sách dependents kỳ vọng của từng provider. */
const expectedDependents = invert(upEdges);

describe('local-down teardown order (config level)', () => {
  it('declares local-down dependsOn projects exactly equal to the inverse of the local-up deploy graph', () => {
    // Contract nghịch đảo chính xác: provider nào có dependent thì phải trỏ
    // `local-down` của ĐÚNG tập dependents đó; project không có dependent thì
    // KHÔNG được khai edge nào (tránh serialize vô nghĩa).
    for (const project of LANE_PROJECTS) {
      const actual = readDownDependsOnProjects(project);
      expect(actual, `${project}:local-down dependsOn must equal its local-up dependents`).toEqual(
        expectedDependents.get(project),
      );
    }
  });

  it('keeps build-image dependencies out of the teardown graph', () => {
    // Cạnh build của local-up (vd auth -> @ecoma-io/auth build) không là quan hệ
    // teardown: nếu ai đó chuyển một cạnh build thành local-down edge, test này
    // đỏ — dependents của build project không tồn tại trong lane.
    const buildEdgeTargets: string[] = [];
    for (const project of LANE_PROJECTS) {
      const target = nxTargets(project)['local-up'] as { dependsOn?: readonly unknown[] };
      for (const entry of target.dependsOn ?? []) {
        const dep = entry as { projects?: readonly string[]; target?: string };
        if (dep?.target === 'build') {
          buildEdgeTargets.push(...(dep.projects ?? []));
        }
      }
    }
    expect(
      buildEdgeTargets.filter((p) => (LANE_PROJECTS as readonly string[]).includes(p)),
      'build edges of local-up must not name lane projects (they belong outside the teardown graph)',
    ).toEqual([]);
  });

  it('covers every lane project in both directions (no deploy edge lost, no teardown edge invented)', () => {
    // Chốt tập: inverse map phải phủ đúng 9 lane project, mỗi cạnh local-up
    // deploy-lifecycle đã biết xuất hiện đúng một lần ở chiều ngược lại.
    expect([...expectedDependents.keys()].toSorted()).toEqual([...LANE_PROJECTS].toSorted());
    // Spot-check ba hình dạng cạnh đại diện đủ ba nhánh (fail thẳng với message
    // rõ nếu graph local-up đổi cấu trúc mà teardown chưa theo).
    expect(expectedDependents.get('platform-deploy')).toEqual([
      'home-deploy',
      'pact-broker-api-deploy',
      'push-notification-deploy',
    ]);
    expect(expectedDependents.get('account-deploy')).toEqual([
      'auth-deploy',
      'transactional-mail-deploy',
    ]);
    expect(expectedDependents.get('auth-deploy')).toEqual([]);
  });

  it('job-deploy projects stay outside the lifecycle graph (documented non-participants)', () => {
    // Hai job deploy không có target local; nếu một ngày ai gắn local target
    // cho chúng mà không qua quyết định graph, test cấu trúc này đỏ trước.
    for (const project of JOB_ONLY_PROJECTS) {
      const targets = packageJson(project) as {
        nx?: { targets?: Record<string, unknown> };
      };
      expect(
        targets.nx?.targets?.['local-up'],
        `${project} must not declare local-up`,
      ).toBeUndefined();
      expect(
        targets.nx?.targets?.['local-down'],
        `${project} must not declare local-down`,
      ).toBeUndefined();
    }
  });
});

describe('local-down teardown order (resolved Nx task graph)', () => {
  let taskGraph: ResolvedTaskGraph;

  it('resolves the real task graph via the repository invocation shape', () => {
    taskGraph = resolveNxTaskGraph();
    expect(Object.keys(taskGraph.dependencies).toSorted()).toEqual(
      LANE_PROJECTS.map((p) => `${p}:local-down:local`).toSorted(),
    );
  });

  it('orders every consumer local-down before its provider local-down (reachable in resolved graph)', () => {
    // Nx `dependencies[X]` liệt kê những task PHẢI CHAY TRƯỚC X. Provider khai
    // dependsOn trỏ các dependent nên entry của provider chứa consumer; "consumer
    // trước provider" tức là từ provider phải đi được tới consumer theo cạnh resolved.
    for (const [consumer, providers] of upEdges) {
      for (const provider of providers) {
        expect(
          hasPath(
            taskGraph.dependencies,
            `${provider}:local-down:local`,
            `${consumer}:local-down:local`,
          ),
          `${consumer}:local-down must transitively precede ${provider}:local-down in the resolved task graph`,
        ).toBe(true);
      }
    }
  });

  it('runs platform-deploy local-down after everything else in its reach (unique sink of the resolved graph)', () => {
    // Sink duy nhất theo nghĩa execution: platform CHỜ mọi nhánh khác (entry
    // của nó chứa đầu cả ba nhánh), và không task nào phải chờ platform
    // (platform không xuất hiện trong entry của task nào khác).
    const platformId = 'platform-deploy:local-down:local';
    expect(taskGraph.dependencies[platformId].length).toBeGreaterThan(0);
    for (const id of Object.keys(taskGraph.dependencies)) {
      if (id === platformId) continue;
      expect(
        hasPath(taskGraph.dependencies, platformId, id),
        `${id} must complete before ${platformId} — platform teardown runs last on every branch`,
      ).toBe(true);
    }
    for (const [other, before] of Object.entries(taskGraph.dependencies)) {
      if (other === platformId) continue;
      expect(before).not.toContain(platformId);
    }
  });

  it('keeps independent branches unconstrained in the resolved graph (parallel where safe)', () => {
    // Bốn đầu nhánh độc lập không được có cạnh resolved giữa chúng: đầu nhánh
    // pact (pact-app), đầu nhánh home (auth), và hai lá wave-2 (mail, push).
    // Nx có thể chạy chúng đồng thời — edge nào xuất hiện giữa hai đầu nhánh
    // là serialize vô nghĩa và test này đỏ.
    const branchHeads = [
      'pact-broker-app-deploy:local-down:local',
      'auth-deploy:local-down:local',
      'transactional-mail-deploy:local-down:local',
      'push-notification-deploy:local-down:local',
    ];
    for (const a of branchHeads) {
      for (const b of branchHeads) {
        if (a === b) continue;
        expect(
          hasPath(taskGraph.dependencies, a, b),
          `${a} must not be ordered before ${b} — independent branches stay parallel`,
        ).toBe(false);
      }
    }
  });

  it('contains no cycle in the resolved task graph', () => {
    // Nx không bật --nxIgnoreCycles trong invocation chuẩn của repo; một cycle
    // sẽ fail resolution trước khi tới đây, nhưng ghim tường minh vẫn đáng —
    // regression merge targetDefaults kiểu "vô hình với config check" bị bắt.
    expect(() => assertAcyclic(taskGraph.dependencies)).not.toThrow();
  });
});
