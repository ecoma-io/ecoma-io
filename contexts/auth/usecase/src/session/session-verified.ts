import type { Command } from '@ecoma-io/usecase-primitives';

import {
  OAuthProtocolError,
  assessRiskLevel,
  isIssuable,
  needsConsent,
} from '@ecoma-io/auth-domain';
import type { RiskLevel } from '@ecoma-io/auth-domain';

import type { AuthorizationTransactionStore } from '../ports/authorization-transaction-store.js';
import type { AccountStatusChecker, RevocationChecker } from '../ports/account-status-checker.js';
import type { Clock } from '../ports/clock.js';
import type { GrantStore } from '../ports/grant-store.js';
import type { HandleService } from '../ports/handle-service.js';
import type { ClientId, EventId, Handle, Subject } from '../ports/types.js';

export interface SessionVerifiedInput {
  /** Handle X trình bày từ back-channel — chỉ tồn tại plaintext tại đây. */
  readonly handleX: Handle;
  readonly subject: Subject;
  readonly acr: string;
  /** ISO 8601 timestamp của lần xác thực gần nhất. */
  readonly authnAt: string;
  readonly accountSessionRef: string;
  readonly eventId: EventId;
  /** Client của transaction (lấy từ ngữ cảnh của caller — transaction payload). */
  readonly clientId: ClientId;
  /** Scope được yêu cầu (lấy từ transaction payload). */
  readonly requestedScope: readonly string[];
}

export type SessionVerifiedOutput =
  | {
      readonly outcome: 'consent-required';
      readonly handleY: Handle;
      readonly riskLevel: RiskLevel;
    }
  | { readonly outcome: 'ready'; readonly handleZ: Handle; readonly riskLevel: RiskLevel }
  | { readonly outcome: 'replayed'; readonly state: string };

/** Alias contract cho type-level test. */
export type SessionVerifiedUseCaseType = Command<SessionVerifiedInput, SessionVerifiedOutput>;

/** Cửa sổ xác thực được coi là "fresh" — 5 phút, từ legacy. */
const FRESH_AUTHN_WINDOW_MS = 5 * 60 * 1000;

/**
 * Command back-channel session verification (account → auth).
 *
 * Bất biến từ legacy session-verified-handler:
 * - Consume handle X + bind identity + event block là MỘT thao tác nguyên tử
 *   (port `consumeHandleXAndBindIdentity`) — không có cửa sổ read-then-write.
 * - Replay: CAS thua NHƯNG transaction đã qua `browser_confirmed` → idempotent
 *   replay, KHÔNG re-materialize outcome cũ.
 * - Fail-closed: account status khác `active` (kể cả `unknown`) và revocation
 *   khác `not_revoked` (kể cả `unknown`/`unavailable`) đều chặn.
 * - Handle Y/Z derive với domain separation, trả plaintext đúng một lần;
 *   at-rest chỉ lưu hash qua `advanceWithHandle`.
 */
export class SessionVerifiedUseCase implements SessionVerifiedUseCaseType {
  public constructor(
    private readonly transactions: AuthorizationTransactionStore,
    private readonly grants: GrantStore,
    private readonly handles: HandleService,
    private readonly accountStatus: AccountStatusChecker,
    private readonly revocation: RevocationChecker,
    private readonly clock: Clock,
  ) {}

  public async execute(input: SessionVerifiedInput): Promise<SessionVerifiedOutput> {
    const handleHashX = await this.handles.hashHandle(input.handleX),
      transactionId = await this.transactions.findByHandleHashX(handleHashX);
    if (transactionId === undefined) {
      throw OAuthProtocolError.directInvalidGrant('handle khong ton tai');
    }

    const consumed = await this.transactions.consumeHandleXAndBindIdentity({
      accountSessionRef: input.accountSessionRef,
      acr: input.acr,
      authnAt: new Date(input.authnAt),
      eventId: input.eventId,
      handleHashX,
      subject: input.subject,
      transactionId,
    });

    if (consumed === 'lost') {
      const state = await this.transactions.findState(transactionId);
      if (
        state === undefined ||
        state.state === 'pending_browser' ||
        state.state === 'browser_confirmed'
      ) {
        throw OAuthProtocolError.directInvalidGrant('handle da bi su dung');
      }
      return { outcome: 'replayed', state: state.state };
    }

    const status = await this.accountStatus.check(input.subject);
    if (status.status !== 'active') {
      throw OAuthProtocolError.accessDenied('account khong the cap token');
    }

    const revocationResult = await this.revocation.checkAtIssuance({
      clientId: input.clientId,
      subject: input.subject,
    });
    if (!isIssuable(revocationResult)) {
      throw OAuthProtocolError.accessDenied('subject da bi thu hoi');
    }

    const authnAt = new Date(input.authnAt).getTime(),
      isAuthenticationFresh = this.clock.now().getTime() - authnAt <= FRESH_AUTHN_WINDOW_MS,
      riskLevel = assessRiskLevel({
        isAuthenticationFresh,
        isNewClient: false,
        isNewScope: false,
      }),
      grant = await this.grants.findActiveGrant(input.subject, input.clientId),
      consentRequired = needsConsent({
        existingGrant:
          grant === undefined ? undefined : { isActive: grant.isActive, scopes: grant.scopes },
        requestedScope: input.requestedScope,
      });

    if (consentRequired) {
      const handleY = await this.handles.deriveHandle({
          domain: 'consent-continuation',
          transactionId,
        }),
        advanced = await this.transactions.advanceWithHandle({
          fromState: 'browser_confirmed',
          handleHash: await this.handles.hashHandle(handleY),
          toState: 'awaiting_consent',
          transactionId,
        });
      if (advanced === 'lost') {
        throw OAuthProtocolError.directInvalidGrant('chuyen trang thai that bai');
      }
      return { handleY, outcome: 'consent-required', riskLevel };
    }

    const handleZ = await this.handles.deriveHandle({
        domain: 'authorization-code',
        transactionId,
      }),
      advanced = await this.transactions.advanceWithHandle({
        fromState: 'browser_confirmed',
        handleHash: await this.handles.hashHandle(handleZ),
        toState: 'ready_to_complete',
        transactionId,
      });
    if (advanced === 'lost') {
      throw OAuthProtocolError.directInvalidGrant('chuyen trang thai that bai');
    }
    return { handleZ, outcome: 'ready', riskLevel };
  }
}
