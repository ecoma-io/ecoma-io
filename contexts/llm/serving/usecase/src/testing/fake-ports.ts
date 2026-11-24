/**
 * In-memory fake ports cho contracts tests — dùng chung giữa admission,
 * settlement và serving orchestrator specs.
 */
import {
  addBillingAccount,
  attachWallet,
  createBillingAccount,
  createWallet,
  creditGrant,
  openFinancialBook,
  registerGrant,
  authorizeFunding,
  registerSponsor,
  type FinancialBook,
  type Money,
} from '@ecoma-io/llm-financial-domain';

import type {
  ApiKeyStore,
  ApiKeyRow,
  Clock,
  CredentialAttestor,
  FinancialGateway,
  LoadedFinancialState,
  OfferCatalogue,
  ActiveOffer,
  CatalogueOffer,
  PricingCatalogue,
  ActivePricing,
  QuotaLedger,
  QuotaRead,
  RequestIdGenerator,
  RestrictionGate,
  ServingJournal,
  TenantDirectory,
  UpstreamProvider,
  RawUpstreamOutcome,
  AttemptFinalizationRecord,
} from '../index.js';

export class FakeClock implements Clock {
  public current: number = 1_700_000_000_000;
  public now(): number {
    return this.current;
  }
  public tick(ms: number): void {
    this.current += ms;
  }
}

export class FakeRequestIds implements RequestIdGenerator {
  public next = 0;
  public newRequestId(): string {
    this.next += 1;
    return `gen-${this.next}`;
  }
}

export class FakeApiKeys implements ApiKeyStore {
  public rows = new Map<string, ApiKeyRow>();
  public failLookup = false;
  public async findByKeyHash(keyHash: string): Promise<ApiKeyRow | null> {
    if (this.failLookup) {
      throw new Error('key lookup failed');
    }
    return this.rows.get(keyHash) ?? null;
  }
  public add(keyHash: string, row: ApiKeyRow): void {
    this.rows.set(keyHash, row);
  }
}

export class FakeTenants implements TenantDirectory {
  public existing = new Set<string>();
  public async tenantExists(tenantId: string): Promise<boolean> {
    return this.existing.has(tenantId);
  }
}

export class FakeOffers implements OfferCatalogue {
  public byModel = new Map<string, ActiveOffer>();
  public offers: CatalogueOffer[] = [];
  public tenantNames = new Map<string, string>();
  public failList = false;
  public async findActiveOffer(model: string): Promise<ActiveOffer | null> {
    return this.byModel.get(model) ?? null;
  }
  public async listActiveOffers(): Promise<readonly CatalogueOffer[]> {
    if (this.failList) {
      throw new Error('offer list failed');
    }
    return this.offers;
  }
  public async listSellerTenantNames(): Promise<ReadonlyMap<string, string>> {
    return this.tenantNames;
  }
}

export class FakeRestrictions implements RestrictionGate {
  public restricted = new Set<string>();
  public async isChatRestricted(sellerTenantId: string): Promise<boolean> {
    return this.restricted.has(sellerTenantId);
  }
}

export class FakeEndpoints implements EndpointDirectoryLike {
  public byOffer = new Map<string, { url: string; protocol: string }>();
  public async findHealthyEndpoint(offerId: string) {
    return this.byOffer.get(offerId) ?? null;
  }
}
export interface EndpointDirectoryLike {
  findHealthyEndpoint(offerId: string): Promise<{ url: string; protocol: string } | null>;
}

export class FakeCredentials implements CredentialAttestor {
  public ok = true;
  public lastSellerTenantId: string | null = null;
  public lastProvider: string | null = null;
  public async verifyCredential(input: {
    sellerTenantId: string;
    provider: string;
    credentialPlaintext: string;
  }): Promise<boolean> {
    this.lastSellerTenantId = input.sellerTenantId;
    this.lastProvider = input.provider;
    if (input.credentialPlaintext.length === 0) {
      return false;
    }
    return this.ok;
  }
}

