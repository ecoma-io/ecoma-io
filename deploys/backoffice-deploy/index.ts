/**
 * Chương trình Pulumi của `backoffice-deploy` — deploy unit của `apps/backoffice`
 * ở LAN LOCAL deployment.
 *
 * Mirror `deploys/home-deploy/index.ts` (cùng ownership labels, namespace, stack
 * reference, fail-closed). Khác biệt: router rule `Host(office.fbi.com)` và
 * image build từ `apps/backoffice` với preset `node-server`.
 */

import * as command from '@pulumi/command';
import * as docker from '@pulumi/docker';
import * as dockerBuild from '@pulumi/docker-build';
import * as pulumi from '@pulumi/pulumi';

// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem home-deploy
import {
  dockerResourceName,
  normalizeWorktreeRoot,
  worktreeNamespace,
} from '../../tools/dx/src/deploy-namespace';
// oxlint-disable-next-line @nx/enforce-module-boundaries -- cùng lý do
import { ownershipLabels } from '../../tools/dx/src/deploy-labels';
// oxlint-disable-next-line @nx/enforce-module-boundaries -- cùng lý do
import type { PlatformOutputs } from '../../tools/dx/src/platform-outputs-contract';

const BACKOFFICE_INTERNAL_PORT = 3000;

const traefikPrefix = (ns: string): string => `backoffice-${ns}`;

const conf = new pulumi.Config('namespace');

const worktreeRoot = conf.require('worktreeRoot');
const ns = worktreeNamespace(worktreeRoot);

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

// Mật khẩu hai role local — do orchestration sinh và truyền qua --config.
const runtimePassword = conf.require('runtimePassword');
const migratorPassword = conf.require('migratorPassword');

// Connection string runtime (role ecoma_backoffice_runtime) qua network nội bộ.
const backofficeDatabaseUrl = pulumi.interpolate`postgresql://ecoma_backoffice_runtime:${pulumi.secret(runtimePassword)}@ecoma-postgres:5432/db-backoffice`;

const verifiedNamespace = pulumi.output(platformNamespace).apply((upstreamNs) => {
  if (upstreamNs !== ns) {
    throw new Error(
      `platformStackRef trỏ sang stack của namespace khác: platform export "${upstreamNs}" còn worktree này là "${ns}".`,
    );
  }
  return ns;
});

const imageTag = `ecoma-backoffice-${ns}:local`;

const image = new dockerBuild.Image(dockerResourceName(ns, 'backoffice-image'), {
  context: { location: worktreeRoot },
  dockerfile: { location: `${worktreeRoot}/deploys/backoffice-deploy/Dockerfile` },
  tags: [imageTag],
  builder: { name: 'default' },
  load: true,
  push: false,
  labels,
});

/**
 * Provision `db-backoffice` + hai role + migration, chạy trên host qua `docker exec`
 * vào container PostgreSQL của platform (không publish host port).
 *
 * Idempotent: mỗi câu SQL guard bằng `IF NOT EXISTS`/`\gexec`. Chạy cả
 * `create` và `update` để redeploy cũng áp migration mới.
 */
const postgresContainerName = dockerResourceName(ns, 'postgres');
const provisionScript = pulumi.interpolate`set -e
PG=${postgresContainerName}
# 1. Tạo database nếu chưa có (idempotent qua shell guard).
if ! docker exec "$PG" psql -U ecoma_local -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='db-backoffice'" | grep -q 1; then docker exec "$PG" psql -U ecoma_local -d postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE "db-backoffice"'; fi
# 2. Tạo hai role nếu chưa có.
docker exec "$PG" psql -U ecoma_local -d postgres -v ON_ERROR_STOP=1 -c "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='ecoma_backoffice_migrator') THEN CREATE ROLE ecoma_backoffice_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; END $$;"
docker exec "$PG" psql -U ecoma_local -d postgres -v ON_ERROR_STOP=1 -c "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='ecoma_backoffice_runtime') THEN CREATE ROLE ecoma_backoffice_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; END $$;"
# 3. Mật khẩu role.
docker exec "$PG" psql -U ecoma_local -d postgres -v ON_ERROR_STOP=1 -c "ALTER ROLE ecoma_backoffice_migrator WITH PASSWORD '${migratorPassword}';"
docker exec "$PG" psql -U ecoma_local -d postgres -v ON_ERROR_STOP=1 -c "ALTER ROLE ecoma_backoffice_runtime WITH PASSWORD '${runtimePassword}';"
# 4. Grant migrator.
docker exec "$PG" psql -U ecoma_local -d postgres -v ON_ERROR_STOP=1 -c "GRANT CONNECT, CREATE, TEMPORARY ON DATABASE \"db-backoffice\" TO ecoma_backoffice_migrator;"
# 5. Migration qua socket trong container (trust local) — dùng runner SQL thật.
{ echo "SELECT pg_advisory_lock(hashtext('db-backoffice'));"; cat ${worktreeRoot}/apps/backoffice/db/migrations/*.sql; echo "SELECT pg_advisory_unlock(hashtext('db-backoffice'));"; } | docker exec -i "$PG" psql -U ecoma_backoffice_migrator -d db-backoffice -v ON_ERROR_STOP=1
`;

const provision = new command.local.Command(
  dockerResourceName(ns, 'backoffice') + '-provision',
  {
    create: provisionScript,
    update: provisionScript,
    triggers: [runtimePassword, migratorPassword, worktreeRoot],
  },
  { dependsOn: [image] },
);

const backoffice = new docker.Container(
  dockerResourceName(ns, 'backoffice'),
  {
    name: dockerResourceName(ns, 'backoffice'),
    image: pulumi.interpolate`${imageTag}@${image.digest}`,
    restart: 'unless-stopped',
    networksAdvanced: [{ name: networkName, aliases: ['ecoma-backoffice'] }],
    envs: [
      `PORT=${BACKOFFICE_INTERNAL_PORT}`,
      'NODE_ENV=production',
      pulumi.interpolate`NITRO_BACKOFFICE_DATABASE_URL=${backofficeDatabaseUrl}`,
    ],
    labels: [
      ...Object.entries(labels).map(([label, value]) => ({ label, value })),
      { label: 'traefik.enable', value: 'true' },
      { label: 'traefik.docker.network', value: networkName },
      {
        label: `traefik.http.routers.${traefikPrefix(ns)}.rule`,
        value: pulumi.interpolate`Host(\`office.${rootHostname}\`)`,
      },
      {
        label: `traefik.http.routers.${traefikPrefix(ns)}.entrypoints`,
        value: 'websecure',
      },
      { label: `traefik.http.routers.${traefikPrefix(ns)}.tls`, value: 'true' },
      {
        label: `traefik.http.services.${traefikPrefix(ns)}.loadbalancer.server.port`,
        value: String(BACKOFFICE_INTERNAL_PORT),
      },
    ],
    healthcheck: {
      tests: [
        'CMD',
        'node',
        '-e',
        `fetch('http://127.0.0.1:${BACKOFFICE_INTERNAL_PORT}/health')` +
          `.then(r => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))`,
      ],
      interval: '10s',
      timeout: '5s',
      retries: 12,
      startPeriod: '30s',
    },
  },
  { dependsOn: [provision] },
);

export const imageDigest = image.digest;
export const containerName = backoffice.name;
export const containerId = backoffice.id;
export const namespaceVerified = verifiedNamespace;
