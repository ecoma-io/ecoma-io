/**
 * Entry lifecycle local của `platform-deploy` — `up`/`down`/`smoke` trên stack
 * Pulumi của CHÍNH project này. Platform là node ĐẦU của chuỗi lane local
 * (không `dependsOn` local-up nào) và node CUỐI qua target `local-smoke`
 * (dependsOn cả bốn lá).
 *
 * Chạy qua target Nx: `nx run platform-deploy:local-up -c local` → `npx tsx
 * local.ts up` (tương tự `down`/`smoke`). Entry tự lấy khóa lane quanh phần
 * mutate (xem `withLaneLock`).
 *
 * `up` gồm ba giai đoạn trong một khóa lane:
 * 1. `resolvePostgresPassword` — đọc lại mật khẩu PostgreSQL từ stack config
 *    (canonical), chỉ sinh mới khi stack mới VÀ chưa có volume; fail có
 *    hướng dẫn khi config mất mà volume còn (không bao giờ sinh mật khẩu
 *    không khớp volume đã init).
 * 2. `pulumi up` — Traefik + PostgreSQL + network; outputs chỉ tồn tại sau
 *    khi up xanh.
 * 3. Đọc outputs (port Traefik thật do Docker cấp) rồi upsert `.env` đúng 3
 *    key sở hữu (ROOT_HOST/ROOT_DOMAIN/POSTGRES_PASSWORD); mọi key khác trong
 *    file giữ nguyên byte-for-byte. `.env` là artifact — nguồn sự thật là
 *    stack config/outputs; mọi unit kế tiếp đọc ROOT_HOST từ file này.
 *
 * `smoke` chạy SAU khi toàn bộ chuỗi unit xanh (dependsOn của target): smoke
 * HTTPS qua Traefik với certificate local (script `.mjs` cùng bản với
 * orchestration cũ).
 *
 * `down` giữ volume PostgreSQL theo mặc định (dữ liệu persistent của
 * developer) và KHÔNG dùng `pulumi stack rm`; khi được gọi với cờ
 * `--remove-data`, xoá luôn volume sau khi destroy với cảnh báo trước — đúng
 * contract `local-cleanup` (#420): node platform là nơi duy nhất biết volume
 * nào thuộc namespace của mình.
 */
// oxlint-disable no-console -- entry CLI chạy trên Node; console là kênh
// output DUY NHẤT của lifecycle gate (nx:run-commands gộp stdout/stderr).

import { join } from 'node:path';

// Import **nguồn** `tools/dx` — cùng quy ước với `index.ts` của project này
// (specifier extensionless, disable module-boundary từng dòng; xem comment
// block import của `index.ts`).
// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem giải thích ngay trên
import {
  readPlatformOutputs,
  resolvePostgresPassword,
  upsertLocalEnv,
} from '../../tools/dx/src/deployment/local-platform/local-env';
// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem giải thích ngay trên
import { exec } from '../../tools/dx/src/deployment/local-platform/pulumi-context';
// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem giải thích ngay trên
import {
  pulumiDestroyForEntry,
  pulumiUpForEntry,
  resolveEntryFoundation,
  runEntrySmoke,
  waitForOwnContainerHealthy,
  withLaneLock,
  type EntryFoundation,
} from '../../tools/dx/src/deployment/local-platform/local-entry';
// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem giải thích ngay trên
import {
  POSTGRES_PASSWORD_ENV_KEY,
  ROOT_DOMAIN_ENV_KEY,
  ROOT_HOST_ENV_KEY,
} from '../../tools/dx/src/deployment/local-platform/platform-outputs-contract';
// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem giải thích ngay trên
import { dockerResourceName } from '../../tools/dx/src/local-runtime/deploy-namespace';
// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem giải thích ngay trên
import { ROOT_DIR } from '../../tools/dx/src/utils';

