import { defineCommand } from 'citty';

import { localDeploy } from './local-deploy.js';
import { requireDirectoryRoot, runLocalCommand, worktreeRootArg } from './local-commands.js';

/**
 * Entry `pnpm dx local-deploy`.
 *
 * Đây là lệnh APPLY THẬT (thay đổi Docker resource trên máy developer), khác
 * với `provision-gate` (dry-run an toàn của CI). Hai thao tác tách bạch theo
 * contract: preview dùng `--preview`, apply là nhánh mặc định của lệnh này do
 * người dùng gọi tường minh — không đường nào biến dry-run thành destructive
 * một cách âm thầm.
 *
 * `process.exitCode` thay vì `process.exit()` để stdout kịp flush — cùng lý do
 * provision-gate làm vậy.
 */
export default defineCommand({
  meta: {
    name: 'local-deploy',
    description:
      'Deploy the local platform (network, Traefik, PostgreSQL) and the home container for this worktree',
  },

  args: {
    preview: {
      type: 'boolean',
      description:
        'Preview only — no Docker apply, no .env write (still writes local Pulumi state: stack init + generated postgres:password secret)',
      default: false,
    },
    'worktree-root': worktreeRootArg,
  },

  run({ args }) {
    process.exitCode = runLocalCommand('deploy', () =>
      localDeploy({
        worktreeRoot: requireDirectoryRoot(args['worktree-root']),
        previewOnly: args.preview,
      }),
    );
  },
});
