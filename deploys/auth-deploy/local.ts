/**
 * Entry lifecycle local của `auth-deploy` — `up`/`down` trên stack Pulumi của
 * CHÍNH project này; thứ tự toàn cục do Nx suy từ `dependsOn` của package.json
 * (auth chạy sau account: owner password role + WIC phụ thuộc container
 * account).
 *
 * Chạy qua target Nx: `nx run auth-deploy:local-up -c local` → `npx tsx
 * local.ts up`. Entry KHÔNG lấy khóa lane: lifecycle không còn khóa toàn cục (xem quyết định kiến trúc PR #424).
 *
 * Secret bảng của auth (sinh khi up, giữ trong stack config qua stdin):
 * - Mật khẩu 3 role PostgreSQL (runtime/migrator/pruner) — sinh ngẫu nhiên
 *   bằng API mật mã an toàn, xoay mỗi lần up là vô hại vì role được
 *   guard-create/ALTER trong cùng lần up đó.
 * - `signingKeyPem`: PKCS#8 ES256 sinh lúc deploy, giữ ổn định qua các lần
 *   deploy trong đời namespace qua persistence stack config (JWKS đổi giữa
 *   chừng là mọi token đã cấp không còn verify được) — đọc lại config trước,
 *   chỉ sinh khi thiếu.
 * - `signingKeyId` = `local-identity-1` (literal ổn định — local không xoay
 *   key, thiếu `AUTH_INTERNAL_KID`/`AUTH_INTERNAL_PREVIOUS_*` là trạng thái
 *   hợp lệ mà config.ts chấp nhận tường minh).
 * - `handleKey` + `cookieKeys`: secret ỨNG DỤNG 32 byte (`generateAppSecret`)
 *   — domain lib bắt ĐÚNG 32 byte, keygrip cần key ký ứng dụng (#284).
 * - `internalSecret`: giá trị HMAC dùng chung auth <-> account — ĐỌC LẠI từ
 *   stack config của account (account đã persist khi up trước đó theo
 *   dependsOn). Hai giá trị khác nhau là mọi envelope internal chết
 *   `bad_signature` lúc runtime.
 * - `issuer`/`audience`: suy từ `ROOT_HOST` trong `.env` (artifact mà up của
 *   platform ghi sau khi xanh).
 */
// oxlint-disable no-console -- entry CLI chạy trên Node; console là kênh
// output DUY NHẤT của lifecycle gate (nx:run-commands gộp stdout/stderr).

import { join } from 'node:path';

// `tools/dx` là workspace project `type:tooling`, còn deploy unit là
// `type:deployment`. Import **nguồn** là chủ ý: deploy unit phải dùng CHUNG một
// định nghĩa helper lifecycle, và entry chạy thẳng `local.ts` qua tsx — không
// có bước build `tools/dx` nào chạy trước để sinh package. Copy hàm vào deploy
// unit sẽ tạo hai nơi định nghĩa cùng một thứ và để chúng lệch nhau.
//
// Specifier KHÔNG chữ `.js` (extensionless) — xem tsconfig cùng project để biết
// vì sao `.js` lại fail lúc chạy thật.
//
// `@nx/enforce-module-boundaries` cấm import xuyên project bằng đường dẫn
// tương đối theo mặc định; ở đây ngoại lệ đó được bật tường minh cho đúng các
// dòng này thay vì nới luật ở `.oxlintrc.json` — nới ở config là mở cho MỌI
// project, còn disable ở đúng chỗ thì giữ được ranh giới cho phần còn lại của
// repo.
// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem giải thích ngay trên
import {
  generateAppSecret,
  generateEs256SigningKeyPem,
  generatePostgresPassword,
  readRootHostFromEnv,
} from '../../tools/dx/src/deployment/local-platform/local-env';
// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem giải thích ngay trên
import { exec, fullStackRef } from '../../tools/dx/src/deployment/local-platform/pulumi-context';
// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem giải thích ngay trên
import {
  ensureStackForEntry,
  pulumiDestroyForEntry,
  pulumiUpForEntry,
  resolveEntryFoundation,
  setStackConfig,
  waitForOwnContainerHealthy,
  type EntryFoundation,
} from '../../tools/dx/src/deployment/local-platform/local-entry';
// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem giải thích ngay trên
import { ROOT_DIR } from '../../tools/dx/src/utils';

/** Đọc lại giá trị từ stack config; `undefined` khi chưa có (không phân biệt lỗi). */
function readStackConfig(
  project: string,
  configKey: string,
  foundation: EntryFoundation,
): string | undefined {
  const read = exec(
    'pulumi',
    ['config', 'get', configKey, '--stack', fullStackRef(project, foundation.ctx)],
    join(ROOT_DIR, 'deploys', project),
    foundation.env,
  );
  if (read.status === 0 && read.stdout.trim().length > 0) {
    return read.stdout.trim();
  }
  return undefined;
}

/**
 * Giá trị HMAC internal dùng chung auth <-> account — ĐỌC LẠI từ stack config
 * của account.
 *
 * Account (chạy trước theo dependsOn) SINH giá trị mới và PERSIST vào stack
 * config của chính nó (`namespace:internalHmacSecret`); auth đọc lại để hai
 * stack nhận đúng MỘT giá trị dù là hai process Nx khác nhau. Bất biến
 * "cùng secret" là dữ liệu durability của Pulumi, không phải biến process.
 */
