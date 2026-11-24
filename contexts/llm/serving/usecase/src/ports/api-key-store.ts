/**
 * Port truy cập API key row của gateway — auth serving (step 2).
 * Implement thật là SQL lookup `llm_gateway.api_keys` theo sha256(key).
 */
export interface ApiKeyRow {
  readonly id: string;
  readonly tenantId: string;
  readonly revokedAt: number | null;
}

export interface ApiKeyStore {
  /** Trả null khi không tìm thấy key — lỗi truy cập ẩn dưới port (fail-closed ở adapter). */
  findByKeyHash(keyHash: string): Promise<ApiKeyRow | null>;
}
