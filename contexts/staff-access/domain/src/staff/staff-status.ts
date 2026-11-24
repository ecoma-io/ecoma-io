/**
 * Truc **staff status** — trang thai membership cua mot staff member trong
 * staff directory cua bounded context `staff-access`.
 *
 * Nguon chan ly hien nay la chinh lib nay. Quy uoc (invariant 8, ADR-0013):
 * staff status va account status la hai truc doc lap; ownership thuoc
 * `staff-access`, tru trang thai khong doi theo ownership.
 *
 * ⚠️ **Hai truc doc lap, khong suy ra nhau:**
 * - `account.status` (`active` | `suspended` | `deleted`) do `account` so huu.
 *   Suspend/delete account o
 *   `account` KHONG tu viet lai staff status o day — khong co duong ghi ngam
 *   nao giua hai ben.
 * - `terminated` o staff-access KHONG tu suspend account.
 *
 * ⚠️ **Tap nhan ba gia tri la DE XUAT, chua chot** ("Tap nhan nay
 * chua chot; dieu da chot la no la truc rieng"). Dieu ghim o day la **su tach
 * truc** va **`terminated` la trang thai cuoi**, khong phai tung chu. Wire
 * type tuong ung nam o `@ecoma-io/staff-access-contracts` (`StaffStatus`) —
 * lib nay khai bao lai cung tap nhan vi `type:domain` khong duoc import
 * `type:contracts` (module boundary cua `.oxlintrc.json`); hai ben doi nhau
 * bang test ghim (xem `staff-status.spec.ts`).
 *
 * `terminated` la trang thai KET THUC cua membership: khoi phuc membership
 * sau khi terminated la **thao tac moi co audit**, khong phai mot
 * transition trong module nay. Khong co ham nao chuyen `terminated` sang trang
 * thai khac — cung hinh thuc voi tombstone cua
 * `libs/account-domain/src/account/account-status.ts`.
 */

/** Tap trang thai hop le, dung lam nguon cho union va type guard. */
export const STAFF_ACCESS_STAFF_STATUS = {
  Active: 'active',
  Suspended: 'suspended',
  Terminated: 'terminated',
} as const;

/** Union cua trang thai staff. */
export type StaffAccessStaffStatus =
  (typeof STAFF_ACCESS_STAFF_STATUS)[keyof typeof STAFF_ACCESS_STAFF_STATUS];

/** Mang trang thai, thu tu khong mang y nghia nghiep vu. */
export const STAFF_ACCESS_STAFF_STATUSES = [
  STAFF_ACCESS_STAFF_STATUS.Active,
  STAFF_ACCESS_STAFF_STATUS.Suspended,
  STAFF_ACCESS_STAFF_STATUS.Terminated,
] as const;

/** Type guard cho `StaffAccessStaffStatus` — du lieu doc tu DB/contract qua ham nay. */
export function isStaffAccessStaffStatus(value: unknown): value is StaffAccessStaffStatus {
  return (
    typeof value === 'string' && (STAFF_ACCESS_STAFF_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Trang thai ket thuc cua membership — chi `terminated` la terminal.
 *
 * `suspended` con duong quay lai `active`; `terminated` khong co transition
 * nao di ra o tang domain. CHECK/trigger cua migration
 * (`databases/staff-access-db/migrations/0001_staff_access_domain.sql`) va tang
 * application deu neo vao cung tap nay.
 */
export function isTerminalStaffAccessStatus(status: StaffAccessStaffStatus): boolean {
  return status === STAFF_ACCESS_STAFF_STATUS.Terminated;
}

/**
 * Bảng chuyển trạng thái của staff status — nguồn cho table-driven tests.
 *
 * `active ⇄ suspended`; `terminated` là terminal (không đường ra): khôi phục
 * membership sau khi terminated là **thao tác mới có audit** (staff entry mới),
 * không phải transition.
 */
export const STAFF_ACCESS_STAFF_TRANSITIONS: Record<
  StaffAccessStaffStatus,
  readonly StaffAccessStaffStatus[]
> = {
  active: [STAFF_ACCESS_STAFF_STATUS.Suspended, STAFF_ACCESS_STAFF_STATUS.Terminated],
  suspended: [STAFF_ACCESS_STAFF_STATUS.Active, STAFF_ACCESS_STAFF_STATUS.Terminated],
  terminated: [],
};
