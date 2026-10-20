/**
 * Vòng đời process Worker local — nền tảng cho PR3 (generated config) và PR4
 * (orchestration deploy/status/destroy).
 *
 * Bài toán: một worktree cần chạy nhiều process `wrangler dev` (mỗi Worker một
 * process — topology hai process đã đo trong PR1, chia sẻ `--persist-to`).
 * Mỗi process là child của tool dx; tool phải biết process nào còn sống, process
 * nào chết đột ngột, và phải dọn được process mồ côi sau crash mà KHÔNG giết
 * nhầm process của worktree khác hay process không liên quan.
 *
 * Nguyên tắc sao chép từ `local-lock.ts` (cùng chuẩn PID liveness):
 *
 * 1. **Metadata survive qua crash** — file JSON `<stateDir>/<name>.json` ghi PID,
 *    argv (argv array, KHÔNG shell-string), startedAt. Process chết đột ngột
 *    vẫn để lại file; reader phải tự kiểm PID liveness trước khi tin metadata,
 *    và mọi hành vi destructive (kill) phải khớp thêm identity.
 * 2. **PID không phải identity.** `kill(pid, 0)` thành công chỉ chứng minh "có
 *    process nào đó sống ở PID đó" — PID được OS tái sử dụng. Vì vậy kill entry
 *    ở đây so khớp **argv record** trong file metadata với argv caller truyền:
 *    lệch argv → từ chối kill, báo lỗi rõ, KHÔNG dừng.
 * 3. **Kill luôn qua `process.kill(pid, 'SIGTERM')`**, sau timeout lùi sang
 *    SIGKILL. Không dùng shell-string (`pkill -f ...`) — pattern match như vậy
 *    trúng process không liên quan.
 * 4. **`spawn` với argv array + `env` object tường minh** — không shell-string,
 *    argument và environment đi nguyên vẹn, không quoting.
 * 5. **Readiness thuộc về caller** (PR4): hàm này chỉ quản lý process — cách
 *    kiểm "đã phục vụ" (probe `/health`, Explorer API...) phụ thuộc từng Worker
 *    nên không nằm ở đây.
 *
 * Cấp phục hồi (recovery): `scanWorkerProcesses` đọc toàn bộ metadata trong
 * stateDir của worktree, phân loại stale/duplicate bằng PID liveness + identity,
 * và `terminateStaleWorkers` kill CHỈ metadata khớp identity + PID đã chết
 * tái sử dụng được chứng minh — cùng chuẩn fail-closed với `local-lock.ts`.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Phiên bản shape của file metadata — đổi shape phải đổi số này, loader cũ từ chối đọc. */
const METADATA_VERSION = 1;

/** Thư mục state mặc định cho process tracking trong worktree (ngoài Git). */
export const WORKER_STATE_DIR_NAME = '.worker-local-state';

export function workerProcessStateDir(worktreeRoot: string): string {
  return join(worktreeRoot, WORKER_STATE_DIR_NAME);
}

/** Record của file metadata — nguồn truth của một process đã spawn. */
export interface WorkerProcessMetadata {
  version: number;
  name: string;
  pid: number;
  argv: string[];
  /** sha256 đầu 16 hex của argv — so identity nhanh hơn so ghép từng phần tử. */
  identityHash: string;
  startedAt: number;
}

/** Kết quả của `startWorkerProcess` — handle điều khiển một process con. */
export interface WorkerProcessHandle {
  /** PID thật sau event `spawn`; -1 khi spawn chưa chắc chắn hoặc đã lỗi. */
  pid: number;
  /** Đã exit chưa — 'error' event KHÔNG đặt cờ này (spawn fail ≠ exit). */
  exited: boolean;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  /** Lỗi spawn từ event `error` (ENOENT, EACCES...) — không qua exit code. */
  spawnError?: string;
  metadataPath: string;
  /** True khi PID còn sống — poll `kill(pid, 0)`, cùng chuẩn `local-lock.ts`. */
  alive(): boolean;
  /** Promise resolve đúng một lần khi process exit (không resolve khi spawn fail). */
  onExit: Promise<void>;
  /** SIGTERM → đợi timeoutMs → SIGKILL fallback. Lỗi gửi signal không nuốt. */
  stop(timeoutMs?: number): Promise<void>;
  /** Xoá file metadata — dùng trong register giúp caller quản lý dọn dẹp. */
  removeMetadata(): void;
}

