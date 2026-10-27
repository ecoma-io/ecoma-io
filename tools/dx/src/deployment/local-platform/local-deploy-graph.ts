/**
 * Hình dạng Task Graph của lane local deploy — nguồn sự thật DẪN XUẤT.
 *
 * Nguồn sự thật về THỨ TỰ là khai báo Nx: target `local-up` của từng project
 * `deploys/<tên>/package.json` (với `dependsOn` của nó) + `targetDefaults` trong
 * `nx.json`. Module này KHÔNG định nghĩa lại thứ tự — nó đọc lại chính các
 * file khai báo đó (deterministic, không gọi `nx` CLI nên chạy được trong unit
 * test không cần workspace) và đưa ra:
 *
 * - `localDeployTaskSequence()`: danh sách task theo thứ tự topo (topological),
 *   cho orchestration và cho unit test cấu trúc.
 * - `localDestroyStackOrder()`: thứ tự destroy NGHỊCH của dependency (dependents
 *   trước, platform CUỐI) cho `localDestroy`.
 *
 * Ngoài spine, một `dependsOn` của `local-up` được phép khai **build
 * prerequisite** — entry `{"projects": [...], "target": "build"}` trỏ vào
 * project app NGOÀI lane (vd `auth:build` từ `auth-deploy`): deploy unit cần
 * bundle `dist/` đã build trước khi Pulumi up. Edge dạng này KHÔNG tham gia
 * spine topo và không lọt destroy order — nó chỉ là ràng buộc thứ tự Nx giữa
 * task build của app và task up của deploy unit (xem
 * `classifyLocalUpDependsOnEntries`).
 *
 * Vì cả orchestration lẫn destroy cùng đọc MỘT nguồn, một thay đổi `dependsOn`
 * trong khai báo Nx tự động đổi cả hai — và unit test cấu trúc
 * chặn mọi thay đổi phá bất biến (platform trước mọi unit, account trước auth,
 * chuỗi không có chu trình, đầy đủ 5 stack).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT_DIR } from '../../utils.js';

/** Target Nx của lane local trên deploy project. */
export type LocalLaneTarget = 'local-up' | 'local-env' | 'local-smoke';

/**
 * Target build-prerequisite mà một `dependsOn` của `local-up` được phép khai
 * trỏ ra ngoài lane. Chỉ `build`: edge build là ràng buộc thứ tự giữa bundle
 * `dist/` của app và task up của deploy unit; bất kỳ target nào khác ngoài
 * lane vẫn là lỗi khai báo (target lạ).
 */
export const LOCAL_UP_PREREQUISITE_TARGET = 'build';

/** MỘT task của đồ thị: `<project>:<target>` (cùng quy ước hiển thị của Nx). */
export interface LocalLaneTask {
  project: string;
  target: LocalLaneTarget;
}

/**
 * Project deploy thuộc chuỗi local — thứ tự khai là thứ tự hiển thị mặc định.
 *
 * Wave 2 (#264): năm project cũ (spine platform → home → backoffice →
 * account → auth) + bốn unit mới — `pact-broker-api-deploy` và
 * `push-notification-deploy` phụ thuộc platform (network + StackReference),
 * `pact-broker-app-deploy` phụ thuộc pact-api (api token + alias DNS),
 * `transactional-mail-deploy` phụ thuộc account (secret HMAC cross-stack).
 * `transactional-mailer-job-deploy` và `web-push-notification-job-deploy` KHÔNG
 * thuộc lane: không có target `local-up` — runtime của chúng là worker thứ hai
 * bên trong container WIC của unit tương ứng.
 */
