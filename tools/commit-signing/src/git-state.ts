/**
 * Liệt kê những gì git cho thấy về trạng thái hiện tại: `HEAD` và các commit
 * chưa có trên remote nào.
 */

import { execFileSync } from 'node:child_process';

import { ROOT_DIR, gitEnv } from './utils.js';

import { COMMIT_ID } from './commit-objects.js';

export type CommitListing = { ok: true; commits: string[] } | { ok: false; reason: string };

/**
 * Commit đang trỏ tới bởi `HEAD`, hoặc `undefined` khi repository chưa có commit.
 *
 * Repo rỗng là một trường hợp hợp lệ, không phải lỗi: `git commit` đầu tiên sẽ tạo
 * ra `HEAD`, và lúc đó chính hook mới kiểm. Nên nó phân biệt với `ok: false` — một
 * repo không đọc được `HEAD` thì gate fail closed.
 */
export type HeadLookup = { ok: true; sha: string | undefined } | { ok: false; reason: string };

/**
 * `HEAD` hiện tại.
 *
 * `git rev-parse --verify HEAD` tự fail khi chưa có commit, nên phân biệt "repo
 * chưa có commit" với "git không chạy được" bằng exit code rồi mới quyết định —
 * stderr của git không phải hợp đồng ổn định để dự vào.
 */
export function readHeadFromGit(cwd: string = ROOT_DIR): HeadLookup {
  try {
    const output = execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], {
        cwd,
        encoding: 'utf8',
        env: gitEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      sha = output.trim();

    if (!COMMIT_ID.test(sha)) {
      return { ok: false, reason: `git rev-parse did not return a commit id: "${sha}".` };
    }

    return { ok: true, sha };
  } catch (error) {
    const code = (error as { status?: number } | null)?.status;

    if (code === 1) {
      return { ok: true, sha: undefined };
    }

    return {
      ok: false,
      reason: `git could not read HEAD: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Các commit chưa có trên bất kỳ remote nào.
 *
 * Đây là phần tối ưu tốc độ: gate chỉ xét commit **sắp được đẩy lên**, không
 * đi qua toàn bộ lịch sử. Nhánh đã đồng bộ với remote trả về danh sách rỗng và
 * gate thoát ngay, thay vì phải đọc lại mọi commit từng tồn tại.
 *
 * Dùng `--not --remotes` chứ không phải `--not --remotes=origin` vì lefthook đã
 * nuốt mất stdin của pre-push (đo được 0 byte, kể cả với
 * `LEFTHOOK_LEGACY_STDIN=1`) và không expose biến nào cho ref đang đẩy — không
 * có cách nào biết tên remote. `--not --remotes` không cần tên remote và bảo thủ
 * hơn: một commit đã có trên remote nào đó không bị coi là cần kiểm.
 *
 * Ranh giới đã biết: range lấy từ `HEAD`, nên đẩy một nhánh cục bộ **khác**
 * không thấy commit nào và gate pass. `--branches` đóng được lỗ hổng đó nhưng
 * lại quét cả nhánh không liên quan, tức không còn là "đúng cái đang đẩy".
 *
 * Repo không có remote nào thì mọi commit đều chưa từng được đẩy và xuất hiện
 * trong danh sách — đúng như tên gọi, và an toàn hơn là bỏ qua.
 */
export function listUnpushedCommits(cwd: string = ROOT_DIR): CommitListing {
  try {
    const output = execFileSync('git', ['rev-list', 'HEAD', '--not', '--remotes'], {
        cwd,
        encoding: 'utf8',
        env: gitEnv(),
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      commits = output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== ''),
      malformed = commits.find((commit) => !COMMIT_ID.test(commit));
    if (malformed !== undefined) {
      return {
        ok: false,
        reason: `git rev-list returned something that is not a commit id: "${malformed}".`,
      };
    }

    return { commits, ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `git could not list the unpushed commits: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