async function up(foundation: EntryFoundation): Promise<number> {
  try {
    // Mật khẩu PostgreSQL: đọc lại từ stack config (canonical), chỉ sinh mới
    // khi stack mới VÀ chưa có volume. Fail-loud với hướng dẫn khi config mất
    // mà volume còn.
    const resolution = resolvePostgresPassword(foundation.ctx, foundation.env);
    if (!resolution.ok) {
      console.error(`[platform-deploy] ${resolution.error}`);
      return 1;
    }
    if (resolution.generated) {
      console.log(
        '[platform-deploy] postgres:password generated randomly and stored in the local stack config.',
      );
    }
    pulumiUpForEntry('platform-deploy', foundation);
    // Đọc outputs thực tế (port do Docker cấp chỉ tồn tại sau up), rồi upsert
    // `.env` (chỉ key sở hữu). `.env` nhận CÙNG giá trị mật khẩu đã lưu trong
    // stack config — mật khẩu không được sinh lần thứ hai ở đây: hai nguồn
    // lệch nhau là consumer đọc `.env` sẽ dùng mật khẩu khác với mật khẩu
    // Postgres thật.
    const outputs = readPlatformOutputs(
      join(ROOT_DIR, 'deploys', 'platform-deploy'),
      foundation.ctx,
      foundation.env,
    );
    const { envPath } = upsertLocalEnv(foundation.ctx.worktreeRoot, {
      [ROOT_HOST_ENV_KEY]: outputs.rootHost,
      [ROOT_DOMAIN_ENV_KEY]: outputs.rootHost,
      [POSTGRES_PASSWORD_ENV_KEY]: resolution.password,
    });
    console.log(
      `${ROOT_HOST_ENV_KEY}=${outputs.rootHost}, ${ROOT_DOMAIN_ENV_KEY}=${outputs.rootHost} and ` +
        `${POSTGRES_PASSWORD_ENV_KEY} written to ${envPath}`,
    );
    // Health gate container CỦA CHÍNH unit — PostgreSQL là container cuối cùng
    // lên và `pg_isready` là probe chậm nhất; Traefik lên trước nó.
    return waitForOwnContainerHealthy(foundation.ctx, 'postgres');
  } catch (error) {
    console.error(
      `[platform-deploy] up failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

async function down(foundation: EntryFoundation, removeData: boolean): Promise<number> {
  const volumeName = dockerResourceName(foundation.ctx.namespace, 'postgres-volume');
  try {
    pulumiDestroyForEntry('platform-deploy', foundation);
  } catch (error) {
    // Destroy KHÔNG chặn bước xoá volume khi người dùng yêu cầu `--remove-data`:
    // lời hứa của lệnh là XOÁ dữ liệu — nếu stack Pulumi đã biến mất (`pulumi
    // stack rm` ngoài luồng, state hỏng...) thì destroy coi như đã xong phần
    // đó, và bước xoá volume vẫn phải chạy. Với lỗi Pulumi khác (daemon down,
    // sai passphrase...), cũng tiếp tục tới volume theo yêu cầu nhưng báo rõ.
    if (removeData !== true) {
      console.error(
        `[platform-deploy] down failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
    console.error(
      '[platform-deploy] Pulumi destroy did not complete (stderr above) — continuing to ' +
        'delete the volume as requested by --remove-data. Resources left in state (if any) ' +
        'are not cleaned up; re-check manually.',
    );
  }
  if (removeData === true) {
    console.warn(
      `[platform-deploy] WARNING: deleting PostgreSQL volume ${volumeName} — the local database ` +
        'data of this worktree will be permanently lost.',
    );
    const vol = exec('docker', ['volume', 'rm', volumeName], ROOT_DIR, process.env);
    if (vol.status !== 0) {
      console.error(
        `[platform-deploy] volume deletion failed (it may already be gone):\n${vol.stderr}`,
      );
      return 1;
    }
    console.log(`[platform-deploy] volume ${volumeName} deleted.`);
  } else {
    console.log(
      `[platform-deploy] PostgreSQL volume ${volumeName} KEPT (data intact). ` +
        'To delete it: run again with --remove-data.',
    );
  }
  return 0;
}

async function main(
  command: string,
  flags: { stealLock: boolean; removeData: boolean },
): Promise<number> {
  if (command === 'up') {
    const foundation = resolveEntryFoundation(true);
    if (foundation === undefined) {
      return 1;
    }
    return withLaneLock(foundation.ctx.worktreeRoot, flags.stealLock, () => up(foundation));
  }
  if (command === 'down') {
    const foundation = resolveEntryFoundation(false);
    if (foundation === undefined) {
      console.log(
        '[platform-deploy] this worktree has never deployed (no .pulumi-local-state) — down is a no-op.',
      );
      return 0;
    }
    return withLaneLock(foundation.ctx.worktreeRoot, flags.stealLock, () =>
      down(foundation, flags.removeData),
    );
  }
  if (command === 'smoke') {
    const foundation = resolveEntryFoundation(false);
    // Smoke KHÔNG cần passphrase (chỉ đọc `.env` + HTTP) — worktree chưa từng
    // deploy thì `.env` không tồn tại và smoke fail với thông điệp rõ.
    const root = foundation?.ctx.worktreeRoot;
    return runEntrySmoke(root ?? join(ROOT_DIR));
  }
  console.error(`[platform-deploy] unknown command: ${command} (expected: up | down | smoke)`);
  return 1;
}

const args = process.argv.slice(2);
const command = args[0] ?? '';
const flags = {
  stealLock: args.includes('--steal-lock'),
  removeData: args.includes('--remove-data'),
};
void main(command, flags).then((code) => {
  process.exit(code);
});