export const LOCAL_LANE_PROJECTS = [
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
export type LocalLaneProject = (typeof LOCAL_LANE_PROJECTS)[number];

/** Target mặc định mà orchestration chạy — toàn bộ chuỗi qua run-many. */
export const LOCAL_LANE_TARGETS: readonly LocalLaneTarget[] = [
  'local-up',
  'local-env',
  'local-smoke',
];

/** Lỗi dữ liệu khai báo — fail-closed, không bao giờ "đoán" thứ tự. */
export class LocalLaneGraphError extends Error {}

export interface JsonTargetSpec {
  dependsOn?: Array<string | { projects?: string[]; target?: string; dependencies?: boolean }>;
  configurations?: Record<string, unknown>;
  executor?: string;
}

interface JsonPackageWithNx {
  name?: string;
  nx?: {
    targets?: Record<string, JsonTargetSpec>;
    tags?: string[];
  };
}

function readPackageNx(projectRoot: string): JsonPackageWithNx {
  const path = join(ROOT_DIR, projectRoot, 'package.json');
  if (!existsSync(path)) {
    throw new LocalLaneGraphError(`read local lane graph: file not found ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as JsonPackageWithNx;
}

/** Chuẩn hoá một entry `dependsOn` Nx thành cặp (project, target) hoặc '^target'. */
function normalizeDependsOnEntry(entry: NonNullable<JsonTargetSpec['dependsOn']>[number]): {
  project: string | undefined;
  target: string;
  self: boolean;
} {
  if (typeof entry === 'string') {
    const self = entry.startsWith('^');
    const target = self ? entry.slice(1) : entry;
    return { project: undefined, target, self };
  }
  const target = entry.target ?? '';
  if (target.length === 0) {
    throw new LocalLaneGraphError(`dependsOn entry missing target: ${JSON.stringify(entry)}`);
  }
  return { project: entry.projects?.[0], target, self: false };
}

/**
 * Phân loại MỘT entry `dependsOn` của `local-up` thành spine hoặc build
 * prerequisite — fail-closed với khai báo sai.
 *
 * - Entry thiếu `{"projects": [...]}` tường minh (chuỗi `'target'`, `'^target'`
 *   hay implicit) vẫn là lỗi như cũ: thứ tự lane không bao giờ "đoán".
 * - `{"projects": [<lane project>], "target": "local-up"}` là spine edge thật
 *   giữa hai stack — tham gia topo.
 * - `{"projects": [<lane project>], "target": "local-env"}` (platform) cung
 *   cấp dữ liệu `.env` nhưng KHÔNG tham gia spine — đúng ngữ nghĩa hiện có.
 * - `{"projects": [<bất kỳ>], "target": "build"}` là build prerequisite —
 *   được phép trỏ ra ngoài lane (app bundle), KHÔNG tham gia spine. Target
 *   `build` trên project trong lane cũng rơi vào đây: nó không phải up của
 *   stack nào, giữ một classification duy nhất cho một target.
 * - Mọi tổ hợp khác (project ngoài lane với `local-up`/`local-env`, target
 *   lạ nói chung) ném `LocalLaneGraphError` với đúng thông điệp cũ — một
 *   `dependsOn` sai phải đỏ ở validator TRƯỚC khi Nx kịp chạy.
 */
export function classifyLocalUpDependsOnEntry(
  project: LocalLaneProject,
  entry: NonNullable<JsonTargetSpec['dependsOn']>[number],
): { kind: 'spine' | 'prerequisite'; dependency?: LocalLaneProject } {
  const normalized = normalizeDependsOnEntry(entry);
  if (normalized.project === undefined) {
    throw new LocalLaneGraphError(
      `${project}:local-up — dependsOn must specify {"projects": [...]} explicitly ` +
        `(no '^' or implicit entries): ${JSON.stringify(entry)}`,
    );
  }
  if (normalized.target === LOCAL_UP_PREREQUISITE_TARGET) {
    return { kind: 'prerequisite' };
  }
  if (!(LOCAL_LANE_PROJECTS as readonly string[]).includes(normalized.project)) {
    throw new LocalLaneGraphError(
      `${project}:local-up depends on ${normalized.project} which is outside the local lane`,
    );
  }
  if (normalized.target !== 'local-up' && normalized.target !== 'local-env') {
    throw new LocalLaneGraphError(
      `${project}:local-up depends on unexpected target "${normalized.target}" — ` +
        'the spine only allows local-up targets (plus platform local-env for .env data; ' +
        'target "build" is the only build prerequisite allowed to point outside the lane)',
    );
  }
  if (normalized.target === 'local-up') {
    return { kind: 'spine', dependency: normalized.project as LocalLaneProject };
  }
  // `local-env` chỉ tồn tại trên platform và không tham gia spine — edge
  // spine chỉ đếm các phụ thuộc `local-up` (dependency thật giữa các stack).
  return { kind: 'prerequisite' };
}

/** Target của MỘT project — từ package.json; không có target → lỗi (khai báo thiếu). */
export function readProjectLaneTargets(project: string): Record<LocalLaneTarget, JsonTargetSpec> {
  const nx = readPackageNx(`deploys/${project}`);
  const targets = nx.nx?.targets ?? {};
  const result = {} as Record<LocalLaneTarget, JsonTargetSpec>;
  for (const target of LOCAL_LANE_TARGETS) {
    const spec = targets[target];
    if (spec === undefined) {
      // `local-env`/`local-smoke` là target CHỈ platform có (outputs và smoke
      // end-to-end thuộc về platform) — thiếu chúng trên unit là đúng cấu trúc,
      // không phải lỗi. Chỉ `local-up` là bắt buộc trên MỌI project của chuỗi.
      if (target !== 'local-up') continue;
      throw new LocalLaneGraphError(
        `${project} is missing target ${target} — the Nx declaration is the source of truth for local lane order`,
      );
    }
    result[target] = spec;
  }
  return result;
}

/**
 * Danh sách project thuộc chuỗi local-up, xếp theo thứ tự topo từ `dependsOn`.
 *
 * Chỉ xét target `local-up` (chuỗi spine của lane); `local-env`/`local-smoke`
 * gắn trên platform và được orchestration chạy trong cùng lệnh `run-many`.
 * Build prerequisite (`target: "build"` trỏ ngoài lane) được chấp nhận nhưng
 * KHÔNG tham gia topo — thứ tự build↔up do Nx đảm bảo lúc chạy task graph.
 * Fail-closed: thiếu project khai báo, thiếu target, thiếu dependsOn, khai
 * báo sai (project ngoài lane cho local-up/local-env, target lạ), hay có
 * chu trình đều là lỗi graph chứ không phải "chạy theo thứ tự cũ".
 */
export function localUpProjectSequence(): LocalLaneProject[] {
  const specs = new Map<LocalLaneProject, JsonTargetSpec>();
  for (const project of LOCAL_LANE_PROJECTS) {
    specs.set(project, readProjectLaneTargets(project)['local-up']);
  }

  // Edge: project → các project nó phụ thuộc (chỉ spine edge tham gia topo;
  // build prerequisite chỉ là ràng buộc thứ tự Nx, không đổi thứ tự stack).
  const edges = new Map<LocalLaneProject, LocalLaneProject[]>();
  for (const [project, spec] of specs) {
    const deps: LocalLaneProject[] = [];
    for (const entry of spec.dependsOn ?? []) {
      const classified = classifyLocalUpDependsOnEntry(project, entry);
      if (classified.kind === 'spine') {
        deps.push(classified.dependency as LocalLaneProject);
      }
    }
    edges.set(project, deps);
  }

  // Kahn topo — thứ tự ổn định theo thứ tự khai trong LOCAL_LANE_PROJECTS.
  const inDegree = new Map<LocalLaneProject, number>();
  const dependents = new Map<LocalLaneProject, LocalLaneProject[]>();
  for (const project of LOCAL_LANE_PROJECTS) {
    inDegree.set(project, edges.get(project)?.length ?? 0);
    dependents.set(project, []);
  }
  for (const [project, deps] of edges) {
    for (const dep of deps) {
      dependents.get(dep)?.push(project);
    }
  }

  const queue: LocalLaneProject[] = LOCAL_LANE_PROJECTS.filter((p) => (inDegree.get(p) ?? 0) === 0);
  const sequence: LocalLaneProject[] = [];
  while (queue.length > 0) {
    const project = queue.shift() as LocalLaneProject;
    sequence.push(project);
    for (const dependent of dependents.get(project) ?? []) {
      const next = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }
  if (sequence.length !== LOCAL_LANE_PROJECTS.length) {
    const stuck = LOCAL_LANE_PROJECTS.filter((p) => !sequence.includes(p));
    throw new LocalLaneGraphError(`cycle in the local-up graph: ${stuck.join(', ')}`);
  }
  return sequence;
}

/**
 * Toàn bộ task của lane local theo thứ tự topo chạy.
 *
 * Chuỗi spine (`local-up`) trước, rồi các target phụ trợ của platform gắn đúng
 * vị trí dữ liệu: `local-env` ngay sau platform-up (nó cần outputs), các task
 * còn lại theo dependency; `local-smoke` là node lá — luôn CUỐI.
 *
 * Dùng cho: orchestration `run-many` (danh sách `-t`), unit test cấu trúc, và
 * tài liệu hoá contract thứ tự.
 */
export function localDeployTaskSequence(): LocalLaneTask[] {
  const upSequence = localUpProjectSequence();
  const tasks: LocalLaneTask[] = [{ project: 'platform-deploy', target: 'local-up' }];
  // env NGAY sau platform-up: mọi step unit đọc ROOT_HOST từ `.env` mà nó ghi.
  tasks.push({ project: 'platform-deploy', target: 'local-env' });
  for (const project of upSequence) {
    if (project === 'platform-deploy') continue;
    tasks.push({ project, target: 'local-up' });
  }
  tasks.push({ project: 'platform-deploy', target: 'local-smoke' });
  return tasks;
}

/**
 * Thứ tự destroy của lane local — NGHỊCH của dependency.
 *
 * Dependents destroy TRƯỚC dependency; platform-deploy (dependency gốc mà mọi
 * unit phụ thuộc) destroy CUỐI. Suy từ chính graph `local-up` — thay `dependsOn`
 * trong khai báo Nx là thứ tự destroy đổi theo, không cần sửa code destroy.
 */
export function localDestroyStackOrder(): LocalLaneProject[] {
  // target es2022 không có toReversed: copy rồi đảo tại chỗ (mảng copy mình
  // sở hữu, cùng cách worker-discovery/deployment-map-check).
  const down = localUpProjectSequence().slice();
  down.reverse();
  return down;
}

/** Các configuration hợp lệ của target local — lane local là lane DUY NHẤT. */
export function localLaneConfigurationNames(project: string): string[] {
  const spec = readProjectLaneTargets(project);
  const names = new Set<string>();
  for (const targetSpec of Object.values(spec)) {
    for (const name of Object.keys(targetSpec.configurations ?? {})) {
      names.add(name);
    }
  }
  // target es2022 không có toSorted: copy rồi sort tại chỗ (sort mặc định của
  // string là UTF-16 code unit order — deterministic, cùng semantics).
  const sorted = [...names];
  sorted.sort();
  return sorted;
}
