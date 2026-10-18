/**
 * Chương trình Pulumi của `platform-deploy` — nơi duy nhất provision tài nguyên
 * Docker dùng chung cho local deployment của MỘT worktree.
 *
 * Vì sao lại tách theo worktree: nhiều worktree của cùng repository có thể chạy
 * local deployment đồng thời trên một máy developer, nên mọi tên resource ở đây
 * đều bắt đầu từ namespace hash của worktree root. Hai worktree không bao giờ
 * đụng tên, và stack Pulumi local phải đi kèm namespace vì Pulumi state là
 * nguồn sự thật của resource (`tools/dx/src/deploy-namespace.ts`).
 *
 * Chương trình này KHÔNG đọc `.env`: nó nhận `namespace:worktreeRoot` qua Pulumi
 * config do `tools/dx local-deploy` truyền vào. `.env` là artifact tiện dụng sinh
 * ra TỪ outputs của stack này, không phải input — đọc vòng lại sẽ thành vòng phụ
 * thuộc.
 */

import * as pulumi from '@pulumi/pulumi';
import * as docker from '@pulumi/docker';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// `tools/dx` là workspace project `type:tooling`, còn deploy unit là
// `type:deployment`. Import **nguồn** là chủ ý: deploy unit phải dùng CHUNG một
// định nghĩa namespace và contract outputs, và Pulumi runtime `nodejs` chạy thẳng
// `index.ts` — không có bước build `tools/dx` nào chạy trước để sinh package. Copy
// hàm vào deploy unit sẽ tạo hai nơi định nghĩa cùng một thứ và để chúng lệch nhau.
//
// Specifier KHÔNG chữ `.js` (extensionless) — xem tsconfig cùng project để biết
// vì sao `.js` lại fail lúc chạy thật.
//
// `@nx/enforce-module-boundaries` cấm import xuyên project bằng đường dẫn
// tương đối theo mặc định; ở đây ngoại lệ đó được bật tường minh cho đúng hai
// dòng này thay vì nới luật ở `.oxlintrc.json` — nới ở config là mở cho MỌI
// project, còn disable ở đúng chỗ thì giữ được ranh giới cho phần còn lại của
// repo.
// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem giải thích ngay trên
import { dockerResourceName, worktreeNamespace } from '../../tools/dx/src/deploy-namespace';
// oxlint-disable-next-line @nx/enforce-module-boundaries -- cùng lý do dòng trên
import {
  extractTraefikHostPort,
  LOCAL_ROOT_HOSTNAME,
  TRAEFIK_INTERNAL_PORT,
} from '../../tools/dx/src/platform-outputs-contract';

/**
 * Thư mục chứa chương trình này — gốc để định vị cert local.
 *
 * Dùng `__dirname` chứ không phải `import.meta.url` vì Pulumi runtime `nodejs`
 * chạy chương trình dưới CommonJS: `import.meta` không hợp lệ ở đó, và bật
 * `"type": "module"` sẽ làm Pulumi rơi về ts-node vendor 7.0.1 (không có ESM
 * loader) nên không resolve được import ở trên.
 */
const programDir = __dirname;

/** Đường dẫn tuyệt đối tới một file cert local trong repo. */
function certPath(fileName: string): string {
  return join(programDir, 'local-certs', fileName);
}

/**
 * Đường dẫn Docker socket trên HOST để bind-mount vào Traefik.
 *
 * Trả về path tồn tại thật: rootless Docker (máy này) dùng
 * `/run/user/<uid>/docker.sock` và `DOCKER_HOST` của CLI đã trỏ đúng đó, nên
 * suy từ env trước khi rơi về path rootful. Fallback cuối vẫn là path chuẩn vì
 * Pulumi với docker provider đã nói chuyện được với daemon để tới được đây.
 */
function dockerSocketPath(): string {
  const explicit = process.env['DOCKER_SOCKET_PATH'];
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const host = process.env['DOCKER_HOST'] ?? '';
  if (host.startsWith('unix://')) {
    const socketPath = host.slice('unix://'.length);
    if (existsSync(socketPath)) return socketPath;
  }
  return '/var/run/docker.sock';
}

