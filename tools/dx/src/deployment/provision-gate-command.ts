import { defineCommand } from 'citty';

import { provisionGate } from './provision-gate.js';

/**
 * Entry `pnpm dx provision-gate`.
 *
 * Cố ý KHÔNG có flag nào để "apply": một cổng provision mà có đường chạy thật
 * là một cổng provision có thể provision. Thực thi hạ tầng là `pulumi up` do
 * operator chạy, không phải một subcommand của DX.
 *
 * `process.exitCode` thay vì `process.exit()` để stdout kịp flush — cùng lý do
 * pr-check và arch-check làm vậy.
 */
export default defineCommand({
  meta: {
    name: 'provision-gate',
    description: 'Print the Pulumi stack a deploy project would provision, without provisioning',
  },

  run() {
    process.exitCode = provisionGate();
  },
});
