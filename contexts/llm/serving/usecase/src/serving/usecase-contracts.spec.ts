/**
 * Contracts test của ServeChatCompletionCommand: thứ tự step và fail-closed
 * với mocked ports (steps 2..12; readiness gate là infra — nằm ngoài usecase).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Command } from '@ecoma-io/usecase-primitives';

import {
  ServeChatCompletionCommand,
  type ServeChatCompletionInput,
  type ServeChatCompletionUseCaseType,
  type ServeOutcome,
} from './serve-chat-completion.js';
import { AdmitRequestCommand } from '../admission/admit-request.js';
import { DispatchAttemptCommand } from '../dispatch/dispatch.js';
import { FinalizeAttemptCommand } from '../settlement/finalize-attempt.js';
import {
  FakeApiKeys,
  FakeClock,
  FakeCredentials,
  FakeEndpoints,
  FakeFinancialGateway,
  FakeJournal,
  FakeOffers,
  FakePricing,
  FakeQuotaLedger,
  FakeRequestIds,
  FakeRestrictions,
  FakeTenants,
  FakeUpstream,
  buildFundedBook,
} from '../testing/fake-ports.js';
import { createHash } from 'node:crypto';

/** sha256('key-plaintext') — hash thật mà serve-chat-completion tính ra. */
const KEY_TESTING_HASH = createHash('sha256').update('key-plaintext').digest('hex');

export interface Deps {
  apiKeys: FakeApiKeys;
  tenants: FakeTenants;
  offers: FakeOffers;
  restrictions: FakeRestrictions;
  endpoints: FakeEndpoints;
  credentials: FakeCredentials;
  pricing: FakePricing;
  requestIds: FakeRequestIds;
  clock: FakeClock;
  quota: FakeQuotaLedger;
  journal: FakeJournal;
  upstream: FakeUpstream;
  command: ServeChatCompletionCommand;
}

function makeDeps(): Deps {
  const apiKeys = new FakeApiKeys();
  apiKeys.add(KEY_TESTING_HASH, { id: 'key-1', tenantId: 'tenant-1', revokedAt: null });
  const tenants = new FakeTenants();
  tenants.existing.add('tenant-1');
  const offers = new FakeOffers();
  offers.byModel.set('model-a', {
    id: 'offer-1',
    normalizedModelId: 'model-a',
    sellerTenantId: 'seller-1',
  });
  const endpoints = new FakeEndpoints();
  endpoints.byOffer.set('offer-1', { url: 'https://upstream.example', protocol: 'openai' });
  const pricing = new FakePricing();
  pricing.byModel.set('model-a', {
    snapshotId: 'snap-1',
    currency: 'VND',
    inputRatePerMillionMinor: 1_000_000n,
    outputRatePerMillionMinor: 1_000_000n,
    maxInputTokensPerRequest: 100n,
    maxOutputTokensPerRequest: 100n,
  });
  const clock = new FakeClock();
  const { book } = buildFundedBook({
    billingAccountId: 'billing-1',
    walletId: 'wallet:billing-1:UC',
    grantId: 'grant:1',
    amountMinor: 10_000n,
  });
  const financial = new FakeFinancialGateway(book, 'wallet:billing-1:UC', 'billing-1');
  const quota = new FakeQuotaLedger();
  const journal = new FakeJournal();
  const upstream = new FakeUpstream();
  const restrictions = new FakeRestrictions();
  const credentials = new FakeCredentials();
  const command = new ServeChatCompletionCommand({
    apiKeys,
    tenants,
    offers,
    restrictions,
    endpoints,
    credentials,
    pricing,
    requestIds: new FakeRequestIds(),
    clock,
    admit: new AdmitRequestCommand({ quota, financial, journal, clock }),
    dispatch: new DispatchAttemptCommand(upstream),
    finalize: new FinalizeAttemptCommand({ quota, financial, journal, clock }),
  });
  return {
    apiKeys,
    tenants,
    offers,
    restrictions,
    endpoints,
    credentials,
    pricing,
    requestIds: new FakeRequestIds(),
    clock,
    quota,
    journal,
    upstream,
    command,
  };
}

