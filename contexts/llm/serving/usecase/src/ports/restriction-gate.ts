/**
 * Port restriction gate — step 6 eligibility (invariant 6: eligibility gate
 * trước strategy). Implement thật là SQL `llm_seller.restriction_records`
 * với cửa sổ nửa mở khớp `isRestrictionEffective` của governance domain.
 */
export interface RestrictionGate {
  /** true khi seller tenant đang có restriction hiệu lực chặn capability `chat`. */
  isChatRestricted(sellerTenantId: string): Promise<boolean>;
}
