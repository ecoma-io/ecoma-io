/**
 * Orchestration local deployment — toàn bộ luồng end-to-end của một worktree.
 *
 * Thứ tự là CONTRACT (không phải chi tiết cài đặt):
 *
 *   platform up → đọc outputs → cập nhật .env → home up → smoke HTTPS.
 *
 * Mỗi bước chỉ chạy khi bước trước thành công; `.env` KHÔNG BAO GIỜ là nguồn
 * sự thật — nó là artifact tiện dụng được ghi từ Pulumi outputs. Không bước
 * nào đọc `.env` để quyết định resource; chương trình Pulumi nhận namespace
 * qua config, không qua file sinh ra.
 *
 * Preview và apply là hai thao tác phân biệt: command này là đường apply thật
 * (thay đổi Docker resource thật của máy developer), được gọi tường minh;
 * đường an toàn/dry-run của Nx/CI vẫn là target `provision` (provision-gate).
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  dockerResourceName,
  normalizeWorktreeRoot,
  pulumiStackName,
  worktreeNamespace,
} from './deploy-namespace.js';
import {
  buildRootHost,
  LOCAL_ENV_OWNED_KEYS,
  ROOT_HOST_ENV_KEY,
} from './platform-outputs-contract.js';
import { ROOT_DIR } from './utils.js';

/** Kết quả một bước exec shell — fail-closed: caller phải kiểm `status`. */
interface ExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function exec(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): ExecResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Vị trí backend `file://` cho state Pulumi local — ngoài Git, theo worktree. */
function localStateDir(worktreeRoot: string): string {
  return join(worktreeRoot, '.pulumi-local-state');
}

/**
 * Context chạy của một worktree: mọi lệnh Pulumi đều suy từ ba giá trị này.
 * Giữ một chỗ để platform và home dùng ĐÚNG cùng một backend và stack — lệch
 * một chữ là hai stack khác nhau và isolation vỡ.
 */
export interface LocalDeployContext {
  worktreeRoot: string;
  namespace: string;
  stackName: string;
  stateUrl: string;
}

export function resolveContext(worktreeRootInput?: string): LocalDeployContext {
  const worktreeRoot = normalizeWorktreeRoot(worktreeRootInput ?? ROOT_DIR);
  const namespace = worktreeNamespace(worktreeRoot);
  return {
    worktreeRoot,
    namespace,
    stackName: pulumiStackName(namespace),
    stateUrl: `file://${localStateDir(worktreeRoot)}`,
  };
}

/** Env dùng chung cho mọi lệnh Pulumi trong luồng này. */
function pulumiEnv(): NodeJS.ProcessEnv {
  // Passphrase cục bộ của state local: state này chỉ chứa resource Docker của
  // máy developer, không phải state staging/production. Nó KHÔNG phải secret
  // của môi trường thật và không bao giờ rời khỏi worktree. `PULUMI_SKIP_UPDATE_CHECK`
  // bỏ một round-trip mạng không cần thiết khỏi mỗi lệnh.
  return {
    ...process.env,
    PULUMI_CONFIG_PASSPHRASE: process.env.PULUMI_CONFIG_PASSPHRASE ?? 'ecoma-local-only',
    PULUMI_SKIP_UPDATE_CHECK: '1',
  };
}

/**
 * Stack Pulumi phải tồn tại trước khi `up`/`preview`/`output` chạy được: trên
 * state backend `file://` mới, `--stack local-<ns>` chưa trỏ tới stack nào và
 * Pulumi fail với "no stack named". Idempotent — `stack init` trên stack có sẵn
 * là lỗi và bị bỏ qua; hỏi backend bằng `stack select` thì tốn thêm một lần
 * exec cho mỗi lệnh nên dùng đường "init-then-ignore".
 */
