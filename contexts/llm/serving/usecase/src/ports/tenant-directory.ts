/**
 * Port directory tenant — fail-closed step 3: tenant của key phải tồn tại.
 * Implement thật là SQL `llm_tenant.tenants`.
 */
export interface TenantDirectory {
  tenantExists(tenantId: string): Promise<boolean>;
}
