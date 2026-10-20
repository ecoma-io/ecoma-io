/**
 * PR4 — orchestration local Worker runtime: bring up / status / bring down
 * runtime hai process của mail bounded context cho MỘT worktree.
 *
 * Topology (đo thật trong PR1 — docs/services/local-platform/04-worker-runtime-spike.md):
 *
 * - control plane `ecoma-transactional-mail` — process `wrangler dev` đầu
 *   tiên, để service binding peer có mặt khi consumer boot (trạng thái
 *   `[connected]` được cập nhật khi peer xuất hiện);
 * - consumer `ecoma-transactional-mailer-job` — process thứ hai, chia sẻ cùng
 *   `--persist-to` (D1 `mail` + `mail-job`, Queue `ecoma-mail-delivery` local).
 *
 * Nguyên tắc giữ từ PR2/PR3 (worker-process.ts / worker-config.ts):
 *
 * - Generated config là đường `--config` duy nhất của `wrangler dev` — KHÔNG
 *   bao giờ truyền committed config. Config đã embed `dev.port`, nên argv
 *   KHÔNG truyền thêm `--port` (hai nguồn port là một chỗ lệch tiềm năng).
 * - Migrations/seeds chỉ chạy `--local` (worker-config.ts fail-closed remote).
 * - Mỗi process có record metadata trong stateDir của worktree; kill chỉ khi
 *   identity khớp — cùng chuẩn fail-closed với `local-lock.ts`.
 * - Readiness là trách nhiệm của orchestration (JSDoc của `startWorkerProcess`
 *   tuyên bố rõ): control plane poll `GET /health`, consumer probe boot banner
 *   trên stdout/stderr.
 * - Secrets KHÔNG BAO GIỜ đi qua argv. Env của subprocess là object allowlist
 *   tường minh — không truyền `process.env` nguyên vẹn.
 */

import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { ROOT_DIR } from './utils.js';
import { normalizeWorktreeRoot, worktreeNamespace } from './deploy-namespace.js';
import { safeUnlinkIfSame } from './local-lock.js';
import {
  allocateWorkerPort,
  applyLocalD1Migrations,
  applyLocalD1Seeds,
  generateWorkerConfig,
  generatedConfigDir,
  loadCommittedWranglerConfig,
  resolveWranglerInvocation,
  sanitizeFileName,
  sanitizedWranglerEnv,
  type GeneratedWorkerConfigResult,
} from './worker-config.js';
import {
  isValidEntryName,
  killWorkerProcessByMetadata,
  metadataPathOf,
  readMetadata,
  scanWorkerProcesses,
  startWorkerProcess,
  workerProcessStateDir,
  type WorkerProcessHandle,
  type WorkerProcessState,
} from './worker-process.js';

// -------------------------------------------------------------------
// Bản đồ Worker chuẩn của PR4
// -------------------------------------------------------------------

/** Probe readiness kiểu HTTP — poll một đường GET tới khi 2xx. */
export interface HttpHealthReadiness {
  kind: 'http-health';
  path: string;
}

/**
 * Probe readiness kiểu log-banner — chờ boot banner trên stdout/stderr.
 *
 * Dùng cho worker KHÔNG expose HTTP. Pattern là một regex tùy entry; pattern
 * mặc định `/ready|listening|http/iu` là PHỎNG ĐOÁN về chuỗi wrangler 4.151
 * in khi dev server sẵn sàng (không chạy được wrangler thật trong unit test
 * để đo chuỗi chính xác — cần verify bằng tay, ghi ở báo cáo PR).
 */
export interface LogBannerReadiness {
  kind: 'log-banner';
  pattern: RegExp;
}

export type WorkerReadiness = HttpHealthReadiness | LogBannerReadiness;

/** Bản mô tả một lệnh của mail graph local thuộc một worktree. */
export interface MailWorkerEntry {
  /** Tên của file metadata trong stateDir — phải pass `isValidEntryName`. */
  entryName: string;
  /** Đường committed wrangler config tuyệt đối (relative với ROOT_DIR). */
  committedConfigPath: string;
  /** `database_name` của D1 — dùng cho `wrangler d1 migrations apply`. */
  databaseName: string;
  /** Thư mục app — là `cwd` của `wrangler dev` process. */
  appDir: string;
  /** Seed files tùy chọn — list rỗng nghĩa là KHÔNG chạy `applyLocalD1Seeds`. */
  seedFiles: string[];
  readiness: WorkerReadiness;
  /** Nhãn ngắn phục vụ báo cáo/error. */
  label: string;
}

