/**
 * Aggregate `LoginHandoff` — bàn giao phiên từ Account app sang Auth, khóa theo
 * handle của transaction OAuth phía auth.
 *
 * First-binding-wins là race resolution ở **infrastructure**: PK `handle_hash`
 * + `INSERT ... ON CONFLICT DO NOTHING`; phía thắng nhận aggregate, phía thua
 * nhận identity của winner (không phải exception). Domain mô hình hóa kết quả
 * qua {@link LoginHandoff.fromFirstBind}.
 *
 * State machine (forward-only, khớp trigger `login_handoffs_rebind_guard` của
 * reference):
 *   bound → session_rotated → consumed
 *   consumed: terminal.
 *
 * `expired` **không phải trạng thái persisted** — TTL là thuộc tính thời gian
 * (kiểm tra tại `consume`/`rotateTo` qua `isExpired`), không phải transition.
 * Không có reaper riêng trong domain (prune job là follow-up của tầng
 * infrastructure).
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';
import type { Brand } from '@ecoma-io/domain-primitives';

import { domainError } from '../shared/errors';
import type { DomainError } from '../shared/errors';
import type { SessionRef } from '../browser-session/browser-session';

/** TTL của handoff (giây) — cùng mốc 10 phút với TTL transaction phía auth. */
export const LOGIN_HANDOFF_TTL_SECONDS = 600;

/** Chuỗi hash của handle — PK thực tế trong DB. Hash do infrastructure tính. */
export type HandleHash = Brand<string, 'HandleHash'>;

export const LOGIN_HANDOFF_STATE = {
  Bound: 'bound',
  Consumed: 'consumed',
  SessionRotated: 'session_rotated',
} as const;
export type LoginHandoffState = (typeof LOGIN_HANDOFF_STATE)[keyof typeof LOGIN_HANDOFF_STATE];

/** Bảng transition tường minh — nguồn cho table-driven state tests. */
export const LOGIN_HANDOFF_TRANSITIONS: Record<LoginHandoffState, readonly LoginHandoffState[]> = {
  bound: [LOGIN_HANDOFF_STATE.SessionRotated],
  consumed: [],
  session_rotated: [LOGIN_HANDOFF_STATE.Consumed],
};

export interface LoginHandoffSnapshot {
  readonly handleHash: HandleHash;
  readonly sessionRef: SessionRef;
  readonly state: LoginHandoffState;
  readonly expiresAt: number;
}

const LOGIN_HANDOFF_STATES: ReadonlySet<string> = new Set(Object.values(LOGIN_HANDOFF_STATE));

export class LoginHandoff extends AggregateRoot<HandleHash> {
  #sessionRef: SessionRef;
  #state: LoginHandoffState;
  readonly #expiresAt: number;

  private constructor(
    id: HandleHash,
    sessionRef: SessionRef,
    state: LoginHandoffState,
    expiresAt: number,
  ) {
    super(id);
    this.#sessionRef = sessionRef;
    this.#state = state;
    this.#expiresAt = expiresAt;
  }

  /**
   * Kết quả của INSERT ... ON CONFLICT: phía thắng tạo binding mới; phía thua
   * chỉ cần biết winner là ai để so sánh session_ref.
   */
  public static fromFirstBind(args: {
    handleHash: HandleHash;
    sessionRef: SessionRef;
    now: number;
    won: boolean;
    winnerSessionRef?: SessionRef;
    ttlSeconds?: number;
  }): LoginHandoff | { alreadyBound: SessionRef } {
    if (args.won) {
      if (!Number.isFinite(args.now)) {
        throw new TypeError('LoginHandoff.fromFirstBind: now phải là số hữu hạn.');
      }
      if (
        args.ttlSeconds !== undefined &&
        (!Number.isFinite(args.ttlSeconds) || args.ttlSeconds <= 0)
      ) {
        throw new TypeError('LoginHandoff.fromFirstBind: ttlSeconds phải là số hữu hạn dương.');
      }
      // TtlSeconds khổng lồ làm expiresAt tràn thành Infinity — snapshot sẽ bị
      // Reconstitute từ chối.
      if (!Number.isFinite(args.now + (args.ttlSeconds ?? LOGIN_HANDOFF_TTL_SECONDS) * 1000)) {
        throw new TypeError('LoginHandoff.fromFirstBind: expiresAt tràn giá trị.');
      }
      // Shape check tại behavior entry — khớp reconstitute (hex-64).
      if (!/^[0-9a-f]{64}$/u.test(args.handleHash)) {
        throw new TypeError('LoginHandoff.fromFirstBind: handleHash không đúng định dạng.');
      }
      if (typeof args.sessionRef !== 'string' || args.sessionRef.length === 0) {
        // Không validation thì snapshot() tạo snapshot mà reconstitute() từ chối.
        throw new TypeError('LoginHandoff.fromFirstBind: sessionRef không hợp lệ.');
      }
      return new LoginHandoff(
        args.handleHash,
        args.sessionRef,
        LOGIN_HANDOFF_STATE.Bound,
        args.now + (args.ttlSeconds ?? LOGIN_HANDOFF_TTL_SECONDS) * 1000,
      );
    }
    if (args.winnerSessionRef === undefined) {
      throw new TypeError('fromFirstBind thua binding nhưng thiếu winnerSessionRef.');
    }
    return { alreadyBound: args.winnerSessionRef };
  }

