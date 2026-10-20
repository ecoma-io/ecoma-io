/**
 * `pnpm dx local-cleanup` — dọn Docker resource mồ côi của worktree đã bị xoá.
 *
 * Mục tiêu VÀ ranh giới: tìm mọi resource local deployment (network, container,
 * volume) mà worktree sở hữu nó KHÔNG CÒN tồn tại trên đĩa, rồi xoá trực tiếp —
 * KHÔNG có teardown theo thứ tự phụ thuộc (Traefik trước home trước platform):
 * Docker tự xử lý được vì không resource nào trong local deployment phụ thuộc
 * vòng sống vào resource khác sau khi worktree biến mất.
 *
 * An toàn là tính chất ĐẦU TIÊN, không phải kiểm tra cuối:
 * - Ownership phải được chứng minh bằng label (`deploy-labels.ts`): resource
 *   thiếu label, sai giá trị hay metadata mâu thuẫn KHÔNG bao giờ bị xoá, dù
 *   tên có trông giống resource ecoma.
 * - Worktree còn tồn tại trên đĩa (theo `normalizeWorktreeRoot` — path phải
 *   resolve được) là worktree SỐNG, resource của nó được giữ nguyên kể cả nếu
 *   developer đang không deploy.
 * - PostgreSQL volume persistent mặc định KHÔNG bị xoá — giữ đúng contract
 *   `local-destroy` (dữ liệu chỉ xoá khi opt-in tường minh). Hiện cleanup
 *   KHÔNG có cờ xoá volume: việc đó thuộc `local-destroy --remove-data`.
 * - Docker daemon không nói được / metadata not-readable ⇒ fail an toàn, không
 *   xoá gì.
 *
 * Thứ tự trong `CLEANUP_KINDS` là containers TRƯỚC network: `docker network rm`
 * trên network còn active endpoints thất bại ("has active endpoints" — đo
 * thật), nên một orphan set hoàn chỉnh lần đầu chạy sẽ fail ở network nếu
 * containers chưa sạch. Đó KHÔNG phải teardown theo thứ tự phụ thuộc (không có
 * orchestration state, không retry giữa các kind) — chỉ là xếp kind ít lỗi nhất
 * lên trước, vì mỗi kind vẫn được xử lý độc lập.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve, normalize } from 'node:path';

import {
  classifyOwnership,
  LABEL_MANAGED_BY,
  LABEL_MANAGED_BY_VALUE,
  labelsFromInspect,
  OWNERSHIP_LABELS,
  type OwnershipCheck,
} from './deploy-labels.js';
import {
  dockerResourceName,
  normalizeWorktreeRoot,
  type DeployResourceKind,
} from './deploy-namespace.js';
import type { ExecResult } from './pulumi-context.js';

/** Loại resource mà cleanup quét. */
export const POSTGRES_VOLUME_KIND: DeployResourceKind = 'postgres-volume';

export const CLEANUP_KINDS: readonly DeployResourceKind[] = [
  'traefik',
  'postgres',
  'home',
  'network',
  'postgres-volume',
];

export interface CleanupFilter {
  /** Worktree root filter (diagnostics only — không weaken checks). */
  worktreeRoot?: string;
  /** Dry-run: không destructive operation nào. */
  dryRun: boolean;
  env: NodeJS.ProcessEnv;
  /**
   * Test seams — inject thay `execDocker`/`worktreeAlive` để spec chạy logic
   * quyết định mà không cần Docker thật. Default là thật.
   */
  execDocker?: (args: string[], env: NodeJS.ProcessEnv) => ExecResult;
  worktreeAlive?: (path: string) => boolean;
}

export interface CleanupReportEntry {
  kind: DeployResourceKind;
  name: string;
  worktreePath?: string;
  action: 'removed' | 'would-remove' | 'kept' | 'skipped';
  reason: string;
}

export interface CleanupReport {
  entries: CleanupReportEntry[];
  errors: string[];
}

