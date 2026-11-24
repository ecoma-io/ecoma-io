import type { Account, AccountSnapshot, Subject } from '@ecoma-io/account-domain';

import type { AccountStore } from '../ports/account-store.js';
import type { TransactionHandle } from '../ports/unit-of-work.js';

/**
 * Fake AccountStore cho unit tests — in-memory. Persist-to-load khớp contract:
 * save ghi đè theo subject; findByVerifiedAddressKey chỉ trả row email verified
 * và account active (khớp contract anti-enumeration của port).
 */
export class InMemoryAccountStore implements AccountStore {
  readonly #rows = new Map<Subject, AccountSnapshot>();

  public insertWithinAcceptanceTx(
    snapshot: AccountSnapshot,
    _tx: TransactionHandle,
  ): Promise<boolean> {
    if (this.#rows.has(snapshot.subject)) {
      return Promise.resolve(false);
    }
    this.#rows.set(snapshot.subject, snapshot);
    return Promise.resolve(true);
  }

  public findById(subject: Subject, _tx?: TransactionHandle): Promise<AccountSnapshot | undefined> {
    return Promise.resolve(this.#rows.get(subject));
  }

  public save(snapshot: AccountSnapshot, _tx?: TransactionHandle): Promise<void> {
    this.#rows.set(snapshot.subject, snapshot);
    return Promise.resolve();
  }

  public async findByVerifiedAddressKey(
    addressKey: string,
    _tx?: TransactionHandle,
  ): Promise<{ subject: Subject; snapshot: AccountSnapshot } | undefined> {
    for (const snapshot of this.#rows.values()) {
      if (snapshot.status !== 'active') {
        continue;
      }
      const match = snapshot.emails.some((e) => e.key === addressKey && e.state === 'verified');
      if (match) {
        return { snapshot, subject: snapshot.subject };
      }
    }
    return undefined;
  }

  /** Seed cho tests — ghi thẳng snapshot (dựng qua Account để guards chạy). */
  public seed(account: Account): void {
    this.#rows.set(account.id, account.snapshot());
  }
}
