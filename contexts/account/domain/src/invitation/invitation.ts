/**
 * Aggregate `Invitation` — ủy quyền tạo đúng một Account cho một địa chỉ email.
 *
 * State machine forward-only (khớp trigger `invitations_lifecycle_guard` của
 * reference, migration 0012):
 *   open → accepted | revoked | expired (terminal hết).
 *
 * `addressKey` + `issuedAt` bất biến sau khi tạo — không method nào đổi.
 *
 * Accept KHÔNG tạo Account và KHÔNG nhận proof/subject — đó là orchestration
 * của application layer: kiểm tra cross-aggregate (địa chỉ chưa claim — partial
 * unique + `users_invitation_birth_guard` ở DB enforce thật), tạo Subject, gọi
 * `Account.provisionFromInvitation` trong cùng transaction. Aggregate chỉ quản
 * lifecycle của mình.
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';
import type { Brand } from '@ecoma-io/domain-primitives';

import type { EmailAddressKey } from '../email-address/email-address-key';
import { isEmailAddressKey } from '../email-address/email-address-key';
import { domainError } from '../shared/errors';
import type { DomainError } from '../shared/errors';
import { isSubject } from '../account/subject';
import type { Subject } from '../account/subject';

/** TTL mặc định của invitation (giây) — 7 ngày, khớp reference. */
export const INVITATION_TTL_SECONDS = 7 * 24 * 3600;

export type InvitationId = Brand<string, 'InvitationId'>;

export const INVITATION_STATE = {
  Accepted: 'accepted',
  Expired: 'expired',
  Open: 'open',
  Revoked: 'revoked',
} as const;
export type InvitationState = (typeof INVITATION_STATE)[keyof typeof INVITATION_STATE];

export const INVITATION_TRANSITIONS: Record<InvitationState, readonly InvitationState[]> = {
  accepted: [],
  expired: [],
  open: [INVITATION_STATE.Accepted, INVITATION_STATE.Revoked, INVITATION_STATE.Expired],
  revoked: [],
};

/** Lý do từ chối accept — mọi nhánh đều fail-closed. */
export type InvitationRejectionReason = 'not_open' | 'expired';

export interface InvitationSnapshot {
  readonly id: InvitationId;
  readonly addressKey: EmailAddressKey;
  readonly state: InvitationState;
  readonly issuedAt: number;
  readonly expiresAt: number;
  /** Cặp chấp nhận — chỉ state `accepted` có cả hai (khớp CHECK 0012). */
  readonly acceptedAt: number | null;
  readonly acceptedSubject: Subject | null;
}

const INVITATION_STATES: ReadonlySet<string> = new Set(Object.values(INVITATION_STATE));

export class Invitation extends AggregateRoot<InvitationId> {
  readonly #addressKey: EmailAddressKey;
  #state: InvitationState;
  readonly #issuedAt: number;
  readonly #expiresAt: number;
  #acceptedAt: number | null;
  #acceptedSubject: Subject | null;

  private constructor(
    id: InvitationId,
    addressKey: EmailAddressKey,
    state: InvitationState,
    issuedAt: number,
    expiresAt: number,
    acceptedAt: number | null,
    acceptedSubject: Subject | null,
  ) {
    super(id);
    this.#addressKey = addressKey;
    this.#state = state;
    this.#issuedAt = issuedAt;
    this.#expiresAt = expiresAt;
    this.#acceptedAt = acceptedAt;
    this.#acceptedSubject = acceptedSubject;
  }

  public static issue(args: {
    id: InvitationId;
    addressKey: EmailAddressKey;
    now: number;
    ttlSeconds?: number;
  }): Invitation {
    if (typeof args.id !== 'string' || args.id.length === 0) {
      throw new TypeError('Invitation issue: id không hợp lệ.');
    }
    if (!isEmailAddressKey(args.addressKey)) {
      throw new TypeError('Invitation issue: addressKey không hợp lệ.');
    }
    if (!Number.isFinite(args.now)) {
      throw new TypeError('Invitation issue: now phải là số hữu hạn.');
    }
    if (
      args.ttlSeconds !== undefined &&
      (!Number.isFinite(args.ttlSeconds) || args.ttlSeconds <= 0)
    ) {
      throw new TypeError('Invitation issue: ttlSeconds phải là số hữu hạn dương.');
    }
    // TtlSeconds khổng lồ (1e308) làm now + ttl*1000 tràn thành Infinity —
    // ExpiresAt vô hạn không bao giờ hết hạn và snapshot bị reconstitute từ chối.
    if (!Number.isFinite(args.now + (args.ttlSeconds ?? INVITATION_TTL_SECONDS) * 1000)) {
      throw new TypeError('Invitation issue: expiresAt tràn giá trị.');
    }
    return new Invitation(
      args.id,
      args.addressKey,
      INVITATION_STATE.Open,
      args.now,
      args.now + (args.ttlSeconds ?? INVITATION_TTL_SECONDS) * 1000,
      null,
      null,
    );
  }

