/**
 * Chương trình Pulumi của `account-deploy` — deploy unit của `apps/account`
 * (identity/account) ở LAN LOCAL deployment.
 *
 * PR database isolation (issue #181): stack này provision `db-account` + bộ 4
 * role chuẩn (owner/migrator/runtime/pruner) trên PostgreSQL của platform, chạy
 * migration qua **đường canonical** (`apps/account/db/apply.mts` — advisory
 * lock, GUC, history qua DDL idempotent), CHƯA build image/chạy container
 * (container + Traefik là PR kế tiếp theo `02-identity.md` §Dependency graph).
 *
 * Mirror `deploys/backoffice-deploy/index.ts` (cùng ownership labels, namespace,
 * stack reference, fail-closed, `command.local.Command` + `docker exec` psql qua
 * trust auth trong container — platform không publish host port nên host không
 * kết nối được container bằng TCP).
 *
 * SQL provisioning theo `docs/services/account/03-operations.md` §3.1/§3.2 và
 * `apps/account/db/README.md` §"Chặn chéo": mỗi DB 4 role, `REVOKE CONNECT`
 * chéo **kể cả PUBLIC** (chỉ revoke per-role là no-op — PostgreSQL cấp CONNECT
 * cho PUBLIC theo mặc định), và revoke trên database đích phải được điều kiện
 * hoá bằng `pg_database` (xóa REVOKE trên database không tồn tại là lỗi, không
 * phải no-op).
 */

import * as command from '@pulumi/command';
import * as pulumi from '@pulumi/pulumi';

// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem backoffice-deploy
import {
  dockerResourceName,
  normalizeWorktreeRoot,
  worktreeNamespace,
} from '../../tools/dx/src/local-runtime/deploy-namespace';
// oxlint-disable-next-line @nx/enforce-module-boundaries -- cùng lý do
import { ownershipLabels } from '../../tools/dx/src/deployment/local-platform/deploy-labels';
// oxlint-disable-next-line @nx/enforce-module-boundaries -- cùng lý do
import type { PlatformOutputs } from '../../tools/dx/src/deployment/local-platform/platform-outputs-contract';

/**
 * Image Node pin (theo DIGEST) để chạy migration runner trong container gắn
 * platform network — cùng digest mà `deploys/home-deploy/Dockerfile` ghim.
 *
 * Vì sao container mà không chạy runner trên host: platform PostgreSQL KHÔNG
 * publish host port (invariant platform) và host không route được tới IP
 * container (môi trường rootless, platform facts PF5), nên `pg` của runner chỉ
 * kết nối được từ bên trong platform network. Container ephemeral `--network
 * <platform>` với repo mount read-only + chạy **tsx binary của repo** vẫn là
 * đúng một đường code canonical (`applyAllMigrations`) — deploy không tự viết
 * lại vòng migration (quyết định #181).
 */
const NODE_IMAGE =
  'node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5';

/** Alias DNS của PostgreSQL platform trong network nội bộ. */
const POSTGRES_HOST = 'ecoma-postgres';

/**
 * Escape một giá trị để đặt an toàn bên trong SQL literal nháy đơn.
 *
 * Trong chuỗi SQL, một dấu nháy đơn được escape thành hai dấu nháy đơn
 * (chuẩn SQL, đúng hành vi với `standard_conforming_strings = on` mặc định của
 * PostgreSQL). Mọi giá trị đi vào `ALTER ROLE ... PASSWORD '<giá trị>'` đều
 * phải qua hàm này: password do orchestration sinh (`base64url`, không chứa
 * nháy đơn) vẫn an toàn như cũ, nhưng đoạn nối chuỗi được miễn nhiễm với giá
 * trị tương lai thay đổi bảng chữ cái — một password chứa `'` ngày nào đó
 * không còn phá SQL literal nữa.
 *
 * Dùng `replace` với regex global chứ không phải `replaceAll`: tsconfig của
 * deploy unit đặt `target: es2020`, thiếu `String.prototype.replaceAll`
 * (ES2021) — typecheck fail-loud đã bắt đúng điều đó.
 */
const sqlQuote = (value: string): string => `'${value.replace(/'/gu, "''")}'`;

/**
 * Quote một giá trị để dùng an toàn bên trong double quotes của POSIX shell.
 *
 * Bọc trong nháy đơn và escape nháy đơn theo công thức `'...'` → `'\''`.
 * `worktreeRoot` đến từ `--config namespace:worktreeRoot=` do người dùng gõ,
 * không phải giá trị kiểm soát — một path chứa `$`, backtick hay nháy đơn
 * phải là path thật, không phải mã shell được chạy.
 */
