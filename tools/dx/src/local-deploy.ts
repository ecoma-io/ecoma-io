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
 * Preview và apply là hai thao tác phân biệt: command này mặc định là đường
 * apply thật (thay đổi Docker resource thật của máy developer), được gọi tường
 * minh; `--preview` là đường read-only — không init state, không `config set`,
 * không sinh secret, không ghi `.env`, chỉ chạy được trên worktree đã apply ít
 * nhất một lần (prerequisite kiểm read-only, thiếu thì báo cách khắc phục).
 * Đường an toàn/dry-run của Nx/CI vẫn là target `provision` (provision-gate).
 *
 * Mọi lệnh Pulumi chạy qua context cô lập của `pulumi-context.ts`:
 * `PULUMI_BACKEND_URL` theo worktree + `--stack organization/<project>/<stack>`
 * tường minh — không `pulumi login`, không selected-stack toàn cục, hai worktree
 * deploy song song không đụng CLI state của nhau (kiểm thực nghiệm — docs
 * `04-platform-facts.md` §2.16 PU12–PU13).
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { dockerResourceName } from './deploy-namespace.js';
import {
  buildRootHost,
  LOCAL_ENV_OWNED_KEYS,
  ROOT_HOST_ENV_KEY,
} from './platform-outputs-contract.js';
import {
  exec,
  describeSpawnFailure,
  ensureStack,
  fullStackRef,
  localStateDir,
  pulumiEnv,
  pulumiRun,
  requirePassphrase,
  resolveContext,
  type ExecResult,
  type LocalDeployContext,
} from './pulumi-context.js';
import { ROOT_DIR } from './utils.js';

/**
 * "Chưa có key" của `pulumi config get` — CHỈ khi CLI báo đúng vậy.
 *
 * Exit != 0 không phân biệt được: sai passphrase (không giải được secret),
 * state lock, backend hỏng... đều exit != 0. Regen secret trên các lỗi đó sẽ
 * ĐÈ mật khẩu đang tồn tại trong state (`config set` chỉ cần salt để mã hoá
 * giá trị mới là thành công trên DIY backend) → container Postgres bị khoá
 * khỏi volume đã init bằng mật khẩu cũ. Export để spec phủ trực tiếp.
 */
export function isConfigKeyMissing(result: ExecResult): boolean {
  const output = `${result.stdout}\n${result.stderr}`;
  return /no value for the key|configuration key .* not found/iu.test(output);
}

/** Tên Nx project của hai deploy unit — dùng cho stack ref đầy đủ và exec cwd. */
const PLATFORM_PROJECT = 'platform-deploy';
const HOME_PROJECT = 'home-deploy';

