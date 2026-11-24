/**
 * Policy authorization thuần của `staff-access` — quyết định `can()` dựa trên
 * dữ liệu authorization ĐÃ được đồng bộ về backend, KHÔNG I/O, KHÔNG đọc đồng
 * hồ, KHÔNG decode token.
 *
 * Quy uoc (Staff Access domain):
 * - Deny-by-default; thiếu/sai/mơ hồ authorization state
 *   ⇒ fail closed, không có degraded allow path (T-14, AC-002).
 * - ADR-0002: token validity ≠ privilege currency —
 *   check đọc trạng thái hiện hành (staff status + cửa sổ assignment), không
 *   suy từ token còn hạn (T-05/T-06, AC-002/AC-018, invariant 5).
 * - ADR-0002: ngưỡng revocation latency `normal` ≤ 60s, `high` ≤ 5s là
 *   **target**, không tự hiện đại hoá thành cơ chế — hằng số ở đây chỉ là
 *   TTL re-read tối đa mà policy nhận là "đủ mới"; cơ chế event-driven cho
 *   lớp `high` (ADR-0014) chưa tồn tại ở repo này (ghi chú ở
 *   {@link REVOCATION_FRESHNESS_TTL_SECONDS}).
 * - ADR-0009: không sync-call mỗi request sang `staff-access` — policy đánh
 *   giá trên ảnh đã đồng bộ (batch/event-based sync); nơi ra quyết định vẫn
 *   ở resource-owning backend. Ngoại lệ duy nhất là verdict endpoint nội bộ
 *   của ADR-0033 (supersede-in-part ADR-0009) — không thuộc lib thuần này.
 * - ADR-0006 / ADR-0007: v1 chỉ RBAC gán phẳng — permission là định danh
 *   `domain.action`, tập assignment quyết định tập quyền; không ABAC, không
 *   role hierarchy, không role bypass (invariant 6, SR-016).
 *
 * ⚠️ Policy THUẦN — không SQL, không Node builtin, không I/O. Mọi tham số
 * thời gian (`now`, `fetchedAt`) do caller truyền vào; domain không đọc đồng
 * hồ (điều kiện của `libs/staff-access-domain` — xem `index.ts`).
 */

import type { StaffAccessStaffStatus } from '../staff/staff-status';

/**
 * Risk class của một operation theo ADR-0002 — gắn theo OPERATION, không
 * theo role hay người dùng.
 */
export type AuthorizationRiskClass = 'normal' | 'high';

/**
 * TTL re-read tối đa của dữ liệu authorization theo risk class — đúng target
 * của ADR-0002, nhưng **là chỉ mục tiêu, không phải cơ chế**.
 *
 * ⚠️ Giá trị `high` = 5s **không** có cơ chế bảo đảm phía sau ở repo này:
 * chưa có kênh invalidation event-driven (ADR-0014 chốt cơ chế, chưa dựng).
 * Cho tới khi kênh ra đời, dữ liệu cũ hơn TTL không được coi là đủ mới:
 * quyết định trên dữ liệu đó trả kèm marker `stale: true`
 * ({@link AuthorizationDecision}) và caller phải tự fail-closed — re-read,
 * từ chối, hoặc re-check at write time (SR-008) cho thao tác ghi. KHÔNG nới
 * con số này âm thầm (ADR-0002: "không được âm thầm nới rộng cửa sổ trong
 * code").
 */
export const REVOCATION_FRESHNESS_TTL_SECONDS: Record<AuthorizationRiskClass, number> = {
  high: 5,
  normal: 60,
};

/**
 * Định danh permission (`domain.action`) — tên type để caller nhớ nguồn là
 * catalog; lib thuần không có catalog để validate nội dung (xem
 * `permission/permission-id.ts` cho hình thức của literal).
 */
export type CatalogPermission = string;

/**
 * Đường thao tác mà một lần kiểm tra authorization phục vụ — **đọc** hay
 * **ghi** (SR-008: re-check authorization at write time).
 *
 * ⚠️ Phân biệt này là của **tầng enforcement**, không phải của policy thuần:
 * {@link can} không dùng `mode` (nó không I/O, không biết caller đang đọc hay
 * ghi). Lib khai ở đây vì đây là **vocabulary của operation** — cùng loại với
 * {@link AuthorizationRiskClass} — và tầng application + tầng audit cùng cần
 * nó mà không tạo cạnh import vòng.
 *
 * - `'read'` — thao tác đọc: cửa sổ stale chấp nhận được trong ngưỡng
 *   ADR-0002 của risk class.
 * - `'write'` — thao tác ghi: kết quả đã cache trước đó **không** được dùng
 *   (SR-008, chống TOCTOU), nên ảnh authorization quá TTL không đủ tươi cho
 *   đường này.
 */
