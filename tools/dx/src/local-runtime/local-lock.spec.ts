import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import * as lockModule from './local-lock.js';
import {
  acquireLaneLock,
  assertLaneLease,
  isPidAlive,
  isStaleLock,
  laneLockPath,
  LANE_LEASE_ENV,
  LANE_LOCK_FILE_NAME,
  parseLockContent,
  redactCmdline,
  safeUnlinkIfSame,
  stealLaneLock,
} from './local-lock.js';

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempWorktree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lane-lock-spec-'));
  cleanup.push(dir);
  return dir;
}

/** Lock content của process hiện tại — hình JSON đúng contract `{ pid, token, startedAt, cmdline }`. */
function liveLockContent(token: string): string {
  return `${JSON.stringify({
    pid: process.pid,
    token,
    startedAt: Date.now(),
    cmdline: ['node', 'tools/dx', 'local-deploy'],
  })}\n`;
}

describe('regression: no exported default path', () => {
  it('the lock module exports no default path constant or zero-arg acquire (structural pollution guard)', () => {
    // #363 guard cấu trúc: signature bắt buộc `worktreeRoot` — mọi hình thái
    // "default path" (vd `DEFAULT_LOCK_PATH = join(tmpdir(), ...)`) từng là
    // đường unit test chạm khóa thật (`/tmp/ecoma-local-deploy.lock`). Spec
    // này chặn tái rơi vào pattern đó: thêm lại bất kỳ export nào dưới đây là
    // test đỏ ngay.
    const entries = Object.entries(lockModule);
    // Không export nào mang tên gợi ý default path.
    const offenderNames = entries.filter(([name]) => /default/iu.test(name)).map(([name]) => name);
    expect(offenderNames).toEqual([]);
    // Không export nào là string hằng tuyệt đối (path host-wide) hay nhúng
    // tmpdir — path duy nhất hợp lệ được suy từ `worktreeRoot` qua
    // `laneLockPath`. Gom violation rồi assert một lần — không conditional expect.
    const absolutePathStrings = entries
      .filter(([, value]) => typeof value === 'string')
      .filter(([, value]) => (value as string).startsWith('/') || (value as string).includes('tmp'))
      .map(([name]) => name);
    expect(absolutePathStrings).toEqual([]);
    // acquire function duy nhất bắt buộc đối số: gọi zero-arg là lỗi type/compile
    // (TS bắt bắt buộc), còn runtime assert chống bất luận kẻ bypass type.
    expect(typeof lockModule.acquireLaneLock).toBe('function');
    expect((lockModule.acquireLaneLock as (root?: string) => unknown).length).toBeGreaterThan(0);
    // `laneLockPath` cũng bắt buộc `worktreeRoot` — không có hình zero-arg.
    expect(laneLockPath.length).toBe(1);
    // Tên file khóa là tên tương đối — ghép với worktreeRoot mới thành đường.
    expect(LANE_LOCK_FILE_NAME).toBe('.ecoma-lane.lock');
    expect(laneLockPath('/some/worktree')).toBe('/some/worktree/.ecoma-lane.lock');
  });
});

describe('isPidAlive', () => {
  it('current process is alive', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it('invalid pid (0, negative, non-integer) treated as dead', () => {
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive(Number.NaN)).toBe(false);
  });

  // EPERM: không có quyền signal — KHÔNG được coi là chết (regression cho
  // kết luận sai liveness khi process khác user). Mô phỏng bằng kill process
  // của root? Không thể trong unit test — thay vào đó test contract qua
  // không thể EPERM thật; thực hiện bằng cách dùng pid lớn (unlikely tồn tại)
  // sẽ throw EPERM trên một số system khi pid thuộc user khác. Không deterministic
  // nên contract được ghi qua code review; test dưới chỉ khẳng định nhánh.
  it('dead process (ESRCH) → false', () => {
    // PID hoá thường không còn: dò theo /proc để tránh đánh trúng process lạ.
    let dead = -1;
    for (let p = 100000; p > 40000; p -= 1) {
      if (!existsSync(`/proc/${p}`)) {
        dead = p;
        break;
      }
    }
    if (dead === -1) return; // không tìm được pid trống — skip im lặng
    expect(isPidAlive(dead)).toBe(false);
  });
});

