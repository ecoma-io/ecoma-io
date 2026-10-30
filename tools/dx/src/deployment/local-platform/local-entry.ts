/**
 * Nền tảng dùng chung cho entry lifecycle colocated (`deploys/<p>/local.ts`).
 *
 * Sau khi DX bỏ orchestration (Issue #423), MỖI deploy project tự chạy
 * `up`/`down` trên stack Pulumi của chính nó qua entry colocated; Nx (dependsOn
 * giữa các target `local-up`/`local-down`) suy thứ tự toàn cục. Entry TỰ lấy
 * khóa lane (`.ecoma-lane.lock` quanh phần mutate của chính nó) — không còn
 * lease env, không orchestrator giữ khóa thay: một `pulumi config set` mutate
 * stack config NGOÀI danh sách resource mà state lock của Pulumi giữ, nên
 * mutation ngoài `pulumi up` vẫn cần khóa lane do chính entry nắm.
 *
 * Module này giữ phần có tái sử dụng của entry (resolve context + passphrase,
 * khóa lane với escape hatch `--steal-lock`, `pulumi up`/`destroy` với config
 * chuẩn lane, `config set` qua stdin, health gate container CỦA CHÍNH project,
 * smoke HTTPS). Phần khác nhau theo project (bảng secret, container kind của
 * health gate) sống trong từng entry — module này không liệt kê tên deploy
 * project nào.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  dockerResourceName,
  type DeployResourceKind,
} from './../../local-runtime/deploy-namespace.js';
import { acquireLaneLock, stealLaneLock } from './../../local-runtime/local-lock.js';
import {
  ensureStack,
  exec,
  fullStackRef,
  localStateDir,
  pulumiEnv,
  pulumiRun,
  resolveContext,
  resolveLocalPassphrase,
  type LocalDeployContext,
} from './pulumi-context.js';
import { readRootHostFromEnv } from './local-env.js';
import { ROOT_DIR } from '../../utils.js';

/** Thư mục của một deploy project (tuyệt đối, không phụ thuộc cwd của caller). */
export function deployProjectDir(project: string): string {
  return join(ROOT_DIR, 'deploys', project);
}

/**
 * Chạy `body` trong khi giữ khóa lane của worktree — hình mẫu của mọi entry.
 *
 * `stealLock` là cờ người (`--steal-lock` của entry): `true` → chiếm khóa đang
 * giữ bởi holder CÒN SỐNG, in holder identity một dòng trước khi mutate. Bị
 * chặn mà không dùng cờ: `acquireLaneLock` chờ vô hạn với progress line định
 * kỳ (~30s, chỉ là UX) — chủ treo-vẫn-sống xử bằng `--steal-lock`
 * (human-in-the-loop), không bằng đồng hồ.
 *
 * Khóa bao đúng phần mutate: `body` chạy sau khi khóa đã nắm; release chạy
 * trong `finally` kể cả khi `body` throw hay trả exit khác 0.
 */
export async function withLaneLock(
  worktreeRoot: string,
  stealLock: boolean,
  body: () => Promise<number>,
): Promise<number> {
  if (stealLock) {
    const holder = stealLaneLock(worktreeRoot);
    if (holder !== null) {
      console.log(
        `[local-entry] --steal-lock: removed the lane lock held by pid=${holder.pid} ` +
          `cmdline=${JSON.stringify(holder.cmdline)} startedAt=${new Date(holder.startedAt).toISOString()}`,
      );
    } else {
      console.log('[local-entry] --steal-lock: no lane lock to steal.');
    }
  }
  const lane = acquireLaneLock(worktreeRoot);
  try {
    return await body();
  } finally {
    lane.release();
  }
}

/** Nền tảng đã resolve cho MỘT lần chạy entry `up`/`down`. */
export interface EntryFoundation {
  ctx: LocalDeployContext;
  env: NodeJS.ProcessEnv;
}

