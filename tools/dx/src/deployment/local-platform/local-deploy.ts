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
 * không sinh mật khẩu, không ghi `.env`, chỉ chạy được trên worktree đã apply ít
 * nhất một lần (prerequisite kiểm read-only, thiếu thì báo cách khắc phục).
 * Đường an toàn/dry-run của Nx/CI vẫn là target `provision` (provision-gate).
 *
 * Mọi lệnh Pulumi chạy qua context cô lập của `pulumi-context.ts`:
 * `PULUMI_BACKEND_URL` theo worktree + `--stack organization/<project>/<stack>`
 * tường minh — không `pulumi login`, không selected-stack toàn cục, hai worktree
 * deploy song song không đụng CLI state của nhau (kiểm thực nghiệm — docs
 * `04-platform-facts.md` §2.16 PU12–PU13).
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { dockerResourceName } from './../../local-runtime/deploy-namespace.js';
import { acquireLocalDeployLock } from './../../local-runtime/local-lock.js';
import {
  buildRootHost,
  LOCAL_ENV_OWNED_KEYS,
  POSTGRES_PASSWORD_ENV_KEY,
  ROOT_HOST_ENV_KEY,
} from './platform-outputs-contract.js';
import {
  exec,
  describeSpawnFailure,
  ensureStack,
  fullStackRef,
  chmodFilePrivate,
  localStateDir,
  pulumiEnv,
  pulumiRun,
  resolveContext,
  resolveLocalPassphrase,
  type ExecResult,
  type LocalDeployContext,
} from './pulumi-context.js';
import {
  localDeployTaskSequence,
  localDestroyStackOrder,
  LOCAL_LANE_TARGETS,
} from './local-deploy-graph.js';
import { ROOT_DIR } from '../../utils.js';

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

/** Key trong Pulumi stack config lưu mật khẩu PostgreSQL local. */
export const POSTGRES_PASSWORD_CONFIG_KEY = 'postgres:password';

/**
 * Sinh mật khẩu PostgreSQL cho stack local mới.
 *
 * `randomBytes` của `node:crypto` — nguồn ngẫu nhiên mật mã an toàn. KHÔNG
 * dùng `Math.random`, timestamp, hard-code hay giá trị đoán được: mật khẩu này
 * là superuser credential của database local, và tài liệu yêu cầu sinh ngẫu
 * nhiên bằng API mật mã an toàn.
 *
 * `base64url` → chỉ ký tự `A-Za-z0-9-_`, nên an toàn khi đặt trong file `.env`
 * (không cần quote) và khi truyền làm argument cho `pulumi config set`.
 */
