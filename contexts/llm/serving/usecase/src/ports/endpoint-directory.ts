/**
 * Port endpoint directory — step 7 routing: endpoint pool healthy của offer.
 * Implement thật là SQL `llm_marketplace.upstream_endpoints` JOIN endpoint_pools
 * (binding marketplace).
 */
export interface EndpointDirectory {
  /** Endpoint healthy của offer; null khi không có (no_candidate). */
  findHealthyEndpoint(offerId: string): Promise<{ url: string; protocol: string } | null>;
}
