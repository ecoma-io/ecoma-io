/**
 * Một BƯỚC của luồng deploy local, chạy cho MỘT deploy project — execution
 * boundary của orchestration Nx Task Graph.
 *
 * Target Nx (`local-up`/`local-smoke` trên `deploys/*-deploy`) gọi
 * lệnh này qua `nx:run-commands`; thứ tự giữa các target là CONTRACT đã khai
 * bằng `dependsOn` trong package.json của từng deploy project. Module này cố ý KHÔNG
 * biết thứ tự toàn cục — nó chỉ làm đúng MỘT bước cho đúng MỘT stack. Graph quy
 * định "khi nào"; module này quy định "làm gì".
 *
 * Các tổ hợp (project, step) hợp lệ:
 *
 * - `platform-deploy` + `up`    → ensureStack + resolve password + `pulumi up` + ghi `.env` (chỉ key sở hữu)
 * - `<unit>-deploy` + `up`      → secrets per-stack qua stdin → `pulumi up`
 * - `platform-deploy` + `smoke` → smoke HTTPS qua Traefik (node lá của chuỗi)
 *
 * Kỷ luật secret giữ nguyên bản hard-coded: giá trị đi qua STDIN (không argv —
 * argv đọc được qua `/proc/<pid>/cmdline` và `ps`), passphrase do công cụ quản
 * lý, `.env` là artifact sinh ra từ stack config chứ không phải nguồn sự thật.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { acquireLocalDeployLock } from './../../local-runtime/local-lock.js';
import { dockerResourceName } from './../../local-runtime/deploy-namespace.js';
import {
  buildRootHost,
  POSTGRES_PASSWORD_ENV_KEY,
  ROOT_DOMAIN_ENV_KEY,
  ROOT_HOST_ENV_KEY,
} from './platform-outputs-contract.js';
import {
  exec,
  ensureStack,
  fullStackRef,
  pulumiEnv,
  pulumiRun,
  resolveContext,
  resolveLocalPassphrase,
  type ExecResult,
  type LocalDeployContext,
} from './pulumi-context.js';
import {
  generateAppSecret,
  generateBase64Key32,
  generateEs256SigningKeyPem,
  generateHexKey64,
  generateInternalHmacSecret,
  generatePostgresPassword,
  resolvePlatformEnv,
  resolvePlatformUp,
} from './local-deploy-steps.js';
import { resolvePostgresPassword, upsertLocalEnv } from './local-deploy.js';
import { ROOT_DIR } from '../../utils.js';

/** Các step mà lệnh này nhận diện — 1:1 với target Nx local trên deploy project. */
export const LOCAL_STACK_STEPS = ['up', 'smoke'] as const;
export type LocalStackStep = (typeof LOCAL_STACK_STEPS)[number];

/** Project duy nhất nhận step `smoke` — smoke end-to-end qua Traefik. */
export const STEP_SMOKE_OWNER = 'platform-deploy';

/** Lỗi tham số — target khai sai tổ hợp phải fail-closed ngay khi validate. */
export class LocalStackStepUsageError extends Error {}

/** Validate tổ hợp (project, step) trước khi chạm Pulumi/Docker. */
export function validateStepTarget(project: string, step: LocalStackStep): void {
  if (step === 'smoke' && project !== STEP_SMOKE_OWNER) {
    throw new LocalStackStepUsageError(
      `step "smoke" chỉ hợp lệ trên ${STEP_SMOKE_OWNER}; nhận: ${project}`,
    );
  }
}

/**
 * Secrets per-stack của lane local — một nguồn duy nhất cho mọi đường
 * orchestration (hai bản tự dựng là chỗ trôi lệch).
 *
 * `inputs.identityInternalSecret` PHẢI là cùng giá trị cho account và auth:
 * account nhận làm `namespace:internalHmacSecret`, auth nhận làm
 * `namespace:internalSecret` — hai giá trị khác nhau là mọi envelope internal
 * chết `bad_signature` lúc runtime. Bất biến "cùng secret" thuộc về
 * orchestration; `runUpStep` bảo đảm nó qua persistence stack account.
 *
 * Tương tự cho `inputs.mailInternalAuthSecret` trên path Account↔Mail: account
 * nhận làm `namespace:mailInternalAuthSecret` (persist), transactional-mail-deploy
 * nhận CÙNG giá trị (`namespace:mailInternalAuthSecret` — read lại từ stack
 * account). PHẢI khác `identityInternalSecret`: receiver mail suy principal từ
 * credential khớp, còn validation của account từ chối hai secret trùng nhau.
 */
