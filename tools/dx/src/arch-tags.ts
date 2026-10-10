/**
 * Validate Nx architecture tags cho toàn workspace.
 *
 * Hai lượt kiểm, tách bạch nguồn dữ liệu:
 *
 * 1. **Tag schema** — đọc trực tiếp `nx show projects --json`: mỗi project phải
 *    có đúng một `scope:*`, một `type:*`, một `runtime:*`, mọi value thuộc
 *    allowlist, và không còn value legacy (`type:web`, `layer:*`, …). Lượt này
 *    chạy trên **tất cả** project, bất kể affected — một tag sai ở project không
 *    đổi file nào cũng phải bị bắt, vì chính tag là dữ liệu đầu vào của mọi
 *    constraint khác. Danh sách `show` là truth: project nào có trong danh sách
 *    mà vắng trong project graph thì check fail-closed (xem
 *    `buildWorkspaceState`) — không skip lặng lẽ project nào.
 *
 * 2. **Runtime compatibility theo graph** — đọc project graph và kiểm mỗi edge
 *    theo ma trận `RUNTIME_COMPAT`: `runtime:edge` không được phụ thuộc
 *    `runtime:native`/`runtime:browser`, v.v. Lượt này dùng graph chứ không dùng
 *    directory glob: guard theo glob (`.oxlintrc.json` override) chỉ chặn chữ
 *    `node:*` trong mã của app, không biết project nào là `runtime:edge`
 *    thật — một tooling script import `node:fs` hợp lệ, một app edge thì không,
 *    và glob không phân biệt được hai trường hợp đó.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { ROOT_DIR } from './utils.js';

/** Giá trị hợp lệ của mỗi dimension tag kiến trúc bắt buộc. */
export const ARCH_TAG_DIMENSIONS = {
  scope: null, // ownership boundary — value do repo quyết định, kiểm theo PREFIX
  type: ['domain', 'application', 'infrastructure', 'contracts', 'composition', 'tooling'],
  runtime: ['edge', 'browser', 'native', 'universal'],
} as const;

export type ArchDimension = keyof typeof ARCH_TAG_DIMENSIONS;

/**
 * Value legacy của các dimension cũ — xuất hiện ở project nào cũng là lỗi.
 *
 * Danh sách này chặn value biết trước của dimension VẪN TỒN TẠI (`type:*`,
 * `runtime:*`): value đó giờ không thuộc allowlist nên lượt 1 đã báo
 * `invalid-value`, mục ở đây chỉ để gắn nhãn `legacy-value` — lỗi taxonomy cũ,
 * không phải gõ sai. Riêng dimension đã bị XOÁ (`layer`) bị chặn theo PREFIX
 * trong `validateTagSchema`: mọi `layer:*` là di tích bất kể value, không thể
 * lọt qua chỉ vì value chưa được liệt kê.
 */
export const LEGACY_TAG_VALUES: readonly string[] = [
  'type:web',
  'type:service',
  'type:lib',
  'type:tool',
  'type:infras',
  'layer:domain',
  'layer:application',
  'layer:infrastructure',
  'layer:contracts',
  'runtime:node',
];

/**
 * Prefix chấp nhận được cho `scope:*`.
 *
 * `scope` là ownership boundary nên value của nó do bounded context/product
 * quyết định và tăng dần theo repo; validator chỉ neo hai điều:
 * - value không được rỗng (`scope:` trống không mang ý nghĩa ownership);
 * - value phải thuộc danh sách scope mà repo đang khai báo trong constraints
 *   của `.oxlintrc.json` — scope ngoài danh sách đó không có constraint nên
 *   dependency của project này sẽ không được ai kiểm.
 *
 * Danh sách giữ nguyên trong validator và `.oxlintrc.json` phải đồng bộ; spec
 * của validator test hai nguồn bằng chung một fixture.
 */
export const KNOWN_SCOPES: readonly string[] = [
  'public',
  'shared',
  'platform',
  'identity',
  'backoffice',
  'llm',
  'payment',
  'messaging',
  'notifications',
  'local',
];

/**
 * Ma trận compatibility runtime: key được phép phụ thuộc tập value ở value.
 *
 * Runtime cụ thể loại trừ lẫn nhau và loại `native` (OS process) — một project
 * edge không import được code native, v.v. `universal` là lời cam kết tương
 * thích hai chiều nên nó chỉ được phụ thuộc project `universal`: một lib
 * universal mà kéo theo dependency edge-only/native/browser-only thì lời cam
 * kết đó lộp bộp — dependency quyết định nơi lib chạy được, không phải tag.
 */
