import type { Command } from '@ecoma-io/usecase-primitives';

import type { InvitationId } from '@ecoma-io/account-domain';

import type { Clock } from '../ports/clock.js';
import type { InvitationStore } from '../ports/invitation-store.js';

/** Input của RevokeInvitation. */
export interface RevokeInvitationInput {
  readonly id: InvitationId;
}

/**
 * Kết quả revoke — mọi nhánh negotiated, không exception:
 * - `revoked`: CAS thắng (state `open` → `revoked`).
 * - `not_open`: invitation đã accepted/revoked/expired hoặc không tồn tại —
 *   cùng một nhánh (không oracle cho tồn tại của id).
 * - `expired`: còn open nhưng đã quá hạn — CAS expire chạy trước.
 */
export type RevokeInvitationResult =
  | { readonly revoked: true }
  | { readonly rejected: 'not_open' | 'expired' };

export type RevokeInvitation = Command<RevokeInvitationInput, RevokeInvitationResult>;

/**
 * Thu hồi lời mời — CAS theo state `open` (port contract). Hết hạn trước revoke:
 * CAS expire chạy trước để state DB khớp sự thật máy trạng thái, rồi trả
 * `expired` — caller thấy lý do đúng, không phải `not_open` chung.
 */
export class RevokeInvitationUseCase implements RevokeInvitation {
  readonly #invitations: InvitationStore;
  readonly #clock: Clock;

  public constructor(deps: { invitations: InvitationStore; clock: Clock }) {
    this.#invitations = deps.invitations;
    this.#clock = deps.clock;
  }

  public async execute(input: RevokeInvitationInput): Promise<RevokeInvitationResult> {
    const now = this.#clock.now(),
      snapshot = await this.#invitations.findById(input.id);
    if (snapshot === undefined || snapshot.state !== 'open') {
      return { rejected: 'not_open' };
    }
    if (snapshot.expiresAt <= now) {
      // Hygiene: state DB khớp máy trạng thái (lazy TTL) — CAS của store tự
      // Bảo chỉ transition từ open.
      await this.#invitations.expireIfExpired(input.id, now);
      return { rejected: 'expired' };
    }
    const revoked = await this.#invitations.revoke(input.id);
    return revoked ? { revoked: true } : { rejected: 'not_open' };
  }
}

// Kiểm chứng kiểu (type-level).
export type RevokeInvitationUseCaseTypeCheck = RevokeInvitationUseCase extends RevokeInvitation
  ? true
  : false;
