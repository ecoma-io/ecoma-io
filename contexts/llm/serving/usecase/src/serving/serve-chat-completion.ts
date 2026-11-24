/**
 * Orchestration serving POST /v1/chat/completions — admission → dispatch →
 * settlement (steps 2..12; readiness gate BỎ RA KHỎI usecase — infra).
 *
 * Chuỗi admission (mỗi bước fail-closed, không bao giờ dispatch trước khi tất
 * cả bước trước đã qua):
 * 2. auth key — lookup qua ApiKeyStore; revoked → từ chối.
 * 3. tenant của key tồn tại — không → từ chối (fail-closed).
 * 4. `x-request-id` → request identity (port RequestIdGenerator khi thiếu).
 * 5. body validate — `max_tokens` bắt buộc, `stream:true` từ chối.
 * 6. resolve model → offer `active` (marketplace); restriction hiệu lực của
 *    seller tenant (capability `chat` hoặc tenant-scope) → từ chối.
 * 7. routing: endpoint pool healthy; credential serving verify per-request —
 *    mismatch → KHÔNG route.
 * 8. pricing snapshot active; không có/không express được bằng VND → từ chối.
 * 9. bounds (input = ceil(chars/2), output = max_tokens, cả hai cap bởi
 *    snapshot) → admission amount (một điểm làm tròn duy nhất).
 * 10. AdmitRequest — transaction gateway.
 * 11. DispatchAttempt — plaintext credential chỉ nằm trong dispatch này.
 * 12. FinalizeAttempt — settle/release theo evidence.
 *
 * Bất invariant platform: KHÔNG BAO GIỜ log prompt/response body, key plaintext,
 * credential plaintext hay connection string. Chỉ metadata + outcome.
 */
import type { Command } from '@ecoma-io/usecase-primitives';

import type { ApiKeyStore } from '../ports/api-key-store.js';
import type { Clock } from '../ports/clock.js';
import type { CredentialAttestor } from '../ports/credential-attestor.js';
import type { EndpointDirectory } from '../ports/endpoint-directory.js';
import type { OfferCatalogue } from '../ports/offer-catalogue.js';
import type { PricingCatalogue } from '../ports/pricing-catalogue.js';
import type { RequestIdGenerator } from '../ports/request-id-generator.js';
import type { RestrictionGate } from '../ports/restriction-gate.js';
import type { TenantDirectory } from '../ports/tenant-directory.js';
import { canonicalJson, resolveRequestId } from '../identity/identity.js';
import {
  computeAdmissionAmount,
  computeTokenBounds,
  estimatePromptCharacters,
  validateChatRequest,
  type ChatRequestFailure,
} from '../validate/validate.js';
import { AdmitRequestCommand, type AdmitFailureCode } from '../admission/admit-request.js';
import { DispatchAttemptCommand } from '../dispatch/dispatch.js';
import {
  FinalizeAttemptCommand,
  type FinalizeFailureCode,
} from '../settlement/finalize-attempt.js';

/** Mã failure serving — mirror mã ApiError cũ nhưng KHÔNG HTTP. */
export type ServingFailureCode =
  | 'invalid_api_key'
  | 'api_key_revoked'
  | 'tenant_not_active'
  | 'invalid_request'
  | ChatRequestFailure
  | 'model_not_found'
  | 'offer_restricted'
  | 'no_candidate'
  | 'upstream_credential_unavailable'
  | 'pricing_unavailable'
  | AdmitFailureCode
  | FinalizeFailureCode;

/** Failure của serving pipeline — transport maps code sang status + envelope. */
export interface ServingFailure {
  readonly kind: 'failed';
  readonly code: ServingFailureCode;
  /** Message validation chi tiết khi failure bắt nguồn từ bước validate body. */
  readonly detail: string | null;
  /** Retry-After (giây) cho rate_limit_exceeded; còn lại null. */
  readonly retryAfterSeconds: number | null;
}

/** Thân completion để transport dựng envelope OpenAI (không type HTTP). */
export interface ServingCompletion {
  readonly completionId: string;
  readonly createdSeconds: number;
  readonly model: string;
  readonly content: string;
  readonly finishReason: string | null;
  /** Raw usage object upstream khi usage known; null khi missing/malformed. */
  readonly rawUsage: unknown | null;
  readonly chargeMinor: bigint;
}

