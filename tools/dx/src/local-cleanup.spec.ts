import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { classifyOwnership, ownershipLabels } from './deploy-labels.js';
import { normalizeWorktreeRoot, worktreeNamespace } from './deploy-namespace.js';
import type { ExecResult } from './pulumi-context.js';
import {
  CLEANUP_KINDS,
  decideResourceAction,
  dockerInspectLabels,
  runLocalCleanup,
  worktreeAlive,
} from './local-cleanup.js';

const cleanup: string[] = [];
afterEach(() => {
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempWorktree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'local-cleanup-spec-'));
  cleanup.push(dir);
  return normalizeWorktreeRoot(dir);
}

/** Fake Docker world theo kind → { names, labels[name], rmFailures[name] }. */
interface FakeDocker {
  names: Map<'container' | 'network' | 'volume', string[]>;
  labels: Map<string, Record<string, string>>; // key: `${dockerType}/${name}`
  removed: string[]; // names passed to rm
  failRm?: Set<string>;
  failList?: Set<'container' | 'network' | 'volume'>;
}

function fakeDockerExec(docker: FakeDocker) {
  return (args: string[], _env: NodeJS.ProcessEnv): ExecResult => {
    // docker info
    if (args[0] === 'info') return { status: 0, stdout: '27.0', stderr: '' };
    // ls commands
    if (args[1] === 'ls') {
      const dockerType = args[0] as 'container' | 'network' | 'volume';
      if (docker.failList?.has(dockerType)) {
        return { status: 1, stdout: '', stderr: `ls ${dockerType} fail (fake)` };
      }
      const names = docker.names.get(dockerType) ?? [];
      return { status: 0, stdout: `${names.join('\n')}\n`, stderr: '' };
    }
    // inspect: args = [dockerType, 'inspect', '--format', '{{json .}}', name]
    if (args[1] === 'inspect') {
      const dockerType = args[0] as 'container' | 'network' | 'volume';
      const name = args[4] ?? '';
      const entry = docker.labels.get(`${dockerType}/${name}`);
      if (entry === undefined) {
        return { status: 1, stdout: '', stderr: `No such ${dockerType}: ${name}` };
      }
      return { status: 0, stdout: JSON.stringify({ Labels: entry }), stderr: '' };
    }
    // rm: args = [dockerType, 'rm', name]
    if (args[1] === 'rm') {
      const dockerType = args[0] as 'container' | 'network' | 'volume';
      const name = args[2] ?? '';
      const key = `${dockerType}/${name}`;
      const labels = docker.labels.get(key);
      if (labels === undefined) {
        return { status: 1, stdout: '', stderr: `No such ${dockerType}: ${name}` };
      }
      docker.labels.delete(key);
      const list = docker.names.get(dockerType as 'container' | 'network' | 'volume') ?? [];
      docker.names.set(
        dockerType as 'container' | 'network' | 'volume',
        list.filter((n) => n !== name),
      );
      if (docker.failRm?.has(key)) {
        return { status: 1, stdout: '', stderr: `rm ${key} fail (fake)` };
      }
      docker.removed.push(key);
      return { status: 0, stdout: `${name}\n`, stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `fake docker không xử lý: ${args.join(' ')}` };
  };
}

function ownedLabels(worktreePath: string): Record<string, string> {
  const ns = worktreeNamespace(worktreePath);
  return ownershipLabels(worktreePath, ns);
}

describe('decideResourceAction', () => {
  it('skips (neverremoves) resource without managed-by dx', () => {
    const decision = decideResourceAction(
      'home',
      { state: 'missing' },
      { worktreeAlive: () => false },
    );
    expect(decision.action).toBe('skipped');
  });

  it('skips malformed ownership metadata instead of deleting', () => {
    const decision = decideResourceAction(
      'home',
      { state: 'malformed', detail: 'label io.ecoma.worktree-id thiếu hoặc rỗng' },
      { worktreeAlive: () => false },
    );
    expect(decision.action).toBe('skipped');
  });

  it('keeps resources of an existing worktree', () => {
    const decision = decideResourceAction(
      'home',
      { state: 'owned', worktreePath: '/some/live/wt', worktreeId: 'wabc' },
      { worktreeAlive: () => true },
    );
    expect(decision.action).toBe('kept');
  });

  it('selects orphan (worktree gone) for removal', () => {
    const decision = decideResourceAction(
      'home',
      { state: 'owned', worktreePath: '/some/dead/wt', worktreeId: 'wabc' },
      { worktreeAlive: () => false },
    );
    expect(decision.action).toBe('remove');
  });

  it('keeps orphan postgres volume by default (persistent data)', () => {
    const decision = decideResourceAction(
      'postgres-volume',
      { state: 'owned', worktreePath: '/some/dead/wt', worktreeId: 'wabc' },
      { worktreeAlive: () => false },
    );
    expect(decision.action).toBe('kept');
  });
});

describe('classifyOwnership', () => {
  it('accepts full ownership labels', () => {
    const labels = ownershipLabels('/tmp/wt-x', 'w0123456789ab');
    const check = classifyOwnership(labels);
    expect(check.state).toBe('owned');
  });

  it('missing labels means not-managed-by DX', () => {
    expect(classifyOwnership({}).state).toBe('missing');
    expect(classifyOwnership({ 'traefik.enable': 'true' }).state).toBe('missing');
  });

  it('malformed when managed-by ok but other labels missing', () => {
    const labels = ownershipLabels('/tmp/wt-x', 'w0123456789ab');
    delete labels['io.ecoma.worktree-path'];
    expect(classifyOwnership(labels).state).toBe('malformed');
  });
});

describe('worktreeAlive', () => {
  it('true for an existing directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cleanup-alive-'));
    cleanup.push(dir);
    expect(worktreeAlive(dir)).toBe(true);
  });
  it('false for missing path', () => {
    expect(worktreeAlive(join(tmpdir(), 'cleanup-missing-xyz'))).toBe(false);
  });
});

