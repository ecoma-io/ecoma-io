/**
 * `@ecoma-io/identity-domain` — value object, invariant vòng đời và policy thuần của
 * bounded context `identity`.
 *
 * Thư viện này **không** import Nx project khác, **không** SQL, **không** Node builtin
 * và **không** I/O. Mọi tham số thời gian và entropy đều do caller truyền vào.
 */

export { createSubject, isSubject, subjectEntropy, type Subject } from './subject';
export {
  ACCOUNT_STATUS,
  ACCOUNT_STATUSES,
  isAccountStatus,
  isTerminalStatus,
  isTombstone,
  type AccountStatus,
} from './account-status';
export {
  AUTHN_LEVEL,
  AUTHN_LEVELS,
  authnLevelRank,
  authnLevelSatisfies,
  compareAuthnLevels,
  isAuthnLevel,
  meetsAuthnLevel,
  type AuthnLevel,
} from './authn-level';
export {
  isExpired,
  isFresh,
  isRevoked,
  requiresReauthentication,
  type ReauthenticationRule,
  type SessionExpiry,
} from './session-policy';
export {
  DOMAIN_ERROR_MESSAGES,
  domainError,
  isDomainError,
  type DomainError,
  type DomainErrorCode,
} from './errors';
