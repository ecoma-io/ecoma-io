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
 *    lệnh nào PHỤ THUỘC selected-stack; lưu ý `stack select` trong `ensureStack`
 *    vẫn GHI workspace file (PU13) nhưng file đó key theo đường dẫn project nên
 *    hai worktree không xung đột.
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
import { pathToFileURL } from 'node:url';

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
 * Diễn giải vì sao một `spawnSync` không sinh ra exit code (`status === null`):
 * process CHẠY CHƯA ĐƯỢC (binary không tồn tại — ENOENT, không executable —
 * EACCES) hoặc bị SIGNAL kill (OOM). Lúc đó stdout/stderr rỗng, nguyên nhân
 * thật chỉ nằm trong `error`/`signal`.
 */
export function describeSpawnFailure(result: ExecResult): string {
  if (result.error !== undefined && result.error !== null) return result.error.message;
  if (result.signal !== undefined && result.signal !== null) {
    return `process bị signal kill: ${result.signal}`;
  }
  return 'lý do không rõ';
}

/**
 * Chạy lệnh dài với output STREAM trực tiếp ra terminal của caller.
 *
 * `spawnSync` trong `exec` giữ toàn bộ output trong pipe cho tới khi lệnh kết
 * thúc — với `pulumi up` (build image home có thể mất vài phút) người dùng nhìn
 * màn hình đứng im rồi mới thấy kết quả. Ở đây `stdio: 'inherit'` cho stdout:
 * tiến trình Pulumi tự vẽ progress và terminal của developer thấy ngay từng
 * bước. stderr vẫn bắt về chuỗi — thông điệp lỗi phải vào error thrown, không
 * trôi qua console giữa chừng. Stdout không còn capture được, nên hàm này
 * KHÔNG trả stdout — chỉ dùng cho lệnh mà caller không cần đọc output.
 *
 * `label` là tên lệnh xuất hiện trong thông báo lỗi — caller phải truyền
 * subcommand thật (`up`, `preview`...), KHÔNG suy từ `args[0]`: qua `pulumiRun`
 * thì `args[0]` luôn là `--stack`, và lỗi `pulumi --stack thất bại` mất đúng
 * thông tin cần nhất khi debug.
 */
export function execStreaming(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  label = command,
): void {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'inherit', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (result.status === null) {
      throw new Error(`${command} ${label} không chạy được: ${describeSpawnFailure(result)}`);
    }
    throw new Error(`${command} ${label} thất bại:\n${result.stderr ?? ''}`);
  }
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
    // `pathToFileURL` chứ không phải nối chuỗi: `PULUMI_BACKEND_URL` là URL thật
    // mà Pulumi CLI parse — path chứa `%`, space hay là drive Windows (`C:\...`)
    // bị nối chuỗi sẽ parse sai hoặc lỗi ngay, tệ hơn là backend trỏ sang thư
    // mục khác. Trên POSIX không dấu, `pathToFileURL(...).href` cho cùng
    // `file://<root>` nên hành vi hiện tại không đổi.
    stateUrl: pathToFileURL(localStateDir(worktreeRoot)).href,
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
  // Chuỗi RỖNG không được coi là "đã cung cấp" (PU6: passphrase rỗng là giá trị
  // hợp lệ với Pulumi — chấp nhận nó là fail-open: state bị mã hoá bằng khoá
  // rỗng mà ai cũng giải được). `export VAR=` ở shell hay CI set biến rỗng đều
  // rơi vào đây — coi như chưa set để rơi tiếp xuống `_FILE`, rồi mới báo lỗi.
  // CÙNG tiêu chí cho cả hai biến: `_FILE` chỉ kiểm `typeof` thì `export
  // PULUMI_CONFIG_PASSPHRASE_FILE=` vẫn bị coi là đã cung cấp, pulumiEnv xoá
  // biến inline và để lại `_FILE=''` — CLI coi rỗng là chưa set và fail với
  // thông báo chung chung, mất đúng thông điệp hành động của helper này.
  const inline = process.env.PULUMI_CONFIG_PASSPHRASE;
  if (typeof inline === 'string' && inline.length > 0) {
    return { passphrase: inline, fromFile: false };
  }
  const passphraseFile = process.env.PULUMI_CONFIG_PASSPHRASE_FILE;
  if (typeof passphraseFile === 'string' && passphraseFile.length > 0) {
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
 * redact secret trong stderr/stdout của nó, và message chỉ echo *lệnh*, không
 * echo giá trị arg sau `--secret`).
 *
 * `ensureStack` chỉ chạy khi `prepareStack === true`: mặc định là KHÔNG đụng
 * state — lệnh `destroy`/`stack output` kiểu "đọc/teardown" KHÔNG được tạo state
 * trên worktree chưa từng deploy (mkdir + stack init biến teardown thành
 * mutation là sai ngữ nghĩa). Lệnh mutation (`up`/`preview`/`config set`) truyền
 * `prepareStack: true`; caller của lệnh đọc/teardown chịu trách nhiệm tự xử lý
 * "chưa có gì để đọc/xoá".
 */
export function pulumiRun(
  projectDir: string,
  projectName: string,
  args: string[],
  ctx: LocalDeployContext,
  env: NodeJS.ProcessEnv,
  options: { prepareStack?: boolean; stream?: boolean } = {},
): string | undefined {
  const fullArgs = ['--stack', fullStackRef(projectName, ctx), ...args];
  if (options.prepareStack === true) {
    ensureStack(projectDir, projectName, ctx, env);
  }
  if (options.stream === true) {
    // `up`/`preview` chạy hàng phút (build image home) — stream progress ra
    // terminal thay vì giữ trong pipe đến khi xong. stdout không còn bắt được,
    // caller không được cần nó ở chế độ này. `args[0]` là subcommand thật
    // (`up`, `preview`...) — execStreaming dùng nó làm nhãn lỗi, vì `fullArgs[0]`
    // luôn là `--stack` và lỗi `pulumi --stack thất bại` không cho biết lệnh nào
    // hỏng.
    execStreaming('pulumi', fullArgs, projectDir, env, args[0] ?? 'pulumi');
    return undefined;
  }
  const run = exec('pulumi', fullArgs, projectDir, env);
  if (run.status !== 0) {
    if (run.status === null) {
      // spawnSync không chạy được process (ENOENT, EACCES) hoặc process bị
      // signal kill (OOM) — stdout/stderr rỗng, phải báo từ `error`/`signal`.
      throw new Error(`pulumi ${args[0] ?? ''} không chạy được: ${describeSpawnFailure(run)}`);
    }
    throw new Error(`pulumi ${args[0] ?? ''} thất bại:\n${run.stderr || run.stdout}`);
  }
  return run.stdout;
}
