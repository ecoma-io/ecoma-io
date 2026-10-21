import { defineCommand } from 'citty';

import {
  requireDirectoryRoot,
  runLocalCommandAsync,
  workerWorktreeRootArg,
} from './local-commands.js';
import { startWorkerRuntime, statusWorkerRuntime } from './worker-orchestration.js';

/**
 * Entry `pnpm dx local-worker-up`.
 *
 * Bring up WORKER runtime của worktree — mọi app ecoma có committed
 * `apps/<dir>/wrangler.jsonc` trong worktree này (PR6 discovery): scan
 * configs, suy topology (service binding + queue producer/consumer), rồi
 * từng process `wrangler dev` boot theo thứ tự topological. Runtime chia sẻ
 * `--persist-to` theo worktree; migration D1 local chạy trước khi spawn.
 *
 * Hành vi process-quan-trọng: `startWorkerProcess` spawn worker DETACHED
 * (process group riêng) — sau khi lệnh này exit 0, process tree (`wrangler
 * dev` + `workerd`) TIẾP TỤC SỐNG và dịch HTTP trên các port đã in. Lệnh
 * `local-worker-down` tắt chúng. Đây là thiết kế có chủ ý: CLI chỉ là điểm
 * điều khiển, không phải process manager giữ process con bằng Lifecycle.
 *
 * Readiness trước khi in "ready": control plane-ish app (không queue
 * consumer / workers_dev không tắt) phải trả 2xx cho `GET /health` (poll
 * ≤250ms, timeout 60s); queue-only consumer phải in boot banner wrangler
 * (`/Ready on http/`) ra stdout/stderr. Không đạt → error fail-closed,
 * exitCode 1; process vừa spawn được stop (metadata chỉ remove khi process
 * được chứng minh chết).
 *
 * Partial-runtime khi fail (OCR PR #36 medium): `startWorkerRuntime` chỉ
 * teardown entry vừa fail — entry đã boot thành công trước đó VẪN SỐNG.
 * Lệnh dò lại qua `statusWorkerRuntime` và in cảnh báo tường minh kèm
 * hướng dẫn `local-worker-down`, để caller không tưởng "không gì chạy" trong
 * khi process vẫn giữ port + persist dir.
 */
export default defineCommand({
  meta: {
    name: 'local-worker-up',
    description:
      'Bring up the local worker runtime for all discovered apps (apps/*/wrangler.jsonc) of this worktree',
  },

  args: {
    'worktree-root': workerWorktreeRootArg,
  },

  run({ args }) {
    process.exitCode = 0;
    // Async boundary — orchestration là async; error policy `[local-<cmd>] ...`
    // + exit 1 nằm một nơi duy nhất (`runLocalCommandAsync`).
    void runLocalCommandAsync('worker-up', async () => {
      const worktreeRoot = requireDirectoryRoot(args['worktree-root']) ?? process.cwd();
      try {
        const runtime = await startWorkerRuntime({ worktreeRoot });
        for (const worker of runtime.workers) {
          console.log(
            `worker ${worker.entryName} ready at http://127.0.0.1:${worker.port}/ (pid ${worker.pid})`,
          );
        }
        console.log(
          `worker runtime up (namespace ${runtime.namespace}, persist ${runtime.persistTo})`,
        );
      } catch (error) {
        console.error(
          `[local-worker-up] ${error instanceof Error ? error.message : String(error)}`,
        );
        // Báo partial runtime: entry đã boot thành công trước điểm fail vẫn
        // sống — caller phải biết để down hoặc tránh UP lần nữa trôi port.
        const alive = statusWorkerRuntime({ worktreeRoot }).filter(
          (row) => row.state === 'alive' && row.standard,
        );
        if (alive.length > 0) {
          console.error(
            `[local-worker-up] partial runtime still up: ` +
              `${alive.map((row) => `${row.name} (pid ${row.pid})`).join(', ')} — ` +
              "run 'pnpm dx local-worker-down'",
          );
        }
        process.exitCode = 1;
      }
    });
  },
});