export type AuthorizationMode = 'read' | 'write';

/**
 * Một assignment principal đang giữ — ảnh đã đồng bộ của hàng
 * `staff_access.role_assignments` + permission của role + staff status cùng
 * lượt đọc (schema là của Staff Access, migration 0001/0002 của repo tham
 * khảo).
 */
export interface GrantedAssignment {
  /** Permission mà assignment cung cấp, theo định danh của catalog. */
  readonly permissions: readonly CatalogPermission[];
  /** Hạn hiệu lực tự nhiên — `null` tức không đặt hạn. Read-time filter. */
  readonly validUntil: Date | null;
  /** Thời điểm thu hồi có chủ đích — `null` tức chưa revoke. */
  readonly revokedAt: Date | null;
  /**
   * Thời điểm DỮ LIỆU assignment này được đọc. Tập input có thể gồm ảnh
   * nhiều lượt fetch nếu kênh sync batch lệch lượt; policy so TTL theo mốc
   * cũ nhất (xem {@link isStale}).
   */
  readonly fetchedAt: Date;
  /** Staff status đọc cùng lượt — chính nó, không suy từ account status. */
  readonly staffStatus: StaffAccessStaffStatus;
}

/**
 * Lý do deny — tập ĐÓNG để audit không ghép chữ tự do (SR-013 reason_code).
 * Không trường nào mang identifier ngoài permission — cùng nguyên tắc
 * `errors.ts`: không nhét payload/identifier vào message.
 */
export type AuthorizationDenialReason =
  /**
   * Principal KHÔNG giữ assignment nào cung cấp permission — gồm cả trường
   * hợp tập input rỗng: deny-by-default khi thiếu dữ liệu (SR-002).
   */
  | 'permission_not_granted'
  /**
   * Staff status KHÔNG `active` (`suspended`/`terminated`) — invariant 5:
   * token còn hạn không phải bằng chứng membership còn hiện hành.
   */
  | 'staff_not_active'
  /**
   * Đã từng có permission nhưng cửa sổ hiệu lực tự nhiên đã qua
   * (`valid_until` đã vào quá khứ tại thời điểm quyết định) — AC-018;
   * expiry là read-time filter, row giữ lại để audit.
   */
  | 'assignment_expired'
  /**
   * Assignment đã bị thu hồi có chủ đích (`revoked_at` đã set) tại thời
   * điểm quyết định — thu hồi là UPDATE có audit, không phải DELETE.
   */
  | 'assignment_revoked';

/**
 * Kết quả {@link can} — `allowed: true` thì hoàn toàn; deny thì có lý do
 * ĐÓNG ({@link AuthorizationDenialReason}) + marker freshness.
 *
 * ⚠️ `stale: true` là **marker**, không phải verdict allow: nó nói dữ liệu
 * authorization mà quyết định dựa trên đã quá TTL của risk class — tức
 * KHÔNG thể bảo đảm quyết định phản ánh trạng thái hiện hành theo ADR-0002.
 * Caller dùng marker để fail-closed (re-read, từ chối, hay re-check at
 * write time với thao tác ghi) — policy này KHÔNG tự thực hiện và KHÔNG
 * biến `stale` thành một nhánh allow riêng.
 *
 * Cả hai biến thể cùng mang `riskClass` để audit record ghi được đúng lớp
 * mà quyết định đã tính theo (ADR-0002: class gắn theo operation).
 */
export type AuthorizationDecision =
  | { readonly allowed: true; readonly stale: boolean; readonly riskClass: AuthorizationRiskClass }
  | {
      readonly allowed: false;
      readonly denial: AuthorizationDenialReason;
      readonly stale: boolean;
      readonly riskClass: AuthorizationRiskClass;
    };

