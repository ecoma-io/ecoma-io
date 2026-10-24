/**
 * Chương trình Pulumi của `pact-broker-app-deploy` — deploy unit của
 * `apps/pact-broker-app` (dashboard BFF của pact-broker) ở LAN LOCAL
 * deployment.
 *
 * Mirror `deploys/home-deploy/index.ts` và `deploys/backoffice-deploy/index.ts`
 * (cùng ownership labels, namespace, stack reference fail-closed, image build
 * qua `@pulumi/docker-build` với builder `default` + `load: true`). Khác biệt:
 * router rule `Host(pact.<rootHostname>)` và container cần secret gọi
 * `pact-broker-api` qua HTTP (base URL + machine token) — đúng contract mà
 * `server/utils/broker-config.ts` kiểm: origin tuyệt đối http(s), token bắt
 * buộc; thiếu hoặc sai là route trả 503 `broker_not_configured` (fail-closed
 * ở chiều đúng, ở tầng app).
 *
 * Phạm vi: chỉ phục vụ stack `local-<namespace>` (Docker runtime). Staging và
 * production của app đi đường Cloudflare Workers qua Wrangler
 * (`apps/pact-broker-app/wrangler.jsonc`, preset `cloudflare-module`) và
 * **không** đi qua chương trình này.
 *
 * Ranh giới ownership: unit này KHÔNG tạo network, Traefik hay PostgreSQL;
 * không sở hữu database nào (invariant 1 của `01-architecture.md` §8 — chỉ
 * `pact-broker-api` chạm `db-pact-broker`). Nó đọc platform outputs qua
 * StackReference rồi join network.
 */

import * as docker from '@pulumi/docker';
import * as dockerBuild from '@pulumi/docker-build';
import * as pulumi from '@pulumi/pulumi';

// `tools/dx` là workspace project `type:tooling`, còn deploy unit là
// `type:deployment`. Import nguồn (specifier không đuôi) là chủ ý — chi tiết
// vì sao KHÔNG dùng `.js` ghi ở `tsconfig.json` của project này; hai deploy
// unit phải dùng CHUNG một định nghĩa namespace và contract outputs.
// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem home-deploy
import {
  dockerResourceName,
  normalizeWorktreeRoot,
  worktreeNamespace,
} from '../../tools/dx/src/local-runtime/deploy-namespace';
// oxlint-disable-next-line @nx/enforce-module-boundaries -- cùng lý do
import { ownershipLabels } from '../../tools/dx/src/deployment/local-platform/deploy-labels';
// oxlint-disable-next-line @nx/enforce-module-boundaries -- cùng lý do
import type { PlatformOutputs } from '../../tools/dx/src/deployment/local-platform/platform-outputs-contract';

/** Cổng nội bộ mà Nitro preset `node-server` nghe (khớp `EXPOSE`/`ENV PORT` của image). */
const PACT_APP_INTERNAL_PORT = 3000;

/**
 * Cổng nội bộ của container `pact-broker-api` mà BFF gọi qua HTTP.
 *
 * ⚠️ TODO(wiring PR): giá trị `8080` là PLACEHOLDER — port thật do unit
 * `pact-broker-api-deploy` (song song) quyết định, và wiring PR sẽ đồng bộ
 * hằng số này với `pact-broker-api-deploy`. Alias `ecoma-pact-api` ở dưới cũng
 * phải khớp alias mà `pact-broker-api-deploy` đặt cho container của nó.
 */
const PACT_API_INTERNAL_PORT = 8080;

/** Alias DNS của container pact-broker-api trong network nội bộ — xem TODO phía trên. */
const PACT_API_ALIAS = 'ecoma-pact-api';

/**
 * Entrypoint HTTPS của Traefik — nơi client gõ `https://pact.<rootHostname>`.
 * Tên router/service mang namespace vì Traefik đọc label toàn cục (multi-tenant
 * giữa các worktree) — xem `home-deploy`.
 */
const traefikPrefix = (ns: string): string => `pact-app-${ns}`;