/**
 * Image Traefik ghim theo DIGEST, không theo tag.
 *
 * Traefik đứng trước mọi request local nên một tag trôi (`v3`, `latest`) biến
 * thay đổi hành vi thành thay đổi hạ tầng ngoài ý muốn. Digest biến việc đó
 * thành thay đổi tường minh trong diff.
 *
 * Version TỐI THIỂU 3.6.1 là ràng buộc cứng, không phải sở thích: Traefik ≤
 * 3.6.0 ghim Docker client API version 1.24 trong source (`DockerAPIVersion`
 * trong `pkg/provider/docker/pdocker.go`, `client.WithVersion(cfg.apiVersion)`
 * chạy SAU `client.FromEnv` nên env không override được) và daemon Docker mới
 * từ chối mọi client < 1.40 — provider rơi vào vòng lặp "client version 1.24
 * is too old". 3.6.1 bỏ ghim (client dùng version mặc định mới nhất của SDK),
 * nên mọi daemon ≥ 20.10 hoạt động. Digest này là v3.7.15.
 */
const TRAEFIK_IMAGE =
  'traefik@sha256:0f6150202bc1fed72a7bd2107460eaa510e5b8a905f3fdb5b84f2c8619c33368';

/**
 * Image PostgreSQL ghim theo digest: PostgreSQL 17.11 + TimescaleDB 2.30.2 +
 * pgvector — extension của các service có time series, không phải của Traefik.
 */
const POSTGRES_IMAGE =
  'timescale/timescaledb@sha256:b346edcdb51a1fd6020e3965e0bd1c9f3406fa6d5fbce1e28f4852587ef934e2';

/** Số cổng PostgreSQL trong network — nội bộ, không phải host port. */
const POSTGRES_INTERNAL_PORT = 5432;

/**
 * Service alias của PostgreSQL trong network.
 *
 * Đây là cách consumer (home, service khác) chạm database, KHÔNG phải tên
 * container. Tên container có namespace theo worktree nên đổi mỗi worktree;
 * alias này cố định để contract outputs không phụ thuộc worktree nào đang chạy.
 */
const POSTGRES_HOST_ALIAS = 'ecoma-postgres';

/** User và database local — hằng số, vì chúng không phải secret. */
const POSTGRES_USER = 'ecoma_local';
const POSTGRES_DB = 'ecoma_local';

/**
 * File dynamic config của Traefik — file tĩnh `traefik-dynamic.yml` cạnh
 * chương trình, bind-mount vào container (xem comment trong file đó vì sao
 * không dùng `uploads` của provider).
 *
 * Traefik v3 KHÔNG expose cờ CLI cho `certFile`/`keyFile` (kiểm trên 3.5.6: flag
 * `--entrypoints.<name>.http.tls.certificates.certFile` không tồn tại và làm
 * Traefik fail ngay lúc boot với `field not found, node: certificates`). Đường
 * hỗ trợ trong v3 là dynamic configuration qua file provider, và `/etc/traefik`
 * không có sẵn trong image nên file được mount vào `/tmp` thay vì chỉnh file
 * tĩnh của image.
 */
const TRAEFIK_DYNAMIC_CONFIG_PATH = '/tmp/traefik-dynamic.yml';

/** Thư mục chứa cert/key bind-mount. */
const CERTS_DIR = '/certs';

const config = new pulumi.Config('namespace');

/**
 * Worktree root do `tools/dx local-deploy` truyền vào.
 *
 * `require` chứ không phải `get`: thiếu config thì namespace sẽ được hash từ
 * chuỗi rỗng và mọi tên resource trở nên không nhất quán giữa hai lần chạy — đúng
 * loại lỗi mà `deploy-namespace.ts` sinh ra để tránh. Fail sớm hơn là an toàn hơn.
 */
const ns = worktreeNamespace(config.require('worktreeRoot'));

/**
 * Docker network của worktree này.
 *
 * `name` khai tường minh (thay vì để Pulumi tự đặt) vì consumer đọc TÊN network
 * này từ outputs để join; tên suy ra từ URN sẽ đổi theo stack và không ổn định
 * giữa các lần chạy.
 */
const network = new docker.Network('network', {
  name: dockerResourceName(ns, 'network'),
});

/**
 * Traefik: reverse proxy duy nhất của local deployment.
 *
 * Chỉ MỘT entrypoint HTTPS ở cổng nội bộ 443. Cổng host do Docker cấp động
 * (`external` bỏ trống) và chỉ bind loopback — không publish ra mạng LAN, và không
 * đoán trước port để hai worktree không tranh nhau.
 */
