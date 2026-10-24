/**
 * Chương trình Pulumi của `auth-deploy` — deploy unit của `apps/auth`
 * (identity/auth) ở LAN LOCAL deployment.
 *
 * PR database isolation (issue #181): stack này provision `db-auth` + bộ 4 role
 * chuẩn (owner/migrator/runtime/pruner) trên PostgreSQL của platform, chạy
 * migration qua **đường canonical** (`apps/auth/db/apply.mts` — advisory lock
 * `hashtext('db-auth')`, history `auth.schema_migrations`, checksum).
 *
 * PR Worker runtime (issue #183): dựng WIC container (worker-in-container) —
 * image mỏng ghim `node:24-bookworm-slim` + `ca-certificates` (PF2), chứa
 * HAI process `wrangler dev` theo `wic-entrypoint.sh`: worker `ecoma-auth`
 * (port nội bộ 4203) và shim `ecoma-account-bridge` (port nội bộ 4204).
 * Repo mount READ-ONLY là KHÔNG đủ để chạy wrangler dev: nó ghi bundle tạm
 * (`getWranglerTmpDir` hard-code `<projectRoot>/.wrangler/tmp`), cache
 * `Request.cf` của miniflare (`node_modules/.mf`) và registry dev registry
 * theo đường dưới repo — mở lỗ rw trên repo RO thì mount rw-point fail ở
 * runc (mkdirat trên EROFS), symlink cũng EROFS. Nên entrypoint dựng
 * **runtime tree mirror** ghi được dưới `$PERSIST_DIR/runtime` (copy
 * `wrangler.jsonc` + `dist`, symlink `node_modules` hai tầng) và chạy
 * wrangler từ đó. Secrets đi qua `envs` của container (kênh
 * container env — không argv, không label, không log), `pulumi.secret` bọc
 * trước khi interpolate để redact trong diff/log. Traefik route
 * `Host(auth.<rootHostname>)` theo bảng hostname của `02-identity.md`; router
 * đọc HTTP từ workerd (workerd chỉ nghe plain HTTP — TLS do Traefik chấm dứt
 * phía trước, cùng model home/backoffice; `x-forwarded-proto` được bridge
 * provider ghi lại từ URL scheme của request Worker, runtime.ts).
 * Readiness qua `GET /ready` của auth — probe CHẠM DB thật + binding
 * ACCOUNT_SERVICE; `/health` 200 không phải bằng chứng readiness.
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
 * Cổng HTTP nội bộ của worker `ecoma-auth` trong WIC — `dev.port` của
 * `apps/auth/wrangler.jsonc`. Bên trong container KHÔNG cần phát hiện xung đột
 * port host (mỗi container có network stack riêng — static port an toàn);
 * khác với đường `local-worker-up` trên host vốn cấp phát động theo namespace.
 */
const AUTH_INTERNAL_PORT = 4203;

/**
 * Cổng HTTP nội bộ của shim `ecoma-account-bridge` trong WIC — `dev.port` của
 * `tools/account-bridge/wrangler.jsonc`. Không publish ra ngoài container:
 * traffic duy nhất đi vào là service binding từ auth (dev registry nội bộ
 * container) và probe liveness nội bộ — hằng này chỉ là tham chiếu tài liệu;
 * entrypoint không nhận port từ Pulumi (nguồn số duy nhất là wrangler.jsonc).
 */
const BRIDGE_INTERNAL_PORT_DOC = 4204;
void BRIDGE_INTERNAL_PORT_DOC;

/** Alias DNS của WIC container trong platform network — namespace theo worktree. */
const AUTH_WIC_ALIAS_PREFIX = 'ecoma-';

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

// Mật khẩu ba role của db-auth — do orchestration sinh và truyền qua --config
// (stdin, không argv). KHÔNG có ownerPassword ở đây: password của `ecoma_owner`
// thuộc về account stack (xem JSDoc đầu file).
const runtimePassword = conf.require('runtimePassword');
const migratorPassword = conf.require('migratorPassword');
const prunerPassword = conf.require('prunerPassword');

