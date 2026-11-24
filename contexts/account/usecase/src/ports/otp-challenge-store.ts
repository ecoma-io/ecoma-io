import type {
  EmailAddressKey,
  OtpChallengeId,
  OtpChallengeSnapshot,
  OtpDigest,
  OtpPurpose,
} from '@ecoma-io/account-domain';

import type { TransactionHandle } from './unit-of-work.js';

/** Kết quả của serialization protocol phát hành OTP (proposal §7b). */
export type OtpIssueOutcome =
  | { readonly issued: true; readonly snapshot: OtpChallengeSnapshot }
  /** Thua race partial-unique (một challenge active khác vừa chen vào) — im lặng bỏ. */
  | { readonly rejected: 'race_lost' }
  /** Cooldown resend chưa qua hoặc rate-limit window exceeded. */
  | { readonly rejected: 'cooldown' | 'rate_limited' };

/**
 * Port persistence cho OtpChallenge.
 *
 * Bất biến thiết kế (từ reference `lib/otp.ts`):
 * - **Phát hành là serialization protocol của infrastructure (proposal §7b),
 *   KHÔNG phải nghiệp vụ của use case**: SELECT FOR UPDATE theo business key
 *   `(address_key, purpose)` → cooldown check → window count SAU lock →
 *   consume-old → INSERT. Partial unique index là trọng tài cuối — insert
 *   conflict (23505) nghĩa là thua race: trả `race_lost`, KHÔNG phải lỗi.
 * - Consume/recordFailedAttempt/expire là CAS theo `consumed_at IS NULL` +
 *   `expires_at` — row hết hạn hoặc đã consume không bao giờ transition được.
 * - `recordFailedAttemptAndLock` là MỘT statement: tăng attempts + khóa-at-cap
 *   trong cùng UPDATE (tránh read-modify-write race).
 * - `addressKey` luôn là hash hex — không bao giờ địa chỉ thô.
 */
export interface OtpChallengeStore {
  /**
   * Phát hành challenge theo đúng protocol §7b. `digest` do caller tính (port
   * CryptoDigestPort) và truyền vào — store chỉ persist. Có thể chạy trong `tx`.
   */
  issueWithinProtocol(input: {
    id: OtpChallengeId;
    addressKey: EmailAddressKey;
    purpose: OtpPurpose;
    digest: OtpDigest;
    now: number;
    ttlSeconds: number;
    cooldownSeconds: number;
    rateLimits: {
      shortMax: number;
      shortWindowSeconds: number;
      hourMax: number;
      hourWindowSeconds: number;
    };
    tx?: TransactionHandle;
  }): Promise<OtpIssueOutcome>;

  /** Đọc challenge active mới nhất theo business key; undefined nếu không có. */
  findActive(
    addressKey: EmailAddressKey,
    purpose: OtpPurpose,
    now: number,
    tx?: TransactionHandle,
  ): Promise<OtpChallengeSnapshot | undefined>;

  /**
   * CAS expire: chỉ transition khi `consumed_at IS NULL` và `expires_at <= now`.
   * Trả false nếu thua CAS (đã consume hoặc đã expire trước đó).
   */
  expireIfExpired(id: OtpChallengeId, now: number, tx?: TransactionHandle): Promise<boolean>;

  /**
   * CAS consume: chỉ thắng khi `consumed_at IS NULL` và `expires_at > now` và
   * attempts chưa chạm cap. Expiry kiểm tra BÊN TRONG CAS.
   */
  consume(id: OtpChallengeId, now: number, tx?: TransactionHandle): Promise<boolean>;

  /**
   * MỘT statement: tăng attempts + khóa (terminal attempt_cap) khi đạt cap,
   * CAS `consumed_at IS NULL`. Trả snapshot sau update để caller đọc attempts mới.
   */
  recordFailedAttemptAndLock(
    id: OtpChallengeId,
    now: number,
    tx?: TransactionHandle,
  ): Promise<OtpChallengeSnapshot | undefined>;
}
