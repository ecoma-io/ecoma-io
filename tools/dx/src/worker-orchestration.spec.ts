/**
 * Spec của `worker-orchestration.ts` — PR4 bring up / status / bring down.
 *
 * Test KHÔNG spawn wrangler thật: `wranglerBin` trỏ tới một fake bin (`.sh`
 * exit 0 cho migration path vì `resolveWranglerInvocation` chạy bin không
 * phải `.js` trực tiếp; `.js` exit 0 cho spawn path qua `spawnImpl` fake).
 * Process thật chỉ dùng ở test teardown (`node -e` long-lived child) để
 * chứng minh kill thật sự qua `stopWorkerRuntime`.
 */

import type { ChildProcess, spawn as childSpawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAIL_WORKER_ENTRIES,
  portCandidates,
  resolveWranglerInvocationArgv,
  startWorkerRuntime,
  statusWorkerRuntime,
  stopWorkerRuntime,
} from './worker-orchestration.js';
import { identityHashOf, metadataPathOf, scanWorkerProcesses } from './worker-process.js';

const cleanup: string[] = [];

function makeWorktreeFixture(name: string): string {
  const dir = join(
    tmpdir(),
    `worker-orchestration-spec-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
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

/**
 * Committed config fixture — đủ điều kiện qua `validateCommittedWranglerConfig`
 * (name, main, compatibility_date; KHÔNG account_id; KHÔNG remote:true).
 */
function writeCommittedConfig(dir: string, name: string): string {
  const config = {
    name,
    main: 'dist/main.js',
    compatibility_date: '2026-10-05',
    d1_databases: [{ binding: 'mail', database_name: name.includes('job') ? 'mail-job' : 'mail' }],
  };
  // Cây app fixture: <worktreeRoot>/apps/<name>/wrangler.jsonc — cùng layout
  // với apps thật để `committedConfigPath` tuyệt đối resolve đúng.
  const appDir = join(dir, 'apps', name);
  mkdirSync(appDir, { recursive: true });
  const path = join(appDir, 'wrangler.jsonc');
  writeFileSync(path, JSON.stringify(config), 'utf8');
  return path;
}

/**
 * Fake wrangler migration bin (`.sh`, exit 0) — `resolveWranglerInvocation`
 * chạy bin KHÔNG phải `.js` trực tiếp (không qua node), nên shebang + chmod.
 */
function writeFakeMigrationsBin(dir: string): string {
  const path = join(dir, 'fake-wrangler.sh');
  writeFileSync(path, '#!/bin/sh\nexit 0\n', 'utf8');
  chmodSync(path, 0o755);
  return path;
}

/**
 * Fake spawnImpl trả về child object đủ dùng cho `startWorkerProcess`: event
 * emitter rút gọn + stdout/stderr rỗng. Child mô phỏng "spawn thành công rồi
 * sống mãi" hoặc "in banner rồi sống" tùy fixture.
 */

type Handler = (...args: unknown[]) => void;

class FakeChild {
  pid: number;
  stdout: { on(event: string, cb: (chunk: Buffer) => void): void; resume(): void } | null;
  stderr: { on(event: string, cb: (chunk: Buffer) => void): void; resume(): void } | null;
  exited = false;
  exitCode: number | null = null;
  private spawnHandlers: Handler[] = [];
  private exitHandlers: Handler[] = [];

  constructor(options: { pid: number; stdoutBanners?: string[]; stderrBanners?: string[] }) {
    this.pid = options.pid;
    this.stdout = {
      on: (event, cb) => {
        if (event === 'data' && options.stdoutBanners) {
          for (const banner of options.stdoutBanners) cb(Buffer.from(banner, 'utf8'));
        }
      },
      resume: () => undefined,
    };
    this.stderr = {
      on: (event, cb) => {
        if (event === 'data' && options.stderrBanners) {
          for (const banner of options.stderrBanners) cb(Buffer.from(banner, 'utf8'));
        }
      },
      resume: () => undefined,
    };
  }

  on(event: string, cb: Handler): void {
    if (event === 'spawn') {
      this.spawnHandlers.push(cb);
    } else if (event === 'exit') {
      this.exitHandlers.push(cb);
    }
  }

  /** Kích hoạt event mô phỏng — test gọi trực tiếp. */
  emitSpawn(): void {
    for (const handler of this.spawnHandlers) handler();
  }

  emitExit(code: number): void {
    this.exited = true;
    this.exitCode = code;
    for (const handler of this.exitHandlers) handler(code, null);
  }

  /** Kill thật cho fake pid-kill mô phỏng — là no-op, child không phải process thật. */
  kill(): void {
    this.emitExit(0);
  }
}

interface FakeSpawnCapture {
  children: FakeChild[];
  argvs: string[][];
  envs: NodeJS.ProcessEnv[];
  cwds: (string | undefined)[];
}

function fakeSpawnFactory(
  capture: FakeSpawnCapture,
  opts: { pid: number; stdoutBanners?: string[]; stderrBanners?: string[] },
): typeof childSpawn {
  return ((
    _command: string,
    args: string[],
    options_?: { env?: NodeJS.ProcessEnv; cwd?: string },
  ) => {
    const child = new FakeChild(opts);
    capture.children.push(child);
    capture.argvs.push([_command, ...args]);
    capture.envs.push(options_?.env ?? {});
    capture.cwds.push(options_?.cwd);
    // Spawn event bắn trên microtask — sớm hơn assertion/nhưng SAU khi
    // `startWorkerProcess` attach listener (registration là sync). Dùng
    // setTimeout vẫn đúng thật nhưng khi readiness mock của test resolve
    // without macrotask tick thì event không kịp bắn trước assert.
    queueMicrotask(() => child.emitSpawn());
    return child as unknown as ChildProcess;
  }) as unknown as typeof childSpawn;
}

/**
 * Cho readiness HTTP không bao giờ pass với fake child (không server thật),
 * orchestration sẽ teardown; fake child emit exit khi bị stop? — KHÔNG: fake
 * child không liên kết process thật, `handle.stop` sẽ poll isPidAlive(pid
 * giả) — pid giả thường chết thật. Fake pid dùng giá trị PID đã chết chắc
 * chắn (2147483647) → isPidAlive false → stop no-op → teardown không treo.
 */
const DEAD_PID = 2147483647;

describe('MAIL_WORKER_ENTRIES', () => {
  it('declares the two mail workers in boot order with valid entry names', () => {
    expect(MAIL_WORKER_ENTRIES.map((entry) => entry.entryName)).toEqual([
      'transactional-mail',
      'transactional-mailer-job',
    ]);
    for (const entry of MAIL_WORKER_ENTRIES) {
      expect(entry.entryName).toMatch(/^[A-Za-z0-9._-]+$/u);
    }
  });

  it('control plane readiness is http-health, consumer is log-banner', () => {
    const [control, consumer] = MAIL_WORKER_ENTRIES;
    expect(control.readiness.kind).toBe('http-health');
    expect(consumer.readiness.kind).toBe('log-banner');
  });
});

describe('resolveWranglerInvocationArgv', () => {
  it('.js bin resolves to node + script (worker-config rule)', () => {
    const argv = resolveWranglerInvocationArgv('/x/y/wrangler.js');
    expect(argv[0]).toBe(process.execPath);
    expect(argv[1]).toBe('/x/y/wrangler.js');
  });

  it('non-js bin resolves to direct execution (test fixture path)', () => {
    const argv = resolveWranglerInvocationArgv('/x/y/fake-wrangler.sh');
    expect(argv).toEqual(['/x/y/fake-wrangler.sh']);
  });
});

describe('portCandidates', () => {
  it('is deterministic ascending from the desired port with 10 candidates', () => {
    expect(portCandidates(20000)).toEqual([
      20000, 20001, 20002, 20003, 20004, 20005, 20006, 20007, 20008, 20009,
    ]);
    expect(portCandidates(20000)).toEqual(portCandidates(20000));
  });
});

describe('startWorkerRuntime', () => {
  it('happy path with fake spawnImpl + fake migrations bin: rows, argv, ports recorded', async () => {
    const root = makeWorktreeFixture('happy');
    for (const entry of MAIL_WORKER_ENTRIES) {
      writeCommittedConfig(root, entry.entryName);
    }
    const migrationsBin = writeFakeMigrationsBin(root);

    const capture: FakeSpawnCapture = { children: [], argvs: [], envs: [], cwds: [] };
    // Consumer (entry 2) cần log-banner: stdout banner "Ready on http://...".
    // Entry 1 (control plane) cần HTTP /health — không server thật trong test,
    // nên dùng banner cho CẢ HAI qua stderr fixture... không được: readiness
    // cố định theo entry. Giải pháp: fake child in banner NGAY trên stdout
    // (control plane readiness là HTTP — không đạt → lỗi). Vậy control plane
    // readiness phải bị bỏ qua trong test này — dùng một real HTTP server.
    const banner = 'Ready on http://127.0.0.1:4242';
    const results = [
      new FakeChild({ pid: 4242, stdoutBanners: [banner] }),
      new FakeChild({ pid: 4243, stdoutBanners: [banner] }),
    ];
    let spawnCount = 0;
    const spawnImpl = ((
      _command: string,
      args: string[],
      options_?: { env?: NodeJS.ProcessEnv; cwd?: string },
    ) => {
      const child = results[spawnCount];
      spawnCount += 1;
      capture.argvs.push([_command, ...args]);
      capture.envs.push(options_?.env ?? {});
      capture.cwds.push(options_?.cwd);
      // Cùng quy tắc với fakeSpawnFactory — spawn event trên microtask để
      // pid kịp được ghi trước các assertion (readiness mock resolve không
      // qua macrotask tick nào).
      queueMicrotask(() => child.emitSpawn());
      return child as unknown as ChildProcess;
    }) as unknown as typeof childSpawn;

    // HTTP readiness cho control plane: một server thật trả 200 cho /health,
    // lấy port bất kỳ, rồi patch `dev.port` của generated config về server
    // đó? — orchestration chọn port theo probe+hash trước khi sinh config.
    // Vì thế server phải bind CHÍNH XÁC port orchestration chọn. Cách bền:
    // chạy server trên port 0, rồi cho orchestration dùng namespace hash —
    // không kiểm trước được port. Thay vào đó spawn real server trên port
    // candidate sau khi biết port: dùng hook của orchestration — không có.
    // Cách bền nhất: mock `fetch` toàn cục trả Response.ok trong test này.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    try {
      const result = await startWorkerRuntime({
        worktreeRoot: root,
        wranglerBin: migrationsBin,
        spawnImpl,
      });

      expect(result.workers).toHaveLength(2);
      expect(result.workers[0].entryName).toBe('transactional-mail');
      expect(result.workers[1].entryName).toBe('transactional-mailer-job');
      expect(result.workers[0].pid).toBe(4242);
      expect(result.workers[1].pid).toBe(4243);
      expect(result.workers[0].port).toBeGreaterThan(0);
      expect(result.workers[1].port).toBeGreaterThan(0);
      // Hai port khác nhau (hash theo entry name + scan offset).
      expect(result.workers[0].port).not.toBe(result.workers[1].port);
      // persistTo + configPath theo stateDir của worktree.
      expect(result.persistTo).toBe(join(root, '.worker-local-state'));
      expect(result.workers[0].configPath).toContain(join('.worker-local-state', 'generated'));
      expect(result.namespace).toMatch(/^w[0-9a-f]{12}$/u);

      // Spawn argv: `dev --config <generated> --persist-to <dir>` — KHÔNG
      // có `--port` (generated config đã embed dev.port).
      for (const argv of capture.argvs) {
        expect(argv[0]).toBe(migrationsBin);
        expect(argv[1]).toBe('dev');
        expect(argv).not.toContain('--port');
        const configIndex = argv.indexOf('--config');
        expect(configIndex).toBeGreaterThan(0);
        expect(argv[configIndex + 1]).toContain(join('.worker-local-state', 'generated'));
        expect(argv[configIndex + 1]).not.toContain('apps');
        const persistIndex = argv.indexOf('--persist-to');
        expect(persistIndex).toBeGreaterThan(0);
        expect(argv[persistIndex + 1]).toBe(join(root, '.worker-local-state'));
      }
      // Env là allowlist object — KHÔNG bao giờ là process.env nguyên vẹn.
      for (const env of capture.envs) {
        expect(env).not.toBe(process.env);
        expect(env).toHaveProperty('PATH');
      }
      // cwd là app dir của entry.
      expect(capture.cwds[0]).toContain('transactional-mail');
      expect(capture.cwds[1]).toContain('transactional-mailer-job');

      // fetch được gọi cho control plane readiness.
      expect(fetchSpy).toHaveBeenCalled();
      // Fake children không phải process thật — dọn metadata để không rò.
      for (const entry of MAIL_WORKER_ENTRIES) {
        rmSync(metadataPathOf(join(root, '.worker-local-state'), entry.entryName), { force: true });
      }
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('redistributes the port when a real server holds the desired port busy', async () => {
    const root = makeWorktreeFixture('port-busy');
    for (const entry of MAIL_WORKER_ENTRIES) {
      writeCommittedConfig(root, entry.entryName);
    }
    const migrationsBin = writeFakeMigrationsBin(root);

    // Compute the desired port the same way orchestration does (namespace +
    // entryName hash) so we can hold exactly that port with a real server.
    const { allocateWorkerPort } = await import('./worker-config.js');
    const { normalizeWorktreeRoot, worktreeNamespace } = await import('./deploy-namespace.js');
    const normalized = normalizeWorktreeRoot(root);
    const namespace = worktreeNamespace(normalized);
    const desired = allocateWorkerPort(namespace, 'transactional-mail');

    const holder = createServer();
    await new Promise<void>((resolve) => {
      holder.listen(desired, '127.0.0.1', () => resolve());
    });

    const capture: FakeSpawnCapture = { children: [], argvs: [], envs: [], cwds: [] };
    const banner = 'Ready on http://';
    const spawnImpl = fakeSpawnFactory(capture, { pid: DEAD_PID, stdoutBanners: [banner] });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    try {
      const result = await startWorkerRuntime({
        worktreeRoot: root,
        wranglerBin: migrationsBin,
        spawnImpl,
      });
      // control plane KHÔNG nhận desired port — port bị holder giữ, scan
      // offset kế tiếp phải được chọn.
      expect(result.workers[0].port).not.toBe(desired);
      expect(result.workers[0].port).toBe(desired + 1);
      // Consumer dùng port hash riêng của nó — không đụng desired.
      const desiredJob = allocateWorkerPort(namespace, 'transactional-mailer-job');
      expect(result.workers[1].port).toBe(desiredJob);
      for (const entry of MAIL_WORKER_ENTRIES) {
        rmSync(metadataPathOf(join(root, '.worker-local-state'), entry.entryName), { force: true });
      }
    } finally {
      fetchSpy.mockRestore();
      await new Promise<void>((resolve, reject) => {
        holder.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('migration errors propagate (fail-closed) without spawning anything', async () => {
    const root = makeWorktreeFixture('migration-fail');
    for (const entry of MAIL_WORKER_ENTRIES) {
      writeCommittedConfig(root, entry.entryName);
    }
    // Fake bin exit 3 → runWrangler throw.
    const failingBin = join(root, 'failing-wrangler.sh');
    writeFileSync(failingBin, '#!/bin/sh\necho "boom migration" >&2\nexit 3\n', 'utf8');
    chmodSync(failingBin, 0o755);

    const capture: FakeSpawnCapture = { children: [], argvs: [], envs: [], cwds: [] };
    const spawnImpl = fakeSpawnFactory(capture, { pid: DEAD_PID });

    await expect(
      startWorkerRuntime({ worktreeRoot: root, wranglerBin: failingBin, spawnImpl }),
    ).rejects.toThrow(/boom migration/u);
    // Fail-closed: KHÔNG spawn process nào khi migration chưa pass.
    expect(capture.children).toHaveLength(0);
  });

  it('readiness timeout stops the child, removes metadata and throws with tail', async () => {
    const root = makeWorktreeFixture('readiness-timeout');
    for (const entry of MAIL_WORKER_ENTRIES) {
      writeCommittedConfig(root, entry.entryName);
    }
    const migrationsBin = writeFakeMigrationsBin(root);

    const capture: FakeSpawnCapture = { children: [], argvs: [], envs: [], cwds: [] };
    // Fake child in stderr tail đặc trưng — error message phải chứa nó.
    const spawnImpl = fakeSpawnFactory(capture, {
      pid: DEAD_PID,
      stderrBanners: ['ECONNREFUSED workerd crashed early'],
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('connection refused'));

    try {
      await expect(
        startWorkerRuntime({
          worktreeRoot: root,
          wranglerBin: migrationsBin,
          spawnImpl,
          readiness: { pollIntervalMs: 20, timeoutMs: 120 },
        }),
      ).rejects.toThrow(/transactional-mail.*never became ready/u);
      // Metadata bị dọn sau teardown — không còn entry nào trong stateDir.
      const scan = scanWorkerProcesses(join(root, '.worker-local-state'));
      expect(scan).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('stopWorkerRuntime', () => {
  it('terminates a REAL long-lived child spawned through the real spawn path', async () => {
    const root = makeWorktreeFixture('down-real-kill');
    const stateDir = join(root, '.worker-local-state');
    // startWorkerProcess không mkdir stateDir — spec của worker-process cũng
    // dùng mkdtemp dir làm stateDir sẵn. Tạo tương ứng ở đây.
    mkdirSync(stateDir, { recursive: true });
    const { startWorkerProcess } = await import('./worker-process.js');
    const args = [
      process.execPath,
      '-e',
      'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1 << 28);',
    ];
    const handle = startWorkerProcess({
      name: 'real-child',
      argv: args,
      cwd: root,
      env: {},
      stateDir,
    });
    const deadline = Date.now() + 5000;
    while (handle.pid < 0 && Date.now() < deadline) {
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
    }
    expect(handle.pid).toBeGreaterThan(0);

    const report = await stopWorkerRuntime({ worktreeRoot: root });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      name: 'real-child',
      before: 'alive',
      action: 'terminated',
    });

    // PID thật phải chết sau stop — không để orphan.
    const gone = await waitForPidGone(handle.pid, 5000);
    expect(gone).toBe(true);
    // Metadata cũng đã dọn (down path dọn luôn file sau kill? — theo thiết kế
    // killWorkerProcessByMetadata chỉ kill; scan sau stop không còn file là
    // điều kỳ vọng của down: check bằng scan).
    const scanAfter = scanWorkerProcesses(stateDir);
    expect(scanAfter.find((entry) => entry.name === 'real-child')).toBeUndefined();
  });

  it('cleans stale/unspawned metadata and keeps invalid as evidence', async () => {
    const root = makeWorktreeFixture('down-cleanup');
    const stateDir = join(root, '.worker-local-state');
    mkdirSync(stateDir, { recursive: true });
    // stale: pid chết, identity đầy đủ.
    const staleArgs = [process.execPath, 'gone.js'];
    writeFileSync(
      metadataPathOf(stateDir, 'stale-worker'),
      JSON.stringify({
        version: 1,
        name: 'stale-worker',
        pid: 2147483647,
        argv: staleArgs,
        identityHash: identityHashOf(staleArgs),
        startedAt: 1,
      }),
      'utf8',
    );
    // unspawned: pid 0 shape hợp lệ.
    const unspawnedArgs = [process.execPath, 'unspawned.js'];
    writeFileSync(
      metadataPathOf(stateDir, 'unspawned-worker'),
      JSON.stringify({
        version: 1,
        name: 'unspawned-worker',
        pid: 0,
        argv: unspawnedArgs,
        identityHash: identityHashOf(unspawnedArgs),
        startedAt: 2,
      }),
      'utf8',
    );
    // invalid: file hỏng.
    writeFileSync(metadataPathOf(stateDir, 'corrupt-worker'), '{bad', 'utf8');

    const report = await stopWorkerRuntime({ worktreeRoot: root });
    const byName = new Map(report.rows.map((row) => [row.name, row]));
    expect(byName.get('stale-worker')).toMatchObject({
      before: 'stale',
      action: 'cleaned-metadata',
    });
    expect(byName.get('unspawned-worker')).toMatchObject({
      before: 'unspawned',
      action: 'cleaned-metadata',
    });
    expect(byName.get('corrupt-worker')).toMatchObject({
      before: 'invalid',
      action: 'kept-evidence',
    });
    expect(existsSync(metadataPathOf(stateDir, 'stale-worker'))).toBe(false);
    expect(existsSync(metadataPathOf(stateDir, 'unspawned-worker'))).toBe(false);
    expect(existsSync(metadataPathOf(stateDir, 'corrupt-worker'))).toBe(true);
  });

  it('is idempotent when nothing is up (empty rows, no error)', async () => {
    const root = makeWorktreeFixture('down-empty');
    const report = await stopWorkerRuntime({ worktreeRoot: root });
    expect(report.rows).toEqual([]);
  });
});

describe('statusWorkerRuntime', () => {
  it('returns read-only rows reflecting injected states', async () => {
    const root = makeWorktreeFixture('status-rows');
    const stateDir = join(root, '.worker-local-state');
    mkdirSync(stateDir, { recursive: true });
    const args = [process.execPath, 'x.js'];
    writeFileSync(
      metadataPathOf(stateDir, 'transactional-mail'),
      JSON.stringify({
        version: 1,
        name: 'transactional-mail',
        pid: 999,
        argv: args,
        identityHash: identityHashOf(args),
        startedAt: 1234,
      }),
      'utf8',
    );
    writeFileSync(metadataPathOf(stateDir, 'broken'), 'not json', 'utf8');

    const rows = statusWorkerRuntime({ worktreeRoot: root });
    expect(rows).toHaveLength(2);
    const standard = rows.find((row) => row.name === 'transactional-mail');
    expect(standard).toMatchObject({
      state: 'stale',
      pid: 999,
      startedAt: 1234,
      generatedConfigExists: false,
      standard: true,
    });
    const broken = rows.find((row) => row.name === 'broken');
    expect(broken).toMatchObject({ state: 'invalid', pid: null, startedAt: null, standard: false });
  });
});

function waitForPidGone(pid: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = (): void => {
      try {
        process.kill(pid, 0);
      } catch {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}