/** Control plane — D1 `mail`, expose `/health` (200 không chạm D1/Queue, PR1). */
const TRANSACTIONAL_MAIL_ENTRY: MailWorkerEntry = {
  entryName: 'transactional-mail',
  committedConfigPath: join(ROOT_DIR, 'apps', 'transactional-mail', 'wrangler.jsonc'),
  databaseName: 'mail',
  appDir: join(ROOT_DIR, 'apps', 'transactional-mail'),
  seedFiles: [],
  readiness: { kind: 'http-health', path: '/health' },
  label: 'mail control plane',
};

/**
 * Boot banner chuẩn của Wrangler 4.x khi dev server SẴN SÀNG: dòng
 * `Ready on http://...`. Video banner của failed bind/đang-đ连线 cũng chứa
 * "http", nhưng KHÔNG chứa cụm "Ready on" — pattern này phân biệt được
 * ready-thật khỏi output khởi động sớm (OCR PR #36 medium: pattern
 * `/ready|listening|http/iu` quá rộng, match "http://..." ở bất kỳ dòng
 * nào kể cả banner lỗi bind).
 *
 * Case-sensitive "Ready on" — wrangler in banner này cố định cased (đã
 * đối chiếu output thực tế trong PR1 spike docs §2). Nếu Wrangler đổi
 * banner ở version sau, đây là chỗ duy nhất phải sửa.
 */
const WRANGLER_READY_BANNER = /Ready on http/u;

/** Consumer — D1 `mail-job`, không expose HTTP; readiness qua boot banner. */
const TRANSACTIONAL_MAILER_JOB_ENTRY: MailWorkerEntry = {
  entryName: 'transactional-mailer-job',
  committedConfigPath: join(ROOT_DIR, 'apps', 'transactional-mailer-job', 'wrangler.jsonc'),
  databaseName: 'mail-job',
  appDir: join(ROOT_DIR, 'apps', 'transactional-mailer-job'),
  seedFiles: [],
  readiness: { kind: 'log-banner', pattern: WRANGLER_READY_BANNER },
  label: 'mail delivery worker',
};

/**
 * Thứ tự boot cố định: control plane TRƯỚC consumer (service binding peer
 * phải có mặt khi consumer boot — evidence PR1). Cùng thứ tự này áp cho
 * `stop` (teardown theo thứ tự boot ngược — consumer trước).
 */
export const MAIL_WORKER_ENTRIES: readonly MailWorkerEntry[] = [
  TRANSACTIONAL_MAIL_ENTRY,
  TRANSACTIONAL_MAILER_JOB_ENTRY,
];

// -------------------------------------------------------------------
// Port probe + allocation
// -------------------------------------------------------------------

const PORT_PROBE_HOST = '127.0.0.1';

/**
 * Probe port trên loopback: `listen()` rồi `close()` ngay.
 *
 * Bind thành công + close là tiêu chuẩn chặt nhất để chắc chắn wrangler dev
 * sau đó có thể bind. Mọi `error` trong listen (EADDRINUSE, EACCES...) →
 * không free.
 */
export function isPortFreeOnLoopback(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => {
      try {
        server.close();
      } catch {
        // ignore — server failed before listen anyway
      }
      resolve(false);
    });
    server.listen(port, PORT_PROBE_HOST, () => {
      try {
        server.close();
      } catch {
        // ignore
      }
      resolve(true);
    });
  });
}

const MAX_PORT_CANDIDATES = 10;

/**
 * Dãy candidate port cho một entry: port mong muốn trước, rồi `+1..+9`.
 *
 * Thứ tự scan là DETERMINISTIC (offset tăng dần từ port theo namespace/worker
 * name) — cùng worktree, cùng lần chạy ra cùng kết quả, và hai worktree khác
 * nhau chọn port khác nhau ngay từ candidate đầu nhờ port hash theo
 * (namespace, worker name) của `worker-config.ts`.
 */
export function portCandidates(desiredPort: number): number[] {
  return Array.from({ length: MAX_PORT_CANDIDATES }, (_, offset) => desiredPort + offset);
}

// -------------------------------------------------------------------
// Spawn argv + env allowlist
// -------------------------------------------------------------------

/**
 * Sinh argv[0..k] (executable + script) của wrangler CLI — dẫn xuất từ
 * `resolveWranglerInvocation` của `worker-config.ts` (export dùng chung,
 * OCR PR #36 low: tái hiện logic heuristic ở hai nơi là dễ drift khi
 * quy tắc native-binary thay đổi). Chỉ mapping dạng data, không lặp logic.
 */
export function resolveWranglerInvocationArgv(wranglerBin?: string): string[] {
  const { command, prefix } = resolveWranglerInvocation(wranglerBin);
  return [command, ...prefix];
}

