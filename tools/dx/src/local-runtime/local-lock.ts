/**
 * Khóa lane local theo worktree — mutual exclusion giữa các lane mutation
 * (`local-deploy` apply / `local-destroy`) CÙNG MỘT worktree.
 *
 * Biên mutation thật (issue #363): hai worktree đã được cô lập hoàn toàn bởi
 * namespace Docker (`deploy-namespace.ts`) và backend `file://` theo worktree
 * (`pulumi-context.ts`), và `pulumi up`/`destroy` trên cùng stack tự serialize
 * bởi state lock của Pulumi — khóa host-wide cũ vừa thừa vừa tự gây đói lẫn
 * nhau (task build image dài giữ khóa, các task song song cạn ngân sách chờ).
 * Chỉ còn một interleaving cần chặn: hai lane CÙNG worktree đụng `.env`,
 * `pulumi config set` (ngoài danh sách giữ khóa của Pulumi) và reconcile
 * namespace-wide cùng lúc. Khóa vì thế scoping theo worktree, giữ WHOLE-LANE:
 * orchestrator lấy một lần quanh cả lane, các task con không tự lấy khóa.
 *
 * Hợp đồng:
 * - `acquireLaneLock(worktreeRoot)` trả về hàm release; không có default path
 *   nào cả — MỌI call site bắt buộc truyền `worktreeRoot` (structural scoping,
 *   #363: chặn unit test chạm khóa thật vì signature zero-arg không tồn tại).
 * - Lock file `<worktreeRoot>/.ecoma-lane.lock`, nội dung JSON
 *   `{ pid, token, startedAt, cmdline }` — holder identity in ngay trong
 *   thông báo lỗi khi bị chặn. `cmdline` là `process.argv` của orchestrator
 *   (không chứa secret: passphrase đi qua env/file của subprocess, không argv).
 * - Waiter đợi VÔ HẠN (không budget) nhưng in progress line định kỳ (~30s) —
 *   khoảng in này chỉ là UX, KHÔNG tham gia correctness. Cái kết thúc đợi là
 *   lane kia buông khóa; chủ treo-vẫn-sống xử bằng `--steal-lock`
 *   (human-in-the-loop), không bằng đồng hồ — không hằng số thời gian nào
 *   tham gia correctness (nguyên tắc #363).
 * - Stale ⇔ PID chủ chết hoặc content malformed — ngữ nghĩa fail-closed của
 *   `isPidAlive` (EPERM = còn sống) giữ nguyên từ #22.
 * - Release ràng buộc PID + token: một process không xoá được lock của process
 *   khác; exit handler tự buông khóa khi process kết thúc.
 * - Lease assertion: token trong lock chính là lease mà orchestrator truyền
 *   cho task con qua env `ECOMA_LANE_LEASE` — `assertLaneLease` kiểm process
 *   con còn đứng trong lane hợp lệ (cha bị SIGKILL → lane mồ côi fail-closed).
 */
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** Tên file khóa lane của một worktree — nằm cạnh state dir, ngoài Git (.gitignore). */
export const LANE_LOCK_FILE_NAME = '.ecoma-lane.lock';

/** Đường dẫn file khóa lane của một worktree. */
export function laneLockPath(worktreeRoot: string): string {
  return join(worktreeRoot, LANE_LOCK_FILE_NAME);
}

/** Môi trường biến env truyền lease token từ orchestrator xuống task con. */
export const LANE_LEASE_ENV = 'ECOMA_LANE_LEASE';

export interface LockContent {
  pid: number;
  token: string;
  startedAt: number;
  cmdline: string[];
}

export function generateToken(): string {
  return randomBytes(16).toString('hex');
}

export function parseLockContent(content: string): LockContent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const pid = record['pid'];
  const token = record['token'];
  const startedAt = record['startedAt'];
  const cmdline = record['cmdline'];
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null;
  if (typeof token !== 'string' || token.length === 0) return null;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) || startedAt <= 0) return null;
  if (!Array.isArray(cmdline) || cmdline.some((entry) => typeof entry !== 'string')) {
    return null;
  }
  return {
    pid,
    token,
    startedAt,
    cmdline: cmdline as string[],
  };
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

function tryAcquire(lockPath: string): { release: () => void; token: string } | null {
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
    writeSync(
      fd,
      `${JSON.stringify({
        pid: process.pid,
        token,
        startedAt: Date.now(),
        cmdline: process.argv,
      })}\n`,
      0,
      'utf8',
    );
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
  return { release, token };
}

/** Khoảng nghỉ giữa hai lượt poll (giây, cho `sleep`) — chỉ là UX, không phải correctness. */
const POLL_SLEEP_SECONDS = 1;
/** Khoảng in progress line (giây) — chỉ là UX; correctness không phụ thuộc giá trị này. */
const PROGRESS_INTERVAL_SECONDS = 30;

