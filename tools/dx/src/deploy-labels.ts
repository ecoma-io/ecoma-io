/**
 * Docker label tự mô tả của resource local deployment — nền cho `dx
 * local-cleanup`.
 *
 * Vấn đề: Docker resource mồ côi (container/network/volume còn đó nhưng stack
 * Pulumi quản lý nó đã mất — `pulumi stack rm`, state xoá, worktree xoá...)
 * không cách nào tự chứng minh "của ai" qua tên: tên `ecoma-<namespace>-<kind>`
 * chỉ làm tên TRÔNG NGẮN giống resource của ecoma, không phải bằng chứng
 * ownership. `local-cleanup` xoá dựa trên metadata tường minh, không dựa trên
 * tên — đúng như contract "Do not claim a resource is managed by DX solely
 * because its name resembles an Ecoma resource."
 *
 * Mọi label giống nằm ở đây là một bản duy nhất: deploy units (producer) và
 * cleanup (consumer) import CÙNG hằng số/hàm, không copy chuỗi.
 */

/**
 * Namespace prefix của label — dùng `io.ecoma` (reverse-DNS) để không đụng
 * label namespace chính thức của Docker (`io.docker.*`, compose, OCI...).
 */
import { namespaceFromCanonicalPath } from './deploy-namespace.js';

export const LABEL_PREFIX = 'io.ecoma';

/** Label đánh dấu resource bị DX local tooling quản lý. Giá trị: `dx`. */
export const LABEL_MANAGED_BY = `${LABEL_PREFIX}.managed-by`;

/** Giá trị của {@link LABEL_MANAGED_BY} — tooling sở hữu resource là `dx`. */
export const LABEL_MANAGED_BY_VALUE = 'dx';

/** Label lưu worktree root đã normalize (canonical theo `normalizeWorktreeRoot`). */
export const LABEL_WORKTREE_PATH = `${LABEL_PREFIX}.worktree-path`;

/** Label lưu worktree id ổn định — chính là namespace (`w` + xxHash64 hex 12). */
export const LABEL_WORKTREE_ID = `${LABEL_PREFIX}.worktree-id`;

/** Label lưu tên deployment identifier — `local` cho local deployment. */
export const LABEL_DEPLOYMENT = `${LABEL_PREFIX}.deployment`;

/** Giá trị của {@link LABEL_DEPLOYMENT} cho luồng local deployment. */
export const LABEL_DEPLOYMENT_VALUE = 'local';

/**
 * Các label ownership mà mọi resource DX local deployment PHẢI mang đủ.
 * Thiếu một label nào là metadata không đầy đủ — `local-cleanup` coi như
 * không có ownership và skip (fail-closed).
 */
export const OWNERSHIP_LABELS = [
  LABEL_MANAGED_BY,
  LABEL_WORKTREE_PATH,
  LABEL_WORKTREE_ID,
  LABEL_DEPLOYMENT,
] as const;

/** Union type các label name ownership — giúp spec và consumer gõ được. */
export type OwnershipLabel = (typeof OWNERSHIP_LABELS)[number];

/**
 * Bộ labels Ownership Certificate cho một worktree.
 *
 * `worktreePath` PHẢI là giá trị đã qua `normalizeWorktreeRoot` (bên caller),
 * vì label là dữ liệu dùng để so sánh với `normalizeWorktreeRoot(root)` trong
 * `local-cleanup` — nếu caller truyền path chưa normalize thì hai lần chạy
 * cùng một worktree (`/a/b/` vs `/a/b`) có thể sinh metadata khác nhau.
 */
export function ownershipLabels(worktreePath: string, namespace: string): Record<string, string> {
  return {
    [LABEL_MANAGED_BY]: LABEL_MANAGED_BY_VALUE,
    [LABEL_WORKTREE_PATH]: worktreePath,
    [LABEL_WORKTREE_ID]: namespace,
    [LABEL_DEPLOYMENT]: LABEL_DEPLOYMENT_VALUE,
  };
}

/**
 * Kết quả duyệt metadata trên một resource Docker. `unknown` khi Docker trả
 * lỗi (daemon chết, resource biến mất ngay lúc inspect) — khác với
 * `missing`, để cleanup không lẫn "resource an toàn bỏ qua" với "không hiểu"
 * rồi vẫn xoá.
 */