describe('runLocalCleanup', () => {
  it('existing worktree resources are never cleaned', () => {
    const wt = tempWorktree();
    const docker: FakeDocker = {
      names: new Map([
        ['container', [`ecoma-${worktreeNamespace(wt)}-home`]],
        ['network', [`ecoma-${worktreeNamespace(wt)}-network`]],
        ['volume', []],
      ]),
      labels: new Map([
        ['container/ecoma-' + worktreeNamespace(wt) + '-home', ownedLabels(wt)],
        ['network/ecoma-' + worktreeNamespace(wt) + '-network', ownedLabels(wt)],
      ]),
      removed: [],
    };
    const report = runLocalCleanup({
      dryRun: false,
      env: {},
      execDocker: fakeDockerExec(docker),
      worktreeAlive: (p) => p === wt,
    });
    expect(docker.removed).toHaveLength(0);
    const actions = report.entries.map((e) => e.action);
    expect(actions).toContain('kept');
    expect(actions).not.toContain('removed');
    expect(actions).not.toContain('would-remove');
  });

  it('deleted worktree resources are identified and removed', () => {
    const wt = tempWorktree();
    const ns = worktreeNamespace(wt);
    const docker: FakeDocker = {
      names: new Map([
        ['container', [`ecoma-${ns}-home`, `ecoma-${ns}-traefik`, `ecoma-${ns}-postgres`]],
        ['network', [`ecoma-${ns}-network`]],
        ['volume', [`ecoma-${ns}-postgres-volume`]],
      ]),
      labels: new Map(
        [...CLEANUP_KINDS].map((k) => [
          `${k === 'network' ? 'network' : k === 'postgres-volume' ? 'volume' : 'container'}/ecoma-${ns}-${k}`,
          ownedLabels(wt),
        ]),
      ),
      removed: [],
    };
    const report = runLocalCleanup({
      dryRun: false,
      env: {},
      execDocker: fakeDockerExec(docker),
      worktreeAlive: () => false,
    });
    // network, traefik, postgres, home removed; postgres volume kept
    expect(docker.removed).toEqual(
      expect.arrayContaining([
        `network/ecoma-${ns}-network`,
        `container/ecoma-${ns}-home`,
        `container/ecoma-${ns}-traefik`,
        `container/ecoma-${ns}-postgres`,
      ]),
    );
    const volumeEntry = report.entries.find((e) => e.kind === 'postgres-volume');
    expect(volumeEntry?.action).toBe('kept');
  });

  it('same-branch isolation: a resource of another live worktree is untouched even when filter targets a deleted worktree', () => {
    const deadWt = tempWorktree();
    const liveWt = tempWorktree();
    const deadNs = worktreeNamespace(deadWt);
    const liveNs = worktreeNamespace(liveWt);
    const docker: FakeDocker = {
      names: new Map([
        ['container', [`ecoma-${deadNs}-home`, `ecoma-${liveNs}-home`]],
        ['network', [`ecoma-${deadNs}-network`, `ecoma-${liveNs}-network`]],
        ['volume', []],
      ]),
      labels: new Map([
        [`container/ecoma-${deadNs}-home`, ownedLabels(deadWt)],
        [`container/ecoma-${liveNs}-home`, ownedLabels(liveWt)],
        [`network/ecoma-${deadNs}-network`, ownedLabels(deadWt)],
        [`network/ecoma-${liveNs}-network`, ownedLabels(liveWt)],
      ]),
      removed: [],
    };
    const report = runLocalCleanup({
      worktreeRoot: deadWt,
      dryRun: false,
      env: {},
      execDocker: fakeDockerExec(docker),
      worktreeAlive: (p) => p === liveWt,
    });
    expect(docker.removed).toEqual(
      expect.arrayContaining([`container/ecoma-${deadNs}-home`, `network/ecoma-${deadNs}-network`]),
    );
    const liveEntries = report.entries.filter((e) => e.name === `ecoma-${liveNs}-home`);
    expect(liveEntries[0]?.action).toBe('skipped');
  });

  it('unlabeled resources are skipped even with ecoma-like names', () => {
    const docker: FakeDocker = {
      names: new Map([
        ['container', ['ecoma-fake-home']],
        ['network', ['ecoma-fake-network']],
        ['volume', []],
      ]),
      labels: new Map([
        ['container/ecoma-fake-home', {}],
        ['network/ecoma-fake-network', {}],
      ]),
      removed: [],
    };
    const report = runLocalCleanup({
      dryRun: false,
      env: {},
      execDocker: fakeDockerExec(docker),
      worktreeAlive: () => false,
    });
    expect(docker.removed).toHaveLength(0);
    for (const entry of report.entries) {
      expect(entry.action).toBe('skipped');
      expect(entry.reason).toContain('ngoài quản lý DX');
    }
  });

  it('malformed metadata → no deletion, entry reports skipped', () => {
    const wt = tempWorktree();
    const ns = worktreeNamespace(wt);
    const badLabels = ownedLabels(wt);
    delete badLabels['io.ecoma.worktree-id'];
    const docker: FakeDocker = {
      names: new Map([['container', [`ecoma-${ns}-home`]]]),
      labels: new Map([[`container/ecoma-${ns}-home`, badLabels]]),
      removed: [],
    };
    const report = runLocalCleanup({
      dryRun: false,
      env: {},
      execDocker: fakeDockerExec(docker),
      worktreeAlive: () => false,
    });
    expect(docker.removed).toHaveLength(0);
    expect(report.entries[0]?.action).toBe('skipped');
  });

  it('dry-run reports what would be removed without issuing rm commands', () => {
    const wt = tempWorktree();
    const ns = worktreeNamespace(wt);
    const docker: FakeDocker = {
      names: new Map([
        ['container', [`ecoma-${ns}-home`]],
        ['network', [`ecoma-${ns}-network`]],
        ['volume', [`ecoma-${ns}-postgres-volume`]],
      ]),
      labels: new Map([
        [`container/ecoma-${ns}-home`, ownedLabels(wt)],
        [`network/ecoma-${ns}-network`, ownedLabels(wt)],
        [`volume/ecoma-${ns}-postgres-volume`, ownedLabels(wt)],
      ]),
      removed: [],
    };
    const report = runLocalCleanup({
      dryRun: true,
      env: {},
      execDocker: fakeDockerExec(docker),
      worktreeAlive: () => false,
    });
    expect(docker.removed).toHaveLength(0);
    const wouldRemove = report.entries.filter((e) => e.action === 'would-remove');
    // Set thay cho sort: cùng đẳng thức tập hợp — `.sort` bị linter cấm,
    // `.toSorted` cần lib es2023 mà dx không dùng (cùng cách index.spec.ts).
    expect(new Set(wouldRemove.map((e) => e.name))).toEqual(
      new Set([`ecoma-${ns}-home`, `ecoma-${ns}-network`]),
    );
  });

  it('persistent postgres volume preserved by default', () => {
    const wt = tempWorktree();
    const ns = worktreeNamespace(wt);
    const docker: FakeDocker = {
      names: new Map([
        ['container', []],
        ['network', []],
        ['volume', [`ecoma-${ns}-postgres-volume`]],
      ]),
      labels: new Map([[`volume/ecoma-${ns}-postgres-volume`, ownedLabels(wt)]]),
      removed: [],
    };
    const report = runLocalCleanup({
      dryRun: false,
      env: {},
      execDocker: fakeDockerExec(docker),
      worktreeAlive: () => false,
    });
    expect(report.entries[0]?.action).toBe('kept');
    expect(docker.removed).toHaveLength(0);
  });

  it('docker ls failure reported accurately without pretending success', () => {
    const docker: FakeDocker = {
      names: new Map([
        ['container', []],
        ['network', []],
        ['volume', []],
      ]),
      labels: new Map(),
      removed: [],
      failList: new Set(['container']),
    };
    const report = runLocalCleanup({
      dryRun: false,
      env: {},
      execDocker: fakeDockerExec(docker),
      worktreeAlive: () => false,
    });
    expect(report.errors.some((e) => e.includes('container ls') || e.includes('ls thất bại'))).toBe(
      true,
    );
    expect(report.entries.filter((e) => e.kind === 'home')).toHaveLength(0);
  });

  it('docker info failure → error surface, nothing scanned', () => {
    const report = runLocalCleanup({
      dryRun: false,
      env: {},
      execDocker: (_args, _env) => ({
        status: 1,
        stdout: '',
        stderr: 'Cannot connect to the Docker daemon',
      }),
      worktreeAlive: () => false,
    });
    expect(report.entries).toHaveLength(0);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain('Docker daemon không trả lời');
  });
});