function formatHolder(content: string): string {
  const parsed = parseLockContent(content);
  if (parsed === null) return `(unreadable lock content)`;
  const elapsed = Math.max(0, Date.now() - parsed.startedAt);
  const elapsedSeconds = Math.floor(elapsed / 1000);
  const elapsedText =
    elapsedSeconds >= 60
      ? `${Math.floor(elapsedSeconds / 60)}m${elapsedSeconds % 60}s`
      : `${elapsedSeconds}s`;
  return `pid=${parsed.pid} cmdline=${JSON.stringify(parsed.cmdline)} startedAt=${new Date(
    parsed.startedAt,
  ).toISOString()} elapsed=${elapsedText}`;
}

/**
 * Lấy khóa lane của một worktree — đợi vô hạn cho tới khi được.
 *
 * Progress line in mỗi ~PROGRESS_INTERVAL_SECONDS với holder identity
 * (pid/cmdline/startedAt/elapsed) — người đọc quyết trong vài giây có đợi hay
 * `--steal-lock`; khoảng in không tham gia correctness.
 *
 * Trả về `{ release, token }`: `token` chính là lease mà orchestrator truyền
 * xuống task con qua `ECOMA_LANE_LEASE` (xem `assertLaneLease`).
 */
export function acquireLaneLock(worktreeRoot: string): { release: () => void; token: string } {
  const lockPath = laneLockPath(worktreeRoot);
  const waitStartedAt = Date.now();
  let lastProgressAt = waitStartedAt;
  for (;;) {
    const result = tryAcquire(lockPath);
    if (result !== null) return result;
    let content: string | undefined;
    try {
      content = readFileSync(lockPath, 'utf8');
    } catch {
      // File biến mất giữa chừng — retry ngay, không sleep.
      content = undefined;
    }
    const now = Date.now();
    if (content !== undefined && now - lastProgressAt >= PROGRESS_INTERVAL_SECONDS * 1000) {
      lastProgressAt = now;
      console.log(
        `[local-lock] waiting for the lane lock of ${worktreeRoot} — ` +
          `held by ${formatHolder(content)} (waited ${Math.floor(
            (now - waitStartedAt) / 1000,
          )}s). If the holder is stuck, rerun with --steal-lock.`,
      );
    }
    spawnSync('sleep', [String(POLL_SLEEP_SECONDS)], { stdio: 'ignore' });
  }
}

/**
 * Gỡ khóa đang giữ (holder còn sống) — escape hatch người của `--steal-lock`.
 *
 * Một lần ghi nguyên tử cùng pattern `safeUnlinkIfSame`: chỉ unlink khi nội
 * dung lock vẫn là snapshot đã inspect — giữa inspect và unlink, holder cũ có
 * thể release hoặc lane khác đã acquire, khi đó KHÔNG đụng file.
 *
 * Trả về nội dung holder cũ (để caller in ra trước khi chiếm) hoặc null khi
 * lock đã biến mất/không đọc được.
 */
export function stealLaneLock(worktreeRoot: string): LockContent | null {
  const lockPath = laneLockPath(worktreeRoot);
  let content: string;
  try {
    content = readFileSync(lockPath, 'utf8');
  } catch {
    return null; // không có khóa để steal
  }
  const holder = parseLockContent(content);
  safeUnlinkIfSame(lockPath, content);
  return holder;
}

/**
 * Assert process hiện tại còn đứng trong lane hợp lệ — fencing-lite của task con.
 *
 * Orchestrator truyền token của khóa qua env `ECOMA_LANE_LEASE`; task con so
 * với token ĐANG trong lock file trước khi mutate. Lệch là lane mồ côi (cha bị
 * SIGKILL, lane khác đã chiếm khóa với token mới) hoặc gọi ngoài lane — abort
 * với exit 1, không warning.
 *
 * Trả về thông báo lỗi khi lệch, undefined khi khớp. Lock file không tồn tại
 * cũng là lệch: mutation không được phép chạy ngoài lane.
 */
export function assertLaneLease(
  worktreeRoot: string,
  leaseToken: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const callerToken = leaseToken ?? env[LANE_LEASE_ENV];
  if (callerToken === undefined || callerToken.length === 0) {
    return (
      `no ${LANE_LEASE_ENV} lease in the environment — this step must run inside a lane ` +
      `(via the local-deploy orchestration), not standalone.`
    );
  }
  let content: string;
  try {
    content = readFileSync(laneLockPath(worktreeRoot), 'utf8');
  } catch {
    return (
      `the lane lock file of this worktree is gone — the orchestrator that started this ` +
      `step died or released the lock. Aborting instead of mutating.`
    );
  }
  const parsed = parseLockContent(content);
  if (parsed === null) {
    return `the lane lock content is malformed — refusing to mutate. Aborting instead of mutating.`;
  }
  if (parsed.token !== callerToken) {
    return (
      `the lane lease does not match the current lock holder — this step belongs to an ` +
      `orphaned lane (its orchestrator was killed or stole-replaced). Aborting instead of mutating.`
    );
  }
  return undefined;
}