function ensureStack(projectDir: string, ctx: LocalDeployContext): void {
  mkdirSync(localStateDir(ctx.worktreeRoot), { recursive: true });
  const login = exec('pulumi', ['login', ctx.stateUrl], projectDir, pulumiEnv());
  if (login.status !== 0) {
    throw new Error(`pulumi login ${ctx.stateUrl} thất bại:\n${login.stderr}`);
  }
  const init = exec('pulumi', ['stack', 'init', ctx.stackName], projectDir, pulumiEnv());
  // Exit 0: vừa tạo mới. Exit != 0: stack đã tồn tại (hoặc lỗi thật) — phân biệt
  // bằng `stack select`': select thành công nghĩa là stack có thật và init lỗi
  // chỉ là "đã có sẵn".
  if (init.status !== 0) {
    const select = exec('pulumi', ['stack', 'select', ctx.stackName], projectDir, pulumiEnv());
    if (select.status !== 0) {
      throw new Error(
        `pulumi stack init/select ${ctx.stackName} thất bại:\n${init.stderr}\n${select.stderr}`,
      );
    }
  }
}

/** Chạy một lệnh Pulumi trong một deploy project; fail → throw kèm stderr. */
function pulumiRun(projectDir: string, args: string[], ctx: LocalDeployContext): string {
  const env = pulumiEnv();
  // `--stack` mọi lệnh + chọn backend qua `pulumi login file://` — hai project
  // trong cùng worktree dùng đúng một state location.
  const fullArgs = ['--stack', ctx.stackName, ...args];
  ensureStack(projectDir, ctx);
  const run = exec('pulumi', fullArgs, projectDir, env);
  if (run.status !== 0) {
    throw new Error(`pulumi ${fullArgs.join(' ')} thất bại:\n${run.stderr || run.stdout}`);
  }
  return run.stdout;
}

/**
 * Ghi `ROOT_HOST` vào `.env` của worktree mà KHÔNG đụng key khác.
 *
 * `.env` là artifact: nếu file không có thì tạo mới với đúng một key; nếu có
 * rồi thì chỉ thay dòng `ROOT_HOST=...`, mọi dòng khác giữ nguyên byte-for-byte.
 * Trả về giá trị đã ghi để bước smoke test và phần báo cáo dùng lại.
 */
export function upsertLocalEnv(worktreeRoot: string, rootHost: string): { envPath: string } {
  const envPath = join(worktreeRoot, '.env');
  const line = `${ROOT_HOST_ENV_KEY}=${rootHost}`;
  if (!existsSync(envPath)) {
    writeFileSync(envPath, `${line}\n`, 'utf8');
    return { envPath };
  }
  const content = readFileSync(envPath, 'utf8');
  const lines = content.split('\n');
  let replaced = false;
  const next = lines.map((entry) => {
    if (entry.startsWith(`${ROOT_HOST_ENV_KEY}=`)) {
      replaced = true;
      return line;
    }
    return entry;
  });
  if (!replaced) next.push(line);
  writeFileSync(envPath, next.join('\n'), 'utf8');
  return { envPath };
}

/** Đọc outputs của platform stack sau khi `up` — fail-closed khi thiếu key. */
export function readPlatformOutputs(
  projectDir: string,
  ctx: LocalDeployContext,
): {
  traefikHostPort: number;
  rootHost: string;
} {
  const stdout = pulumiRun(projectDir, ['stack', 'output', '--json'], ctx);
  let outputs: Record<string, unknown>;
  try {
    outputs = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new Error(`Outputs của platform stack không parse được JSON:\n${stdout}`);
  }
  const rawPort = outputs['traefikHostPort'];
  // Port đo được là số nguyên dương — một giá trị `undefined`/`0`/string lọt
  // qua đây sẽ sinh `fbi.com:NaN` ở smoke test, nên chặn tại nguồn.
  if (typeof rawPort !== 'number' || !Number.isInteger(rawPort) || rawPort <= 0) {
    throw new Error(
      `Output traefikHostPort không hợp lệ: ${JSON.stringify(rawPort)} — platform chưa up đầy đủ?`,
    );
  }
  return { traefikHostPort: rawPort, rootHost: buildRootHost(rawPort) };
}

