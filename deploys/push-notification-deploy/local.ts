/**
 * Entry lifecycle local của `push-notification-deploy` — `up`/`down` trên
 * stack Pulumi của CHÍNH project này; thứ tự toàn cục do Nx suy từ `dependsOn`
 * của package.json (push phụ thuộc platform cho network/DB platform).
 *
 * Chạy qua target Nx: `nx run push-notification-deploy:local-up -c local` →
 * `npx tsx local.ts up`. Entry tự lấy khóa lane quanh phần mutate (xem
 * `withLaneLock`).
 *
 * Cả BỐN secret là CỦA RIÊNG cặp push local (không stack nào khác đọc): hai
 * process của cặp sống trong MỘT container WIC nên entry cấp ĐỒNG BỘ giá trị
 * mới trong CÙNG một lần up — không cần persistence cross-stack.
 * `runtimeSharedSecret` đi vào CẢ HAI worker (control plane
 * `RUNTIME_API_SHARED_SECRET` + consumer cùng biến, hai env NAME một giá trị);
 * `credentialRootKey` là base64 của 32 byte AES-256 (mà `buildCipher` kiểm) —
 * xoay mỗi lần up là vô hại vì D1 `push` trên volume state là ephemeral theo
 * thiết kế local (không credential nào sống qua hai lần up).
 */
// oxlint-disable no-console -- entry CLI chạy trên Node; console là kênh
// output DUY NHẤT của lifecycle gate (nx:run-commands gộp stdout/stderr).

// Import **nguồn** `tools/dx` — cùng quy ước với `index.ts` của project này
// (specifier extensionless, disable module-boundary từng dòng; xem comment
// block import của `index.ts`).
// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem giải thích ngay trên
import {
  generateBase64Key32,
  generateInternalHmacSecret,
} from '../../tools/dx/src/deployment/local-platform/local-env';
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
    ['namespace:runtimeSharedSecret', generateInternalHmacSecret()],
    ['namespace:adminToken', generateInternalHmacSecret()],
    ['namespace:applicationToken', generateInternalHmacSecret()],
    ['namespace:credentialRootKey', generateBase64Key32()],
  ];
  for (const [configKey, configValue] of secrets) {
    setStackConfig('push-notification-deploy', configKey, configValue, foundation);
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
        pulumiUpForEntry('push-notification-deploy', foundation);
      } catch (error) {
        console.error(
          `[push-notification-deploy] up failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return 1;
      }
      // Health gate container CỦA CHÍNH unit — WIC push.
      return waitForOwnContainerHealthy(foundation.ctx, 'push-wic');
    });
  }
  if (command === 'down') {
    const foundation = resolveEntryFoundation(false);
    if (foundation === undefined) {
      console.log(
        '[push-notification-deploy] this worktree has never deployed (no .pulumi-local-state) — down is a no-op.',
      );
      return 0;
    }
    return withLaneLock(foundation.ctx.worktreeRoot, stealLock, async () => {
      try {
        pulumiDestroyForEntry('push-notification-deploy', foundation);
        return 0;
      } catch (error) {
        console.error(
          `[push-notification-deploy] down failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return 1;
      }
    });
  }
  console.error(`[push-notification-deploy] unknown command: ${command} (expected: up | down)`);
  return 1;
}

const args = process.argv.slice(2);
const command = args[0] ?? '';
const stealLock = args.includes('--steal-lock');
void main(command, stealLock).then((code) => {
  process.exit(code);
});