/**
 * Env allowlist cho `wrangler dev` subprocess — KHÔNG BAO GIỜ truyền
 * `process.env` nguyên vẹn (secrets cloud credentials... có thể rò rỉ qua).
 *
 * Tái sử dụng `sanitizedWranglerEnv` của `worker-config.ts` (cùng allowlist,
 * cùng cơ chế cô lập HOME/USERPROFILE/XDG_CONFIG_HOME vào thư mục theo
 * persist dir) — OCR PR #36 security high: hai bản copy dễ drift và đường
 * `wrangler dev` (process sống lâu nhất, outbound network) phải áp cùng cơ
 * chế không thấy cached OAuth token `~/.wrangler` của developer.
 */
function buildWranglerEnv(persistTo: string): NodeJS.ProcessEnv {
  return sanitizedWranglerEnv(persistTo);
}

/**
 * Argv env-file của một entry: `--env-file <appDir>/.dev.vars` khi file tồn
 * tại, trả `[]` khi không.
 *
 * Lý do dùng `--env-file` thay vì copy `.dev.vars` sang generated config dir:
 * `wrangler dev` resolve `.dev.vars` mặc định theo **dirname của config file**
 * — generated config nằm ở `<stateDir>/generated/` CHUNG cho mọi entry, copy
 * sẽ khiến dev.vars của entry sau đè của entry trước (hai entry cần env khác
 * nhau). `--env-file` trỏ tường minh đúng file của app nên mỗi entry đọc env
 * của chính nó, còn generated config dùng chung một thư mục vẫn ổn.
 */
export function devVarsArgv(appDir: string): string[] {
  const devVarsPath = join(appDir, '.dev.vars');
  if (!existsSync(devVarsPath)) return [];
  return ['--env-file', devVarsPath];
}

// -------------------------------------------------------------------
// Bounded output buffer (readiness + tail error path)
// -------------------------------------------------------------------

const MAX_OUTPUT_BYTES = 192 * 1024;

/**
 * Buffer byte có giới hạn — giữ TAIL (bỏ phần đầu khi quá giới hạn), vì
 * failure path chỉ cần vài trăm bytes cuối của stderr/stdout.
 */
class BoundedBuffer {
  private chunks: Buffer[] = [];
  private total = 0;

