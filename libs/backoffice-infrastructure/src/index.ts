export {
  DB_BACKOFFICE_BINDING,
  attachPoolErrorHandler,
  backofficeHyperdrive,
  backofficeNodeDatabaseUrl,
  buildPoolOptions,
  createNodePool,
  createPool,
  withBackofficePool,
} from './hyperdrive-pool';
export type { HyperdriveBinding } from './hyperdrive-pool';

export {
  AUTHORIZATION_AUDIT_ID_MAX_LENGTH,
  AUTHORIZATION_FAILURE_INVALID_ACTOR,
  ENFORCEMENT_DENIAL_STALE_WRITE,
  recordAuthorizationFailure,
  recordDecision,
  recordPrivilegedSuccess,
  recordStaleWriteDenial,
} from './authorization-audit';
export type {
  AuthorizationAuditContext,
  AuthorizationFailureAuditInput,
  DecisionAuditInput,
  EnforcementDenialAuditInput,
  PrivilegedOperationAuditInput,
} from './authorization-audit';

export { listPermissions, listRoles, listStaff, loadPrincipalAuthorization } from './queries';
export type { PrincipalAuthorizationData, RoleRow, StaffRow } from './queries';

export {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  SESSION_ABSOLUTE_SECONDS,
  SESSION_COOKIE_NAME,
  SESSION_ID_BYTES,
  SESSION_IDLE_SECONDS,
  createCsrfToken,
  createSessionIdentifier,
  csrfCookie,
  csrfMatches,
  clearCsrfCookie,
  clearSessionCookie,
  hashSessionIdentifier,
  insertSession,
  isSessionLive,
  loadSessionByHash,
  replaceAccessToken,
  revokeSessionByHash,
  sessionCookie,
  sessionDeadlines,
  touchSession,
} from './auth/session-store';
export type { BackofficeSessionRow } from './auth/session-store';

export { JWKS_CACHE_TTL_SECONDS, jwksResolver, resetJwksCacheForTests } from './auth/jwks';

export { verifyAccessToken } from './auth/verify';
export type {
  BackofficeAuthConfig,
  InvalidTokenResult,
  TokenVerifyResult,
  UnavailableTokenResult,
  VerifiedAccessToken,
} from './auth/verify';
