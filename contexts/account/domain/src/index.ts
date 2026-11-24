/**
 * `@ecoma-io/account-domain` — domain model (aggregate, value object, invariant
 * vòng đời và policy thuần) của bounded context `identity`.
 *
 * Thư viện này **chỉ** import `@ecoma-io/domain-primitives` (type-level helpers),
 * **không** SQL, **không** Node builtin và **không** I/O. Mọi tham số thời gian
 * và entropy đều do caller truyền vào.
 *
 * Mã nguồn tổ chức theo domain concept (`account/`, `email-address/`,
 * `otp-challenge/`, `browser-session/`, `invitation/`, `login-handoff/`,
 * `authentication/`, `encoding/`, `shared/`) — API công khai duy nhất là file
 * này; không barrel index trong từng thư mục con.
 */

// — shared —
export {
  DOMAIN_ERROR_MESSAGES,
  domainError,
  isDomainError,
  type DomainError,
  type DomainErrorCode,
} from './shared/errors';

// — email-address —
export {
  hashAddressKey,
  isEmailAddressKey,
  type EmailAddressKey,
} from './email-address/email-address-key';
export {
  isNormalizedEmailAddress,
  normalizeEmailAddress,
  type NormalizedEmailAddress,
} from './email-address/normalized-email-address';

// — account —
export { Account, type AccountSnapshot, type EmailAddressView } from './account/account';
export {
  ACCOUNT_STATUS,
  ACCOUNT_STATUSES,
  isAccountStatus,
  isTerminalStatus,
  isTombstone,
  type AccountStatus,
} from './account/account-status';
export { createSubject, isSubject, subjectEntropy, type Subject } from './account/subject';

// — invitation —
export {
  INVITATION_STATE,
  INVITATION_TTL_SECONDS,
  INVITATION_TRANSITIONS,
  Invitation,
  type InvitationId,
  type InvitationRejectionReason,
  type InvitationSnapshot,
  type InvitationState,
} from './invitation/invitation';

// — otp-challenge —
export {
  MAX_OTP_ATTEMPTS,
  OTP_CODE_DIGITS,
  OTP_RATE_LIMIT_HOUR_MAX,
  OTP_RATE_LIMIT_HOUR_WINDOW_SECONDS,
  OTP_RATE_LIMIT_SHORT_MAX,
  OTP_RATE_LIMIT_SHORT_WINDOW_SECONDS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  OTP_PURPOSE_LOGIN,
  OTP_PURPOSE_VERIFY_EMAIL,
  OtpChallenge,
  isOtpChallengeId,
  type OtpChallengeId,
  type OtpChallengeSnapshot,
  type OtpDigest,
  type OtpPurpose,
  type OtpTerminalReason,
} from './otp-challenge/otp-challenge';

// — browser-session —
export {
  ANONYMOUS_SESSION_TTL_SECONDS,
  AUTHENTICATED_ABSOLUTE_TTL_SECONDS,
  AUTHENTICATED_IDLE_TTL_SECONDS,
  BROWSER_SESSION_STATE,
  BROWSER_SESSION_TRANSITIONS,
  BrowserSession,
  type BrowserSessionSnapshot,
  type BrowserSessionState,
  type SessionRef,
} from './browser-session/browser-session';

// — login-handoff —
export {
  LOGIN_HANDOFF_STATE,
  LOGIN_HANDOFF_TTL_SECONDS,
  LOGIN_HANDOFF_TRANSITIONS,
  LoginHandoff,
  type HandleHash,
  type LoginHandoffSnapshot,
  type LoginHandoffState,
} from './login-handoff/login-handoff';

// — authentication —
export {
  ACR,
  ACR_VALUES,
  acrSetFor,
  acrSatisfies,
  isAcr,
  isAcrShape,
  type Acr,
} from './authentication/acr';
export {
  isExpired,
  isFresh,
  isRevoked,
  requiresReauthentication,
  type ReauthenticationRule,
  type SessionExpiry,
} from './authentication/session-policy';
export { base32Decode, base32Encode, Base32DecodeError } from './encoding/base32';
export {
  computeTotp,
  decodeTotpSecret,
  DEFAULT_TOTP_ALGORITHM,
  generateTotpSecret,
  MIN_TOTP_SECRET_BYTES,
  otpauthUri,
  TOTP_ALLOWED_DRIFT_STEPS,
  TOTP_DIGITS,
  TOTP_EPOCH_SECONDS,
  TOTP_STEP_SECONDS,
  totpCounterAt,
  type TotpAlgorithm,
  type TotpVerification,
  verifyTotp,
} from './authentication/totp';
export {
  createRecoveryCode,
  formatRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  RECOVERY_CODE_ENTROPY_BYTES,
  RECOVERY_CODE_GROUPS,
  RECOVERY_CODES_PER_SET,
  RECOVERY_HASH_BITS,
  RECOVERY_HASH_ITERATIONS,
  RECOVERY_SALT_BYTES,
  type RecoveryCode,
  verifyRecoveryCode,
} from './authentication/recovery-codes';
