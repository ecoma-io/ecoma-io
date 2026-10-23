/**
 * Barrel re-export cho internal HMAC contract canonical.
 *
 * ⚠️ **Bản cài đặt canonical nằm ở `@ecoma-io/internal-auth-contracts`** (`scope:platform`)
 * — giao thức `ecoma-internal-v1` là protocol nền tảng, không mang khái niệm identity, nên
 * nguồn sự thật của nó thuộc tầng platform. File này chỉ giữ đường import
 * `@ecoma-io/identity-auth-contracts` tiếp tục chạy cho `apps/auth` và mọi consumer đang
 * dùng — không duy trì một envelope thứ hai đã trôi khỏi bản chính.
 *
 * Giữ lại dưới dạng file riêng (thay vì re-export thẳng trong `index.ts`) để một lần grep
 * tên symbol cũ vẫn rơi vào một chỗ có chủ ý.
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
} from '@ecoma-io/internal-auth-contracts';