const shellQuote = (value: string): string => `'${value.replace(/'/gu, `'\\''`)}'`;

const conf = new pulumi.Config('namespace');

const worktreeRoot = conf.require('worktreeRoot');
const ns = worktreeNamespace(worktreeRoot);

// Labels ownership Certificate: PR database isolation CHƯA tạo Docker resource
// nào (image/container/Traefik là PR3/PR4) — biến này được dùng khi resource
// đầu tiên xuất hiện; giữ sẵn ở đây là bản sao của pattern backoffice và lint
// bắt được nếu quên gắn khi thêm resource.
const labels = ownershipLabels(normalizeWorktreeRoot(worktreeRoot), ns);
void labels;

const platform = new pulumi.StackReference(conf.require('platformStackRef'));

function requirePlatformOutput<K extends keyof PlatformOutputs>(
  key: K,
): pulumi.Output<PlatformOutputs[K]> {
  return pulumi.output(platform.getOutput(key)).apply((raw) => {
    if (raw === undefined || raw === null) {
      throw new Error(
        `platformStackRef không export "${key}". Chạy \`pnpm dx local-deploy\` (apply platform) trước.`,
      );
    }
    return raw as PlatformOutputs[K];
  });
}

const networkName = requirePlatformOutput('networkName');
const platformNamespace = requirePlatformOutput('namespace');

// Mật khẩu bốn role — do orchestration sinh và truyền qua --config (stdin, không argv).
const ownerPassword = conf.require('ownerPassword');
const runtimePassword = conf.require('runtimePassword');
const migratorPassword = conf.require('migratorPassword');
const prunerPassword = conf.require('prunerPassword');

const verifiedNamespace = pulumi.output(platformNamespace).apply((upstreamNs) => {
  if (upstreamNs !== ns) {
    throw new Error(
      `platformStackRef trỏ sang stack của namespace khác: platform export "${upstreamNs}" còn worktree này là "${ns}".`,
    );
  }
  return ns;
});

/**
 * Provision `db-account` + 4 role + cross-DB revokes, chạy trên host qua
 * `docker exec` vào container PostgreSQL của platform (trust auth trong
 * container, `psql -U ecoma_local` — không publish host port).
 *
 * Idempotent: role/database guard bằng `SELECT ... \gexec` (chỉ chạy câu theo
 * khi SELECT còn trả dòng); password ALTER mỗi lần chạy (nguồn sự thật là stack
 * config, không phải trạng thái database). Thứ tự revoke/grant theo README
 * account §"Chặn chéo": PUBLIC trước, per-role sau.
 *
 * Chạy cả `create` và `update` để redeploy cũng áp cấu hình mới.
 */
