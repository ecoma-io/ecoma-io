/**
 * Hợp phần chung của ba lệnh `local-*`: arg `--worktree-root` và error boundary.
 *
 * `--worktree-root` là test seam được lộ ra CLI: hàm orchestration nhận tham số
 * để spec truyền thư mục tạm, còn CLI thì mặc định checkout hiện hành. NGHĨA
 * CHÍNH XÁC: flag chỉ đổi **state/namespace/.env** của worktree đích (namespace
 * Docker, Pulumi stack, `.pulumi-local-state`, `.env`); chương trình Pulumi và
 * smoke vẫn chạy từ checkout ĐANG GÕ LỆNH (`ROOT_DIR`) — không phải "chạy deploy
 * của worktree kia". Description của arg phải nói đúng điều đó.
 */
import { statSync } from 'node:fs';

/** Arg `--worktree-root` dùng chung cho cả ba lệnh `local-*` — một bản duy nhất. */
export const worktreeRootArg = {
  type: 'string',
  description:
    'Worktree whose state/namespace/.env is targeted (Docker namespace, Pulumi stack, ' +
    '.pulumi-local-state); defaults to this checkout — the Pulumi program always runs from it',
  required: false,
} as const;

/**
 * Error boundary của entry `run()`: mọi exception thoát từ hàm orchestration
 * (path không tồn tại từ `realpathSync`, `.env` không đọc được, Pulumi fail
 * ngoài nhánh đã xử lý...) thành thông điệp `[local-<cmd>] <lý do>` + exit 1 —
 * thay vì stack trace Node với exit code không kiểm soát được.
 */
export function runLocalCommand(command: string, action: () => number): number {
  try {
    return action();
  } catch (error) {
    console.error(`[local-${command}] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/** Validate `--worktree-root` ở biên CLI: phải là thư mục tồn tại. */
export function requireDirectoryRoot(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  if (!statSync(raw).isDirectory()) {
    throw new Error(`--worktree-root không phải thư mục: ${raw}`);
  }
  return raw;
}