/**
 * Quyết định authorization của một principal trên một permission.
 *
 * Thứ tự kiểm tra (fail-closed, mỗi lớp không suy ra lớp khác):
 * 1. **Không có assignment nào** ⇒ `permission_not_granted` — deny-by-default
 *    khi thiếu dữ liệu (AC-002: state không đọc được không phải allow, T-14).
 * 2. **Staff status không `active`** ⇒ `staff_not_active` — invariant 5 /
 *    AC-002. Nhãn lạ (không thuộc tập ba giá trị) do caller đọc lỗi DB cũng
 *    KHÔNG được coi là active — so sánh trực tiếp với 'active'.
 * 3. **Lọc assignment còn hiệu lực:** permission có trong tập, chưa revoke
 *    (`revokedAt === null || revokedAt > now`) và chưa hết hạn
 *    (`validUntil === null || validUntil > now`) — cùng read-time filter mà
 *    schema nhắc (row giữ lại để audit, không xoá).
 * 4. Còn assignment sau lọc ⇒ allow, kèm `stale` theo TTL của risk class.
 *    Không còn ⇒ phân rộng lý do **chỉ trên các assignment cung cấp
 *    permission này** (S3): chưa từng giữ permission (`permission_not_granted`)
 *    → đã bị revoke (`assignment_revoked`) → đã tự hết hạn
 *    (`assignment_expired`) — revoke có chủ đích được audit nhìn thấy trước
 *    expiry tự nhiên (T-05/T-06).
 *
 * @param permission Định danh `domain.action` đọc từ catalog. Việc chặn
 *   permission ngoài catalog (invariant 10/AC-019) nằm ở tầng application
 *   qua catalog sống ở persistence; lib thuần này không định nghĩa
 *   catalog nên không thể tự chặn.
 * @param assignments Ảnh assignments đã đồng bộ (có thể rỗng).
 * @param now Thời điểm quyết định — caller truyền.
 * @param riskClass Risk class của operation (ADR-0002 — theo OPERATION),
 *   mặc định `normal` cho đường đọc thông thường.
 */
export function can(
  permission: CatalogPermission,
  assignments: readonly GrantedAssignment[],
  now: Date,
  riskClass: AuthorizationRiskClass = 'normal',
): AuthorizationDecision {
  const stale = isStale(assignments, now, riskClass);

  if (assignments.length === 0) {
    return { allowed: false, denial: 'permission_not_granted', riskClass, stale };
  }

  if (assignments.some((assignment) => assignment.staffStatus !== 'active')) {
    return { allowed: false, denial: 'staff_not_active', riskClass, stale };
  }

  const live = assignments.filter(
    (assignment) =>
      assignment.permissions.includes(permission) &&
      (assignment.revokedAt === null || assignment.revokedAt > now) &&
      (assignment.validUntil === null || assignment.validUntil > now),
  );

  if (live.length > 0) {
    return { allowed: true, riskClass, stale };
  }

  return classifyDenial(assignments, permission, now, stale, riskClass);
}

function classifyDenial(
  assignments: readonly GrantedAssignment[],
  permission: CatalogPermission,
  now: Date,
  stale: boolean,
  riskClass: AuthorizationRiskClass,
): AuthorizationDecision {
  const deny = (denial: AuthorizationDenialReason): AuthorizationDecision => ({
    allowed: false,
    denial,
    riskClass,
    stale,
  });
  if (!assignments.some((assignment) => assignment.permissions.includes(permission))) {
    return deny('permission_not_granted');
  }
  const candidates = assignments.filter((assignment) =>
    assignment.permissions.includes(permission),
  );
  if (
    candidates.some((assignment) => assignment.revokedAt !== null && assignment.revokedAt <= now)
  ) {
    return deny('assignment_revoked');
  }
  return deny('assignment_expired');
}

/**
 * Dữ liệu quá TTL của risk class chưa — so trên mốc `fetchedAt` **cũ nhất**
 * trong tập: một ảnh fresher không cứu ảnh khác đã cũ, vì tập quyền phải
 * được đánh giá trên một ảnh đồng bộ (batch sync của ADR-0009); nếu caller
 * fetch lệch lượt, cách an toàn là coi tổng thể theo mốc cũ nhất — `stale`
 * không bao giờ báo "fresh" cho một tập có phần cũ (fail closed).
 */
function isStale(
  assignments: readonly GrantedAssignment[],
  now: Date,
  riskClass: AuthorizationRiskClass,
): boolean {
  const ttlMs = REVOCATION_FRESHNESS_TTL_SECONDS[riskClass] * 1000;
  return assignments.some((assignment) => now.getTime() - assignment.fetchedAt.getTime() > ttlMs);
}
