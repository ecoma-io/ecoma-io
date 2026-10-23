/**
 * Chương trình Pulumi của `auth-deploy` — deploy unit của `apps/auth`
 * (identity/auth) ở LAN LOCAL deployment.
 *
 * PR database isolation (issue #181): stack này provision `db-auth` + bộ 4 role
 * chuẩn (owner/migrator/runtime/pruner) trên PostgreSQL của platform, chạy
 * migration qua **đường canonical** (`apps/auth/db/apply.mts` — advisory lock
 * `hashtext('db-auth')`, history `auth.schema_migrations`, checksum), CHƯA dựng
 * WIC container (auth + shim bridge là PR kế tiếp theo `02-identity.md`).
 *
 * Mirror `deploys/backoffice-deploy/index.ts` (cùng ownership labels, namespace,
 * stack reference, fail-closed, `command.local.Command` + `docker exec` psql qua
 * trust auth trong container — platform không publish host port nên host không
 * kết nối được container bằng TCP).
 *
 * Khác account stack ở đúng MỘT điểm ownership: role `ecoma_owner` là role dùng
 * chung hai DB, và **account stack sở hữu password của nó** — stack này
 * guard-create khi thiếu nhưng KHÔNG BAO GIỜ `ALTER ROLE ecoma_owner PASSWORD`
 * (hai stack cùng ALTER một password là race xoá mật khẩu nhau). SQL
 * provisioning theo `docs/services/auth/03-operations.md` §3.1/§3.2 và
 * `apps/auth/migrations/README.md` §"Vai trò của operator": revoke chéo điều
 * kiện hoá theo `pg_database` (REVOKE trên database không tồn tại là lỗi),
 * PUBLIC trước per-role sau.
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
 * container (platform facts PF5), nên `pg` của runner chỉ kết nối được từ bên
 * trong platform network. Container ephemeral chạy **tsx binary của repo** vẫn
 * là đúng một đường code canonical (`applyAllMigrations` của
 * `apps/auth/db/apply.mts`) — deploy không tự viết lại vòng migration.
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

// Mật khẩu ba role của db-auth — do orchestration sinh và truyền qua --config
// (stdin, không argv). KHÔNG có ownerPassword ở đây: password của `ecoma_owner`
// thuộc về account stack (xem JSDoc đầu file).
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
 * Provision `db-auth` + 3 role riêng + cross-DB revokes, chạy trên host qua
 * `docker exec` vào container PostgreSQL của platform. Idempotent như
 * account-deploy; khác ở: guard-create `ecoma_owner` khi thiếu (không ALTER),
 * và chiều revoke chéo ngắm vào `db-account`.
 */
const postgresContainerName = dockerResourceName(ns, 'postgres');
const provisionScript = pulumi.interpolate`set -e
PG=${postgresContainerName}
PSQL="docker exec $PG psql -U ecoma_local -d postgres -v ON_ERROR_STOP=1"
# 1. Owner role dùng chung — CHỈ tạo khi thiếu; KHÔNG ALTER password (account
#    stack sở hữu password của ecoma_owner; ALTER ở hai nơi là race xoá nhau).
if ! $PSQL -tAc "SELECT 1 FROM pg_roles WHERE rolname='ecoma_owner'" | grep -q 1; then $PSQL -c "CREATE ROLE ecoma_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS"; fi
# 2. Ba role của db-auth.
if ! $PSQL -tAc "SELECT 1 FROM pg_roles WHERE rolname='ecoma_auth_migrator'" | grep -q 1; then $PSQL -c "CREATE ROLE ecoma_auth_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS"; fi
if ! $PSQL -tAc "SELECT 1 FROM pg_roles WHERE rolname='ecoma_auth_runtime'" | grep -q 1; then $PSQL -c "CREATE ROLE ecoma_auth_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS"; fi
if ! $PSQL -tAc "SELECT 1 FROM pg_roles WHERE rolname='ecoma_auth_nonce_pruner'" | grep -q 1; then $PSQL -c "CREATE ROLE ecoma_auth_nonce_pruner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS"; fi
$PSQL -c "ALTER ROLE ecoma_auth_migrator WITH PASSWORD ${sqlQuote(migratorPassword)};"
$PSQL -c "ALTER ROLE ecoma_auth_runtime WITH PASSWORD ${sqlQuote(runtimePassword)};"
$PSQL -c "ALTER ROLE ecoma_auth_nonce_pruner WITH PASSWORD ${sqlQuote(prunerPassword)};"
# 3. Database + owner. CREATE là lệnh guard (bash if), ALTER idempotent sẵn.
if ! $PSQL -tAc "SELECT 1 FROM pg_database WHERE datname='db-auth'" | grep -q 1; then $PSQL -c 'CREATE DATABASE "db-auth"'; fi
$PSQL -c 'ALTER DATABASE "db-auth" OWNER TO ecoma_owner'
# 4. Chặn chéo chiều ngược: điều kiện hoá theo db-account — account stack có
#    thể up sau auth (thứ tự orchestration là account trước auth, nhưng một
#    pulumi up riêng lẻ của stack này không được chết vì database kia vắng).
if $PSQL -tAc "SELECT 1 FROM pg_database WHERE datname='db-account'" | grep -q 1; then $PSQL -c 'REVOKE CONNECT ON DATABASE "db-account" FROM PUBLIC'; fi
if $PSQL -tAc "SELECT 1 FROM pg_database WHERE datname='db-account'" | grep -q 1; then $PSQL -c 'REVOKE CONNECT ON DATABASE "db-account" FROM ecoma_auth_runtime'; fi
# 5. Thu CONNECT của PUBLIC trước, rồi grant per-role.
$PSQL -c 'REVOKE CONNECT ON DATABASE "db-auth" FROM PUBLIC'
$PSQL -c 'GRANT CONNECT, CREATE, TEMPORARY ON DATABASE "db-auth" TO ecoma_auth_migrator'
$PSQL -c 'GRANT CONNECT ON DATABASE "db-auth" TO ecoma_auth_runtime'
$PSQL -c 'GRANT CONNECT ON DATABASE "db-auth" TO ecoma_auth_nonce_pruner'
`;

const provision = new command.local.Command(dockerResourceName(ns, 'auth') + '-provision', {
  create: provisionScript,
  update: provisionScript,
  triggers: [runtimePassword, migratorPassword, prunerPassword, worktreeRoot],
});

/**
 * Migration qua **đường canonical**: container ephemeral trên platform network
 * chạy đúng `tsx db/apply.mts` của repo (`apps/auth/db/apply.mts` — advisory
 * lock `hashtext('db-auth')`, history `auth.schema_migrations`, checksum
 * drift-abort, thứ tự tên file). Repo mount read-only; password qua `-e` env
 * của container (kênh được chấp nhận), không argv, không log.
 */
const migrateScript = pulumi.interpolate`set -e
docker run --rm \\
  --network ${networkName} \\
  -v ${shellQuote(worktreeRoot)}:/repo:ro \\
  -v ${shellQuote(worktreeRoot)}/node_modules:/repo/node_modules \\
  -w /repo/apps/auth \\
  -e DATABASE_URL=postgresql://ecoma_auth_migrator:${pulumi.secret(migratorPassword)}@${POSTGRES_HOST}:5432/db-auth \\
  ${NODE_IMAGE} \\
  /repo/node_modules/.bin/tsx --tsconfig tsconfig.db.json db/apply.mts
`;

const migrate = new command.local.Command(
  dockerResourceName(ns, 'auth') + '-migrate',
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
