import type { Handle, HandleHash, TransactionId } from './types.js';

/**
 * Port cryptography cho handle X/Y/Z và browser binding.
 * Wraps auth-domain's handle functions (deriveHandle, hashHandle, timingSafeEqual)
 * phía sau một interface để Use Case không phụ thuộc WebCrypto implementation detail
 * và để unit tests mock được.
 *
 * Domain separation: mỗi HandleDomain một derivation độc lập từ cùng K_auth.
 */
export type HandleDomain = 'login-handoff' | 'consent-continuation' | 'authorization-code';

export interface HandleService {
  /** HMAC-SHA-256(K_auth, lengthPrefixed(domain, transactionId)) → base64url. */
  deriveHandle(input: { transactionId: TransactionId; domain: HandleDomain }): Promise<Handle>;

  /** SHA-256 base64url của handle — dạng at-rest. */
  hashHandle(handle: Handle): Promise<HandleHash>;

  /** Constant-time so sánh hai hash. */
  hashEquals(a: HandleHash, b: HandleHash): boolean;

  /**
   * Xác thực browser binding: so hash cookie `__Host-auth-browser` với hash đã lưu,
   * constant-time. Không ném lỗi — trả boolean, use case quyết định failure semantics.
   */
  browserBindingMatches(presentedBinding: string, storedBindingHash: HandleHash): Promise<boolean>;
}
