/**
 * Pulumi CLI/backend context cô lập theo worktree — nền tảng cho mọi lệnh Pulumi
 * của local deployment (up/preview/destroy/output/status).
 *
 * Bài toán: nhiều worktree cùng chạy `pnpm dx local-deploy` trên một host. Pulumi
 * CLI giữ hai trạng thái chia sẻ trong CLI home mặc định (`~/.pulumi`): backend
 * đang login (credentials.json) và workspace file theo project
 * (`workspaces/<project>-<sha1(Pulumi.yaml path)>-workspace.json` — đã kiểm thực
 * nghiệm: hash là sha1 của **đường dẫn file Pulumi.yaml**, dự đoán khớp 100%).
 * Trước thay đổi này, orchestration phải `pulumi login file://<state>` trước mỗi
 * lệnh — clobber backend selection toàn cục và race giữa các worktree.
 *
 * Cơ chế thay thế (đã KIỂM THỰC NGHIỆM trên CLI v3.267/3.270, ghi ở
 * `docs/overview/04-platform-facts.md` §2.16 PU12–PU13):
 *
 * 1. `PULUMI_BACKEND_URL=file://<worktree>/.pulumi-local-state` — trỏ backend
 *    trực tiếp, KHÔNG cần `pulumi login` và KHÔNG đụng credentials.json.
 * 2. `--stack organization/<project>/<stack>` tường minh trên MỌI lệnh — không
 *    đọc/ghi "currently selected stack" ở bất kỳ đâu.
 * 3. KHÔNG đặt `PULUMI_HOME`: nó di chuyển CẢ plugin cache (~508MB), mỗi worktree
 *    phải tải lại toàn bộ provider plugin. Plugin cache và credentials home để
 *    chia sẻ là đúng — chúng là read-only đối với các lệnh này.
 *
 * Không có biến nào ở đây chứa secret: passphrase đi qua `PULUMI_CONFIG_PASSPHRASE`
 * do caller truyền, chỉ sống trong env của subprocess.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { normalizeWorktreeRoot, pulumiStackName, worktreeNamespace } from './deploy-namespace.js';
import { ROOT_DIR } from './utils.js';

/**
 * Thư mục state `file://` của một worktree — VỐN đã là contract (ngoài Git,
 * theo worktree), giờ cũng là backend URL duy nhất mà mọi lệnh Pulumi thấy.
 */
export function localStateDir(worktreeRoot: string): string {
  return join(worktreeRoot, '.pulumi-local-state');
}

/**
 * Kết quả một bước exec shell — fail-closed: caller phải kiểm `status`.
 *
 * Một bản duy nhất cho cả `pulumi-context` và `local-deploy` (import từ đây):
 * hai bản tự dựng là chỗ trôi lệch — một bên thêm `error`/`signal` thì bên kia
 * không. Các trường `error`/`signal` báo "process chưa chạy được/bị kill"
 * (`status === null`), caller phân loại lỗi dựa vào chúng.
 */
export interface ExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
  /** `spawnSync` tự báo lỗi qua `error` (ENOENT — không có binary, EACCES...) — `status` là `null` lúc đó. */
  error?: Error;
  /** Non-null khi process bị signal kill (OOM...) — `status` là `null` lúc đó. */
  signal?: NodeJS.Signals | null;
}

export function exec(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): ExecResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
    signal: result.signal,
  };
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

/**
 * Passphrase của state Pulumi local — BẮT BUỘC, không fallback.
 *
 * Trả về giá trị từ env; thiếu thì trả lỗi với thông báo hành động cụ thể. Env
 * trước hết là của tiến trình hiện tại; `PULUMI_CONFIG_PASSPHRASE_FILE` được
 * Pulumi CLI tự đọc khi biến chính không đặt — orchestration không đọc file,
 * để đường đó nguyên vẹn cho developer.
 *
 * Vì sao KHÔNG có fallback hard-code (từng là `ecoma-local-only`): một passphrase
 * commit trong source là passphrase mà ai đọc repo cũng biết — với AES-256-GCM
 * của Pulumi, nó chính là khoá giải mọi secret trong state (PU1/PU5). Passphrase
 * là encryption material của developer, phải đến từ môi trường của họ.
 */
export function requirePassphrase():
  | { passphrase: string; fromFile: false }
  | { passphrase: undefined; fromFile: true }
  | { error: string } {
  if (typeof process.env.PULUMI_CONFIG_PASSPHRASE === 'string') {
    return { passphrase: process.env.PULUMI_CONFIG_PASSPHRASE, fromFile: false };
  }
  if (typeof process.env.PULUMI_CONFIG_PASSPHRASE_FILE === 'string') {
    // File được CLI tự đọc; với orchestration chỉ cần biết "đã có đường cung".
    // `passphrase` là undefined — sentinel chuỗi rỗng sẽ bị `pulumiEnv` set vào
    // env ở vị trí ưu tiên cao nhất, chặn CLI đọc file (PU2: biến chính thắng).
    return { passphrase: undefined, fromFile: true };
  }
  return {
    error:
      'PULUMI_CONFIG_PASSPHRASE chưa đặt. Local Pulumi state mã hoá secret bằng passphrase ' +
      'của riêng máy bạn — cung cấp trước khi chạy:\n' +
      '  export PULUMI_CONFIG_PASSPHRASE="<passphrase-riêng-của-bạn>"\n' +
      'hoặc trỏ PULUMI_CONFIG_PASSPHRASE_FILE tới một file ngoài repo. Giữ passphrase ' +
      'ổn định CHO TỪNG WORKTREE: mất passphrase là mất plaintext của mọi secret trong ' +
      'state đó vĩnh viễn (Pulumi không khôi phục được). Passphrase không bao giờ được ' +
      'commit vào Git hay ghi vào .env.',
  };
}