interface StopOptions {
  /** Bỏ SIGKILL fallback (test khống chế mạnh mẽ rejection). */
  escalationWaitMs?: number;
}

/** Đường dẫn file metadata của một entry. */
export function metadataPathOf(stateDir: string, name: string): string {
  return join(stateDir, `${name}.json`);
}

/** Identity hash của argv — dư 16 hex là đủ phân biệt trong thực tế. */
export function identityHashOf(argv: string[]): string {
  return createHash('sha256').update(argv.join('\u0000')).digest('hex').slice(0, 16);
}

/** So hai argv — trước khi kill phải khớp identity. */
export function sameIdentity(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Đọc file metadata. Fail-closed: file thiếu, sai shape, sai version → `null`
 * (không phải "metadata rác cũng tin"). Loader của orchestration gọi hàm này
 * trước khi quyết định kill: metadata `null` ⇒ không có identity khớp ⇒ không kill.
 */
export function readMetadata(path: string): WorkerProcessMetadata | null {
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<WorkerProcessMetadata>;
    if (parsed.version !== METADATA_VERSION) return null;
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid) || parsed.pid <= 0) {
      return null;
    }
    if (!Array.isArray(parsed.argv) || parsed.argv.length === 0) return null;
    if (parsed.argv.some((arg) => typeof arg !== 'string')) return null;
    if (typeof parsed.identityHash !== 'string' || parsed.identityHash.length === 0) return null;
    if (typeof parsed.startedAt !== 'number' || parsed.startedAt <= 0) return null;
    return parsed as WorkerProcessMetadata;
  } catch {
    return null;
  }
}

/** PID liveness — cùng chuẩn với `local-lock.ts` (EPERM → coi như còn sống). */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    // EPERM/khác: không chứng minh được chết → còn sống (fail-closed, không kill).
    return true;
  }
}

function writeMetadata(path: string, metadata: WorkerProcessMetadata): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(metadata, null, 2), 'utf8');
}

interface StartOptions {
  /** Tên entry ở stateDir — là `metadataPath` của handle. */
  name: string;
  /** ARGV ARRAY — argv[0] là executable, phần còn lại là flags. KHÔNG shell string. */
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stateDir: string;
  /** Test seam — thay `node:child_process.spawn` bằng fake theo kịch bản test. */
  spawnImpl?: typeof spawn;
}

/**
 * Start một Worker process và ghi file metadata.
 *
 * Metadata được viết 2 lần: lần đầu TRƯỚC spawn (pid tạm `0`, version đầy đủ
 * argv/identityHash — để crash giữa spawn và event `spawn` vẫn để lại bằng chứng
 * identity), lần hai SAU event `spawn` khi PID thật đã có. File pid-`0` bị
 * loader từ chối (`pid <= 0`), đúng mục đích: không PID thì không kill gì được.
 *
 * KHÔNG có readiness/startup timeout ở đây — đó là trách nhiệm của caller.
 */