export const RUNTIME_COMPAT: Record<string, readonly string[]> = {
  universal: ['universal'],
  edge: ['universal', 'edge'],
  browser: ['universal', 'browser'],
  native: ['universal', 'native'],
};

export interface ArchTagViolation {
  project: string;
  kind:
    | 'missing-dimension'
    | 'duplicate-dimension'
    | 'invalid-value'
    | 'legacy-value'
    | 'unknown-scope'
    | 'runtime-compat'
    | 'graph-inconsistent';
  detail: string;
}

/** Một node của project graph đủ dùng cho kiểm runtime: name, tags, dependencies. */
export interface ArchProjectNode {
  name: string;
  tags: readonly string[];
  dependencies: readonly string[];
}

/** Kéo tags + dependency edges từ Nx cho toàn workspace (read-only). */
export function collectWorkspaceState(): {
  projects: Map<string, ArchProjectNode>;
} {
  const raw = execFileSync(
    process.execPath,
    [join(ROOT_DIR, 'node_modules/nx/dist/bin/nx.js'), 'show', 'projects', '--json'],
    { cwd: ROOT_DIR, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  const names = JSON.parse(raw) as string[];

  const rawGraph = execFileSync(
    process.execPath,
    [join(ROOT_DIR, 'node_modules/nx/dist/bin/nx.js'), 'graph', '--print'],
    { cwd: ROOT_DIR, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  const graph = JSON.parse(rawGraph) as {
    graph: {
      nodes: Record<string, { name: string; data: { tags?: string[] } }>;
      dependencies: Record<string, { target: string }[]>;
    };
  };

  const projects = buildWorkspaceState(names, graph.graph);
  return { projects };
}

/**
 * Hợp nhất danh sách project authoritative (`nx show projects`) với project
 * graph. Danh sách `show` là **truth về những project nào tồn tại** — project
 * có trong danh sách mà vắng trong graph là lỗi dữ liệu graph (fail-closed,
 * không skip lặng lẽ: một project bị bỏ qua là một project không ai kiểm tag).
 *
 * Node external/npm (package dependency, không phải project) nằm trong
 * `dependencies` chứ không trong `nodes` của graph — chúng bị lọc khỏi danh
 * sách edges project↔project, đúng vai trò, không phải lỗi.
 *
 * Tách thành helper thuần để unit test được mà không cần corrupt workspace thật.
 */
export function buildWorkspaceState(
  names: readonly string[],
  graph: {
    nodes: Record<string, { name: string; data: { tags?: string[] } }>;
    dependencies: Record<string, { target: string }[]>;
  },
): Map<string, ArchProjectNode> {
  const missing = names.filter((name) => !graph.nodes[name]);
  if (missing.length > 0) {
    throw new GraphInconsistencyError(
      `workspace projects missing from the Nx project graph — ` +
        `arch-check refuses to validate a partial graph: ${missing.join(', ')}`,
      missing,
    );
  }

  const projects = new Map<string, ArchProjectNode>();
  for (const name of names) {
    const node = graph.nodes[name];
    const deps = (graph.dependencies[name] ?? [])
      .map((d) => d.target)
      .filter((t) => graph.nodes[t] !== undefined); // chỉ quan tâm project↔project
    projects.set(name, { name, tags: node.data.tags ?? [], dependencies: deps });
  }
  return projects;
}

/** Graph và danh sách project lệch nhau — workspace chưa sẵn sàng để validate. */
export class GraphInconsistencyError extends Error {
  readonly missingProjects: readonly string[];

  constructor(message: string, missingProjects: readonly string[] = []) {
    super(message);
    this.name = 'GraphInconsistencyError';
    this.missingProjects = missingProjects;
  }
}

/** Lượt 1: schema của ba dimension tag trên một project. */
export function validateTagSchema(project: ArchProjectNode): ArchTagViolation[] {
  const violations: ArchTagViolation[] = [];
  const seen = new Map<ArchDimension, string[]>();

  for (const tag of project.tags) {
    const colon = tag.indexOf(':');
    if (colon <= 0) continue; // không phải dạng `dim:value` (vd `npm:private` vẫn đúng dạng) — bỏ qua tag ngoài ba dimension
    const dim = tag.slice(0, colon) as ArchDimension;
    const value = tag.slice(colon + 1);

    // Legacy check đứng TRƯỚC guard dimension: `layer:*` thuộc dimension đã bị
    // xoá nên nếu để sau `dim in ARCH_TAG_DIMENSIONS` thì nó đi thẳng qua mà
    // không bị báo — đúng kiểu "legacy còn sống lặng lẽ" mà check này hunting.
    // `layer` bị chặn theo PREFIX (mọi value), không theo danh sách value định
    // trước: dimension đã bị xoá khỏi taxonomy nên giá trị nào mang prefix đó
    // cũng là di tích — danh sách cứng chỉ bắt được value biết trước.
    if (LEGACY_TAG_VALUES.includes(tag) || tag.startsWith('layer:')) {
      violations.push({ project: project.name, kind: 'legacy-value', detail: tag });
      continue;
    }
    if (!(dim in ARCH_TAG_DIMENSIONS)) continue;

    const list = seen.get(dim) ?? [];
    list.push(value);
    seen.set(dim, list);

    if (dim === 'scope') {
      if (!KNOWN_SCOPES.includes(value)) {
        violations.push({ project: project.name, kind: 'unknown-scope', detail: tag });
      }
      continue;
    }
    const allowed = ARCH_TAG_DIMENSIONS[dim] as readonly string[];
    if (!allowed.includes(value)) {
      violations.push({ project: project.name, kind: 'invalid-value', detail: tag });
    }
  }

  for (const dim of Object.keys(ARCH_TAG_DIMENSIONS) as ArchDimension[]) {
    const list = seen.get(dim);
    if (!list || list.length === 0) {
      violations.push({
        project: project.name,
        kind: 'missing-dimension',
        detail: dim,
      });
    } else if (list.length > 1) {
      violations.push({
        project: project.name,
        kind: 'duplicate-dimension',
        detail: `${dim}: ${list.join(', ')}`,
      });
    }
  }

  return violations;
}

/** Lượt 2: mỗi dependency edge của một project phải qua ma trận runtime. */
export function validateRuntimeCompat(
  project: ArchProjectNode,
  projects: Map<string, ArchProjectNode>,
): ArchTagViolation[] {
  const violations: ArchTagViolation[] = [];
  const runtimeTag = project.tags.find((t) => t.startsWith('runtime:'));
  if (!runtimeTag) return violations; // lượt 1 đã báo missing — không nhân đôi lỗi
  const allowed = RUNTIME_COMPAT[runtimeTag.slice('runtime:'.length)];
  if (!allowed) return violations; // lượt 1 đã báo invalid-value

  for (const dep of project.dependencies) {
    const depNode = projects.get(dep);
    if (!depNode) continue;
    const depRuntime = depNode.tags.find((t) => t.startsWith('runtime:'));
    if (!depRuntime) continue; // dep lỗi schema — lượt 1 báo, khỏi nhân đôi
    if (!allowed.includes(depRuntime.slice('runtime:'.length))) {
      violations.push({
        project: project.name,
        kind: 'runtime-compat',
        detail: `${runtimeTag} depends on ${dep} (${depRuntime})`,
      });
    }
  }
  return violations;
}

/** Chạy đủ hai lượt trên toàn workspace, trả mọi vi phạm (rỗng = sạch). */
export function validateArchitecture(state: {
  projects: Map<string, ArchProjectNode>;
}): ArchTagViolation[] {
  const violations: ArchTagViolation[] = [];
  for (const project of state.projects.values()) {
    violations.push(...validateTagSchema(project));
    violations.push(...validateRuntimeCompat(project, state.projects));
  }
  return violations;
}

/** Điểm vào CLI: exit 1 kèm danh sách vi phạm nếu workspace lệch schema. */
export function main(): number {
  let state: ReturnType<typeof collectWorkspaceState>;
  try {
    state = collectWorkspaceState();
  } catch (error) {
    if (error instanceof GraphInconsistencyError) {
      console.error(`[graph-inconsistent] ${error.message}`);
      console.error('architecture tag validation failed: Nx project graph is inconsistent');
      return 1;
    }
    throw error; // lỗi môi trường (nx crash, JSON hỏng) — để stacktrace gốc lộ ra
  }
  const violations = validateArchitecture(state);
  if (violations.length === 0) {
    console.log(`architecture tags OK (${state.projects.size} projects validated)`);
    return 0;
  }
  for (const v of violations) {
    console.error(`[${v.kind}] ${v.project}: ${v.detail}`);
  }
  console.error(`architecture tag validation failed: ${violations.length} violation(s)`);
  return 1;
}
