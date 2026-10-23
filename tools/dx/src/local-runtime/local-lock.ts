/**
 * Khóa phối hợp nhỏ nhất giữa các lệnh `local-*` (deploy / destroy / cleanup)
 * để tránh race khi hai lệnh chạm Docker cùng lúc.
 *
 * Không có cơ chế lock nào tồn tại trước đó (kiểm tra repo: `proper-lockfile`
 * chỉ xuất hiện trong lockfile, không phải dependency), nên đây là bản tự dựng
 * tối thiểu: một file lock với PID + token + timestamp, stale detection qua PID
 * liveness. Lock file nằm ở thư mục tạm của OS để mọi process trên host cùng thấy.
 *
 * Hợp đồng:
 * - `acquireLocalDeployLock()` trả về hàm release. Nó đăng kỳ release vào
 *   `process 'exit'` nên ngay cả khi caller quên gọi release, lock cũng được
 *   giải phóng khi process kết thúc.
 * - Lock được giữ trong suốt thời gian lệnh chạy (deploy/up có thể mất vài phút)
 *   — cleanup gọi vào lúc đó sẽ nhận lỗi rõ và thoát, thay vì chạy đồng thời.
 * - Lock cũ (PID chết) được xoá tự động — tránh lock mồ côi sau crash làm mọi
 *   lệnh sau bị chặn vĩnh viễn. Lock còn sống KHÔNG bị xoá chỉ vì cũ (mtime).
 * - Release được ràng buộc với đúng acquisition (PID + token): một process
 *   không thể xoá lock của process khác, và exit handler được gỡ sau khi
 *   release tường minh để process sau không bị ảnh hưởng.
 */
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const DEFAULT_LOCK_PATH = join(tmpdir(), 'ecoma-local-deploy.lock');
const MAX_ATTEMPTS = 5;
const RETRY_SLEEP_MS = 200;

export interface LockContent {
  pid: number;
  token: string;
}

export interface AcquireOptions {
  /** Đường dẫn file lock — test seam, mặc định là DEFAULT_LOCK_PATH. */
  lockPath?: string;
}

export function generateToken(): string {
  return randomBytes(16).toString('hex');
}

export function parseLockContent(content: string): LockContent | null {
  const lines = content.split('\n');
  const pid = Number.parseInt(lines[0] ?? '', 10);
  const token = lines[1] ?? '';
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (token.length === 0) return null;
  return { pid, token };
}

/**
 * Kiểm process còn sống không.
 *
 * ESRCH = chắc chắn không tồn tại → dead. EPERM = tồn tại nhưng không có quyền
 * signal → VẪN còn sống (không được coi là chết). Lỗi khác → không có bằng
 * chứng chết → coi như còn sống (fail-closed: không steal lock).
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    // EPERM hoặc lỗi khác: không chứng minh được process chết → còn sống.
    return true;
  }
}

/** Lock stale ⇔ owner (PID trong content) chết hoặc content malformed. */
export function isStaleLock(content: string): boolean {
  const parsed = parseLockContent(content);
  if (parsed === null) return true;
  return !isPidAlive(parsed.pid);
}

/**
 * Xoá lock chỉ khi nội dung vẫn đúng với snapshot đã inspect — bảo vệ race
 * stale-recovery: giữa inspect và unlink, process khác có thể acquire lock mới.
 */
