import { defineCommand } from 'citty';

import { acquireLocalDeployLock } from './../../local-runtime/local-lock.js';
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
 * Lock phối hợp với `local-deploy`/`local-destroy`: cleanup chạy đồng thời với
 * deploy đang apply sẽ bị chặn để không race vào Docker.
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
      const lock = acquireLocalDeployLock();
      try {
        const report = runLocalCleanup({
          worktreeRoot,
          dryRun: args['dry-run'] === true,
          env: process.env,
        });
        printReport(report);
        return report.errors.length > 0 ? 1 : 0;
      } finally {
        lock();
      }
    });
  },
});

function printReport(report: CleanupReport): void {
  console.log('[local-cleanup] kết quả:');
  for (const entry of report.entries) {
    console.log(
      `  ${entry.action.padEnd(13)} ${entry.kind.padEnd(16)} ${entry.name} — ${entry.reason}`,
    );
  }
  if (report.entries.length === 0) {
    console.log('  (không có resource ecoma nào trên host)');
  }
  if (report.errors.length > 0) {
    for (const error of report.errors) {
      console.error(`[local-cleanup] ${error}`);
    }
  }
}