export class FakePricing implements PricingCatalogue {
  public byModel = new Map<string, ActivePricing>();
  public async findActivePricing(model: string): Promise<ActivePricing | null> {
    return this.byModel.get(model) ?? null;
  }
}

export class FakeQuotaLedger implements QuotaLedger {
  public ceiling = 1_000_000n;
  public settledTokens = 0n;
  public heldActiveTokens = 0n;
  public reservations = new Map<string, bigint>();
  public failRead = false;
  public async read(_tenantId: string): Promise<QuotaRead> {
    if (this.failRead) {
      throw new Error('quota read failed');
    }
    return {
      tokenCeiling: this.ceiling,
      settledTokens: this.settledTokens,
      heldActiveTokens: this.heldActiveTokens,
    };
  }
  public async reserve(input: {
    reservationId: string;
    requestId?: string;
    tenantId?: string;
    tokenAmount: bigint;
  }): Promise<{ reservationId: string; tokenAmount: bigint }> {
    this.reservations.set(input.reservationId, input.tokenAmount);
    this.heldActiveTokens += input.tokenAmount;
    return { reservationId: input.reservationId, tokenAmount: input.tokenAmount };
  }
  public async settle(input: { reservationId: string; settledTokens: bigint }): Promise<void> {
    const amount = this.reservations.get(input.reservationId);
    if (amount === undefined) {
      return; // idempotent: settle lại reservation đã terminal là no-op
    }
    this.reservations.delete(input.reservationId);
    this.heldActiveTokens -= amount;
    this.settledTokens += input.settledTokens;
  }
  public async release(reservationId: string): Promise<void> {
    const amount = this.reservations.get(reservationId);
    if (amount === undefined) {
      return; // idempotent
    }
    this.reservations.delete(reservationId);
    this.heldActiveTokens -= amount;
  }
}

export class FakeJournal implements ServingJournal {
  public payloadHashes = new Map<string, string>();
  public admissions: object[] = [];
  public finalizations: AttemptFinalizationRecord[] = [];
  public attemptEvidence = new Map<
    string,
    import('@ecoma-io/llm-inference-domain').ExecutionEvidence
  >();
  public conflictOnRecord = false;
  public async findPayloadHash(input: {
    requestId: string;
    tenantId: string;
  }): Promise<string | null> {
    return this.payloadHashes.get(`${input.tenantId}:${input.requestId}`) ?? null;
  }
  public async recordAdmission(
    input: { requestId: string; tenantId: string; payloadHash: string } & object,
  ): Promise<{ readonly kind: 'recorded' } | { readonly kind: 'replay' }> {
    const key = `${input.tenantId}:${input.requestId}`;
    if (this.payloadHashes.has(key) || this.conflictOnRecord) {
      return { kind: 'replay' };
    }
    this.payloadHashes.set(key, input.payloadHash);
    this.admissions.push(input);
    return { kind: 'recorded' };
  }
  public async readAttemptEvidence(
    attemptId: string,
  ): Promise<import('@ecoma-io/llm-inference-domain').ExecutionEvidence | null> {
    return this.attemptEvidence.get(attemptId) ?? null;
  }
  public async recordFinalization(record: AttemptFinalizationRecord): Promise<void> {
    this.finalizations.push(record);
    this.attemptEvidence.set(record.attemptId, record.finalEvidence);
  }
}

/** Fake financial gateway giữ book in-memory, chạy operations trực tiếp. */
export class FakeFinancialGateway implements FinancialGateway {
  public state: LoadedFinancialState;
  public commits = 0;
  public failBilling = false;

  public constructor(book: FinancialBook, walletId: string, billingAccountId: string) {
    this.state = {
      book,
      walletFencingToken: 'fence:fake:v1',
      walletId,
      billingAccountId,
    };
  }

  public async inTransaction<T>(
    _input: { tenantId: string },
    work: (state: LoadedFinancialState) => Promise<T>,
  ): Promise<T> {
    if (this.failBilling) {
      throw new Error('billing account missing');
    }
    return work(this.state);
  }
  public async commit(
    input: {
      book: FinancialBook;
    } & object,
  ): Promise<void> {
    this.commits += 1;
    this.state = { ...this.state, book: input.book };
  }
}