export function safeUnlinkIfSame(lockPath: string, expected: string): boolean {
  try {
    const current = readFileSync(lockPath, 'utf8');
    if (current !== expected) return false;
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

// Token đang active của process này, giá trị là lock path — nhiều acquisition
// song song (cùng hoặc khác lock path) không chồng exit listener, và exit
// handler chỉ release đúng lock path từng token.
const activeTokens = new Map<string, string>();
let exitListener: (() => void) | null = null;

function doRelease(token: string, lockPath: string): void {
  try {
    const content = readFileSync(lockPath, 'utf8');
    const parsed = parseLockContent(content);
    if (parsed === null) return;
    if (parsed.pid !== process.pid || parsed.token !== token) return;
    // Re-read ngay trước unlink để đóng race window giữa kiểm và xoá.
    const current = readFileSync(lockPath, 'utf8');
    const currentParsed = parseLockContent(current);
    if (
      currentParsed === null ||
      currentParsed.pid !== process.pid ||
      currentParsed.token !== token
    ) {
      return;
    }
    unlinkSync(lockPath);
  } catch {
    // ENOENT: đã bị xoá — không sao. Lỗi khác (permission...) → fail-closed.
  }
}

function removeExitListenerIfIdle(): void {
  if (activeTokens.size === 0 && exitListener !== null) {
    process.removeListener('exit', exitListener);
    exitListener = null;
  }
}

function ensureExitListener(): void {
  if (exitListener !== null) return;
  exitListener = (): void => {
    for (const [token, lockPath] of activeTokens) {
      // Chỉ xoá nếu lock file còn thuộc process này VÀ token ghi ở trên. Nếu
      // process khác đã reacquire (token khác) thì KHÔNG được đụng.
      try {
        const content = readFileSync(lockPath, 'utf8');
        const parsed = parseLockContent(content);
        if (parsed === null || parsed.pid !== process.pid || parsed.token !== token) {
          continue;
        }
        // Re-read ngay trước unlink — cùng bảo vệ với doRelease.
        const current = readFileSync(lockPath, 'utf8');
        const currentParsed = parseLockContent(current);
        if (
          currentParsed !== null &&
          currentParsed.pid === process.pid &&
          currentParsed.token === token
        ) {
          unlinkSync(lockPath);
        }
      } catch {
        // ignore
      }
    }
    activeTokens.clear();
    const listener = exitListener;
    if (listener !== null) {
      process.removeListener('exit', listener);
      exitListener = null;
    }
  };
  process.on('exit', exitListener);
}

function tryAcquire(lockPath: string): (() => void) | null {
  const token = generateToken();
  let fd: number | undefined;
  try {
    fd = openSync(lockPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    let content: string;
    try {
      content = readFileSync(lockPath, 'utf8');
    } catch (readError) {
      const code = (readError as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // File biến mất giữa chừng — retry.
        return null;
      }
      // Permission/IO error: không chứng minh được stale → KHÔNG steal, coi như held.
      return null;
    }
    if (isStaleLock(content)) {
      // Chỉ xoá nếu nội dung không đổi (race protection).
      safeUnlinkIfSame(lockPath, content);
      return null; // thử lại ở vòng ngoài
    }
    return null; // đang bị giữ — caller quyết định retry/fail
  }
  try {
    writeSync(fd, `${process.pid}\n${token}\n${Date.now()}\n`, 0, 'utf8');
  } finally {
    closeSync(fd);
  }

  activeTokens.set(token, lockPath);
  ensureExitListener();
  const release = (): void => {
    activeTokens.delete(token);
    doRelease(token, lockPath);
    removeExitListenerIfIdle();
  };
  return release;
}

export function acquireLocalDeployLock(options: AcquireOptions = {}): () => void {
  const lockPath = options.lockPath ?? DEFAULT_LOCK_PATH;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const result = tryAcquire(lockPath);
    if (result !== null) return result;
    try {
      const content = readFileSync(lockPath, 'utf8');
      const parsed = parseLockContent(content);
      if (parsed !== null && isPidAlive(parsed.pid)) {
        spawnSync('sleep', [String(RETRY_SLEEP_MS / 1000)], { stdio: 'ignore' });
      }
    } catch {
      // File biến mất giữa chừng — retry ngay.
    }
  }
  throw new Error(
    'Một lệnh local deploy/cleanup khác đang chạy (lock bị giữ). ' +
      'Chờ lệnh đó kết thúc rồi chạy lại, hoặc xoá lock mồ côi ' +
      `${lockPath} nếu process chủ đã chết.`,
  );
}