  append(chunk: Buffer): void {
    if (chunk.length === 0) return;
    // Giới hạn chunk đơn ngay từ đầu (OCR PR #36 low): một event 'data' siêu
    // dài vượt MAX_OUTPUT_BYTES sẽ được trim ngay — nếu không, giới hạn
    // "bounded" chỉ đúng khi data tới thành nhiều chunk nhỏ.
    const trimmed =
      chunk.length > MAX_OUTPUT_BYTES ? chunk.subarray(chunk.length - MAX_OUTPUT_BYTES) : chunk;
    this.chunks.push(trimmed);
    this.total += trimmed.length;
    while (this.total > MAX_OUTPUT_BYTES && this.chunks.length > 1) {
      const removed = this.chunks.shift() as Buffer;
      this.total -= removed.length;
    }
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

interface Drainable {
  on(event: 'data', cb: (chunk: Buffer) => void): unknown;
  on(event: 'error', cb: (error: Error) => void): unknown;
  removeAllListeners(event?: string): unknown;
  destroy?(): void;
}

/**
 * Drain một stream Readable vào bounded buffer — pipe không thể deadlock.
 *
 * Listener 'data' giữ stream là active handle của event loop:READ streams
 * của process con đang sống khiến CLI caller không exit được (detached
 * spawn KHÔNG tự giải phóng parent-side pipe). Vì vậy mỗi khi buffer cách
 * xả xong — readiness đạt (up-path) hay entry bị dừng (down-path) — caller
 * phải gọi releaseDrain để removeAllListeners + destroy() stream, event
 * loop mới rảnh để CLI exit (OCR high finding trên PR #36: `pnpm dx
 * local-worker-up` treo vĩnh viễn vì parent giữ read-end pipe).
 */
/** Listener stream lỗi no-op — đơn giản là "giữ những gì đã xả được, không crash". */
function onDrainError(): void {
  // Stream error không crash runtime — buffer giữ những gì đã có.
}

function drainInto(stream: Drainable | null, buffer: BoundedBuffer): () => void {
  if (!stream) return () => undefined;
  const onData = (chunk: Buffer): void => {
    buffer.append(chunk);
  };
  try {
    stream.on('data', onData);
    stream.on('error', onDrainError);
  } catch {
    // ignore — stream đã đóng
  }
  return () => {
    try {
      stream.removeAllListeners('data');
      stream.removeAllListeners('error');
      // destroy() đóng read-end pipe phía parent; workerd side nhận EPIPE /
      // EOF bình thường khi viết tiếp — wrangler tự xử lý stdout đứt.
      (stream as { destroy?: () => void }).destroy?.();
    } catch {
      // ignore — stream có thể đã đóng rồi
    }
  };
}

// -------------------------------------------------------------------
// startWorkerRuntime
// -------------------------------------------------------------------

export interface StartWorkerRuntimeOptions {
  /** Worktree root — namespace/state/persist dir dưới root này. */
  worktreeRoot: string;
  /** Wrangler bin tường minh — mặc định `node_modules/wrangler/bin/wrangler.js`. */
  wranglerBin?: string;
  /** Tuning của readiness poll — default 250ms poll, 60s timeout. */
  readiness?: {
    pollIntervalMs?: number;
    timeoutMs?: number;
  };
  /** Test seam — thay spawn thật của `startWorkerProcess` trong unit test. */
  spawnImpl?: typeof import('node:child_process').spawn;
}

/** Row kết quả của một Worker sau khi boot. */
export interface WorkerRuntimeRow {
  entryName: string;
  port: number;
  pid: number;
  configPath: string;
  persistTo: string;
}

export interface StartWorkerRuntimeResult {
  namespace: string;
  persistTo: string;
  workers: WorkerRuntimeRow[];
}

const DEFAULT_READINESS_POLL_MS = 250;
const DEFAULT_READINESS_TIMEOUT_MS = 60_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const TAIL_BYTES = 400;

function tailOf(buffer: BoundedBuffer): string {
  const text = buffer.text();
  return text.length > TAIL_BYTES ? text.slice(-TAIL_BYTES) : text;
}

/**
 * Lý do fail-closed khi readiness không thể thành công nữa, hoặc `null` khi
 * còn phải poll. Dựa trên `exitCode`/`exitSignal`/`spawnError` — tức event
 * `exit`/`error` đã bắn TRONG process này — không dựa trên `isPidAlive`: pid
 * của child có thể dường như chết (`EPERM`, sandbox, noise) mà child thật sự
 * vẫn sống, và polling liveness làm readiness giả chết trong môi trường hạn
 * chế. Khi child thật chết, event `exit` luôn bắn synchronously nên độ trễ
 * phát hiện không tăng so với việc thay liveness.
 */
function readinessExitReason(handle: WorkerProcessHandle): string | null {
  if (handle.exitCode !== null || handle.exitSignal !== null) {
    return `process exited during readiness (exitCode=${String(handle.exitCode)}, signal=${String(handle.exitSignal)})`;
  }
  if (handle.spawnError !== undefined) {
    return `spawn failed during readiness (spawnError=${String(handle.spawnError)})`;
  }
  return null;
}

/** Readiness HTTP: poll `GET http://127.0.0.1:<port><path>` tới 2xx. */
async function waitForHttpReady(options: {
  handle: WorkerProcessHandle;
  port: number;
  path: string;
  pollIntervalMs: number;
  timeoutMs: number;
}): Promise<void> {
  const url = `http://127.0.0.1:${options.port}${options.path}`;
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    if (Date.now() >= deadline) {
      throw new Error(`readiness timeout after ${options.timeoutMs}ms — ${url} never returned 2xx`);
    }
    // Fail-fast khi child đã chết hoặc spawn đã lỗi (OCR PR #36 medium):
    // không đốt nốt timeout cho child không thể ready — exitCode/signal/
    // spawnError là nguyên nhân thật, poll tiếp chỉ che nó.
    const exitReason = readinessExitReason(options.handle);
    if (exitReason !== null) throw new Error(exitReason);
    try {
      // AbortSignal per-request: một conn treo không ăn vào deadline tổng.
      const response = await fetch(url, { signal: AbortSignal.timeout(options.pollIntervalMs) });
      if (response.ok) return;
    } catch {
      // chưa ready — poll tiếp theo
    }
    await sleep(options.pollIntervalMs);
  }
}

/** Readiness log-banner: chờ pattern trên stdout+stderr buffer. */
async function waitForLogBanner(options: {
  pattern: RegExp;
  stdout: BoundedBuffer;
  stderr: BoundedBuffer;
  handle: WorkerProcessHandle;
  pollIntervalMs: number;
  timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    const combined = `${options.stdout.text()}\n${options.stderr.text()}`;
    if (options.pattern.test(combined)) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `readiness timeout after ${options.timeoutMs}ms — boot banner ` +
          `${options.pattern.source} never matched on stdout/stderr`,
      );
    }
    // Fail-fast: child chết giữa readiness là nguyên nhân thật — báo ngay
    // thay vì chờ hết timeout (cùng lý do với waitForHttpReady).
    const exitReason = readinessExitReason(options.handle);
    if (exitReason !== null) throw new Error(exitReason);
    await sleep(options.pollIntervalMs);
  }
}

