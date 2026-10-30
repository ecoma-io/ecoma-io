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
 * `down` xoá volume PostgreSQL VÔ ĐIỀU KIỆN sau khi destroy — không có tuỳ
 * chọn nào để giữ lại dữ liệu local (cờ opt-in giữ dữ liệu cũ đã bị xoá hoàn
 * toàn, KHÔNG thay bằng cờ/config tương đương). Destroy KHÔNG tự xoá volume
 * (`retainOnDelete`) nên hai kết quả tách rời: lỗi destroy và lỗi xoá volume
 * được theo dõi, báo và phản ánh vào exit code riêng biệt (xem
 * `runPlatformDown`). KHÔNG dùng `pulumi stack rm` — entry up của platform
 * fail có hướng dẫn khi config mất mà volume còn; down giữ stack rỗng
 * resource là cách hai nửa (config, volume) luôn cùng tuổi.
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
import { runPlatformDown } from '../../tools/dx/src/deployment/local-platform/platform-down';
// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem giải thích ngay trên
import {
  ensureStackForEntry,
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
import { ROOT_DIR } from '../../tools/dx/src/utils';

async function up(foundation: EntryFoundation): Promise<number> {
  try {
    // Stack phải tồn tại TRƯỚC khi đọc/ghi stack config: trên worktree chưa
    // từng deploy, `config get` trên backend `file://` exit 1 với lỗi
    // "unable to open state directory" — lỗi không phân biệt được với "lỗi
    // thật" và sẽ chặn nhánh sinh mật khẩu cho stack mới. Idempotent khi stack
    // đã có (xem `ensureStackForEntry`).
    ensureStackForEntry('platform-deploy', foundation);
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

async function down(foundation: EntryFoundation): Promise<number> {
  // Toàn bộ sequence destroy + xoá volume (vô điều kiện) sống trong
  // `runPlatformDown` — tách module để spec bấm được ma trận lỗi thật qua
  // injection. Caller giữ khóa lane (`withLaneLock`) quanh cả sequence.
  return runPlatformDown(foundation);
}

async function main(command: string, flags: { stealLock: boolean }): Promise<number> {
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
    return withLaneLock(foundation.ctx.worktreeRoot, flags.stealLock, () => down(foundation));
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
};
void main(command, flags).then((code) => {
  process.exit(code);
});
