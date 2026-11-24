import type { Query } from '@ecoma-io/usecase-primitives';

import { OAuthProtocolError, assessRiskLevel, needsConsent } from '@ecoma-io/auth-domain';
import type { RiskLevel } from '@ecoma-io/auth-domain';

import type { GrantStore } from '../ports/grant-store.js';
import type { AuthorizationTransactionStore } from '../ports/authorization-transaction-store.js';
import type { Clock } from '../ports/clock.js';
import type { ClientId, TransactionId } from '../ports/types.js';

export interface ConsentContextInput {
  readonly transactionId: TransactionId;
  readonly accountSessionRef: string;
  readonly clientId: ClientId;
  readonly requestedScope: readonly string[];
}

export interface ConsentContextOutput {
  readonly needsConsent: boolean;
  readonly riskLevel: RiskLevel;
  readonly grantedScopes: readonly string[];
  readonly requestedScope: readonly string[];
}

/** Alias contract để type-level test tham chiếu. */
export type ConsentContextUseCaseType = Query<ConsentContextInput, ConsentContextOutput>;

/**
 * Query đọc ngữ cảnh consent — CHỈ ĐỌC.
 *
 * Bất biến từ legacy consent handler:
 * - Transaction phải đang `awaiting_consent` (404 thay cho leak trạng thái khác)
 *   và chưa hết hạn (422) — ngữ cảnh không lộ cho transaction terminal/hết hạn.
 * - ASR (account_session_ref) của request phải khớp ASR đã bind lúc consume X —
 *   nếu không, đây là transaction của session khác → invalid_grant.
 * - Risk level chỉ là thông tin trình bày UI, không phải input quyết định;
 *   freshness tính từ authnAt thực (5 phút) chứ không hardcode.
 */
const FRESH_AUTHN_WINDOW_MS = 5 * 60 * 1000;

export class ConsentContextQuery implements ConsentContextUseCaseType {
  public constructor(
    private readonly transactions: AuthorizationTransactionStore,
    private readonly grants: GrantStore,
    private readonly clock: Clock,
  ) {}

  public async execute(input: ConsentContextInput): Promise<ConsentContextOutput> {
    const state = await this.transactions.findState(input.transactionId);
    if (state === undefined) {
      throw OAuthProtocolError.directInvalidGrant('transaction khong ton tai');
    }

    // Legacy: chỉ awaiting_consent được xem ngữ cảnh; hết hạn → 422.
    if (state.state !== 'awaiting_consent') {
      throw OAuthProtocolError.directInvalidGrant('transaction khong cho xem consent');
    }
    if (state.expiresAt.getTime() <= this.clock.now().getTime()) {
      throw OAuthProtocolError.directInvalidGrant('transaction da het han');
    }

    const identity = await this.transactions.findBoundIdentity(input.transactionId);
    if (identity === undefined || identity.accountSessionRef !== input.accountSessionRef) {
      throw OAuthProtocolError.directInvalidGrant('session khong khop transaction');
    }

    const grant = await this.grants.findActiveGrant(identity.subject, input.clientId),
      existingGrant =
        grant === undefined ? undefined : { isActive: grant.isActive, scopes: grant.scopes },
      consentRequired = needsConsent({
        existingGrant,
        requestedScope: input.requestedScope,
      }),
      // Risk level là trình bày — freshness từ authnAt thực của lần xác thực.
      isAuthenticationFresh =
        this.clock.now().getTime() - identity.authnAt.getTime() <= FRESH_AUTHN_WINDOW_MS,
      riskLevel = assessRiskLevel({
        isAuthenticationFresh,
        isNewClient: grant === undefined,
        isNewScope: consentRequired,
      });

    return {
      grantedScopes: grant?.scopes ?? [],
      needsConsent: consentRequired,
      requestedScope: input.requestedScope,
      riskLevel,
    };
  }
}
