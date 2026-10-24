/**
 * Chương trình Pulumi của `account-deploy` — deploy unit của `apps/account`
 * (identity/account) ở LAN LOCAL deployment.
 *
 * Đủ vòng đời theo `02-identity.md` §Dependency graph: provision `db-account`
 * + bộ 4 role chuẩn (owner/migrator/runtime/pruner) → migration đường canonical
 * (`apps/account/db/apply.mts`) → image `node-server` → container trên platform
 * network với Traefik router `Host(account.<rootHostname>)` → readiness qua
 * `GET /ready` (chạm DB thật, không phải `/health`).
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
 *
 * Binding local (issue #182): container Node không có Hyperdrive thật. Adapter
 * là biến `NUXT_CLOUDFLARE_ENV` chứa JSON `{"DB_ACCOUNT":{"connectionString":
 * ...}}` — Nitro envmap (`applyEnv` + `destr`) merge nó vào
 * `runtimeConfig.cloudflare.env` được khai tường minh trong `nuxt.config.ts`, đúng
 * hình dạng mà `accountHyperdrive()` kiểm. Không đặt biến ⇒ object rỗng ⇒ binding
 * `null` ⇒ `/ready` 503 — fail-closed như production. `AUTH_SERVICE` chưa có ở
 * phiên này: `authServiceBinding()` trả `null` ⇒ mọi gọi auth là
 * `binding_missing` (shim HTTP là scope issue #183).
 */

import * as command from '@pulumi/command';
import * as docker from '@pulumi/docker';
import * as dockerBuild from '@pulumi/docker-build';
import * as pulumi from '@pulumi/pulumi';

// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem backoffice-deploy
import {
  dockerResourceName,
  normalizeWorktreeRoot,
  worktreeNamespace,
} from '../../tools/dx/src/local-runtime/deploy-namespace';
// oxlint-disable-next-line @nx/enforce-module-boundaries -- cùng lý do
import { shellQuote, sqlQuote } from '../../tools/dx/src/local-runtime/shell-quote';
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

/** Cổng HTTP nội bộ của container account — Nitro `node-server` mặc định 3000. */
const ACCOUNT_INTERNAL_PORT = 3000;

/** Prefix router/service Traefik của app này — namespace vào tên để multi-tenant. */
const traefikPrefix = (ns: string): string => `account-${ns}`;

const conf = new pulumi.Config('namespace');

const worktreeRoot = conf.require('worktreeRoot');
const ns = worktreeNamespace(worktreeRoot);

// Labels ownership: gắn lên MỌI Docker resource (image + container) để
// `pnpm dx local-cleanup` phân loại được.
const labels = ownershipLabels(normalizeWorktreeRoot(worktreeRoot), ns);

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
const rootHostname = requirePlatformOutput('rootHostname');

// Mật khẩu bốn role — do orchestration sinh và truyền qua --config (stdin, không argv).
const ownerPassword = conf.require('ownerPassword');
const runtimePassword = conf.require('runtimePassword');
const migratorPassword = conf.require('migratorPassword');
const prunerPassword = conf.require('prunerPassword');

// Secret HMAC của app — cùng kênh `--config` (stdin) như mật khẩu role; orchestration
// (`local-deploy`) sinh và set, stack này đọc. Thiếu key là fail ngay lúc `pulumi up`
// (`conf.require`) chứ không Container với secret rỗng.
const internalHmacSecret = conf.require('internalHmacSecret');
const otpHmacSecret = conf.require('otpHmacSecret');

const verifiedNamespace = pulumi.output(platformNamespace).apply((upstreamNs) => {
  if (upstreamNs !== ns) {
    throw new Error(
      `platformStackRef trỏ sang stack của namespace khác: platform export "${upstreamNs}" còn worktree này là "${ns}".`,
    );
  }
  return ns;
});