// Secrets Worker của auth (PR Worker runtime #183) — cùng kênh `--config`
// (stdin) như mật khẩu role; orchestration (`local-deploy`) sinh và set, stack
// này đọc. Thiếu key là fail ngay lúc `pulumi up` (`conf.require`) chứ không
// container với secret rỗng. `internalSecret` PHẢI bằng giá trị mà account
// stack nhận làm `NUXT_INTERNAL_HMAC_SECRET` (cùng envelope HMAC
// `ecoma-internal-v1` hai chiều) — orchestration là nơi giữ bất biến đó, sinh
// MỘT giá trị rồi set cho CẢ HAI stack.
const signingKeyPem = conf.require('signingKeyPem');
const signingKeyId = conf.require('signingKeyId');
const handleKey = conf.require('handleKey');
const internalSecret = conf.require('internalSecret');
const cookieKeys = conf.require('cookieKeys');

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
$PSQL -c ${shellQuote(`ALTER ROLE ecoma_auth_migrator WITH PASSWORD ${sqlQuote(migratorPassword)};`)}
$PSQL -c ${shellQuote(`ALTER ROLE ecoma_auth_runtime WITH PASSWORD ${sqlQuote(runtimePassword)};`)}
$PSQL -c ${shellQuote(`ALTER ROLE ecoma_auth_nonce_pruner WITH PASSWORD ${sqlQuote(prunerPassword)};`)}
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

/**
 * Image WIC — image MỎNG: chỉ image Node pin + `ca-certificates` (PF2) +
 * entrypoint script. KHÔNG build gì bên trong: repo (kèm bundle `dist/` đã
 * build từ target `build` của Nx trên host) được mount lúc runtime, và
 * `wrangler dev` chạy từ mount đó. Khác account image (multi-stage build
 * `nuxt build` trong Docker) vì auth runtime là `wrangler dev`, không phải
 * process Node đóng gói — image chỉ là "phòng chạy".
 */
const wicImageTag = dockerResourceName(ns, 'auth-wic') + ':local';
const wicImage = new dockerBuild.Image(dockerResourceName(ns, 'auth-wic-image'), {
  context: { location: worktreeRoot },
  dockerfile: { location: `${worktreeRoot}/deploys/auth-deploy/Dockerfile` },
  tags: [wicImageTag],
  builder: { name: 'default' },
  load: true,
  push: false,
  labels,
});

/**
 * Connection string Hyperdrive local của auth (PF3/PF4): role runtime, host
 * alias `ecoma-postgres` của platform network, `sslmode=disable` — miniflare
 * bỏ proxy TLS và workerd dial thẳng host:port. `pulumi.secret` bọc TRƯỚC
 * interpolate (redact trong diff/log); giá trị đi vào container qua kênh
 * `envs` — không argv, không label, không log.
 */
const hyperdriveLocalConnectionString = pulumi.interpolate`postgresql://ecoma_auth_runtime:${pulumi.secret(runtimePassword)}@${POSTGRES_HOST}:5432/db-auth?sslmode=disable`;

/**
 * Cặp AUTH_ISSUER/AUTH_AUDIENCE giá trị local: issuer là origin HTTPS mà
 * Traefik serve (`auth.<rootHostname>`) — provider khởi tạo với ĐÚNG origin
 * này (resume URL, JWKS `iss`, cookies scope đều quy về origin ấy, xem
 * `oidc-fullflow.spec.ts` §bootProvider); audience là resource indicator chỉ
 * cần nhất quán trong local (config requireSecret, không syntax-check).
 */
const issuerLocal = pulumi.interpolate`https://auth.${rootHostname}`;
const audienceLocal = pulumi.interpolate`https://api.${rootHostname}`;

/**
 * Volume RW duy nhất của WIC: state wrangler (`--persist-to` của HAI worker —
 * D1/KV/queue local của workerd, dev registry chia sẻ cho service binding,
 * HOME/XDG cô lập của wrangler). KHÔNG nằm trong repo mount (read-only) —
 * workerd ghi state runtime liên tục; dữ liệu này là EPHEMERAL theo thiết kế
 * (cache local runtime, không phải dữ liệu developer) nên volume không
 * `retainOnDelete` và KHÔNG được liệt kê là dữ liệu persistent nào.
 */
const wicStateVolumeName = dockerResourceName(ns, 'auth-wic-state');
const wicStateVolume = new docker.Volume(wicStateVolumeName, {
  name: wicStateVolumeName,
});