function projectDir(project: string): string {
  return join(ROOT_DIR, 'deploys', project);
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

/**
 * Đọc outputs của platform stack sau khi `up` — fail-closed khi thiếu key.
 */
export function readPlatformOutputs(
  platformDir: string,
  ctx: LocalDeployContext,
  env: NodeJS.ProcessEnv,
): {
  traefikHostPort: number;
  rootHost: string;
} {
  const stdout = pulumiRun(platformDir, PLATFORM_PROJECT, ['stack', 'output', '--json'], ctx, env, {
    prepareStack: false,
  });
  // Không truyền `stream` nên trả về chuỗi — chỉ `up`/`preview` mới stream.
  let outputs: Record<string, unknown>;
  try {
    outputs = JSON.parse(stdout ?? '') as Record<string, unknown>;
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
  /**
   * Chỉ preview — read-only tuyệt đối: không init state, không `config set`,
   * không sinh secret, không truyền `--config` (CLI lưu `--config` vào stack
   * config file kể cả ở `preview`), không ghi `.env`, không `up`/`destroy`.
   * Yêu cầu worktree đã apply ít nhất một lần. Mặc định false (apply thật).
   */
  previewOnly?: boolean;
  /** Bỏ qua smoke HTTPS ở cuối (dùng khi caller tự kiểm). */
  skipSmoke?: boolean;
}

/** Chạy pulumi cho MỘT project trong luồng local; lỗi → in stderr rồi return 1. */
function runProjectStep(
  label: string,
  project: string,
  args: string[],
  ctx: LocalDeployContext,
  env: NodeJS.ProcessEnv,
  options: { prepareStack?: boolean; stream?: boolean } = {},
): boolean {
  try {
    pulumiRun(projectDir(project), project, args, ctx, env, options);
    return true;
  } catch (error) {
    console.error(
      `[local-deploy] ${label} thất bại: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
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

  console.log(`[local-deploy] worktree=${ctx.worktreeRoot} namespace=${ctx.namespace}`);

  // Passphrase bắt buộc — fail TRƯỚC khi chạm Pulumi hay Docker nào. Thiếu
  // passphrase mà để CLI tự fail giữa chừng là mutation dở dang vô ích. Áp dụng
  // cho CẢ preview: `preview` nạp stack config (PU4) nên cũng cần passphrase.
  const pass = requirePassphrase();
  if ('error' in pass) {
    console.error(`[local-deploy] ${pass.error}`);
    return 1;
  }
  const env = pulumiEnv(ctx, pass.passphrase);

  // Preview là nhánh READ-ONLY riêng — tách khỏi đường apply ngay từ đây để
  // không đường nào trong apply (ensureStack, config set, up) chạy nhầm khi
  // người dùng chỉ muốn preview, và ngược lại.
  if (options.previewOnly === true) {
    return runPreview(ctx, env);
  }

  const sharedConfigArgs = [
    '--config',
    `namespace:worktreeRoot=${ctx.worktreeRoot}`,
    // Key stack reference CŨ từng được ghi không prefix (`home-deploy:...`,
    // bag theo project) do một phiên bản trước của luồng này — xoá để stack
    // config không mang key chết mà người đọc tưởng đang được dùng.
    '--config',
    `home-deploy:platformStackRef=`,
  ];

  // 1. Platform up. Lỗi Pulumi (không login được backend) dừng toàn luồng —
  //    .env chỉ được ghi sau khi outputs thật tồn tại.
  console.log('[local-deploy] platform up…');
  try {
    // Chuẩn bị stack TRƯỚC khi `config set` ghi vào nó: `mkdir` state dir +
    // `stack init` (stack đã tồn tại thì init fail, rơi về `stack select` —
    // idempotent). Trước đây `ensureStack` nằm trong `pulumiRun` mặc định; khi
    // mặc định đảo thành opt-in, mutation đầu tiên của luồng phải tự chuẩn bị.
    ensureStack(projectDir(PLATFORM_PROJECT), PLATFORM_PROJECT, ctx, env);

    // Secret `postgres:password` sinh ngẫu nhiên MỘT LẦN duy nhất trên stack
    // mới, rồi đọc lại từ backend ở mọi lần chạy sau — regen mỗi lần chạy sẽ
    // khiến container Postgres rebuild không lý do. CHỈ thuộc về đường apply:
    // preview không bao giờ sinh/ghi secret (prerequisite của preview là secret
    // đã tồn tại — xem `runPreview`).
    const secret = exec(
      'pulumi',
      // KHÔNG có cờ `--secret` ở `config get`: CLI 3.267 từ chối `unknown flag`
      // (đo thật), secret get trả plaintext của giá trị đã mã hoá mà không cần
      // cờ; cờ `--secret` chỉ thuộc về `config set`. Lỗi cờ từng khiến mỗi lần
      // chạy sinh mật khẩu MỚI đè lên mật khẩu cũ — container Postgres hiện hữu
      // không còn khớp secret state sau lần apply kế tiếp.
      ['config', 'get', 'postgres:password', '--stack', fullStackRef(PLATFORM_PROJECT, ctx)],
      projectDir(PLATFORM_PROJECT),
      env,
    );
    // CHỈ coi là "chưa có key" khi CLI báo đúng vậy (isConfigKeyMissing) — sai
    // passphrase, state lock, backend hỏng... phải dừng ở đây, không được regen.
    if (!isConfigKeyMissing(secret) && secret.status !== 0) {
      throw new Error(`pulumi config get postgres:password thất bại:\n${secret.stderr}`);
    }
    if (secret.stdout.trim().length === 0) {
      const pw = randomBytes(24).toString('base64url');
      const setSecret = exec(
        'pulumi',
        [
          'config',
          'set',
          'postgres:password',
          pw,
          '--stack',
          fullStackRef(PLATFORM_PROJECT, ctx),
          '--secret',
        ],
        projectDir(PLATFORM_PROJECT),
        env,
      );
      if (setSecret.status !== 0) {
        throw new Error(`pulumi config set postgres:password thất bại:\n${setSecret.stderr}`);
      }
      console.log(
        '[local-deploy] postgres:password đã sinh ngẫu nhiên và lưu dạng secret trong state local.',
      );
    }
    pulumiRun(
      projectDir(PLATFORM_PROJECT),
      PLATFORM_PROJECT,
      ['up', '--yes', ...sharedConfigArgs],
      ctx,
      env,
      {
        prepareStack: true,
        // `up` là bước dài nhất (build image home) — stream progress ra terminal
        // thay vì giữ trong pipe đến khi lệnh xong.
        stream: true,
      },
    );
  } catch (error) {
    console.error(`[local-deploy] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  // 2. Đọc outputs thực tế (port do Docker cấp chỉ tồn tại sau up).
  console.log('[local-deploy] đọc outputs platform…');
  let outputs: { traefikHostPort: number; rootHost: string };
  try {
    outputs = readPlatformOutputs(projectDir(PLATFORM_PROJECT), ctx, env);
  } catch (error) {
    console.error(`[local-deploy] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  // 3. Cập nhật .env (chỉ key thuộc workflow).
  const { envPath } = upsertLocalEnv(ctx.worktreeRoot, outputs.rootHost);
  console.log(`[local-deploy] ${ROOT_HOST_ENV_KEY}=${outputs.rootHost} đã ghi vào ${envPath}`);

  // 4. Home up — image build + container + routing labels.
  console.log('[local-deploy] home up…');
  const homeOk = runProjectStep(
    'home up',
    HOME_PROJECT,
    [
      'up',
      '--yes',
      ...sharedConfigArgs,
      // Stack reference format đã kiểm chứng THỰC NGHIỆM trên SDK 3.270 + backend
      // `file://`: `organization/<project>/<stack>`. Org segment phải là literal
      // `organization` (backend `file://` hiện tại của Pulumi chỉ chấp nhận org
      // này — bất kỳ tên nào khác fail "organization name must be 'organization'");
      // backend nào được consult là backend trong `PULUMI_BACKEND_URL` của env,
      // không phải chuỗi URL trong ref. Format kiểu
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
    env,
    { prepareStack: true, stream: true },
  );
  if (!homeOk) return 1;

  // 5. Smoke HTTPS qua Traefik với certificate local.
  if (options.skipSmoke !== true) {
    const smoke = exec(
      'node',
      [join(ROOT_DIR, 'tools/dx/src/local-smoke.mjs'), outputs.rootHost],
      ROOT_DIR,
      process.env,
    );
    if (smoke.status !== 0) {
      console.error(`[local-deploy] smoke HTTPS thất bại:\n${smoke.stdout}\n${smoke.stderr}`);
      return 1;
    }
    console.log(`[local-deploy] smoke OK: https://${outputs.rootHost}/`);
  }

  console.log(
    `[local-deploy] hoàn tất — truy cập https://${outputs.rootHost}/ ` +
      `(certificate local cần được trust thủ công trên máy developer).`,
  );
  return 0;
}

/**
 * Đường `--preview` — READ-ONLY tuyệt đối với state/`.env`/Docker.
 *
 * Contract (được test orchestration khoá, không được nới lỏng để preview "chạy
 * được trên worktree mới"):
 *
 * 1. KHÔNG khởi tạo: không `ensureStack` (mkdir + `stack init`), không sinh
 *    secret, không `config set`, không ghi `.env`, không `up`/`destroy`.
 * 2. KHÔNG truyền `--config` cho `pulumi preview`: CLI 3.x **lưu** `--config`
 *    vào stack config file kể cả khi preview (đo từ `pulumi preview --help`:
 *    "Config to use during the preview and save to the stack config file") —
 *    truyền nó là mutation cấu hình giữa chừng một lệnh read-only. Mọi key mà
 *    chương trình cần (`namespace:worktreeRoot`, `namespace:platformStackRef`,
 *    secret `postgres:password`) đã do apply lưu vào stack config ở lần chạy
 *    trước — preview chỉ đọc lại.
 * 3. Prerequisite kiểm READ-ONLY trước khi chạy lệnh nào: state dir tồn tại,
 *    platform stack đã up (outputs thật — home đọc qua StackReference), home
 *    stack tồn tại. Thiếu → báo đúng thiếu gì kèm cách khắc phục (`pnpm dx
 *    local-deploy`) và trả 1 — không tự khởi tạo gì để "giúp" preview xanh.
 *
 * Passphrase vẫn bắt buộc (gate ở `localDeploy`): `preview` nạp stack config
 * (PU4). Mọi lệnh chạy với `prepareStack: false`.
 */
function runPreview(ctx: LocalDeployContext, env: NodeJS.ProcessEnv): number {
  console.log('[local-deploy] preview (read-only) — kiểm prerequisites…');

  // State dir là chính bằng chứng "worktree đã từng deploy" và backend `file://`
  // cũng đòi thư mục tồn tại trước (PU11). Check bằng chứng PHẢI chạy trước:
  // thiếu thì báo đúng contract thay vì để CLI fail chung chung.
  if (!existsSync(localStateDir(ctx.worktreeRoot))) {
    console.error(
      `[local-deploy] preview: worktree chưa từng deploy (không có .pulumi-local-state) — ` +
        'preview là read-only, KHÔNG tự khởi tạo state/stack/secret. Chạy `pnpm dx ' +
        'local-deploy` (apply) trước rồi mới preview được.',
    );
    return 1;
  }

  // Platform phải đã up: outputs là thứ home đọc qua StackReference (preview
  // trên stack chưa up cho kết quả vô nghĩa/undefined), và "đã up" hàm ý mọi
  // config + secret mà chương trình require đã được apply lưu.
  const platform = queryPlatformStatus(ctx, env);
  switch (platform.state) {
    case 'deployed':
      break;
    case 'no-stack':
      console.error(
        '[local-deploy] preview: chưa có platform stack trong backend — preview không tự ' +
          'init stack. Chạy `pnpm dx local-deploy` trước.',
      );
      return 1;
    case 'no-outputs':
      console.error(
        '[local-deploy] preview: platform stack tồn tại nhưng chưa up lần nào (outputs ' +
          'rỗng) — chưa có wiring để preview. Chạy `pnpm dx local-deploy` (apply) trước.',
      );
      return 1;
    case 'backend-error':
    case 'parse-error':
      console.error(`[local-deploy] preview: lỗi Pulumi/backend đọc platform: ${platform.detail}`);
      return 1;
  }

  // Home stack phải tồn tại — không thì preview home là "unknown stack". Kiểm
  // read-only (stack output là lệnh đọc) để fail TRƯỚC khi chạy platform preview,
  // tránh báo "preview xong (platform + home)" rồi mới lỗi giữa chừng.
  const homeCheck = classifyStackOutput(
    exec(
      'pulumi',
      ['stack', 'output', '--json', '--stack', fullStackRef(HOME_PROJECT, ctx)],
      projectDir(HOME_PROJECT),
      env,
    ),
  );
  if (homeCheck.state === 'backend-error' || homeCheck.state === 'parse-error') {
    console.error(`[local-deploy] preview: lỗi Pulumi/backend đọc home: ${homeCheck.detail}`);
    return 1;
  }
  if (homeCheck.state === 'no-stack') {
    console.error(
      '[local-deploy] preview: chưa có home stack — worktree chưa apply đủ. Chạy `pnpm dx ' +
        'local-deploy` (apply) trước; preview KHÔNG tự tạo stack.',
    );
    return 1;
  }

  console.log('[local-deploy] platform preview…');
  const platformOk = runProjectStep(
    'platform preview',
    PLATFORM_PROJECT,
    // Không `--config` (xem JSDoc): config đã nằm trong stack từ lần apply trước.
    ['preview'],
    ctx,
    env,
    { prepareStack: false, stream: true },
  );
  if (!platformOk) return 1;

  console.log('[local-deploy] home preview…');
  const homeOk = runProjectStep('home preview', HOME_PROJECT, ['preview'], ctx, env, {
    prepareStack: false,
  });
  if (!homeOk) {
    console.error(
      '[local-deploy] home preview thất bại — platform ĐÃ preview, home KHÔNG được preview ' +
        '(không có gì được apply). Xem lỗi pulumi phía trên; nếu thiếu config ' +
        '`namespace:platformStackRef` của home stack, chạy `pnpm dx local-deploy` (apply) trước.',
    );
    return 1;
  }

  console.log(
    '[local-deploy] preview xong (platform + home) — read-only: không apply, không ghi ' +
      'state/config/.env, không đụng Docker.',
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
  const volumeName = dockerResourceName(ctx.namespace, 'postgres-volume');

  // Teardown trên worktree CHƯA TỪNG deploy phải là no-op idempotent, không
  // phải mutation — và phải đứng TRƯỚC cả gate passphrase: yêu cầu passphrase
  // cho một worktree chưa có gì để xoá là chặn teardown hợp lệ chỉ vì env thiếu
  // biến. `ensureStack` với `mkdir` + `stack init` sẽ TẠO state mới chỉ để
  // destroy nó (và home destroy còn fail vì config `platformStackRef` chưa
  // từng được ghi). State dir chưa tồn tại = chắc chắn chưa có gì để xoá.
  if (!existsSync(localStateDir(ctx.worktreeRoot))) {
    console.log(
      `[local-deploy] worktree chưa từng deploy (không có ${'.pulumi-local-state'}) — destroy là no-op.`,
    );
    return 0;
  }

  // Passphrase bắt buộc: `destroy` nạp stack config (PU4) nên không có
  // passphrase là CLI exit 1 giữa chừng — home đã destroy nhưng platform chưa.
  const pass = requirePassphrase();
  if ('error' in pass) {
    console.error(`[local-destroy] ${pass.error}`);
    return 1;
  }
  const env = pulumiEnv(ctx, pass.passphrase);

  console.log('[local-deploy] home destroy…');
  const homeOk = runProjectStep(
    'home destroy',
    HOME_PROJECT,
    ['destroy', '--yes', '--config', `namespace:worktreeRoot=${ctx.worktreeRoot}`],
    ctx,
    env,
    { prepareStack: false },
  );
  if (!homeOk) return 1;

  console.log('[local-deploy] platform destroy…');
  const platformOk = runProjectStep(
    'platform destroy',
    PLATFORM_PROJECT,
    ['destroy', '--yes', '--config', `namespace:worktreeRoot=${ctx.worktreeRoot}`],
    ctx,
    env,
    { prepareStack: false },
  );
  if (!platformOk) return 1;

  if (options.removeData === true) {
    console.warn(
      `[local-deploy] CẢNH BÁO: xoá volume PostgreSQL ${volumeName} — dữ liệu database ` +
        `local của worktree này bị mất vĩnh viễn.`,
    );
    const vol = exec('docker', ['volume', 'rm', volumeName], ROOT_DIR, process.env);
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

/**
 * Phân loại trạng thái stack platform — nguồn duy nhất cho `localStatus`.
 *
 * Kết quả PHẢI phân biệt được "chưa deploy" với "backend hỏng": gộp hai trạng
 * thái là cách status nói dối — backend không đọc được bị bắn ra thành "chưa
 * deploy" và người dùng chạy `local-deploy` vào một backend đang hỏng.
 */
export type PlatformStatusResult =
  | { state: 'no-stack' }
  | { state: 'no-outputs' }
  | { state: 'deployed'; outputs: Record<string, unknown> }
  | { state: 'backend-error'; detail: string }
  | { state: 'parse-error'; detail: string };

/** Hàm phân loại thuần — test được không cần Pulumi thật (inject exec command). */
export function classifyStackOutput(result: ExecResult): PlatformStatusResult {
  if (result.status === 0) {
    if (result.stdout.trim().length === 0) {
      // Không xảy ra với `--json` (thường luôn in `{}`) nhưng fail-closed vẫn đúng hơn im lặng.
      return { state: 'no-outputs' };
    }
    try {
      const outputs = JSON.parse(result.stdout) as Record<string, unknown>;
      if (Object.keys(outputs).length === 0) {
        // `stack output --json` exit 0 với `{}` = stack init nhưng CHƯA từng up.
        return { state: 'no-outputs' };
      }
      return { state: 'deployed', outputs };
    } catch (error) {
      return {
        state: 'parse-error',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const combined = `${result.stderr}\n${result.stdout}`;
  if (/no stack named/iu.test(combined)) {
    return { state: 'no-stack' };
  }
  // `status === null` nghĩa là process CHẠY CHƯA ĐƯỢC (binary không tồn tại,
  // không executable...) hoặc bị SIGNAL kill (OOM...) — stderr/stdout rỗng lúc
  // đó, nếu đi tiếp sẽ thành "lỗi Pulumi không xác định" và người dùng không
  // cài `pulumi` bị báo thành lỗi backend. Báo đúng nguyên nhân qua helper
  // dùng chung (cùng chuẩn với `execStreaming`/`pulumiRun`).
  if (result.status === null) {
    return {
      state: 'backend-error',
      detail: `pulumi không chạy được: ${describeSpawnFailure(result)}`,
    };
  }
  if (
    /unable to open state directory|unable to find backend|cannot connect|dial tcp|permission denied/iu.test(
      combined,
    )
  ) {
    return { state: 'backend-error', detail: combined.trim() };
  }
  // Lỗi không nhận diện được → backend-error (không nuốt). stderr có thể chứa
  // path backend — không in path nhạy cảm, chỉ in dòng lỗi đầu.
  const firstLine = combined
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return { state: 'backend-error', detail: firstLine ?? 'lỗi Pulumi không xác định' };
}

/** Truy vấn trạng thái stack platform — read-only, qua context đúng worktree. */
export function queryPlatformStatus(
  ctx: LocalDeployContext,
  env: NodeJS.ProcessEnv,
): PlatformStatusResult {
  // Backend `file://` đòi thư mục state tồn tại trước (PU11). Worktree chưa
  // từng deploy thì thư mục này chưa ai tạo (chỉ `ensureStack` mới mkdir) —
  // bấm CLI lúc đó chỉ nhận `unable to open state directory`, mà phân loại
  // thành `backend-error` là sai chẩn: trạng thái đúng là "chưa deploy".
  // Vẫn read-only: chỉ KIỂM tra sự tồn tại, không tạo gì.
  if (!existsSync(localStateDir(ctx.worktreeRoot))) {
    return { state: 'no-stack' };
  }
  const result = exec(
    'pulumi',
    ['stack', 'output', '--json', '--stack', fullStackRef(PLATFORM_PROJECT, ctx)],
    projectDir(PLATFORM_PROJECT),
    env,
  );
  return classifyStackOutput(result);
}

/**
 * In trạng thái hiện tại: namespace, stack, và trạng thái platform stack.
 *
 * READ-ONLY: không tạo stack, không deploy, không ghi `.env`, không destroy gì.
 * Thất bại backend/parse → exit != 0 (không nuốt lỗi thật thành "chưa deploy").
 */
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

  // Passphrase bắt buộc ngay cả khi chỉ ĐỌC outputs: `stack output` nạp stack
  // config (PU4), thiếu passphrase là exit 1 — phải báo đúng lý do, không nuốt
  // thành "chưa deploy".
  const pass = requirePassphrase();
  if ('error' in pass) {
    console.error(`[local-status] ${pass.error}`);
    return 1;
  }
  const env = pulumiEnv(ctx, pass.passphrase);

  const status = queryPlatformStatus(ctx, env);
  switch (status.state) {
    case 'no-stack': {
      console.log('platform:       chưa có stack trong backend — chạy pnpm dx local-deploy');
      return 0;
    }
    case 'no-outputs': {
      console.log(
        'platform:       stack có sẵn nhưng chưa up (outputs rỗng) — chạy pnpm dx local-deploy',
      );
      return 0;
    }
    case 'deployed': {
      console.log(`platform outputs: ${JSON.stringify(status.outputs)}`);
      return 0;
    }
    case 'parse-error': {
      console.error(`[local-status] outputs platform không parse được JSON: ${status.detail}`);
      return 1;
    }
    case 'backend-error': {
      console.error(`[local-status] lỗi Pulumi/backend: ${status.detail}`);
      return 1;
    }
  }
}

/** Keys mà luồng này sở hữu — export để test và để review chặn đè key lạ. */
export const OWNED_ENV_KEYS: readonly string[] = LOCAL_ENV_OWNED_KEYS;
