/**
 * Aggregate `Account` — danh tính người dùng cuối, root của tập email.
 *
 * Identity là `Subject` (branded, không bao giờ tái sử dụng — tombstone).
 * Lifecycle: `active ⇄ suspended`, `→ deleted` (tombstone terminal, khớp
 * trigger `users_tombstone_immutable` của reference).
 *
 * Tập email là nested entities (`EmailAddressInternal`, class nội bộ — không
 * export public factory). Invariant trong aggregate: không revoke email verified
 * cuối cùng; verified chỉ từ pending; tối đa một key như nhau trong tập.
 *
 * Invariants DB-owned (aggregate KHÔNG tự enforce, xem proposal §3):
 * - Một owner verified duy nhất trên toàn hệ thống (partial unique).
 * - Địa chỉ đã revoked có thể được account khác reclaim.
 *
 * Account không có factory tổng quát: birth guard của DB chỉ cho phép sinh
 * user trong transaction acceptance — factory duy nhất là
 * {@link Account.provisionFromInvitation}, và call đó phải chạy trong
 * transaction acceptance (khớp thứ tự consume-challenge → accept-invitation →
 * INSERT users mà trigger `users_invitation_birth_guard` phụ thuộc). Guarantee
 * này là của application/database boundary — aggregate không nhận tham số
 * "attestation" mà nó không thể kiểm tra. Bootstrap là flow của migrator,
 * không qua aggregate.
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';

import type { EmailAddressKey } from '../email-address/email-address-key';
import { isEmailAddressKey } from '../email-address/email-address-key';
import { domainError } from '../shared/errors';
import type { DomainError } from '../shared/errors';
import { ACCOUNT_STATUS, isAccountStatus, isTerminalStatus } from '../account/account-status';
import type { AccountStatus } from '../account/account-status';
import { isSubject } from '../account/subject';
import type { Subject } from '../account/subject';

export interface EmailAddressView {
  readonly key: EmailAddressKey;
  readonly state: 'pending' | 'verified' | 'revoked';
  readonly addedAt: number;
  readonly verifiedAt: number | null;
  readonly revokedAt: number | null;
}

export interface AccountSnapshot {
  readonly subject: Subject;
  readonly status: AccountStatus;
  readonly createdAt: number;
  readonly emails: readonly EmailAddressView[];
}

export class Account extends AggregateRoot<Subject> {
  #status: AccountStatus;
  readonly #createdAt: number;
  readonly #emails: Map<EmailAddressKey, EmailAddressInternal>;

  private constructor(
    subject: Subject,
    status: AccountStatus,
    createdAt: number,
    emails: EmailAddressInternal[],
  ) {
    super(subject);
    this.#status = status;
    this.#createdAt = createdAt;
    this.#emails = new Map(emails.map((e) => [e.key, e]));
  }

  /**
   * Sinh Account từ invitation acceptance. `subject` do caller tạo
   * (`createSubject`) — entropy luôn là tham số. Email đầu tiên là verified
   * ngay (khớp reference: INSERT email_addresses verified trong transaction
   * accept). Không nhận `invitationId`: aggregate không thể kiểm tra một
   * attestation — guarantee "call chạy trong transaction acceptance" là hợp
   * đồng của application/database boundary (trigger `users_invitation_birth_guard`),
   * tham số chỉ là giả attestation.
   */
  public static provisionFromInvitation(args: {
    subject: Subject;
    emailKey: EmailAddressKey;
    now: number;
  }): Account {
    if (!isSubject(args.subject) || !isEmailAddressKey(args.emailKey)) {
      throw new TypeError('Account.provisionFromInvitation: subject/emailKey không hợp lệ.');
    }
    if (!Number.isFinite(args.now)) {
      throw new TypeError('Account.provisionFromInvitation: now phải là số hữu hạn.');
    }
    const email = EmailAddressInternal.verified(args.emailKey, args.now);
    return new Account(args.subject, ACCOUNT_STATUS.Active, args.now, [email]);
  }

  public static reconstitute(snapshot: AccountSnapshot): Account {
    if (
      !isSubject(snapshot.subject) ||
      !isAccountStatus(snapshot.status) ||
      !Number.isFinite(snapshot.createdAt)
    ) {
      throw new TypeError('Account snapshot không hợp lệ.');
    }
    // Không âm thầm dedup: snapshot có hai email cùng key là dữ liệu hỏng.
    const keys = new Set(snapshot.emails.map((view) => view.key));
    if (keys.size !== snapshot.emails.length) {
      throw new TypeError('Account snapshot không hợp lệ: email trùng key.');
    }
    const emails = snapshot.emails.map((view) => EmailAddressInternal.fromView(view));
    return new Account(snapshot.subject, snapshot.status, snapshot.createdAt, emails);
  }

  public status(): AccountStatus {
    return this.#status;
  }

  public createdAt(): number {
    return this.#createdAt;
  }

  /**
   * Snapshot tập email — chỉ đọc (readonly view), không lộ instance nội bộ.
   */
  public emails(): readonly EmailAddressView[] {
    return Array.from(this.#emails.values(), (e) => e.view());
  }

  public suspend(): undefined | DomainError {
    if (isTerminalStatus(this.#status)) {
      return domainError('account_deleted');
    }
    if (this.#status === ACCOUNT_STATUS.Suspended) {
      return domainError('invalid_transition');
    }
    this.#status = ACCOUNT_STATUS.Suspended;
    return undefined;
  }

  public reactivate(): undefined | DomainError {
    if (isTerminalStatus(this.#status)) {
      return domainError('account_deleted');
    }
    if (this.#status === ACCOUNT_STATUS.Active) {
      return domainError('invalid_transition');
    }
    this.#status = ACCOUNT_STATUS.Active;
    return undefined;
  }

  /**
   * Đánh dấu tombstone. Không idempotent: gọi trên tombstone là vi phạm
   * protocol nội bộ (caller dùng API đúng thì không xảy ra).
   */
  public delete(): undefined | DomainError {
    if (isTerminalStatus(this.#status)) {
      return domainError('account_deleted');
    }
    // Tombstone timestamp do infrastructure ghi (deleted_at); domain chỉ quyết định trạng thái.
    this.#status = ACCOUNT_STATUS.Deleted;
    return undefined;
  }

  public registerEmail(key: EmailAddressKey, now: number): undefined | DomainError {
    if (isTerminalStatus(this.#status)) {
      return domainError('account_deleted');
    }
    if (!isEmailAddressKey(key) || !Number.isFinite(now)) {
      // Key rác mutate vào state sẽ tạo snapshot mà reconstitute() từ chối.
      return domainError('invalid_transition');
    }
    if (this.#emails.has(key)) {
      return domainError('email_already_registered');
    }
    this.#emails.set(key, EmailAddressInternal.pending(key, now));
    return undefined;
  }

  /**
   * `pending → verified`. Domain error nếu email không ở trạng thái pending.
   */
  public markEmailVerified(key: EmailAddressKey, now: number): undefined | DomainError {
    if (isTerminalStatus(this.#status)) {
      return domainError('account_deleted');
    }
    if (!Number.isFinite(now)) {
      return domainError('invalid_transition');
    }
    const email = this.#emails.get(key);
    if (email === undefined) {
      return domainError('email_not_found');
    }
    if (email.state !== 'pending') {
      return domainError('email_not_pending');
    }
    if (now < email.addedAt) {
      // Ordering invariant — không chỉ ở reconstitution mà cả behavior side.
      return domainError('invalid_transition');
    }
    email.markVerified(now);
    return undefined;
  }

  /**
   * Revoke email. Idempotent nếu đã revoked. Guard: không revoke email
   * verified cuối cùng (`last_verified_email`) — invariant của Account.
   */
  public revokeEmail(key: EmailAddressKey, now: number): undefined | DomainError {
    if (isTerminalStatus(this.#status)) {
      return domainError('account_deleted');
    }
    if (!Number.isFinite(now)) {
      return domainError('invalid_transition');
    }
    const email = this.#emails.get(key);
    if (email === undefined) {
      return domainError('email_not_found');
    }
    if (email.state === 'revoked') {
      // Idempotent — thu hồi email đã thu hồi không đổi gì.
      return undefined;
    }
    const isLastVerified =
      email.state === 'verified' &&
      [...this.#emails.values()].filter((e) => e.state === 'verified').length === 1;
    if (isLastVerified) {
      return domainError('last_verified_email');
    }
    if (now < email.addedAt) {
      return domainError('invalid_transition');
    }
    if (email.state === 'verified' && email.verifiedAt !== null && now < email.verifiedAt) {
      // RevokedAt phải không trước verifiedAt — nếu không snapshot của aggregate
      // Này sẽ bị reconstitute từ chối (mất vòng đời persist→load).
      return domainError('invalid_transition');
    }
    email.revoke(now);
    return undefined;
  }

  public hasVerifiedEmail(): boolean {
    return [...this.#emails.values()].some((e) => e.state === 'verified');
  }

  public snapshot(): AccountSnapshot {
    return {
      createdAt: this.#createdAt,
      emails: this.emails(),
      status: this.#status,
      subject: this.id,
    };
  }
}

/**
 * Nested entity nội bộ của Account — không export, không public factory.
 * States: pending → verified → revoked; pending → revoked.
 */
class EmailAddressInternal {
  public readonly key: EmailAddressKey;
  public state: 'pending' | 'verified' | 'revoked';
  public readonly addedAt: number;
  public verifiedAt: number | null;
  public revokedAt: number | null;

  private constructor(
    key: EmailAddressKey,
    state: 'pending' | 'verified' | 'revoked',
    addedAt: number,
    verifiedAt: number | null,
    revokedAt: number | null,
  ) {
    this.key = key;
    this.state = state;
    this.addedAt = addedAt;
    this.verifiedAt = verifiedAt;
    this.revokedAt = revokedAt;
  }

  public static pending(key: EmailAddressKey, now: number): EmailAddressInternal {
    return new EmailAddressInternal(key, 'pending', now, null, null);
  }

  public static verified(key: EmailAddressKey, now: number): EmailAddressInternal {
    return new EmailAddressInternal(key, 'verified', now, now, null);
  }

  public static fromView(view: EmailAddressView): EmailAddressInternal {
    // Persistence pair-check (khớp CHECK constraint của reference): verified
    // Bắt buộc có verified_at, pending/revoked bắt buộc không có verifiedAt,
    // Pending bắt buộc không có revokedAt.
    if (
      !isEmailAddressKey(view.key) ||
      !Number.isFinite(view.addedAt) ||
      (view.verifiedAt !== null && !Number.isFinite(view.verifiedAt)) ||
      (view.revokedAt !== null && !Number.isFinite(view.revokedAt))
    ) {
      throw new TypeError('EmailAddress snapshot không hợp lệ.');
    }
    if (view.state === 'verified' && view.verifiedAt === null) {
      throw new TypeError('EmailAddress snapshot không hợp lệ: verified thiếu verifiedAt.');
    }
    if (view.state === 'pending' && (view.verifiedAt !== null || view.revokedAt !== null)) {
      throw new TypeError(
        'EmailAddress snapshot không hợp lệ: pending có timestamp chuyển trạng thái.',
      );
    }
    if (view.state === 'revoked' && view.revokedAt === null) {
      throw new TypeError('EmailAddress snapshot không hợp lệ: revoked thiếu revokedAt.');
    }
    // Ordering: revokedAt không bao giờ trước addedAt (cả đường pending→revoked,
    // Khi verifiedAt null thì check revokedAt ≥ verifiedAt bị skip).
    if (view.revokedAt !== null && view.revokedAt < view.addedAt) {
      throw new TypeError('EmailAddress snapshot không hợp lệ: revokedAt trước addedAt.');
    }
    if (view.verifiedAt !== null && view.verifiedAt < view.addedAt) {
      throw new TypeError('EmailAddress snapshot không hợp lệ: verifiedAt trước addedAt.');
    }
    if (view.revokedAt !== null && view.verifiedAt !== null && view.revokedAt < view.verifiedAt) {
      throw new TypeError('EmailAddress snapshot không hợp lệ: revokedAt trước verifiedAt.');
    }
    return new EmailAddressInternal(
      view.key,
      view.state,
      view.addedAt,
      view.verifiedAt,
      view.revokedAt,
    );
  }

  public markVerified(now: number): void {
    this.state = 'verified';
    this.verifiedAt = now;
  }

  public revoke(now: number): void {
    this.state = 'revoked';
    this.revokedAt = now;
  }

  public view(): EmailAddressView {
    return {
      addedAt: this.addedAt,
      key: this.key,
      revokedAt: this.revokedAt,
      state: this.state,
      verifiedAt: this.verifiedAt,
    };
  }
}
