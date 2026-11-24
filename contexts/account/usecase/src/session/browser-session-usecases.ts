import type { Command, Query } from '@ecoma-io/usecase-primitives';

import { ACR, BrowserSession } from '@ecoma-io/account-domain';
import type { Acr, BrowserSessionSnapshot, SessionRef, Subject } from '@ecoma-io/account-domain';

import type { BrowserSessionStore } from '../ports/browser-session-store.js';
import type { Clock } from '../ports/clock.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

/**
 * Browser Session use cases (FR-004/004a/005): complete-auth (rotate tại thời
 * điểm xác thực), revoke một/tất cả, list phiên live.
 */

/** Input của RotateSessionAtAuthentication — hoàn tất xác thực trên phiên anonymous. */
export interface RotateSessionAtAuthenticationInput {
  /** SessionRef của phiên anonymous đang cầm binding (nếu có). */
  readonly presentSessionRef: SessionRef | undefined;
  readonly subject: Subject;
  /** SessionRef mới đã mint — truyền vào để transport cầm cookie cùng một giá trị. */
  readonly newSessionRef: SessionRef;
}

/**
 * Kết quả — `rotated`: phiên anonymous đã thu hồi, phiên authenticated mới đã
 * ghi trong CÙNG transaction (FR-004a + FR-006c4). `no_present_session`: không
 * có phiên anonymous để rotate (transport tạo phiên mới trực tiếp).
 */
export type RotateSessionAtAuthenticationResult =
  | {
      readonly rotated: true;
      readonly oldSnapshot: BrowserSessionSnapshot;
      readonly newSnapshot: BrowserSessionSnapshot;
    }
  | { readonly rejected: 'present_session_not_anonymous' | 'present_session_not_live' };

export type RotateSessionAtAuthentication = Command<
  RotateSessionAtAuthenticationInput,
  RotateSessionAtAuthenticationResult
>;

/**
 * Rotate phiên anonymous → authenticated tại thời điểm verify OTP thành công.
 * MỘT transaction (UnitOfWork): revoke phiên cũ + INSERT phiên mới — không có
 * khoảng chết giữa hai thao tác (§3.6.2). ACR initial luôn `email-otp`
 * (domain guard chặn ACR cao hơn).
 */
export class RotateSessionAtAuthenticationUseCase implements RotateSessionAtAuthentication {
  readonly #sessions: BrowserSessionStore;
  readonly #unitOfWork: UnitOfWork;
  readonly #clock: Clock;

  public constructor(deps: {
    sessions: BrowserSessionStore;
    unitOfWork: UnitOfWork;
    clock: Clock;
  }) {
    this.#sessions = deps.sessions;
    this.#unitOfWork = deps.unitOfWork;
    this.#clock = deps.clock;
  }

  public async execute(
    input: RotateSessionAtAuthenticationInput,
  ): Promise<RotateSessionAtAuthenticationResult> {
    if (input.presentSessionRef === undefined) {
      return { rejected: 'present_session_not_live' };
    }
    const now = this.#clock.now(),
      oldSnapshot = await this.#sessions.findById(input.presentSessionRef);
    if (oldSnapshot === undefined) {
      return { rejected: 'present_session_not_live' };
    }
    const old = BrowserSession.reconstitute(oldSnapshot);
    if (old.kind() !== 'anonymous') {
      // Xác thực KHÔNG hợp nhất vào phiên authenticated của account khác —
      // Chỉ anonymous được rotate (quyết định có chủ đích của reference).
      return { rejected: 'present_session_not_anonymous' };
    }
    const newSession = BrowserSession.startAnonymous({
        now,
        sessionRef: input.newSessionRef,
      }),
      error = newSession.authenticate(ACR.EmailOtp satisfies Acr, now);
    if (error !== undefined) {
      // Không thể xảy ra với ACR email-otp + now < expiresAt của phiên mới —
      // Bảo vệ kiểu.
      return { rejected: 'present_session_not_live' };
    }
    const storedSnapshot: BrowserSessionSnapshot = {
        ...newSession.snapshot(),
        rotatedFrom: input.presentSessionRef,
      },
      committed = await this.#unitOfWork.run((tx) =>
        this.#sessions.rotateWithinTx({
          oldSessionRef: input.presentSessionRef as SessionRef,
          subject: input.subject,
          // RotatedFrom kế thừa phiên cũ (lineage rotation) — aggregate không tự
          // Đặt trên path startAnonymous→authenticate; snapshot lưu phải mang nó.
          newSnapshot: storedSnapshot,
          now,
          tx,
        }),
      );
    if (!committed) {
      // Thua CAS: phiên cũ vừa bị thu hồi/hết hạn bởi request khác.
      return { rejected: 'present_session_not_live' };
    }
    return {
      newSnapshot: storedSnapshot,
      oldSnapshot: old.snapshot(),
      rotated: true,
    };
  }
}