/**
 * Bring up runtime hai process chuẩn (control plane + consumer) cho worktree.
 *
 * Thứ tự cho mỗi entry (control plane trước để service binding peer có sẵn):
 *
 * 1. `generateWorkerConfig` — sinh config runtime từ committed config, embed
 *    `dev.port`; probe port TRƯỚC khi spawn, fallback scan `+1..+9`, ghi port
 *    thực dùng vào row kết quả.
 * 2. `applyLocalD1Migrations` — fail-closed local-only (worker-config.ts).
 * 3. `applyLocalD1Seeds` — chỉ khi caller truyền seed files (các entry chuẩn
 *    ở PR này list rỗng).
 * 4. `startWorkerProcess` — spawn `wrangler dev` argv array không shell
 *    string; env là allowlist object. Readiness thuộc trách nhiệm lớp này
 *    (`startWorkerProcess` không đợi): poll HTTP hoặc log-banner; timeout
 *    throw một fail-closed error kèm tail stderr sau `handle.stop()`.
 *
 * Throws (fail-closed): missing committed config, migration error, no free
 * port, readiness timeout. Runtime tương ứng KHÔNG lên đủ hai process —
 * caller dùng `stopWorkerRuntime` để teardown partial state một cách an toàn.
 */
export async function startWorkerRuntime(
  options: StartWorkerRuntimeOptions,
): Promise<StartWorkerRuntimeResult> {
  const worktreeRoot = normalizeWorktreeRoot(options.worktreeRoot);
  const namespace = worktreeNamespace(worktreeRoot);
  const stateDir = workerProcessStateDir(worktreeRoot);
  const persistTo = stateDir;
  const pollIntervalMs = options.readiness?.pollIntervalMs ?? DEFAULT_READINESS_POLL_MS;
  const timeoutMs = options.readiness?.timeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;

  // Idempotency guard (OCR PR #36 medium): runtime đang sống thì từ chối up
  // NGAY TỪ ĐẦU — nếu không, flow thứ hai sẽ regenerate config đè file của
  // runtime sống (port shifted), chạy migrations lại trên persist dir chia
  // sẻ, rồi mới bị startWorkerProcess từ chối với message mơ hồ. Scan một
  // lần trước mọi tác động là đủ, và message chỉ thẳng cách khắc phục.
  const aliveEntries = scanWorkerProcesses(stateDir).filter(
    (candidate) =>
      candidate.state === 'alive' &&
      MAIL_WORKER_ENTRIES.some((standard) => standard.entryName === candidate.name),
  );
  if (aliveEntries.length > 0) {
    throw new Error(
      `local worker runtime đã chạy (alive: ${aliveEntries.map((e) => e.name).join(', ')}) — ` +
        'dùng `pnpm dx local-worker-status` để xem, hoặc `pnpm dx local-worker-down` trước khi up lại',
    );
  }

  const rows: WorkerRuntimeRow[] = [];
  for (const entry of MAIL_WORKER_ENTRIES) {
    if (!isValidEntryName(entry.entryName)) {
      throw new Error(`invalid entry name ${entry.entryName} — tightening stateDir entry`);
    }

    // 1. Probe port mong muốn trước khi sinh config; nếu bận thì thử offset
    //    tăng dần (tối đa MAX_PORT_CANDIDATES), rồi sinh config với port
    //    DÙNG CUỐI — chính là port được ghi vào row kết quả.
    const desiredPort = allocateWorkerPortFor(worktreeRoot, entry.entryName);
    let generated: GeneratedWorkerConfigResult | undefined;
    let finalPort: number | undefined;
    for (let offset = 0; offset < MAX_PORT_CANDIDATES; offset += 1) {
      const candidate = desiredPort + offset;
      if (await isPortFreeOnLoopback(candidate)) {
        generated = generateWorkerConfig({
          worktreeRoot,
          committedConfigPath: entry.committedConfigPath,
          port: candidate,
        });
        finalPort = candidate;
        break;
      }
    }
    if (generated === undefined || finalPort === undefined) {
      throw new Error(
        `no free port found for worker '${entry.entryName}': probed ${MAX_PORT_CANDIDATES} ` +
          `ports starting at ${desiredPort} on 127.0.0.1 — free one up or reduce running worktrees`,
      );
    }

    // 2. Migration local (fail-closed remote).
    applyLocalD1Migrations({
      configPath: generated.configPath,
      databaseName: entry.databaseName,
      persistTo: generated.persistTo,
      wranglerBin: options.wranglerBin,
      cwd: entry.appDir,
    });

    // 3. Seeds — CHỈ khi caller truyền list khác rỗng.
    if (entry.seedFiles.length > 0) {
      applyLocalD1Seeds({
        configPath: generated.configPath,
        databaseName: entry.databaseName,
        persistTo: generated.persistTo,
        seedFiles: entry.seedFiles,
        wranglerBin: options.wranglerBin,
        cwd: entry.appDir,
      });
    }

    const devVars = devVarsArgv(entry.appDir);

    // 4. Spawn — argv cố định: `dev --config <generated> --persist-to <dir>`
    //    (+ `--env-file` khi app có `.dev.vars`). KHÔNG có `--port` —
    //    generated config đã embed `dev.port`.
    const argv = [
      ...resolveWranglerInvocationArgv(options.wranglerBin),
      'dev',
      '--config',
      generated.configPath,
      '--persist-to',
      generated.persistTo,
      ...devVars,
    ];
    const stdout = new BoundedBuffer();
    const stderr = new BoundedBuffer();
    const handle = startWorkerProcess({
      name: entry.entryName,
      argv,
      cwd: entry.appDir,
      env: buildWranglerEnv(generated.persistTo),
      stateDir,
      spawnImpl: options.spawnImpl,
    });
    // Release callbacks: gọi sau khi readiness đạt (stream không còn cần cho
    // buffer) — không release thì event loop của CLI giữ read-end pipe
    // và `local-worker-up` không exit được dù process con detached.
    const releaseStdout = drainInto(handle.stdout as unknown as Drainable | null, stdout);
    const releaseStderr = drainInto(handle.stderr as unknown as Drainable | null, stderr);

    try {
      if (entry.readiness.kind === 'http-health') {
        await waitForHttpReady({
          handle,
          port: finalPort,
          path: entry.readiness.path,
          pollIntervalMs,
          timeoutMs,
        });
      } else {
        await waitForLogBanner({
          pattern: entry.readiness.pattern,
          stdout,
          stderr,
          handle,
          pollIntervalMs,
          timeoutMs,
        });
      }
    } catch (error) {
      // Fail-closed: teardown process trước khi throw để không để orphan.
      await teardownFailedWorker(handle);
      releaseStdout();
      releaseStderr();
      const message = error instanceof Error ? error.message : String(error);
      const stderrTail = tailOf(stderr);
      throw new Error(
        `worker '${entry.entryName}' (${entry.label}) never became ready: ${message}` +
          (stderrTail.length > 0 ? ` — stderr tail: ${JSON.stringify(stderrTail)}` : ''),
        { cause: error },
      );
    }

    // Ready — stream không còn nhu cầu giữ active handle: release để event
    // loop rảnh và CLI exit đúng "spawn detached — CLI exit 0, process tree
    // sống tiếp" (OCR high finding). Chỉ giữ bằng chứng giới hạn log streams
    // đó là đủ; wrangler dev vẫn chạy độc lập.
    releaseStdout();
    releaseStderr();

    rows.push({
      entryName: entry.entryName,
      port: finalPort,
      pid: handle.pid,
      configPath: generated.configPath,
      persistTo: generated.persistTo,
    });
  }

  return { namespace, persistTo, workers: rows };
}

