/**
 * Repository của `pact.entitlement_sync_state` — revision entitlement event lớn
 * nhất đã áp dụng cho mỗi cặp (staff_id, product) (roadmap P3.2).
 *
 * ⚠️ Không có FK sang database khác (one-service-one-database), `staff_id` là
 * tham chiếu opaque của Staff Access directory (không phải `sub`).
 */

import type { Pool } from 'pg';

/** Một hàng entitlement_sync_state như schema trả về. */
export interface EntitlementSyncStateRow {
  readonly staff_id: string;
  readonly product: string;
  /** `revision` về dạng string từ pg driver — Number() an toàn dưới MAX_SAFE_INTEGER. */
  readonly revision: string;
}

/**
 * Port đọc/ghi revision đã áp dụng — dùng bởi application use case
 * `provisionEntitlementMembership`.
 */
export class PgEntitlementSyncRepo {
  constructor(private readonly pool: Pool) {}

  /**
   * Revision lớn nhất đã áp dụng cho cặp (staff_id, product), hoặc `null` nếu
   * chưa thấy event nào.
   */
  async readRevision(staffId: string, product: string): Promise<number | null> {
    const { rows } = await this.pool.query<EntitlementSyncStateRow>(
      `SELECT staff_id, product, revision
         FROM pact.entitlement_sync_state
        WHERE staff_id = $1 AND product = $2`,
      [staffId, product],
    );
    const row = rows[0];
    if (row === undefined) return null;
    const revision = Number(row.revision);
    if (!Number.isInteger(revision) || revision < 0) {
      throw new Error(`entitlement sync revision is not a non-negative integer: ${row.revision}`);
    }
    return revision;
  }

  /**
   * Ghi (upsert) revision đã áp dụng cho cặp (staff_id, product) — dùng sau khi
   * membership đã được provision thành công.
   */
  async writeRevision(staffId: string, product: string, revision: number): Promise<void> {
    if (!Number.isInteger(revision) || revision < 1 || revision > Number.MAX_SAFE_INTEGER) {
      throw new Error(`entitlement sync revision must be a positive safe integer: ${revision}`);
    }
    await this.pool.query(
      `INSERT INTO pact.entitlement_sync_state (staff_id, product, revision, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (staff_id, product)
       DO UPDATE SET revision = EXCLUDED.revision, updated_at = now()
       WHERE pact.entitlement_sync_state.revision < EXCLUDED.revision`,
      [staffId, product, revision],
    );
  }
}
