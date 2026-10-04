/**
 * `@ecoma-io/identity-contracts` — boundary artifact của bounded context `identity`.
 *
 * ⚠️ **Project này KHÔNG import `@ecoma-io/identity-domain`.** Constraint `type:contracts`
 * trong `.oxlintrc.json` cấm phụ thuộc `type:domain` (kể cả transitive), và đó là đúng:
 * contract là thứ provider **publish** để consumer phụ thuộc vào, không phải một tầng để
 * đi theo chiều phụ thuộc. Vì vậy `authn_level` được khai báo lại bằng union `wire` ở đây
 * thay vì import union của tầng domain.
 *
 * Project cũng không chứa domain logic: chỉ shape của message, validator hình thức và
 * envelope HMAC dùng chung cho cả caller lẫn callee.
 */

export {
  assertNonceExpirySeconds,
  INTERNAL_BODY_LIMIT_BYTES,
  hashBody,
  canonicalString,
  createNonce,
  DEFAULT_SKEW_SECONDS,
  InvalidCanonicalFieldError,
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
export {
  AUTHN_LEVEL_VALUES,
  FORBIDDEN_SESSION_VERIFIED_FIELDS,
  REQUIRED_SESSION_VERIFIED_FIELDS,
  validateSessionVerifiedRequest,
  type AuthnLevelValue,
  type SessionVerifiedOutcome,
  type SessionVerifiedRejectionReason,
  type SessionVerifiedRequest,
  type SessionVerifiedResponse,
  type SessionVerifiedValidation,
} from './session-verified';
export {
  ACCOUNT_STATUS_RESPONSE_VALUES,
  accountStatusResponse,
  FORBIDDEN_ACCOUNT_STATUS_FIELDS,
  isAccountStatusResponseValue,
  validateAccountStatusResponse,
  type AccountStatusRejectionReason,
  type AccountStatusResponse,
  type AccountStatusResponseValue,
  type AccountStatusValidation,
} from './account-status-contract';
