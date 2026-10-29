import { defineCommand } from 'citty';

import { runLocalCleanup, type CleanupReport } from './local-cleanup.js';
import { runLocalCommand, worktreeRootArg } from './../../local-runtime/local-commands.js';

/**
 * Entry `pnpm dx local-cleanup`.
 *
 * Dọn Docker resource mồ côi của worktree đã bị xoá. PostgreSQL volume
 * persistent mặc định KHÔNG bị xoá — giữ đúng contract `local-destroy`
 * (dữ liệu chỉ xoá khi `local-destroy --remove-data` opt-in tường minh).
 * `--dry-run` không phát lệnh destructive nào — chỉ báo cáo.
 *
 * KHÔNG lấy khóa lane (#363): quyết định xoá của cleanup dựa trên presence
 * của worktree + labels ownership (bắt buộc đủ bốn label) — không dựa trên
 * pha của apply; race còn lại chỉ là nhiễu báo cáo (inspect lỗi giữa chừng
 * → `skipped`, behavior fail-safe đã tài liệu hoá). Tầng bảo vệ thật là các
 * check đó, không phải khóa.
 */
export default defineCommand({
  meta: {
    name: 'local-cleanup',
    description:
      'Remove orphaned local deployment Docker resources whose worktree no longer exists (preserves live worktrees and persistent PostgreSQL volumes)',
  },

  args: {
    'dry-run': {
      type: 'boolean',
      description: 'Report what would be removed without issuing any destructive Docker command',
      default: false,
    },
    'worktree-root': worktreeRootArg,
  },

  async run({ args }) {
    process.exitCode = await runLocalCommand('cleanup', () => {
      // Filter diagnostics: KHÔNG bắt buộc path tồn tại — worktree bị xoá là
      // đối tượng chính của cleanup, và filter trỏ worktree không còn trên đĩa
      // hợp lệ (chỉ match không resource nào, xem `runLocalCleanup`).
      let worktreeRoot: string | undefined;
      if (typeof args['worktree-root'] === 'string' && args['worktree-root'].length > 0) {
        worktreeRoot = args['worktree-root'];
      }
      const report = runLocalCleanup({
        worktreeRoot,
        dryRun: args['dry-run'] === true,
        env: process.env,
      });
      printReport(report);
      return report.errors.length > 0 ? 1 : 0;
    });
  },
});

function printReport(report: CleanupReport): void {
  console.log('[local-cleanup] results:');
  for (const entry of report.entries) {
    console.log(
      `  ${entry.action.padEnd(13)} ${entry.kind.padEnd(16)} ${entry.name} — ${entry.reason}`,
    );
  }
  if (report.entries.length === 0) {
    console.log('  (no ecoma resources on this host)');
  }
  if (report.errors.length > 0) {
    for (const error of report.errors) {
      console.error(`[local-cleanup] ${error}`);
    }
  }
}
