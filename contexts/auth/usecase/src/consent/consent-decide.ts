import type { Command } from '@ecoma-io/usecase-primitives';

import { assertGrantCoversScope } from '@ecoma-io/auth-domain';

import type { AuthorizationTransactionStore } from '../ports/authorization-transaction-store.js';
import type { GrantStore } from '../ports/grant-store.js';
import type {
  ClientId,
  ConsentDecision,
  EventId,
  GrantId,
  Handle,
  HandleHash,
  Subject,
  TransactionId,
} from '../ports/types.js';

export interface ConsentDecideInput {
  readonly transactionId: TransactionId;
  /** Handle Y đã consume để tiếp tục consent — chứng danh người quyết. */
  readonly handleY: Handle;
  readonly decision: ConsentDecision;
  readonly subject: Subject;
  readonly accountSessionRef: string;
  readonly eventId: EventId;
  readonly clientId: ClientId;
  readonly requestedScope: readonly string[];
}

export type ConsentDecideOutput =
  | {
      readonly outcome: 'already-decided';
      readonly decision: ConsentDecision;
    }
  | {
      readonly outcome: 'decided';
      readonly decision: 'deny';
    }
  | {
      readonly outcome: 'decided';
      readonly decision: 'approve';
      readonly grantId: GrantId;
    };

/** Alias contract cho type-level test. */
export type ConsentDecideUseCaseType = Command<ConsentDecideInput, ConsentDecideOutput>;

/**
 * Đua consent: handle Y đã bị consume bởi quyết định khác, hoặc CAS transition thua.
 * Tách khỏi validation errors vì transaction có thể đã rollback.
 */
export class ConsentRaceError extends Error {
  public constructor() {
    super('consent race lost');
    this.name = 'ConsentRaceError';
  }
}

/**
 * Command ghi quyết định consent.
 *
 * Bất biến từ legacy consent handler:
 * - `findCommittedConsentDecision` là nguồn chân lý DUY NHẤT cho replay —
 *   quyết định đã commit thì trả kết quả cũ, không làm gì thêm (idempotent).
 * - ATOMICITY: consume handle Y + CAS transition + consent decision + grant
 *   phải là MỘT DB transaction (port `decideConsent`) — legacy chạy trong một
 *   `postgresClient.begin`. Không có partial state: Y consumed mà decision
 *   chưa commit là bất khả thi theo hợp đồng port; 'lost' nghĩa là quyết định
 *   khác đã thắng và KHÔNG có gì được ghi.
 */
export class ConsentDecideUseCase implements ConsentDecideUseCaseType {
  public constructor(
    private readonly transactions: AuthorizationTransactionStore,
    private readonly grants: GrantStore,
  ) {}

  public async execute(input: ConsentDecideInput): Promise<ConsentDecideOutput> {
    // Replay: quyết định đã commit cho transaction này — trả kết quả cũ.
    const committed = await this.grants.findCommittedConsentDecision(input.transactionId);
    if (committed !== undefined) {
      return { decision: committed.decision, outcome: 'already-decided' };
    }

    // Approve: nếu đã có grant active thì nó phải phủ trọn scope (quyết định
    // Approve với scope mới hơn grant cũ là lỗi bất biến); nếu CHƯA có grant
    // Thì decideConsent tạo mới — KHÔNG assert trước, vì lần consent đầu
    // Chưa có gì để phủ. TTL 30 ngày của grant là concern Infrastructure.
    let grant: { grantId: GrantId; clientId: ClientId; scopes: readonly string[] } | undefined;
    if (input.decision === 'approve') {
      const existing = await this.grants.findActiveGrant(input.subject, input.clientId);
      if (existing !== undefined) {
        assertGrantCoversScope(
          { isActive: existing.isActive, scopes: existing.scopes },
          input.requestedScope,
        );
      }
      grant = {
        clientId: input.clientId,
        grantId: this.grants.newGrantId(),
        scopes: input.requestedScope,
      };
    }

    // Một persistence operation duy nhất — atomicity do port contract bảo đảm.
    const outcome = await this.transactions.decideConsent({
      decision: input.decision,
      eventId: input.eventId,
      expectedAccountSessionRef: input.accountSessionRef,
      expectedSubject: input.subject,
      grant,
      handleHashY: input.handleY as unknown as HandleHash,
      transactionId: input.transactionId,
    });
    if (outcome === 'lost') {
      throw new ConsentRaceError();
    }

    if (input.decision === 'deny' || grant === undefined) {
      return { decision: 'deny', outcome: 'decided' };
    }

    return {
      decision: 'approve',
      grantId: grant.grantId,
      outcome: 'decided',
    };
  }
}