/**
 * Resolve context + passphrase cho entry `up`/`down`.
 *
 * `create: true` (up) — được phép sinh passphrase file + state dir mới.
 * `create: false` (down) — KHÔNG tạo gì; worktree chưa deploy thì return
 * `undefined` để caller chấm dứt như một no-op idempotent (exit 0), không phải
 * mutation: tạo state mới chỉ để destroy nó là sai ngữ nghĩa teardown, và
 * tạo file passphrase cho worktree chưa có gì để xoá là mutation vô nghĩa.
 *
 * Throw với thông điệp gốc của `resolveLocalPassphrase` khi state đã có mà
 * thiếu passphrase — entry in thông điệp đó và exit 1, KHÔNG tự sinh passphrase
 * mới (sẽ không unlock state cũ).
 */
export function resolveEntryFoundation(create: boolean): EntryFoundation | undefined {
  const ctx = resolveContext();
  if (!create && !existsSync(localStateDir(ctx.worktreeRoot))) {
    return undefined;
  }
  const passphrase = resolveLocalPassphrase(ctx.worktreeRoot, { create });
  return { ctx, env: pulumiEnv(ctx, passphrase) };
}

/**
 * Đối số `up` dùng chung mọi unit — giữ nguyên ngữ nghĩa của bản hard-coded.
 *
 * Chương trình Pulumi nhận worktreeRoot + platformStackRef qua config (KHÔNG
 * đọc `.env`), và `home-deploy:platformStackRef=` xoá key stack-reference chết
 * từng được ghi bởi một phiên bản trước — giữ để stack config không mang key
 * chết mà người đọc tưởng đang được dùng.
 */
export function unitUpArgs(ctx: LocalDeployContext): string[] {
  return [
    'up',
    '--yes',
    '--config',
    'home-deploy:platformStackRef=',
    '--config',
    `namespace:worktreeRoot=${ctx.worktreeRoot}`,
    '--config',
    `namespace:platformStackRef=organization/platform-deploy/${ctx.stackName}`,
  ];
}

/**
 * Ghi một giá trị vào stack config QUA STDIN (không argv) — fail-loud khi set
 * lỗi. Stack phải tồn tại trước (`ensureStackForEntry`); hàm này cố ý KHÔNG
 * tạo stack — tạo state bên trong một helper "set" biến đường lỗi thành đường
 * mutation âm thầm.
 *
 * argv của process khác đọc được qua `/proc/<pid>/cmdline` (cùng user) và qua
 * `ps`; giá trị secret không đi qua argv. `--plaintext` BẮT BUỘC trên CLI
 * 3.270 (CLI tự chặn giá trị "trông như secret" khi thiếu cờ), `--raw` giữ
 * nguyên giá trị không trim newline.
 */
export function setStackConfig(
  project: string,
  configKey: string,
  configValue: string,
  foundation: EntryFoundation,
): void {
  const result = exec(
    'pulumi',
    [
      'config',
      'set',
      configKey,
      '--plaintext',
      '--raw',
      '--stack',
      fullStackRef(project, foundation.ctx),
    ],
    deployProjectDir(project),
    foundation.env,
    { input: configValue },
  );
  if (result.status !== 0) {
    throw new Error(`pulumi config set ${configKey} failed:\n${result.stderr}`);
  }
}

/**
 * Đảm bảo stack Pulumi của MỘT project tồn tại trước khi entry đọc/ghi stack
 * config (`pulumi config get`/`config set`).
 *
 * Vì sao cần gọi TƯỜNG MINH: backend `file://` đòi thư mục state tồn tại trước
 * (PU11) — trên worktree chưa từng deploy, `.pulumi-local-state` không có và
 * `pulumi config get` exit 1 với lỗi `unable to open state directory`, lỗi mà
 * `isConfigKeyMissing` KHÔNG nhận ra là "chưa có key". Không có bước này, up
 * đầu tiên của platform chết ngay ở `resolvePostgresPassword` và up đầu tiên
 * của unit chết ngay ở `prepare` — cả hai đều trước `pulumiUpForEntry` (lệnh
 * `up` mới tự `ensureStack` qua `prepareStack: true`).
 *
 * `ensureStack` idempotent: mkdir + `stack init` khi thiếu, `stack select` khi
 * đã có — gọi mỗi lần up là an toàn. Chỉ đường up gọi (down/smoke không bao giờ
 * tạo state — contract `resolveEntryFoundation(false)` giữ nguyên).
 */
