/**
 * Contract spec hợp đồng Kịch bản A của FinancialGateway.inTransaction: mọi
 * persistence operation mà `work` thực hiện qua QuotaLedger / ServingJournal
 * phải xảy ra trong khi transaction gateway đang mở (thứ tự gọi), và catch
 * path của usecase phải gọi `quota.release` (compensation). Các pin release
 * khi reserve từ chối / gateway throw đã có trong admission
 * usecase-contracts.spec — ở đây chỉ pin thứ tự gọi trong transaction.
 */
import { describe, expect, it } from 'vitest';

import { AdmitRequestCommand, type AdmitRequestInput } from '../admission/admit-request.js';
import {
  FakeClock,
  FakeFinancialGateway,
  FakeJournal,
  FakeQuotaLedger,
  buildFundedBook,
  ucMoney,
} from '../testing/fake-ports.js';

type TraceEvent =
  | 'gateway.open'
  | 'gateway.commit'
  | 'quota.reserve'
  | 'quota.release'
  | 'journal.recordAdmission';

/** Trace dùng chung — mọi tracer đẩy vào cùng mảng để ghim thứ tự tuyệt đối. */
function sharedTrace(): { events: TraceEvent[]; push(e: TraceEvent): void } {
  const events: TraceEvent[] = [];
  return { events, push: (e) => events.push(e) };
}

class TracingQuotaLedger extends FakeQuotaLedger {
  public constructor(private readonly push: (e: TraceEvent) => void) {
    super();
  }
  public override async reserve(input: Parameters<FakeQuotaLedger['reserve']>[0]) {
    this.push('quota.reserve');
    return super.reserve(input);
  }
  public override async release(reservationId: string): Promise<void> {
    this.push('quota.release');
    return super.release(reservationId);
  }
}

class TracingJournal extends FakeJournal {
  public constructor(private readonly push: (e: TraceEvent) => void) {
    super();
  }
  public override async recordAdmission(input: Parameters<FakeJournal['recordAdmission']>[0]) {
    this.push('journal.recordAdmission');
    return super.recordAdmission(input);
  }
}

class TracingGateway extends FakeFinancialGateway {
  public constructor(
    book: import('@ecoma-io/llm-financial-domain').FinancialBook,
    walletId: string,
    billingAccountId: string,
    private readonly push: (e: TraceEvent) => void,
  ) {
    super(book, walletId, billingAccountId);
  }
  public override async inTransaction<T>(
    input: { tenantId: string },
    work: (state: import('../index.js').LoadedFinancialState) => Promise<T>,
  ): Promise<T> {
    this.push('gateway.open');
    const result = await super.inTransaction(input, work);
    this.push('gateway.commit');
    return result;
  }
}

function makeInput(): AdmitRequestInput {
  return {
    requestId: 'req-1',
    tenantId: 'tenant-1',
    apiKeyId: 'key-1',
    payloadHash: 'hash-1',
    requestedModel: 'model-a',
    offerId: 'offer-1',
    sellerTenantId: 'seller-1',
    pricingSnapshotId: 'snap-1',
    upstreamEndpointUrl: 'https://upstream.example',
    holdAmount: ucMoney(100n),
    holdTokens: 50n,
    inputRatePerMillionMinor: 1_000_000n,
    outputRatePerMillionMinor: 1_000_000n,
    attemptNo: 1,
  };
}

function makeTracedDeps(fundedMinor: bigint = 10_000n) {
  const { events, push } = sharedTrace();
  const quota = new TracingQuotaLedger(push);
  const journal = new TracingJournal(push);
  const { book } = buildFundedBook({
    billingAccountId: 'billing-1',
    walletId: 'wallet:billing-1:UC',
    grantId: 'grant:1',
    amountMinor: fundedMinor,
  });
  const financial = new TracingGateway(book, 'wallet:billing-1:UC', 'billing-1', push);
  const command = new AdmitRequestCommand({ quota, financial, journal, clock: new FakeClock() });
  return { command, quota, journal, financial, events };
}

describe('financial gateway inTransaction scenario A contract', () => {
  it('calls quota.reserve before the gateway transaction, then journal recordAdmission inside it before commit', async () => {
    const { command, events } = makeTracedDeps();
    const outcome = await command.execute(makeInput());
    expect(outcome).toMatchObject({ kind: 'admitted' });
    // Reserve quota chạy TRƯỚC transaction gateway (cố ý — fail-fast khỏi
    // trần quota; lưới an toàn thứ hai là release trong catch). Bên trong
    // transaction: recordAdmission trước commit. Dưới Kịch bản A cả hai ghi
    // vẫn nằm chung MỘT DB transaction ở adapter.
    expect(events).toEqual([
      'quota.reserve',
      'gateway.open',
      'journal.recordAdmission',
      'gateway.commit',
    ]);
  });

  it('keeps the in-work journal write between gateway open and commit (no journal write outside the transaction)', async () => {
    const { command, events } = makeTracedDeps();
    const outcome = await command.execute(makeInput());
    expect(outcome).toMatchObject({ kind: 'admitted' });
    const open = events.indexOf('gateway.open');
    const commit = events.indexOf('gateway.commit');
    // Persistence operation trong `work` (recordAdmission) phải nằm giữa
    // gateway.open và gateway.commit — tham gia cùng transaction gateway.
    expect(events.indexOf('journal.recordAdmission')).toBeGreaterThan(open);
    expect(events.indexOf('journal.recordAdmission')).toBeLessThan(commit);
    expect(events.indexOf('quota.release')).toBe(-1);
  });

  it('calls quota.release in the catch path when the gateway throws mid-admission', async () => {
    const { command, quota, financial, events } = makeTracedDeps();
    financial.failBilling = true;
    const outcome = await command.execute(makeInput());
    expect(outcome).toEqual({ kind: 'rejected', code: 'service_unavailable' });
    // failBilling ném trước khi reserve quota chạy → release vẫn được gọi
    // (idempotent no-op) như lưới an toàn thứ hai.
    expect(quota.reservations.size).toBe(0);
    expect(events).toContain('quota.release');
    expect(events).not.toContain('gateway.commit');
  });
});
