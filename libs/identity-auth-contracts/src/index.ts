/**
 * `@ecoma-io/identity-auth-contracts` — góc nhìn phía `auth` của internal contract.
 *
 * ⚠️ **Chỉ re-export, trừ một ngoại lệ có tên.** Bản cài đặt canonical nằm ở
 * `@ecoma-io/identity-contracts` — `internal-auth.ts` cho protocol, `session-verified.ts`
 * và `account-status-contract.ts` cho DTO. Project này giữ cho đường dẫn import
 * `@ecoma-io/identity-auth-contracts` tiếp tục chạy cho `apps/auth` và mọi consumer
 * đang dùng — không duy trì một envelope hay một DTO thứ hai đã trôi khỏi bản chính.
 *
 * Ngoại lệ: `index.ts` này **không** tự khai gì cả, nhưng `./internal-contracts` có khai
 * cục bộ năm type `Consent*` và hàm `allowsIssuance` — `identity-contracts` chưa có bản
 * canonical cho nhóm này. Khi
 * `identity-contracts` có bản canonical cho nhóm đó thì chúng cũng phải chuyển thành
 * re-export như phần còn lại.
 *
 * ⚠️ **Hướng của `/internal/consent/*` là `account → auth`, không phải ngược lại.** Comment
 * ở đây từng ghi "`account` là bên cung cấp `/internal/consent/*`", ngược với bảng §5.1.7 của
 * `docs/services/auth/01-architecture.md`: `auth` là **provider** (route nằm trên không gian
 * tên của provider), `account` là **consumer**. Đọc sai hướng ở đây dẫn tới việc dựng một
 * route `/internal/consent/*` trong `account` — tức hai bản cài đặt cho một contract, đúng
 * thứ PR hợp nhất này dẹp. `getConsentContext`/`submitConsent` là **lời gọi do `account`
 * phát ra**, không phải hàm `auth` gọi vào `account`. Danh sách khai báo cục bộ được canh bởi
 * `internal-contracts.spec.ts` — sửa danh sách ở đó là sửa allowlist, không chỉ sửa comment.
 *
 * Bề mặt internal-HMAC **cố ý** thu hẹp: `verifyEnvelope`, `verifyEnvelopeFromHeaders`,
 * `signCanonicalString`, dạng object của `canonicalString`, cách tách `HEADER_*` /
 * `EXTERNAL_HEADER_*` và bảng lý do cũ đều đã bỏ. Đó chính là những phần đã trôi lệch
 * giữa `auth` và `account`.
 */

export {
  FORBIDDEN_SESSION_VERIFIED_FIELDS,
  allowsIssuance,
  isAccountStatusResponseValue,
  type AccountStatus,
  type AccountStatusResponse,
  type AcrUrn,
  type ConnectedApplicationGrant,
  type ConnectedApplicationRevokeRequest,
  type ConnectedApplicationRevokeResponse,
  type ConnectedApplicationsRequest,
  type ConnectedApplicationsResponse,
  type ConsentContextRequest,
  type ConsentContextResponse,
  type ConsentDecideRequest,
  type ConsentDecideResponse,
  type ConsentDecision,
  type SessionVerifiedOutcome,
  type SessionVerifiedRequest,
  type SessionVerifiedResponse,
} from './internal-contracts';

export {
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
  assertKid,
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