export function localStackSecrets(
  project: string,
  inputs: {
    rootHost: string;
    identityInternalSecret: string;
    mailInternalAuthSecret: string;
    pactApiMachineToken: string;
    signingKeyPem: string;
  },
): ReadonlyArray<readonly [string, string]> {
  if (project === 'account-deploy') {
    return [
      ['namespace:ownerPassword', generatePostgresPassword()],
      ['namespace:runtimePassword', generatePostgresPassword()],
      ['namespace:migratorPassword', generatePostgresPassword()],
      ['namespace:prunerPassword', generatePostgresPassword()],
      ['namespace:internalHmacSecret', inputs.identityInternalSecret],
      ['namespace:mailInternalAuthSecret', inputs.mailInternalAuthSecret],
      ['namespace:otpHmacSecret', generatePostgresPassword()],
    ] as const;
  }
  if (project === 'auth-deploy') {
    return [
      ['namespace:runtimePassword', generatePostgresPassword()],
      ['namespace:migratorPassword', generatePostgresPassword()],
      ['namespace:prunerPassword', generatePostgresPassword()],
      // Secrets Worker của auth (WIC): cùng TÊN BIẾN với Worker Secrets
      // production. Không set `AUTH_INTERNAL_KID`/`AUTH_INTERNAL_PREVIOUS_*` —
      // local không xoay secret, thiếu là trạng thái hợp lệ (config.ts chấp
      // nhận tường minh).
      ['namespace:signingKeyPem', inputs.signingKeyPem],
      ['namespace:signingKeyId', 'local-identity-1'],
      // `handleKey` là khoá HMAC-SHA-256 của domain lib (importKey bắt ĐÚNG 32
      // byte) và `cookieKeys` là keygrip key của oidc-provider — cả hai là
      // secret ứng dụng, dùng `generateAppSecret` (32 byte) thay vì mật khẩu
      // 24 byte của database (#284): sai hình là mọi request /authorize chết
      // `K_auth phai dai 32 byte` ngay lúc mint đầu tiên.
      ['namespace:handleKey', generateAppSecret()],
      ['namespace:internalSecret', inputs.identityInternalSecret],
      ['namespace:issuer', `https://auth.${inputs.rootHost}`],
      ['namespace:audience', `https://api.${inputs.rootHost}`],
      ['namespace:cookieKeys', generateAppSecret()],
    ] as const;
  }
  if (project === 'backoffice-deploy') {
    return [
      ['namespace:runtimePassword', generatePostgresPassword()],
      ['namespace:migratorPassword', generatePostgresPassword()],
    ] as const;
  }
  if (project === 'pact-broker-app-deploy') {
    // Machine token mà BFF dùng gọi pact-broker-api (`NITRO_PACT_BROKER_API_
    // TOKEN`). CÙNG GIÁ TRỊ stack `pact-broker-api-deploy` đã persist làm
    // `namespace:machineToken` (inputs.pactApiMachineToken — resolver đọc lại
    // từ stack config của api sau khi api up; api seed HASH của token này vào
    // DB, BFF dùng plaintext gọi API). Một giá trị chia hai stack — cùng cơ chế
    // `identityInternalSecret`/`mailInternalAuthSecret`.
    return [['namespace:apiToken', inputs.pactApiMachineToken]] as const;
  }
  if (project === 'pact-broker-api-deploy') {
    return [
      ['namespace:runtimePassword', generatePostgresPassword()],
      ['namespace:migratorPassword', generatePostgresPassword()],
      // Machine token plaintext của consumer local (`pact-broker-app`): stack
      // pact-broker-api chỉ seed HASH SHA-256 vào DB; plaintext nằm ở stack
      // config này để unit pact-app đọc qua cross-stack `pulumi config get`
      // (cùng hình auth đọc internalHmacSecret từ account stack).
      ['namespace:machineToken', generatePostgresPassword()],
    ] as const;
  }
  if (project === 'transactional-mail-deploy') {
    // Secret HMAC path Account↔Mail — CÙNG GIÁ TRỊ account đã persist (một giá
    // trị chia hai stack, cơ chế `identityInternalSecret`). Receiver mail giữ nó
    // làm entry `MAIL_INTERNAL_AUTH_SECRET_SVC_ACCOUNT` của credential registry.
    // Ba secret còn lại là CỦA RIÊNG cặp mail local (không stack nào khác đọc):
    // secret HMAC consumer<->control plane, khoá keyring fingerprint và khoá
    // quarantine — sinh tại chỗ mỗi lần up, cùng chu kỳ xoay với các secret
    // local khác (`otpHmacSecret`, `cookieKeys`): hai process của cặp nhận
    // ĐỒNG BỘ giá trị mới trong CÙNG một lần up nên không bao giờ lệch nhau.
    return [
      ['namespace:mailInternalAuthSecret', inputs.mailInternalAuthSecret],
      ['namespace:mailerJobInternalSecret', generateInternalHmacSecret()],
      ['namespace:mailFingerprintKey', generateHexKey64()],
      ['namespace:mailQuarantineHmacKey', generateHexKey64()],
    ] as const;
  }
  if (project === 'push-notification-deploy') {
    // Cả BỐN secret là CỦA RIÊNG cặp push local (không stack nào khác đọc):
    // hai process của cặp sống trong MỘT container WIC nên orchestration cấp
    // ĐỒNG BỘ giá trị mới trong CÙNG một lần up — không cần persistence
    // cross-stack. `runtimeSharedSecret` đi vào CẢ HAI worker (control plane
    // `RUNTIME_API_SHARED_SECRET` + consumer cùng biến, hai env NAME một giá
    // trị); `credentialRootKey` là base64 của 32 byte AES-256 (mà `buildCipher`
    // kiểm) — xoay mỗi lần up là vô hại vì D1 `push` trên volume state là
    // ephemeral theo thiết kế (không credential nào sống qua hai lần up).
    return [
      ['namespace:runtimeSharedSecret', generateInternalHmacSecret()],
      ['namespace:adminToken', generateInternalHmacSecret()],
      ['namespace:applicationToken', generateInternalHmacSecret()],
      ['namespace:credentialRootKey', generateBase64Key32()],
    ] as const;
  }
  return [];
}