export function startWorkerProcess(options: StartOptions): WorkerProcessHandle {
  const metadataPath = metadataPathOf(options.stateDir, options.name);
  const identityHash = identityHashOf(options.argv);
  const initialMetadata: WorkerProcessMetadata = {
    version: METADATA_VERSION,
    name: options.name,
    pid: 0,
    argv: options.argv,
    identityHash,
    startedAt: Date.now(),
  };
  writeMetadata(metadataPath, initialMetadata);

  const spawnImpl = options.spawnImpl ?? spawn;
  const child: ChildProcess = spawnImpl(options.argv[0], options.argv.slice(1), {
    cwd: options.cwd,
    env: options.env,
    // stdin đóng ngay (process không cần input tương tác); stdout/stderr để
    // caller tự lấy stream và ghi log file theo metadata.
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const handle: WorkerProcessHandle = {
    pid: -1,
    exited: false,
    exitCode: null,
    exitSignal: null,
    metadataPath,
    alive: () => !handle.exited && isPidAlive(handle.pid),
    onExit: undefined as unknown as Promise<void>,
    removeMetadata(): void {
      try {
        rmSync(metadataPath, { force: true });
      } catch {
        // ENOENT bình thường; lỗi khác vẫn được bỏ qua — file metadata không
        // đủ quan trọng để fail một teardown.
      }
    },
    async stop(timeoutMs = 10_000, optionsOverride: StopOptions = {}): Promise<void> {
      if (handle.pid <= 0 || !isPidAlive(handle.pid)) return;
      try {
        process.kill(handle.pid, 'SIGTERM');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ESRCH') throw error;
        return; // process đã chết giữa chừng — kill không cần thiết
      }
      const waitEscalate = optionsOverride.escalationWaitMs ?? timeoutMs;
      if (waitEscalate <= 0) return;
      const deadline = Date.now() + waitEscalate;
      while (!handle.exited && isPidAlive(handle.pid) && Date.now() < deadline) {
        await new Promise((resolve) => {
          setTimeout(resolve, 25);
        });
      }
      if (!handle.exited && isPidAlive(handle.pid)) {
        try {
          process.kill(handle.pid, 'SIGKILL');
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'ESRCH') throw error;
        }
        // Chờ reap sau SIGKILL — zombie vẫn `kill(pid,0)` thành công cho tới
        // khi parent reap, nên phải đợi 'exit' event thực sự bắn.
        const reapDeadline = Date.now() + 1000;
        while (!handle.exited && Date.now() < reapDeadline) {
          await new Promise((resolve) => {
            setTimeout(resolve, 10);
          });
        }
      }
    },
  };

  let resolveExit: (() => void) | null = null;
  child.on('spawn', () => {
    handle.pid = child.pid ?? -1;
    if (handle.pid > 0) {
      writeMetadata(metadataPath, { ...initialMetadata, pid: handle.pid });
    }
  });

  child.on('error', (error: Error) => {
    // spawnError KHÔNG đặt `exited` hay resolve `onExit` — spawn fail nghĩa là
    // process chưa hề có vòng đời nào; caller vẫn dọn metadata qua
    // `removeMetadata()`.
    handle.spawnError = `${error.name}: ${error.message}`;
  });

  child.on('exit', (code, signal) => {
    handle.exited = true;
    handle.exitCode = code;
    handle.exitSignal = signal;
    resolveExit?.();
  });

  // Gán promise SAU khi đã đăng ký mọi listener: executor của `new Promise`
  // chạy đồng bộ ngay lúc construct, nên closure `resolveExit` phải có giá trị
  // trước khi 'exit' event có thể bắn. Gán `handle.onExit` sau cùng giúp mọi
  // listener đã đăng ký trước khi promise tồn tại — không có race "promise
  // resolve trước khi caller gán".
  handle.onExit = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  return handle;
}

export type { StopOptions };

/** Phân loại của một metadata entry sau khi quét stateDir. */
export type WorkerProcessState =
  | 'alive' // PID còn sống — process thật đang chạy, không đụng
  | 'stale' // PID đã chết — metadata mồ côi, an toàn dọn
  | 'invalid'; // file sai shape/version/pid≤0 — không đủ bằng chứng identity

export interface WorkerProcessScanEntry {
  name: string;
  metadataPath: string;
  metadata: WorkerProcessMetadata | null;
  state: WorkerProcessState;
}

/**
 * Quét stateDir và phân loại mọi file `*.json` metadata.
 *
 * **Invariant an toàn**: metadata `null` (corrupt, version lạ, pid ≤ 0) KHÔNG
 * BAO GIỜ bị coi là stale để kill — nó chỉ được gắn `invalid` và chỉ dọn được
 * qua `deleteStaleWorkerMetadata` (xoá file, không kill). Kill chỉ dành cho
 * entry có PID chết **và** identity đầy đủ, tức là có đủ bằng chứng process đó
 * đã từng chạy từ file này.
 */
export function scanWorkerProcesses(stateDir: string): WorkerProcessScanEntry[] {
  let entries: string[];
  try {
    entries = readdirSync(stateDir);
  } catch {
    return []; // stateDir chưa tồn tại — chưa có process nào được spawn
  }
  const results: WorkerProcessScanEntry[] = [];
  for (const file of entries) {
    if (!file.endsWith('.json')) continue;
    const metadataPath = join(stateDir, file);
    const metadata = readMetadata(metadataPath);
    const name = file.replace(/\.json$/u, '');
    if (metadata === null) {
      results.push({ name, metadataPath, metadata: null, state: 'invalid' });
      continue;
    }
    results.push({
      name,
      metadataPath,
      metadata,
      state: isPidAlive(metadata.pid) ? 'alive' : 'stale',
    });
  }
  return results;
}

/** Kết quả xoá metadata mồ côi — báo cáo từng entry thay vì throw giữa chừng. */
export interface StaleRemovalReport {
  /** File đã xoá (stale + invalid) — metadata mồ côi, không bằng chứng sống. */
  removed: string[];
  /** File giữ lại (alive) — process thật đang chạy. */
  kept: string[];
  /** Lỗi IO xoá từng file — caller quyết định fail hay tiếp tục. */
  errors: { name: string; message: string }[];
}

/**
 * Xoá metadata mồ côi trong stateDir — chỉ FILE, không kill process nào.
 *
 * Kill process mồ côi (PID chết rồi OS tái sử dụng) nằm ở PR4 orchestration và
 * dùng `sameIdentity` của caller; PR2 chỉ đơn "metadata không còn tương ứng
 * process sống thì xoá file, để lần deploy sau start sạch". Entry `alive` và
 * `invalid` KHÔNG bị đụng: `invalid` giữ lại làm bằng chứng điều tra (caller
 * muốn xoá hẳn dùng `rmSync` trực tiếp).
 */
export function deleteStaleWorkerMetadata(stateDir: string): StaleRemovalReport {
  const report: StaleRemovalReport = { removed: [], kept: [], errors: [] };
  for (const entry of scanWorkerProcesses(stateDir)) {
    if (entry.state === 'alive') {
      report.kept.push(entry.name);
      continue;
    }
    if (entry.state === 'invalid') {
      report.kept.push(entry.name);
      continue;
    }
    try {
      rmSync(entry.metadataPath, { force: true });
      report.removed.push(entry.name);
    } catch (error) {
      report.errors.push({
        name: entry.name,
        message: (error as NodeJS.ErrnoException).message ?? String(error),
      });
    }
  }
  return report;
}

/**
 * Recovery một entry mồ côi CỤ THỂ — kill khi PID đã tái sử dụng được chứng
 * minh. Đây là duy nhất nơi thực hiện kill với entry đọc từ file: guard kép
 * (identity khớp argv caller + metadata hợp lệ + PID chết) phải ĐỦ cả ba mới
 * tới được lệnh kill.
 *
 * Trả về `null` khi không đủ điều kiện kill (metadata null, identity lệch,
 * PID chưa chết); `true` khi SIGTERM đã gửi; `false` khi SIGTERM thất bại.
 * Caller quyết định cách xử lý từng kết quả — hàm này không throw cho các
 * trường hợp "không đủ", chỉ throw khi IO file thật sự lỗi.
 */
export function terminateStaleWorker(
  stateDir: string,
  name: string,
  expectedArgv: string[],
): boolean | null {
  const metadata = readMetadata(metadataPathOf(stateDir, name));
  if (metadata === null) return null; // không đủ bằng chứng identity
  if (!sameIdentity(metadata.argv, expectedArgv)) return null; // lệch argv — từ chối
  if (isPidAlive(metadata.pid)) return null; // PID sống — không phải stale
  try {
    process.kill(metadata.pid, 'SIGTERM');
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return true; // đã chết giữa inspect và kill — coi xong
    if (code === 'EPERM') return false; // process sống nhưng khác owner — bỏ
    throw error; // lỗi khác — caller xử lý
  }
}