export type OwnershipCheck =
  | { state: 'owned'; worktreePath: string; worktreeId: string }
  | { state: 'missing' }
  | { state: 'malformed'; detail: string }
  | { state: 'unknown'; detail: string };

/**
 * Duyệt labels thô của một resource Docker có đủ metadata ownership hợp lệ.
 *
 * Logic fail-closed:
 * - `managed-by != dx` → `missing`: resource KHÔNG thuộc quản lý DX (nó có
 *   thể thuộc Docker Desktop, compose, người dùng...) — cleanup bỏ qua.
 * - Thiếu bất kỳ label nào trong 4 → `malformed`: resource do DX quản lý
 *   nhưng metadata không trọn vẹn, KHÔNG được xoá.
 * - `worktree-id` rỗng hoặc không khớp pattern namespace → `malformed`:
 *   pattern xấu có thể là label hỏng của phiên bản cũ.
 * - `managed-by = dx` nhưng giá trị khác → `malformed` — biến thành
 *   "managed-by có nhưng sai giá trị" của một phiên bản khác của tool.
 */
export function classifyOwnership(labels: Record<string, string>): OwnershipCheck {
  const managed = labels[LABEL_MANAGED_BY];
  if (managed === undefined || managed.length === 0) {
    // Không có label managed-by (hoặc rỗng) — resource không thuộc quản lý DX,
    // có thể thuộc Docker/compose/người dùng. Phân biệt với malformed: missing
    // nghĩa là "không phải của chúng tôi", malformed nghĩa là "của chúng tôi
    // nhưng metadata hỏng".
    return { state: 'missing' };
  }
  if (managed !== LABEL_MANAGED_BY_VALUE) {
    // `managed-by` có giá trị nhưng không phải `dx` — metadata mâu thuẫn hoặc
    // phiên bản tool khác. Coi là malformed (không phải missing) vì resource
    // tự nhận là được tool quản lý nhưng sai giá trị.
    return {
      state: 'malformed',
      detail: `managed-by "${managed}" không phải "${LABEL_MANAGED_BY_VALUE}"`,
    };
  }

  const missingLabel = OWNERSHIP_LABELS.find((label) => {
    const value = labels[label];
    return value === undefined || value.length === 0;
  });
  if (missingLabel !== undefined) {
    return {
      state: 'malformed',
      detail: `label ${missingLabel} thiếu hoặc rỗng`,
    };
  }

  const deployment = labels[LABEL_DEPLOYMENT] ?? '';
  if (deployment !== LABEL_DEPLOYMENT_VALUE) {
    return {
      state: 'malformed',
      detail: `deployment "${deployment}" không phải "${LABEL_DEPLOYMENT_VALUE}"`,
    };
  }

  const namespace = labels[LABEL_WORKTREE_ID] ?? '';
  if (!/^w[0-9a-f]{12}$/u.test(namespace)) {
    return {
      state: 'malformed',
      detail: `worktreeId "${namespace}" không khớp pattern namespace`,
    };
  }

  const path = labels[LABEL_WORKTREE_PATH] ?? '';
  if (!path.startsWith('/') || path === '/') {
    return { state: 'malformed', detail: `worktreePath "${path}" không phải absolute path` };
  }

  // Kiểm tính nhất quán: worktree id phải được sinh từ canonical path bằng cùng
  // hàm hashing với producer. Path trong label là đã-normalize (realpath) của
  // producer, nên recompute namespace và so với label; lệch = metadata mâu thuẫn.
  let expectedId: string;
  try {
    expectedId = namespaceFromCanonicalPath(path);
  } catch {
    return { state: 'malformed', detail: `worktreePath "${path}" không hash được` };
  }
  if (expectedId !== namespace) {
    return {
      state: 'malformed',
      detail: `worktreeId "${namespace}" không khớp worktreePath "${path}" (expected ${expectedId})`,
    };
  }

  return { state: 'owned', worktreePath: path, worktreeId: namespace };
}

/**
 * Chuyển labels từ format Docker inspect (`[{Key, Value}]`) thành Record —
 * hợp lệ cho container, network, volume; format chung của mọi `docker inspect`.
 */
export function labelsFromInspect(
  entries: ReadonlyArray<{ Key: string; Value: string }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { Key, Value } of entries) {
    out[Key] = Value;
  }
  return out;
}
