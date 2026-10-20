/**
 * Spec của `worker-process.ts` — vòng đời process Worker local.
 *
 * Test giữ unit-test nhanh và deterministic: dùng process thật `node -e` (argv
 * array an toàn, không shell-string) hoặc `spawnImpl` fake cho kịch bản lỗi.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  deleteStaleWorkerMetadata,
  identityHashOf,
  isPidAlive,
  metadataPathOf,
  readMetadata,
  sameIdentity,
  scanWorkerProcesses,
  startWorkerProcess,
  terminateStaleWorker,
  WORKER_STATE_DIR_NAME,
  workerProcessStateDir,
} from './worker-process.js';

const cleanup: string[] = [];

function cleanStateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'worker-process-spec-'));
  cleanup.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of cleanup.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

describe('identityHashOf / sameIdentity', () => {
  it('argv same order → sameIdentity true, different argv → false', () => {
    const a = [process.execPath, '--foo', 'bar'];
    const b = [process.execPath, '--foo', 'bar'];
    const c = [process.execPath, 'bar', '--foo'];
    expect(sameIdentity(a, b)).toBe(true);
    expect(sameIdentity(a, c)).toBe(false);
    expect(sameIdentity(a, [])).toBe(false);
  });

  it('identityHash stable for identical argv, differs for changed argv', () => {
    const base = [process.execPath, 'cli.js', '--port', '8899'];
    const changed = [process.execPath, 'cli.js', '--port', '8898'];
    expect(identityHashOf(base)).toBe(identityHashOf([...base]));
    expect(identityHashOf(base)).not.toBe(identityHashOf(changed));
    expect(identityHashOf(base)).toHaveLength(16);
  });
});

describe('readMetadata', () => {
  it('returns null for nonexistent or corrupt file', () => {
    expect(readMetadata(join(tmpdir(), 'does-not-exist.json'))).toBeNull();
    const dir = cleanStateDir();
    const path = join(dir, 'corrupt.json');
    writeFileSync(path, '{not-json', 'utf8');
    expect(readMetadata(path)).toBeNull();
  });

  it('returns null when pid nonpositive', () => {
    const dir = cleanStateDir();
    const args = [process.execPath, '--flag'];
    const base = {
      version: 1,
      name: 'x',
      argv: args,
      identityHash: identityHashOf(args),
      startedAt: 111,
    };
    for (const pid of [0, -7]) {
      const path = join(dir, `pid-${pid}.json`);
      writeFileSync(path, JSON.stringify({ ...base, pid }), 'utf8');
      expect(readMetadata(path)).toBeNull();
    }
  });

  it('returns null when argv empty or missing identityHash', () => {
    const dir = cleanStateDir();
    const path = join(dir, 'empty.json');
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        name: 'x',
        pid: 999,
        argv: [],
        identityHash: 'abc',
        startedAt: 1,
      }),
      'utf8',
    );
    expect(readMetadata(path)).toBeNull();
    const path2 = join(dir, 'nohash.json');
    writeFileSync(
      path2,
      JSON.stringify({ version: 1, name: 'x', pid: 999, argv: ['node'], startedAt: 1 }),
      'utf8',
    );
    expect(readMetadata(path2)).toBeNull();
  });

  it('accepts a well-formed metadata record', () => {
    const dir = cleanStateDir();
    const path = join(dir, 'good.json');
    const args = [process.execPath, 'main.js'];
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        name: 'worker',
        pid: 123,
        argv: args,
        identityHash: identityHashOf(args),
        startedAt: 42,
      }),
      'utf8',
    );
    const parsed = readMetadata(path);
    expect(parsed).not.toBeNull();
    expect(parsed?.pid).toBe(123);
    expect(parsed?.argv).toEqual(args);
    expect(parsed?.version).toBe(1);
  });
});

describe('isPidAlive', () => {
  it('current process alive; invalid pid treated dead', () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-9)).toBe(false);
    expect(isPidAlive(Number.NaN)).toBe(false);
  });
});

describe('startWorkerProcess', () => {
  it('failed startup (ENOENT): spawnError surfaces, identity metadata stays readable', async () => {
    const dir = cleanStateDir();
    const args = ['definitely-not-a-binary-12345', '--flag'];
    const handle = startWorkerProcess({
      name: 'spawn-fail',
      argv: args,
      cwd: dir,
      env: {},
      stateDir: dir,
    });
    const deadline = Date.now() + 3000;
    while (handle.spawnError === undefined && Date.now() < deadline) {
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
    }
    expect(handle.spawnError).toBeDefined();
    expect(handle.spawnError).toContain('ENOENT');
    expect(handle.exited).toBe(false);
    // pid=0 record survive — caller không kill nhầm điều gì (pid 0 bị loader từ chối).
    const raw = readFileSync(handle.metadataPath, 'utf8');
    const meta = JSON.parse(raw) as { pid: number; identityHash: string; argv: string[] };
    expect(meta.pid).toBe(0);
    expect(meta.identityHash).toBe(identityHashOf(args));
    expect(meta.argv).toEqual(args);
    handle.removeMetadata();
    expect(existsSync(handle.metadataPath)).toBe(false);
  });

  it('early exit: handle captures exit code and resolves onExit', async () => {
    const dir = cleanStateDir();
    const args = [process.execPath, '-e', 'process.exit(7)'];
    const handle = startWorkerProcess({
      name: 'early-exit',
      argv: args,
      cwd: dir,
      env: {},
      stateDir: dir,
    });
    await handle.onExit;
    expect(handle.exited).toBe(true);
    expect(handle.exitCode).toBe(7);
    handle.removeMetadata();
  });

  it('stale metadata detection: identity mismatch rejects kill intent', () => {
    const dir = cleanStateDir();
    const staleArgs = [process.execPath, 'irrelevant.js'];
    const metaPath = metadataPathOf(dir, 'stale');
    writeFileSync(
      metaPath,
      JSON.stringify({
        version: 1,
        name: 'stale',
        pid: process.pid, // pid reuse by an unrelated live process
        argv: staleArgs,
        identityHash: identityHashOf(staleArgs),
        startedAt: 1,
      }),
      'utf8',
    );
    const meta = readMetadata(metaPath);
    expect(meta).not.toBeNull();
    expect(meta?.pid).toBe(process.pid);
    // Caller muốn kill với argv khác → identity mismatch → không kill.
    const killIntent = [process.execPath, 'other.js'];
    expect(sameIdentity(meta?.argv ?? [], killIntent)).toBe(false);
    // Caller kill với argv khớp → identity match → được phép.
    expect(sameIdentity(staleArgs, meta?.argv ?? [])).toBe(true);
  });

  it('shutdown (SIGTERM): terminates a long-running process', async () => {
    const dir = cleanStateDir();
    const handle = startWorkerProcess({
      name: 'term-target',
      argv: [
        process.execPath,
        '-e',
        'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1 << 28);',
      ],
      cwd: dir,
      env: {},
      stateDir: dir,
    });
    const deadline = Date.now() + 5000;
    while (!handle.alive() && Date.now() < deadline) {
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
    }
    expect(handle.alive()).toBe(true);
    await handle.stop(2000);
    expect(handle.alive()).toBe(false);
    handle.removeMetadata();
  });

  it('shutdown is a no-op for a process that already exited', async () => {
    const dir = cleanStateDir();
    const handle = startWorkerProcess({
      name: 'already-exited',
      argv: [process.execPath, '-e', 'process.exit(5)'],
      cwd: dir,
      env: {},
      stateDir: dir,
    });
    await handle.onExit;
    expect(handle.exited).toBe(true);
    await handle.stop(100);
    expect(handle.exitCode).toBe(5);
    handle.removeMetadata();
  });

  it('stop escalates to SIGKILL after timeout for a process ignoring SIGTERM', async () => {
    const dir = cleanStateDir();
    const handle = startWorkerProcess({
      name: 'sigterm-ignore',
      argv: [
        process.execPath,
        '-e',
        'process.on("SIGTERM", () => {}); setInterval(() => {}, 1 << 28);',
      ],
      cwd: dir,
      env: {},
      stateDir: dir,
    });
    const deadline = Date.now() + 5000;
    while (!handle.alive() && Date.now() < deadline) {
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
    }
    expect(handle.alive()).toBe(true);
    await handle.stop(200);
    expect(handle.alive()).toBe(false);
    handle.removeMetadata();
  });

  it('port conflict: second process exits non-zero when port already bound', async () => {
    const dir = cleanStateDir();
    const port = 49000 + Math.floor(Math.random() * 1000);
    const script = `const net=require('node:net');const s=net.createServer();s.on('error',()=>process.exit(98));s.listen(${port},'127.0.0.1');setInterval(()=>{},1<<28);`;
    const holder = startWorkerProcess({
      name: 'port-holder',
      argv: [process.execPath, '-e', script],
      cwd: dir,
      env: {},
      stateDir: dir,
    });
    const readyDeadline = Date.now() + 5000;
    while (!holder.alive() && Date.now() < readyDeadline) {
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
    }
    expect(holder.alive()).toBe(true);

    const second = startWorkerProcess({
      name: 'port-conflict',
      argv: [process.execPath, '-e', script],
      cwd: dir,
      env: {},
      stateDir: dir,
    });
    const conflictDeadline = Date.now() + 5000;
    while (!second.exited && Date.now() < conflictDeadline) {
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
    }
    expect(second.exited).toBe(true);
    expect(second.exitCode).not.toBe(0);
    await holder.stop(1000);
    holder.removeMetadata();
    second.removeMetadata();
  });

  it('timeout: handle.onExit does not resolve before process exits (no premature resolve)', async () => {
    const dir = cleanStateDir();
    const handle = startWorkerProcess({
      name: 'timeout-target',
      argv: [process.execPath, '-e', 'setTimeout(() => process.exit(0), 50);'],
      cwd: dir,
      env: {},
      stateDir: dir,
    });
    let resolved = false;
    const promise = handle.onExit.then(() => {
      resolved = true;
      return undefined;
    });
    // Ngay sau start, process chưa exit → onExit chưa resolve.
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(resolved).toBe(false);
    await promise;
    expect(resolved).toBe(true);
    handle.removeMetadata();
  });

  it('state dir path convention is .worker-local-state under root', () => {
    expect(WORKER_STATE_DIR_NAME).toBe('.worker-local-state');
    expect(workerProcessStateDir('/tmp/worktree')).toBe('/tmp/worktree/.worker-local-state');
  });
});

describe('scanWorkerProcesses / deleteStaleWorkerMetadata / terminateStaleWorker', () => {
  it('scan classifies alive vs stale vs invalid', async () => {
    const dir = cleanStateDir();
    const aliveArgs = [process.execPath, '-e', 'setInterval(() => {}, 1 << 28)'];
    const handle = startWorkerProcess({
      name: 'alive',
      argv: aliveArgs,
      cwd: dir,
      env: {},
      stateDir: dir,
    });
    // wait spawn
    const deadline = Date.now() + 5000;
    while (handle.pid < 0 && Date.now() < deadline) {
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
    }
    // write stale entry with dead pid
    const deadPid = 2147483647;
    writeFileSync(
      metadataPathOf(dir, 'stale'),
      JSON.stringify({
        version: 1,
        name: 'stale',
        pid: deadPid,
        argv: [process.execPath, 'stale.js'],
        identityHash: identityHashOf([process.execPath, 'stale.js']),
        startedAt: 1,
      }),
      'utf8',
    );
    // invalid: corrupt + pid 0
    writeFileSync(metadataPathOf(dir, 'corrupt'), '{bad', 'utf8');
    writeFileSync(
      metadataPathOf(dir, 'zero'),
      JSON.stringify({
        version: 1,
        name: 'zero',
        pid: 0,
        argv: [process.execPath, 'z.js'],
        identityHash: 'x',
        startedAt: 1,
      }),
      'utf8',
    );

    const scan = scanWorkerProcesses(dir);
    const byName = new Map(scan.map((e) => [e.name, e.state]));
    expect(byName.get('alive')).toBe('alive');
    expect(byName.get('stale')).toBe('stale');
    expect(byName.get('corrupt')).toBe('invalid');
    expect(byName.get('zero')).toBe('invalid');

    // deleteStale keeps alive + invalid, removes stale
    const report = deleteStaleWorkerMetadata(dir);
    expect(report.removed).toContain('stale');
    expect(report.kept).toContain('alive');
    expect(report.kept).toContain('corrupt');
    expect(report.kept).toContain('zero');
    expect(existsSync(metadataPathOf(dir, 'stale'))).toBe(false);
    expect(existsSync(metadataPathOf(dir, 'alive'))).toBe(true);
    expect(existsSync(metadataPathOf(dir, 'corrupt'))).toBe(true);

    handle.stop(1000).then(() => handle.removeMetadata());
  });

  it('terminateStaleWorker refuses when identity mismatches or pid alive', () => {
    const dir = cleanStateDir();
    const args = [process.execPath, 'worker.js'];
    writeFileSync(
      metadataPathOf(dir, 'entry'),
      JSON.stringify({
        version: 1,
        name: 'entry',
        pid: process.pid,
        argv: args,
        identityHash: identityHashOf(args),
        startedAt: 1,
      }),
      'utf8',
    );
    // pid alive → null
    expect(terminateStaleWorker(dir, 'entry', args)).toBeNull();
    // identity mismatch even with dead pid: rewrite dead pid
    writeFileSync(
      metadataPathOf(dir, 'entry2'),
      JSON.stringify({
        version: 1,
        name: 'entry2',
        pid: 2147483647,
        argv: args,
        identityHash: identityHashOf(args),
        startedAt: 1,
      }),
      'utf8',
    );
    expect(terminateStaleWorker(dir, 'entry2', [process.execPath, 'other.js'])).toBeNull();
    // corrupt metadata → null
    writeFileSync(metadataPathOf(dir, 'entry3'), '{bad', 'utf8');
    expect(terminateStaleWorker(dir, 'entry3', args)).toBeNull();
    // missing metadata → null
    expect(terminateStaleWorker(dir, 'nope', args)).toBeNull();
  });

  it('terminateStaleWorker sends SIGTERM when stale + identity matches', () => {
    const dir = cleanStateDir();
    const args = [process.execPath, 'worker.js'];
    // pid dead + identity match → true (SIGTERM sent to dead pid ⇒ ESRCH ⇒ treated as done)
    writeFileSync(
      metadataPathOf(dir, 'dead'),
      JSON.stringify({
        version: 1,
        name: 'dead',
        pid: 2147483647,
        argv: args,
        identityHash: identityHashOf(args),
        startedAt: 1,
      }),
      'utf8',
    );
    expect(terminateStaleWorker(dir, 'dead', args)).toBe(true);
  });

  it('scan on nonexistent dir returns empty', () => {
    const dir = join(tmpdir(), 'no-such-worker-state-' + Date.now());
    expect(scanWorkerProcesses(dir)).toEqual([]);
    const r = deleteStaleWorkerMetadata(dir);
    expect(r.removed).toEqual([]);
    expect(r.kept).toEqual([]);
    expect(r.errors).toEqual([]);
  });
});