// Config bag `namespace` — cùng tên bag với điều `platform-deploy` nhận, vì
// orchestration truyền một bộ `--config namespace:...` duy nhất cho cả hai
// project.
const conf = new pulumi.Config('namespace');

const worktreeRoot = conf.require('worktreeRoot');
const ns = worktreeNamespace(worktreeRoot);

/**
 * Labels ownership của resource này — `pnpm dx local-cleanup` đọc bộ labels
 * này thay vì đoán từ tên.
 */
const labels = ownershipLabels(normalizeWorktreeRoot(worktreeRoot), ns);

// Stack reference đầy đủ tới stack platform của chính worktree này, do
// orchestration ghép và truyền qua `--config` — xem `home-deploy`.
const platform = new pulumi.StackReference(conf.require('platformStackRef'));

/**
 * Đọc MỘT output từ stack reference với ràng buộc fail-closed theo contract —
 * biến lệch contract thành lỗi deploy tường minh thay vì deploy "xanh" nhưng
 * rỗng. Xem giải thích đầy đủ ở `home-deploy`.
 */
function requirePlatformOutput<K extends keyof PlatformOutputs>(
  key: K,
): pulumi.Output<PlatformOutputs[K]> {
  return pulumi.output(platform.getOutput(key)).apply((raw) => {
    if (raw === undefined || raw === null) {
      throw new Error(
        `platformStackRef không export "${key}". Nguyên nhân thường gặp nhất: ` +
          `stack platform chưa từng \`up\` thành công (outputs rỗng) hoặc đã bị ` +
          `destroy — chạy \`pnpm dx local-deploy\` (apply platform) trước. Không ` +
          `deploy pact-broker-app với cấu hình rỗng.`,
      );
    }
    return raw as PlatformOutputs[K];
  });
}

const networkName = requirePlatformOutput('networkName');
const platformNamespace = requirePlatformOutput('namespace');
const rootHostname = requirePlatformOutput('rootHostname');

// Machine token mà BFF dùng gọi pact-broker-api — do orchestration sinh/set
// qua stdin (`namespace:apiToken`, xem `localStackSecrets` trong
// `tools/dx/src/deployment/local-platform/local-stack-step.ts`; giá trị cuối
// do `pact-broker-api-deploy` sinh và wiring PR nối). Thiếu key là fail ngay
// lúc `pulumi up` (`conf.require`) chứ không Container với secret rỗng.
// `pulumi.secret` bọc TRƯỚC khi interpolate để giá trị redact trong diff/log.
const apiToken = pulumi.secret(conf.require('apiToken'));

// Fail-closed khi hai stack không thuộc cùng một worktree — export ở cuối file
// để throw trong `apply` làm `pulumi up` fail. Xem `home-deploy`.
const verifiedNamespace = pulumi.output(platformNamespace).apply((upstreamNs) => {
  if (upstreamNs !== ns) {
    throw new Error(
      `platformStackRef trỏ sang stack của namespace khác: ` +
        `platform export "${upstreamNs}" còn worktree này là "${ns}". ` +
        `Hai stack phải cùng worktree — nếu không, pact-broker-app sẽ join nhầm network.`,
    );
  }
  return ns;
});

/**
 * Image local của `apps/pact-broker-app` — contract build giống `home-image`:
 * context repo root, builder `default` (bỏ bước boot builder `docker-container`
 * timeout trên Docker rootless), `load: true` + `push: false` (local không có
 * registry). Xem `home-deploy` cho từng cờ.
 */
/** Tag local của image — một nguồn duy nhất cho `tags` và input `image` của container. */
const imageTag = `ecoma-pact-app-${ns}:local`;

const image = new dockerBuild.Image(dockerResourceName(ns, 'pact-app-image'), {
  context: { location: worktreeRoot },
  dockerfile: { location: `${worktreeRoot}/deploys/pact-broker-app-deploy/Dockerfile` },
  tags: [imageTag],
  builder: { name: 'default' },
  load: true,
  push: false,
  labels,
});