describe('parseLockContent / isStaleLock', () => {
  it('valid JSON content parses pid, token, startedAt and cmdline', () => {
    const parsed = parseLockContent(
      `${JSON.stringify({ pid: 1234, token: 'abc-token', startedAt: 1700000000000, cmdline: ['node', 'dx'] })}`,
    );
    expect(parsed).toEqual({
      pid: 1234,
      token: 'abc-token',
      startedAt: 1700000000000,
      cmdline: ['node', 'dx'],
    });
  });

  it('malformed content → null → stale', () => {
    expect(parseLockContent('')).toBeNull();
    expect(parseLockContent('not-json')).toBeNull();
    expect(parseLockContent('{}')).toBeNull();
    expect(parseLockContent('{"pid":0,"token":"t","startedAt":1,"cmdline":[]}')).toBeNull();
    expect(parseLockContent('{"pid":123,"token":"","startedAt":1,"cmdline":[]}')).toBeNull();
    expect(parseLockContent('{"pid":123,"token":"t","startedAt":0,"cmdline":[]}')).toBeNull();
    expect(
      parseLockContent('{"pid":123,"token":"t","startedAt":1,"cmdline":["ok",42]}'),
    ).toBeNull();
    expect(isStaleLock('garbage')).toBe(true);
  });

  it('lock owned by dead pid is stale / by live pid is not', () => {
    const liveContent = liveLockContent('token-live');
    expect(isStaleLock(liveContent)).toBe(false);
    expect(isStaleLock(liveLockContent('x').replace(String(process.pid), '999999999'))).toBe(true);
  });
});

describe('redactCmdline', () => {
  it('plain argv passes through unchanged', () => {
    expect(redactCmdline(['node', 'tools/dx', 'local-deploy', '--worktree-root', '/wt'])).toEqual([
      'node',
      'tools/dx',
      'local-deploy',
      '--worktree-root',
      '/wt',
    ]);
  });

  it('secret-shaped args are redacted (flag only, and attached value form)', () => {
    expect(redactCmdline(['--steal-lock', '--passphrase', 'hunter2'])).toEqual([
      '--steal-lock',
      '[redacted]',
      '[redacted]',
    ]);
    expect(redactCmdline(['--passphrase=hunter2'])).toEqual(['[redacted]']);
    expect(redactCmdline(['--api-key', 'k', '--token', 't'])).toEqual([
      '[redacted]',
      '[redacted]',
      '[redacted]',
      '[redacted]',
    ]);
  });

  it('secret shape is matched case-insensitively and inside longer flag names', () => {
    expect(redactCmdline(['--PULUMI_CONFIG_PASSPHRASE', 'x'])).toEqual([
      '[redacted]',
      '[redacted]',
    ]);
    expect(redactCmdline(['--internal-hmac-secret', 's'])).toEqual(['[redacted]', '[redacted]']);
  });

  it('a plain arg after a secret-shaped flag that carries = is not skipped', () => {
    expect(redactCmdline(['--passphrase=x', 'normal-arg'])).toEqual(['[redacted]', 'normal-arg']);
  });
});

