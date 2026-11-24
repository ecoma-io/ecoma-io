import { LoginHandoff } from '@ecoma-io/account-domain';
import type { HandleHash, LoginHandoffSnapshot, SessionRef } from '@ecoma-io/account-domain';

import type { LoginHandoffStore } from '../ports/login-handoff-store.js';
import type { TransactionHandle } from '../ports/unit-of-work.js';

/**
 * Fake LoginHandoffStore — in-memory. `bindFirst` mô phỏng ON CONFLICT DO
 * NOTHING: row đã tồn tại ⇒ `{ won: false, winnerSessionRef }`. CAS consume/rotate
 * theo state + expires_at như contract port.
 */
export class InMemoryLoginHandoffStore implements LoginHandoffStore {
  readonly #rows = new Map<HandleHash, LoginHandoffSnapshot>();
  public failNextRotate = false;
  public failNextConsume = false;

  public bindFirst(input: {
    handleHash: HandleHash;
    sessionRef: SessionRef;
    now: number;
    ttlSeconds: number;
    tx?: TransactionHandle;
  }): Promise<{ won: true } | { won: false; winnerSessionRef: SessionRef }> {
    const existing = this.#rows.get(input.handleHash);
    if (existing !== undefined) {
      return Promise.resolve({ winnerSessionRef: existing.sessionRef, won: false });
    }
    this.#rows.set(input.handleHash, {
      expiresAt: input.now + input.ttlSeconds * 1000,
      handleHash: input.handleHash,
      sessionRef: input.sessionRef,
      state: 'bound',
    });
    return Promise.resolve({ won: true });
  }

  public findById(
    handleHash: HandleHash,
    _tx?: TransactionHandle,
  ): Promise<LoginHandoffSnapshot | undefined> {
    return Promise.resolve(this.#rows.get(handleHash));
  }

  public rotateToWithinTx(input: {
    handleHash: HandleHash;
    newSessionRef: SessionRef;
    now: number;
    tx: TransactionHandle;
  }): Promise<boolean> {
    if (this.failNextRotate) {
      this.failNextRotate = false;
      return Promise.resolve(false);
    }
    const row = this.#rows.get(input.handleHash);
    if (row === undefined || row.state !== 'bound' || input.now >= row.expiresAt) {
      return Promise.resolve(false);
    }
    this.#rows.set(input.handleHash, {
      ...row,
      sessionRef: input.newSessionRef,
      state: 'session_rotated',
    });
    return Promise.resolve(true);
  }

  public consume(handleHash: HandleHash, now: number, _tx?: TransactionHandle): Promise<boolean> {
    if (this.failNextConsume) {
      this.failNextConsume = false;
      return Promise.resolve(false);
    }
    const row = this.#rows.get(handleHash);
    if (row === undefined || row.state === 'consumed' || now >= row.expiresAt) {
      return Promise.resolve(false);
    }
    this.#rows.set(handleHash, { ...row, state: 'consumed' });
    return Promise.resolve(true);
  }

  public carryBindingWithinTx(input: {
    fromSessionRef: SessionRef;
    toSessionRef: SessionRef;
    now: number;
    tx: TransactionHandle;
  }): Promise<boolean> {
    const row = [...this.#rows.values()].find(
      (r) => r.sessionRef === input.fromSessionRef && r.state === 'bound',
    );
    if (row === undefined || input.now >= row.expiresAt) {
      return Promise.resolve(false);
    }
    this.#rows.set(row.handleHash, {
      ...row,
      sessionRef: input.toSessionRef,
      state: 'session_rotated',
    });
    return Promise.resolve(true);
  }

  /** Seed trực tiếp snapshot (dựng qua aggregate khi cần guards). */
  public seed(snapshot: LoginHandoffSnapshot): void {
    this.#rows.set(snapshot.handleHash, snapshot);
  }
}

/** Helper: hex-64 handle hash giả cho tests. */
export function fakeHandleHash(n: number): HandleHash {
  return n.toString(16).padStart(64, '0') as HandleHash;
}

/** Helper: dựng binding `bound` hợp lệ cho tests. */
export function boundHandoff(
  handleHash: HandleHash,
  sessionRef: SessionRef,
  now: number,
): LoginHandoffSnapshot {
  const handoff = LoginHandoff.fromFirstBind({
    handleHash,
    now,
    sessionRef,
    won: true,
  });
  if (handoff instanceof LoginHandoff) {
    return handoff.snapshot();
  }
  throw new TypeError('boundHandoff: unexpected alreadyBound');
}