/**
 * Env dùng chung cho mọi lệnh Pulumi trong luồng này.
 *
 * `pulumiEnv(ctx)` không cần `pulumi login`: `PULUMI_BACKEND_URL` chỉ thẳng
 * backend. Passphrase bắt buộc — caller truyền từ `requirePassphrase()`.
 *
 * Passphrase đến qua file (`fromFile: true`): XOÁ biến `PULUMI_CONFIG_PASSPHRASE`
 * khỏi env thay vì set — set chuỗi (kể cả rỗng) đặt biến ở vị trí ưu tiên cao
 * nhất của thứ tự giải passphrase (PU2) và chặn CLI đọc
 * `PULUMI_CONFIG_PASSPHRASE_FILE`; passphrase rỗng còn là GIÁ TRỊ HỢP LỆ (PU6),
 * nên sentinel rỗng vừa chặn đường file vừa là fail-open.
 */
export function pulumiEnv(
  ctx: LocalDeployContext,
  passphrase: string | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PULUMI_BACKEND_URL: ctx.stateUrl,
    PULUMI_SKIP_UPDATE_CHECK: '1',
  };
  if (passphrase === undefined) {
    delete env.PULUMI_CONFIG_PASSPHRASE;
  } else {
    env.PULUMI_CONFIG_PASSPHRASE = passphrase;
  }
  return env;
}

/**
 * Stack name ĐẦY ĐỦ cho một lệnh Pulumi trong một deploy project.
 *
 * Trên backend `file://`, stack name đầy đủ là `organization/<project>/<stack>`
 * (org literal `organization` — backend này chỉ chấp nhận org đó). Dạng ngắn
 * `local-<ns>` vẫn dùng cho `stack init`/`select` vì CLI tự bổ sung org hiện
 * hành, nhưng mọi lệnh KHÁC phải dùng dạng đầy đủ qua `--stack` để không phụ
 * thuộc selected-stack toàn cục.
 */
export function fullStackRef(projectName: string, ctx: LocalDeployContext): string {
  return `organization/${projectName}/${ctx.stackName}`;
}

/**
 * Chuẩn bị backend + stack cho một project TRƯỚC khi chạy lệnh đọc/ghi state.
 *
 * Hai bước, mỗi bước an toàn khi chạy lại (idempotent):
 * 1. `mkdir` state dir — backend `file://` đòi thư mục tồn tại trước (PU11).
 * 2. `stack init <short-name>` — exit 0 khi vừa tạo; exit != 0 khi stack đã có
 *    (hoặc lỗi thật) — phân biệt bằng `stack select`: select thành công nghĩa là
 *    "đã có sẵn", select fail nghĩa là lỗi thật.
 *
 * KHÔNG có `pulumi login` ở đây: backend được chọn qua env
 * `PULUMI_BACKEND_URL` của từng lệnh, không có selected backend toàn cục nào
 * bị ghi.
 *
 * Lưu ý: `stack init` trả exit 0 nhưng CÓ THỂ in stderr warning — không kiểm
 * stderr, chỉ kiểm status.
 */
export function ensureStack(
  projectDir: string,
  projectName: string,
  ctx: LocalDeployContext,
  env: NodeJS.ProcessEnv,
): void {
  mkdirSync(localStateDir(ctx.worktreeRoot), { recursive: true });
  const init = exec('pulumi', ['stack', 'init', ctx.stackName], projectDir, env);
  if (init.status !== 0) {
    const select = exec(
      'pulumi',
      ['stack', 'select', fullStackRef(projectName, ctx)],
      projectDir,
      env,
    );
    if (select.status !== 0) {
      throw new Error(
        `pulumi stack init/select ${ctx.stackName} thất bại:\n${init.stderr}\n${select.stderr}`,
      );
    }
  }
}

/**
 * Chạy một lệnh Pulumi với context ĐÚNG worktree — `--stack` đầy đủ, env backend
 * tường minh. Lỗi (exit != 0) → throw kèm stderr; KHÔNG in secret (Pulumi tự
 * redact secret trong stderr/stdout của nó).
 *
 * `ensureStack` chỉ chạy khi `prepareStack` khác `false`: lệnh `destroy`/`stack
 * output` kiểu "đọc/teardown" KHÔNG được tạo state trên worktree chưa từng
 * deploy — teardown biến thành mutation (mkdir + stack init) là sai ngữ nghĩa.
 * Caller chịu trách nhiệm tự xử lý "chưa có gì để xoá" trong trường hợp đó.
 */
export function pulumiRun(
  projectDir: string,
  projectName: string,
  args: string[],
  ctx: LocalDeployContext,
  env: NodeJS.ProcessEnv,
  options: { prepareStack?: boolean } = {},
): string {
  const fullArgs = ['--stack', fullStackRef(projectName, ctx), ...args];
  if (options.prepareStack !== false) {
    ensureStack(projectDir, projectName, ctx, env);
  }
  const run = exec('pulumi', fullArgs, projectDir, env);
  if (run.status !== 0) {
    throw new Error(`pulumi ${fullArgs.join(' ')} thất bại:\n${run.stderr || run.stdout}`);
  }
  return run.stdout;
}