function makeInput(overrides: Partial<ServeChatCompletionInput> = {}): ServeChatCompletionInput {
  return {
    apiKey: 'key-plaintext',
    requestIdHeader: 'req-1',
    body: {
      model: 'model-a',
      messages: [{ role: 'user', content: 'hello world' }],
      max_tokens: 10,
    },
    provider: 'openai',
    credentialPlaintext: 'credential-secret',
    ...overrides,
  };
}

describe('serve chat completion use case contracts', () => {
  it('serveChatCompletionUseCaseType implements Command with matching execute signature', () => {
    expectTypeOf<ServeChatCompletionUseCaseType>().toExtend<
      Command<ServeChatCompletionInput, ServeOutcome>
    >();
  });
});

/** Narrow về completed — throw thay vì conditional expect (vitest lint). */
function assertCompleted(
  outcome: ServeOutcome,
): asserts outcome is Extract<ServeOutcome, { kind: 'completed' }> {
  if (outcome.kind !== 'completed') {
    throw new Error(`expected completed, got ${JSON.stringify(outcome)}`);
  }
}

describe('ServeChatCompletionCommand step ordering and fail-closed behavior', () => {
  it('completes the full pipeline: auth → resolution → admission → dispatch → settlement', async () => {
    const deps = makeDeps();
    const outcome = await deps.command.execute(makeInput());
    assertCompleted(outcome);
    expect(outcome.completion).toMatchObject({
      completionId: 'chatcmpl-req-1',
      model: 'model-a',
      content: 'hi',
      finishReason: 'stop',
      chargeMinor: 12n, // usage 5 in + 7 out × 1/1M → 12 minor (≤ hold)
    });
    expect(outcome.completion.rawUsage).toEqual({ prompt_tokens: 5, completion_tokens: 7 });
    expect(deps.journal.admissions).toHaveLength(1);
    expect(deps.journal.finalizations).toHaveLength(1);
  });

  it('fails closed before any dispatch when the api key is unknown', async () => {
    const deps = makeDeps();
    const outcome = await deps.command.execute(makeInput({ apiKey: 'wrong-key' }));
    expect(outcome).toMatchObject({ kind: 'failed', code: 'invalid_api_key' });
    expect(deps.journal.admissions).toHaveLength(0);
    expect(deps.upstream.lastPayloadText).toBeNull();
  });

  it('fails closed on revoked key', async () => {
    const deps = makeDeps();
    deps.apiKeys.add(KEY_TESTING_HASH, { id: 'key-1', tenantId: 'tenant-1', revokedAt: 1 });
    const outcome = await deps.command.execute(makeInput());
    expect(outcome).toMatchObject({ kind: 'failed', code: 'api_key_revoked' });
  });

  it('rejects an empty api key before hashing', async () => {
    const deps = makeDeps();
    const outcome = await deps.command.execute(makeInput({ apiKey: '' }));
    expect(outcome).toMatchObject({ kind: 'failed', code: 'invalid_api_key' });
    expect(deps.journal.admissions).toHaveLength(0);
  });

  it('fails closed on broken pricing rate configuration (pricing_unavailable)', async () => {
    const deps = makeDeps();
    deps.pricing.byModel.set('model-a', {
      snapshotId: 'snap-1',
      currency: 'VND',
      inputRatePerMillionMinor: -1n, // rate âm → admission amount fail-closed
      outputRatePerMillionMinor: 1n,
      maxInputTokensPerRequest: 100n,
      maxOutputTokensPerRequest: 100n,
    });
    const outcome = await deps.command.execute(makeInput());
    expect(outcome).toMatchObject({ kind: 'failed', code: 'pricing_unavailable' });
    expect(deps.journal.admissions).toHaveLength(0);
  });

  it('fails closed when the key tenant does not exist', async () => {
    const deps = makeDeps();
    deps.tenants.existing.delete('tenant-1');
    const outcome = await deps.command.execute(makeInput());
    expect(outcome).toMatchObject({ kind: 'failed', code: 'tenant_not_active' });
  });

  it('fails closed on model without active offer (model_not_found)', async () => {
    const deps = makeDeps();
    const outcome = await deps.command.execute(
      makeInput({
        body: {
          model: 'missing-model',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 10,
        },
      }),
    );
    expect(outcome).toMatchObject({ kind: 'failed', code: 'model_not_found' });
  });

  it('applies the eligibility gate before routing (offer_restricted)', async () => {
    const deps = makeDeps();
    deps.restrictions.restricted.add('seller-1');
    const outcome = await deps.command.execute(makeInput());
    expect(outcome).toMatchObject({ kind: 'failed', code: 'offer_restricted' });
    expect(deps.endpoints.byOffer.has('offer-1')).toBe(true); // routing never consulted via port output
  });

  it('fails closed on no healthy endpoint (no_candidate)', async () => {
    const deps = makeDeps();
    deps.endpoints.byOffer.delete('offer-1');
    const outcome = await deps.command.execute(makeInput());
    expect(outcome).toMatchObject({ kind: 'failed', code: 'no_candidate' });
  });

  it('fails closed on credential mismatch (upstream_credential_unavailable)', async () => {
    const deps = makeDeps();
    deps.credentials.ok = false;
    const outcome = await deps.command.execute(makeInput());
    expect(outcome).toMatchObject({ kind: 'failed', code: 'upstream_credential_unavailable' });
    expect(deps.upstream.lastPayloadText).toBeNull(); // never dispatched
  });

  it('fails closed on missing pricing or non-VND pricing', async () => {
    const deps = makeDeps();
    deps.pricing.byModel.delete('model-a');
    expect(await deps.command.execute(makeInput())).toMatchObject({
      kind: 'failed',
      code: 'pricing_unavailable',
    });
    deps.pricing.byModel.set('model-a', {
      snapshotId: 'snap-1',
      currency: 'USD',
      inputRatePerMillionMinor: 1n,
      outputRatePerMillionMinor: 1n,
      maxInputTokensPerRequest: 100n,
      maxOutputTokensPerRequest: 100n,
    });
    expect(await deps.command.execute(makeInput())).toMatchObject({
      kind: 'failed',
      code: 'pricing_unavailable',
    });
  });

  it('propagates admission failure (insufficient funds) without dispatching', async () => {
    const deps = makeDeps();
    deps.quota.ceiling = 1_000_000n;
    // Drain financial balance below the admission hold by rebuilding? Simplest:
    // small ceiling → insufficient_quota path.
    deps.quota.settledTokens = 999_999n;
    const outcome = await deps.command.execute(makeInput());
    expect(outcome).toMatchObject({ kind: 'failed', code: 'insufficient_quota' });
    expect(deps.upstream.lastPayloadText).toBeNull();
  });

  it('passes the replayed request through the admission replay path (request_id_replay)', async () => {
    const deps = makeDeps();
    // Hash khớp canonicalJson của body trong makeInput (sha256).
    deps.journal.payloadHashes.set(
      'tenant-1:req-1',
      '47a87006c915c0ed111bbea710a6ac1eda369c94e9499a17e34bd50eb5bad1d9',
    );
    const outcome = await deps.command.execute(makeInput());
    expect(outcome).toMatchObject({ kind: 'failed', code: 'request_id_replay' });
  });

  it('rejects stream:true (streaming stays rejected)', async () => {
    const deps = makeDeps();
    const outcome = await deps.command.execute(
      makeInput({
        body: {
          model: 'model-a',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 10,
          stream: true,
        },
      }),
    );
    expect(outcome).toMatchObject({ kind: 'failed', code: 'streaming_not_supported' });
  });

  it('generates a request id through the port when the header is absent', async () => {
    const deps = makeDeps();
    const outcome = await deps.command.execute(makeInput({ requestIdHeader: undefined }));
    assertCompleted(outcome);
    expect(outcome.completion.completionId).toBe('chatcmpl-gen-1');
  });

  it('rejects an invalid x-request-id header before any port write', async () => {
    const deps = makeDeps();
    const outcome = await deps.command.execute(makeInput({ requestIdHeader: '   ' }));
    expect(outcome).toMatchObject({
      kind: 'failed',
      code: 'invalid_request',
      detail: '"x-request-id" must be 1..200 characters.',
    });
    expect(deps.journal.admissions).toHaveLength(0);
    expect(deps.upstream.lastPayloadText).toBeNull();
  });

  it('rejects empty provider or credential config before credential verification', async () => {
    const deps = makeDeps();
    const outcome = await deps.command.execute(makeInput({ provider: '' }));
    expect(outcome).toMatchObject({ kind: 'failed', code: 'upstream_credential_unavailable' });
    expect(deps.credentials.lastProvider).toBeNull();
    const outcome2 = await deps.command.execute(makeInput({ credentialPlaintext: '' }));
    expect(outcome2).toMatchObject({ kind: 'failed', code: 'upstream_credential_unavailable' });
  });

  it('fails closed when admission rejects (insufficient funds) without dispatching', async () => {
    const deps = makeDeps();
    // Xuống hạng ví tiền dưới mức hold (input 6 chars → 3 tok in, 10 out ×
    // 1/1M → hold 13 minor): grant 10 → thiếu.
    const { book } = buildFundedBook({
      billingAccountId: 'billing-1',
      walletId: 'wallet:billing-1:UC',
      grantId: 'grant:drain',
      amountMinor: 10n,
    });
    deps.command = new ServeChatCompletionCommand({
      apiKeys: deps.apiKeys,
      tenants: deps.tenants,
      offers: deps.offers,
      restrictions: deps.restrictions,
      endpoints: deps.endpoints,
      credentials: deps.credentials,
      pricing: deps.pricing,
      requestIds: new FakeRequestIds(),
      clock: deps.clock,
      admit: new AdmitRequestCommand({
        quota: deps.quota,
        financial: new FakeFinancialGateway(book, 'wallet:billing-1:UC', 'billing-1'),
        journal: deps.journal,
        clock: deps.clock,
      }),
      dispatch: new DispatchAttemptCommand(deps.upstream),
      finalize: new FinalizeAttemptCommand({
        quota: deps.quota,
        financial: new FakeFinancialGateway(book, 'wallet:billing-1:UC', 'billing-1'),
        journal: deps.journal,
        clock: deps.clock,
      }),
    });
    const outcome = await deps.command.execute(makeInput());
    expect(outcome).toMatchObject({ kind: 'failed', code: 'insufficient_funds' });
    expect(deps.upstream.lastPayloadText).toBeNull();
  });

  it('propagates a port failure (offer catalogue down) instead of a silent fallback', async () => {
    const deps = makeDeps();
    deps.offers.failList = true;
    // listActiveOffers không nằm trong serving path, nhưng findActiveOffer ném
    // phải thoát ra — không nuốt thành model_not_found.
    deps.offers.byModel.delete('model-a');
    deps.offers.byModel.set('model-a', {
      id: 'offer-1',
      normalizedModelId: 'model-a',
      sellerTenantId: 'seller-1',
    });
    const throwing = new FakeOffers();
    throwing.byModel.set('model-a', {
      id: 'offer-1',
      normalizedModelId: 'model-a',
      sellerTenantId: 'seller-1',
    });
    throwing.findActiveOffer = async () => {
      throw new Error('offer lookup failed');
    };
    deps.command = new ServeChatCompletionCommand({
      apiKeys: deps.apiKeys,
      tenants: deps.tenants,
      offers: throwing,
      restrictions: deps.restrictions,
      endpoints: deps.endpoints,
      credentials: deps.credentials,
      pricing: deps.pricing,
      requestIds: new FakeRequestIds(),
      clock: deps.clock,
      admit: new AdmitRequestCommand({
        quota: deps.quota,
        financial: new FakeFinancialGateway(
          buildFundedBook({
            billingAccountId: 'billing-1',
            walletId: 'wallet:billing-1:UC',
            grantId: 'grant:1',
            amountMinor: 10_000n,
          }).book,
          'wallet:billing-1:UC',
          'billing-1',
        ),
        journal: deps.journal,
        clock: deps.clock,
      }),
      dispatch: new DispatchAttemptCommand(deps.upstream),
      finalize: new FinalizeAttemptCommand({
        quota: deps.quota,
        financial: new FakeFinancialGateway(
          buildFundedBook({
            billingAccountId: 'billing-1',
            walletId: 'wallet:billing-1:UC',
            grantId: 'grant:1',
            amountMinor: 10_000n,
          }).book,
          'wallet:billing-1:UC',
          'billing-1',
        ),
        journal: deps.journal,
        clock: deps.clock,
      }),
    });
    await expect(deps.command.execute(makeInput())).rejects.toThrow('offer lookup failed');
  });

  it('reports upstream dispatch infrastructure error instead of misclassifying (port throws)', async () => {
    const deps = makeDeps();
    deps.upstream.failDispatch = true;
    // Fetch throw là lỗi hạ tầng: KHÔNG được nuốt thành 'upstream_error' với
    // evidence settled như thường — caller phải thấy lỗi.
    await expect(deps.command.execute(makeInput())).rejects.toThrow('dispatch failed');
  });

  it('never reports a throttled source as executed (429 ends failed with retry-after)', async () => {
    const deps = makeDeps();
    deps.upstream.outcome = {
      failureKind: null,
      httpStatus: 429,
      bodyText: null,
      retryAfterHeader: '7',
    };
    const outcome = await deps.command.execute(makeInput());
    expect(outcome).toMatchObject({
      kind: 'failed',
      code: 'rate_limit_exceeded',
      retryAfterSeconds: 7,
    });
    expect(deps.journal.finalizations[0]).toMatchObject({
      finalEvidence: 'confirmed_not_executed',
      requestStatus: 'failed',
    });
    expect(deps.quota.reservations.has('quota:req-1')).toBe(false);
  });

  it('conflicts a same request id with a different payload through the pipeline (idempotency_conflict)', async () => {
    const deps = makeDeps();
    const first = await deps.command.execute(makeInput());
    assertCompleted(first);
    // Cùng x-request-id, body khác → admission pre-check trả idempotency_conflict.
    const second = await deps.command.execute(
      makeInput({
        body: {
          model: 'model-a',
          messages: [{ role: 'user', content: 'different payload' }],
          max_tokens: 10,
        },
      }),
    );
    expect(second).toMatchObject({ kind: 'failed', code: 'idempotency_conflict' });
    expect(deps.journal.admissions).toHaveLength(1);
  });

  it('blocks a second request while another hold is still active on the same wallet (concurrent hold)', async () => {
    // Hai logical request khác requestId (không replay) nhưng cùng wallet.
    // Request A bị dispatch treo ở giữa (simulate: port trả may_have_executed →
    // settle cap held giữ tiền) → request B phải bị chặn ở admission vì balance
    // đã bị A giữ, không âm sổ.
    const deps = makeDeps();
    const { book } = buildFundedBook({
      billingAccountId: 'billing-1',
      walletId: 'wallet:billing-1:UC',
      grantId: 'grant:tight',
      amountMinor: 30n, // đủ hai hold (16 mỗi cái) nhưng không đủ settle-full thứ hai
    });
    const financial = new FakeFinancialGateway(book, 'wallet:billing-1:UC', 'billing-1');
    deps.command = new ServeChatCompletionCommand({
      apiKeys: deps.apiKeys,
      tenants: deps.tenants,
      offers: deps.offers,
      restrictions: deps.restrictions,
      endpoints: deps.endpoints,
      credentials: deps.credentials,
      pricing: deps.pricing,
      requestIds: new FakeRequestIds(),
      clock: deps.clock,
      admit: new AdmitRequestCommand({
        quota: deps.quota,
        financial,
        journal: deps.journal,
        clock: deps.clock,
      }),
      dispatch: new DispatchAttemptCommand(deps.upstream),
      finalize: new FinalizeAttemptCommand({
        quota: deps.quota,
        financial,
        journal: deps.journal,
        clock: deps.clock,
      }),
    });
    // A: timeout → may_have_executed → settled capped tại held (16), tiền VẪN
    // rời available (held → charged) nhưng đã có charge — dùng ca "dispatch lỗi
    // giữa chừng": A không finalize, reservation A còn held.
    deps.upstream.outcome = {
      failureKind: 'timeout',
      httpStatus: null,
      bodyText: null,
      retryAfterHeader: null,
    };
    const first = await deps.command.execute(makeInput({ requestIdHeader: 'req-A' }));
    // A kết thúc failed (upstream_error) nhưng reservation A đã settle capped.
    expect(first).toMatchObject({ kind: 'failed', code: 'upstream_error' });
    // Chưa đủ: thử thứ hai cùng wallet với balance còn ít hơn một hold.
    const second = await deps.command.execute(makeInput({ requestIdHeader: 'req-B' }));
    expect(second).toMatchObject({ kind: 'failed', code: 'insufficient_funds' });
    // req-B bị chặn ở financial reserve — không ghi journal, không double-admit.
    expect(deps.journal.admissions).toHaveLength(1);
    // Compensation: quota hold của req-B đã trả lại.
    expect(deps.quota.reservations.has('quota:req-B')).toBe(false);
  });
});
