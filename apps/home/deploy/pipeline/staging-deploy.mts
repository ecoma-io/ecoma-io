/**
 * Runner của job `deploy` trong workflow staging (`home-staging.yaml`).
 *
 * Job này là job **duy nhất giữ Cloudflare credentials** (GitHub Environment
 * `staging` → `CLOUDFLARE_API_TOKEN`). Nó chạy sau khi artifact đã được build
 * bởi job secret-free, nên toàn bộ quyết định an toàn được tập trung ở đây
 * theo thứ tự fail-closed:
 *
 * 1. **Manifest check** — artifact build phải khai đúng SHA và worker name
 *    mà run này thấy (nếu không, artifact là của run khác).
 * 2. **Stale-run guard** — re-check ngay trước `wrangler deploy`: còn run
 *    staging khác đang chạy cho revision mới hơn/không thứ tự được thì
 *    nhường (`skip`) hoặc abort (`abort`).
 * 3. **Deploy** — `wrangler deploy --env staging` với artifact đã tải.
 * 4. **Smoke** — assertion HTTP thật trên `https://ecoma.io.vn`.
 * 5. **Evidence** — ghi status `home/staging-verified` = success/failure trên
 *    ĐÚNG SHA của run; cả hai nhánh đều ghi để lộ lịch sử verification.
 *
 * Mode `tag` (chạy trong job riêng có `contents: write`, sau khi job deploy
 * thành công) tạo tag release `@ecoma-io/home@{version}` trên SHA đã verify.
 * Đây là đường duy nhất trong pipeline tạo tag, và nó nằm **sau** staging
 * verification (task §3: không tag trước khi staging pass; SHA được tag luôn
 * là SHA đã deploy staging — release commit luôn nằm trong tập affected của
 * home nên SHA được deploy = SHA sẽ được tag).
 *
 * Exit code: 0 = mọi bước của mode đã pass; 1 = fail với lý do in ra stderr.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';

import {
  createCommitStatus,
  getCommitStatus,
  listWorkflowRuns,
  type GithubFetchOptions,
} from './github-run';
import { evaluateStaleGuard, type CompetingRun } from './runner-guard';
import { runSmokeChecks } from './smoke-check';
import { buildReleaseTag, readHomeVersion } from './release-tag';

/** Bằng chứng gắn trong artifact build (xem script `build` của workflow). */
export type BuildManifest = {
  /** SHA nguồn mà artifact được build từ — phải khớp `workflow_run.head_sha`. */
  readonly sourceSha: string;
  /** Version đọc từ `apps/home/package.json` tại SHA đó. */
  readonly version: string;
  /** Worker name mà env staging sẽ deploy lên. */
  readonly workerName: string;
};

type Mode = 'deploy' | 'tag';

function fail(message: string): never {
  console.error(`[staging] FAIL: ${message}`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    fail(`missing required environment variable ${name}`);
  }
  return value as string;
}

/** Ghi output machine-readable cho caller qua `$GITHUB_OUTPUT` convention. */
function emitOutput(key: string, value: string): void {
  const file = process.env['GITHUB_OUTPUT'];
  if (file) {
    writeFileSync(file, `${key}=${value}\n`, { flag: 'a' });
  } else {
    console.log(`${key}=${value}`);
  }
}

function runUrl(runId: number, repo: string): string {
  const server = process.env['GITHUB_SERVER_URL'];
  return server ? `${server}/${repo}/actions/runs/${runId}` : '';
}

// --- CLI arg parsing — mode duy nhất, không flag phức tạp ---
const mode = process.argv[2] as Mode | undefined;
if (mode !== 'deploy' && mode !== 'tag') {
  fail('usage: tsx staging-deploy.mts <deploy|tag>');
}

const headSha = requireEnv('HEAD_SHA');
const runId = Number(requireEnv('RUN_ID'));
if (!Number.isInteger(runId) || runId <= 0) {
  fail(`RUN_ID must be a positive integer, got "${process.env['RUN_ID']}"`);
}
// Chỉ mode deploy tiêu thụ artifact — job tag không tải artifact nên không
// có biến này (xem khối manifest bên dưới).
const artifactDir = mode === 'deploy' ? requireEnv('ARTIFACT_DIR') : '';
const repo = requireEnv('GITHUB_REPOSITORY');
const ghToken = requireEnv('GH_TOKEN');
const gh: GithubFetchOptions = { ghToken, repo };

const CONTEXT = 'home/staging-verified';
const STAGING_ORIGIN = 'https://ecoma.io.vn';
const STAGING_WORKER_NAME = 'stg-ecoma-home';
const WORKFLOW_FILE_NAME = 'home-staging.yaml';
const BRANCH = 'main';
const PROJECT_NAME = '@ecoma-io/home';