// Connection string runtime (role `ecoma_account_runtime`) qua network nội bộ —
// cùng pattern backoffice. `pulumi.secret` đánh dấu redact trong diff/log;
// `pulumi.interpolate` với config plaintext KHÔNG tự redact, nên phải bọc
// secret TRƯỚC rồi interpolate.
const accountDatabaseUrl = pulumi.interpolate`postgresql://ecoma_account_runtime:${pulumi.secret(runtimePassword)}@${POSTGRES_HOST}:5432/db-account`;

/**
 * Giá trị biến `NUXT_CLOUDFLARE_ENV` — JSON object đúng hình dạng mà
 * `applyEnv` của Nitro merge vào `runtimeConfig.cloudflare.env`.
 *
 * Chỉ có key parent (`cloudflare.env`) xuất hiện trong runtimeConfig khai
 * tường minh thì envmap mới chạm được tới cấp binding (đã đo thật: biến cấp
 * sâu `NUXT_CLOUDFLARE_ENV_DB_ACCOUNT` không bao giờ được đọc vì recursion
 * chỉ đi các key CÓ SẴN trong object inline). JSON được `destr` parse thành
 * object rồi merge — sau đó `accountHyperdrive()` thấy
 * `DB_ACCOUNT.connectionString` là chuỗi. Không đặt biến ⇒ object rỗng ⇒
 * fail-closed như Workers thiếu binding.
 *
 * Toàn bộ giá trị là một pulumi.secret interpolate: connection string chứa
 * mật khẩu runtime, không được đi vào diff/log/argv — biến chỉ đi qua `envs`
 * của container (kênh container env, cùng kênh backoffice dùng) và Pulumi
 * redact khi in.
 *
 * Dấu ngoặc kép quanh `${...}` là BẮT BUỘC: thiếu quote thì giá trị nội suy
 * là URL trần (`"connectionString":postgresql://...`) — không phải JSON hợp
 * lệ, `destr` parse fail ⇒ binding `null` ⇒ `/ready` 503 `binding_missing`
 * (issue #229).
 */
const cloudflareEnvJson = pulumi.interpolate`{"DB_ACCOUNT":{"connectionString":"${pulumi.secret(accountDatabaseUrl)}"}}`;

const imageTag = `ecoma-account-${ns}:local`;