/**
 * Port đầu tiên đề xuất cho một entry — hash qua `allocateWorkerPort` của
 * `worker-config.ts` với cặp (namespace, entryName).
 *
 * LƯU Ý INVARIANT (OCR PR #36 low): hash input là entryName
 * (`transactional-mail`), KHÔNG phải `generated.name`
 * (`ecoma-transactional-mail`) — hai chuỗi khác nhau nên candidate đầu của
 * orchestration KHÔNG trùng port mà config tự cấp khi không truyền `port`.
 * Hiện KHÔNG gây lỗi runtime vì `generateWorkerConfig` luôn được truyền
 * `port` tường minh từ đây (port một nguồn duy nhất); nếu refactor sang
 * "tin port tự cấp" thì phải đổi hash input theo `generated.name` ở đây.
 */
export function allocateWorkerPortFor(worktreeRoot: string, entryName: string): number {
  return allocateWorkerPort(worktreeNamespace(worktreeRoot), entryName);
}

/**
 * Teardown một worker vừa boot thất bại: `stop()`; metadata CHỈ được remove
 * khi process được XÁC NHẬN đã chết — nếu stop không kill được (SIGTERM/SIGKILL
 * bị chặn, "did not terminate"), xoá metadata tức xoá bằng chứng PID/argv DUY
 * NHẤT trên đĩa, process còn sống thành orphan vô minh mà `stopWorkerRuntime`
 * (scan file-driven) không thể nào tìm thấy (OCR PR #36 medium).
 *
 * Lỗi throw bên trong được nuốt — error gốc từ readiness vẫn là error chính.
 */
async function teardownFailedWorker(handle: WorkerProcessHandle): Promise<void> {
  try {
    await handle.stop(2000);
  } catch {
    // SIGKILL bên trong cũng có thể fail — best-effort cleanup.
  }
  if (handle.exited || !handle.alive()) {
    handle.removeMetadata();
  }
  // Process chưa được chứng minh chết → giữ metadata làm bằng chứng cho
  // `stopWorkerRuntime` (down sau đó vẫn kill được qua scan + identity guard).
}

