/**
 * `@ecoma-io/llm-consumer-routing-domain` — domain library thuần cho bounded
 * context `llm-consumer-routing`: model alias, routing policy, candidate selection, fallback
 * hai cấp, config version/snapshot. Pure TypeScript, không I/O, không database,
 * không HTTP, không Node builtin, không global mutable state.
 *
 * Thời gian, cursor, randomness được caller truyền vào; domain không đọc đồng
 * hồ và không sinh số ngẫu nhiên.
 *
 * ## Ranh với các bounded context khác
 *
 * - Pricing calculation/catalog → `llm-seller-pricing` (domain không tính giá).
 * - Reserve/settle quota → `llm-api` (A7) — domain không reserve/settle.
 * - Dispatch/provider execution → `llm-inference` — domain không dispatch.
 * - Tenant/membership/workspace → `llm-consumer-tenant` — domain nhận facts làm input.
 * - Seller offer/model catalog/upstream endpoint → `llm-marketplace`.
 *
 * Domain không import Nx project nào khác ngoài `@ecoma-io/domain-primitives`
 * (type:domain).
 *
 * Mã nguồn tổ chức theo domain concept (`alias/`, `policy/`, `candidate/`,
 * `eligibility/`, `strategy/`, `fallback/`, `snapshot/`, `shared/`) — API công
 * khai duy nhất là file này; không barrel index trong từng thư mục con.
 */

// — shared —
export type { DomainOk, DomainRejection } from './shared/shared';
export {
  isNonEmptyString,
  isEpochMillis,
  isFiniteNumber,
  isNonNegativeInteger,
  isPositiveInteger,
} from './shared/shared';

export type { RoutingDomainErrorCode, RoutingDomainError } from './shared/errors';
export {
  ROUTING_DOMAIN_ERROR_MESSAGES,
  isRoutingDomainError,
  routingDomainError,
} from './shared/errors';

// — alias —
export type {
  ModelAlias,
  AliasStatus,
  AliasRecord,
  ModelAliasSnapshot,
  ResolveAliasResult,
  RetireAliasResult,
} from './alias/alias';
export {
  ALIAS_STATUS,
  ModelAliasAggregate,
  isModelAlias,
  isAliasStatus,
  isAliasRecord,
  resolveAlias,
  retireAlias,
} from './alias/alias';

// — policy —
export type {
  RoutingPolicy,
  RoutingPolicyId,
  RoutingPolicySnapshot,
  CreatePolicyResult,
} from './policy/policy';
export {
  RoutingPolicyAggregate,
  isRoutingPolicyId,
  isRoutingPolicy,
  createPolicy,
} from './policy/policy';

// — candidate —
export type {
  CandidateId,
  CandidateStatus,
  CandidateCapability,
  Candidate,
} from './candidate/candidate';
export {
  CandidateAggregate,
  CANDIDATE_STATUS,
  isCandidateId,
  isCandidateStatus,
  isCandidateCapability,
  isCandidate,
  createCandidateId,
} from './candidate/candidate';

// — eligibility —
export type {
  EligibilityDenialReason,
  EligibilityFacts,
  CandidateEligibility,
} from './eligibility/eligibility';
export {
  evaluateEligibility,
  evaluateCandidateEligibility,
  filterEligible,
} from './eligibility/eligibility';

// — strategy —
export type {
  RoutingStrategy,
  RoundRobinCursor,
  PriceFact,
  RoundRobinResult,
  RoutingStrategyResult,
} from './strategy/strategy';
export {
  ROUTING_STRATEGY,
  isRoutingStrategy,
  isRoundRobinCursor,
  isPriceFact,
  selectByPriority,
  selectRoundRobin,
  selectLowestPrice,
  selectCandidate,
} from './strategy/strategy';

// — snapshot —
export type { RoutingPolicyVersion, FallbackConfig, RoutingSnapshot } from './snapshot/snapshot';
export {
  isRoutingPolicyVersion,
  isRoutingSnapshot,
  buildSnapshot,
  freezeSnapshot,
} from './snapshot/snapshot';

// — fallback —
export type { ExecutionEvidence, FallbackDecision, FallbackInputs } from './fallback/fallback';
export {
  EXECUTION_EVIDENCE,
  isExecutionEvidence,
  decideFallback,
  isFallbackAllowedEvidence,
} from './fallback/fallback';
