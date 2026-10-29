/**
 * Định danh test dùng chung của suite — MỘT nguồn, mọi spec import từ đây.
 *
 * Hai fixture suite khác có thể chạy SONG SONG trên cùng một stack (wave 2
 * dispatch nhiều suite vào các worktree khác nhau nhưng cùng một namespace
 * local). Việc dùng tên cố định (`sub`, email, role id) kèm mọi INSERT
 * `ON CONFLICT DO NOTHING` giữ rerun và chạy lại an toàn: chạy hai lần là cùng
 * một hàng, không phải hai hàng lệch trạng thái.
 *
 * ⚠️ Định dạng `sub` bị DB chặn ở HAI đầu:
 * - `account.users.sub` — reference của `backoffice.staff` (không FK, nhưng
 *   cùng hình dạng); seed của suite khác đã dùng format `sub_<32 base32>`.
 * - `backoffice.bff_sessions.account_sub` — CHECK
 *   `^sub_[a-z2-7]{32}$` (migration `0006`): sub không đúng định dạng là
 *   INSERT phiên fail ngay ở callback, tức login chết giữa chừng.
 * - `backoffice.role_assignments.created_by_sub` — guard
 *   `role_assignments_no_self_elevation` đòi đúng regex đó + khác `staff_sub`.
 *
 * Vì vậy `TEST_SUB` là chuỗi 32 ký tự base32 viết thường (RFC 4648, không
 * padding) đúng hình dạng — và cùng giá trị được seed ở `account.users`,
 * `backoffice.staff`, `role_assignments.created_by_sub` để mọi khớp là
 * khớp theo cấu trúc, không phải trùng hợp.
 */

/** `sub` của user test — dùng cho account user, staff row, session, actor. */
export const TEST_SUB = 'sub_aclfe2euserbseaaaaaaaaaaaaaaaaaa';

/**
 * Actor khai báo trên `role_assignments.created_by_sub` — PHẢI khác `TEST_SUB`
 * (guard self-elevation của migration `0004` chặn `staff_sub = created_by_sub`
 * khi INSERT bằng runtime role; suite seed bằng `ecoma_local` là superuser
 * nên guard không kích hoạt, nhưng giữ bất invariant này là giữ seed đúng
 * hình dạng mà một lần seed lại bằng runtime role cũng sống sót).
 */
export const SEED_ACTOR_SUB = 'sub_aclfe2eactorseaaaaaaaaaaaaaaaaaa';

/** Email của user test — nhận OTP đăng nhập qua mail sink. */
export const TEST_EMAIL = 'backoffice-acl-e2e@local.test';

/** Role id test — custom role (không prefix `sys_`), gán `staff.read`. */
export const TEST_ROLE_ID = 'acl-e2e-role';

/**
 * Id một role thứ hai KHÔNG có permission nào — dùng cho khẳng định phụ:
 * role trống cung cấp `permissions = []` ⇒ `can()` deny
 * (`permission_not_granted`), độc lập với số assignment.
 */
export const TEST_EMPTY_ROLE_ID = 'acl-e2e-role-empty';

/**
 * Nhãn sub-authorize-URL của suite — không phải secret, chỉ để assertion
 * `client_id` trên redirect login.
 */
export const EXPECTED_CLIENT_ID = 'ecoma-backoffice-local';

/**
 * Kỳ vọng middleware authn trả cho caller chưa đăng nhập — ADR-0011 §1,
 * đã verify trong `apps/backoffice/server/middleware/authn.ts` (PR #358).
 */
export const UNAUTHENTICATED_STATUS = 401;