// --- Bước chung: đọc manifest của artifact và khớp với run ---
//
// Mode `deploy` cần artifact (thứ sẽ được wrangler deploy); mode `tag` chỉ
// cần version — đọc trực tiếp từ checkout của SHA đã verify (job tag không
// tải artifact, không có `ARTIFACT_DIR`, và version phải là version của
// commit được tag chứ không phải của một artifact nào đó).
const manifestPath = `${artifactDir}/build-manifest.json`;
let manifest: BuildManifest;
if (mode === 'deploy') {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BuildManifest;
  } catch (error) {
    fail(`cannot read build manifest at ${manifestPath}: ${String(error)}`);
  }
  if ((manifest as BuildManifest).sourceSha !== headSha) {
    fail(
      `build manifest declares sourceSha ${(manifest as BuildManifest).sourceSha} but this run is for ${headSha} — artifact does not belong to this run`,
    );
  }
  if ((manifest as BuildManifest).workerName !== STAGING_WORKER_NAME) {
    fail(
      `build manifest declares worker "${(manifest as BuildManifest).workerName}", expected "${STAGING_WORKER_NAME}" — refusing to deploy to an unknown identity`,
    );
  }
} else {
  const packageJsonText = readFileSync('apps/home/package.json', 'utf8');
  manifest = {
    sourceSha: headSha,
    version: readHomeVersion(packageJsonText),
    workerName: STAGING_WORKER_NAME,
  };
}
const verifiedManifest = manifest as BuildManifest;

if (mode === 'tag') {
  // --- Job tag: chỉ chạy sau khi job deploy đã ghi status success ---
  const status = await getCommitStatus(headSha, CONTEXT, gh);
  if (!status) {
    fail(`no ${CONTEXT} status on ${headSha} — deploy job must run and pass first`);
  }
  if (status.state !== 'success') {
    fail(`${CONTEXT} on ${headSha} is "${status.state}", not "success"`);
  }
  const tag = buildReleaseTag(verifiedManifest.version);
  // Tag không bao giờ được ghi đè: nếu đã tồn tại, đây là bug pipeline
  // (hai lần tag cùng version) hoặc re-run idempotent cùng SHA — chỉ
  // nhánh cùng-SHA được coi là idempotent, còn lại fail, không `-f`.
  const existing = execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (existing) {
    if (existing === headSha) {
      console.log(
        `[staging:tag] tag ${tag} already exists on ${headSha} — idempotent, nothing to do`,
      );
      emitOutput('release_tag', tag);
      process.exit(0);
    }
    fail(
      `tag ${tag} already exists on ${existing} but this run verified ${headSha} — refusing to move a release tag`,
    );
  }
  // Annotated tag: tạo object có ngày/message — dấu vết audit tốt hơn cho
  // release identity; `git push` behavior như lightweight.
  execFileSync(
    'git',
    [
      'tag',
      '-a',
      tag,
      headSha,
      '-m',
      `Release ${verifiedManifest.version} of ${PROJECT_NAME} (staging verified)`,
    ],
    { stdio: 'inherit' },
  );
  // Checkout chạy với `persist-credentials: false` nên push tự cung cấp
  // token qua URL — không chạm git config global, token không rơi vào disk.
  execFileSync(
    'git',
    ['push', `https://x-access-token:${ghToken}@github.com/${repo}.git`, `refs/tags/${tag}`],
    {
      stdio: 'inherit',
    },
  );
  console.log(`[staging:tag] created and pushed ${tag} on ${headSha}`);
  emitOutput('release_tag', tag);
  process.exit(0);
}

// --- Mode deploy (bước 1–5) ---

// --- Bước 2: stale-run guard, re-check ngay trước deploy ---
const runs = await listWorkflowRuns(WORKFLOW_FILE_NAME, BRANCH, 50, gh);
const competing: CompetingRun[] = runs
  .filter((r) => r.id !== runId)
  .filter((r) => r.status === 'in_progress' || r.status === 'queued')
  .map((r) => ({ headSha: r.head_sha, runId: r.id, status: r.status as CompetingRun['status'] }));

/**
 * Predicate tổ tiên trên lịch sử main, qua GitHub compare API — một API call
 * thay vì fetch depth-full (checkout của job này là shallow).
 *
 * Trả `false` khi GitHub không so sánh được (SHA ngoài repo, fork) — hợp lệ:
 * quan hệ không xác định được sẽ đẩy guard vào nhánh abort fail-closed vì
 * chiều kia của compare cũng không xác định được.
 */
