import { BrowserSession } from '@ecoma-io/account-domain';
import type { BrowserSessionSnapshot, SessionRef, Subject } from '@ecoma-io/account-domain';

import type { BrowserSessionStore } from '../ports/browser-session-store.js';
import type { TransactionHandle } from '../ports/unit-of-work.js';

/**
 * Fake BrowserSessionStore cho unit tests — in-memory, CAS như contract:
 * - `subject` là thuộc tính persistence đi kèm snapshot (không nằm trong
 *   domain snapshot — xem JSDoc port).
 * - rotateWithinTx thua khi phiên old đã revoked (giả lập CAS revoked_at) —
 *   revoked_at của phiên cũ = `now` truyền vào, không fudge từ createdAt.
 * - revokeOne/revokeAllBySubject chỉ chạm row revoked_at IS NULL.
 * Hết hạn (expires_at) được lọc tại listLiveBySubject theo `now` — không reaper.
 */
export class InMemoryBrowserSessionStore implements BrowserSessionStore {
  readonly #rows = new Map<SessionRef, BrowserSessionSnapshot>();
  readonly #ownerByRef = new Map<SessionRef, Subject>();
  /** Cho phép test ép rotateWithinTx thua CAS. */
  public failNextRotate = false;

  public insertWithinTx(input: {
    subject: Subject;
    snapshot: BrowserSessionSnapshot;
    tx?: TransactionHandle;
  }): Promise<boolean> {
    if (this.#rows.has(input.snapshot.sessionRef)) {
      return Promise.resolve(false);
    }
    this.#rows.set(input.snapshot.sessionRef, input.snapshot);
    this.#ownerByRef.set(input.snapshot.sessionRef, input.subject);
    return Promise.resolve(true);
  }

  public findById(
    sessionRef: SessionRef,
    _tx?: TransactionHandle,
  ): Promise<BrowserSessionSnapshot | undefined> {
    return Promise.resolve(this.#rows.get(sessionRef));
  }

  public findOwnerByRef(
    sessionRef: SessionRef,
    _tx?: TransactionHandle,
  ): Promise<Subject | undefined> {
    return Promise.resolve(this.#ownerByRef.get(sessionRef));
  }

  public save(snapshot: BrowserSessionSnapshot, _tx?: TransactionHandle): Promise<void> {
    this.#rows.set(snapshot.sessionRef, snapshot);
    return Promise.resolve();
  }

  public rotateWithinTx(input: {
    oldSessionRef: SessionRef;
    subject: Subject;
    newSnapshot: BrowserSessionSnapshot;
    now: number;
    tx: TransactionHandle;
  }): Promise<boolean> {
    if (this.failNextRotate) {
      this.failNextRotate = false;
      return Promise.resolve(false);
    }
    const old = this.#rows.get(input.oldSessionRef);
    if (old === undefined || old.revokedAt !== null) {
      return Promise.resolve(false);
    }
    this.#rows.set(input.oldSessionRef, { ...old, revokedAt: input.now, state: 'revoked' });
    this.#rows.set(input.newSnapshot.sessionRef, input.newSnapshot);
    this.#ownerByRef.set(input.newSnapshot.sessionRef, input.subject);
    return Promise.resolve(true);
  }

  public listLiveBySubject(
    subject: Subject,
    now: number,
    _tx?: TransactionHandle,
  ): Promise<readonly BrowserSessionSnapshot[]> {
    return Promise.resolve(
      [...this.#rows.entries()]
        .filter(
          ([ref, s]) =>
            this.#ownerByRef.get(ref) === subject && s.revokedAt === null && now < s.expiresAt,
        )
        .map(([, s]) => s)
        .toSorted((a, b) => b.createdAt - a.createdAt),
    );
  }

  public revokeOne(sessionRef: SessionRef, now: number, _tx?: TransactionHandle): Promise<boolean> {
    const row = this.#rows.get(sessionRef);
    if (row === undefined || row.revokedAt !== null) {
      return Promise.resolve(false);
    }
    const session = BrowserSession.reconstitute(row);
    session.revoke(now);
    this.#rows.set(sessionRef, session.snapshot());
    return Promise.resolve(true);
  }

  public revokeAllBySubject(
    subject: Subject,
    now: number,
    _tx?: TransactionHandle,
  ): Promise<number> {
    let count = 0;
    for (const [ref, row] of this.#rows) {
      if (row.revokedAt !== null || this.#ownerByRef.get(ref) !== subject) {
        continue;
      }
      const session = BrowserSession.reconstitute(row);
      session.revoke(now);
      this.#rows.set(ref, session.snapshot());
      count += 1;
    }
    return Promise.resolve(count);
  }

  /** Seed trực tiếp với subject — dựng qua aggregate để snapshot hợp lệ. */
  public seed(subject: Subject, session: BrowserSession): void {
    this.#rows.set(session.sessionRef(), session.snapshot());
    this.#ownerByRef.set(session.sessionRef(), subject);
  }
}
