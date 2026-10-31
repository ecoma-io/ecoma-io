/**
 * Use case `provisionEntitlementMembership` — áp dụng event entitlement vào
 * membership Pact Broker (roadmap P3.2, issue #457).
 *
 * ⚠️ Đây là application layer: **không SQL, không HTTP framework, không Node
 * builtin**. Mọi I/O đi qua port (`MembershipRepo`, `EntitlementSyncRepo`), mọi
 * ngưỡng là tham số. Quyết định áp dụng event dùng `shouldApplyEntitlementEvent`
 * (pure, P2.3) — compare-and-drop theo `revision`.
 *
 * Ranh giới entitlement ≠ authorization (ADR-0009): event chỉ mang "tính khả
 * dụng sản phẩm", không mang role/permission. Khi event `entitlement.granted`
 * cho `product: 'pact-broker'`, provision membership role `Member` vào
 * `pact.tenant_members` (sub = event.staff_id, vì `sub` là tham chiếu opaque
 * không FK — xem `docs/domains/pact-broker/01-architecture.md` §3.1).
 * Event `entitlement.revoked`: ghi nhận revision để consumer idempotent, KHÔNG
 * xóa membership (P3.3 sở hữu logic thu hồi). Event cho sản phẩm khác
 * `pact-broker`: bỏ qua lặng (không phải sản phẩm của bounded context này).
 *
 * ⚠️ `staff_id` → `sub`: event mang `staff_id` (định danh Staff Access
 * directory, không phải `sub`), không thể mở rộng envelope (contract P1.2 đã
 * lock), và one-service-one-database cấm pact-broker-api query db-staff-access
 * để resolve staff_id→sub. Do đó `sub` nhận trực tiếp `event.staff_id` — hợp
 * lệ vì `sub` là opaque, không FK, mapping sub→staff là server-side của Staff
 * Access (ADR-0012 §4).
 */

import { shouldApplyEntitlementEvent } from '@ecoma-io/staff-access-contracts';
import type { EntitlementEvent } from '@ecoma-io/staff-access-contracts';

/** Sản phẩm mà bounded context pact-broker quan tâm — provison membership khi granted. */
export const PRODUCT_PACT_BROKER = 'pact-broker';

/** Role ban đầu khi provision entitlement: Member (trừ khi quy trình quản trị rõ ràng khác). */
export const DEFAULT_MEMBER_ROLE = 'member';

/** Kết quả một lượt áp dụng event. */
export interface ProvisionEntitlementMembershipResult {
  /** Có áp dụng event vào DB hay không. */
  readonly applied: boolean;
  /** Lý do: `first`/`newer`/`duplicate`/`stale`/`invalid`/`not-product`. */
  readonly reason: 'first' | 'newer' | 'duplicate' | 'stale' | 'invalid' | 'not-product';
}

/** Port đở/ghi revision đã áp dụng cho cặp (staff_id, product). */
export interface EntitlementSyncRepo {
  /** Revision lớn nhất đã áp dụng, hoặc `null` nếu chưa thấy event nào. */
  readRevision(staffId: string, product: string): Promise<number | null>;
  /** Ghi (upsert) revision đã áp dụng cho cặp (staff_id, product). */
  writeRevision(staffId: string, product: string, revision: number): Promise<void>;
}

/** Port đảm bảo tenant + upsert membership. */
export interface MembershipRepo {
  /** Bảo đảm tenant `name` tồn tại active, trả id. Idempotent, race-safe. */
  ensureTenant(name: string): Promise<string>;
  /** Upsert membership `(tenant_id, sub, role)` — DO NOTHING nếu đã có. */
  upsertMember(tenantId: string, sub: string, role: string): Promise<void>;
}

/**
 * Áp dụng một entitlement event vào membership Pact Broker.
 *
 * @returns `{ applied, reason }` — composition root dịch ra log một dòng,
 * không dựng response HTTP hay lỗi exposing nội bộ.
 */
export async function provisionEntitlementMembership(
  event: EntitlementEvent,
  deps: { membership: MembershipRepo; sync: EntitlementSyncRepo },
): Promise<ProvisionEntitlementMembershipResult> {
  // Chỉ quan tâm sản phẩm của chính bounded context này.
  if (event.product !== PRODUCT_PACT_BROKER) {
    return { applied: false, reason: 'not-product' };
  }

  // So revision theo cặp (staff_id, product) — compare-and-drop.
  // ⚠️ readRevision → decide → writeRevision là hai port call riêng biệt, không
  // atomic. Khi nhiều consumer instance xử lý song song cùng cặp, cả hai có thể
  // cùng read revision cũ, cùng decide `apply` và cùng ghi. Bảo vệ thực tế nằm
  // ở infra: `writeRevision` upsert có điều kiện `WHERE revision <
  // EXCLUDED.revision` (CAS) nên chỉ write nào tăng thực sự; membership
  // upsert là `ON CONFLICT DO NOTHING` (idempotent). Kết quả: revision luôn
  // tiến lên, không lùi, không duplicate apply side effect.
  const current = await deps.sync.readRevision(event.staff_id, event.product);
  const decision = shouldApplyEntitlementEvent(current, event);
  if (!decision.apply) {
    return { applied: false, reason: decision.reason };
  }

  // Event `entitlement.revoked`: ghi nhận revision để consumer idempotent
  // (không bị xử lý lại sau này), KHÔNG xóa membership — P3.3 sở hữu logic
  // thu hồi, P3.2 chỉ đợi sự kiện này để đánh dấu revision đã thấy.
  if (event.type === 'entitlement.revoked') {
    await deps.sync.writeRevision(event.staff_id, event.product, event.revision);
    return { applied: false, reason: decision.reason };
  }

  // `entitlement.granted`: bảo đảm tenant `ecoma-internal` tồn tại, rồi upsert
  // membership role Member, sau đó ghi revision đã áp dụng.
  const tenantId = await deps.membership.ensureTenant('ecoma-internal');
  await deps.membership.upsertMember(tenantId, event.staff_id, DEFAULT_MEMBER_ROLE);

  // Ghi revision đã áp dụng cùng lúc (state + event cùng transaction ở infra,
  // nhưng ở application layer hai đường gọi là tuần tự — infra đảm bảo atomic).
  await deps.sync.writeRevision(event.staff_id, event.product, event.revision);

  return { applied: true, reason: decision.reason };
}

export type { EntitlementEvent };