export function ensureStackForEntry(project: string, foundation: EntryFoundation): void {
  ensureStack(deployProjectDir(project), project, foundation.ctx, foundation.env);
}

/**
 * Chạy `pulumi up` của entry sau khi đã resolve nền tảng — KHÔNG lấy khóa
 * (caller giữ khóa qua `withLaneLock`), KHÔNG set secret (entry tự làm trong
 * `prepare`).
 *
 * `stream: true` — `up` là bước dài (build image có thể mất vài phút), progress
 * phải ra terminal ngay. Lỗi → throw với stderr gốc; caller in và exit 1.
 */
export function pulumiUpForEntry(project: string, foundation: EntryFoundation): void {
  pulumiRun(
    deployProjectDir(project),
    project,
    unitUpArgs(foundation.ctx),
    foundation.ctx,
    foundation.env,
    {
      prepareStack: true,
      stream: true,
    },
  );
}

/**
 * Chạy `pulumi destroy --yes` cho MỘT project — phần có tái sử dụng của `down`.
 *
 * KHÔNG dùng `pulumi stack rm`: xoá stack là xoá cả CONFIG (`postgres:password`,
 * secret cross-stack) trong khi volume `retainOnDelete` còn lại — deploy kế
 * tiếp sẽ không có mật khẩu khớp volume cũ và phải fail có hướng dẫn. Giữ stack
 * rỗng resource là cách hai nửa (mật khẩu trong config, dữ liệu trong volume)
 * luôn cùng tuổi. Với `platform-deploy` còn đảm bảo thêm: volume sau destroy
 * được entry xoá tường minh (`runPlatformDown`) — bắt buộc destroy KHÔNG tự
 * xoá volume (`retainOnDelete`), nếu không hai kết quả không tách rời được.
 *
 * Chỉ đủ `namespace:worktreeRoot`: destroy không chạy chương trình (chỉ đọc
 * state), không cần `platformStackRef`, và KHÔNG được ghi config mới vào stack.
 *
 * Lỗi → throw với stderr gốc — caller in và exit 1 (lỗi thật của destroy KHÔNG
 * được nuốt). "Chưa deploy" xử ở tầng entry qua `resolveEntryFoundation`
 * (state dir vắng mặt → no-op exit 0); "stack rỗng" Pulumi tự xử thành exit 0.
 */
export function pulumiDestroyForEntry(project: string, foundation: EntryFoundation): void {
  pulumiRun(
    deployProjectDir(project),
    project,
    ['destroy', '--yes', '--config', `namespace:worktreeRoot=${foundation.ctx.worktreeRoot}`],
    foundation.ctx,
    foundation.env,
    { prepareStack: false },
  );
}

/**
 * Chờ container CỦA CHÍNH project healthy — health gate của entry `up`.
 *
 * Mọi deploy program khai healthcheck Docker cho container chính của nó
 * (probe do chính unit định nghĩa — `/health` của app, `pg_isready`,
 * `traefik healthcheck`...), nên bằng chứng "unit sống" là container `running`
 * với `Health.Status=healthy`. Inspect qua `docker inspect --format` với tên
 * theo namespace (`ecoma-<ns>-<kind>`) — KHÔNG đụng namespace worktree khác;
 * KHÔNG có giá trị env/secret nào đi vào output.
 *
 * Retry bounded: container vừa lên có thể còn trong `startPeriod` của
 * healthcheck (mail/push khai 120s, pact-api 60s) — `starting` được thử lại
 * trong budget 90s trước khi chốt fail; container KHÔNG TỒN TẠI hoặc không
 * `running` là fail NGAY (stack up đã báo xanh thì container phải tồn tại —
 * mất là lỗi thật).
 *
 * `budgetMs`/`pollMs` là test seam — production bỏ qua (dùng mặc định).
 */
