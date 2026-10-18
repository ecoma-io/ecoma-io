import { defineCommand } from 'citty';

import { localStatus } from './local-deploy.js';

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
    'worktree-root': {
      type: 'string',
      description: 'Worktree root (defaults to this repository checkout)',
      required: false,
    },
  },

  run({ args }) {
    process.exitCode = localStatus({ worktreeRoot: args['worktree-root'] });
  },
});
