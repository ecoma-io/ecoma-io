import type { HandleHash, Subject, TransactionId } from './types.js';

/** Context gắn với authorization code, đọc nguyên tử cùng lúc consume. */
export interface RedeemedAuthorizationCode {
  readonly transactionId: TransactionId;
  readonly subject: Subject;
  readonly scope: readonly string[];
  readonly redirectUri: string;
  readonly codeChallenge: string;
}

export interface AuthorizationCodeRedeemer {
  /**
   * Consume one-shot code (theo hash) và đọc context trong CÙNG một DB transaction.
   * `undefined` = consumed/expired/unknown — non-oracle, không phân biệt nguyên nhân
   * (bất biến từ legacy `redeemAuthorizationCode`).
   */
  redeem(input: { codeHash: HandleHash }): Promise<RedeemedAuthorizationCode | undefined>;
}
