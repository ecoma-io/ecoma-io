/**
 * `@ecoma-io/pact-broker-api-application` — use case và port của bounded
 * context `pact-broker` cho deploy unit `pact-broker-api`: lõi quyết định
 * machine-token auth (qua port `TokenRepo` do infrastructure cài) và crypto
 * primitives WebCrypto dùng chung giữa auth và repo layer.
 *
 * Thư viện này **không** import infrastructure, **không** SQL, **không**
 * HTTP framework (Hono) và **không** Node builtin. WebCrypto là Web API nền
 * tảng — cùng quy ước `libs/identity-auth-domain`.
 */

export { authorizeToken, hashToken, scopeSatisfied } from './token-auth';
export type { TokenDecision, TokenLookupResult, TokenRepo } from './token-auth';

export { randomToken, sha256Hex } from './hashing';