export type ServeOutcome =
  | { readonly kind: 'completed'; readonly completion: ServingCompletion }
  | ServingFailure;

export interface ServeChatCompletionInput {
  /** Header Authorization: giá trị sau "Bearer " (transport strip). */
  readonly apiKey: string;
  /** Header x-request-id nguyên bản (undefined khi vắng mặt). */
  readonly requestIdHeader: string | undefined;
  /** Body JSON đã parse; parse lỗi là trách nhiệm transport (invalid_request). */
  readonly body: unknown;
  /** Provider upstream serving (env). */
  readonly provider: string;
  /** Plaintext credential serving (env) — CHỈ passthrough cho dispatch. */
  readonly credentialPlaintext: string;
}

/** Alias contract cho type-level test. */
export type ServeChatCompletionUseCaseType = Command<ServeChatCompletionInput, ServeOutcome>;

export interface ServeChatCompletionDeps {
  readonly apiKeys: ApiKeyStore;
  readonly tenants: TenantDirectory;
  readonly offers: OfferCatalogue;
  readonly restrictions: RestrictionGate;
  readonly endpoints: EndpointDirectory;
  readonly credentials: CredentialAttestor;
  readonly pricing: PricingCatalogue;
  readonly requestIds: RequestIdGenerator;
  readonly clock: Clock;
  readonly admit: AdmitRequestCommand;
  readonly dispatch: DispatchAttemptCommand;
  readonly finalize: FinalizeAttemptCommand;
}

function failure(code: ServingFailureCode, detail: string | null = null): ServingFailure {
  return { kind: 'failed', code, detail, retryAfterSeconds: null };
}

/**
 * Command orchestration serving (steps 2..12 của pipeline cũ). Readiness gate
 * (step 1) BỎ RA KHỎI usecase — infra probe thuộc transport.
 */
export class ServeChatCompletionCommand implements ServeChatCompletionUseCaseType {
  readonly #deps: ServeChatCompletionDeps;

  public constructor(deps: ServeChatCompletionDeps) {
    this.#deps = deps;
  }

