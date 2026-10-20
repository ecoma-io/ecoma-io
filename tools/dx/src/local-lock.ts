/**
 * Khóa phối hợp nhỏ nhất giữa các lệnh `local-*` (deploy / destroy / cleanup)
 * để tránh race khi hai lệnh chạm Docker cùng lúc.
 *
 * Không có cơ chế lock nào tồn tại trước đó (kiểm tra repo: `proper-lockfile`
 * chỉ xuất hiện trong lockfile, không phải dependency), nên đây là bản tự dựng
 * tối thiểu: một file lock với PID + timestamp, stale detection qua PID liveness
 * và thời gian sống. Lock file nằm ở thư mục tạm của OS để mọi process trên host
 * cùng thấy.
 *
 * Hợp đồng:
 * - `acquireLocalDeployLock()` trả về hàm release. Nó đăng ký release vào
 *   `process 'exit'` nên ngay cả khi caller quên gọi release, lock cũng được
 *   giải phóng khi process kết thúc.
 * - Lock được giữ trong suốt thời gian lệnh chạy (deploy/up có thể mất vài phút)
 *   — cleanup gọi vào lúc đó sẽ nhận lỗi rõ và thoát, thay vì chạy đồng thời.
 * - Lock cũ (PID chết hoặc mtime > 1 giờ) được xoá tự động — tránh lock mồ côi
 *   sau crash làm mọi lệnh sau bị chặn vĩnh viễn.
 */
import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const LOCK_PATH = join(tmpdir(), 'ecoma-local-deploy.lock');
const STALE_AFTER_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RETRY_SLEEP_MS = 200;

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH = process không tồn tại; EPERM = tồn tại nhưng không có quyền signal
    // → coi là còn sống (không xoá lock của process khác user).
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function releaseLock(): void {
  try {
    unlinkSync(LOCK_PATH);
  } catch {
    // Đã bị xoá (stale cleanup của process khác) — không sao.
  }
}

function tryAcquire(): (() => void) | null {
  let fd: number | undefined;
  try {
    fd = openSync(LOCK_PATH, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    // Lock đã có — kiểm stale. `stale = true` khi đọc file thất bại
    // (file biến mất giữa chừng, content hỏng...).
    let stale: boolean;
    try {
      const content = readFileSync(LOCK_PATH, 'utf8');
      const pid = Number.parseInt(content.split('\n')[0] ?? '', 10);
      const mtime = statSync(LOCK_PATH).mtimeMs;
      stale = Date.now() - mtime > STALE_AFTER_MS || !isPidAlive(pid);
    } catch {
      stale = true;
    }
    if (stale) {
      try {
        unlinkSync(LOCK_PATH);
      } catch {
        // Race với process khác xoá cùng lúc — bỏ qua, thử lại.
      }
      return null; // thử lại ở vòng ngoài
    }
    return null; // đang bị giữ — caller quyết định retry/fail
  }
  try {
    writeSync(fd, `${process.pid}\n${Date.now()}\n`, 0, 'utf8');
  } finally {
    closeSync(fd);
  }
  process.on('exit', releaseLock);
  return releaseLock;
}

export function acquireLocalDeployLock(): () => void {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const result = tryAcquire();
    if (result !== null) return result;
    // Phân biệt "đang bị giữ bởi process sống" với "vừa xoá stale, thử lại ngay".
    // Nếu file còn tồn tại và process sống → sleep rồi retry.
    try {
      const content = readFileSync(LOCK_PATH, 'utf8');
      const pid = Number.parseInt(content.split('\n')[0] ?? '', 10);
      if (isPidAlive(pid)) {
        spawnSync('sleep', [String(RETRY_SLEEP_MS / 1000)], { stdio: 'ignore' });
      }
    } catch {
      // File biến mất giữa chừng — retry ngay.
    }
  }
  throw new Error(
    'Một lệnh local deploy/cleanup khác đang chạy (lock bị giữ). ' +
      'Chờ lệnh đó kết thúc rồi chạy lại, hoặc xoá lock mồ côi ' +
      `${LOCK_PATH} nếu process chủ đã chết.`,
  );
}
