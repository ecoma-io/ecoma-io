/**
 * Quy ước release của deploy unit `home` — nguồn duy nhất cho mọi quyết định
 * "commit này có phải release candidate không" và "tag này có đúng định danh
 * release của home không".
 *
 * Mọi workflow (staging, tagging, promotion) và mọi smoke runner đều import
 * từ đây; không script nào tự viết regex thứ hai. Cấu hình `nx.json`
 * `release.releaseTag.pattern` (`{projectName}@{version}`) là nguồn gốc của
 * quy ước — module này chỉ phiên dịch nó ra dạng dùng được trong Node, vì
 * workflow chạy ngoài Nx (job deploy không có Nx trong dependency).
 *
 * Invariants được bảo vệ (docs/overview/02-delivery.md §7.2–§7.3):
 *
 * - Tag release luôn có dạng `{projectName}@{version}` — project name thật là
 *   `@ecoma-io/home` (giữ nguyên `@`/`/`, `git check-ref-format` chấp nhận),
 *   nên tag thật là `@ecoma-io/home@0.0.2`.
 * - Version trong tag là semver nghiêm ngặt; tag không khớp pattern hoặc
 *   version không phải semver → fail closed.
 * - Message của release commit do `nx.json release.git.commitMessage` quy
 *   định (`chore(home): release {projectName} {version}`). Squash merge của
 *   GitHub nối ` (#N)` vào subject, nên matcher phải chấp nhận phần đuôi đó.
 */

/** Tên Nx project của deploy unit — phải khớp `apps/home/package.json` name. */
export const HOME_PROJECT_NAME = '@ecoma-io/home';

/**
 * Pattern tag release, khớp `nx.json → release.releaseTag.pattern`.
 *
 * Nx interpolate `{projectName}` bằng tên project **không sanitize** (tên
 * này không chứa ký tự git-invalid) và `{version}` bằng version semver.
 */
export const HOME_RELEASE_TAG_PATTERN = `${HOME_PROJECT_NAME}@{version}`;

/**
 * Version hiện hành của home đọc từ manifest trên disk.
 *
 * `nx release` với `fallbackCurrentVersionResolver: 'disk'` đọc cùng file
 * này — đây là nguồn version duy nhất của deploy unit, không bản sao thứ hai.
 */
export function readHomeVersion(packageJsonText: string): string {
  const parsed: unknown = JSON.parse(packageJsonText);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('name' in parsed) ||
    !('version' in parsed) ||
    (parsed as { name?: unknown }).name !== HOME_PROJECT_NAME ||
    typeof (parsed as { version?: unknown }).version !== 'string'
  ) {
    throw new Error(`apps/home/package.json is not a valid manifest for ${HOME_PROJECT_NAME}`);
  }
  return (parsed as { version: string }).version;
}

/**
 * Dựng tên tag release cho một version.
 *
 * Dùng thay cho nội suy chuỗi rải rác: một nơi duy nhất biết pattern, nên
 * đổi pattern ở `nx.json` là đổi một chỗ ở đây.
 */
export function buildReleaseTag(version: string): string {
  const tag = HOME_RELEASE_TAG_PATTERN.replace('{version}', version);
  if (!parseReleaseTag(tag)) {
    throw new Error(`Version "${version}" does not produce a valid release tag`);
  }
  return tag;
}

/**
 * Regex semver nghiêm ngặt — bản chính thức của semver.org, không chấp nhận
 * `v` prefix, khoảng trắng hay số 0 dẫn (`01.2.3` là lỗi).
 */
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/u;

/**
 * Kết quả parse một tag: nhận diện được thì trả project name + version,
 * không thì `undefined` — caller quyết định fail hay bỏ qua tuỳ ngữ cảnh.
 */
export type ReleaseTagInfo = {
  readonly projectName: string;
  readonly version: string;
};

/**
 * Parse một git tag theo pattern release của home.
 *
 * Pattern `{projectName}@{version}` có `{projectName}` chứa `@` và `/`, nên
 * không thể anchor bằng cách đơn giản: khớp prefix tên project thật, rồi
 * `@`, rồi phần còn lại phải là semver nghiêm ngặt. Tag của project khác
 * (`@ecoma-io/docs@1.0.0`) hoặc pattern khác (`v1.0.0`) trả `undefined`.
 */
export function parseReleaseTag(tag: string): ReleaseTagInfo | undefined {
  if (!tag.startsWith(`${HOME_PROJECT_NAME}@`)) {
    return undefined;
  }
  const version = tag.slice(HOME_PROJECT_NAME.length + 1);
  if (!SEMVER_RE.test(version)) {
    return undefined;
  }
  return { projectName: HOME_PROJECT_NAME, version };
}

/**
 * Message subject của release commit, như Nx Release sinh ra sau khi nội suy
 * `chore(home): release {projectName} {version}` từ
 * `nx.json → release.git.commitMessage`.
 *
 * Nhận thêm phần đuôi tùy ý (` (#79)` do squash merge nối) — quyết định
 * "đây có phải release commit không" chỉ nhìn prefix và nội dung version,
 * không nhìn metadata PR. Không nhận dạng ngược `isAutomatedReleaseCommit`
 * của Nx (nó chỉ thay `{version}` bằng `\S+` nên không khớp message có
 * `{projectName}`): regex ở đây dư chặt hơn, nhưng phải khớp đủ cả project
 * name lẫn semver — message `chore(home): release anything` không pass.
 */
export function isReleaseCommitSubject(subject: string): boolean {
  const prefix = `chore(${HOME_PROJECT_NAME.slice(HOME_PROJECT_NAME.indexOf('/') + 1)}): release ${HOME_PROJECT_NAME} `;
  if (!subject.startsWith(prefix)) {
    return false;
  }
  const version = subject.slice(prefix.length).split(/\s+/u)[0];
  return SEMVER_RE.test(version);
}

/**
 * Trích version từ subject release commit. Chỉ gọi khi
 * `isReleaseCommitSubject` đã pass; subject lạ → `undefined`.
 */
export function releaseVersionFromSubject(subject: string): string | undefined {
  if (!isReleaseCommitSubject(subject)) {
    return undefined;
  }
  const prefix = `chore(${HOME_PROJECT_NAME.slice(HOME_PROJECT_NAME.indexOf('/') + 1)}): release ${HOME_PROJECT_NAME} `;
  return subject.slice(prefix.length).split(/\s+/u)[0];
}
