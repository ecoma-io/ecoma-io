import type { InvitationId, InvitationSnapshot } from '@ecoma-io/account-domain';

import type { InvitationStore } from '../ports/invitation-store.js';
import type { TransactionHandle } from '../ports/unit-of-work.js';

/**
 * Fake InvitationStore cho unit tests — in-memory, CAS theo state + expires_at.
 * Không mô phỏng serialization protocol phát hành (protocol thuộc infrastructure);
 * `rejectNextInsert` cho phép giả lập thua race partial-unique.
 */
export class InMemoryInvitationStore implements InvitationStore {
  readonly #rows = new Map<InvitationId, InvitationSnapshot>();
  #rejectNextInsert: boolean;

  public constructor(options?: { rejectNextInsert?: boolean }) {
    this.#rejectNextInsert = options?.rejectNextInsert ?? false;
  }

  public insertOpen(snapshot: InvitationSnapshot, _tx?: TransactionHandle): Promise<boolean> {
    if (this.#rejectNextInsert) {
      this.#rejectNextInsert = false;
      return Promise.resolve(false);
    }
    this.#rows.set(snapshot.id, snapshot);
    return Promise.resolve(true);
  }

  public consumeOpenWithinTx(input: {
    id: InvitationId;
    now: number;
    acceptedAt: number;
    acceptedSubject: string;
    tx: TransactionHandle;
  }): Promise<boolean> {
    const row = this.#rows.get(input.id);
    if (row === undefined || row.state !== 'open' || row.expiresAt <= input.now) {
      return Promise.resolve(false);
    }
    this.#rows.set(input.id, {
      ...row,
      acceptedAt: input.acceptedAt,
      acceptedSubject: input.acceptedSubject as InvitationSnapshot['acceptedSubject'],
      state: 'accepted',
    });
    return Promise.resolve(true);
  }

  public revoke(id: InvitationId, _tx?: TransactionHandle): Promise<boolean> {
    const row = this.#rows.get(id);
    if (row === undefined || row.state !== 'open') {
      return Promise.resolve(false);
    }
    this.#rows.set(id, { ...row, state: 'revoked' });
    return Promise.resolve(true);
  }

  public expireIfExpired(id: InvitationId, now: number, _tx?: TransactionHandle): Promise<boolean> {
    const row = this.#rows.get(id);
    if (row === undefined || row.state !== 'open' || now < row.expiresAt) {
      return Promise.resolve(false);
    }
    this.#rows.set(id, { ...row, state: 'expired' });
    return Promise.resolve(true);
  }

  public findById(
    id: InvitationId,
    _tx?: TransactionHandle,
  ): Promise<InvitationSnapshot | undefined> {
    return Promise.resolve(this.#rows.get(id));
  }

  public findOpenByAddressKey(
    addressKey: InvitationSnapshot['addressKey'],
    _tx?: TransactionHandle,
  ): Promise<readonly InvitationSnapshot[]> {
    return Promise.resolve(
      [...this.#rows.values()].filter(
        (row) => row.addressKey === addressKey && row.state === 'open',
      ),
    );
  }
}
