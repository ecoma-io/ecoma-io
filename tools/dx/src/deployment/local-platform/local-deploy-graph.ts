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

/** MỘT task của đồ thị: `<project>:<target>` (cùng quy ước hiển thị của Nx). */
export interface LocalLaneTask {
  project: string;
  target: LocalLaneTarget;
}

/** Project deploy thuộc chuỗi local — thứ tự khai là thứ tự hiển thị mặc định. */
export const LOCAL_LANE_PROJECTS = [
  'platform-deploy',
  'home-deploy',
  'backoffice-deploy',
  'account-deploy',
  'auth-deploy',
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
    throw new LocalLaneGraphError(`đọc graph local lane: không tìm thấy ${path}`);
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
    throw new LocalLaneGraphError(`dependsOn entry thiếu target: ${JSON.stringify(entry)}`);
  }
  return { project: entry.projects?.[0], target, self: false };
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
        `${project} thiếu target ${target} — khai báo Nx là nguồn sự thật thứ tự lane local`,
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
 * Fail-closed: thiếu project khai báo, thiếu target, thiếu dependsOn, hay có
 * chu trình đều là lỗi graph chứ không phải "chạy theo thứ tự cũ".
 */
export function localUpProjectSequence(): LocalLaneProject[] {
  const specs = new Map<LocalLaneProject, JsonTargetSpec>();
  for (const project of LOCAL_LANE_PROJECTS) {
    specs.set(project, readProjectLaneTargets(project)['local-up']);
  }

  // Edge: project → các project nó phụ thuộc (chỉ trong LOCAL_LANE_PROJECTS).
  const edges = new Map<LocalLaneProject, LocalLaneProject[]>();
  for (const [project, spec] of specs) {
    const deps: LocalLaneProject[] = [];
    for (const entry of spec.dependsOn ?? []) {
      const normalized = normalizeDependsOnEntry(entry);
      if (normalized.project === undefined) {
        throw new LocalLaneGraphError(
          `${project}:local-up — dependsOn phải chỉ định {"projects": [...]} tường minh ` +
            `(không dùng '^' hay implicit): ${JSON.stringify(entry)}`,
        );
      }
      if (!(LOCAL_LANE_PROJECTS as readonly string[]).includes(normalized.project)) {
        throw new LocalLaneGraphError(
          `${project}:local-up phụ thuộc ${normalized.project} ngoài chuỗi local lane`,
        );
      }
      if (normalized.target !== 'local-up' && normalized.target !== 'local-env') {
        throw new LocalLaneGraphError(
          `${project}:local-up phụ thuộc target lạ "${normalized.target}" — ` +
            'chuỗi spine chỉ gồm target local-up (và local-env của platform cho dữ liệu .env)',
        );
      }
      // `local-env` chỉ tồn tại trên platform và không tham gia spine — edge
      // spine chỉ đếm các phụ thuộc `local-up` (dependency thật giữa các stack).
      if (normalized.target === 'local-up') {
        deps.push(normalized.project as LocalLaneProject);
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
    throw new LocalLaneGraphError(`chu kỳ trong đồ thị local-up: ${stuck.join(', ')}`);
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
