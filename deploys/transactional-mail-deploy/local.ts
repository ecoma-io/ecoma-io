/**
 * Entry lifecycle local của `transactional-mail-deploy` — `up`/`down` trên
 * stack Pulumi của CHÍNH project này; thứ tự toàn cục do Nx suy từ `dependsOn`
 * của package.json (mail chạy sau account vì đọc secret cross-stack từ stack
 * account).
 *
 * Chạy qua target Nx: `nx run transactional-mail-deploy:local-up -c local` →
 * `npx tsx local.ts up`. Entry tự lấy khóa lane quanh phần mutate (xem
 * `withLaneLock`).
 *
 * Secret bảng của mail:
 * - `mailInternalAuthSecret`: ĐỌC LẠI từ stack config của account (account đã
 *   persist khi up trước đó theo dependsOn) — receiver mail giữ nó làm entry
 *   `MAIL_INTERNAL_AUTH_SECRET_SVC_ACCOUNT` của credential registry, account
 *   ký envelope với cùng giá trị đó.
 * - Ba secret còn lại là CỦA RIÊNG cặp mail local (không stack nào khác đọc):
 *   `mailerJobInternalSecret` (HMAC consumer<->control plane),
 *   `mailFingerprintKey` + `mailQuarantineHmacKey` (khoá keyring fingerprint,
 *   khoá quarantine — hình 64 hex chữ thường là contract loader). Sinh tại
 *   chỗ mỗi lần up: hai process của cặp nhận ĐỒNG BỘ giá trị mới trong CÙNG
 *   một lần up nên không bao giờ lệch nhau (cùng chu kỳ xoay với
 *   `otpHmacSecret`, `cookieKeys`).
 */
// oxlint-disable no-console -- entry CLI chạy trên Node; console là kênh
// output DUY NHẤT của lifecycle gate (nx:run-commands gộp stdout/stderr).

// Import **nguồn** `tools/dx` — cùng quy ước với `index.ts` của project này
// (specifier extensionless, disable module-boundary từng dòng; xem comment
// block import của `index.ts`).
// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem giải thích ngay trên
import {
  generateHexKey64,
  generateInternalHmacSecret,
} from '../../tools/dx/src/deployment/local-platform/local-env';
// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem giải thích ngay trên
import { exec, fullStackRef } from '../../tools/dx/src/deployment/local-platform/pulumi-context';
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
import { join } from 'node:path';

// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem giải thích ngay trên
import { ROOT_DIR } from '../../tools/dx/src/utils';

/**
 * Giá trị HMAC dùng chung account <-> transactional-mail — ĐỌC LẠI từ stack
 * config của account.
 *
 * Account (chạy trước theo dependsOn) SINH giá trị mới và persist vào stack
 * config của chính nó (`namespace:mailInternalAuthSecret`); mail đọc lại để
 * hai stack nhận đúng MỘT giá trị.
 */
function resolveMailInternalAuthSecret(foundation: EntryFoundation): string {
  const read = exec(
    'pulumi',
    [
      'config',
      'get',
      'namespace:mailInternalAuthSecret',
      '--stack',
      fullStackRef('account-deploy', foundation.ctx),
    ],
    join(ROOT_DIR, 'deploys', 'account-deploy'),
    foundation.env,
  );
  if (read.status === 0 && read.stdout.trim().length > 0) {
    return read.stdout.trim();
  }
  // Cùng luật không-leak với nhánh auth: raw stdout của `config get` khi exit 0
  // chính là secret — không bao giờ ghép vào error string.
  console.error(
    '[transactional-mail-deploy] up: reading namespace:mailInternalAuthSecret from the ' +
      `account-deploy stack failed (exit ${String(read.status)}) — account up must run ` +
      'BEFORE transactional-mail-deploy (dependsOn). Run `pulumi config get ' +
      'namespace:mailInternalAuthSecret --stack <account-stack-ref>` in ' +
      'deploys/account-deploy to see the original stderr — the output of that command is ' +
      'never logged because it may contain the secret.',
  );
  process.exit(1);
}

async function prepare(foundation: EntryFoundation): Promise<void> {
  const mailInternalAuthSecret = resolveMailInternalAuthSecret(foundation);
  const secrets: ReadonlyArray<readonly [string, string]> = [
    ['namespace:mailInternalAuthSecret', mailInternalAuthSecret],
    ['namespace:mailerJobInternalSecret', generateInternalHmacSecret()],
    ['namespace:mailFingerprintKey', generateHexKey64()],
    ['namespace:mailQuarantineHmacKey', generateHexKey64()],
  ];
  for (const [configKey, configValue] of secrets) {
    setStackConfig('transactional-mail-deploy', configKey, configValue, foundation);
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
        pulumiUpForEntry('transactional-mail-deploy', foundation);
      } catch (error) {
        console.error(
          `[transactional-mail-deploy] up failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return 1;
      }
      // Health gate container CỦA CHÍNH unit — WIC mail (startPeriod 120s,
      // budget 90s của health gate là đủ sau khi Pulumi đã chờ container).
      return waitForOwnContainerHealthy(foundation.ctx, 'mail-wic');
    });
  }
  if (command === 'down') {
    const foundation = resolveEntryFoundation(false);
    if (foundation === undefined) {
      console.log(
        '[transactional-mail-deploy] this worktree has never deployed (no .pulumi-local-state) — down is a no-op.',
      );
      return 0;
    }
    return withLaneLock(foundation.ctx.worktreeRoot, stealLock, async () => {
      try {
        pulumiDestroyForEntry('transactional-mail-deploy', foundation);
        return 0;
      } catch (error) {
        console.error(
          `[transactional-mail-deploy] down failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return 1;
      }
    });
  }
  console.error(`[transactional-mail-deploy] unknown command: ${command} (expected: up | down)`);
  return 1;
}

const args = process.argv.slice(2);
const command = args[0] ?? '';
const stealLock = args.includes('--steal-lock');
void main(command, stealLock).then((code) => {
  process.exit(code);
});
