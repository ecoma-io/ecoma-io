/**
 * Port rate limit — enforcement durable, không node-local (§6.4); trạng thái giới
 * hạn bền vững là authority.
 */
export interface MailRateLimitStorePort {
  /**
   * Tiêu một slot cho `scope`. Scope do caller dựng — port không biết về ngữ nghĩa
   * principal/system/key, chỉ biết đếm.
   */
  tryConsume(input: {
    readonly scope: string;
    readonly limit: number;
    readonly windowMs: number;
    readonly nowMs: number;
  }): Promise<
    | { readonly kind: 'allowed'; readonly hits: number; readonly windowStartedAtMs: number }
    | { readonly kind: 'denied'; readonly hits: number; readonly windowStartedAtMs: number }
  >;
}

/** Ngưỡng rate limit của một scope; giá trị vận hành chốt ở deploy, không phải schema. */
export interface MailRateLimitPolicy {
  readonly limit: number;
  readonly windowMs: number;
}