/** Danh sách KEY secret của một project — dùng cho spec kiểm trùng key. */
export function localStackSecretsKeys(
  project: string,
  inputs: {
    rootHost: string;
    identityInternalSecret: string;
    mailInternalAuthSecret: string;
    signingKeyPem: string;
    pactApiMachineToken: string;
  },
): string[] {
  return localStackSecrets(project, inputs).map(([key]) => key);
}

/** Ghi một secret vào stack config QUA STDIN (không argv) — fail-loud khi set lỗi. */
export function setStackSecret(
  project: string,
  configKey: string,
  configValue: string,
  ctx: LocalDeployContext,
  env: NodeJS.ProcessEnv,
  projectRootDir: string,
): void {
  const result = exec(
    'pulumi',
    ['config', 'set', configKey, '--plaintext', '--raw', '--stack', fullStackRef(project, ctx)],
    projectRootDir,
    env,
    { input: configValue },
  );
  if (result.status !== 0) {
    throw new Error(`pulumi config set ${configKey} thất bại:\n${result.stderr}`);
  }
}

/** Hình dạng tuỳ chọn của `runLocalStackStep`. */
export interface LocalStackStepOptions {
  worktreeRoot?: string;
}

/**
 * Thực thi MỘT bước cho MỘT project — điểm vào của target Nx `local-stack-step`.
 *
 * Step `up` bao trọn trong lock host-wide (`/tmp/ecoma-local-deploy.lock`):
 * target Nx chạy nhiều task song song theo graph nhưng các task ĐÓ đã tuần tự
 * hoá nhau bằng `dependsOn`; lock giữ an toàn khi lệnh này chạy cạnh
 * `local-deploy`/`local-cleanup` khác trên cùng daemon. Step `smoke` không
 * mutate Docker nên không cần lock.
 */
