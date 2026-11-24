import { defineCommand } from 'citty';

import { runFormatLint } from './format-lint';
import { readHookPayload } from './stdin';

/**
 * Subcommand `format-lint`: hook PostToolUse của agent (Claude Code, OpenCode).
 *
 * Đọc payload JSON từ stdin, format + lint các file vừa sửa bằng cùng bộ lệnh
 * với pre-commit của lefthook. Exit code: 0 = ok hoặc lỗi tool (không chặn);
 * 2 = oxlint còn lỗi không tự sửa được.
 */
export default defineCommand({
  meta: {
    name: 'format-lint',
    description: 'Format and lint files touched by an agent edit/write hook',
  },
  args: {
    root: {
      type: 'string',
      description:
        'Project root (mặc định: OPENCODE_PROJECT_DIR, rồi tới CLAUDE_PROJECT_DIR, rồi cwd)',
    },
  },
  async run({ args }) {
    const root =
      args.root ??
      process.env['OPENCODE_PROJECT_DIR'] ??
      process.env['CLAUDE_PROJECT_DIR'] ??
      process.cwd();

    const payload = await readHookPayload();
    const { exitCode } = await runFormatLint(payload, { root });

    process.exitCode = exitCode;
  },
});