export type RotateSessionAtAuthenticationUseCaseTypeCheck =
  RotateSessionAtAuthenticationUseCase extends RotateSessionAtAuthentication ? true : false;

/** Input của ListLiveSessions. */
export interface ListLiveSessionsInput {
  readonly subject: Subject;
}

export type ListLiveSessions = Query<ListLiveSessionsInput, readonly BrowserSessionSnapshot[]>;

/** Danh sách phiên live của subject — sắp theo createdAt giảm dần (port contract). */
export class ListLiveSessionsUseCase implements ListLiveSessions {
  readonly #sessions: BrowserSessionStore;
  readonly #clock: Clock;

  public constructor(deps: { sessions: BrowserSessionStore; clock: Clock }) {
    this.#sessions = deps.sessions;
    this.#clock = deps.clock;
  }

  public execute(input: ListLiveSessionsInput): Promise<readonly BrowserSessionSnapshot[]> {
    return this.#sessions.listLiveBySubject(input.subject, this.#clock.now());
  }
}

export type ListLiveSessionsUseCaseTypeCheck = ListLiveSessionsUseCase extends ListLiveSessions
  ? true
  : false;

/** Input của RevokeSession — revoke MỘT phiên của chính mình. */
export interface RevokeSessionInput {
  readonly subject: Subject;
  readonly sessionRef: SessionRef;
}

export type RevokeSessionResult =
  | { readonly revoked: true }
  | { readonly rejected: 'not_found_or_not_owner' };

export type RevokeSession = Command<RevokeSessionInput, RevokeSessionResult>;

/**
 * Revoke một phiên. Ownership kiểm tra bằng cách tra phiên trong danh sách của
 * subject — session_ref của người khác không thể revoke (không oracle: cùng
 * một nhánh cho "không tồn tại" và "không phải của bạn").
 */
export class RevokeSessionUseCase implements RevokeSession {
  readonly #sessions: BrowserSessionStore;
  readonly #clock: Clock;

  public constructor(deps: { sessions: BrowserSessionStore; clock: Clock }) {
    this.#sessions = deps.sessions;
    this.#clock = deps.clock;
  }

  public async execute(input: RevokeSessionInput): Promise<RevokeSessionResult> {
    const live = await this.#sessions.listLiveBySubject(input.subject, this.#clock.now()),
      owns = live.some((s) => s.sessionRef === input.sessionRef);
    if (!owns) {
      return { rejected: 'not_found_or_not_owner' };
    }
    const revoked = await this.#sessions.revokeOne(input.sessionRef, this.#clock.now());
    return revoked ? { revoked: true } : { rejected: 'not_found_or_not_owner' };
  }
}

export type RevokeSessionUseCaseTypeCheck = RevokeSessionUseCase extends RevokeSession
  ? true
  : false;

/** Input của RevokeAllSessions. */
export interface RevokeAllSessionsInput {
  readonly subject: Subject;
}

/** Số phiên đã thu hồi — 0 là hợp lệ (không có phiên live). */
export interface RevokeAllSessionsOutput {
  readonly revokedCount: number;
}

export type RevokeAllSessions = Command<RevokeAllSessionsInput, RevokeAllSessionsOutput>;

/** Revoke tất cả phiên live của subject (logout-everywhere). */
export class RevokeAllSessionsUseCase implements RevokeAllSessions {
  readonly #sessions: BrowserSessionStore;
  readonly #clock: Clock;

  public constructor(deps: { sessions: BrowserSessionStore; clock: Clock }) {
    this.#sessions = deps.sessions;
    this.#clock = deps.clock;
  }

  public async execute(input: RevokeAllSessionsInput): Promise<RevokeAllSessionsOutput> {
    const revokedCount = await this.#sessions.revokeAllBySubject(input.subject, this.#clock.now());
    return { revokedCount };
  }
}

export type RevokeAllSessionsUseCaseTypeCheck = RevokeAllSessionsUseCase extends RevokeAllSessions
  ? true
  : false;