// -------------------------------------------------------------------
// stopWorkerRuntime
// -------------------------------------------------------------------

export type StopAction = 'terminated' | 'cleaned-metadata' | 'kept-evidence';

export interface StopWorkerRuntimeRow {
  /** Tên metadata entry — có thể là tên ngoài `MAIL_WORKER_ENTRIES`. */
  name: string;
  /** Trạng thái ngay trước khi xử lý entry (lúc scan đầu run). */
  before: WorkerProcessState;
  /** Hành động đã thực. */
  action: StopAction;
  /** Chi tiết khi action=kept-evidence (lý do fail-closed). */
  error?: string;
  /** Trạng thái sau xử lý (scan lại) — undefined khi file đã được dọn. */
  after?: WorkerProcessState;
  /** PID từ metadata lúc scan — thông tin điều tra, không phải lệnh. */
  pid?: number;
}

export interface StopWorkerRuntimeReport {
  rows: StopWorkerRuntimeRow[];
}

const STOP_TIMEOUT_MS = 10_000;

/**
 * Bring down runtime cho worktree: scan stateDir, kill process sống khi bằng
 * chứng identity đầy đủ, dọn metadata mồ côi, giữ file hỏng làm bằng chứng.
 *
 * Quy tắc per-state:
 *
 * - `alive`: yêu cầu metadata hợp lệ + identity argv khớp + cmdline khớp —
 *   BẤT KỲ điều kiện nào fail là KHÔNG kill, row `kept-evidence`.
 * - `stale`/`unspawned`: dọn FILE metadata per-entry theo safe-unlink pattern
 *   của `local-lock.ts` (so snapshot lúc scan với nội dung trước khi xoá) —
 *   PID đã chết, không có process để kill, chỉ dọn bằng chứng mồ côi.
 * - `invalid`: GIỮ file làm bằng chứng — row `kept-evidence`.
 *
 * Lỗi từng entry không abort toàn bộ run: report từng row kết quả. Idempotent:
 * chạy khi chưa có gì up → rows rỗng, không lỗi.
 */
export async function stopWorkerRuntime(options: {
  worktreeRoot: string;
}): Promise<StopWorkerRuntimeReport> {
  const stateDir = workerProcessStateDir(normalizeWorktreeRoot(options.worktreeRoot));
  const rows: StopWorkerRuntimeRow[] = [];

  for (const scanEntry of scanWorkerProcesses(stateDir)) {
    const row: StopWorkerRuntimeRow = {
      name: scanEntry.name,
      before: scanEntry.state,
      action: 'kept-evidence',
    };
    try {
      if (scanEntry.state === 'alive') {
        // Đọc lại metadata từ FILE ngay trước khi kill: nếu file đã bị thay
        // giữa scan và stop thì các guard identity bên trong
        // `killWorkerProcessByMetadata` (tự re-read) chặn lại, và row trở
        // thành kept-evidence với lý do rõ — không throw, không kill mù.
        const metadata = readMetadata(metadataPathOf(stateDir, scanEntry.name));
        if (metadata === null) {
          row.action = 'kept-evidence';
          row.error = 'metadata became unreadable between scan and stop';
        } else {
          const outcome = await killWorkerProcessByMetadata({
            metadataPath: metadataPathOf(stateDir, scanEntry.name),
            expectedArgv: metadata.argv,
            timeoutMs: STOP_TIMEOUT_MS,
          });
          if (outcome.result === 'done') {
            // Kill thành công — dọn metadata bằng safe-unlink (OCR PR #36
            // medium: rmSync mù là TOCTOU — giữa scan/kill/rmSync một `up`
            // đồng thời có thể vừa ghi metadata của process mới cùng entry
            // name; xoá mù orphan nó — mất bằng chứng PID). So snapshot
            // scan với nội dung trước khi unlink — file bị ghi đè giữa
            // chừng không bị dọn nhầm, y như nhánh stale bên dưới.
            const snapshot = scanEntry.rawContent;
            if (snapshot === undefined) {
              row.action = 'kept-evidence';
              row.error = 'metadata vanished between scan and stop';
            } else if (
              safeUnlinkIfSame(metadataPathOf(stateDir, scanEntry.name), snapshot) ||
              !existsSync(metadataPathOf(stateDir, scanEntry.name))
            ) {
              row.action = 'terminated';
            } else {
              row.action = 'kept-evidence';
              row.error = 'metadata changed between scan and stop — not removed';
            }
          } else {
            row.action = 'kept-evidence';
            row.error = outcome.reason;
          }
        }
      } else if (scanEntry.state === 'stale' || scanEntry.state === 'unspawned') {
        // Dọn CHÍNH entry này, xoá chỉ khi nội dung không đổi giữa scan và
        // unlink (safe-unlink pattern của `local-lock.ts`: so snapshot với
        // content trước khi xoá — metadata bị ghi đè giữa chừng không bị dọn
        // nhầm). Gọi hàm bulk `deleteStaleWorkerMetadata` ở đây là SAI: nó
        // quét lại toàn bộ stateDir mỗi vòng lặp, các entry xử lý trước đã
        // bị dọn rồi sẽ bị báo kept-evidence nhầm.
        const snapshot = scanEntry.rawContent;
        if (snapshot === undefined) {
          row.action = 'kept-evidence';
          row.error = 'metadata vanished between scan and stop';
        } else {
          try {
            if (
              safeUnlinkIfSame(metadataPathOf(stateDir, scanEntry.name), snapshot) ||
              !existsSync(metadataPathOf(stateDir, scanEntry.name))
            ) {
              row.action = 'cleaned-metadata';
            } else {
              row.action = 'kept-evidence';
              row.error = 'metadata changed between scan and stop — not removed';
            }
          } catch (removeError) {
            row.action = 'kept-evidence';
            row.error = removeError instanceof Error ? removeError.message : String(removeError);
          }
        }
      }
      // invalid → giữ nguyên action 'kept-evidence' (bằng chứng điều tra).
    } catch (error) {
      row.action = 'kept-evidence';
      row.error = error instanceof Error ? error.message : String(error);
    }
    // Trạng thái sau xử lý: scan lại một lần nữa — file đã bị xoá (terminated
    // hoặc cleaned-metadata) → không còn entry nào trùng tên → `after`
    // undefined; file được giữ (kept-evidence) → state của scan lần hai.
    const afterEntry = scanWorkerProcesses(stateDir).find(
      (candidate) => candidate.name === scanEntry.name,
    );
    row.after = afterEntry?.state;
    if (scanEntry.metadata) {
      row.pid = scanEntry.metadata.pid;
    }
    rows.push(row);
  }
  return { rows };
}