async function isAncestorOf(ancestor: string, descendant: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/compare/${ancestor}...${descendant}`,
      {
        headers: {
          Authorization: `Bearer ${ghToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'user-agent': 'ecoma-delivery-pipeline',
        },
      },
    );
    if (!res.ok) {
      console.log(
        `[staging:guard] compare ${ancestor}...${descendant} → HTTP ${res.status} (treated as unrelated)`,
      );
      return false;
    }
    const body = (await res.json()) as { status?: string };
    // `ahead`  : ancestor đứng trước descendant trong lịch sử → đúng nghĩa.
    // `identical`: hai SHA cùng tree/càng cùng commit → coi như tổ tiên.
    return body.status === 'ahead' || body.status === 'identical';
  } catch (error) {
    console.log(
      `[staging:guard] compare ${ancestor}...${descendant} errored: ${String(error)} (treated as unrelated)`,
    );
    return false;
  }
}

const verdict = await evaluateStaleGuard(headSha, runId, competing, isAncestorOf);

if (verdict.action === 'abort') {
  // Ghi status failure trên SHA để lộ việc run này không verify gì —
  // promotion sau này không thể nhầm một SHA bị abort là verified.
  await createCommitStatus(
    headSha,
    'failure',
    CONTEXT,
    `staging deploy aborted by stale-run guard`,
    runUrl(runId, repo),
    gh,
  );
  fail(`stale-run guard aborted: ${verdict.reason}`);
}
if (verdict.action === 'skip') {
  console.log(`[staging:guard] skip: ${verdict.reason}`);
  emitOutput('deployed', 'false');
  emitOutput('skip_reason', verdict.reason);
  // Không ghi status: run mới hơn cùng revision sẽ ghi status của nó; ghi
  // failure ở đây sẽ đè evidence success của run thắng cuộc trên cùng SHA.
  console.log('[staging] skipped — a newer run owns this deploy');
  process.exit(0);
}

// --- Bước 3: deploy ---
// Wrangler chạy từ checkout root (nơi có `wrangler.jsonc` — artifact KHÔNG
// chứa config): `main`/`assets.directory` trong config là đường tương đối
// `.output/...`, nên symlink `.output` của checkout trỏ vào artifact đã tải
// — artifact (đã verify SHA qua manifest) chính là thứ được deploy, không
// phải `.output` còn sót trong checkout (checkout này là shallow, không
// build, không thể có `.output` thật — symlink chỉ để wrangler resolve path).
const checkoutOutputDir = 'apps/home/.output';
rmSync(checkoutOutputDir, { force: true, recursive: true });
symlinkSync(artifactDir, checkoutOutputDir, 'dir');
console.log(
  `[staging] deploying ${headSha} (version ${verifiedManifest.version}) to worker ${STAGING_WORKER_NAME}`,
);
try {
  execFileSync('npx', ['wrangler', 'deploy', '--config', 'wrangler.jsonc', '--env', 'staging'], {
    stdio: 'inherit',
    cwd: 'apps/home',
    env: { ...process.env, CLOUDFLARE_API_TOKEN: requireEnv('CLOUDFLARE_API_TOKEN') },
  });
} catch (error) {
  await createCommitStatus(
    headSha,
    'failure',
    CONTEXT,
    'staging deploy failed (wrangler error)',
    runUrl(runId, repo),
    gh,
  );
  fail(`wrangler deploy failed: ${String(error)}`);
}
emitOutput('deployed', 'true');

// --- Bước 4: smoke với retry ngắn cho edge propagation ---
let smoke = await runSmokeChecks({ origin: STAGING_ORIGIN, noIndex: true });
for (let attempt = 2; attempt <= 3 && !smoke.passed; attempt++) {
  console.log(`[staging:smoke] attempt ${attempt - 1} failed — retrying in 10s (edge propagation)`);
  await new Promise((resolve) => {
    setTimeout(resolve, 10_000);
  });
  smoke = await runSmokeChecks({ origin: STAGING_ORIGIN, noIndex: true });
}

for (const c of smoke.checks) {
  console.log(
    `[staging:smoke] ${c.passed ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`,
  );
}

// --- Bước 5: evidence trên ĐÚNG SHA ---
await createCommitStatus(
  headSha,
  smoke.passed ? 'success' : 'failure',
  CONTEXT,
  smoke.passed
    ? `staging verified: ${verifiedManifest.version} deployed and smoke passed`
    : `staging smoke failed after deploy of ${verifiedManifest.version}`,
  runUrl(runId, repo),
  gh,
);

if (!smoke.passed) {
  fail(`smoke verification failed on ${STAGING_ORIGIN}`);
}
emitOutput('verified', 'true');
console.log(`[staging] ${headSha} (version ${verifiedManifest.version}) deployed and verified`);