export class FakeUpstream implements UpstreamProvider {
  public outcome: RawUpstreamOutcome = {
    failureKind: null,
    httpStatus: 200,
    bodyText: JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      model: 'm',
      usage: { prompt_tokens: 5, completion_tokens: 7 },
    }),
    retryAfterHeader: null,
  };
  public lastPayloadText: string | null = null;
  public lastCredentialPlaintext: string | null = null;
  public failDispatch = false;
  public async dispatch(input: {
    url: string;
    credentialPlaintext: string;
    payloadText: string;
  }): Promise<RawUpstreamOutcome> {
    if (this.failDispatch) {
      throw new Error('dispatch failed');
    }
    this.lastPayloadText = input.payloadText;
    this.lastCredentialPlaintext = input.credentialPlaintext;
    return this.outcome;
  }
}

// ---------------------------------------------------------------------------
// Financial state bootstrap cho tests
// ---------------------------------------------------------------------------

/** Dựng book có sponsor/authorization/grant để creditGrant replay được. */
export function buildFundedBook(input: {
  billingAccountId: string;
  walletId: string;
  grantId: string;
  amountMinor: bigint;
}): { book: FinancialBook; grantId: string } {
  let book = openFinancialBook();
  // Billing account + wallet UC với balance từ credit grant (conservation khớp
  // sau `creditGrant` vì balances derive lại qua deriveWalletBalances).
  const wallet = createWallet({
    walletId: input.walletId,
    billingAccountId: input.billingAccountId,
    denomination: 'UC',
    fencingToken: 'fence:fake:v1',
  });
  if (!wallet.ok) {
    throw new Error(`wallet create failed: ${wallet.error.code}`);
  }
  const baseAccount = createBillingAccount({
    billingAccountId: input.billingAccountId,
    ownerRef: 'owner:1',
    createdAt: 1,
  });
  if (!baseAccount.ok) {
    throw new Error(`billing account create failed: ${baseAccount.error.code}`);
  }
  const account = attachWallet(baseAccount.value, wallet.value);
  if (!account.ok) {
    throw new Error(`billing account attach failed: ${account.error.code}`);
  }
  const withAccount = addBillingAccount(book, account.value);
  if (!withAccount.ok) {
    throw new Error(`billing account add failed: ${withAccount.error.code}`);
  }
  book = withAccount.value;
  const sponsor = registerSponsor(book, {
    sponsorId: 'sponsor:1',
    ownerRef: 'owner:1',
    ceiling: ucMoney(10_000_000n),
    createdAt: 1,
    createdBy: 'test',
  });
  if (!sponsor.ok) {
    throw new Error(`sponsor seed failed: ${sponsor.error.code}`);
  }
  book = sponsor.value.book;
  const authorization = authorizeFunding(book, {
    authorizationId: 'auth:1',
    sponsorId: 'sponsor:1',
    billingAccountId: input.billingAccountId,
    ceiling: ucMoney(10_000_000n),
    evidenceRef: 'evidence:1',
    createdAt: 1,
    createdBy: 'test',
  });
  if (!authorization.ok) {
    throw new Error(`authorization failed: ${authorization.error.code}`);
  }
  book = authorization.value.book;
  const grant = registerGrant(book, {
    grantId: input.grantId,
    authorizationId: 'auth:1',
    amount: ucMoney(input.amountMinor),
    actorRef: 'test',
    createdAt: 1,
  });
  if (!grant.ok) {
    throw new Error(`grant register failed: ${grant.error.code}`);
  }
  book = grant.value.book;
  const credited = creditGrant(book, {
    grantId: input.grantId,
    creditedAt: 1,
    fencingToken: 'fence:fake:v1',
  });
  if (!credited.ok) {
    throw new Error(`credit grant failed: ${credited.error.code}`);
  }
  return { book: credited.value.book, grantId: input.grantId };
}

export function ucMoney(minor: bigint): Money {
  return { denomination: 'UC', minor };
}