const traefik = new docker.Container('traefik', {
  name: dockerResourceName(ns, 'traefik'),
  image: TRAEFIK_IMAGE,
  command: [
    `--entrypoints.websecure.address=:${TRAEFIK_INTERNAL_PORT}`,
    // Docker provider: chỉ route container nào tự gắn label routing.
    '--providers.docker=true',
    '--providers.docker.exposedbydefault=false',
    // Nói rõ network để Traefik về tới backend trong đúng network của
    // worktree này, không chọn nhầm network khá của host.
    pulumi.interpolate`--providers.docker.network=${network.name}`,
    // Lọc container vào router của ĐÚNG worktree — defense-in-depth thứ hai,
    // cạnh label `traefik.docker.network` mà home tự gắn. Không có filter này,
    // Docker provider thấy TẤT CẢ container có `traefik.enable=true` trên host
    // qua socket dùng chung (cờ `network` chỉ chọn IP khi container nằm trên
    // nhiều network, KHÔNG loại container ra khỏi config): home của worktree
    // khác vẫn được đăng ký thành router `Host(fbi.com)` thứ hai, và khi Traefik
    // trúng backend ở network không nối tới — request treo vĩnh viễn thay vì
    // lỗi rõ (đã kiểm thực nghiệm hai worktree song song). Constraint theo
    // label biến điều đó thành bất khả: container không mang label network của
    // worktree này không bao giờ vào config của Traefik này.
    pulumi.interpolate`--providers.docker.constraints=Label(\`traefik.docker.network\`, \`${network.name}\`)`,
    // File provider chỉ phục vụ dynamic config của TLS store ở trên.
    `--providers.file.filename=${TRAEFIK_DYNAMIC_CONFIG_PATH}`,
    '--ping=true',
    `--ping.entrypoint=websecure`,
  ],
  ports: [
    {
      internal: TRAEFIK_INTERNAL_PORT,
      // Cố ý KHÔNG khai `external`: Docker cấp port rảnh >= 32768 tại create
      // time, đọc lại được qua output `ports` SAU khi container đã tồn tại.
      ip: '127.0.0.1',
    },
  ],
  mounts: [
    {
      source: certPath('fbi.com.crt'),
      target: `${CERTS_DIR}/fbi.com.crt`,
      type: 'bind',
      readOnly: true,
    },
    {
      source: certPath('fbi.com.key'),
      target: `${CERTS_DIR}/fbi.com.key`,
      type: 'bind',
      readOnly: true,
    },
    {
      // Docker socket: Traefik cần ĐỌC container labels để dựng router.
      // Read-only là đủ — Traefik không cần quyền tạo/điều khiển container.
      //
      // Máy chạy rootless Docker đặt socket ở `/run/user/<uid>/docker.sock`
      // (đó là giá trị `DOCKER_HOST` mà Docker CLI của máy đang dùng), KHÔNG
      // phải `/var/run/docker.sock` — bind-mount một path không tồn tại sẽ tạo
      // ra thư mục rỗng trong container và Traefik hỏng với lỗi dễ gây hiểu
      // nhầm ("Cannot connect to the Docker daemon") thay vì lỗi mount. Ưu
      // tiên: `DOCKER_SOCKET_PATH` tường minh > đường dẫn trong `DOCKER_HOST`
      // (chỉ chấp nhận `unix://`) > path chuẩn rootful.
      source: dockerSocketPath(),
      target: '/var/run/docker.sock',
      type: 'bind',
      readOnly: true,
    },
    {
      // Dynamic config TLS — file tĩnh trong repo, xem TRAEFIK_DYNAMIC_CONFIG_PATH.
      source: `${programDir}/traefik-dynamic.yml`,
      target: TRAEFIK_DYNAMIC_CONFIG_PATH,
      type: 'bind',
      readOnly: true,
    },
  ],
  networksAdvanced: [{ name: network.name }],
  healthcheck: {
    // `traefik healthcheck` là subcommand RIÊNG, đọc lại config từ CÙNG bộ cờ
    // mà Traefik được khởi động. Nếu chỉ truyền `--ping` thì nó mặc định gọi
    // `http://:8080/ping` — cổng không tồn tại vì ở đây chỉ có entrypoint
    // `websecure` trên 443, và container được đánh dấu unhealthy dù Traefik vẫn
    // phục vụ bình thường. Phải lặp lại hai cờ định hình ping cho khớp.
    tests: [
      'CMD',
      'traefik',
      'healthcheck',
      '--ping',
      '--entrypoints.websecure.address=:443',
      '--ping.entrypoint=websecure',
    ],
    interval: '5s',
    timeout: '3s',
    retries: 5,
    startPeriod: '5s',
  },
});

