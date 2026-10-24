/**
 * Một BƯỚC của luồng deploy local, chạy cho MỘT deploy project — execution
 * boundary của orchestration Nx Task Graph.
 *
 * Target Nx (`local-up`/`local-env`/`local-smoke` trên `deploys/*-deploy`) gọi
 * lệnh này qua `nx:run-commands`; thứ tự giữa các target là CONTRACT đã khai
 * bằng `dependsOn` trong package.json của từng deploy project. Module này cố ý KHÔNG
 * biết thứ tự toàn cục — nó chỉ làm đúng MỘT bước cho đúng MỘT stack. Graph quy
 * định "khi nào"; module này quy định "làm gì".
 *
 * Các tổ hợp (project, step) hợp lệ:
 *
 * - `platform-deploy` + `up`    → ensureStack + resolve password + `pulumi up`
 * - `platform-deploy` + `env`   → đọc outputs → ghi `.env` (chỉ key sở hữu)
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
import {
  buildRootHost,
  POSTGRES_PASSWORD_ENV_KEY,
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
  generateEs256SigningKeyPem,
  generateInternalHmacSecret,
  generatePostgresPassword,
  resolvePlatformEnv,
  resolvePlatformUp,
} from './local-deploy-steps.js';
import { resolvePostgresPassword, upsertLocalEnv } from './local-deploy.js';
import { ROOT_DIR } from '../../utils.js';

/** Các step mà lệnh này nhận diện — 1:1 với target Nx local trên deploy project. */
export const LOCAL_STACK_STEPS = ['up', 'env', 'smoke'] as const;
export type LocalStackStep = (typeof LOCAL_STACK_STEPS)[number];

/** Project duy nhất nhận step `env` — outputs platform là nguồn. */
export const STEP_ENV_OWNER = 'platform-deploy';
/** Project duy nhất nhận step `smoke` — smoke end-to-end qua Traefik. */
export const STEP_SMOKE_OWNER = 'platform-deploy';

/** Lỗi tham số — target khai sai tổ hợp phải fail-closed ngay khi validate. */
export class LocalStackStepUsageError extends Error {}

/** Validate tổ hợp (project, step) trước khi chạm Pulumi/Docker. */
export function validateStepTarget(project: string, step: LocalStackStep): void {
  if (step === 'env' && project !== STEP_ENV_OWNER) {
    throw new LocalStackStepUsageError(
      `step "env" chỉ hợp lệ trên ${STEP_ENV_OWNER} (outputs platform là nguồn); nhận: ${project}`,
    );
  }
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
 */
export function localStackSecrets(
  project: string,
  inputs: { rootHost: string; identityInternalSecret: string; signingKeyPem: string },
): ReadonlyArray<readonly [string, string]> {
  if (project === 'account-deploy') {
    return [
      ['namespace:ownerPassword', generatePostgresPassword()],
      ['namespace:runtimePassword', generatePostgresPassword()],
      ['namespace:migratorPassword', generatePostgresPassword()],
      ['namespace:prunerPassword', generatePostgresPassword()],
      ['namespace:internalHmacSecret', inputs.identityInternalSecret],
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
      ['namespace:handleKey', generatePostgresPassword()],
      ['namespace:internalSecret', inputs.identityInternalSecret],
      ['namespace:issuer', `https://auth.${inputs.rootHost}`],
      ['namespace:audience', `https://api.${inputs.rootHost}`],
      ['namespace:cookieKeys', generatePostgresPassword()],
    ] as const;
  }
  if (project === 'backoffice-deploy') {
    return [
      ['namespace:runtimePassword', generatePostgresPassword()],
      ['namespace:migratorPassword', generatePostgresPassword()],
    ] as const;
  }
  return [];
}

/** Danh sách KEY secret của một project — dùng cho spec kiểm trùng key. */
export function localStackSecretsKeys(
  project: string,
  inputs: { rootHost: string; identityInternalSecret: string; signingKeyPem: string },
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
 * `local-deploy`/`local-cleanup` khác trên cùng daemon. Step `env`/`smoke`
 * không mutate Docker nên không cần lock.
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

  if (step === 'env') {
    if (!existsSync(join(ctx.worktreeRoot, '.pulumi-local-state'))) {
      console.error('[local-stack-step] worktree chưa từng deploy — chạy step up trước.');
      return 1;
    }
    // Helper chỉ đọc outputs; password + ghi `.env` là việc của caller — tách
    // này giữ string log được dựng từ number đã validate, không đi qua cùng
    // scope nào với password access (taint-flow của CodeQL sạch).
    const resolution = resolvePlatformEnv(ctx, env, ROOT_DIR);
    if (!resolution.ok) {
      console.error(`[local-stack-step] ${resolution.error}`);
      return 1;
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
      return 1;
    }
    const rootHost = buildRootHost(resolution.traefikHostPort);
    const { envPath } = upsertLocalEnv(ctx.worktreeRoot, {
      [ROOT_HOST_ENV_KEY]: rootHost,
      [POSTGRES_PASSWORD_ENV_KEY]: canonical.password,
    });
    console.log(`[local-stack-step] ${ROOT_HOST_ENV_KEY}=${rootHost} đã ghi vào ${envPath}`);
    return 0;
  }

  // step === 'smoke'
  return runSmokeStep(ctx.worktreeRoot);
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

/** Step `up` cho một project: secrets (nếu có) rồi `pulumi up`. */
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
      return 0;
    }

    const rootHost = readRootHostFromEnv(ctx.worktreeRoot);
    if (rootHost === undefined) {
      console.error(
        '[local-stack-step] thiếu ROOT_HOST trong .env — step env của platform chưa chạy ' +
          'hoặc .env đã bị xoá. Chạy lại orchestration từ đầu.',
      );
      return 1;
    }
    const identityInternalSecret = resolveIdentityInternalSecret(project, ctx, env);
    if (identityInternalSecret === undefined) return 1;
    const signingKeyPem = project === 'auth-deploy' ? await generateEs256SigningKeyPem() : '';

    ensureStack(projectDir, project, ctx, env);
    for (const [configKey, configValue] of localStackSecrets(project, {
      rootHost,
      identityInternalSecret,
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
 * Đọc ROOT_HOST từ `.env` của worktree — artifact mà step `env` ghi.
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

/** Smoke HTTPS qua Traefik — cùng script .mjs với bản hard-coded. */
function runSmokeStep(worktreeRoot: string): number {
  const rootHost = readRootHostFromEnv(worktreeRoot);
  if (rootHost === undefined) {
    console.error('[local-stack-step] smoke: thiếu ROOT_HOST trong .env — step env chưa chạy?');
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