/**
 * Một-shot CHOWN volume state cho uid 1000 (`node`) — Docker tạo volume mới
 * với thư mục gốc `root:root 0755`, mà container WIC chạy non-root
 * (`USER node`, cùng model home/account): node không ghi được vào volume
 * root-owned là wrangler chết ngay lúc boot (`mkdir /state/... EACCES`).
 *
 * Vì sao init container mà không khai `user` trên WIC: một-shot chạy image
 * Node pin với root (default), `chown 1000:1000 /state` rồi thoát — WIC thêm
 * `dependsOn` nó nên lần đầu tiên container lên, volume đã thuộc node. Lần
 * chạy sau là no-op (chown idempotent). Volume KHÔNG mang dữ liệu cần bảo vệ
 * trước container (state wrangler ephemeral) nên root của init container
 * không phải cảnh bảo mật.
 */
const wicStateInit = new docker.Container(
  dockerResourceName(ns, 'auth-wic-state-init'),
  {
    name: dockerResourceName(ns, 'auth-wic-state-init'),
    image: NODE_IMAGE,
    // `rm` sau khi thoát — container init một-shot không nằm lại `docker ps -a`.
    rm: true,
    mounts: [
      {
        source: wicStateVolume.name,
        target: '/state',
        type: 'volume',
      },
    ],
    command: ['chown', '1000:1000', '/state'],
  },
  { dependsOn: [wicStateVolume], retainOnDelete: true },
);

/**
 * Container WIC — HAI worker `wrangler dev` (auth + shim bridge) qua
 * `wic-entrypoint.sh`, plain HTTP trên platform network, TLS do Traefik chấm
 * dứt phía trước (cùng model home/backoffice/account).
 *
 * Thứ tự phụ thuộc: provision → migrate → image → volume → container —
 * container chỉ lên sau khi schema `db-auth` sẵn sàng, để readiness đỏ của
 * cửa sổ chưa-migrate không bị healthcheck giết lặp vô tận.
 *
 * Env:
 * - `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` (secret):
 *   wrangler của process auth đọc biến này của PROCESS để gán connection
 *   string binding HYPERDRIVE (PF3). Thiếu biến là wrangler fail boot
 *   tường minh (fail-closed, worker-config.ts cùng hợp đồng cho đường host).
 * - Secrets Worker của auth: cùng TÊN BIẾN với Worker Secrets production —
 *   wrangler dev map env process vào secrets của worker.
 * - `BRIDGE_TARGET_ORIGIN` cho shim: alias DNS container account của
 *   account stack (`dockerResourceName(ns, 'account')`, port nội bộ 3000 —
 *   cùng nguồn tên với hình dạng `ecoma-<ns>-account` trong `02-identity.md`).
 *   Shim thiếu biến vẫn boot nhưng trả 503 fail-closed cho mọi request qua
 *   binding (src/main.ts của bridge).
 * - `AUTH_ACCOUNT_BASE_URL` trỏ origin HTTPS của account qua Traefik — đúng
 *   origin browser dùng khi điều hướng `interactions.url`.
 *
 * KHÔNG có `ports`: WIC không publish cổng ra host — auth phục vụ qua Traefik
 * (public) và qua dev registry nội bộ container (binding), platform invariant.
 */