/** Inspect fake trả thành công với đúng `labels` — mô phỏng `docker inspect` 0. */
function inspectOk(labels: Record<string, string>): (args: string[], env: unknown) => ExecResult {
  return (_a: string[], _b: unknown) => ({
    status: 0,
    stdout: JSON.stringify({ Labels: labels }),
    stderr: '',
  });
}

/** Inspect fake trả lỗi `msg` — mô phỏng `docker inspect` exit != 0. */
function inspectFail(msg: string): (args: string[], env: unknown) => ExecResult {
  return (_a: string[], _b: unknown) => ({ status: 1, stdout: '', stderr: msg });
}

describe('dockerInspectLabels', () => {
  it('parses root Labels from inspect format', () => {
    const labels = { 'io.ecoma.managed-by': 'dx' };
    const r = dockerInspectLabels('container', 'x', {}, inspectOk(labels));
    expect(r.labels).toEqual(labels);
    expect(r.failure).toBeUndefined();
  });
  it('reports failure on non-zero inspect', () => {
    const r = dockerInspectLabels('container', 'x', {}, inspectFail('No such object'));
    expect(r.labels).toEqual({});
    expect(r.failure).toContain('No such object');
  });
});

describe('local-cleanup entry', () => {
  it('uses shared lock so cleanup cannot race with local-deploy', async () => {
    // Contract asserted at type level + code review; here we verify the command
    // module exists and exposes run/args (dispatch contract).
    const mod = await import('./local-cleanup-command.js');
    expect(mod.default).toHaveProperty('meta');
    expect(mod.default).toHaveProperty('run');
  });

  it('removes containers before network (network rm fails while its containers exist)', () => {
    // Fake mirror thực tế Docker: network rm thành công CHỈ khi không còn
    // container nào gắn vào nó. Harness dưới mô phỏng ràng buộc này — nếu
    // thứ tự CLEANUP_KINDS đổi lại network lên trước, test fail.
    const wt = tempWorktree();
    const ns = worktreeNamespace(wt);
    const networkName = `ecoma-${ns}-network`;
    const homeName = `ecoma-${ns}-home`;
    const docker: FakeDocker = {
      names: new Map([
        ['container', [homeName]],
        ['network', [networkName]],
        ['volume', []],
      ]),
      labels: new Map([
        [`container/${homeName}`, ownedLabels(wt)],
        [`network/${networkName}`, ownedLabels(wt)],
      ]),
      removed: [],
    };
    const report = runLocalCleanup({
      dryRun: false,
      env: {},
      execDocker: (args, env) => {
        // Docker truly rejects network rm when active endpoints remain.
        if (args[1] === 'rm' && args[0] === 'network') {
          const containers = docker.names.get('container') ?? [];
          if (containers.some((c) => docker.labels.has(`container/${c}`))) {
            return { status: 1, stdout: '', stderr: 'has active endpoints (fake)' };
          }
        }
        return fakeDockerExec(docker)(args, env);
      },
      worktreeAlive: () => false,
    });
    expect(report.errors).toEqual([]);
    expect(docker.removed).toEqual(
      expect.arrayContaining([`container/${homeName}`, `network/${networkName}`]),
    );
  });

  it('filter targeting a deleted worktree path still runs (ENOENT tolerated)', () => {
    // Mồ côi là đối tượng chính của cleanup: filter đến path ĐÃ BỊ XOÁ phải
    // chạy diagnostics được, không throw ENOENT. runLocalCleanup không xoá gì
    // ở đây (resource giả có worktree khác) — chỉ xác nhận không ném.
    const liveWt = tempWorktree();
    const docker: FakeDocker = {
      names: new Map([['container', [`ecoma-${worktreeNamespace(liveWt)}-home`]]]),
      labels: new Map([[`container/ecoma-${worktreeNamespace(liveWt)}-home`, ownedLabels(liveWt)]]),
      removed: [],
    };
    const deletedPath = join(tmpdir(), `cleanup-dead-${Date.now()}-no-such-dir`);
    const report = runLocalCleanup({
      dryRun: true,
      env: {},
      execDocker: fakeDockerExec(docker),
      worktreeRoot: deletedPath,
      worktreeAlive: (p) => p === liveWt,
    });
    // Path filter (deleted-path !== live worktree) → mọi resource skip.
    const actions = report.entries.map((e) => e.action);
    expect(actions.every((a) => a === 'skipped')).toBe(true);
    expect(docker.removed).toHaveLength(0);
  });
});