  public static reconstitute(snapshot: InvitationSnapshot): Invitation {
    // Không âm thầm sửa: acceptedAt/acceptedSubject phải đúng kiểu snapshot
    // (number | null / Subject | null) — undefined là dữ liệu hỏng.
    if (
      !INVITATION_STATES.has(snapshot.state) ||
      !isEmailAddressKey(snapshot.addressKey) ||
      typeof snapshot.id !== 'string' ||
      snapshot.id.length === 0 ||
      !Number.isFinite(snapshot.issuedAt) ||
      !Number.isFinite(snapshot.expiresAt) ||
      snapshot.issuedAt >= snapshot.expiresAt ||
      (snapshot.acceptedAt !== null && !Number.isFinite(snapshot.acceptedAt)) ||
      (snapshot.acceptedSubject !== null && !isSubject(snapshot.acceptedSubject))
    ) {
      throw new TypeError('Invitation snapshot không hợp lệ.');
    }
    // Cặp chấp nhận — khớp CHECK `invitations_accepted_pair_check` (0012):
    // State `accepted` ⟺ có cả acceptedAt + acceptedSubject.
    const accepted = snapshot.state === INVITATION_STATE.Accepted,
      hasPair = snapshot.acceptedAt !== null && snapshot.acceptedSubject !== null;
    if (accepted !== hasPair) {
      throw new TypeError(
        'Invitation snapshot không hợp lệ: cặp acceptedAt/acceptedSubject không khớp state.',
      );
    }
    if (
      snapshot.acceptedAt !== null &&
      (snapshot.acceptedAt < snapshot.issuedAt || snapshot.acceptedAt >= snapshot.expiresAt)
    ) {
      // Accept() đảm bảo issuedAt <= acceptedAt < expiresAt — snapshot vi phạm
      // Ordering đó là dữ liệu hỏng (không âm thầm sửa).
      throw new TypeError('Invitation snapshot không hợp lệ: acceptedAt ngoài khoảng hiệu lực.');
    }
    return new Invitation(
      snapshot.id,
      snapshot.addressKey,
      snapshot.state,
      snapshot.issuedAt,
      snapshot.expiresAt,
      snapshot.acceptedAt,
      snapshot.acceptedSubject,
    );
  }

  public addressKey(): EmailAddressKey {
    return this.#addressKey;
  }

  public state(): InvitationState {
    return this.#state;
  }

  public issuedAt(): number {
    return this.#issuedAt;
  }

  public expiresAt(): number {
    return this.#expiresAt;
  }

  public acceptedAt(): number | null {
    return this.#acceptedAt;
  }

  public acceptedSubject(): Subject | null {
    return this.#acceptedSubject;
  }

  public isExpired(now: number): boolean {
    return now >= this.#expiresAt;
  }

  /**
   * Kiểm tra trước khi accept. Không đổi state — caller dùng kết quả để
   * quyết định, rồi gọi {@link accept} (hoặc infrastructure thực thi CAS).
   * Kiểm tra cross-aggregate (địa chỉ chưa claim) là việc của orchestrating
   * service, nằm ngoài aggregate này.
   */
  public isAcceptable(now: number): boolean {
    return Number.isFinite(now) && this.#state === INVITATION_STATE.Open && !this.isExpired(now);
  }

  /**
   * Chấp nhận invitation: `open → accepted`, ghi nhận cặp chấp nhận
   * (`acceptedAt` + `acceptedSubject` — khớp CHECK `invitations_accepted_pair_check`).
   * Subject do orchestration của application layer tạo ngay trước khi gọi —
   * aggregate KHÔNG tạo Account và KHÔNG kiểm tra cross-aggregate (xem JSDoc
   * của class).
   *
   * Mọi lý do từ chối là negotiated outcome (discriminated result), không phải
   * exception — anti-enumeration của reference yêu cầu phân nhánh im lặng.
   */
  public accept(
    now: number,
    subject: Subject,
  ): { accepted: true } | { rejected: InvitationRejectionReason } {
    // Validate input TRƯỚC khi đọc state/mutate — invalid input không đổi state.
    if (!Number.isFinite(now) || !isSubject(subject)) {
      return { rejected: 'not_open' };
    }
    if (this.#state !== INVITATION_STATE.Open) {
      return { rejected: 'not_open' };
    }
    if (now < this.#issuedAt) {
      // Accept trước thời điểm phát sẽ tạo acceptedAt < issuedAt — snapshot mà
      // Reconstitute() của chính aggregate này từ chối; chặn tại behavior.
      return { rejected: 'not_open' };
    }
    if (this.isExpired(now)) {
      return { rejected: 'expired' };
    }
    this.#state = INVITATION_STATE.Accepted;
    this.#acceptedAt = now;
    this.#acceptedSubject = subject;
    return { accepted: true };
  }

  public revoke(): undefined | DomainError {
    if (this.#state !== INVITATION_STATE.Open) {
      return domainError('invalid_transition');
    }
    this.#state = INVITATION_STATE.Revoked;
    return undefined;
  }

  /**
   * Đánh dấu hết hạn (lazy TTL). Trả `true` nếu vừa transition.
   */
  public expireIfExpired(now: number): boolean {
    if (!Number.isFinite(now) || this.#state !== INVITATION_STATE.Open || now < this.#expiresAt) {
      return false;
    }
    this.#state = INVITATION_STATE.Expired;
    return true;
  }

  public snapshot(): InvitationSnapshot {
    return {
      acceptedAt: this.#acceptedAt,
      acceptedSubject: this.#acceptedSubject,
      addressKey: this.#addressKey,
      expiresAt: this.#expiresAt,
      id: this.id,
      issuedAt: this.#issuedAt,
      state: this.#state,
    };
  }
}
