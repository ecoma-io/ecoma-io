/**
 * Port credential attestor — step 7 credential serving verify per-request
 * (invariant 8). Implement thật là SQL `llm_marketplace.provider_credentials`
 * + `assertCredentialProvider` của marketplace domain.
 *
 * Bất invariant platform: kết quả một-bit — KHÔNG BAO GIỜ log hash detail hay
 * plaintext credential qua port này.
 */
export interface CredentialAttestor {
  /** true khi tồn tại credential active (seller-tenant + provider scope) khớp hash plaintext. */
  verifyCredential(input: {
    sellerTenantId: string;
    provider: string;
    /** Plaintext credential đọc từ env — CHỈ dùng để verify, không log/persist. */
    credentialPlaintext: string;
  }): Promise<boolean>;
}