function execDocker(args: string[], env: NodeJS.ProcessEnv): ExecResult {
  try {
    const stdout = execFileSync('docker', args, {
      encoding: 'utf8',
      env,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error: unknown) {
    const e = error as {
      status?: number | null;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      status: typeof e.status === 'number' ? e.status : null,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? '',
    };
  }
}

export function dockerList(
  kind: 'container' | 'network' | 'volume',
  env: NodeJS.ProcessEnv,
  dockerExec: (args: string[], env: NodeJS.ProcessEnv) => ExecResult = execDocker,
): ExecResult {
  const args =
    kind === 'container'
      ? ['container', 'ls', '--all', '--format', '{{.Names}}']
      : kind === 'network'
        ? ['network', 'ls', '--format', '{{.Name}}']
        : ['volume', 'ls', '--format', '{{.Name}}'];
  return dockerExec(args, env);
}

export function dockerInspectLabels(
  kind: 'container' | 'network' | 'volume',
  name: string,
  env: NodeJS.ProcessEnv,
  dockerExec: (args: string[], env: NodeJS.ProcessEnv) => ExecResult = execDocker,
): { labels: Record<string, string>; failure?: string } {
  const result = dockerExec([kind, 'inspect', '--format', '{{json .}}', name], env);
  if (result.status !== 0) {
    return {
      labels: {},
      failure: result.stderr.trim() || result.stdout.trim() || 'docker inspect thất bại',
    };
  }
  let parsed: { Labels?: Record<string, string>; Config?: { Labels?: Record<string, string> } };
  try {
    parsed = JSON.parse(result.stdout.trim()) as typeof parsed;
  } catch {
    return { labels: {}, failure: 'docker inspect trả JSON không parse được' };
  }
  const labels = parsed.Labels ?? parsed.Config?.Labels ?? {};
  return { labels };
}

export function worktreeAlive(worktreePath: string): boolean {
  try {
    return existsSync(worktreePath) && statSync(worktreePath).isDirectory();
  } catch {
    return false;
  }
}

function execDockerRemove(
  kind: 'container' | 'network' | 'volume',
  name: string,
  env: NodeJS.ProcessEnv,
  dockerExec: (args: string[], env: NodeJS.ProcessEnv) => ExecResult = execDocker,
): { ok: boolean; stderr?: string } {
  const cmdArgs =
    kind === 'container'
      ? ['container', 'rm', name]
      : kind === 'network'
        ? ['network', 'rm', name]
        : ['volume', 'rm', name];
  const result = dockerExec(cmdArgs, env);
  if (result.status === 0) return { ok: true };
  return {
    ok: false,
    stderr: result.stderr.trim() || result.stdout.trim() || 'docker rm thất bại',
  };
}

export type CleanupDecisionEntry =
  | { action: 'kept'; reason: string }
  | { action: 'skipped'; reason: string }
  | { action: 'remove' };

export function decideResourceAction(
  kind: DeployResourceKind,
  ownership: OwnershipCheck,
  opts: { worktreeAlive: (path: string) => boolean },
): CleanupDecisionEntry {
  switch (ownership.state) {
    case 'missing':
      return {
        action: 'skipped',
        reason: `không có label ${LABEL_MANAGED_BY}=${LABEL_MANAGED_BY_VALUE} — ngoài quản lý DX`,
      };
    case 'malformed':
      return { action: 'skipped', reason: `metadata không đầy đủ: ${ownership.detail}` };
    case 'unknown':
      return { action: 'skipped', reason: `metadata không đọc được: ${ownership.detail}` };
    case 'owned': {
      const alive = opts.worktreeAlive(ownership.worktreePath);
      if (alive) {
        return { action: 'kept', reason: `worktree còn tồn tại (${ownership.worktreePath})` };
      }
      if (kind === POSTGRES_VOLUME_KIND) {
        return { action: 'kept', reason: 'volume PostgreSQL persistent — cleanup không xoá' };
      }
      return { action: 'remove' };
    }
  }
}

/**
 * Normalize path TRỌN KHÔNG realpath — dùng cho worktree filter khi path không
 * tồn tại (mồ côi). Mirror phần normalize của `normalizeWorktreeRoot` trừ bước
 * `realpathSync`: absolute hóa theo cwd, bỏ trailing sep. KHÔNG dùng cho việc
 * sinh namespace/hash — đó là việc của `normalizeWorktreeRoot` (fail-closed).
 */
function manualNormalize(root: string): string {
  const absolute = resolve(root);
  const normalized = normalize(absolute);
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

export function runLocalCleanup(filter: CleanupFilter): CleanupReport {
  const entries: CleanupReportEntry[] = [];
  const errors: string[] = [];
  const dockerExec = filter.execDocker ?? execDocker;
  const aliveFn = filter.worktreeAlive ?? worktreeAlive;

  // Docker daemon responsiveness check.
  const info = dockerExec(['info', '--format', '{{.ServerVersion}}'], filter.env);
  if (info.status !== 0) {
    return {
      entries,
      errors: [
        'Docker daemon không trả lời — không quét được resource. ' +
          `Chi tiết: ${info.stderr.trim() || info.stdout.trim() || 'docker info thất bại'}`,
      ],
    };
  }

  const aliveCache = new Map<string, boolean>();
  const aliveOnce = (path: string): boolean => {
    let v = aliveCache.get(path);
    if (v === undefined) {
      v = aliveFn(path);
      aliveCache.set(path, v);
    }
    return v;
  };

  // Normalize filter path once. `normalizeWorktreeRoot` THROWS cho path không
  // tồn tại — nhưng use case chính của filter chính là worktree ĐÃ BỊ XOÁ
  // (mồ côi). Vì vậy: path tồn tại → normalize chuẩn (so khớp với label chứa
  // realpath); path KHÔNG tồn tại → normalize thủ công (resolve + normalize,
  // bỏ trailing sep) — so khớp theo cùng quy tắc textual với path label đã ghi.
  // Filter chỉ là diagnostics: nó không bao giờ WEAKEN ownership checks (label
  // sai vẫn bị skip dù filter match), và throw ENOENT ở đây là giết chức năng
  // chứ không phải mất an toàn.
  let filterPath: string | undefined;
  if (filter.worktreeRoot !== undefined) {
    const exists = ((): boolean => {
      try {
        return statSync(filter.worktreeRoot).isDirectory();
      } catch {
        return false;
      }
    })();
    filterPath = exists
      ? normalizeWorktreeRoot(filter.worktreeRoot)
      : manualNormalize(filter.worktreeRoot);
  }

  for (const kind of CLEANUP_KINDS) {
    const dockerType: 'container' | 'network' | 'volume' =
      kind === 'network' ? 'network' : kind === POSTGRES_VOLUME_KIND ? 'volume' : 'container';

    const list = dockerList(dockerType, filter.env, dockerExec);
    if (list.status !== 0) {
      errors.push(
        `docker ${dockerType} ls thất bại: ${list.stderr.trim() || list.stdout.trim() || 'lý do không rõ'}`,
      );
      continue;
    }

    // Pre-filter by `ecoma-` prefix to avoid inspecting every Docker resource
    // on host. Note: this is a PERFORMANCE filter, not a security filter —
    // classification still runs classifyOwnership on every candidate. A resource
    // named `ecoma-...` without ownership labels is still skipped (skipped).
    const names = list.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('ecoma-') && line.endsWith(`-${kind}`));

    for (const name of names) {
      const { labels, failure } = dockerInspectLabels(dockerType, name, filter.env, dockerExec);
      if (failure !== undefined) {
        entries.push({
          kind,
          name,
          action: 'skipped',
          reason: `không inspect được labels (${failure})`,
        });
        continue;
      }
      const ownership = classifyOwnership(labels);
      const decision = decideResourceAction(kind, ownership, { worktreeAlive: aliveOnce });

      if (
        filterPath !== undefined &&
        ownership.state === 'owned' &&
        ownership.worktreePath !== filterPath
      ) {
        entries.push({
          kind,
          name,
          worktreePath: ownership.worktreePath,
          action: 'skipped',
          reason: `ngoài worktree filter (${ownership.worktreePath})`,
        });
        continue;
      }

      if (decision.action === 'remove') {
        if (filter.dryRun) {
          entries.push({
            kind,
            name,
            worktreePath: ownership.state === 'owned' ? ownership.worktreePath : undefined,
            action: 'would-remove',
            reason: 'mồ côi (worktree không còn trên đĩa) — dry-run, không xoá',
          });
          continue;
        }
        const outcome = execDockerRemove(dockerType, name, filter.env, dockerExec);
        if (outcome.ok) {
          entries.push({
            kind,
            name,
            worktreePath: ownership.state === 'owned' ? ownership.worktreePath : undefined,
            action: 'removed',
            reason: 'mồ côi (worktree không còn trên đĩa)',
          });
        } else {
          entries.push({
            kind,
            name,
            action: 'kept',
            reason: `lệnh xoá thất bại: ${outcome.stderr ?? 'lý do không rõ'}`,
          });
          errors.push(`xoá ${dockerType} ${name} thất bại: ${outcome.stderr ?? 'lý do không rõ'}`);
        }
      } else {
        entries.push({
          kind,
          name,
          worktreePath: ownership.state === 'owned' ? ownership.worktreePath : undefined,
          action: decision.action,
          reason: decision.reason,
        });
      }
    }
  }

  return { entries, errors };
}

export function cleanupResourceName(namespace: string, kind: DeployResourceKind): string {
  return dockerResourceName(namespace, kind);
}

export const CLEANUP_OWNERSHIP_LABELS = OWNERSHIP_LABELS;
export const CLEANUP_LABEL_MANAGED_BY = LABEL_MANAGED_BY;
export const CLEANUP_LABEL_MANAGED_BY_VALUE = LABEL_MANAGED_BY_VALUE;
export { labelsFromInspect };
export type { OwnershipCheck };