/** Các bước của luồng deploy — export cho spec test thứ tự mà không cần Docker. */
export const DEPLOY_STEPS = [
  'platform-up',
  'read-outputs',
  'update-env',
  'home-up',
  'smoke-https',
] as const;
export type DeployStep = (typeof DEPLOY_STEPS)[number];

/** Hình dạng tùy chọn của luồng deploy local. */
export interface LocalDeployOptions {
  worktreeRoot?: string;
  /** Chỉ preview — không up, không ghi .env. Mặc định false (apply thật). */
  previewOnly?: boolean;
  /** Bỏ qua smoke HTTPS ở cuối (dùng khi caller tự kiểm). */
  skipSmoke?: boolean;
}

/**
 * Luồng đầy đủ: platform → outputs → .env → home → smoke.
 *
 * Cả hai project được truyền `namespace:worktreeRoot` qua `--config` tại lúc
 * chạy — chương trình Pulumi không đọc `.env` do chính luồng này sinh ra
 * (không dependency cycle).
 */
export function localDeploy(options: LocalDeployOptions = {}): number {
  const ctx = resolveContext(options.worktreeRoot);
  const platformDir = join(ROOT_DIR, 'deploys/platform-deploy');
  const homeDir = join(ROOT_DIR, 'deploys/home-deploy');
  const configArgs = [
    '--config',
    `namespace:worktreeRoot=${ctx.worktreeRoot}`,
    // Key stack reference CŨ từng được ghi không prefix (`home-deploy:...`,
    // bag theo project) do một phiên bản trước của luồng này — xoá để stack
    // config không mang key chết mà người đọc tưởng đang được dùng.
    '--config',
    `home-deploy:platformStackRef=`,
  ];

  console.log(`[local-deploy] worktree=${ctx.worktreeRoot} namespace=${ctx.namespace}`);

  // 1. Platform up (hoặc preview). Lỗi Pulumi (không login được backend, preview
  //    fail) dừng toàn luồng — .env chỉ được ghi sau khi outputs thật tồn tại.
  //    Secret `postgres:password` được sinh ngẫu nhiên MỘT LẦM duy nhất trên
  //    stack mới, rồi đọc lại từ backend ở mọi lần chạy sau — regen mỗi lần chạy
  //    sẽ khiến container Postgres rebuild không lý do.
  console.log('[local-deploy] platform up/preview…');
  try {
    ensureStack(platformDir, ctx);
    // Secret sinh ngẫu nhiên MỘT LẦM duy nhất trên stack mới, rồi đọc lại từ
    // backend ở mọi lần chạy sau — regen mỗi lần chạy sẽ khiến container
    // Postgres rebuild không lý do.
    //
    // Bước này chạy CẢ khi `--preview`: preview vẫn phải evaluate chương trình,
    // và `requireSecret` fail ngay trên stack chưa có key — preview "an toàn"
    // mà đỏ trên worktree hoàn toàn mới là preview vô dụng. Đặt secret không
    // apply gì cả: nó chỉ ghi config của stack, chưa đụng Docker.
    const secret = exec(
      'pulumi',
      ['config', 'get', 'postgres:password', '--stack', ctx.stackName, '--secret'],
      platformDir,
      pulumiEnv(),
    );
    if (secret.status !== 0 || secret.stdout.trim().length === 0) {
      const pw = randomBytes(24).toString('base64url');
      const setSecret = exec(
        'pulumi',
        ['config', 'set', 'postgres:password', pw, '--stack', ctx.stackName, '--secret'],
        platformDir,
        pulumiEnv(),
      );
      if (setSecret.status !== 0) {
        throw new Error(`pulumi config set postgres:password thất bại:\n${setSecret.stderr}`);
      }
      console.log(
        '[local-deploy] postgres:password đã sinh ngẫu nhiên và lưu dạng secret trong state local.',
      );
    }
    const platformAction = options.previewOnly === true ? 'preview' : 'up';
    const platformArgs =
      platformAction === 'preview' ? ['preview', ...configArgs] : ['up', '--yes', ...configArgs];
    pulumiRun(platformDir, platformArgs, ctx);
  } catch (error) {
    console.error(`[local-deploy] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (options.previewOnly === true) {
    console.log('[local-deploy] preview xong — không apply gì.');
    return 0;
  }

  // 2. Đọc outputs thực tế (port do Docker cấp chỉ tồn tại sau up).
  console.log('[local-deploy] đọc outputs platform…');
  const { rootHost } = readPlatformOutputs(platformDir, ctx);

  // 3. Cập nhật .env (chỉ key thuộc workflow).
  const { envPath } = upsertLocalEnv(ctx.worktreeRoot, rootHost);
  console.log(`[local-deploy] ${ROOT_HOST_ENV_KEY}=${rootHost} đã ghi vào ${envPath}`);

  // 4. Home up — image build + container + routing labels.
  console.log('[local-deploy] home up…');
  pulumiRun(
    homeDir,
    [
      'up',
      '--yes',
      ...configArgs,
      // Stack reference format đã kiểm chứng THỰC NGHIỆM trên SDK 3.270 + backend
      // `file://`: `organization/<project>/<stack>`. Org segment phải là literal
      // `organization` (backend `file://` hiện tại của Pulumi chỉ chấp nhận org
      // này — bất kỳ tên nào khác fail "organization name must be 'organization'");
      // backend nào được consult là backend đã `pulumi login` trong bước
      // `ensureStack`, không phải chuỗi URL trong ref. Format kiểu
      // `file://<stateDir>/<project>/<stack>` hoạt động trên SDK cũ (≤ 3.268)
      // nhưng SDK 3.270 từ chối với "a stack name may not be empty". Sai format
      // làm StackReference không resolve và `getOutput` trả rỗng/failed — home
      // không thể deploy.
      //
      // Prefix `namespace:` là BẮT BUỘC khớp cách `home-deploy` đọc
      // (`new pulumi.Config('namespace')`): cờ `--config` không prefix thì
      // Pulumi ghi vào bag theo project (`home-deploy:...`) — lệch bag là
      // "Missing required configuration variable 'namespace:platformStackRef'"
      // trên worktree mới, dù lệnh chạy có vẻ thành công.
      '--config',
      `namespace:platformStackRef=organization/platform-deploy/${ctx.stackName}`,
    ],
    ctx,
  );

  // 5. Smoke HTTPS qua Traefik với certificate local.
  if (options.skipSmoke !== true) {
    const smoke = exec(
      'node',
      [join(ROOT_DIR, 'tools/dx/src/local-smoke.mjs'), rootHost],
      ROOT_DIR,
    );
    if (smoke.status !== 0) {
      console.error(`[local-deploy] smoke HTTPS thất bại:\n${smoke.stdout}\n${smoke.stderr}`);
      return 1;
    }
    console.log(`[local-deploy] smoke OK: https://${rootHost}/`);
  }

  console.log(
    `[local-deploy] hoàn tất — truy cập https://${rootHost}/ ` +
      `(certificate local cần được trust thủ công trên máy developer).`,
  );
  return 0;
}