/**
 * Container của `apps/pact-broker-app`.
 *
 * Ghim digest (`tag@sha256:...`) biến mỗi rebuild thành thay đổi input thấy
 * được — container bị thay đúng lúc. KHÔNG có `ports`: mọi request đi qua
 * Traefik của platform — bất biến của local platform.
 */
const pactApp = new docker.Container(dockerResourceName(ns, 'pact-app'), {
  name: dockerResourceName(ns, 'pact-app'),
  image: pulumi.interpolate`${imageTag}@${image.digest}`,
  // `restart: unless-stopped` để DOCKER tự start lại container sau
  // reboot/restart daemon — cùng lý do với traefik/postgres ở `platform-deploy`.
  restart: 'unless-stopped',
  networksAdvanced: [{ name: networkName, aliases: ['ecoma-pact-app'] }],
  // `envs` (không phải `environment`): cặp `KEY=VALUE` dạng mảng chuỗi — shape
  // của `docker run -e`.
  //
  // Broker config: base URL là placeholder port (TODO(wiring PR) phía trên) —
  // sai port chỉ làm `/api/broker/**` trả 502, còn `/health` vẫn xanh vì
  // healthcheck cố ý không phụ thuộc API. Token bọc `pulumi.secret` ở trên nên
  // interpolate giữ redact.
  envs: [
    `PORT=${PACT_APP_INTERNAL_PORT}`,
    'NODE_ENV=production',
    `NITRO_PACT_BROKER_API_BASE_URL=http://${PACT_API_ALIAS}:${PACT_API_INTERNAL_PORT}`,
    pulumi.interpolate`NITRO_PACT_BROKER_API_TOKEN=${apiToken}`,
  ],
  labels: [
    ...Object.entries(labels).map(([label, value]) => ({ label, value })),
    { label: 'traefik.enable', value: 'true' },
    {
      // Khai network của ROUTER này cho Traefik — bắt buộc với provider docker
      // multi-tenant: vừa chọn IP đúng network cho backend, vừa là điều kiện
      // lọc container vào router của đúng worktree. Xem `home-deploy`.
      label: 'traefik.docker.network',
      value: networkName,
    },
    {
      label: `traefik.http.routers.${traefikPrefix(ns)}.rule`,
      value: pulumi.interpolate`Host(\`pact.${rootHostname}\`)`,
    },
    {
      label: `traefik.http.routers.${traefikPrefix(ns)}.entrypoints`,
      value: 'websecure',
    },
    { label: `traefik.http.routers.${traefikPrefix(ns)}.tls`, value: 'true' },
    {
      label: `traefik.http.services.${traefikPrefix(ns)}.loadbalancer.server.port`,
      value: String(PACT_APP_INTERNAL_PORT),
    },
  ],
  healthcheck: {
    // `/health` chứ KHÔNG phải `/ready`: liveness container không được phụ
    // thuộc cấu hình broker — `/ready` trả 503 `broker_not_configured` khi
    // thiếu base URL/token (fail-closed đúng của app nhưng sai làm healthcheck
    // container, làm container bị coi là hỏng trong cửa sổ wiring). `/health`
    // trả 2xx JSON tĩnh, không chạm broker API.
    tests: [
      'CMD',
      'node',
      '-e',
      // Cổng lấy từ cùng hằng số với `ENV PORT` của image, không hard-code lần
      // thứ hai trong một string khác.
      `fetch('http://127.0.0.1:${PACT_APP_INTERNAL_PORT}/health')` +
        `.then(r => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))`,
    ],
    interval: '10s',
    timeout: '5s',
    retries: 12,
    // Nuxt SSR cold start có thể vượt 30s trên host chậm; chỉ sau `startPeriod`
    // mới tính `retries`.
    startPeriod: '30s',
  },
});

export const imageDigest = image.digest;
export const containerName = pactApp.name;
export const containerId = pactApp.id;
/** Namespace đã khớp stack platform — xem check fail-closed ở trên. */
export const namespaceVerified = verifiedNamespace;
