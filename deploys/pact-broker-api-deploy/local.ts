/**
 * Entry lifecycle local của `pact-broker-api-deploy` — `up`/`down` trên stack
 * Pulumi của CHÍNH project này; thứ tự toàn cục do Nx suy từ `dependsOn` của
 * package.json (api phụ thuộc platform + build bundle app).
 *
 * Chạy qua target Nx: `nx run pact-broker-api-deploy:local-up -c local` →
 * `npx tsx local.ts up`. Entry tự lấy khóa lane quanh phần mutate (xem
 * `withLaneLock`).
 *
 * Secret bảng của api:
 * - Mật khẩu 2 role PostgreSQL (runtime/migrator) — sinh ngẫu nhiên bằng API
 *   mật mã an toàn, xoay mỗi lần up là vô hại vì role được guard-create/ALTER
 *   trong cùng lần up đó.
 * - `machineToken`: PERSISTOR của token machine plaintext mà consumer local
 *   (`pact-broker-app-deploy`) đọc lại qua cross-stack `config get` — api chỉ
 *   seed HASH SHA-256 vào DB (`machine_token_hash`), plaintext sống duy nhất
 *   ở stack config (cùng hình auth đọc `internalHmacSecret` từ account stack).
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
  pulumiDestroyForEntry,
  pulumiUpForEntry,
  resolveEntryFoundation,
  setStackConfig,
  waitForOwnContainerHealthy,
  withLaneLock,
  type EntryFoundation,
} from '../../tools/dx/src/deployment/local-platform/local-entry';

async function prepare(foundation: EntryFoundation): Promise<void> {
  const secrets: ReadonlyArray<readonly [string, string]> = [
    ['namespace:runtimePassword', generatePostgresPassword()],
    ['namespace:migratorPassword', generatePostgresPassword()],
    // Machine token plaintext của consumer local (`pact-broker-app`): stack
    // này seed HASH SHA-256 vào DB; plaintext nằm ở stack config để unit
    // pact-app đọc qua cross-stack `pulumi config get`.
    ['namespace:machineToken', generatePostgresPassword()],
  ];
  for (const [configKey, configValue] of secrets) {
    setStackConfig('pact-broker-api-deploy', configKey, configValue, foundation);
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
        pulumiUpForEntry('pact-broker-api-deploy', foundation);
      } catch (error) {
        console.error(
          `[pact-broker-api-deploy] up failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return 1;
      }
      // Health gate container CỦA CHÍNH unit — WIC pact-api.
      return waitForOwnContainerHealthy(foundation.ctx, 'pact-api-wic');
    });
  }
  if (command === 'down') {
    const foundation = resolveEntryFoundation(false);
    if (foundation === undefined) {
      console.log(
        '[pact-broker-api-deploy] this worktree has never deployed (no .pulumi-local-state) — down is a no-op.',
      );
      return 0;
    }
    return withLaneLock(foundation.ctx.worktreeRoot, stealLock, async () => {
      try {
        pulumiDestroyForEntry('pact-broker-api-deploy', foundation);
        return 0;
      } catch (error) {
        console.error(
          `[pact-broker-api-deploy] down failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return 1;
      }
    });
  }
  console.error(`[pact-broker-api-deploy] unknown command: ${command} (expected: up | down)`);
  return 1;
}

const args = process.argv.slice(2);
const command = args[0] ?? '';
const stealLock = args.includes('--steal-lock');
void main(command, stealLock).then((code) => {
  process.exit(code);
});