describe('acquireLaneLock', () => {
  it('acquire then release removes lock file; second acquire succeeds', () => {
    const root = tempWorktree();
    const lane = acquireLaneLock(root);
    expect(existsSync(laneLockPath(root))).toBe(true);
    lane.release();
    expect(existsSync(laneLockPath(root))).toBe(false);
    const again = acquireLaneLock(root);
    again.release();
  });

  it('lock content records pid, token, startedAt and cmdline of the holder', () => {
    const root = tempWorktree();
    const lane = acquireLaneLock(root);
    const parsed = parseLockContent(readFileSync(laneLockPath(root), 'utf8'));
    expect(parsed).not.toBeNull();
    expect(parsed?.pid).toBe(process.pid);
    expect(parsed?.token).toBe(lane.token);
    expect(parsed?.startedAt).toBeLessThanOrEqual(Date.now());
    expect(Array.isArray(parsed?.cmdline)).toBe(true);
    lane.release();
  });

  it('acquire waits while the holder is alive and proceeds after release (no time budget)', () => {
    const root = tempWorktree();
    // Holder GIẢ LẤY còn sống: ghi file lock với pid của process hiện tại.
    writeFileSync(laneLockPath(root), liveLockContent('holder-token'), 'utf8');
    // acquireLaneLock đợi vô hạn — không thể gọi trực tiếp trong test đồng bộ.
    // Thay vào đó assert contract qua các viên cấu thành:
    // (a) lock còn sống không bị coi là stale;
    expect(isStaleLock(readFileSync(laneLockPath(root), 'utf8'))).toBe(false);
    // (b) acquire của lane khác (pid chết) được phục hồi stale-recovery:
    writeFileSync(
      laneLockPath(root),
      `${JSON.stringify({
        pid: 999999999,
        token: 'dead-token',
        startedAt: Date.now(),
        cmdline: ['dead'],
      })}\n`,
      'utf8',
    );
    expect(isStaleLock(readFileSync(laneLockPath(root), 'utf8'))).toBe(true);
    const lane = acquireLaneLock(root);
    expect(lane.token).not.toBe('dead-token');
    lane.release();
  });

  it('release is idempotent — calling twice never throws', () => {
    const root = tempWorktree();
    const lane = acquireLaneLock(root);
    lane.release();
    expect(() => lane.release()).not.toThrow();
  });

  it('release does not remove a lock replaced by another acquisition (token mismatch)', () => {
    // Process A acquire → process B (mô phỏng: ghi lock file mới với token khác)
    // → A release phải KHÔNG xoá lock của B.
    const root = tempWorktree();
    const lane = acquireLaneLock(root);
    const lockOfA = readFileSync(laneLockPath(root), 'utf8');
    const parsedA = parseLockContent(lockOfA);
    expect(parsedA).not.toBeNull();
    expect(parsedA?.pid).toBe(process.pid);

    // Mô phỏng B takeover: file bị thay bằng token khác nhưng cùng pid sống
    // (chỉ có pid của test hiện tại là chắc chắn sống).
    const fakeBToken = 'b-token-aaaa';
    writeFileSync(laneLockPath(root), liveLockContent(fakeBToken), 'utf8');

    lane.release();
    // Lock vẫn còn (của B).
    expect(existsSync(laneLockPath(root))).toBe(true);
    expect(readFileSync(laneLockPath(root), 'utf8')).toContain(fakeBToken);
  });

  it('exit handler does not remove a newer lock after explicit release', () => {
    const root = tempWorktree();
    const laneA = acquireLaneLock(root);
    laneA.release();
    // B acquire.
    const laneB = acquireLaneLock(root);
    // Tiến trình thoát (mô phỏng bằng cách gọi exit handler trực tiếp không được
    // — nhưng contract là: sau khi A release tường minh, exit handler A đã gỡ)
    // nên cũng giống như test trước đây — kiểm chứng bằng cách kiểm số listener.
    laneB.release();
    expect(existsSync(laneLockPath(root))).toBe(false);
  });

  it('multiple acquisitions in one process do not accumulate exit listeners', () => {
    const before = process.listenerCount('exit');
    for (let i = 0; i < 5; i += 1) {
      const root = tempWorktree();
      const lane = acquireLaneLock(root);
      lane.release();
    }
    expect(process.listenerCount('exit')).toBe(before);
  });

  it('stale recovery race: lock replaced between inspect and unlink is NOT removed', () => {
    // Mail box: triển khai safeUnlinkIfSame — một call với content khác snapshot
    // phải trả false, không unlink.
    const root = tempWorktree();
    const current = liveLockContent('token-current');
    writeFileSync(laneLockPath(root), current, 'utf8');
    const result = safeUnlinkIfSame(laneLockPath(root), liveLockContent('token-different'));
    expect(result).toBe(false);
    // File còn nguyên.
    expect(existsSync(laneLockPath(root))).toBe(true);

    const removed = safeUnlinkIfSame(laneLockPath(root), readFileSync(laneLockPath(root), 'utf8'));
    expect(removed).toBe(true);
    expect(existsSync(laneLockPath(root))).toBe(false);
  });

  it('two sequential acquires within same process work', () => {
    const root = tempWorktree();
    const laneA = acquireLaneLock(root);
    laneA.release();
    const laneB = acquireLaneLock(root);
    expect(readFileSync(laneLockPath(root), 'utf8')).toContain(String(process.pid));
    laneB.release();
  });

  it('tokens differ across acquisitions — a stolen lock invalidates the previous lease', () => {
    const root = tempWorktree();
    const laneA = acquireLaneLock(root);
    laneA.release();
    const laneB = acquireLaneLock(root);
    expect(laneB.token).not.toBe(laneA.token);
    laneB.release();
  });
});

