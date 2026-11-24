export { AuthConfigurationError, OAuthProtocolError, type OAuthErrorCode } from './shared/errors';

export {
  HANDLE_DOMAINS,
  MIN_TRANSACTION_ID_LENGTH,
  createTransactionId,
  assertHandleBelongsToTransaction,
  base64UrlToBytes,
  bytesToBase64Url,
  deriveHandle,
  hashHandle,
  lengthPrefixed,
  timingSafeEqual,
  type HandleDomain,
  type TransactionId,
} from './transaction/handle';

export {
  COMPLETABLE_STATES,
  AuthorizationTransaction,
  assertBrowserConfirmed,
  assertTransition,
  canTransition,
  isTerminal,
  type AuthorizationTransactionState,
} from './transaction/transaction';

export {
  MAX_CODE_VERIFIER_LENGTH,
  MIN_CODE_VERIFIER_LENGTH,
  SUPPORTED_CODE_CHALLENGE_METHOD,
  assertValidCodeVerifier,
  computeS256Challenge,
  parseCodeChallenge,
  verifyCodeChallenge,
  type ParsedCodeChallenge,
} from './authorize-request/pkce';

export {
  LOOPBACK_HOSTS,
  assertWellFormedRedirectUri,
  redirectUriMatches,
  type RedirectUriPolicy,
} from './authorize-request/redirect-uri';

export {
  MAX_NONCE_LENGTH_BYTES,
  MAX_STATE_LENGTH_BYTES,
  SUPPORTED_GRANT_TYPES,
  SUPPORTED_RESPONSE_TYPE,
  assertRegisteredRedirectUri,
  filterAllowedScopes,
  parseAuthorizationRequest,
  type AuthorizationRequest,
  type SupportedGrantType,
} from './authorize-request/authorize-request';

export {
  assertGrantCoversScope,
  assertUsableClient,
  assessRiskLevel,
  isActiveClient,
  needsConsent,
  type ClientType,
  type RiskLevel,
} from './consent/grant';

export {
  FAIL_CLOSED_ONLY_AT_ISSUANCE,
  assertRevocationCacheTtl,
  isIssuable,
  type RevocationCheckResult,
  type RevocationScope,
} from './revocation/revocation';

export { allowsIssuance, type AccountStatusValue } from './issuance/issuance-policy';

export {
  SIGNING_ALGORITHM,
  SIGNING_CURVE,
  SIGNING_KEY_TYPE,
  type PublicJwk,
  type SigningKeyMetadata,
  type SigningKeyProvider,
} from './signing-key/signing-key';
