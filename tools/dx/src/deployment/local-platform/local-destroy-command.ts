import { defineCommand } from 'citty';

import { localDestroy } from './local-deploy.js';
import {
  requireDirectoryRoot,
  runLocalCommand,
  worktreeRootArg,
} from './../../local-runtime/local-commands.js';

/**
 * Entry `pnpm dx local-destroy`.
 *
 * Teardown có kiểm soát: destroy home trước platform, rồi xử lý volume theo
 * lựa chọn tường minh của người dùng:
 *
 * - Mặc định: GIỮ volume PostgreSQL (dữ liệu persistent của developer còn đó).
 * - `--remove-data`: xoá cả volume — lệnh in cảnh báo trước khi xoá. Đây là
 *   hành động destructive được yêu cầu rõ ràng, không có đường âm thầm nào.
 */
export default defineCommand({
  meta: {
    name: 'local-destroy',
    description:
      'Tear down the local deployment of this worktree; keeps the PostgreSQL volume unless --remove-data',
  },

  args: {
    'remove-data': {
      type: 'boolean',
      description: 'Also remove the PostgreSQL persistent volume (DESTRUCTIVE — data loss)',
      default: false,
    },
    'worktree-root': worktreeRootArg,
  },

  run({ args }) {
    process.exitCode = runLocalCommand('destroy', () =>
      localDestroy({
        worktreeRoot: requireDirectoryRoot(args['worktree-root']),
        removeData: args['remove-data'],
      }),
    );
  },
});