  public async execute(input: ServeChatCompletionInput): Promise<ServeOutcome> {
    const d = this.#deps;
    // 2. Auth key — lookup qua ApiKeyStore; revoked → từ chối.
    if (input.apiKey.length === 0) {
      return failure('invalid_api_key');
    }
    const keyHash = await sha256Hex(input.apiKey);
    const keyRow = await d.apiKeys.findByKeyHash(keyHash);
    if (keyRow === null) {
      return failure('invalid_api_key');
    }
    if (keyRow.revokedAt !== null) {
      return failure('api_key_revoked');
    }

    // 3. Tenant của key phải tồn tại (fail-closed; không phân biệt lý do).
    if (!(await d.tenants.tenantExists(keyRow.tenantId))) {
      return failure('tenant_not_active');
    }

    // 4. Request identity + replay pre-check (replay xảy ra trong AdmitRequest).
    const requestIdResolution = resolveRequestId(input.requestIdHeader, () =>
      d.requestIds.newRequestId(),
    );
    if (requestIdResolution.kind === 'invalid') {
      return failure('invalid_request', '"x-request-id" must be 1..200 characters.');
    }
    const requestId = requestIdResolution.requestId;

    // 5. Body validate.
    const validation = validateChatRequest(input.body);
    if (validation.kind === 'invalid') {
      return failure(validation.failure);
    }
    const chatRequest = validation.request;
    const payloadHash = await sha256Hex(canonicalJson(input.body));

    // 6. Resolution: offer active + eligibility gate (invariant 6).
    const offer = await d.offers.findActiveOffer(chatRequest.model);
    if (offer === null) {
      return failure('model_not_found');
    }
    if (await d.restrictions.isChatRestricted(offer.sellerTenantId)) {
      return failure('offer_restricted');
    }

    // 7. Routing: endpoint healthy + credential verify per-request (invariant 8).
    const endpoint = await d.endpoints.findHealthyEndpoint(offer.id);
    if (endpoint === null || !/^https?:\/\//u.test(endpoint.url)) {
      return failure('no_candidate');
    }
    if (input.provider.length === 0 || input.credentialPlaintext.length === 0) {
      return failure('upstream_credential_unavailable');
    }
    const credentialMatches = await d.credentials.verifyCredential({
      sellerTenantId: offer.sellerTenantId,
      provider: input.provider,
      // Plaintext credential CHỈ đi vào verify này và dispatch ở step 11 —
      // không log, không persist, không response.
      credentialPlaintext: input.credentialPlaintext,
    });
    if (!credentialMatches) {
      return failure('upstream_credential_unavailable');
    }

    // 8. Pricing snapshot active — fail-closed khi thiếu/không VND (ADR-0028 §13.4).
    const pricing = await d.pricing.findActivePricing(chatRequest.model);
    if (pricing === null || pricing.currency !== 'VND') {
      return failure('pricing_unavailable');
    }

    // 9. Bounds + admission amount (ADR-0028 §5).
    const bounds = computeTokenBounds({
      promptCharacters: estimatePromptCharacters(chatRequest.messages),
      maxTokens: chatRequest.maxTokens,
      maxInputTokensPerRequest: pricing.maxInputTokensPerRequest,
      maxOutputTokensPerRequest: pricing.maxOutputTokensPerRequest,
    });
    const holdAmount = computeAdmissionAmount({
      inputRatePerMillionMinor: pricing.inputRatePerMillionMinor,
      outputRatePerMillionMinor: pricing.outputRatePerMillionMinor,
      inputTokens: bounds.inputTokens,
      outputTokens: bounds.outputTokens,
    });
    if (!holdAmount.ok) {
      // Rate cấu hình hỏng/overflow là lỗi cấu hình serving, không phải client.
      return failure('pricing_unavailable');
    }
    const holdTokens = bounds.inputTokens + bounds.outputTokens;

    // 10. Admission transaction.
    const attemptNo = 1;
    const admitted = await d.admit.execute({
      requestId,
      tenantId: keyRow.tenantId,
      apiKeyId: keyRow.id,
      payloadHash,
      requestedModel: chatRequest.model,
      offerId: offer.id,
      sellerTenantId: offer.sellerTenantId,
      pricingSnapshotId: pricing.snapshotId,
      upstreamEndpointUrl: endpoint.url,
      holdAmount: holdAmount.amount,
      holdTokens,
      inputRatePerMillionMinor: pricing.inputRatePerMillionMinor,
      outputRatePerMillionMinor: pricing.outputRatePerMillionMinor,
      attemptNo,
    });
    if (admitted.kind === 'rejected') {
      return failure(admitted.code);
    }

    // 11. Dispatch upstream — plaintext credential chỉ nằm trong dispatch này.
    const classified = await d.dispatch.execute({
      url: endpoint.url,
      credentialPlaintext: input.credentialPlaintext,
      upstreamModel: offer.normalizedModelId,
      messages: chatRequest.messages,
      maxTokens: chatRequest.maxTokens,
    });

    // 12. Settlement transaction (settle/release theo evidence — F5, F7).
    const settled = await d.finalize.execute({
      requestId,
      tenantId: keyRow.tenantId,
      attemptId: admitted.attemptId,
      quotaReservationId: admitted.quotaReservationId,
      financialReservationId: admitted.financialReservationId,
      settlementId: admitted.settlementId,
      chargeId: admitted.chargeId,
      holdTokens: admitted.holdTokens,
      inputRatePerMillionMinor: admitted.inputRatePerMillionMinor,
      outputRatePerMillionMinor: admitted.outputRatePerMillionMinor,
      classified,
      upstreamRetryAfter: classified.retryAfterSeconds,
    });

    if (settled.kind === 'completed') {
      const usage = classified.usage;
      return {
        kind: 'completed',
        completion: {
          completionId: `chatcmpl-${requestId}`,
          createdSeconds: Math.floor(d.clock.now() / 1000),
          model: offer.normalizedModelId,
          content: settled.completion.content,
          finishReason: settled.completion.finishReason,
          rawUsage: usage.status === 'known' ? usage.rawUsage : null,
          chargeMinor: settled.chargeMinor,
        },
      };
    }
    return settled.kind === 'failed'
      ? {
          kind: 'failed',
          code: settled.code,
          detail: null,
          retryAfterSeconds: settled.retryAfterSeconds,
        }
      : failure('service_unavailable');
  }
}

/**
 * SHA-256 hex qua Web Crypto (`crypto.subtle`) — runtime Worker KHÔNG có
 * node:crypto. Async vì subtle digest là promise.
 */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