const wic = new docker.Container(
  dockerResourceName(ns, 'auth-wic'),
  {
    name: dockerResourceName(ns, 'auth-wic'),
    image: pulumi.interpolate`${wicImageTag}@${wicImage.digest}`,
    restart: 'unless-stopped',
    // `stop_timeout` 30s khớp bounded-wait 20s của entrypoint: SIGTERM → hai
    // workerd được thời gian thoát sạch (flush D1/KV state + registry) trước
    // khi Docker SIGKILL.
    stopTimeout: 30,
    volumes: [
      {
        volumeName: wicStateVolumeName,
        containerPath: '/state',
      },
      // Bundle `dist/` của hai app: repo mount read-only không chứa dist
      // (bundle build trên host bởi target `build` của Nx), mount bind trực
      // tiếp từng thư mục dist đã build (ro: workerd chỉ ĐỌC bundle; build
      // lại bundle trên host là thay đổi nội dung mount, cùng cơ chế hot-reload
      // mà `wrangler dev` dò được).
      {
        hostPath: `${worktreeRoot}/apps/auth/dist`,
        containerPath: '/repo/apps/auth/dist',
        readOnly: true,
      },
      {
        hostPath: `${worktreeRoot}/tools/account-bridge/dist`,
        containerPath: '/repo/tools/account-bridge/dist',
        readOnly: true,
      },
      // KHÔNG mount gì vào `<app>/.wrangler`: Docker không tạo được mountpoint
      // trên repo mount read-only (runc mkdirat fail trước khi container chạy)
      // — entrypoint symlink thư mục này vào volume /state trước khi wrangler
      // boot (xem wic-entrypoint.sh).
    ],
    networksAdvanced: [
      {
        name: networkName,
        aliases: [`${AUTH_WIC_ALIAS_PREFIX}${ns}-auth`],
      },
    ],
    envs: [
      pulumi.interpolate`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=${pulumi.secret(hyperdriveLocalConnectionString)}`,
      pulumi.interpolate`AUTH_SIGNING_KEY=${pulumi.secret(signingKeyPem)}`,
      pulumi.interpolate`AUTH_SIGNING_KEY_ID=${signingKeyId}`,
      pulumi.interpolate`AUTH_HANDLE_KEY=${pulumi.secret(handleKey)}`,
      // '1' — phiên bản khoá handle đầu tiên của local; chỉ phải là chuỗi chữ
      // số dương (parseHandleKeyVersion) và ổn định qua các lần deploy.
      'AUTH_HANDLE_KEY_VERSION=1',
      pulumi.interpolate`AUTH_INTERNAL_SECRET=${pulumi.secret(internalSecret)}`,
      pulumi.interpolate`AUTH_ISSUER=${issuerLocal}`,
      pulumi.interpolate`AUTH_AUDIENCE=${audienceLocal}`,
      pulumi.interpolate`AUTH_COOKIE_KEYS=${pulumi.secret(cookieKeys)}`,
      pulumi.interpolate`AUTH_ACCOUNT_BASE_URL=https://account.${rootHostname}`,
      pulumi.interpolate`BRIDGE_TARGET_ORIGIN=http://${dockerResourceName(ns, 'account')}:3000`,
    ],
    labels: [
      ...Object.entries(labels).map(([label, value]) => ({ label, value })),
      { label: 'traefik.enable', value: 'true' },
      // Bắt buộc với provider docker multi-tenant (memory: cùng network flag
      // KHÔNG lọc — container trên nhiều network bị Traefik thấy qua network
      // nào là do label này quyết).
      { label: 'traefik.docker.network', value: networkName },
      {
        label: `traefik.http.routers.auth-${ns}.rule`,
        value: pulumi.interpolate`Host(\`auth.${rootHostname}\`)`,
      },
      {
        label: `traefik.http.routers.auth-${ns}.entrypoints`,
        value: 'websecure',
      },
      { label: `traefik.http.routers.auth-${ns}.tls`, value: 'true' },
      {
        label: `traefik.http.routers.auth-${ns}.service`,
        value: `auth-${ns}`,
      },
      {
        label: `traefik.http.services.auth-${ns}.loadbalancer.server.port`,
        value: String(AUTH_INTERNAL_PORT),
      },
    ],
    healthcheck: {
      // `/ready` chứ không phải `/health`: readiness phải chứng minh DB probe
      // thật + ACCOUNT_SERVICE probe thành công (`02-identity.md` §Runtime
      // contracts) — `/health` 200 không chạm dependency nào nên không đủ làm
      // bằng chứng container phục vụ được request thật.
      tests: [
        'CMD',
        'node',
        '-e',
        `fetch('http://127.0.0.1:${AUTH_INTERNAL_PORT}/ready')` +
          `.then(r => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))`,
      ],
      interval: '10s',
      timeout: '15s',
      // Probe /ready mở pool Postgres + fetch binding — tổng budget có thể tới
      // ~8s trong trường hợp xấu (connect timeout 3s + account probe 3s); 15s
      // là trần thoải mái, retries cao để cửa sổ boot wrangler (bundle check,
      // registry connect) không bị coi là chết.
      retries: 30,
      startPeriod: '120s',
    },
  },
  { dependsOn: [migrate, wicImage, wicStateVolume, wicStateInit] },
);

export const provisionCommandName = provision.id;
export const migrateCommandName = migrate.id;
export const imageDigest = wicImage.digest;
export const containerName = wic.name;
export const containerId = wic.id;
export const stateVolumeName = wicStateVolume.name;
export const namespaceVerified = verifiedNamespace;