const postgresContainerName = dockerResourceName(ns, 'postgres');
const provisionScript = pulumi.interpolate`set -e
PG=${postgresContainerName}
PSQL="docker exec $PG psql -U ecoma_local -d postgres -v ON_ERROR_STOP=1"
# 1. Role owner dùng chung account/auth — stack này SỞ HỘI password của nó:
#    auth stack guard-create khi thiếu nhưng KHÔNG BAO GIỜ ALTER password ở đây.
if ! $PSQL -tAc "SELECT 1 FROM pg_roles WHERE rolname='ecoma_owner'" | grep -q 1; then $PSQL -c "CREATE ROLE ecoma_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS"; fi
$PSQL -c "ALTER ROLE ecoma_owner WITH PASSWORD ${sqlQuote(ownerPassword)};"
# 2. Ba role của db-account.
if ! $PSQL -tAc "SELECT 1 FROM pg_roles WHERE rolname='ecoma_account_migrator'" | grep -q 1; then $PSQL -c "CREATE ROLE ecoma_account_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS"; fi
if ! $PSQL -tAc "SELECT 1 FROM pg_roles WHERE rolname='ecoma_account_runtime'" | grep -q 1; then $PSQL -c "CREATE ROLE ecoma_account_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS"; fi
if ! $PSQL -tAc "SELECT 1 FROM pg_roles WHERE rolname='ecoma_account_nonce_pruner'" | grep -q 1; then $PSQL -c "CREATE ROLE ecoma_account_nonce_pruner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS"; fi
$PSQL -c "ALTER ROLE ecoma_account_migrator WITH PASSWORD ${sqlQuote(migratorPassword)};"
$PSQL -c "ALTER ROLE ecoma_account_runtime WITH PASSWORD ${sqlQuote(runtimePassword)};"
$PSQL -c "ALTER ROLE ecoma_account_nonce_pruner WITH PASSWORD ${sqlQuote(prunerPassword)};"
# 3. Database + owner. CREATE là lệnh guard (bash if), ALTER idempotent sẵn.
if ! $PSQL -tAc "SELECT 1 FROM pg_database WHERE datname='db-account'" | grep -q 1; then $PSQL -c 'CREATE DATABASE "db-account"'; fi
$PSQL -c 'ALTER DATABASE "db-account" OWNER TO ecoma_owner'
# 4. Chặn chéo: revoke trên database đích phải ĐIỀU KIỆN HOÁ — db-auth có thể
#    chưa tồn tại (auth stack up sau account) mà REVOKE CONNECT trên database
#    không tồn tại là lỗi, không phải no-op. Đảo lại cũng vậy: khi db-auth
#    ĐÃ có thì revoked ở đây, kể cả qua PUBLIC.
if $PSQL -tAc "SELECT 1 FROM pg_database WHERE datname='db-auth'" | grep -q 1; then $PSQL -c 'REVOKE CONNECT ON DATABASE "db-auth" FROM PUBLIC'; fi
if $PSQL -tAc "SELECT 1 FROM pg_database WHERE datname='db-auth'" | grep -q 1; then $PSQL -c 'REVOKE CONNECT ON DATABASE "db-auth" FROM ecoma_account_runtime'; fi
# 5. Thu CONNECT của PUBLIC trước, rồi grant per-role (README account §"Chặn
#    chéo": chỉ revoke role là no-op vì PUBLIC giữ CONNECT theo mặc định).
$PSQL -c 'REVOKE CONNECT ON DATABASE "db-account" FROM PUBLIC'
$PSQL -c 'GRANT CONNECT, CREATE, TEMPORARY ON DATABASE "db-account" TO ecoma_account_migrator'
$PSQL -c 'GRANT CONNECT ON DATABASE "db-account" TO ecoma_account_runtime'
$PSQL -c 'GRANT CONNECT ON DATABASE "db-account" TO ecoma_account_nonce_pruner'
`;

const provision = new command.local.Command(dockerResourceName(ns, 'account') + '-provision', {
  create: provisionScript,
  update: provisionScript,
  triggers: [ownerPassword, runtimePassword, migratorPassword, prunerPassword, worktreeRoot],
});

/**
 * Migration qua **đường canonical**: container ephemeral trên platform network
 * chạy đúng `tsx db/apply.mts` của repo (`apps/account/db/apply.mts` — advisory
 * lock `hashtext('db-account')`, GUC, danh sách file theo thứ tự tên). Repo
 * mount READ-ONLY; node_modules của repo mount riêng (rw) vì `tsx` cần binary
 * đã cài — mount read-only cả repo thì `tsx` vẫn chạy được vì chỉ ĐỌC binary,
 * nhưng pnpm đặt binary là symlink xuyên node_modules → mount cả hai điểm, vẫn
 * không ghi gì xuống đĩa trong lúc migrate.
 *
 * ⚠️ Password đi qua biến môi trường `-e` của container (kênh được chấp nhận —
 * cùng pattern backoffice), KHÔNG qua argv (đọc được qua /proc/<pid>/cmdline) và
 * không log. Mật khẩu nằm trong text của `command.local.Command` là pattern
 * đã chấp nhận cho local stack (platform-outputs-contract: plaintext config
 * cho local; không secret nào ra outputs).
 */
const migrateScript = pulumi.interpolate`set -e
docker run --rm \\
  --network ${networkName} \\
  -v ${shellQuote(worktreeRoot)}:/repo:ro \\
  -v ${shellQuote(worktreeRoot)}/node_modules:/repo/node_modules \\
  -w /repo/apps/account \\
  -e DATABASE_URL=postgresql://ecoma_account_migrator:${pulumi.secret(migratorPassword)}@${POSTGRES_HOST}:5432/db-account \\
  ${NODE_IMAGE} \\
  /repo/node_modules/.bin/tsx --tsconfig tsconfig.db.json db/apply.mts
`;

const migrate = new command.local.Command(
  dockerResourceName(ns, 'account') + '-migrate',
  {
    create: migrateScript,
    update: migrateScript,
    triggers: [migratorPassword, worktreeRoot],
  },
  { dependsOn: [provision] },
);

export const provisionCommandName = provision.id;
export const migrateCommandName = migrate.id;
export const namespaceVerified = verifiedNamespace;