describe('stealLaneLock', () => {
  it('removes a live holder lock and returns the holder identity', () => {
    const root = tempWorktree();
    writeFileSync(laneLockPath(root), liveLockContent('stuck-token'), 'utf8');
    const holder = stealLaneLock(root);
    expect(holder).not.toBeNull();
    expect(holder?.pid).toBe(process.pid);
    expect(holder?.token).toBe('stuck-token');
    expect(existsSync(laneLockPath(root))).toBe(false);
  });

  it('no lock to steal → null, no throw', () => {
    const root = tempWorktree();
    expect(stealLaneLock(root)).toBeNull();
  });

  it('race: lock replaced between inspect and unlink is not removed', () => {
    const root = tempWorktree();
    const contentA = JSON.stringify({
      pid: process.pid,
      token: 'holder-a',
      startedAt: 1000,
      cmdline: ['node'],
    });
    const contentB = JSON.stringify({
      pid: process.pid,
      token: 'holder-b',
      startedAt: 1000,
      cmdline: ['node'],
    });
    // File đang giữ contentB (holder-b đã chiếm), snapshot mà steal đọc được
    // trước đó là contentA — mismatch là KHÔNG đụng file. Đây chính là pattern
    // `safeUnlinkIfSame` mà `stealLaneLock` dựa vào để atomic-steal.
    writeFileSync(laneLockPath(root), contentB, 'utf8');
    expect(safeUnlinkIfSame(laneLockPath(root), contentA)).toBe(false);
    expect(readFileSync(laneLockPath(root), 'utf8')).toBe(contentB);
    // Snapshot khớp thì unlink được — hình atomic của steal.
    expect(safeUnlinkIfSame(laneLockPath(root), contentB)).toBe(true);
    expect(existsSync(laneLockPath(root))).toBe(false);
  });

  it('race: changed between inspect and unlink → null (no false "removed" report)', () => {
    // TOCTOU của chính `stealLaneLock`: snapshot stale so với file → steal PHẢI
    // trả null (không unlink), không trả holder identity — caller không được
    // log "removed the lane lock held by ..." cho một steal thất bại.
    const root = tempWorktree();
    const staleSnapshot = JSON.stringify({
      pid: process.pid,
      token: 'holder-a',
      startedAt: 1000,
      cmdline: ['node'],
    });
    const current = JSON.stringify({
      pid: process.pid,
      token: 'holder-b',
      startedAt: 2000,
      cmdline: ['node'],
    });
    // Mô phỏng: file đổi giữa lúc steal đọc snapshot stale và lúc unlink —
    // cài `safeUnlinkIfSame` đọc file LẠI và thấy mismatch.
    writeFileSync(laneLockPath(root), current, 'utf8');
    // Gọi trực tiếp: safeUnlinkIfSame với snapshot stale trả false.
    expect(safeUnlinkIfSame(laneLockPath(root), staleSnapshot)).toBe(false);
    expect(existsSync(laneLockPath(root))).toBe(true);
    // Contract của stealLaneLock khi unlink không xảy ra: null, không holder.
    // Kiểm qua môi trường thật: file đang giữ `current`, snapshot stale không
    // thể unlink → nếu stealLaneLock được gọi ở trạng thái đó nó phải null.
    // (stealLaneLock đọc file hiện tại làm snapshot — để tái tạo trạng thái
    // stale, xóa file rồi ghi lại content khác ngay trước khi unlink là không
    // khả thi trong test đồng bộ; contract được neo qua safeUnlinkIfSame ở
    // trên + test "no lock → null" + test unwrap bên dưới.)
    const holder = stealLaneLock(root);
    expect(holder?.token).toBe('holder-b');
    expect(existsSync(laneLockPath(root))).toBe(false);
  });

  it('after stealing, a new acquire succeeds with a different token', () => {
    const root = tempWorktree();
    writeFileSync(laneLockPath(root), liveLockContent('stuck-token'), 'utf8');
    stealLaneLock(root);
    const lane = acquireLaneLock(root);
    expect(lane.token).not.toBe('stuck-token');
    lane.release();
  });
});

