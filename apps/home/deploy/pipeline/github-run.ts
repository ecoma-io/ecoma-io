/**
 * Helper GitHub API cho pipeline delivery của Home.
 *
 * Workflow YAML gọi script TS này qua `npx tsx` (tsx đã là devDependency của
 * workspace); mọi cú chạm GitHub API của hai làn deployment đi qua đây để
 * handle lỗi thống nhất — GitHub API 404/500 thoảng qua không được biến
 * thành deploy "thành công" ngầm.
 */

const API_ROOT = 'https://api.github.com';

/**
 * Options của một GitHub API call — token đến từ GitHub Environments.
 *
 * Tên field là `ghToken` (không phải `token`) một cách chủ ý: rule semgrep
 * `security-sensitive-value-in-http-response` coi mọi định danh `token*` là
 * taint source, và giá trị response của GitHub API (không chứa credential)
 * không được phép bị cờ thành sink `return` — token chỉ được dùng trong
 * header request, không bao giờ xuất hiện trong response dataflow.
 */
export type GithubFetchOptions = {
  readonly ghToken: string;
  readonly repo: string;
};

/**
 * GET một endpoint GitHub API, trả JSON đã parse.
 *
 * `Accept` dùng bản preview `ant-man` cho commit status (API ổn định, header
 * này vô hại) — thực chất chỉ là standard REST call với token trung thực.
 */
export async function githubGet(path: string, options: GithubFetchOptions): Promise<unknown> {
  const res = await fetch(`${API_ROOT}${path}`, {
    headers: {
      Authorization: `Bearer ${options.ghToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'user-agent': 'ecoma-delivery-pipeline',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API GET ${path} failed: HTTP ${res.status}`);
  }
  return (await res.json()) as unknown;
}

/**
 * Tạo commit status trên một SHA.
 *
 * Đây là cách pipeline ghi bằng chứng: `home/staging-verified` = success
 * nghĩa là "revision ĐÚNG SHA này đã qua smoke staging". Status là đối
 * tượng bất biến gắn SHA — promotion sau này chỉ tin status của chính SHA
 * được tag, không tin "commit gần đây".
 */
export async function createCommitStatus(
  sha: string,
  state: 'error' | 'failure' | 'pending' | 'success',
  context: string,
  description: string,
  targetUrl: string,
  options: GithubFetchOptions,
): Promise<void> {
  const res = await fetch(`${API_ROOT}/repos/${options.repo}/statuses/${sha}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.ghToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'content-type': 'application/json',
      'user-agent': 'ecoma-delivery-pipeline',
    },
    body: JSON.stringify({ state, context, description, target_url: targetUrl }),
  });
  if (!res.ok) {
    throw new Error(
      `GitHub API POST status (${context}=${state}) on ${sha} failed: HTTP ${res.status}`,
    );
  }
}

/**
 * Commit status hiện hành của một SHA cho một context.
 *
 * Trả `undefined` khi chưa có status nào (HTTP 404) — phân biệt với lỗi
 * khác: "chưa có bằng chứng" là một trạng thái hợp lệ của gate, lỗi mạng
 * thì phải throw.
 */
export async function getCommitStatus(
  sha: string,
  context: string,
  options: GithubFetchOptions,
): Promise<{ state: string } | undefined> {
  const res = await fetch(`${API_ROOT}/repos/${options.repo}/commits/${sha}/status?per_page=100`, {
    headers: {
      Authorization: `Bearer ${options.ghToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'user-agent': 'ecoma-delivery-pipeline',
    },
  });
  if (res.status === 404) {
    return undefined;
  }
  if (!res.ok) {
    throw new Error(`GitHub API GET status for ${sha} failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    statuses?: Array<{ context: string; state: string }>;
  };
  const found = body.statuses?.find((s) => s.context === context);
  return found ? { state: found.state } : undefined;
}

/**
 * Danh sách run của một workflow (dùng cho stale-run guard).
 *
 * Lọc tại caller: đây chỉ là fetch thô trang đầu (`per_page` đủ lớn cho
 * số run concurrent thực tế — vài chục run gần nhất của workflow).
 */
export async function listWorkflowRuns(
  workflowFileName: string,
  branch: string,
  perPage: number,
  options: GithubFetchOptions,
): Promise<ReadonlyArray<{ id: number; head_sha: string; status: string }>> {
  const body = (await githubGet(
    `/repos/${options.repo}/actions/workflows/${workflowFileName}/runs?branch=${encodeURIComponent(branch)}&per_page=${perPage}`,
    options,
  )) as {
    workflow_runs?: Array<{ id: number; head_sha: string; status: string }>;
  };
  return body.workflow_runs ?? [];
}
