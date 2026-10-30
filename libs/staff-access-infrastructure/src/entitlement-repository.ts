import type { StaffAccessQueryable } from './postgres';

/**
 * Repository của `staff_access.entitlements` — read model gốc của tính khả
 * dụng sản phẩm (ADR-0009: entitlement ≠ authorization; entry chỉ mang
 * product availability, KHÔNG verdict/permission/role).
 *
 * ⚠️ **`revision` tăng đơn điệu theo `(staff_id, product)`** — trigger
 * `entitlements_revision_monotonic` của schema bảo đảm +1 trên mỗi lần đổi
 * trạng thái; repo KHÔNG nhận `revision` từ caller. Consumer so revision
 * (compare-and-drop) thay vì so `occurred_at` — hợp đồng của event/read model
 * (`entitlement-read-contract.ts` của contracts).
 *
 * Cơ chế lan truyền (outbox/queue/pull) KHÔNG nằm ở đây — Phase 2 (ADR-0002,
 * P2.5); Milestone A chỉ có bảng và đường upsert nội bộ.
 */

/** Một hàng entitlement như schema trả về. */
export interface EntitlementRow {
  readonly staff_id: string;
  readonly product: string;
  /** `entitled | revoked` — revoked là trạng thái ghi nhận, không xoá entry. */
  readonly status: string;
  readonly revision: string;
  readonly occurred_at: string;
}

/**
 * Ghi trạng thái entitlement mới cho một cặp (staff, product).
 *
 * Đúng một câu `INSERT ... ON CONFLICT DO UPDATE`: hai request đồng thời cho
 * cùng cặp được PostgreSQL trọng tài bằng UNIQUE `(staff_id, product)` —
 * không có read-then-write nào có thể rớt revision. Trigger của schema sẽ
 * tính revision kế tiếp; `now()` là mốc hiệu lực duy nhất được ghi.
 */
export async function upsertEntitlement(
  db: StaffAccessQueryable,
  entry: {
    readonly staffId: string;
    readonly product: string;
    readonly status: 'entitled' | 'revoked';
  },
): Promise<void> {
  await db.unsafe(
    `INSERT INTO staff_access.entitlements (staff_id, product, status)
     VALUES ($1, $2, $3)
     ON CONFLICT (staff_id, product)
     DO UPDATE SET status = EXCLUDED.status,
                   occurred_at = now(),
                   -- revision giữ nguyên giá trị cũ ở bước SET: EXCLUDED.revision
                   -- là default 1 (INSERT không truyền revision) và trigger
                   -- monotonic sẽ bump từ OLD — giữ NEW < OLD ở đây là làm lần
                   -- upsert thứ hai của cùng cặp chết ở guard (bug round 3,
                   -- 41070536326).
                   revision = staff_access.entitlements.revision`,
    [entry.staffId, entry.product, entry.status],
  );
}

/** Đọc trạng thái hiện hành của một cặp (staff, product). */
export async function getEntitlement(
  db: StaffAccessQueryable,
  staffId: string,
  product: string,
): Promise<EntitlementRow | null> {
  const rows = await db.unsafe<EntitlementRow>(
    `SELECT staff_id, product, status, revision, occurred_at
       FROM staff_access.entitlements
      WHERE staff_id = $1 AND product = $2`,
    [staffId, product],
  );
  return rows[0] ?? null;
}

/**
 * Đọc toàn bộ entitlement của một staff — đường cho đồng bộ consumer khi cần
 * re-sync (batch/event-based per ADR-0009; không có sync-call per request).
 */
export async function listEntitlementsForStaff(
  db: StaffAccessQueryable,
  staffId: string,
): Promise<readonly EntitlementRow[]> {
  return db.unsafe<EntitlementRow>(
    `SELECT staff_id, product, status, revision, occurred_at
       FROM staff_access.entitlements
      WHERE staff_id = $1
      ORDER BY product`,
    [staffId],
  );
}