export function generatePostgresPassword(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Sinh secret HMAC cho envelope internal `ecoma-internal-v1` hai chiều
 * auth <-> account.
 *
 * Cùng hình dạng giá trị với `generatePostgresPassword` (base64url 24 byte =
 * 32 ký tự — đủ độ dài tối thiểu 32 ký tự mà `config-validation.ts` của
 * account đòi). Tách tên riêng vì NGHĨA khác: đây là secret HMAC ứng dụng
 * (không phải credential database), và orchestration là nơi giữ bất biến
 * "auth và account nhận CÙNG giá trị" — sinh hai lần độc lập là mọi envelope
 * internal chết `bad_signature` lúc runtime.
 */
export function generateInternalHmacSecret(): string {
  return randomBytes(24).toString('base64url');
}

/** Kết quả đọc mật khẩu PostgreSQL từ stack config (nguồn sự thật canonical). */
export type PostgresPasswordLookup =
  | { state: 'found'; password: string }
  | { state: 'missing' }
  | { state: 'error'; detail: string };

/**
 * Đọc mật khẩu PostgreSQL từ stack config local.
 *
 * Config lưu **plaintext** (không `secure:`) — nên `pulumi config get` đọc
 * được mà không cần giải mã, và trả về giá trị rõ ràng. Đây là nguồn sự thật
 * canonical: `.env` chỉ là bản sao sinh ra từ đây.
 *
 * Phân biệt ba trạng thái thay vì hai: "chưa có key" (stack mới → được phép
 * sinh mật khẩu) khác "lỗi thật" (sai passphrase, backend hỏng → phải dừng,
 * không được sinh mật khẩu mới). Nhận diện sai ở đây là đúng loại lỗi khiến
 * Postgres bị khoá khỏi volume đã init.
 */
export function lookupPostgresPassword(result: ExecResult): PostgresPasswordLookup {
  if (result.status === 0) {
    const password = result.stdout.trim();
    if (password.length === 0) return { state: 'missing' };
    // Defense-in-depth: CLI `pulumi config get` trên 3.270 với đúng passphrase
    // trả về plaintext (không trả `[secret]`); masking `[secret]` chỉ xuất hiện
    // ở `pulumi config` (list) và ở Automation API (`stack output --json` không
    // `--show-secrets`, xem `@pulumi/pulumi@3.270.0` `automation/localWorkspace.js`).
    // Nhánh này vì vậy không đạt được qua đường gọi này, nhưng giữ lại để fail
    // loud nếu ever xuất hiện (vd. CLI đổi hành vi) thay vì dùng literal
    // `[secret]` làm password. Xem docs migration section để biết trigger thật.
    if (password === '[secret]') {
      return {
        state: 'error',
        detail:
          'Pulumi returned the `[secret]` masking string instead of the real password — the ' +
          'stack config is in a state where the real value cannot be read. Supply the ' +
          'correct passphrase via PULUMI_CONFIG_PASSPHRASE and retry; if it is still ' +
          'masked, see docs/services/local-platform/03-operations.md (section Migration ' +
          'legacy postgres:password).',
      };
    }
    return { state: 'found', password };
  }
  if (isConfigKeyMissing(result)) return { state: 'missing' };
  // KHÔNG nhúng raw stderr/stdout vào detail: stdout của `pulumi config get
  // postgres:password` khi lệnh exit 0 CHÍNH LÀ mật khẩu — nếu CLI đổi hành vi
  // exit-code, nhét raw output vào error string là đường leak thật (detail đi
  // vào console.error). Thay bằng thông điệp cố định + hướng dẫn người dùng tự
  // chạy lệnh để xem stderr gốc.
  return {
    state: 'error',
    detail:
      `pulumi config get failed (exit ${String(result.status)}). Run ` +
      `'pulumi config get ${POSTGRES_PASSWORD_CONFIG_KEY} --stack <stack-ref>' manually in ` +
      'deploys/platform-deploy to see the original stderr — the output of this command is ' +
      'not logged because it may contain the password.',
  };
}

/** Tình trạng volume PostgreSQL của namespace — quyết định được sinh mật khẩu mới không. */
export type PostgresVolumeProbe =
  | { state: 'absent' }
  | { state: 'present' }
  | { state: 'unknown'; detail: string };

/**
 * Kiểm volume PostgreSQL của namespace có tồn tại không.
 *
 * Sự tồn tại của volume là thứ DUY NHẤT biết "database đã được init bằng mật
 * khẩu nào" — stack config có thể mất (ví dụ `pulumi stack rm` xoá cả config
 * trong khi volume `retainOnDelete` còn lại), nhưng volume thì vẫn giữ mật
 * khẩu superuser cũ. Vì vậy khi config mất mà volume còn, KHÔNG được sinh mật
 * khẩu mới: mật khẩu mới không bao giờ khớp volume đó.
 *
 * Phân biệt "không có" với "không xác định được": lỗi Docker (daemon không
 * chạy, socket sai) không phải bằng chứng volume vắng mặt — coi nó là
 * "vắng mặt" sẽ sinh mật khẩu mới rồi khoá người dùng ra khỏi dữ liệu cũ.
 */
export function probePostgresVolume(
  volumeName: string,
  env: NodeJS.ProcessEnv,
): PostgresVolumeProbe {
  const result = exec('docker', ['volume', 'inspect', volumeName], ROOT_DIR, env);
  if (result.status === 0) return { state: 'present' };
  if (result.status === null) {
    return { state: 'unknown', detail: describeSpawnFailure(result) };
  }
  const combined = `${result.stderr}\n${result.stdout}`;
  if (/not found|no such volume/iu.test(combined)) return { state: 'absent' };
  const firstLine = combined
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return { state: 'unknown', detail: firstLine ?? 'unknown Docker error' };
}

/** Tên Nx project của các deploy unit — dùng cho stack ref đầy đủ và exec cwd. */
const PLATFORM_PROJECT = 'platform-deploy';
const HOME_PROJECT = 'home-deploy';
const BACKOFFICE_PROJECT = 'backoffice-deploy';
const ACCOUNT_PROJECT = 'account-deploy';
const AUTH_PROJECT = 'auth-deploy';

function projectDir(project: string): string {
  return join(ROOT_DIR, 'deploys', project);
}

/**
 * Ghi các key mà luồng này sở hữu vào `.env` của worktree mà KHÔNG đụng key khác.
 *
 * `.env` là artifact: nếu file không có thì tạo mới với đúng các key được ghi;
 * nếu có rồi thì chỉ thay dòng `KEY=...` của các key thuộc `LOCAL_ENV_OWNED_KEYS`,
 * mọi dòng khác giữ nguyên byte-for-byte.
 *
 * Chỉ key sở hữu được ghi — đây là ranh giới contract, không phải chi tiết
 * cài đặt: `values` do caller dựng và có thể vô tình mang key lạ, mà ghi đè một
 * key người dùng tự quản lý là mất dữ liệu không khôi phục được.
 */
export function upsertLocalEnv(
  worktreeRoot: string,
  values: Readonly<Record<string, string>>,
): { envPath: string } {
  const envPath = join(worktreeRoot, '.env');
  const owned = new Set<string>(LOCAL_ENV_OWNED_KEYS);
  const entries = Object.entries(values).filter(([key]) => owned.has(key));
  // Guard injection: giá trị chứa newline sẽ phá cấu trúc dòng của file khi ghi
  // (một giá trị nhiều dòng sinh ra các dòng env rác). `values` đến từ outputs
  // Pulumi được kiểm soát nên đây là fail-loud với input dị hình, không phải
  // đường xử lý bình thường.
  for (const [, value] of entries) {
    if (value.includes('\n') || value.includes('\r')) {
      throw new Error(
        'upsertLocalEnv: an owned key value contains a newline character (\\n/\\r) — ' +
          'refusing to write so the .env file structure is not corrupted.',
      );
    }
  }
  if (!existsSync(envPath)) {
    if (entries.length > 0) {
      writeFileSync(envPath, `${entries.map(([key, value]) => `${key}=${value}`).join('\n')}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
    } else {
      writeFileSync(envPath, '', { encoding: 'utf8', mode: 0o600 });
    }
    chmodFilePrivate(envPath, 0o600);
    return { envPath };
  }
  const content = readFileSync(envPath, 'utf8');
  // Bỏ phần tử rỗng CUỐI do file kết thúc bằng `\n`: giữ nó thì key được thêm
  // cuối sinh ra một dòng trống misplaced (`OTHER=keep\n\nROOT_HOST=…`) — các
  // phần tử rỗng Ở GIỮA dòng khác vẫn giữ nguyên vị trí như cũ.
  const linesFile = content.split('\n');
  const trailingEmpty = linesFile.length > 1 && linesFile[linesFile.length - 1] === '';
  const lines = trailingEmpty ? linesFile.slice(0, -1) : linesFile;
  // Merge theo vị trí: MỌI dòng `KEY=...` của một key sở hữu đều được cập nhật
  // (không chỉ dòng đầu) — nếu file lỡ có dòng trùng và dotenv parse last-wins
  // thì chỉ thay dòng đầu sẽ để lại giá trị cũ ở dòng sau. Không append thêm
  // dòng mới khi key đã xuất hiện (số lần nào cũng vậy). Dòng không thuộc key
  // sở hữu giữ nguyên byte-for-byte.
  const valueByKey = new Map(entries);
  const seen = new Set<string>();
  const next = lines.map((entry) => {
    const ownedKey = LOCAL_ENV_OWNED_KEYS.find((key) => entry.startsWith(`${key}=`));
    if (ownedKey === undefined) return entry;
    seen.add(ownedKey);
    const value = valueByKey.get(ownedKey);
    return value === undefined ? entry : `${ownedKey}=${value}`;
  });
  // Key sở hữu có trong `values` nhưng chưa xuất hiện trong file → thêm cuối một lần.
  for (const [key, value] of valueByKey) {
    if (!seen.has(key)) {
      next.push(`${key}=${value}`);
    }
  }
  writeFileSync(envPath, `${next.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodFilePrivate(envPath, 0o600);
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
    throw new Error(`Failed to parse platform stack outputs as JSON:\n${stdout}`);
  }
  const rawPort = outputs['traefikHostPort'];
  // Port đo được là số nguyên dương — một giá trị `undefined`/`0`/string lọt
  // qua đây sẽ sinh `fbi.com:NaN` ở smoke test, nên chặn tại nguồn.
  if (typeof rawPort !== 'number' || !Number.isInteger(rawPort) || rawPort <= 0) {
    throw new Error(
      `Invalid traefikHostPort output: ${JSON.stringify(rawPort)} — platform not fully up yet?`,
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
  'backoffice-up',
  'account-up',
  'auth-up',
  'smoke-https',
] as const;
export type DeployStep = (typeof DEPLOY_STEPS)[number];

/**
 * Ánh xạ step hard-coded ↔ task Nx của lane local — dữ liệu dẫn xuất cho
 * `runNxOrchestratedDeploy` và cho spec đối chiếu hai hình thái thứ tự.
 *
 * `DEPLOY_STEPS` không còn là nguồn thứ tự của đường chạy mới: nguồn thứ tự là
 * khai báo Nx (`dependsOn` trong package.json của từng deploy project), và bảng này chỉ
 * ánh xạ từng step cũ sang task tương đương để `pnpm dx local-deploy` qua Nx
 * giữ đúng hành vi 8 bước.
 */
export const STEP_TO_TASK: Readonly<Record<DeployStep, string>> = {
  'platform-up': 'platform-deploy:local-up',
  'read-outputs': 'platform-deploy:local-env',
  'update-env': 'platform-deploy:local-env',
  'home-up': 'home-deploy:local-up',
  'backoffice-up': 'backoffice-deploy:local-up',
  'account-up': 'account-deploy:local-up',
  'auth-up': 'auth-deploy:local-up',
  'smoke-https': 'platform-deploy:local-smoke',
};

/**
 * Kết quả tính lệnh orchestration Nx — hàm thuần, unit test được không cần Nx.
 */
export interface NxOrchestrationPlan {
  /** Lệnh chính (spawnSync sẽ chạy). */
  command: string;
  args: string[];
  cwd: string;
  /** Task theo topo thứ tự mà graph khai báo — bằng chứng đối chiếu với DEPLOY_STEPS. */
  taskSequence: string[];
}

/**
 * Dựng lệnh orchestration Nx cho lane local — HÀM THUẬN.
 *
 * `nx run-many` nhận `-p` (project) + `-t` (target) + `-c local`; thứ tự THỰC
 * THI do Nx suy từ `dependsOn` đã khai trong package.json của từng deploy project — lệnh
 * không liệt kê thứ tự, nó chỉ khoá tập task. `taskSequence` trong kết quả là
 * hình chiếu topology mà graph module suy lại từ chính khai báo đó, để:
 * (a) spec so khớp với `DEPLOY_STEPS` (bằng chứng hai hình thái tương đương),
 * (b) `--dry-run` in ra cho người đọc thấy chuỗi trước khi chạy thật.
 */
export function buildNxOrchestrationPlan(
  options: { skipSmoke?: boolean } = {},
  resolver: {
    taskSequence: () => ReturnType<typeof localDeployTaskSequence>;
    rootDir: string;
  } = { taskSequence: localDeployTaskSequence, rootDir: ROOT_DIR },
): NxOrchestrationPlan {
  const tasks = resolver.taskSequence();
  const filtered = options.skipSmoke ? tasks.filter((t) => t.target !== 'local-smoke') : tasks;
  const projects = [...new Set(filtered.map((t) => t.project))];
  const targets = [...new Set(filtered.map((t) => t.target))];
  return {
    command: process.execPath,
    args: [
      join(resolver.rootDir, 'node_modules/nx/dist/bin/nx.js'),
      'run-many',
      '-p',
      projects.join(','),
      '-t',
      targets.join(','),
      '-c',
      'local',
      // Nx tự thoát khi phát hiện vòng `nx` lồng nhau trong run-commands —
      // nhưng executor `nx:run-commands` chạy shell con, không phải `nx`, nên
      // cờ này chỉ là phòng thủ cho môi trường lạ.
      '--nx-bail',
    ],
    cwd: resolver.rootDir,
    taskSequence: filtered.map((t) => `${t.project}:${t.target}`),
  };
}

/**
 * Kiểm tra dữ liệu khai báo lane local TRƯỚC khi chạy — fail-closed không cần
 * Pulumi/Docker. Kẹt khai báo (`LocalLaneGraphError`) nổi ở đây với thông điệp
 * rõ thay vì giữa chừng một task Nx nào đó đỏ không rõ nguyên nhân.
 */
export function validateNxLaneDeclarations(): string[] {
  return localDeployTaskSequence().map((t) => `${t.project}:${t.target}`);
}

/**
 * Đường orchestration MỚI: chạy chuỗi task local qua Nx Task Graph.
 *
 * Thân `local-deploy` gọi hàm này thay vì `runApply` — logic từng bước sống
 * trong target Nx (`local-stack-step`), thứ tự sống trong khai báo `dependsOn`
 * của package.json của từng deploy project. `runApply` vẫn giữ nguyên như bản dự phòng có
 * kiểm (xem JSDoc của `localDeploy`) — không delete-before-replacement.
 *
 * Passphrase và lock vẫn do hàm này quản lý TRƯỚC khi bấm Nx: mỗi task con là
 * một process `local-stack-step` tự vào lại cùng lock (re-entrant theo nghĩa
 * các task chạy tuần tự nhờ dependsOn, không đụng nhau), nên không deadlock —
 * process cha giữ lock, process con phải chờ... KHÔNG: `local-lock` là lock
 * file đối chiếu PID, process con PID khác sẽ bị chặn vĩnh viễn. Vì vậy cha
 * KHÔNG giữ lock khi bấm Nx — từng step `up` tự lock/unlock trong process con
 * của nó (xem `runLocalStackStep`); khoảng giữa hai task không có mutation
 * nào của luồng này đang chạy. Trade-off đã biết: lock granularity của đường Nx
 * là TỪNG STEP `up`, yếu hơn legacy (giữ lock suốt apply) — hai luồng local-deploy
 * xen kẽ nhau ở mức task vẫn được tránh nhờ tuần tự hóa theo dependsOn trong
 * cùng một lần chạy, nhưng hai lần chạy Nx khác process có thể xen task giữa
 * chừng; chấp nhận được cho máy local một developer.
 */
/** Hình dạng tối thiểu của spawnSync mà orchestration cần — injectable cho test. */
export type NxSpawn = typeof spawnSync;

export function runNxOrchestratedDeploy(
  ctx: LocalDeployContext,
  options: { skipSmoke?: boolean } = {},
  spawn: NxSpawn = spawnSync,
): number {
  // Kẹt khai báo phải nổi TRƯỚC khi bấm Nx — fail-closed với nguyên nhân rõ.
  const sequence = validateNxLaneDeclarations();
  console.log('[local-deploy] lane local (Nx Task Graph):');
  for (const task of sequence) console.log(`  - ${task}`);

  const plan = buildNxOrchestrationPlan(options);
  console.log(`[local-deploy] ${plan.command} ${plan.args.join(' ')}`);

  // Passphrase: đảm bảo tồn tại TRƯỚC khi bấm Nx để các process con không cùng
  // đua tạo file (writeWorktreePassphrase đã nguyên tử, nhưng fail-early của
  // cha cho thông điệp tốt hơn lỗi giữa chừng task). resolveLocalPassphrase
  // throw trên worktree đã có state mà thiếu passphrase — bắt thành exit 1 với
  // nguyên nhân gốc in rõ, không để exception bắn qua tầng orchestration.
  let passphrase: ReturnType<typeof resolveLocalPassphrase>;
  try {
    passphrase = resolveLocalPassphrase(ctx.worktreeRoot, { create: true });
  } catch (error) {
    console.error(`[local-deploy] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (passphrase.kind === 'none') {
    console.error(
      '[local-deploy] could not resolve the passphrase for a worktree that already has ' +
        'state — supply PULUMI_CONFIG_PASSPHRASE and retry.',
    );
    return 1;
  }

  // `spawn` là biên INJECTABLE (cùng pattern với `exec` của pulumi-context):
  // mặc định là `spawnSync` thật; unit test cắm spy để chứng minh "không bấm nx"
  // mà không bao giờ chạy nx thật — một test mà spawn được Docker/Pulumi thật
  // là một test nguy hiểm, không phải bằng chứng.
  const run = spawn(plan.command, plan.args, {
    cwd: plan.cwd,
    encoding: 'utf8',
    env: { ...process.env },
    stdio: 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) {
    if (run.status === null) {
      console.error(
        `[local-deploy] nx run-many could not run: ${describeSpawnFailure({
          status: run.status,
          stdout: run.stdout ?? '',
          stderr: run.stderr ?? '',
          error: run.error,
          signal: run.signal,
        })}`,
      );
    } else {
      console.error(
        `[local-deploy] Nx Task Graph failed (exit ${run.status}) — the failing task and its stderr are printed above.`,
      );
    }
    return 1;
  }
  console.log('[local-deploy] Nx Task Graph finished — all local steps are green.');
  return 0;
}

/** Export cho spec + destroy: thứ tự destroy suy từ graph (nghịch của dependsOn). */
export const LOCAL_DESTROY_STACK_ORDER = localDestroyStackOrder;
/** Export cho spec + orchestration: tập target của lane local. */
export const LOCAL_LANE_TARGET_SET = LOCAL_LANE_TARGETS;

/** Hình dạng tùy chọn của luồng deploy local. */
export interface LocalDeployOptions {
  worktreeRoot?: string;
  /**
   * Chỉ preview — read-only tuyệt đối: không init state, không `config set`,
   * không sinh mật khẩu, không truyền `--config` (CLI lưu `--config` vào stack
   * config file kể cả ở `preview`), không ghi `.env`, không `up`/`destroy`.
   * Yêu cầu worktree đã apply ít nhất một lần. Mặc định false (apply thật).
   */
  previewOnly?: boolean;
  /** Bỏ qua smoke HTTPS ở cuối (dùng khi caller tự kiểm). */
  skipSmoke?: boolean;
  /**
   * Chạy đường orchestration hard-coded (`runApply`) thay vì Nx Task Graph.
   * Đường Nx là mặc định từ khi orchestration chuyển sang Task Graph; đường cũ
   * giữ lại làm escape hatch có chủ đích khi môi trường không chạy được Nx
   * (không xoá để không delete-before-replacement) — hai đường cùng một chuỗi
   * contract, spec khoá tính tương đương.
   */
  legacyApply?: boolean;
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
      `[local-deploy] ${label} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/**
 * Chuẩn bị mật khẩu PostgreSQL cho stack local.
 *
 * Nguồn sự thật CANONICAL là Pulumi stack config (`postgres:password`, lưu
 * plaintext). `.env` là bản sao sinh ra — xem `localDeploy`.
 *
 * Ba nhánh, theo thứ tự:
 *
 * 1. **Đã có trong config** → dùng lại nguyên giá trị. Không bao giờ sinh mới:
 *    sinh mới ở đây là đè mật khẩu đang dùng bởi volume đã init → Postgres
 *    không vào được dữ liệu cũ.
 * 2. **Chưa có trong config** → kiểm volume có tồn tại không:
 *    - Volume **có** → fail với lỗi có hướng dẫn hành động. Volume đã init
 *      bằng mật khẩu mà config không còn lưu (vd `pulumi stack rm` xoá config
 *      nhưng volume `retainOnDelete` còn lại) — sinh mật khẩu mới ở đây tạo ra
 *      một mật khẩu **không bao giờ khớp** volume đó, và người dùng bị khoá
 *      khỏi dữ liệu của chính mình.
 *    - Volume **không** → sinh mật khẩu ngẫu nhiên và ghi vào config.
 * 3. **Lỗi thật khi đọc config** (sai passphrase, backend hỏng) → fail, KHÔNG
 *    sinh mật khẩu mới: lỗi đó không phải bằng chứng "chưa có mật khẩu".
 */
export function resolvePostgresPassword(
  ctx: LocalDeployContext,
  env: NodeJS.ProcessEnv,
): { ok: true; password: string; generated: boolean } | { ok: false; error: string } {
  const lookup = lookupPostgresPassword(
    exec(
      'pulumi',
      [
        'config',
        'get',
        POSTGRES_PASSWORD_CONFIG_KEY,
        '--stack',
        fullStackRef(PLATFORM_PROJECT, ctx),
      ],
      projectDir(PLATFORM_PROJECT),
      env,
    ),
  );

  if (lookup.state === 'found') {
    return { ok: true, password: lookup.password, generated: false };
  }
  if (lookup.state === 'error') {
    return {
      ok: false,
      error:
        `Failed to read ${POSTGRES_PASSWORD_CONFIG_KEY} from stack config: ${lookup.detail}\n` +
        'Do not generate a new password when the existing one cannot be read — doing so ' +
        'would lock Postgres out of the initialized volume.',
    };
  }

  // Config không có mật khẩu — volume quyết định có được sinh mới không.
  const volumeName = dockerResourceName(ctx.namespace, 'postgres-volume');
  const volume = probePostgresVolume(volumeName, env);
  if (volume.state === 'present') {
    return {
      ok: false,
      error:
        `PostgreSQL volume ${volumeName} already exists but stack config has no ` +
        `${POSTGRES_PASSWORD_CONFIG_KEY}. The volume was initialized with a password that is ` +
        'no longer in config (usually because `pulumi stack rm` removed the config while the ' +
        '`retainOnDelete` volume remained). Generating a new password will NOT match this ' +
        'volume and every connection will get ' +
        '`password authentication failed`.\n' +
        'Remediation: restore the old password into stack config, or delete the volume to ' +
        'start over from empty data:\n' +
        `  pnpm dx local-destroy --remove-data   # DELETES data permanently — think twice\n` +
        `  pnpm dx local-deploy`,
    };
  }
  if (volume.state === 'unknown') {
    return {
      ok: false,
      error:
        `Cannot probe PostgreSQL volume ${volumeName}: ${volume.detail}\n` +
        'Do not generate a new password before confirming whether the volume exists — ' +
        'a generated password may not match the initialized volume.',
    };
  }

  const password = generatePostgresPassword();
  // Giá trị đi qua STDIN, không qua argv: argv của process khác đọc được qua
  // `/proc/<pid>/cmdline` (cùng user) và qua `ps` — mật khẩu local không cần
  // rò ra tới đó. `pulumi config set` đọc giá trị từ stdin khi không có
  // argument value (đo thật trên CLI 3.270), và `--raw` giữ nguyên giá trị
  // (không trim newline).
  //
  // `--plaintext` BẮT BUỘC: CLI 3.270 tự chặn giá trị "trông như secret"
  // (key `postgres:password` + giá trị ngẫu nhiên) với lỗi "looks like a
  // secret; rerun with --secret ... or --plaintext" và exit 1 — đo thật. Không
  // có cờ nào, `config set` fail và mật khẩu KHÔNG được lưu.
  const set = exec(
    'pulumi',
    [
      'config',
      'set',
      POSTGRES_PASSWORD_CONFIG_KEY,
      '--plaintext',
      '--raw',
      '--stack',
      fullStackRef(PLATFORM_PROJECT, ctx),
    ],
    projectDir(PLATFORM_PROJECT),
    env,
    { input: password },
  );
  if (set.status !== 0) {
    return {
      ok: false,
      error: `pulumi config set ${POSTGRES_PASSWORD_CONFIG_KEY} failed:\n${set.stderr}`,
    };
  }
  return { ok: true, password, generated: true };
}

/**
 * Sinh PEM PKCS#8 cho khoá ký ES256 của auth (Worker Secret `AUTH_SIGNING_KEY`).
 *
 * WebCrypto ở runtime local Node: `crypto.subtle.generateKey({ name:
 * 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])` rồi
 * `exportKey('pkcs8')` — đúng spec PKCS#8 mà `SigningKeyProvider.fromPem`
 * parse (`BEGIN PRIVATE KEY`). Khóa sinh MỖI LẦN GỌI; caller quyết định khi
 * nào gọi (một lần cho mỗi lần up auth trên namespace mới) và stack config
 * là nơi giữ nó ổn định giữa các lần deploy — JWKS đổi giữa chừng là mọi
 * token đã cấp không còn verify được.
 *
 * `forge` không được dùng; `node:crypto` là dependency duy nhất — cùng nguồn
 * với `generatePostgresPassword`.
 */
export async function generateEs256SigningKeyPem(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const derBase64 = Buffer.from(pkcs8).toString('base64');
  const lines = derBase64.match(/.{1,64}/gu) ?? [];
  return ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----', ''].join('\n');
}

/**
 * Luồng đầy đủ: platform → outputs → .env → home → smoke.
 *
 * Cả hai project được truyền `namespace:worktreeRoot` qua `--config` tại lúc
 * chạy — chương trình Pulumi không đọc `.env` do chính luồng này sinh ra
 * (không dependency cycle).
 */
export async function localDeploy(options: LocalDeployOptions = {}): Promise<number> {
  const ctx = resolveContext(options.worktreeRoot);

  console.log(`[local-deploy] worktree=${ctx.worktreeRoot} namespace=${ctx.namespace}`);

  // Passphrase local: sinh bởi công cụ và lưu ngoài Git, hoặc lấy từ môi
  // trường của developer nếu có. Developer KHÔNG cần tự đặt gì — nhưng nếu
  // môi trường đã có passphrase thì dùng của họ (stack cũ tạo bằng passphrase
  // đó vẫn giải được). Chi tiết vì sao Pulumi bắt buộc passphrase: xem
  // `resolveLocalPassphrase` trong `pulumi-context.ts`.
  const passphrase = resolveLocalPassphrase(ctx.worktreeRoot, {
    create: options.previewOnly !== true,
  });
  const env = pulumiEnv(ctx, passphrase);

  // Preview là nhánh READ-ONLY riêng — tách khỏi đường apply ngay từ đây để
  // không đường nào trong apply (ensureStack, config set, up) chạy nhầm khi
  // người dùng chỉ muốn preview, và ngược lại.
  if (options.previewOnly === true) {
    return runPreview(ctx, env);
  }

  // Đường apply: Nx Task Graph là mặc định — thứ tự sống trong khai báo
  // `dependsOn` của package.json của từng deploy project, từng bước chạy qua target
  // `local-stack-step`. Đường `runApply` (hard-coded) giữ lại làm escape hatch
  // tường minh (`legacyApply: true`) — cùng chuỗi contract, không xoá behavior
  // cũ cho tới khi đường mới thay thế đầy đủ trong cùng PR này.
  if (options.legacyApply !== true) {
    // Passphrase đã resolve (tạo nếu cần) trước khi bấm Nx; lock do từng task
    // con tự quản (xem JSDoc của `runNxOrchestratedDeploy`).
    return runNxOrchestratedDeploy(ctx, { skipSmoke: options.skipSmoke });
  }

  // Lock phối hợp host-wide với `local-cleanup`: deploy đang apply (Docker thay
  // đổi trong lúc up) và cleanup chạy cạnh nhau là race vào cùng daemon — cleanup
  // thấy container đang thiếu/chưa đủ labels rồi quyết định sai. Preview là
  // read-only, không cần lock.
  const lock = acquireLocalDeployLock();
  try {
    return await runApply(ctx, env, options);
  } finally {
    lock();
  }
}

/**
 * Phần APPLY của `localDeploy` — tách khỏi nhánh preview để lock bao đúng phần
 * mutate Docker, không bao phần read-only.
 */
async function runApply(
  ctx: LocalDeployContext,
  env: NodeJS.ProcessEnv,
  options: LocalDeployOptions = {},
): Promise<number> {
  const sharedConfigArgs = [
    '--config',
    `namespace:worktreeRoot=${ctx.worktreeRoot}`,
    // Key stack reference CŨ từng được ghi không prefix (`home-deploy:...`,
    // bag theo project) do một phiên bản trước của luồng này — xoá để stack
    // config không mang key chết mà người đọc tưởng đang được dùng.
    '--config',
    `home-deploy:platformStackRef=`,
  ];

  // 1. Chuẩn bị stack + mật khẩu PostgreSQL.
  //
  //    Thứ tự là bất biến: `ensureStack` (mkdir + `stack init`) phải chạy
  //    TRƯỚC khi `config get`/`config set` chạm vào stack — đọc config của
  //    stack chưa tồn tại là lỗi. Trước đây `ensureStack` nằm trong
  //    `pulumiRun` mặc định; khi mặc định đảo thành opt-in, mutation đầu tiên
  //    của luồng phải tự chuẩn bị.
  console.log('[local-deploy] platform up…');
  let postgresPassword: string;
  try {
    ensureStack(projectDir(PLATFORM_PROJECT), PLATFORM_PROJECT, ctx, env);

    // Mật khẩu PostgreSQL: đọc lại từ stack config (canonical), chỉ sinh mới
    // khi stack mới VÀ chưa có volume. Xem `resolvePostgresPassword`.
    const resolution = resolvePostgresPassword(ctx, env);
    if (!resolution.ok) {
      console.error(`[local-deploy] ${resolution.error}`);
      return 1;
    }
    postgresPassword = resolution.password;
    if (resolution.generated) {
      console.log(
        '[local-deploy] postgres:password generated randomly and stored in the local stack config.',
      );
    }
  } catch (error) {
    console.error(`[local-deploy] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  try {
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
  console.log('[local-deploy] reading platform outputs…');
  let outputs: { traefikHostPort: number; rootHost: string };
  try {
    outputs = readPlatformOutputs(projectDir(PLATFORM_PROJECT), ctx, env);
  } catch (error) {
    console.error(`[local-deploy] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  // 3. Cập nhật .env (chỉ key thuộc workflow).
  //
  //    `.env` nhận CÙNG giá trị mật khẩu đã lưu trong stack config — mật khẩu
  //    không được sinh lần thứ hai ở đây: hai nguồn lệch nhau là consumer đọc
  //    `.env` sẽ dùng mật khẩu khác với mật khẩu Postgres thật. Stack config là
  //    nguồn sự thật canonical; `.env` là bản sao sinh ra, khôi phục được từ
  //    config khi bị xoá.
  const { envPath } = upsertLocalEnv(ctx.worktreeRoot, {
    [ROOT_HOST_ENV_KEY]: outputs.rootHost,
    [POSTGRES_PASSWORD_ENV_KEY]: postgresPassword,
  });
  console.log(
    `[local-deploy] ${ROOT_HOST_ENV_KEY}=${outputs.rootHost} and ` +
      `${POSTGRES_PASSWORD_ENV_KEY} written to ${envPath}`,
  );

  // Mật khẩu hai role của db-backoffice — sinh ngẫu nhiên bằng API mật mã an toàn.
  const runtimeRolePassword = generatePostgresPassword();
  const migratorRolePassword = generatePostgresPassword();

  // Lưu hai mật khẩu vào stack config của backoffice qua stdin (KHÔNG qua argv)
  // — tránh rò mật khẩu ra process listing / output lỗi của pulumi (CodeQL
  // clear-text logging). Khớp pattern đã dùng cho postgres:password.
  ensureStack(projectDir(BACKOFFICE_PROJECT), BACKOFFICE_PROJECT, ctx, env);
  for (const [configKey, configValue] of [
    ['namespace:runtimePassword', runtimeRolePassword],
    ['namespace:migratorPassword', migratorRolePassword],
  ] as const) {
    const setResult = exec(
      'pulumi',
      [
        'config',
        'set',
        configKey,
        '--plaintext',
        '--raw',
        '--stack',
        fullStackRef(BACKOFFICE_PROJECT, ctx),
      ],
      projectDir(BACKOFFICE_PROJECT),
      env,
      { input: configValue },
    );
    if (setResult.status !== 0) {
      console.error(
        `[local-deploy] backoffice config set ${configKey} failed:\n${setResult.stderr}`,
      );
      return 1;
    }
  }

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

  // 4b. Backoffice up — image build + container + routing labels + DB provisioning.
  console.log('[local-deploy] backoffice up…');
  const backofficeOk = runProjectStep(
    'backoffice up',
    BACKOFFICE_PROJECT,
    [
      'up',
      '--yes',
      ...sharedConfigArgs,
      '--config',
      `namespace:platformStackRef=organization/platform-deploy/${ctx.stackName}`,
    ],
    ctx,
    env,
    { prepareStack: true, stream: true },
  );
  if (!backofficeOk) return 1;

  // 4c/4d. Account + auth up — DB isolation provisioning + migration (PR #181)
  //        + WIC container với secrets Worker của auth (PR #183).
  //
  // Secret HMAC hai chiều auth <-> account: sinh MỘT lần, trước vòng for, vì
  // vòng for xử lý account TRƯỚC auth mà cả hai stack đều cần CÙNG giá trị
  // (account: `NUXT_INTERNAL_HMAC_SECRET`; auth: `AUTH_INTERNAL_SECRET`) —
  // xem JSDoc chi tiết trong vòng for.
  const identityInternalSecret = generateInternalHmacSecret();
  //
  // Thứ tự account TRƯỚC auth là bất biến: cả hai stack guard-create role owner
  // dùng chung `ecoma_owner`, nhưng CHỈ account stack ALTER password của nó —
  // up auth trước trên cluster mới vẫn đúng (auth chỉ tạo khi thiếu), nhưng giữ
  // account trước làm chủ sở hữu password xuất hiện sớm nhất, và chiều revoke
  // chéo được đo lường trên cluster thật theo đúng thứ tự này. Với PR #183, thứ
  // tự này còn bảo đảm container account tồn tại trước khi WIC boot — shim
  // bridge trỏ alias DNS `ecoma-<ns>-account`, và readiness của auth đỏ một
  // cách fail-closed (không crash) nếu upstream chưa sẵn sàng trong cửa sổ up.
  for (const [stepLabel, project] of [
    ['account up', ACCOUNT_PROJECT],
    ['auth up', AUTH_PROJECT],
  ] as const) {
    // Mật khẩu role của từng stack — sinh ngẫu nhiên bằng API mật mã an toàn.
    // Account stack có mật khẩu owner (nó SỞ HỮU `ecoma_owner`); auth stack
    // guard-create owner khi thiếu nhưng không bao giờ ALTER password.
    //
    // Secret HMAC hai chiều auth <-> account (PR #183): sinh MỘT giá trị
    // TRƯỚC vòng for, rồi set cho CẢ HAI stack — account nhận làm
    // `NUXT_INTERNAL_HMAC_SECRET`, auth nhận làm `AUTH_INTERNAL_SECRET`. Hai
    // stack nhận hai giá trị khác nhau là mọi envelope internal bị từ chối
    // `bad_signature` lúc runtime — bất biến "cùng secret" thuộc về
    // orchestration, không stack nào tự kiểm được.
    //
    // ⚠️ Mảng literal NỘI TUYẾN trong for-of, không tách biến: CodeQL
    // `js/clear-text-logging` coi mọi dữ liệu phái sinh từ một biến tên
    // `*password*` là taint sống tới sink `console.*` — kể cả `configKey`, phần
    // TÊN của key chứ không phải giá trị, khiến dòng báo lỗi `config set <key>`
    // bị flag (code-scanning alert #4) dù stderr của pulumi không chứa mật khẩu
    // (giá trị đi qua stdin). Khối backoffice phía trên cùng hình dạng nhưng
    // không bị flag đúng vì mảng của nó là literal inline. Giữ nguyên hình dạng
    // đó; giá trị vẫn CHỈ đi qua stdin.
    ensureStack(projectDir(project), project, ctx, env);
    for (const [configKey, configValue] of project === ACCOUNT_PROJECT
      ? ([
          ['namespace:ownerPassword', generatePostgresPassword()],
          ['namespace:runtimePassword', generatePostgresPassword()],
          ['namespace:migratorPassword', generatePostgresPassword()],
          ['namespace:prunerPassword', generatePostgresPassword()],
          // Secret HMAC của app account (container local #182): cùng độ dài tối
          // thiểu 32 ký tự mà `config-validation.ts` đòi (validateAccountConfig
          // fail-closed ở request đầu nếu ngắn hơn) — base64url 24 bytes đủ dài.
          // CÙNG giá trị với `namespace:internalSecret` của auth stack ở nhánh
          // kia — xem JSDoc của khối này.
          ['namespace:internalHmacSecret', identityInternalSecret],
          ['namespace:otpHmacSecret', generatePostgresPassword()],
        ] as const)
      : ([
          ['namespace:runtimePassword', generatePostgresPassword()],
          ['namespace:migratorPassword', generatePostgresPassword()],
          ['namespace:prunerPassword', generatePostgresPassword()],
          // Secrets Worker của auth (WIC #183) — cùng TÊN BIẾN với Worker
          // Secrets production; wrangler dev map env process vào secrets của
          // worker. `signingKeyPem`: PKCS#8 ES256 sinh lúc deploy, giữ ổn định
          // qua các lần deploy trong đời namespace (JWKS đổi là mọi token đã
          // cấp chết); `handleKey`: 32 byte base64url (domain lib bắt chính xác
          // 32 byte); `cookieKeys`: một key base64url 32 byte (keygrip — key
          // đầu ký, spin sau thêm key verify ở cuối chuỗi). Không set
          // `AUTH_INTERNAL_KID`/`AUTH_INTERNAL_PREVIOUS_*`: local không xoay
          // secret — thiếu các biến này là trạng thái hợp lệ (envelope không
          // kid; config.ts chấp nhận tường minh).
          ['namespace:signingKeyPem', await generateEs256SigningKeyPem()],
          ['namespace:signingKeyId', 'local-identity-1'],
          ['namespace:handleKey', generatePostgresPassword()],
          ['namespace:internalSecret', identityInternalSecret],
          ['namespace:issuer', `https://auth.${outputs.rootHost}`],
          ['namespace:audience', `https://api.${outputs.rootHost}`],
          ['namespace:cookieKeys', generatePostgresPassword()],
        ] as const)) {
      const setResult = exec(
        'pulumi',
        ['config', 'set', configKey, '--plaintext', '--raw', '--stack', fullStackRef(project, ctx)],
        projectDir(project),
        env,
        { input: configValue },
      );
      if (setResult.status !== 0) {
        console.error(
          `[local-deploy] ${project} config set ${configKey} failed:\n${setResult.stderr}`,
        );
        return 1;
      }
    }

    console.log(`[local-deploy] ${stepLabel}…`);
    const upOk = runProjectStep(
      stepLabel,
      project,
      [
        'up',
        '--yes',
        ...sharedConfigArgs,
        '--config',
        `namespace:platformStackRef=organization/platform-deploy/${ctx.stackName}`,
      ],
      ctx,
      env,
      { prepareStack: true, stream: true },
    );
    if (!upOk) return 1;
  }

  // 5. Smoke HTTPS qua Traefik với certificate local.
  if (options.skipSmoke !== true) {
    const smoke = exec(
      'node',
      [join(ROOT_DIR, 'tools/dx/src/deployment/local-platform/local-smoke.mjs'), outputs.rootHost],
      ROOT_DIR,
      process.env,
    );
    if (smoke.status !== 0) {
      console.error(`[local-deploy] smoke HTTPS failed:\n${smoke.stdout}\n${smoke.stderr}`);
      return 1;
    }
    console.log(`[local-deploy] smoke OK: https://${outputs.rootHost}/`);
  }

  console.log(
    `[local-deploy] done — open https://${outputs.rootHost}/ ` +
      `(the local certificate must be trusted manually on the developer machine).`,
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
 *    mật khẩu, không `config set`, không ghi `.env`, không `up`/`destroy`.
 * 2. KHÔNG truyền `--config` cho `pulumi preview`: CLI 3.x **lưu** `--config`
 *    vào stack config file kể cả khi preview (đo từ `pulumi preview --help`:
 *    "Config to use during the preview and save to the stack config file") —
 *    truyền nó là mutation cấu hình giữa chừng một lệnh read-only. Mọi key mà
 *    chương trình cần (`namespace:worktreeRoot`, `namespace:platformStackRef`,
 *    `postgres:password`) đã do apply lưu vào stack config ở lần chạy
 *    trước — preview chỉ đọc lại.
 * 3. Prerequisite kiểm READ-ONLY trước khi chạy lệnh nào: state dir tồn tại,
 *    platform stack đã up (outputs thật — home đọc qua StackReference), home
 *    stack tồn tại. Thiếu → báo đúng thiếu gì kèm cách khắc phục (`pnpm dx
 *    local-deploy`) và trả 1 — không tự khởi tạo gì để "giúp" preview xanh.
 *
 * Passphrase: `localDeploy` đã giải quyết trước khi gọi hàm này
 * (`resolveLocalPassphrase` — do công cụ quản lý, developer không tự đặt).
 * `preview` nạp stack config (PU4) nên vẫn chạy với passphrase đó. Mọi lệnh
 * chạy với `prepareStack: false`.
 */
function runPreview(ctx: LocalDeployContext, env: NodeJS.ProcessEnv): number {
  console.log('[local-deploy] preview (read-only) — checking prerequisites…');

  // State dir là chính bằng chứng "worktree đã từng deploy" và backend `file://`
  // cũng đòi thư mục tồn tại trước (PU11). Check bằng chứng PHẢI chạy trước:
  // thiếu thì báo đúng contract thay vì để CLI fail chung chung.
  if (!existsSync(localStateDir(ctx.worktreeRoot))) {
    console.error(
      `[local-deploy] preview: this worktree has never deployed (no .pulumi-local-state) — ` +
        'preview is read-only and will NOT initialize state/stack/secret. Run `pnpm dx ' +
        'local-deploy` (apply) first before previewing.',
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
        '[local-deploy] preview: no platform stack in the backend — preview does not ' +
          'init stacks. Run `pnpm dx local-deploy` first.',
      );
      return 1;
    case 'no-outputs':
      console.error(
        '[local-deploy] preview: the platform stack exists but has never been up (outputs ' +
          'empty) — nothing to preview yet. Run `pnpm dx local-deploy` (apply) first.',
      );
      return 1;
    case 'backend-error':
    case 'parse-error':
      console.error(
        `[local-deploy] preview: Pulumi/backend error reading platform: ${platform.detail}`,
      );
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
    console.error(`[local-deploy] preview: Pulumi/backend error reading home: ${homeCheck.detail}`);
    return 1;
  }
  if (homeCheck.state === 'no-stack') {
    console.error(
      '[local-deploy] preview: no home stack — the worktree has not been fully applied. Run `pnpm dx ' +
        'local-deploy` (apply) first; preview does NOT create stacks.',
    );
    return 1;
  }

  const backofficeCheck = classifyStackOutput(
    exec(
      'pulumi',
      ['stack', 'output', '--json', '--stack', fullStackRef(BACKOFFICE_PROJECT, ctx)],
      projectDir(BACKOFFICE_PROJECT),
      env,
    ),
  );
  if (backofficeCheck.state === 'backend-error' || backofficeCheck.state === 'parse-error') {
    console.error(
      `[local-deploy] preview: Pulumi/backend error reading backoffice: ${backofficeCheck.detail}`,
    );
    return 1;
  }
  if (backofficeCheck.state === 'no-stack') {
    console.error(
      '[local-deploy] preview: no backoffice stack — the worktree has not been fully applied. Run `pnpm dx ' +
        'local-deploy` (apply) first; preview does NOT create stacks.',
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
      '[local-deploy] home preview failed — platform WAS previewed, home was NOT previewed ' +
        '(nothing was applied). See the pulumi error above; if the home stack is missing ' +
        '`namespace:platformStackRef` config, run `pnpm dx local-deploy` (apply) first.',
    );
    return 1;
  }

  console.log('[local-deploy] backoffice preview…');
  const backofficeOk = runProjectStep(
    'backoffice preview',
    BACKOFFICE_PROJECT,
    ['preview'],
    ctx,
    env,
    {
      prepareStack: false,
    },
  );
  if (!backofficeOk) {
    console.error(
      '[local-deploy] backoffice preview failed — platform/home WERE previewed, backoffice was NOT previewed ' +
        '(nothing was applied). See the pulumi error above.',
    );
    return 1;
  }

  console.log(
    '[local-deploy] preview done (platform + home) — read-only: no apply, no writes to ' +
      'state/config/.env, no Docker interaction.',
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
 * Destroy KHÔNG dùng `--remove`: xoá stack sẽ xoá cả CONFIG — trong đó có
 * `postgres:password` — trong khi volume (với superuser được khởi tạo bằng mật
 * khẩu CŨ) vẫn được giữ lại. Deploy kế tiếp trên stack mới sẽ không có mật
 * khẩu để sinh (volume còn, config mất) và phải fail với lỗi có hướng dẫn,
 * thay vì sinh mật khẩu mới không bao giờ khớp volume cũ. Giữ stack (chỉ rỗng
 * resource) là cách hai nửa — mật khẩu trong config, dữ liệu trong volume —
 * luôn cùng tuổi.
 */
export function localDestroy(options: { worktreeRoot?: string; removeData?: boolean }): number {
  const ctx = resolveContext(options.worktreeRoot);
  const volumeName = dockerResourceName(ctx.namespace, 'postgres-volume');

  // Teardown trên worktree CHƯA TỪNG deploy phải là no-op idempotent, không
  // phải mutation — và phải đứng TRƯỚC cả việc tạo passphrase: tạo file
  // passphrase cho một worktree chưa có gì để xoá là mutation vô nghĩa.
  // `ensureStack` với `mkdir` + `stack init` sẽ TẠO state mới chỉ để
  // destroy nó (và home destroy còn fail vì config `platformStackRef` chưa
  // từng được ghi). State dir chưa tồn tại = chắc chắn chưa có gì để xoá.
  if (!existsSync(localStateDir(ctx.worktreeRoot))) {
    console.log(
      `[local-deploy] this worktree has never deployed (no ${'.pulumi-local-state'}) — destroy is a no-op.`,
    );
    return 0;
  }

  // Passphrase: worktree đã deploy thì đã có file passphrase (do `local-deploy`
  // tạo) hoặc passphrase của developer trong môi trường. Không có cả hai thì
  // báo lỗi rõ ràng — `destroy` nạp stack config nên không có passphrase là CLI
  // exit 1 giữa chừng (home đã destroy nhưng platform chưa).
  const passphrase = resolveLocalPassphrase(ctx.worktreeRoot, { create: false });
  if (passphrase.kind === 'none') {
    console.error(
      '[local-destroy] No passphrase found for the local stack of this worktree. ' +
        'The worktree was deployed with the developer passphrase — supply it again via ' +
        '`PULUMI_CONFIG_PASSPHRASE` (or `PULUMI_CONFIG_PASSPHRASE_FILE`) to destroy.',
    );
    return 1;
  }
  const env = pulumiEnv(ctx, passphrase);

  // Lock host-wide chia sẻ với `local-deploy`/`local-cleanup`: destroy biến đổi
  // Docker (xoá container/network/volume) nên không được chạy đồng thời với apply
  // hay cleanup vào cùng daemon. No-op (worktree chưa deploy) và kiểm tra
  // passphrase đã trả về ở TRÊN — lock chỉ bao phần mutate thật.
  const lock = acquireLocalDeployLock();
  try {
    return runDestroySteps(ctx, volumeName, env, options);
  } finally {
    lock();
  }
}

/** Phần MUTATE của `localDestroy` — tách để lock bao đúng phần teardown thật. */
function runDestroySteps(
  ctx: LocalDeployContext,
  volumeName: string,
  env: NodeJS.ProcessEnv,
  options: { worktreeRoot?: string; removeData?: boolean },
): number {
  // Thứ tự destroy = NGHỊCH của đồ thị `dependsOn` local-up (dependents trước,
  // platform CUỐI) — suy từ chính khai báo Nx thay vì liệt kê tay: thêm/bớt unit
  // hay đổi thứ tự up là thứ tự destroy đổi theo, không có hai nguồn thứ tự lệch
  // nhau. Kẹt khai báo (chu trình, thiếu target) fail-closed ở đây với thông điệp
  // rõ. Kết quả là 5 stack theo đúng dependency nghịch:
  // auth → account → backoffice → home → platform.
  const destroyOrder = localDestroyStackOrder();
  console.log(`[local-deploy] destroy order (reverse of dependsOn): ${destroyOrder.join(' → ')}`);

  let allOk = true;
  for (const project of destroyOrder) {
    console.log(`[local-deploy] ${project} destroy…`);
    const ok = runProjectStep(
      `${project} destroy`,
      project,
      ['destroy', '--yes', '--config', `namespace:worktreeRoot=${ctx.worktreeRoot}`],
      ctx,
      env,
      { prepareStack: false },
    );
    if (!ok) allOk = false;
  }

  // Destroy KHÔNG dùng `--remove`: xoá stack sẽ xoá cả CONFIG — trong đó có
  // `postgres:password` — trong khi volume (với superuser được khởi tạo bằng mật
  // khẩu CŨ) vẫn được giữ lại. Deploy kế tiếp trên stack mới sẽ không có mật
  // khẩu để sinh (volume còn, config mất) và phải fail với lỗi có hướng dẫn,
  // thay vì sinh mật khẩu mới không bao giờ khớp volume cũ. Giữ stack (chỉ rỗng
  // resource) là cách hai nửa — mật khẩu trong config, dữ liệu trong volume —
  // luôn cùng tuổi.
  //
  // Destroy của stack KHÔNG chặn bước xoá volume khi người dùng yêu cầu
  // `--remove-data`: lời hứa của lệnh là XOÁ dữ liệu — nếu stack Pulumi đã
  // biến mất (`pulumi stack rm` ngoài luồng, state hỏng, "no stack named"…)
  // thì destroy stack coi như đã xong phần đó, và bước xoá volume vẫn phải chạy.
  // Với lỗi Pulumi khác (daemon down, sai passphrase…), cũng tiếp tục tới volume
  // theo yêu cầu `--remove-data` nhưng báo rõ để người dùng biết destroy stack
  // chưa trọn. Không `--remove-data`: lỗi thật → exit 1, không đụng volume.
  const destroyFailed = !allOk;
  if (destroyFailed && options.removeData !== true) {
    return 1;
  }
  if (destroyFailed && options.removeData === true) {
    console.error(
      '[local-deploy] Pulumi destroy did not complete (stderr above) — continuing to ' +
        'delete the volume as requested by --remove-data. Resources left in state (if any) ' +
        'are not cleaned up; re-check manually.',
    );
  }

  if (options.removeData === true) {
    console.warn(
      `[local-deploy] WARNING: deleting PostgreSQL volume ${volumeName} — the local database ` +
        `data of this worktree will be permanently lost.`,
    );
    const vol = exec('docker', ['volume', 'rm', volumeName], ROOT_DIR, process.env);
    if (vol.status !== 0) {
      console.error(
        `[local-deploy] volume deletion failed (it may already be gone):\n${vol.stderr}`,
      );
      return 1;
    }
    console.log(`[local-deploy] volume ${volumeName} deleted.`);
  } else {
    console.log(
      `[local-deploy] PostgreSQL volume ${volumeName} KEPT (data intact). ` +
        `To delete it: run again with --remove-data.`,
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
      detail: `pulumi could not run: ${describeSpawnFailure(result)}`,
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
  return { state: 'backend-error', detail: firstLine ?? 'unknown Pulumi error' };
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
  console.log(`backoffice:     ${dockerResourceName(ctx.namespace, 'backoffice')}`);

  const envPath = join(ctx.worktreeRoot, '.env');
  if (existsSync(envPath)) {
    const line = readFileSync(envPath, 'utf8')
      .split('\n')
      .find((entry) => entry.startsWith(`${ROOT_HOST_ENV_KEY}=`));
    if (line !== undefined) console.log(`.env ${ROOT_HOST_ENV_KEY}:  ${line.split('=')[1]}`);
    // KHÔNG in `POSTGRES_PASSWORD` — `local-status` là lệnh hay được chạy và
    // paste output vào ticket/chat. Chỉ báo **có** mặt hay không.
    const hasPassword = readFileSync(envPath, 'utf8')
      .split('\n')
      .some((entry) => entry.startsWith(`${POSTGRES_PASSWORD_ENV_KEY}=`));
    console.log(`.env ${POSTGRES_PASSWORD_ENV_KEY}: ${hasPassword ? 'set' : 'not set'}`);
  }

  // Passphrase: dùng file của worktree nếu có, không thì biến môi trường.
  // `create: false` — `local-status` là read-only, không được tạo file
  // passphrase. Không có passphrase thì vẫn chạy được: `pulumi stack output`
  // đọc outputs mà KHÔNG cần giải mã (đo thật trên CLI 3.270 — khác với
  // `up`/`preview`/`destroy` vốn phải nạp stack config đầy đủ).
  const passphrase = resolveLocalPassphrase(ctx.worktreeRoot, { create: false });
  const env = pulumiEnv(ctx, passphrase);

  const status = queryPlatformStatus(ctx, env);
  switch (status.state) {
    case 'no-stack': {
      console.log('platform:       no stack in the backend — run pnpm dx local-deploy');
      return 0;
    }
    case 'no-outputs': {
      console.log(
        'platform:       stack exists but has never been up (outputs empty) — run pnpm dx local-deploy',
      );
      return 0;
    }
    case 'deployed': {
      console.log(`platform outputs: ${JSON.stringify(status.outputs)}`);
      return 0;
    }
    case 'parse-error': {
      console.error(`[local-status] failed to parse platform outputs as JSON: ${status.detail}`);
      return 1;
    }
    case 'backend-error': {
      console.error(`[local-status] Pulumi/backend error: ${status.detail}`);
      return 1;
    }
  }
}

/** Keys mà luồng này sở hữu — export để test và để review chặn đè key lạ. */
export const OWNED_ENV_KEYS: readonly string[] = LOCAL_ENV_OWNED_KEYS;