/**
 * Teardown có kiểm soát.
 *
 * Mặc định GIỮ PostgreSQL volume (dữ liệu persistent của developer). Chỉ khi
 * caller truyền `--remove-data` tường minh thì destroy mới được phép xoá cả volume
 * — và kể cả lúc đó lệnh in cảnh báo trước rồi mới chạy. Không đường nào xóa
 * volume âm thầm.
 *
 * Destroy KHÔNG dùng `--remove`: xoá stack sẽ xoá cả CONFIG — trong đó có secret
 * `postgres:password` — trong khi volume (với superuser được khởi tạo bằng mật
 * khẩu CŨ) vẫn được giữ lại. Deploy kế tiếp trên stack mới sẽ sinh mật khẩu mới
 * không bao giờ khớp volume cũ, và Postgres fail init lặp vô hạn. Giữ stack
 * (chỉ rỗng resource) là cách hai nửa — secret trong config, dữ liệu trong
 * volume — luôn cùng tuổi.
 */
export function localDestroy(options: { worktreeRoot?: string; removeData?: boolean }): number {
  const ctx = resolveContext(options.worktreeRoot);
  const platformDir = join(ROOT_DIR, 'deploys/platform-deploy');
  const homeDir = join(ROOT_DIR, 'deploys/home-deploy');
  const volumeName = dockerResourceName(ctx.namespace, 'postgres-volume');

  console.log('[local-deploy] home destroy…');
  pulumiRun(
    homeDir,
    ['destroy', '--yes', '--config', `namespace:worktreeRoot=${ctx.worktreeRoot}`],
    ctx,
  );

  console.log('[local-deploy] platform destroy…');
  pulumiRun(
    platformDir,
    ['destroy', '--yes', '--config', `namespace:worktreeRoot=${ctx.worktreeRoot}`],
    ctx,
  );

  if (options.removeData === true) {
    console.warn(
      `[local-deploy] CẢNH BÁO: xoá volume PostgreSQL ${volumeName} — dữ liệu database ` +
        `local của worktree này bị mất vĩnh viễn.`,
    );
    const vol = exec('docker', ['volume', 'rm', volumeName], ROOT_DIR);
    if (vol.status !== 0) {
      console.error(`[local-deploy] xoá volume thất bại (có thể đã bị xoá):\n${vol.stderr}`);
      return 1;
    }
    console.log(`[local-deploy] volume ${volumeName} đã xoá.`);
  } else {
    console.log(
      `[local-deploy] volume PostgreSQL ${volumeName} được GIỮ (dữ liệu còn nguyên). ` +
        `Muốn xoá: chạy lại với --remove-data.`,
    );
  }
  return 0;
}

