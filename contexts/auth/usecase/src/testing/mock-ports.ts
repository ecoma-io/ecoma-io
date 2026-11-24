import type { AuthorizationTransactionStore } from '../ports/authorization-transaction-store.js';
import type { AccountStatusChecker, RevocationChecker } from '../ports/account-status-checker.js';
import type { AuthorizationCodeRedeemer } from '../ports/authorization-code-redeemer.js';
import type { ClientStore } from '../ports/client-store.js';
import type { Clock } from '../ports/clock.js';
import type { GrantStore } from '../ports/grant-store.js';
import type { HandleService } from '../ports/handle-service.js';
import type { AccessTokenIssuer, RefreshTokenIssuer } from '../ports/token-issuer.js';
import type {
  CasOutcome,
  ClientId,
  EventId,
  GrantId,
  Handle,
  HandleHash,
  Subject,
  TransactionId,
} from '../ports/types.js';

/**
 * Helpers dựng mock ports dưới dạng plain objects cho unit tests.
 * Brand các chuỗi test bằng cast trực tiếp — brand chỉ là type-level.
 */
export function asTransactionId(value: string): TransactionId {
  return value as TransactionId;
}
export function asSubject(value: string): Subject {
  return value as Subject;
}
export function asClientId(value: string): ClientId {
  return value as ClientId;
}
export function asGrantId(value: string): GrantId {
  return value as GrantId;
}
export function asHandle(value: string): Handle {
  return value as Handle;
}
export function asHandleHash(value: string): HandleHash {
  return value as HandleHash;
}
export function asEventId(value: string): EventId {
  return value as EventId;
}

/** HandleService mock: derive/hash là hàm giả định xác định (deterministic). */
export function mockHandleService(): HandleService {
  return {
    async browserBindingMatches(): Promise<boolean> {
      return true;
    },
    async deriveHandle({ transactionId, domain }): Promise<Handle> {
      return asHandle(`h-${domain}-${transactionId}`);
    },
    hashEquals(a, b): boolean {
      return a === b;
    },
    async hashHandle(handle): Promise<HandleHash> {
      return asHandleHash(`hash(${handle})`);
    },
  };
}

export function mockTransactionStore(
  overrides: Partial<AuthorizationTransactionStore> = {},
): AuthorizationTransactionStore {
  return {
    advanceWithHandle: async (): Promise<CasOutcome> => 'won',
    completeAndIssueAuthorizationCode: async (): Promise<CasOutcome> => 'won',
    consumeHandleXAndBindIdentity: async (): Promise<CasOutcome> => 'won',
    consumeHandleY: async (): Promise<CasOutcome> => 'won',
    decideConsent: async (): Promise<CasOutcome> => 'won',
    findBoundIdentity: async () => {
      /* Empty */
    },
    findByHandleHashX: async () => {
      /* Empty */
    },
    findPayload: async () => {
      /* Empty */
    },
    findState: async () => {
      /* Empty */
    },
    insertPending: async () => true,
    transition: async (): Promise<CasOutcome> => 'won',
    ...overrides,
  };
}

export function mockGrantStore(overrides: Partial<GrantStore> = {}): GrantStore {
  let grantCounter = 0;
  return {
    findActiveGrant: async () => {
      /* Empty */
    },
    findCommittedConsentDecision: async () => {
      /* Empty */
    },
    insertConsentDecision: async () => {
      /* Empty */
    },
    insertGrantIfAbsent: async ({ grantId }) => grantId,
    listConnectedApplications: async () => [],
    newGrantId: () => asGrantId(`grant-${(grantCounter += 1)}`),
    revokeGrantWithClientRevocation: async (): Promise<CasOutcome> => 'won',
    ...overrides,
  };
}

export function mockAccountStatus(
  status: 'active' | 'suspended' | 'deleted' | 'unknown' = 'active',
): AccountStatusChecker {
  return { check: async () => ({ status }) as never };
}

export function mockRevocation(
  result: 'not_revoked' | 'revoked' | 'unknown' | 'unavailable' = 'not_revoked',
): RevocationChecker {
  return { checkAtIssuance: async () => result };
}

export function mockClientStore(
  client: { redirectUris: readonly string[]; allowedScopes: readonly string[] } | undefined,
): ClientStore {
  return {
    findActiveClient: async () =>
      client === undefined ? undefined : { id: asClientId('client-1'), ...client },
  };
}

export function mockRedeemer(
  result: Awaited<ReturnType<AuthorizationCodeRedeemer['redeem']>>,
): AuthorizationCodeRedeemer {
  return { redeem: async () => result };
}

export function mockTokenIssuers(
  overrides: {
    accessToken?: Partial<AccessTokenIssuer>;
    refreshToken?: Partial<RefreshTokenIssuer>;
  } = {},
): { access: AccessTokenIssuer; refresh: RefreshTokenIssuer } {
  return {
    access: {
      issueAccessToken: async ({ subject, clientId }) => ({
        accessToken: `at-${subject}-${clientId}`,
        expiresIn: 300,
        kid: 'kid-1' as never,
        tokenType: 'Bearer' as const,
      }),
      ...overrides.accessToken,
    },
    refresh: {
      issueOrRotate: async () => ({
        expiresIn: 30 * 24 * 3600,
        familyId: 'family-1',
        refreshToken: 'rt-1',
      }),
      ...overrides.refreshToken,
    },
  };
}

export function mockClock(now = new Date('2026-01-01T00:00:00Z')): Clock {
  return { now: () => now };
}