/**
 * Password PostgreSQL đến từ Pulumi config dạng secret.
 *
 * `requireSecret` thay vì literal trong source: secret đọc từ config không bị
 * ghi vào Git, không xuất hiện trong preview, và mỗi máy developer tự đặt được.
 */
const postgresPassword = new pulumi.Config('postgres').requireSecret('password');

/**
 * Volume dữ liệu PostgreSQL, TÁCH khỏi container VÀ tách khỏi vòng đời stack.
 *
 * Tách là bắt buộc chứ không phải sở thích: `destroy` container không được mất
 * dữ liệu, nên vòng đời volume phải độc lập với vòng đời process.
 *
 * `retainOnDelete` là mảnh thứ hai của đảm bảo đó: không có nó, `pulumi
 * destroy` xoá CẢ volume (đã kiểm thực nghiệm — volume biến mất cùng stack),
 * và lời hứa "mặc định giữ dữ liệu" của `tools/dx local-destroy` thành giả.
 * Với `retainOnDelete`, xoá resource khỏi state KHÔNG xoá volume Docker —
 * dữ liệu chỉ biến mất khi `local-destroy --remove-data` gọi `docker volume
 * rm` tường minh sau một cảnh báo.
 */
const postgresVolume = new docker.Volume(
  'postgres-volume',
  {
    name: dockerResourceName(ns, 'postgres-volume'),
  },
  { retainOnDelete: true },
);

/**
 * PostgreSQL — database của toàn bộ local deployment.
 *
 * KHÔNG khai `ports`: database không bao giờ publish cổng ra host. Chỉ service
 * trong cùng network mới chạm được nó, qua alias ổn định `ecoma-postgres`.
 *
 * Resource này CỐ Ý không xuất ra stack output: contract `PlatformOutputs` chỉ có
 * sáu khoá (xem `tools/dx/src/platform-outputs-contract.ts`) và không khoá nào
 * mang id của database. Giữ nó trong state để Pulumi quản lý vòng đời — đó là
 * mục đích duy nhất cần tới biến.
 */
// oxlint-disable-next-line no-unused-vars -- resource cần tồn tại trong state, xem chú thích ngay trên
const postgres = new docker.Container('postgres', {
  name: dockerResourceName(ns, 'postgres'),
  image: POSTGRES_IMAGE,
  // `envs` là mảng `KEY=VALUE` của provider này (không phải map `env`).
  // Truyền thẳng object secret của Pulumi vào đây để value được đánh dấu
  // secret và không bao giờ in ra log hay nằm trong preview dạng plaintext.
  envs: [
    `POSTGRES_USER=${POSTGRES_USER}`,
    `POSTGRES_DB=${POSTGRES_DB}`,
    // `requireSecret` trả về Output<string>: dùng interpolation để Pulumi đánh
    // dấu secret và không bao giờ in plaintext ra log hay preview.
    pulumi.interpolate`POSTGRES_PASSWORD=${postgresPassword}`,
    // TimescaleDB phải được preload mới chạy; nói tường minh thay vì trông
    // vào `postgresql.conf.sample` của image.
    'POSTGRES_SHARED_PRELOAD_LIBRARIES=timescaledb',
  ],
  mounts: [
    {
      source: postgresVolume.name,
      target: '/var/lib/postgresql/data',
      type: 'volume',
    },
  ],
  networksAdvanced: [{ name: network.name, aliases: [POSTGRES_HOST_ALIAS] }],
  healthcheck: {
    tests: ['CMD-SHELL', `pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}`],
    interval: '5s',
    timeout: '3s',
    retries: 10,
    startPeriod: '10s',
  },
});

/**
 * Outputs của platform stack — đây là CONTRACT với `home-deploy`, mô tả ở
 * `tools/dx/src/platform-outputs-contract.ts`. Không secret nào được export.
 */
export const namespace = ns;
export const networkName = network.name;
export const postgresHost = POSTGRES_HOST_ALIAS;
export const postgresPort = POSTGRES_INTERNAL_PORT;

/**
 * Host port Docker đã cấp cho Traefik HTTPS.
 *
 * `extractTraefikHostPort` FAIL-CLOSED khi Docker chưa cấp port, nên consumer
 * không bao giờ nhận `undefined` rồi sinh ra `fbi.com:undefined`.
 */
export const traefikHostPort = pulumi.output(traefik.ports).apply(extractTraefikHostPort);

export const rootHostname = LOCAL_ROOT_HOSTNAME;