  public static reconstitute(snapshot: LoginHandoffSnapshot): LoginHandoff {
    if (
      !LOGIN_HANDOFF_STATES.has(snapshot.state) ||
      !Number.isFinite(snapshot.expiresAt) ||
      // Shape check: handle_hash là SHA-256 hex của handle (PK thực tế trong
      // DB do infrastructure tính); session_ref là hash của cookie value.
      !/^[0-9a-f]{64}$/u.test(snapshot.handleHash) ||
      typeof snapshot.sessionRef !== 'string' ||
      snapshot.sessionRef.length === 0
    ) {
      throw new TypeError('LoginHandoff snapshot không hợp lệ.');
    }
    return new LoginHandoff(
      snapshot.handleHash,
      snapshot.sessionRef,
      snapshot.state,
      snapshot.expiresAt,
    );
  }

  public handleHash(): HandleHash {
    return this.id;
  }

  public state(): LoginHandoffState {
    return this.#state;
  }

  public expiresAt(): number {
    return this.#expiresAt;
  }

  public sessionRef(): SessionRef {
    return this.#sessionRef;
  }

  public isExpired(now: number): boolean {
    return now >= this.#expiresAt;
  }

  /**
   * `bound → session_rotated` — đúng một lần, chỉ trước TTL. Chuyển binding
   * sang phiên mới (session rotation). Hết TTL là outcome nghiệp vụ bình
   * thường → domain error; state sai cũng là protocol violation → domain
   * error (convention §11: mọi protocol violation trả DomainError).
   */
  public rotateTo(sessionRef: SessionRef, now: number): undefined | DomainError {
    if (typeof sessionRef !== 'string' || sessionRef.length === 0 || !Number.isFinite(now)) {
      // Invalid input không mutation — không đổi binding bằng giá trị rác.
      return domainError('invalid_transition');
    }
    if (this.#state !== LOGIN_HANDOFF_STATE.Bound) {
      return domainError('invalid_transition');
    }
    if (this.isExpired(now)) {
      return domainError('session_expired');
    }
    this.#state = LOGIN_HANDOFF_STATE.SessionRotated;
    this.#sessionRef = sessionRef;
    return undefined;
  }

  /**
   * Consume handoff: chỉ khi `bound | session_rotated`, đúng `session_ref`,
   * còn TTL. Consume một lần duy nhất.
   */
  public consume(
    sessionRef: SessionRef,
    now: number,
  ): { consumed: true } | { rejected: 'binding_mismatch' | 'terminal' | 'expired' } {
    // Invalid input không được consume: rác không khớp binding — trả mismatch,
    // Không đổi state (thứ tự mismatch-first giữ nguyên chống lifecycle leak).
    if (typeof sessionRef !== 'string' || sessionRef.length === 0 || !Number.isFinite(now)) {
      return { rejected: 'binding_mismatch' };
    }
    // Thứ tự khớp reference `checkHandoffBinding`: mismatch TRƯỚC unusable —
    // Sai phiên là tín hiệu quan trọng hơn trạng thái chết (không leak lifecycle).
    if (this.#sessionRef !== sessionRef) {
      return { rejected: 'binding_mismatch' };
    }
    if (this.#state === LOGIN_HANDOFF_STATE.Consumed) {
      return { rejected: 'terminal' };
    }
    if (this.isExpired(now)) {
      return { rejected: 'expired' };
    }
    this.#state = LOGIN_HANDOFF_STATE.Consumed;
    return { consumed: true };
  }

  public snapshot(): LoginHandoffSnapshot {
    return {
      expiresAt: this.#expiresAt,
      handleHash: this.id,
      sessionRef: this.#sessionRef,
      state: this.#state,
    };
  }
}
