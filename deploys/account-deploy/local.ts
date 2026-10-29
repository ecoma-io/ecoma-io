/**
 * Entry lifecycle local của `account-deploy` — `up`/`down` trên stack Pulumi
 * của CHÍNH project này; thứ tự toàn cục do Nx suy từ `dependsOn` của
 * package.json (account chạy sau backoffice, trước auth và mail).
 *
 * Chạy qua target Nx: `nx run account-deploy:local-up -c local` → `npx tsx
 * local.ts up`. Entry tự lấy khóa lane quanh phần mutate (xem `withLaneLock`).
 *
 * Account là PERSISTOR của hai secret dùng chung — sinh MỘT giá trị khi up và
 * persist vào stack config của chính nó; unit chạy sau đọc lại:
 *
 * - `internalHmacSecret` (auth đọc lại làm `internalSecret`): envelope HMAC
 *   hai chiều auth <-> account. Sinh hai giá trị độc lập là mọi envelope
 *   internal chết `bad_signature` lúc runtime.
 * - `mailInternalAuthSecret` (transactional-mail-deploy đọc lại): path HMAC
 *   Account↔Mail (OTP). PHẢI khác `internalHmacSecret` — validation của
 *   account từ chối hai secret trùng nhau, và registry của receiver mail coi
 *   mỗi entry là một credential riêng.
 *
 * Các secret còn lại là của riêng account: mật khẩu 4 role PostgreSQL
 * (owner/runtime/migrator/pruner — account SỞ HỮU role owner `ecoma_owner`
 * chung cluster) và `otpHmacSecret`. Mật khẩu sinh bằng API mật mã an toàn và
 * xoay mỗi lần up (role được guard-create/ALTER trong cùng lần up).
 */
// oxlint-disable no-console -- entry CLI chạy trên Node; console là kênh
// output DUY NHẤT của lifecycle gate (nx:run-commands gộp stdout/stderr).

// Import **nguồn** `tools/dx` — cùng quy ước với `index.ts` của project này
// (specifier extensionless, disable module-boundary từng dòng; xem comment
// block import của `index.ts`).
// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem giải thích ngay trên
import {
  generateInternalHmacSecret,
  generatePostgresPassword,
} from '../../tools/dx/src/deployment/local-platform/local-env';
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
  ensureStackForEntry('account-deploy', foundation);
  const secrets: ReadonlyArray<readonly [string, string]> = [
    ['namespace:ownerPassword', generatePostgresPassword()],
    ['namespace:runtimePassword', generatePostgresPassword()],
    ['namespace:migratorPassword', generatePostgresPassword()],
    ['namespace:prunerPassword', generatePostgresPassword()],
    ['namespace:internalHmacSecret', generateInternalHmacSecret()],
    ['namespace:mailInternalAuthSecret', generateInternalHmacSecret()],
    ['namespace:otpHmacSecret', generatePostgresPassword()],
  ];
  for (const [configKey, configValue] of secrets) {
    setStackConfig('account-deploy', configKey, configValue, foundation);
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
        pulumiUpForEntry('account-deploy', foundation);
      } catch (error) {
        console.error(
          `[account-deploy] up failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return 1;
      }
      // Health gate container CỦA CHÍNH unit (app account + provision/migrate
      // đã chạy trong chương trình Pulumi trước khi container chính lên).
      return waitForOwnContainerHealthy(foundation.ctx, 'account');
    });
  }
  if (command === 'down') {
    const foundation = resolveEntryFoundation(false);
    if (foundation === undefined) {
      console.log(
        '[account-deploy] this worktree has never deployed (no .pulumi-local-state) — down is a no-op.',
      );
      return 0;
    }
    return withLaneLock(foundation.ctx.worktreeRoot, stealLock, async () => {
      try {
        pulumiDestroyForEntry('account-deploy', foundation);
        return 0;
      } catch (error) {
        console.error(
          `[account-deploy] down failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return 1;
      }
    });
  }
  console.error(`[account-deploy] unknown command: ${command} (expected: up | down)`);
  return 1;
}

const args = process.argv.slice(2);
const command = args[0] ?? '';
const stealLock = args.includes('--steal-lock');
void main(command, stealLock).then((code) => {
  process.exit(code);
});
