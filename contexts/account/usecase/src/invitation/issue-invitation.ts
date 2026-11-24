import type { Command } from '@ecoma-io/usecase-primitives';

import { Invitation } from '@ecoma-io/account-domain';
import type { EmailAddressKey, InvitationSnapshot } from '@ecoma-io/account-domain';

import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { InvitationStore } from '../ports/invitation-store.js';

/** Input của IssueInvitation — addressKey đã hash ở transport (không thấy địa chỉ thô). */
export interface IssueInvitationInput {
  readonly addressKey: EmailAddressKey;
  /** TTL tuỳ chọn (giây) — mặc định INVITATION_TTL_SECONDS của domain. */
  readonly ttlSeconds?: number;
}

export interface IssueInvitationOutput {
  readonly invitation: InvitationSnapshot;
  /** Thua race partial-unique: đã có invitation mở/claim sống cho địa chỉ này. */
  readonly raceLost: boolean;
}

export type IssueInvitation = Command<IssueInvitationInput, IssueInvitationOutput>;

/**
 * Phát hành lời mời — điều phối của tầng staff-side (reference: internal
 * endpoint `invitations.post`). Địa chỉ nhận là addressKey (hash) — use case
 * không thấy địa chỉ thô.
 *
 * Id để phát hành do IdGenerator cấp; id trùng coi như 500-class (entropy đủ).
 */
export class IssueInvitationUseCase implements IssueInvitation {
  readonly #invitations: InvitationStore;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;

  public constructor(deps: { invitations: InvitationStore; ids: IdGenerator; clock: Clock }) {
    this.#invitations = deps.invitations;
    this.#ids = deps.ids;
    this.#clock = deps.clock;
  }

  public async execute(input: IssueInvitationInput): Promise<IssueInvitationOutput> {
    const id = this.#ids.newInvitationId(),
      now = this.#clock.now(),
      invitation = Invitation.issue({
        addressKey: input.addressKey,
        id,
        now,
        ttlSeconds: input.ttlSeconds,
      }),
      inserted = await this.#invitations.insertOpen(invitation.snapshot());
    return { invitation: invitation.snapshot(), raceLost: !inserted };
  }
}

// Kiểm chứng kiểu (type-level): use case bắt buộc tuân thủ Command primitive.
export type IssueInvitationUseCaseTypeCheck = IssueInvitationUseCase extends IssueInvitation
  ? true
  : false;