function resolveIdentityInternalSecret(foundation: EntryFoundation): string {
  const read = exec(
    'pulumi',
    [
      'config',
      'get',
      'namespace:internalHmacSecret',
      '--stack',
      fullStackRef('account-deploy', foundation.ctx),
    ],
    join(ROOT_DIR, 'deploys', 'account-deploy'),
    foundation.env,
  );
  if (read.status === 0 && read.stdout.trim().length > 0) {
    return read.stdout.trim();
  }
  // KHÔNG nhúng raw stderr/stdout vào log: stdout của `config get
  // namespace:internalHmacSecret` khi exit 0 CHÍNH LÀ HMAC secret — nếu CLI
  // đổi hành vi exit-code, raw output trong error string là đường leak thật.
  console.error(
    '[auth-deploy] up: reading namespace:internalHmacSecret from the account-deploy stack ' +
      `failed (exit ${String(read.status)}) — account up must run BEFORE auth (dependsOn). ` +
      'Run `pulumi config get namespace:internalHmacSecret --stack <account-stack-ref>` ' +
      'in deploys/account-deploy to see the original stderr — the output of that command ' +
      'is never logged because it may contain the secret.',
  );
  process.exit(1);
}

async function prepare(foundation: EntryFoundation): Promise<void> {
  // Stack phải tồn tại trước khi đọc/ghi stack config — lần up đầu trên
  // worktree mới, state dir chưa có và mọi lệnh config exit 1 (xem
  // `ensureStackForEntry`). Đọc cross-stack của account stack KHÔNG cần bước
  // này: account up chạy trước theo dependsOn nên stack của nó đã có.
  ensureStackForEntry('auth-deploy', foundation);
  const rootHost = readRootHostFromEnv(foundation.ctx.worktreeRoot);
  if (rootHost === undefined) {
    console.error(
      '[auth-deploy] up: missing ROOT_HOST in .env — platform up has not written it or ' +
        '.env was deleted. Run the local-up lane from platform-deploy first.',
    );
    process.exit(1);
  }
  const identityInternalSecret = resolveIdentityInternalSecret(foundation);
  // `signingKeyPem` ổn định trong đời namespace: đọc lại config trước, chỉ sinh
  // PEM mới khi thiếu (lần up đầu trên stack mới) — JWKS đổi là mọi token đã
  // cấp không còn verify được.
  const signingKeyPem =
    readStackConfig('auth-deploy', 'namespace:signingKeyPem', foundation) ??
    (await generateEs256SigningKeyPem());

  const secrets: ReadonlyArray<readonly [string, string]> = [
    ['namespace:runtimePassword', generatePostgresPassword()],
    ['namespace:migratorPassword', generatePostgresPassword()],
    ['namespace:prunerPassword', generatePostgresPassword()],
    ['namespace:signingKeyPem', signingKeyPem],
    ['namespace:signingKeyId', 'local-identity-1'],
    // `handleKey` là khoá HMAC-SHA-256 của domain lib (importKey bắt ĐÚNG 32
    // byte) và `cookieKeys` là keygrip key của oidc-provider — cả hai là
    // secret ứng dụng, dùng `generateAppSecret` (32 byte) thay vì mật khẩu
    // 24 byte của database (#284): sai hình là mọi request /authorize chết
    // `K_auth phai dai 32 byte` ngay lúc mint đầu tiên.
    ['namespace:handleKey', generateAppSecret()],
    ['namespace:internalSecret', identityInternalSecret],
    ['namespace:issuer', `https://auth.${rootHost}`],
    ['namespace:audience', `https://api.${rootHost}`],
    ['namespace:cookieKeys', generateAppSecret()],
  ];
  for (const [configKey, configValue] of secrets) {
    setStackConfig('auth-deploy', configKey, configValue, foundation);
  }
}

async function main(command: string): Promise<number> {
  if (command === 'up') {
    const foundation = resolveEntryFoundation(true);
    if (foundation === undefined) {
      // Không bao giờ xảy ra với up (`create: true` không trả undefined) —
      // guard type thuần để narrowed.
      return 1;
    }
    try {
      await prepare(foundation);
    } catch (error) {
      console.error(
        `[auth-deploy] up prepare failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
    try {
      pulumiUpForEntry('auth-deploy', foundation);
    } catch (error) {
      console.error(
        `[auth-deploy] up failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
    // Health gate container CỦA CHÍNH unit — WIC auth.
    return waitForOwnContainerHealthy(foundation.ctx, 'auth-wic');
  }
  if (command === 'down') {
    const foundation = resolveEntryFoundation(false);
    if (foundation === undefined) {
      console.log(
        '[auth-deploy] this worktree has never deployed (no .pulumi-local-state) — down is a no-op.',
      );
      return 0;
    }
    try {
      pulumiDestroyForEntry('auth-deploy', foundation);
      return 0;
    } catch (error) {
      console.error(
        `[auth-deploy] down failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
  }
  console.error(`[auth-deploy] unknown command: ${command} (expected: up | down)`);
  return 1;
}

const args = process.argv.slice(2);
const command = args[0] ?? '';
main(command).then((code) => {
  process.exit(code);
});
