import type { InvitationId, OtpChallengeId, SessionRef } from '@ecoma-io/account-domain';

/**
 * Port sinh identifier và entropy — Use Case không tự gọi crypto.
 * - Id dùng cho aggregate mới (invitation id, challenge id…).
 * - Entropy dùng cho `createSubject` (base32 32 ký tự — Subject tự thêm prefix).
 * - SessionRef: SHA-256 hex của entropy CSPRNG (hash của cookie value — cookie
 *   value không bao giờ persist; port sinh trực tiếp dạng hash, SR-006).
 */
export interface IdGenerator {
  newInvitationId(): InvitationId;
  newOtpChallengeId(): OtpChallengeId;
  /** Entropy base32 (32 ký tự viết thường) cho Subject mới. */
  newSubjectEntropy(): string;
  /** SessionRef mới (hex 64 ký tự) cho phiên browser. */
  newSessionRef(): SessionRef;
}
