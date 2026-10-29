/**
 * Khóa lane local theo worktree — mutual exclusion giữa các mutation CÙNG MỘT
 * worktree (up/down của entry colocated `deploys/<project>/local.ts`).
 *
 * Biên mutation thật (issue #363): hai worktree đã được cô lập hoàn toàn bởi
 * namespace Docker (`deploy-namespace.ts`) và backend `file://` theo worktree
 * (`pulumi-context.ts`), và `pulumi up`/`destroy` trên cùng stack tự serialize
 * bởi state lock của Pulumi — khóa host-wide cũ vừa thừa vừa tự gây đói lẫn
 * nhau (task build image dài giữ khóa, các task song song cạn ngân sách chờ).
 * Chỉ còn một interleaving cần chặn: hai lane CÙNG worktree đụng `.env`,
 * `pulumi config set` (ngoài danh sách giữ khóa của Pulumi) và reconcile
 * namespace-wide cùng lúc. Khóa vì thế scoping theo worktree: MỖI entry tự
 * lấy khóa quanh toàn bộ thao tác up/down của mình — hai entry khác project
 * trong cùng worktree vẫn serialize với nhau qua cùng một file khóa.
 *
 * Hợp đồng:
 * - `acquireLaneLock(worktreeRoot)` trả về hàm release; không có default path
 *   nào cả — MỌI call site bắt buộc truyền `worktreeRoot` (structural scoping,
 *   #363: chặn unit test chạm khóa thật vì signature zero-arg không tồn tại).
 * - Lock file `<worktreeRoot>/.ecoma-lane.lock`, nội dung JSON
 *   `{ pid, token, startedAt, cmdline }` — holder identity in ngay trong
 *   thông báo lỗi khi bị chặn. `cmdline` là `process.argv` của holder
 *   SAU KHI lọc các argv mang hình nhạy cảm (`redactCmdline`): passphrase thật
 *   đi qua env/file của subprocess, không argv — lọc thêm một lớp phòng khi
 *   argv nào đó vẫn mang tên flag secret.
 * - Waiter đợi VÔ HẠN (không budget) nhưng in progress line định kỳ (~30s) —
 *   khoảng in này chỉ là UX, KHÔNG tham gia correctness. Cái kết thúc đợi là
 *   lane kia buông khóa; chủ treo-vẫn-sống xử bằng `--steal-lock`
 *   (human-in-the-loop), không bằng đồng hồ — không hằng số thời gian nào
 *   tham gia correctness (nguyên tắc #363).
 * - Stale ⇔ PID chủ chết hoặc content malformed — ngữ nghĩa fail-closed của
 *   `isPidAlive` (EPERM = còn sống) giữ nguyên từ #22.
 * - Release ràng buộc PID + token: một process không xoá được lock của process
 *   khác; exit handler tự buông khóa khi process kết thúc.
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

/**
 * Lọc các argv mang hình nhạy cảm (token/passphrase/secret/key + giá trị kề
 * sau) trước khi ghi `cmdline` vào lock file — lock file nằm ngoài Git nhưng
 * vẫn là file trên đĩa mà tiến trình cùng user đọc được, và `formatHolder` in
 * cmdline vào stdout. Defense-in-depth cho nguyên tắc "secret không vào argv
 * của orchestrator": passphrase thật đi qua env/file, cmdline chỉ là holder
 * identity cho người đọc.
 */
const SECRET_ARG_SHAPE = /(?:token|passphrase|secret|password|api[-_]?key|credential)/iu;

export function redactCmdline(argv: string[]): string[] {
  const redacted: string[] = [];
  let skipNext = false;
  for (const arg of argv) {
    if (skipNext) {
      redacted.push('[redacted]');
      skipNext = false;
      continue;
    }
    const looksLikeSecretFlag = SECRET_ARG_SHAPE.test(arg);
    // Cả hình `--passphrase=value` lẫn `--passphrase value`: flag nhạy cảm thì
    // che chính flag (nó đã mang giá trị hoặc sắp mang giá trị kế tiếp).
    if (looksLikeSecretFlag) redacted.push('[redacted]');
    else redacted.push(arg);
    // Chỉ nhảy qua arg kế tiếp với dạng tách giá trị (`--passphrase value`).
    if (looksLikeSecretFlag && !arg.includes('=')) skipNext = true;
  }
  return redacted;
}

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
        cmdline: redactCmdline(process.argv),
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
 * lock đã biến mất/không đọc được HOẶC bị thay đổi giữa inspect và unlink
 * (TOCTOU: `safeUnlinkIfSame` trả false nghĩa là KHÔNG có gì bị gỡ — caller
 * không được log "removed" cho một steal thất bại).
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
  const removed = safeUnlinkIfSame(lockPath, content);
  if (!removed) return null; // lock đổi giữa chừng — steal thất bại, không có gì bị gỡ
  return holder;
}
