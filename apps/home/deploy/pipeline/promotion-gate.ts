/**
 * Promotion gate của làn production cho deploy unit `home`.
 *
 * Toàn bộ điều kiện bắt buộc của `docs/overview/02-delivery.md` §7.2–§7.3
 * được kiểm **trước** khi job production chạm Wrangler. Hàm ở đây là nguồn
 * quyết định duy nhất: workflow chỉ thu thập dữ liệu thô (tag list, commit
 * history, commit status) rồi đưa vào đây; mọi nhánh fail đều fail-closed
 * với lý do tường minh, không có đường nào "tạm chấp nhận".
 *
 * Thiết kế pure-function để test được trực tiếp bằng Vitest mà không cần
 * GitHub Actions hay mạng — các spec cùng thư mục chứng minh cả đường pass
 * lẫn từng đường fail.
 */

import { HOME_PROJECT_NAME, parseReleaseTag } from './release-tag';

/** Bằng chứng staging verification gắn với một SHA — đọc từ GitHub API. */
export type StagingEvidence = {
  /** Tên status/check (ví dụ `home/staging-verified`). */
  readonly context: string;
  /** Trạng thái GitHub commit status (`success` / `failure` / …). */
  readonly state: 'success' | 'failure' | 'error' | 'pending' | 'expected';
  /** Exact SHA mà status gắn vào. */
  readonly sha: string;
};

/**
 * Dữ liệu thô của một release candidate — mọi trường đều bắt buộc, thiếu
 * dữ liệu là lỗi ở tầng thu thập chứ không phải điều kiện "bỏ qua".
 */
export type ReleaseCandidate = {
  /** Tag do workflow input cung cấp (đúng chuỗi, không normalize). */
  readonly tag: string;
  /** SHA mà tag resolve ra (`git rev-list -n1 <tag>`), full 40 hex. */
  readonly sha: string;
  /** Version đọc từ `apps/home/package.json` **tại SHA đó**. */
  readonly versionAtSha: string;
  /** Version mà tag pattern trích ra từ chính tên tag. */
  readonly versionFromTag: string;
  /** Danh sách ancestor SHA của `main` tại thời điểm promotion (đầy đủ). */
  readonly mainHistory: readonly string[];
  /** Bằng chứng staging của tag SHA, nếu có. */
  readonly staging: StagingEvidence | undefined;
};

/** Kết quả gate: pass hoặc danh sách lý do fail (có thể nhiều cùng lúc). */
export type PromotionVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasons: readonly string[] };

/**
 * Kiểm mọi điều kiện promotion. Thứ tự check theo mức "sai cấu trúc" →
 * "sai bằng chứng"; tất cả lý do được gom lại trong một lần chạy để người
 * vận hành thấy đủ bức tranh thay vì sửa từng lỗi một.
 *
 * 1. Định danh release: tag parse được theo pattern, version từ tag là
 *    semver, project name đúng home.
 * 2. Tag SHA ≠ version tại SHA: manifest tại tagged commit phải khai đúng
 *    version mà tag tuyên bố — tag không được tồn tại trước khi release
 *    commit chứa version đó được merge (invariant §3 của task: không tag
 *    trước staging verification).
 * 3. Tag SHA thuộc lịch sử `main` — không promote commit từ nhánh lạ.
 * 4. Staging evidence của **chính SHA đó** là `success`, từ context đúng.
 *    Không chấp nhận commit cha, SHA "tương đương" hay tree giống nhau.
 */
export function evaluatePromotionGate(candidate: ReleaseCandidate): PromotionVerdict {
  const reasons: string[] = [];

  const tagInfo = parseReleaseTag(candidate.tag);
  if (!tagInfo) {
    reasons.push(
      `Tag "${candidate.tag}" does not match the release tag pattern "${HOME_PROJECT_NAME}@{version}" for project ${HOME_PROJECT_NAME}`,
    );
  } else if (tagInfo.version !== candidate.versionFromTag) {
    reasons.push(
      `Tag version "${tagInfo.version}" does not match expected "${candidate.versionFromTag}"`,
    );
  }

  if (!/^[0-9a-f]{40}$/u.test(candidate.sha)) {
    reasons.push(`Tag SHA "${candidate.sha}" is not a full 40-hex commit SHA`);
  }

  if (
    tagInfo &&
    /^[0-9a-f]{40}$/u.test(candidate.sha) &&
    tagInfo.version !== candidate.versionAtSha
  ) {
    reasons.push(
      `apps/home/package.json at ${candidate.sha} declares version "${candidate.versionAtSha}" but tag declares "${tagInfo.version}"`,
    );
  }

  if (/^[0-9a-f]{40}$/u.test(candidate.sha) && !candidate.mainHistory.includes(candidate.sha)) {
    reasons.push(
      `Tag SHA ${candidate.sha} is not reachable from main — refusing to promote a revision outside the mainline history`,
    );
  }

  if (!candidate.staging) {
    reasons.push(
      `No staging verification evidence found for ${candidate.sha} — the exact tagged SHA must have a passing "${candidate.staging?.context ?? 'staging'}" status`,
    );
  } else {
    if (candidate.staging.sha !== candidate.sha) {
      reasons.push(
        `Staging evidence is attached to ${candidate.staging.sha}, not the tagged SHA ${candidate.sha} — evidence must belong to the exact revision being promoted`,
      );
    }
    if (candidate.staging.state !== 'success') {
      reasons.push(
        `Staging verification for ${candidate.sha} is "${candidate.staging.state}", not "success"`,
      );
    }
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