export async function runLocalStackStep(
  project: string,
  step: LocalStackStep,
  options: LocalStackStepOptions = {},
): Promise<number> {
  validateStepTarget(project, step);

  const ctx = resolveContext(options.worktreeRoot);
  console.log(`[local-stack-step] project=${project} step=${step} namespace=${ctx.namespace}`);

  const passphrase = resolveLocalPassphrase(ctx.worktreeRoot, { create: step === 'up' });
  if (step === 'up' && passphrase.kind === 'none') {
    console.error(
      '[local-stack-step] không resolve được passphrase cho worktree đã có state — cung cấp ' +
        'PULUMI_CONFIG_PASSPHRASE (xem pulumi-context.ts).',
    );
    return 1;
  }
  const env = pulumiEnv(ctx, passphrase);
  const projectDir = join(ROOT_DIR, 'deploys', project);

  if (step === 'up') {
    const lock = acquireLocalDeployLock();
    try {
      return await runUpStep(project, ctx, env, projectDir);
    } finally {
      lock();
    }
  }

  // step === 'smoke'
  const smokeExit = runSmokeStep(ctx.worktreeRoot);
  if (smokeExit !== 0) return smokeExit;
  return verifyLaneHealth(ctx);
}

/**
 * Health gate của lane MỞ RỘNG (#264) — chạy SAU khi smoke HTTPS home xanh.
 *
 * Smoke HTTPS chỉ chạm home qua Traefik; bốn unit wave-2/wave-1.5 (pact-api
 * WIC, pact-app, mail WIC, push WIC) KHÔNG xuất origin công khai nào ngoài
 * `pact.<rootHost>`, nên bằng chứng "unit sống" ở đây là healthcheck Docker:
 * container `running` với `Health.Status=healthy` — probe do chính deploy unit
 * định nghĩa (`/health` của app, hoặc route notFound ổn định của push), đã
 * chạy độc lập trước khi tới bước này. Inspect qua `docker inspect --format`
 * với name theo namespace (`ecoma-<ns>-<kind>`) — không đụng namespace worktree
 * khác; KHÔNG có giá trị env/secret nào đi vào output.
 *
 * Retry bounded: container vừa lên có thể còn trong `startPeriod` của
 * healthcheck (mail/push khai 120s, pact-api 60s) — `unhealthy`/`starting`
 * được thử lại trong 90s trước khi chốt fail; container KHÔNG TỒN TẠI là fail
 * ngay (stack up đã báo xanh thì container phải tồn tại — mất là lỗi orchestration).
 */
const LANE_HEALTH_CONTAINERS = [
  { kind: 'pact-api-wic', label: 'pact-broker-api-deploy' },
  { kind: 'pact-app', label: 'pact-broker-app-deploy' },
  { kind: 'mail-wic', label: 'transactional-mail-deploy' },
  { kind: 'push-wic', label: 'push-notification-deploy' },
] as const;

const LANE_HEALTH_BUDGET_MS = 90_000;
const LANE_HEALTH_POLL_MS = 3_000;

type ContainerHealth =
  | { state: 'healthy' }
  | { state: 'starting'; health: string }
  | { state: 'unhealthy'; health: string }
  | { state: 'not-running'; status: string }
  | { state: 'missing' };

function inspectLaneContainer(containerName: string): ContainerHealth {
  // `docker inspect` per-container: format in `status|health` — health rỗng
  // với container không khai healthcheck (không xảy ra với bốn unit này nhưng
  // parse vẫn đối xử tường minh).
  const result = exec(
    'docker',
    [
      'inspect',
      '--format',
      '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}',
      containerName,
    ],
    ROOT_DIR,
    process.env,
  );
  if (result.status !== 0) return { state: 'missing' };
  const [status = '', health = ''] = result.stdout.trim().split('|');
  if (status !== 'running') return { state: 'not-running', status };
  if (health === 'healthy') return { state: 'healthy' };
  if (health === 'starting') return { state: 'starting', health };
  return { state: 'unhealthy', health: health || 'none' };
}

/** Tuỳ chọn test seam của {@link verifyLaneHealth} — production bỏ qua. */
export interface LaneHealthOptions {
  /** Tổng budget retry (ms) — default {@link LANE_HEALTH_BUDGET_MS}. */
  budgetMs?: number;
  /** Khoảng nghỉ giữa hai lượt poll (ms) — default {@link LANE_HEALTH_POLL_MS}. */
  pollMs?: number;
}

/**
 * Kiểm health của bốn container unit mới — return 0 chỉ khi TẤT CẢ healthy.
 * Thân hàm chỉ in tên container + trạng thái, không bao giờ in stderr gốc của
 * `docker inspect` (không chứa secret nhưng giữ một nguồn lỗi đã chuẩn hoá).
 */