// -------------------------------------------------------------------
// statusWorkerRuntime
// -------------------------------------------------------------------

export interface WorkerStatusRow {
  name: string;
  state: WorkerProcessState;
  pid: number | null;
  startedAt: number | null;
  /** Generated config của entry có còn trên disk không. */
  generatedConfigExists: boolean;
  /** True khi entry name khớp một entry chuẩn của PR4. */
  standard: boolean;
}

/**
 * Snapshot read-only của runtime: scan stateDir, thêm trạng thái của
 * generated config (PR3). KHÔNG đụng process/file nào — CLI quyết định render.
 *
 * Tên file generated config được đoán THẬTrees như `generateWorkerConfig` ghi:
 * `sanitizeFileName(generated.name).wrangler.jsonc` — entry name
 * (`transactional-mail`) khác worker name thật (`ecoma-transactional-mail`),
 * đoán theo entry name là luôn sai (OCR PR #36 medium). Đây vẫn là heuristic
 * vì metadata không ghi configPath — tự nó configPath nằm ở row của
 * `startWorkerRuntime` trong run đó; nếu file-rule thay đổi, sửa cả hai chỗ.
 */
export function statusWorkerRuntime(options: { worktreeRoot: string }): WorkerStatusRow[] {
  const worktreeRoot = normalizeWorktreeRoot(options.worktreeRoot);
  const stateDir = workerProcessStateDir(worktreeRoot);
  const generatedDir = generatedConfigDir(worktreeRoot);
  const standardNames = new Set(MAIL_WORKER_ENTRIES.map((e) => e.entryName));
  // Committed config load để lấy `name` thật của worker chuẩn — entry name
  // và worker name khác nhau, đoán file theo entry name luôn sai.
  const workerNamesByEntry = new Map<string, string>();
  for (const standard of MAIL_WORKER_ENTRIES) {
    try {
      // loadCommittedWranglerConfig fail-closed — file thiếu thì entry chuẩn
      // không được coi là "đã viết generated config".
      const { config } = loadCommittedWranglerConfig(standard.committedConfigPath);
      workerNamesByEntry.set(standard.entryName, sanitizeFileName(config.name));
    } catch {
      // Committed config đọc được thì new round-boot sẽ fail toà; status
      // read-only không nhân bản error đó — chỉ báo exists=false.
    }
  }
  return scanWorkerProcesses(stateDir).map((entry) => ({
    name: entry.name,
    state: entry.state,
    pid: entry.metadata?.pid ?? null,
    startedAt: entry.metadata?.startedAt ?? null,
    generatedConfigExists:
      existsSync(
        join(generatedDir, `${workerNamesByEntry.get(entry.name) ?? entry.name}.wrangler.jsonc`),
      ) || existsSync(join(generatedDir, `${entry.name}.wrangler.jsonc`)),
    standard: standardNames.has(entry.name),
  }));
}
