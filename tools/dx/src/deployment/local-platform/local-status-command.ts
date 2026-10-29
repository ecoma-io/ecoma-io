import { defineCommand } from 'citty';

import { localStatus } from './local-status.js';
import {
  requireDirectoryRoot,
  runLocalCommand,
  worktreeRootArg,
} from './../../local-runtime/local-commands.js';

/**
 * Entry `pnpm dx local-status`.
 *
 * Lệnh read-only: in namespace, resource names, và outputs platform hiện có.
 * Không up/destroy gì — an toàn để chạy bất cứ lúc nào.
 */
export default defineCommand({
  meta: {
    name: 'local-status',
    description: 'Show the local deployment namespace, resources and platform outputs',
  },

  args: {
    'worktree-root': worktreeRootArg,
  },

  async run({ args }) {
    process.exitCode = await runLocalCommand('status', () =>
      localStatus({ worktreeRoot: requireDirectoryRoot(args['worktree-root']) }),
    );
  },
});
