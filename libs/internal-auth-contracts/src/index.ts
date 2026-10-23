/**
 * `@ecoma-io/internal-auth-contracts` — contract của giao thức internal HMAC
 * `ecoma-internal-v1`, platform-neutral (`scope:platform`).
 *
 * ⚠️ **Một bản cài đặt duy nhất.** File `./internal-auth` là nguồn sự thật của giao thức;
 * package này không có bản cài đặt thứ hai và không cho phép một bản nào xuất hiện.
 * Consumer phụ thuộc trực tiếp package này (`apps/account`, `apps/auth`,
 * `apps/transactional-mail`, `apps/transactional-mailer-job`); `identity-contracts` và
 * `identity-auth-contracts` re-export lại từ đây nên đường import cũ của account/auth
 * giữ nguyên hoạt động.
 *
 * ⚠️ **Không identity-domain logic.** Giao thức không mang principal, user hay permission
 * — receiver tự suy consumer từ credential đã khớp trong registry của nó. Bất kỳ khái niệm
 * thuộc một bounded context nào lọt vào đây là vi phạm taxonomy `scope:platform`
 * (`docs/overview/05-code-architecture.md`), và `pnpm dx arch-check` chặn consumer
 * `scope:messaging` phụ thuộc contracts của `scope:identity` — đường đi hợp lệ duy nhất
 * cho giao thức này là package platform.
 */

export {
  assertKid,
  assertNonceExpirySeconds,
  INTERNAL_BODY_LIMIT_BYTES,
  hashBody,
  canonicalString,
  createNonce,
  DEFAULT_SKEW_SECONDS,
  InvalidCanonicalFieldError,
  InvalidKidError,
  INTERNAL_KID_HEADER,
  isValidNonceExpirySeconds,
  MAX_NONCE_CHARS,
  MAX_NONCE_EXPIRY_EPOCH_SECONDS,
  MAX_SKEW_SECONDS,
  MIN_SKEW_SECONDS,
  NONCE_TTL_BUFFER_SECONDS,
  PROTOCOL_ID,
  INTERNAL_NONCE_HEADER,
  INTERNAL_SIGNATURE_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  isStrongNonce,
  resolveSkewSeconds,
  signRequest,
  timingSafeEqualHex,
  verifyRequest,
  type InternalAuthHeaders,
  type SignRequestInput,
  type VerifyFailureReason,
  type VerifyRequestInput,
  type VerifyResult,
} from './internal-auth';