// Image `node-server` — mirror `backoffice-image`: build từ context repo root,
// Dockerfile ghim digest Node, load vào Docker local, không push.
const image = new dockerBuild.Image(dockerResourceName(ns, 'account-image'), {
  context: { location: worktreeRoot },
  dockerfile: { location: `${worktreeRoot}/deploys/account-deploy/Dockerfile` },
  tags: [imageTag],
  builder: { name: 'default' },
  load: true,
  push: false,
  labels,
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
 * Mọi ALTER ROLE password đi qua HAI biên escaping độc lập, đúng pattern #193
 * đã ghim cho backoffice: `sqlQuote` bảo vệ literal SQL, rồi `shellQuote` bọc
 * CẢ câu SQL thành MỘT argument của shell. Chỉ `sqlQuote` bên trong double
 * quotes của shell là KHÔNG đủ — shell mở rộng `$`/backtick trước khi psql
 * thấy SQL (đo thật trong `shell-quote.spec.ts`).
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
$PSQL -c ${shellQuote(`ALTER ROLE ecoma_owner WITH PASSWORD ${sqlQuote(ownerPassword)};`)}
# 2. Ba role của db-account.
if ! $PSQL -tAc "SELECT 1 FROM pg_roles WHERE rolname='ecoma_account_migrator'" | grep -q 1; then $PSQL -c "CREATE ROLE ecoma_account_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS"; fi
if ! $PSQL -tAc "SELECT 1 FROM pg_roles WHERE rolname='ecoma_account_runtime'" | grep -q 1; then $PSQL -c "CREATE ROLE ecoma_account_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS"; fi
if ! $PSQL -tAc "SELECT 1 FROM pg_roles WHERE rolname='ecoma_account_nonce_pruner'" | grep -q 1; then $PSQL -c "CREATE ROLE ecoma_account_nonce_pruner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS"; fi
$PSQL -c ${shellQuote(`ALTER ROLE ecoma_account_migrator WITH PASSWORD ${sqlQuote(migratorPassword)};`)}
$PSQL -c ${shellQuote(`ALTER ROLE ecoma_account_runtime WITH PASSWORD ${sqlQuote(runtimePassword)};`)}
$PSQL -c ${shellQuote(`ALTER ROLE ecoma_account_nonce_pruner WITH PASSWORD ${sqlQuote(prunerPassword)};`)}
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

/**
 * Container account — image `node-server`, plain HTTP trên platform network,
 * TLS do Traefik chấm dứt phía trước (cùng model home/backoffice).
 *
 * Thứ tự phụ thuộc: provision (database + role) → migrate (schema) → image →
 * container. Migration chạy trên image Node ghim riêng (ephemeral container),
 * độc lập với image app — container chỉ lên sau khi schema đã sẵn sàng, để
 * `/ready` của healthcheck không đỏ giả trong cửa sổ chưa-migrate.
 *
 * Env: `NUXT_CLOUDFLARE_ENV` là adapter binding (JSON, secret); hai secret HMAC
 * phủ từ envmap `NUXT_*` vào runtimeConfig private; `mailServiceUrl` để RỖNG —
 * đường mail local là scope riêng (sink local D1, issue #183), để rỗng giữ
 * fail-closed ở lần gửi.
 */
const account = new docker.Container(
  dockerResourceName(ns, 'account'),
  {
    name: dockerResourceName(ns, 'account'),
    image: pulumi.interpolate`${imageTag}@${image.digest}`,
    restart: 'unless-stopped',
    networksAdvanced: [{ name: networkName, aliases: ['ecoma-account'] }],
    envs: [
      `PORT=${ACCOUNT_INTERNAL_PORT}`,
      'NODE_ENV=production',
      pulumi.interpolate`NUXT_CLOUDFLARE_ENV=${cloudflareEnvJson}`,
      pulumi.interpolate`NUXT_INTERNAL_HMAC_SECRET=${pulumi.secret(internalHmacSecret)}`,
      pulumi.interpolate`NUXT_OTP_HMAC_SECRET=${pulumi.secret(otpHmacSecret)}`,
      'NUXT_MAIL_SERVICE_URL=',
    ],
    labels: [
      ...Object.entries(labels).map(([label, value]) => ({ label, value })),
      { label: 'traefik.enable', value: 'true' },
      // Bắt buộc với provider docker multi-tenant (memory: cùng network flag
      // KHÔNG lọc — container trên nhiều network bị Traefik thấy qua network
      // nào là do label này quyết).
      { label: 'traefik.docker.network', value: networkName },
      {
        label: `traefik.http.routers.${traefikPrefix(ns)}.rule`,
        value: pulumi.interpolate`Host(\`account.${rootHostname}\`)`,
      },
      {
        label: `traefik.http.routers.${traefikPrefix(ns)}.entrypoints`,
        value: 'websecure',
      },
      { label: `traefik.http.routers.${traefikPrefix(ns)}.tls`, value: 'true' },
      {
        label: `traefik.http.services.${traefikPrefix(ns)}.loadbalancer.server.port`,
        value: String(ACCOUNT_INTERNAL_PORT),
      },
    ],
    healthcheck: {
      // `/ready` chứ không phải `/health`: readiness phải chứng minh DB probe
      // thật (`selectAccountStatus`) thành công — `/health` không chạm DB nên
      // không đủ làm bằng chứng container phục vụ được request thật
      // (`02-identity.md` §Runtime contracts).
      tests: [
        'CMD',
        'node',
        '-e',
        `fetch('http://127.0.0.1:${ACCOUNT_INTERNAL_PORT}/ready')` +
          `.then(r => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))`,
      ],
      interval: '10s',
      timeout: '5s',
      retries: 12,
      startPeriod: '30s',
    },
  },
  { dependsOn: [migrate] },
);

export const provisionCommandName = provision.id;
export const migrateCommandName = migrate.id;
export const imageDigest = image.digest;
export const containerName = account.name;
export const containerId = account.id;
export const namespaceVerified = verifiedNamespace;
