import type { Command } from '@ecoma-io/usecase-primitives';

import { LOGIN_HANDOFF_TTL_SECONDS, LoginHandoff } from '@ecoma-io/account-domain';
import type { HandleHash, SessionRef } from '@ecoma-io/account-domain';

import type { Clock } from '../ports/clock.js';
import type { LoginHandoffStore } from '../ports/login-handoff-store.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

/**
 * Login Handoff use cases (FR-006): bind-first (first-binding-wins),
 * rotate binding cùng transaction session rotation, consume tại handoff route.
 */

/** Input của BindLoginHandoff. */
export interface BindLoginHandoffInput {
  readonly handleHash: HandleHash;
  /** SessionRef của phiên đang trình handle (anonymous hoặc authenticated). */
  readonly sessionRef: SessionRef;
}

/**
 * Kết quả bind — `{ won: true }` khi request này bind đầu tiên;
 * `alreadyBound` khi session khác đã bind trước: chỉ SO KHÓP, không ghi đè,
 * không phân nhánh (FR-006c3 lớp 1) — real rejection là việc của consume.
 */
export type BindLoginHandoffResult = { readonly won: true } | { readonly alreadyBound: SessionRef };

export type BindLoginHandoff = Command<BindLoginHandoffInput, BindLoginHandoffResult>;

/**
 * Ghi binding đầu tiên cho handle X vào phiên trình nó. INSERT ... ON CONFLICT
 * DO NOTHING ở store; thua binding là outcome nghiệp vụ bình thường.
 */
export class BindLoginHandoffUseCase implements BindLoginHandoff {
  readonly #handoffs: LoginHandoffStore;
  readonly #clock: Clock;

  public constructor(deps: { handoffs: LoginHandoffStore; clock: Clock }) {
    this.#handoffs = deps.handoffs;
    this.#clock = deps.clock;
  }

  public async execute(input: BindLoginHandoffInput): Promise<BindLoginHandoffResult> {
    const outcome = await this.#handoffs.bindFirst({
      handleHash: input.handleHash,
      now: this.#clock.now(),
      sessionRef: input.sessionRef,
      ttlSeconds: LOGIN_HANDOFF_TTL_SECONDS,
    });
    return outcome.won ? { won: true } : { alreadyBound: outcome.winnerSessionRef };
  }
}

export type BindLoginHandoffUseCaseTypeCheck = BindLoginHandoffUseCase extends BindLoginHandoff
  ? true
  : false;

/** Input của RotateLoginHandoffBinding — carry binding sang phiên mới. */
export interface RotateLoginHandoffBindingInput {
  readonly handleHash: HandleHash;
  readonly newSessionRef: SessionRef;
}

export type RotateLoginHandoffBindingResult =
  | { readonly rotated: true }
  | { readonly rejected: 'not_found' | 'not_bound' | 'expired' };

export type RotateLoginHandoffBinding = Command<
  RotateLoginHandoffBindingInput,
  RotateLoginHandoffBindingResult
>;

/**
 * Chuyển binding sang phiên mới — CHỈ gọi trong transaction rotation session
 * (FR-006c4). Guard theo aggregate: state `bound`, chưa hết TTL; expired là
 * domain error riêng, không lẫn `not_bound`.
 */
export class RotateLoginHandoffBindingUseCase implements RotateLoginHandoffBinding {
  readonly #handoffs: LoginHandoffStore;
  readonly #unitOfWork: UnitOfWork;
  readonly #clock: Clock;

  public constructor(deps: { handoffs: LoginHandoffStore; unitOfWork: UnitOfWork; clock: Clock }) {
    this.#handoffs = deps.handoffs;
    this.#unitOfWork = deps.unitOfWork;
    this.#clock = deps.clock;
  }

  public async execute(
    input: RotateLoginHandoffBindingInput,
  ): Promise<RotateLoginHandoffBindingResult> {
    const now = this.#clock.now(),
      snapshot = await this.#handoffs.findById(input.handleHash);
    if (snapshot === undefined) {
      return { rejected: 'not_found' };
    }
    if (snapshot.expiresAt <= now) {
      return { rejected: 'expired' };
    }
    const handoff = LoginHandoff.reconstitute(snapshot),
      error = handoff.rotateTo(input.newSessionRef, now);
    if (error !== undefined) {
      return { rejected: 'not_bound' };
    }
    // Persist TRONG tx của caller — store CAS state `bound` → `session_rotated`.
    const rotated = await this.#unitOfWork.run((tx) =>
      this.#handoffs.rotateToWithinTx({
        handleHash: input.handleHash,
        newSessionRef: input.newSessionRef,
        now,
        tx,
      }),
    );
    return rotated ? { rotated: true } : { rejected: 'not_bound' };
  }
}

export type RotateLoginHandoffBindingUseCaseTypeCheck =
  RotateLoginHandoffBindingUseCase extends RotateLoginHandoffBinding ? true : false;

/** Input của ConsumeLoginHandoff — so khớp trước push (§3.6). */
export interface ConsumeLoginHandoffInput {
  readonly handleHash: HandleHash;
  readonly sessionRef: SessionRef;
}

/**
 * Kết quả consume theo đúng thứ tự kiểm tra của reference `checkHandoffBinding`:
 * mismatch TRƯỚC unusable (sai phiên là tín hiệu quan trọng hơn trạng thái chết).
 */
export type ConsumeLoginHandoffResult =
  | { readonly consumed: true }
  | { readonly rejected: 'binding_mismatch' | 'terminal' | 'expired' };

export type ConsumeLoginHandoff = Command<ConsumeLoginHandoffInput, ConsumeLoginHandoffResult>;

/**
 * Consume handoff tại handoff route: đúng phiên, còn TTL, chưa dùng. Aggregate
 * `consume` giữ thứ tự mismatch → terminal → expired; CAS thật ở store.
 */
export class ConsumeLoginHandoffUseCase implements ConsumeLoginHandoff {
  readonly #handoffs: LoginHandoffStore;
  readonly #clock: Clock;

  public constructor(deps: { handoffs: LoginHandoffStore; clock: Clock }) {
    this.#handoffs = deps.handoffs;
    this.#clock = deps.clock;
  }

  public async execute(input: ConsumeLoginHandoffInput): Promise<ConsumeLoginHandoffResult> {
    const now = this.#clock.now(),
      snapshot = await this.#handoffs.findById(input.handleHash);
    if (snapshot === undefined) {
      // Handle lạ — không oracle thêm: cùng họ mismatch.
      return { rejected: 'binding_mismatch' };
    }
    const handoff = LoginHandoff.reconstitute(snapshot),
      outcome = handoff.consume(input.sessionRef, now);
    if ('rejected' in outcome) {
      return { rejected: outcome.rejected };
    }
    const consumed = await this.#handoffs.consume(input.handleHash, now);
    return consumed ? { consumed: true } : { rejected: 'terminal' };
  }
}

export type ConsumeLoginHandoffUseCaseTypeCheck =
  ConsumeLoginHandoffUseCase extends ConsumeLoginHandoff ? true : false;
