/**
 * `@ecoma-io/staff-access-domain` — Rich Domain Model của bounded context
 * `staff-access` (staff directory, permission catalog shape, role, role
 * assignment, LLM product entitlement, authorization policy thuần) — trách
 * nhiệm đã chuyển từ `backoffice` sang context này theo ADR-0013.
 *
 * Thư viện này **không** import Nx project khác ngoài `domain-primitives`,
 * **không** SQL, **không** Node builtin và **không** I/O. Mọi tham số thời
 * gian do caller truyền vào; domain không đọc đồng hồ.
 *
 * ## Ràng buộc chưa chốt — không âm thầm chốt trong lib này
 *
 * - **Tập nhãn staff status là ĐỀ XUẤT**: lib ghim
 *   sự tách trục và terminal của `terminated`, không chốt từng nhãn.
 * - **Không có permission cụ thể nào được phát minh ở đây**: nội dung catalog
 *   là seed migration có review; lib chỉ định nghĩa hình dạng danh đánh dấu.
 * - **Không có nội dung role system nào ở đây**: role contents phải xuất phát
 *   từ catalog thực tế (ADR-0004).
 * - **Custom role administration không bật** (ADR-0004): aggregate Role vẫn
 *   mô hình hóa kind vì persistence CHECK có, nhưng không có API quản trị
 *   role custom nào.
 * - **Không có mechanism outbox/transport nào ở đây**: delivery mechanism
 *   (ADR-0014/0016) chưa dựng; revision của entitlement chỉ là số thứ tự
 *   tăng đơn điệu.
 * - **Không có policy runtime nào cấm self-assignment ngoài guard hình thức**
 *   của RoleAssignment: enforcement thuộc tầng application/resource-owning
 *   backend (SR-005).
 */

// — shared —
export {
  STAFF_ACCESS_DOMAIN_ERROR_MESSAGES,
  isStaffAccessDomainError,
  staffAccessDomainError,
  type StaffAccessDomainError,
  type StaffAccessDomainErrorCode,
} from './shared/errors';

// — staff —
export { Staff, STAFF_DISPLAY_NAME_MAX_LENGTH, type StaffSnapshot } from './staff/staff';
export {
  STAFF_ACCESS_STAFF_STATUS,
  STAFF_ACCESS_STAFF_STATUSES,
  STAFF_ACCESS_STAFF_TRANSITIONS,
  isStaffAccessStaffStatus,
  isTerminalStaffAccessStatus,
  type StaffAccessStaffStatus,
} from './staff/staff-status';
export {
  STAFF_ID_ENTROPY_CHARS,
  createStaffId,
  isStaffId,
  staffIdEntropy,
  type StaffId,
} from './staff/staff-id';
export {
  ACCOUNT_SUBJECT_PREFIX,
  ACCOUNT_SUBJECT_ENTROPY_CHARS,
  ACCOUNT_SUBJECT_MIN_ENTROPY_BITS,
  accountSubjectFrom,
  isAccountSubject,
  type AccountSubject,
} from './staff/account-subject';

// — permission —
export { isPermissionId, permissionIdFrom, type PermissionId } from './permission/permission-id';

// — role —
export {
  ROLE_KIND,
  ROLE_NAME_MAX_LENGTH,
  ROLE_STATE,
  ROLE_TRANSITIONS,
  Role,
  type RoleId,
  type RoleKind,
  type RoleSnapshot,
  type RoleState,
} from './role/role';

// — role-assignment —
export {
  RoleAssignment,
  type AssignmentScope,
  type RoleAssignmentId,
  type RoleAssignmentSnapshot,
} from './role-assignment/role-assignment';

// — llm-access —
export {
  LLM_ACCESS_STATE,
  LLM_ACCESS_TRANSITIONS,
  LLM_PRODUCT,
  LlmAccess,
  type LlmAccessSnapshot,
  type LlmAccessState,
  type LlmProduct,
} from './llm-access/llm-access';

// — authorization —
export {
  REVOCATION_FRESHNESS_TTL_SECONDS,
  can,
  type AuthorizationDecision,
  type AuthorizationDenialReason,
  type AuthorizationMode,
  type AuthorizationRiskClass,
  type CatalogPermission,
  type GrantedAssignment,
} from './authorization/authorization-policy';
