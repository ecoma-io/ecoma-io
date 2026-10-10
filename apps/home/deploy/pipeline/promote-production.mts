/**
 * Runner của job `promote` trong workflow production (`home-production.yaml`).
 *
 * Làn production là workflow_dispatch có input `tag` + GitHub Environment
 * `production` (bắt buộc reviewer approve trước khi job chạy — cấu hình
 * required reviewer là việc setup một lần, xem checklist vận hành trong
 * `docs/overview/02-delivery.md`). Task §6 yêu cầu mọi điều kiện promotion
 * được kiểm **trước** khi chạm Wrangler, fail-closed:
 *
 * 1. Tag input parse được theo pattern release của home (`@ecoma-io/home@X.Y.Z`).
 * 2. Tag resolve ra một SHA 40-hex, SHA đó nằm trong lịch sử main.
 * 3. `apps/home/package.json` tại SHA khai đúng version mà tag tuyên bố.
 * 4. Status `home/staging-verified` = success trên ĐÚNG SHA đó — bằng chứng
 *    staging từ workflow đáng tin (không phải PR fork).
 * 5. Environment approval đã có (đảm bảo bởi `environment: production` của
 *    job — nếu chưa approve, job không hề được phép chạy).
 *
 * Sau gate: deploy artifact của ĐÚNG commit đó (rebuild từ checkout SHA thay
 * vì tin artifact cũ — artifact staging có thể đã hết retention) rồi
 * post-deploy smoke trên `https://ecoma.io`. KHÔNG auto-rollback khi smoke
 * fail: ghi status `home/production-verified` = failure và dừng — rollback
 * là quyết định của con người (task §6).
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { getCommitStatus, createCommitStatus, type GithubFetchOptions } from './github-run';
import { evaluatePromotionGate } from './promotion-gate';
import { parseReleaseTag, readHomeVersion } from './release-tag';
import { runSmokeChecks } from './smoke-check';

function fail(message: string): never {
  console.error(`[production] FAIL: ${message}`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    fail(`missing required environment variable ${name}`);
  }
  return value as string;
}

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

function git(args: string[], opts?: { stdio?: 'inherit' | 'ignore' | 'pipe' }): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: opts?.stdio ?? ['ignore', 'pipe', 'ignore'],
  }).trim();
}

const PRODUCTION_ORIGIN = 'https://ecoma.io';
const CONTEXT = 'home/production-verified';
const PROJECT_NAME = '@ecoma-io/home';

const tag = process.argv[2] ?? '';
if (!tag) {
  fail('usage: tsx promote-production.mts <tag>');
}
const repo = requireEnv('GITHUB_REPOSITORY');
const ghToken = requireEnv('GH_TOKEN');
const runId = Number(requireEnv('RUN_ID'));
const gh: GithubFetchOptions = { ghToken, repo };

// --- Thu thập dữ liệu thô cho gate ---
const tagInfo = parseReleaseTag(tag);
if (!tagInfo) {
  fail(`tag "${tag}" does not match the release pattern ${PROJECT_NAME}@{version}`);
}

// Checkout của job đã fetch đủ tag + main history (workflow setup
// `fetch-depth: 0`). Resolve tag → SHA: `rev-list -n1` cho cả annotated lẫn
// lightweight đều trả commit SHA được trỏ tới (với annotated, `rev-list`
// peel đúng object xuống commit).
let tagSha: string;
try {
  tagSha = git(['rev-list', '-n', '1', tag]);
} catch {
  fail(`tag "${tag}" does not exist in this repository`);
}
if (!/^[0-9a-f]{40}$/u.test(tagSha)) {
  fail(`tag "${tag}" resolved to "${tagSha}", which is not a commit SHA`);
}

// Version tại SHA: đọc package.json từ git object — không tin working tree.
const packageJsonAtSha = git(['show', `${tagSha}:apps/home/package.json`]);
let versionAtSha: string;
try {
  versionAtSha = readHomeVersion(packageJsonAtSha);
} catch (error) {
  fail(`cannot read version at ${tagSha}: ${String(error)}`);
}

// Lịch sử main: mọi ancestor của HEAD main (job checkout branch main).
const mainHistory = git(['rev-list', 'main']).split('\n').filter(Boolean);

const stagingStatus = await getCommitStatus(tagSha, 'home/staging-verified', gh);

// --- Gate — nguồn quyết định duy nhất là evaluatePromotionGate ---
const verdict = evaluatePromotionGate({
  tag,
  sha: tagSha,
  versionAtSha,
  versionFromTag: tagInfo.version,
  mainHistory,
  staging: stagingStatus
    ? {
        context: 'home/staging-verified',
        state: stagingStatus.state as 'success' | 'failure' | 'error' | 'pending' | 'expected',
        sha: tagSha,
      }
    : undefined,
});

if (!verdict.ok) {
  console.error('[production] promotion gate rejected — reasons:');
  for (const reason of verdict.reasons) {
    console.error(`  - ${reason}`);
  }
  process.exit(1);
}
console.log(`[production] promotion gate passed for ${tag} at ${tagSha}`);
emitOutput('sha', tagSha);
emitOutput('version', tagInfo.version);

// --- Deploy: rebuild từ ĐÚNG commit đã tag ---
// Tin artifact staging là một nhược điểm bảo mật (artifact có thể đã hết
// retention); rebuild từ commit tag là deterministic theo lockfile. Task §6
// điều 5 ("artifact matches verified release SHA") được bảo đảm bằng
// construction: artifact được build ngay tại SHA đã tag trong job này.
console.log(`[production] checking out the tagged commit ${tagSha}…`);
execFileSync('git', ['checkout', '--detach', tagSha], { stdio: 'inherit' });
console.log('[production] building home from the tagged commit…');
execFileSync('npx', ['nx', 'run', `${PROJECT_NAME}:build`], { stdio: 'inherit' });

console.log('[production] deploying to worker ecoma-home (--env production)…');
execFileSync('npx', ['wrangler', 'deploy', '--config', 'wrangler.jsonc', '--env', 'production'], {
  stdio: 'inherit',
  cwd: 'apps/home',
  env: { ...process.env, CLOUDFLARE_API_TOKEN: requireEnv('CLOUDFLARE_API_TOKEN') },
});
emitOutput('deployed', 'true');

// --- Post-deploy smoke (retry ngắn cho edge propagation) ---
let smoke = await runSmokeChecks({ origin: PRODUCTION_ORIGIN, noIndex: false });
for (let attempt = 2; attempt <= 3 && !smoke.passed; attempt++) {
  console.log(
    `[production:smoke] attempt ${attempt - 1} failed — retrying in 10s (edge propagation)`,
  );
  await new Promise((resolve) => {
    setTimeout(resolve, 10_000);
  });
  smoke = await runSmokeChecks({ origin: PRODUCTION_ORIGIN, noIndex: false });
}

for (const c of smoke.checks) {
  console.log(
    `[production:smoke] ${c.passed ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`,
  );
}

await createCommitStatus(
  tagSha,
  smoke.passed ? 'success' : 'failure',
  CONTEXT,
  smoke.passed
    ? `production verified: ${tagInfo.version} live on ${PRODUCTION_ORIGIN}`
    : `production smoke failed after deploy of ${tagInfo.version}`,
  runUrl(runId, repo),
  gh,
);

if (!smoke.passed) {
  // KHÔNG auto-rollback (task §6): failure được ghi lại rõ ràng, quyết định
  // rollback thuộc về con người — deploy lại version cũ là một promotion
  // có chủ đích qua cùng workflow này (tag cũ của version trước).
  fail(`production smoke failed on ${PRODUCTION_ORIGIN} — manual rollback decision required`);
}
emitOutput('verified', 'true');
console.log(
  `[production] ${tag} (${tagInfo.version}) is live and verified on ${PRODUCTION_ORIGIN}`,
);