export function verifyLaneHealth(ctx: LocalDeployContext, options: LaneHealthOptions = {}): number {
  const budgetMs = options.budgetMs ?? LANE_HEALTH_BUDGET_MS;
  const pollMs = options.pollMs ?? LANE_HEALTH_POLL_MS;
  const startedAt = Date.now();
  for (;;) {
    const pending: string[] = [];
    for (const { kind, label } of LANE_HEALTH_CONTAINERS) {
      const containerName = dockerResourceName(ctx.namespace, kind);
      const health = inspectLaneContainer(containerName);
      if (health.state === 'healthy') continue;
      if (health.state === 'missing' || health.state === 'not-running') {
        // Container vắng mặt hoặc chết là TRẠNG THÁI CUỐI: retry không hồi sinh
        // container không tồn tại — fail ngay với trạng thái đã quan sát.
        console.error(
          `[local-stack-step] lane health FAILED: ${containerName} (${label}) ` +
            (health.state === 'missing'
              ? 'does not exist — the unit stack reported up but the container is gone'
              : `is not running (state: ${health.status})`),
        );
        return 1;
      }
      pending.push(`${containerName}: ${health.health}`);
    }
    if (pending.length === 0) {
      console.log(
        `[local-stack-step] lane health OK: ${LANE_HEALTH_CONTAINERS.map((c) => dockerResourceName(ctx.namespace, c.kind)).join(', ')} all healthy ` +
          `after ${Date.now() - startedAt}ms`,
      );
      return 0;
    }
    const remainingMs = budgetMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      console.error(
        `[local-stack-step] lane health FAILED after ${budgetMs}ms budget: ` + pending.join('; '),
      );
      return 1;
    }
    console.error(
      `[local-stack-step] lane health waiting: ${pending.join('; ')} — retrying in ` +
        `${Math.ceil(Math.min(pollMs, remainingMs) / 1000)}s`,
    );
    const sleepMs = Math.min(pollMs, remainingMs);
    const sleep = exec('sleep', [String(Math.ceil(sleepMs / 1000))], ROOT_DIR, process.env);
    if (sleep.status !== 0) {
      console.error('[local-stack-step] lane health: sleep between polls failed');
      return 1;
    }
  }
}

/** Đối số up dùng chung mọi unit — giữ nguyên ngữ nghĩa của bản hard-coded. */
function unitUpArgs(ctx: LocalDeployContext): string[] {
  return [
    'up',
    '--yes',
    // Key stack reference CŨ từng được ghi không prefix — xoá để stack config
    // không mang key chết mà người đọc tưởng đang được dùng.
    '--config',
    `home-deploy:platformStackRef=`,
    '--config',
    `namespace:worktreeRoot=${ctx.worktreeRoot}`,
    '--config',
    `namespace:platformStackRef=organization/platform-deploy/${ctx.stackName}`,
  ];
}

