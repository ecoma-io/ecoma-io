import type { Query } from '@ecoma-io/usecase-primitives';

import type { EmailAddressKey, InvitationId, InvitationSnapshot } from '@ecoma-io/account-domain';

import type { InvitationStore } from '../ports/invitation-store.js';

/** Input của GetInvitation — tra cứu theo id. */
export interface GetInvitationInput {
  readonly id: InvitationId;
}

export type GetInvitationOutput = InvitationSnapshot | undefined;

export type GetInvitation = Query<GetInvitationInput, GetInvitationOutput>;

/**
 * Tra cứu lời mời theo id — staff-side view. Không lọc theo trạng thái: caller
 * (transport) quyết định hiển thị; `undefined` = không tồn tại.
 */
export class GetInvitationUseCase implements GetInvitation {
  readonly #invitations: InvitationStore;

  public constructor(deps: { invitations: InvitationStore }) {
    this.#invitations = deps.invitations;
  }

  public execute(input: GetInvitationInput): Promise<GetInvitationOutput> {
    return this.#invitations.findById(input.id);
  }
}

// Kiểm chứng kiểu (type-level).
export type GetInvitationUseCaseTypeCheck = GetInvitationUseCase extends GetInvitation
  ? true
  : false;

/** Input của ListOpenInvitationsByAddress — điều tra/kiểm tra trước khi phát hành. */
export interface ListOpenInvitationsByAddressInput {
  readonly addressKey: EmailAddressKey;
  readonly now: number;
}

export type ListOpenInvitationsByAddress = Query<
  ListOpenInvitationsByAddressInput,
  readonly InvitationSnapshot[]
>;

/**
 * Danh sách invitation còn `open` (chưa hết hạn) của một địa chỉ — dùng ở
 * challenge (kênh lời mời) và trước khi phát hành invitation mới.
 */
export class ListOpenInvitationsByAddressUseCase implements ListOpenInvitationsByAddress {
  readonly #invitations: InvitationStore;

  public constructor(deps: { invitations: InvitationStore }) {
    this.#invitations = deps.invitations;
  }

  public async execute(
    input: ListOpenInvitationsByAddressInput,
  ): Promise<readonly InvitationSnapshot[]> {
    const open = await this.#invitations.findOpenByAddressKey(input.addressKey);
    return open.filter((i) => i.expiresAt > input.now);
  }
}

export type ListOpenInvitationsByAddressUseCaseTypeCheck =
  ListOpenInvitationsByAddressUseCase extends ListOpenInvitationsByAddress ? true : false;
