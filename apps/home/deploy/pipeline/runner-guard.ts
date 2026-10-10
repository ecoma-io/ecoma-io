/**
 * Guard chống stale run cho làn staging.
 *
 * Hai deploy staging chạy chồng nhau là điều kiện bình thường (nhất là khi
 * merge queue landing nhiều PR liên tiếp), và `concurrency` của GitHub chỉ
 * cancel run đang chạy — không bảo vệ được race giữa "run đang deploy" và
 * "run mới hơn vừa được lên lịch". Wrangler deploy là lệnh ghi trạng thái:
 * một run cũ lọt qua sẽ ghi đè staging bằng revision cũ hơn, rồi ghi status
 * success như thể đó là revision mới nhất — vi phạm trực tiếp §7.4
 * (concurrency/stale-run guard).
 *
 * Quy ước: **run mới hơn luôn thắng**. Run đang chạy phải kiểm lại — ngay
 * trước khi gọi `wrangler deploy` và ngay trước khi ghi status — rằng
 * source SHA của nó vẫn là revision cần deploy. Workflow export danh sách
 * SHA của mọi staging run đang `in_progress`/`queued` (GitHub API
 * `GET /repos/{owner}/{repo}/actions/runs`, filtered theo workflow + branch
 * main), module này ra quyết định.
 */

/**
 * Một run staging đang đợi hoặc đang chạy, thu từ GitHub API.
 */
export type CompetingRun = {
  /** `head_sha` của run đó — SHA nguồn thật, không phải SHA của run wrapper. */
  readonly headSha: string;
  /** Trạng thái run (`queued` / `in_progress`). */
  readonly status: 'queued' | 'in_progress';
  /** Database id của run — quyết định thắng/thua theo thứ tự thời gian. */
  readonly runId: number;
};

/**
 * Kết quả guard: `deploy` cho phép ghi, `abort` dừng với lý do, `skip`
 * dừng im (run này đã bị supercede nhưng revision của nó vẫn sẽ được
 * deploy bởi run thắng — không phải lỗi).
 */
export type StaleGuardVerdict =
  | { readonly action: 'deploy' }
  | { readonly action: 'abort' | 'skip'; readonly reason: string };

/**
 * Quyết định run (SHA + run id của nó) có được deploy hay không.
 *
 * - Tồn tại run **khác** cùng SHA đang chạy/đợi: run có id nhỏ hơn phải
 *   dừng (skip — bản sao mới hơn sẽ làm cùng việc); id lớn hơn tiến hành
 *   (đúng thứ tự).
 * - Tồn tại run **khác** với SHA **mới hơn trong lịch sử main** (SHA này là
 *   ancestor của SHA kia): dừng (skip) — revision mình không còn là hiện
 *   hành; deploy ghi đè trạng thái staging không chủ đích.
 * - SHA mới hơn không xác định được quan hệ tổ tiên (cha khác, force push,
 *   danh sách history không chứa): **abort** — không đủ thông tin để bảo
 *   đảm mình không ghi đè revision mới, và fail-closed an toàn hơn overwrite.
 *
 * @param mySha          SHA nguồn của run này.
 * @param myRunId        Database id của run này (lớn hơn = mới hơn).
 * @param competingRuns  Các run khác còn queued/in_progress (đã lọc bỏ run
 *                       này và run cancelled/superseded).
 * @param isAncestorOf   Predicate tổ tiên trên lịch sử main: trả `true` khi
 *                       `a` là ancestor của `b` (a === b cũng tính, caller
 *                       đã lọc).
 */
export function evaluateStaleGuard(
  mySha: string,
  myRunId: number,
  competingRuns: readonly CompetingRun[],
  isAncestorOf: (ancestor: string, descendant: string) => boolean,
): StaleGuardVerdict {
  // Duyệt hết các run cạnh tranh trước khi kết luận: `abort` (không hiểu
  // được trạng thái) phải thắng `skip` (nhường có chủ đích) — fail-closed.
  let abortReason: string | undefined;
  let skipReason: string | undefined;

  for (const other of competingRuns) {
    if (other.headSha === mySha) {
      // Cùng revision, hai run (retry, re-run): chỉ một run được ghi trạng
      // thái, và id lớn hơn là run được tạo sau (re-run có chủ đích) — run
      // cũ hơn nhường.
      if (other.runId > myRunId && !skipReason) {
        skipReason = `run ${other.runId} for the same SHA ${mySha} is newer; it owns the deploy`;
      }
      continue;
    }
    if (isAncestorOf(mySha, other.headSha)) {
      if (!skipReason) {
        skipReason = `run ${other.runId} deploys a newer main revision ${other.headSha}; ${mySha} is stale`;
      }
      continue;
    }
    if (!isAncestorOf(other.headSha, mySha)) {
      abortReason = `cannot order ${mySha} against concurrent SHA ${other.headSha} (run ${other.runId}); failing closed to avoid overwriting unknown staging state`;
      break; // abort là tối thượng — không cần xem tiếp các run còn lại.
    }
  }

  if (abortReason) {
    return { action: 'abort', reason: abortReason };
  }
  if (skipReason) {
    return { action: 'skip', reason: skipReason };
  }
  return { action: 'deploy' };
}