/** In trạng thái hiện tại: namespace, stack, và outputs platform nếu có. */
export function localStatus(options: { worktreeRoot?: string }): number {
  const ctx = resolveContext(options.worktreeRoot);
  console.log(`namespace:      ${ctx.namespace}`);
  console.log(`stack:          ${ctx.stackName}`);
  console.log(`state backend:  ${ctx.stateUrl}`);
  console.log(`network:        ${dockerResourceName(ctx.namespace, 'network')}`);
  console.log(`traefik:        ${dockerResourceName(ctx.namespace, 'traefik')}`);
  console.log(`postgres:       ${dockerResourceName(ctx.namespace, 'postgres')}`);
  console.log(`volume:         ${dockerResourceName(ctx.namespace, 'postgres-volume')}`);
  console.log(`home:           ${dockerResourceName(ctx.namespace, 'home')}`);

  const envPath = join(ctx.worktreeRoot, '.env');
  if (existsSync(envPath)) {
    const line = readFileSync(envPath, 'utf8')
      .split('\n')
      .find((entry) => entry.startsWith(`${ROOT_HOST_ENV_KEY}=`));
    if (line !== undefined) console.log(`.env ${ROOT_HOST_ENV_KEY}:  ${line.split('=')[1]}`);
  }

  const platformDir = join(ROOT_DIR, 'deploys/platform-deploy');
  const outputs = exec(
    'pulumi',
    ['stack', 'output', '--json', '--stack', ctx.stackName],
    platformDir,
    pulumiEnv(),
  );
  if (outputs.status === 0 && outputs.stdout.trim().length > 0) {
    console.log(`platform outputs: ${outputs.stdout.trim()}`);
  } else {
    console.log('platform outputs: (chưa có — chạy pnpm dx local-deploy trước)');
  }
  return 0;
}

/** Keys mà luồng này sở hữu — export để test và để review chặn đè key lạ. */
export const OWNED_ENV_KEYS: readonly string[] = LOCAL_ENV_OWNED_KEYS;