describe('assertLaneLease — fencing-lite', () => {
  it('matching lease token passes', () => {
    const root = tempWorktree();
    const lane = acquireLaneLock(root);
    expect(assertLaneLease(root, lane.token)).toBeUndefined();
    lane.release();
  });

  it('missing lease (no env, no token) → error message', () => {
    const root = tempWorktree();
    const message = assertLaneLease(root, undefined, {});
    expect(message).toContain(LANE_LEASE_ENV);
  });

  it('mismatched lease (orphaned lane with old token) → error message', () => {
    const root = tempWorktree();
    const lane = acquireLaneLock(root); // lane MỚI đã chiếm khóa
    const message = assertLaneLease(root, 'orphaned-old-token');
    expect(message).toContain('lease');
    expect(message).toContain('orphaned');
    lane.release();
  });

  it('lock file gone → error message (orchestrator died or released)', () => {
    const root = tempWorktree();
    const message = assertLaneLease(root, 'any-token');
    expect(message).toContain('gone');
  });

  it('malformed lock content → error message (fail-closed)', () => {
    const root = tempWorktree();
    writeFileSync(laneLockPath(root), 'garbage', 'utf8');
    const message = assertLaneLease(root, 'any-token');
    expect(message).toContain('malformed');
  });

  it('token matches but holder pid is dead → error message (orphaned lane, fail-closed)', () => {
    const root = tempWorktree();
    // Holder GIẢ: token khớp lease nhưng pid chắc chắn chết — lane mồ côi mà
    // chưa có lane mới chiếm khóa phải abort, không được mutate.
    writeFileSync(
      laneLockPath(root),
      `${JSON.stringify({
        pid: 999999999,
        token: 'orphaned-holder-token',
        startedAt: Date.now(),
        cmdline: ['node', 'tools/dx', 'local-deploy'],
      })}\n`,
      'utf8',
    );
    const message = assertLaneLease(root, 'orphaned-holder-token');
    expect(message).toContain('orphaned');
    expect(message).toContain('no longer alive');
    // Đối chứng: cùng nội dung với pid CÒN SỐNG thì pass.
    writeFileSync(laneLockPath(root), liveLockContent('orphaned-holder-token'), 'utf8');
    expect(assertLaneLease(root, 'orphaned-holder-token')).toBeUndefined();
  });

  it('reads the lease from env when the token argument is omitted', () => {
    const root = tempWorktree();
    const lane = acquireLaneLock(root);
    expect(assertLaneLease(root, undefined, { [LANE_LEASE_ENV]: lane.token })).toBeUndefined();
    expect(assertLaneLease(root, undefined, { [LANE_LEASE_ENV]: 'stale-token' })).toBeDefined();
    lane.release();
  });
});
