/**
 * Entry lifecycle local của `backoffice-deploy` — `up`/`down` trên stack
 * Pulumi của CHÍNH project này; thứ tự toàn cục do Nx suy từ `dependsOn` của
 * package.json (backoffice chạy sau home).
 *
 * Chạy qua target Nx: `nx run backoffice-deploy:local-up -c local` → `npx tsx
 * local.ts up`. Entry tự lấy khóa lane quanh phần mutate (xem `withLaneLock`).
 *
 * Secret bảng của backoffice: mật khẩu 2 role PostgreSQL (runtime/migrator)
 * — sinh ngẫu nhiên bằng API mật mã an toàn, xoay mỗi lần up là vô hại vì role
 * được guard-create/ALTER trong cùng lần up đó. Giá trị đi qua STDIN (không
 * argv — tránh rò mật khẩu ra process listing / output lỗi của pulumi, CodeQL
 * clear-text logging).
 */
// oxlint-disable no-console -- entry CLI chạy trên Node; console là kênh
// output DUY NHẤT của lifecycle gate (nx:run-commands gộp stdout/stderr).

// Import **nguồn** `tools/dx` — cùng quy ước với `index.ts` của project này
// (specifier extensionless, disable module-boundary từng dòng; xem comment
// block import của `index.ts`).
// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem giải thích ngay trên
import { generatePostgresPassword } from '../../tools/dx/src/deployment/local-platform/local-env';
// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem giải thích ngay trên
import {
  ensureStackForEntry,
  pulumiDestroyForEntry,
  pulumiUpForEntry,
  resolveEntryFoundation,
  setStackConfig,
  waitForOwnContainerHealthy,
  withLaneLock,
  type EntryFoundation,
} from '../../tools/dx/src/deployment/local-platform/local-entry';

async function prepare(foundation: EntryFoundation): Promise<void> {
  // Stack phải tồn tại trước khi `config set` — lần up đầu trên worktree mới,
  // state dir chưa có và mọi lệnh config exit 1 (xem `ensureStackForEntry`).
  ensureStackForEntry('backoffice-deploy', foundation);
  const secrets: ReadonlyArray<readonly [string, string]> = [
    ['namespace:runtimePassword', generatePostgresPassword()],
    ['namespace:migratorPassword', generatePostgresPassword()],
  ];
  for (const [configKey, configValue] of secrets) {
    setStackConfig('backoffice-deploy', configKey, configValue, foundation);
  }
}

async function main(command: string, stealLock: boolean): Promise<number> {
  if (command === 'up') {
    const foundation = resolveEntryFoundation(true);
    if (foundation === undefined) {
      return 1;
    }
    return withLaneLock(foundation.ctx.worktreeRoot, stealLock, async () => {
      try {
        await prepare(foundation);
        pulumiUpForEntry('backoffice-deploy', foundation);
      } catch (error) {
        console.error(
          `[backoffice-deploy] up failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return 1;
      }
      // Health gate container CỦA CHÍNH unit — backoffice (server container).
      return waitForOwnContainerHealthy(foundation.ctx, 'backoffice');
    });
  }
  if (command === 'down') {
    const foundation = resolveEntryFoundation(false);
    if (foundation === undefined) {
      console.log(
        '[backoffice-deploy] this worktree has never deployed (no .pulumi-local-state) — down is a no-op.',
      );
      return 0;
    }
    return withLaneLock(foundation.ctx.worktreeRoot, stealLock, async () => {
      try {
        pulumiDestroyForEntry('backoffice-deploy', foundation);
        return 0;
      } catch (error) {
        console.error(
          `[backoffice-deploy] down failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return 1;
      }
    });
  }
  console.error(`[backoffice-deploy] unknown command: ${command} (expected: up | down)`);
  return 1;
}

const args = process.argv.slice(2);
const command = args[0] ?? '';
const stealLock = args.includes('--steal-lock');
void main(command, stealLock).then((code) => {
  process.exit(code);
});