export function waitForOwnContainerHealthy(
  ctx: LocalDeployContext,
  kind: DeployResourceKind,
  options: { budgetMs?: number; pollMs?: number } = {},
): number {
  const budgetMs = options.budgetMs ?? 90_000;
  const pollMs = options.pollMs ?? 3_000;
  const containerName = dockerResourceName(ctx.namespace, kind);
  const startedAt = Date.now();
  for (;;) {
    const health = inspectContainerHealth(containerName);
    if (health.state === 'healthy') {
      console.log(`[local-entry] ${containerName} healthy after ${Date.now() - startedAt}ms`);
      return 0;
    }
    if (health.state === 'missing' || health.state === 'not-running') {
      // Trạng thái CUỐI: retry không hồi sinh container không tồn tại — fail
      // ngay với trạng thái đã quan sát.
      console.error(
        `[local-entry] health gate FAILED: ${containerName} ` +
          (health.state === 'missing'
            ? 'does not exist — the stack reported up but the container is gone'
            : `is not running (state: ${health.status})`),
      );
      return 1;
    }
    const remainingMs = budgetMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      console.error(
        `[local-entry] health gate FAILED after ${String(budgetMs)}ms budget: ` +
          `${containerName}: ${health.health}`,
      );
      return 1;
    }
    const sleepMs = Math.min(pollMs, remainingMs);
    console.error(
      `[local-entry] health gate waiting: ${containerName}: ${health.health} — ` +
        `retrying in ${String(Math.ceil(sleepMs / 1000))}s`,
    );
    const sleep = exec('sleep', [String(Math.ceil(sleepMs / 1000))], ROOT_DIR, process.env);
    if (sleep.status !== 0) {
      console.error('[local-entry] health gate: sleep between polls failed');
      return 1;
    }
  }
}

type ContainerHealth =
  | { state: 'healthy' }
  | { state: 'starting'; health: string }
  | { state: 'unhealthy'; health: string }
  | { state: 'not-running'; status: string }
  | { state: 'missing' };

function inspectContainerHealth(containerName: string): ContainerHealth {
  // `docker inspect` per-container: format in `status|health` — health rỗng
  // với container không khai healthcheck (mọi container của lane đều khai,
  // nhưng parse vẫn đối xử tường minh). KHÔNG in stderr gốc vào console
  // (giữ một nguồn lỗi đã chuẩn hoá; output không chứa secret nhưng nhất quán
  // với `verifyLaneHealth` cũ).
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

/**
 * Smoke HTTPS qua Traefik — cùng script `.mjs` với bản orchestration cũ.
 *
 * Chỉ entry của platform có step `smoke` (node lá của chuỗi dependsOn). Đọc
 * `ROOT_HOST` từ `.env` (artifact mà post-up của platform ghi); thiếu là
 * platform chưa up hoặc `.env` đã bị xoá — fail với hướng dẫn, không đoán.
 */
export function runEntrySmoke(worktreeRoot: string): number {
  const rootHost = readRootHostFromEnv(worktreeRoot);
  if (rootHost === undefined) {
    console.error('[local-entry] smoke: missing ROOT_HOST in .env — platform up has not run?');
    return 1;
  }
  const smoke = exec(
    'node',
    [join(ROOT_DIR, 'tools/dx/src/deployment/local-platform/local-smoke.mjs'), rootHost],
    ROOT_DIR,
    process.env,
  );
  if (smoke.status !== 0) {
    console.error(`[local-entry] smoke HTTPS failed:\n${smoke.stdout}\n${smoke.stderr}`);
    return 1;
  }
  console.log(`[local-entry] smoke OK: https://${rootHost}/`);
  return 0;
}