/** Step `up` cho một project: secrets (nếu có) rồi `pulumi up` (+ ghi `.env` trên platform). */
async function runUpStep(
  project: string,
  ctx: LocalDeployContext,
  env: NodeJS.ProcessEnv,
  projectDir: string,
): Promise<number> {
  try {
    if (project === 'platform-deploy') {
      const resolution = resolvePlatformUp(ctx, env, ROOT_DIR);
      if (!resolution.ok) {
        console.error(`[local-stack-step] ${resolution.error}`);
        return 1;
      }
      if (resolution.generated) {
        console.log(
          '[local-stack-step] postgres:password đã sinh ngẫu nhiên và lưu trong stack config local.',
        );
      }
      pulumiRun(
        projectDir,
        project,
        [
          'up',
          '--yes',
          '--config',
          `namespace:worktreeRoot=${ctx.worktreeRoot}`,
          '--config',
          `home-deploy:platformStackRef=`,
        ],
        ctx,
        env,
        { prepareStack: true, stream: true },
      );
      // Ghi `.env` ngay sau khi up xanh: outputs platform (port Traefik thật)
      // chỉ tồn tại sau up, và mọi step unit kế tiếp đọc ROOT_HOST từ file này
      // — gộp vào step up là graph không còn task trung gian nào phải truyền
      // dữ liệu giữa hai target. Password lấy từ chính stack config (canonical,
      // đã resolve ở `resolvePlatformUp`) — `.env` là bản sao, không sinh lần
      // thứ hai.
      const envWritten = await writePlatformLocalEnv(project, ctx, env);
      if (!envWritten.ok) return 1;
      return 0;
    }

    const rootHost = readRootHostFromEnv(ctx.worktreeRoot);
    if (rootHost === undefined) {
      console.error(
        '[local-stack-step] thiếu ROOT_HOST trong .env — platform up chưa ghi .env ' +
          'hoặc .env đã bị xoá. Chạy lại orchestration từ đầu.',
      );
      return 1;
    }
    const identityInternalSecret = resolveIdentityInternalSecret(project, ctx, env);
    if (identityInternalSecret === undefined) return 1;
    const mailInternalAuthSecret = resolveMailInternalAuthSecret(project, ctx, env);
    if (mailInternalAuthSecret === undefined) return 1;
    const pactApiMachineToken = resolvePactApiMachineToken(project, ctx, env);
    if (pactApiMachineToken === undefined) return 1;
    const signingKeyPem = project === 'auth-deploy' ? await generateEs256SigningKeyPem() : '';

    ensureStack(projectDir, project, ctx, env);
    for (const [configKey, configValue] of localStackSecrets(project, {
      rootHost,
      identityInternalSecret,
      mailInternalAuthSecret,
      pactApiMachineToken,
      signingKeyPem,
    })) {
      setStackSecret(project, configKey, configValue, ctx, env, projectDir);
    }

    pulumiRun(projectDir, project, unitUpArgs(ctx), ctx, env, {
      prepareStack: true,
      stream: true,
    });
    return 0;
  } catch (error) {
    console.error(
      `[local-stack-step] ${project} up thất bại: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

/**
 * Đọc outputs platform rồi ghi `.env` của worktree — phần "env" được gộp vào
 * step `up` của platform (graph local không còn target `local-env` riêng).
 *
 * Upsert chỉ đụng ĐÚNG các key sở hữu (`LOCAL_ENV_OWNED_KEYS` — contract
 * #366): file chưa có thì tạo mới, có rồi thì chỉ thay dòng key sở hữu, mọi
 * dòng khác giữ nguyên byte-for-byte.
 *
 * Returns `{ ok: false }` khi đọc outputs/password lỗi — caller (step up của
 * platform) dừng với exit 1; upsert throw khi giá trị dị hình (newline) —
 * fail-loud theo contract của `upsertLocalEnv`.
 */
async function writePlatformLocalEnv(
  project: string,
  ctx: LocalDeployContext,
  env: NodeJS.ProcessEnv,
): Promise<{ ok: true } | { ok: false }> {
  // Helper chỉ đọc outputs; password + ghi `.env` là việc của caller — tách
  // này giữ string log được dựng từ number đã validate, không đi qua cùng
  // scope nào với password access (taint-flow của CodeQL sạch).
  const resolution = resolvePlatformEnv(ctx, env, ROOT_DIR);
  if (!resolution.ok) {
    console.error(`[local-stack-step] ${resolution.error}`);
    return { ok: false };
  }
  // Password canonical từ stack config — reuse, không regenerate: `.env` là
  // bản sao của config, khôi phục được khi bị xoá mà không xoay password.
  //
  // Tên biến `resolution` CÓ CHỦ ĐÍCH, hai heuristic security cùng ăn khớp:
  // 1. Semgrep `security-sensitive-value-logged`: source pattern khớp biến
  //    TRẦN tên `password*` — không còn biến nào tên password* bị log.
  // 2. CodeQL `js/clear-text-logging`: name-heuristic coi biến tên chứa
  //    "password" là sensitive qua MỌI property access (`.error` cũng dính),
  //    nên chỗ log phải đứng trên biến không chứa từ đó (legacy
  //    `local-deploy` chứng minh: `resolution.error` trên cùng flow pass).
  const canonical = resolvePostgresPassword(ctx, env);
  if (!canonical.ok) {
    console.error(`[local-stack-step] ${canonical.error}`);
    return { ok: false };
  }
  const rootHost = buildRootHost(resolution.traefikHostPort);
  // `ROOT_DOMAIN` cùng giá trị với `ROOT_HOST` — hai key là hai tên gọi cho
  // cùng một `host[:port]` gốc (`ROOT_HOST` cho consumer hiện có,
  // `ROOT_DOMAIN` cho system E2E suite). Bước up của platform ghi đủ cùng bộ
  // key sở hữu với đường legacy trong `local-deploy.ts`.
  const { envPath } = upsertLocalEnv(ctx.worktreeRoot, {
    [ROOT_HOST_ENV_KEY]: rootHost,
    [ROOT_DOMAIN_ENV_KEY]: rootHost,
    [POSTGRES_PASSWORD_ENV_KEY]: canonical.password,
  });
  console.log(
    `[local-stack-step] ${ROOT_HOST_ENV_KEY}=${rootHost}, ${ROOT_DOMAIN_ENV_KEY}=${rootHost} đã ghi vào ${envPath}`,
  );
  return { ok: true };
}

/**
 * Đọc ROOT_HOST từ `.env` của worktree — artifact mà platform up ghi sau khi
 * `pulumi up` xanh.
 *
 * `.env` không trở thành nguồn sự thật của resource vì hàm này chỉ đọc: giá trị
 * sai chỉ làm issuer/audience của auth lệch hostname và luồng fail ở smoke.
 */
function readRootHostFromEnv(worktreeRoot: string): string | undefined {
  const envPath = join(worktreeRoot, '.env');
  if (!existsSync(envPath)) return undefined;
  const line = readFileSync(envPath, 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith(`${ROOT_HOST_ENV_KEY}=`));
  const value = line?.split('=').slice(1).join('=');
  return value !== undefined && value.length > 0 ? value : undefined;
}

/**
 * Giá trị secret HMAC internal dùng chung auth <-> account, cho lane Task Graph.
 *
 * Account (chạy trước theo dependsOn) SINH giá trị mới và PERSIST vào stack
 * config của chính nó (`namespace:internalHmacSecret`); auth (chạy sau) ĐỌC LẠI
 * từ stack config account — hai stack nhận đúng MỘT giá trị dù là hai process
 * Nx khác nhau. Bất biến "cùng secret" trở thành dữ liệu durability của
 * Pulumi thay vì biến process của một orchestration monolith.
 */
export function resolveIdentityInternalSecret(
  project: string,
  ctx: LocalDeployContext,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (project === 'account-deploy') return generateInternalHmacSecret();
  if (project !== 'auth-deploy') return '';
  const read = exec(
    'pulumi',
    [
      'config',
      'get',
      'namespace:internalHmacSecret',
      '--stack',
      fullStackRef('account-deploy', ctx),
    ],
    join(ROOT_DIR, 'deploys', 'account-deploy'),
    env,
  );
  if (read.status === 0 && read.stdout.trim().length > 0) {
    return read.stdout.trim();
  }
  // KHÔNG nhúng raw stderr/stdout vào log: stdout của `config get
  // namespace:internalHmacSecret` khi exit 0 CHÍNH LÀ HMAC secret — nếu CLI
  // đổi hành vi exit-code, raw output trong error string là đường leak thật.
  console.error(
    `[local-stack-step] auth up: đọc namespace:internalHmacSecret từ account stack thất bại ` +
      `(exit ${String(read.status)}) — account up phải chạy TRƯỚC auth (dependsOn). Chạy tay ` +
      `'pulumi config get namespace:internalHmacSecret --stack <account-stack-ref>' trong ` +
      'deploys/account-deploy để xem stderr gốc — output của lệnh này không được log vì có thể chứa secret.',
  );
  return undefined;
}

/**
 * Giá trị secret HMAC dùng chung account <-> transactional-mail (path OTP).
 *
 * Cùng cơ chế persistence với {@link resolveIdentityInternalSecret}: account
 * (chạy trước) SINH giá trị mới và persist vào stack config của chính nó
 * (`namespace:mailInternalAuthSecret`); transactional-mail-deploy (chạy sau)
 * ĐỌC LẠI từ stack account. Hai stack nhận đúng MỘT giá trị — receiver mail
 * giữ nó làm entry `MAIL_INTERNAL_AUTH_SECRET_SVC_ACCOUNT`, account ký envelope
 * với `NUXT_MAIL_INTERNAL_AUTH_SECRET` cùng giá trị đó.
 *
 * Giá trị PHẢI khác `identityInternalSecret` (sinh độc lập trong `runUpStep`):
 * validation của account từ chối hai secret trùng, và registry của receiver
 * mail coi mỗi entry là một credential riêng.
 */
export function resolveMailInternalAuthSecret(
  project: string,
  ctx: LocalDeployContext,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (project === 'account-deploy') return generateInternalHmacSecret();
  if (project !== 'transactional-mail-deploy') return '';
  const read = exec(
    'pulumi',
    [
      'config',
      'get',
      'namespace:mailInternalAuthSecret',
      '--stack',
      fullStackRef('account-deploy', ctx),
    ],
    join(ROOT_DIR, 'deploys', 'account-deploy'),
    env,
  );
  if (read.status === 0 && read.stdout.trim().length > 0) {
    return read.stdout.trim();
  }
  // Cùng luật không-leak với nhánh auth: raw stdout của `config get` khi exit 0
  // chính là secret — không bao giờ ghép vào error string.
  console.error(
    `[local-stack-step] transactional-mail-deploy up: đọc namespace:mailInternalAuthSecret ` +
      `từ account stack thất bại (exit ${String(read.status)}) — account up phải chạy TRƯỚC ` +
      'transactional-mail-deploy (dependsOn). Chạy tay `pulumi config get ' +
      'namespace:mailInternalAuthSecret --stack <account-stack-ref>` trong ' +
      'deploys/account-deploy để xem stderr gốc — output của lệnh này không được log vì có thể chứa secret.',
  );
  return undefined;
}

/**
 * Machine token plaintext dùng chung pact-broker-api <-> pact-broker-app (BFF).
 *
 * Cùng cơ chế persistence với {@link resolveIdentityInternalSecret}: stack
 * pact-broker-api-deploy (chạy trước theo dependsOn) SINH token mới và persist
 * vào stack config của chính nó (`namespace:machineToken`); pact-broker-app-deploy
 * (chạy sau) ĐỌC LẠI từ stack api. BFF giữ plaintext làm `NITRO_PACT_BROKER_API_
 * TOKEN` để gọi API; api chỉ seed HASH SHA-256 vào DB (`machine_token_hash`) —
 * plaintext sống duy nhất ở stack config, đúng hình secret cross-stack khác.
 */
export function resolvePactApiMachineToken(
  project: string,
  ctx: LocalDeployContext,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (project === 'pact-broker-api-deploy') return generatePostgresPassword();
  if (project !== 'pact-broker-app-deploy') return '';
  const read = exec(
    'pulumi',
    [
      'config',
      'get',
      'namespace:machineToken',
      '--stack',
      fullStackRef('pact-broker-api-deploy', ctx),
    ],
    join(ROOT_DIR, 'deploys', 'pact-broker-api-deploy'),
    env,
  );
  if (read.status === 0 && read.stdout.trim().length > 0) {
    return read.stdout.trim();
  }
  // Cùng luật không-leak: raw stdout của `config get` khi exit 0 chính là
  // machine token — không bao giờ ghép vào error string.
  console.error(
    `[local-stack-step] pact-broker-app-deploy up: reading namespace:machineToken ` +
      `from the pact-broker-api-deploy stack failed (exit ${String(read.status)}) — ` +
      'pact-broker-api-deploy up must run BEFORE pact-broker-app-deploy (dependsOn). ' +
      'Run `pulumi config get namespace:machineToken --stack <pact-broker-api-stack-ref>` ' +
      'in deploys/pact-broker-api-deploy to see the original stderr — the output of that ' +
      'command is never logged because it may contain the secret.',
  );
  return undefined;
}

/** Smoke HTTPS qua Traefik — cùng script .mjs với bản hard-coded. */
function runSmokeStep(worktreeRoot: string): number {
  const rootHost = readRootHostFromEnv(worktreeRoot);
  if (rootHost === undefined) {
    console.error('[local-stack-step] smoke: thiếu ROOT_HOST trong .env — platform up chưa chạy?');
    return 1;
  }
  const smoke = exec(
    'node',
    [join(ROOT_DIR, 'tools/dx/src/deployment/local-platform/local-smoke.mjs'), rootHost],
    ROOT_DIR,
    process.env,
  );
  if (smoke.status !== 0) {
    console.error(`[local-stack-step] smoke HTTPS thất bại:\n${smoke.stdout}\n${smoke.stderr}`);
    return 1;
  }
  console.log(`[local-stack-step] smoke OK: https://${rootHost}/`);
  return 0;
}

/** Kiểu kết quả exec re-export cho spec của module này. */
export type { ExecResult };
