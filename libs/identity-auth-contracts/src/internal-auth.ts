/**
 * Barrel re-export cho internal HMAC contract canonical.
 *
 * Giữ lại dưới dạng file riêng (thay vì re-export thẳng từ `@ecoma-io/identity-contracts`
 * trong `index.ts`) để một lần grep tên symbol cũ vẫn rơi vào một chỗ có chủ ý.
 *
 * ⚠️ **Đường import thật là `@ecoma-io/identity-auth-contracts`** (tức qua `index.ts`, file
 * này nằm sau `./internal-auth`). `package.json` của package chỉ khai `exports` với key
 * `"."`, nên deep subpath kiểu `@ecoma-io/identity-auth-contracts/internal-auth` bị
 * Node/bundler từ chối với `ERR_PACKAGE_PATH_NOT_EXPORTED` — đừng viết code theo đường đó.
 */
export {
  assertKid,
  assertNonceExpirySeconds,
  canonicalString,
  hashBody,
  createNonce,
  DEFAULT_SKEW_SECONDS,
  INTERNAL_BODY_LIMIT_BYTES,
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
} from '@ecoma-io/identity-contracts';
