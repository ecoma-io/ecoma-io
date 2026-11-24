import type { Command, Query } from '@ecoma-io/usecase-primitives';

import { Account } from '@ecoma-io/account-domain';
import type { AccountSnapshot, AccountStatus, Subject } from '@ecoma-io/account-domain';

import type { AccountStore } from '../ports/account-store.js';

/**
 * Lifecycle account (FR-012/12a/12c): suspend / reactivate / delete + query.
 * Mỗi workflow một class, orchestration thuần — guard là việc của aggregate,
 * CAS thật là việc của store.
 */

/** Input của SuspendAccount. */
export interface SuspendAccountInput {
  readonly subject: Subject;
}

/**
 * Kết quả suspend — mọi nhánh negotiated:
 * - `suspended`: transition thành công.
 * - `not_found`: subject không tồn tại (không phân biệt deleted — tombstone
 *   không tái xuất hiện dưới mọi hình thức).
 * - `invalid_transition`: đã suspended rồi (idempotency là KHÔNG mong muốn —
 *   caller phải biết hành động lặp) hoặc đã deleted.
 */
export type SuspendAccountResult =
  | { readonly suspended: true }
  | { readonly rejected: 'not_found' | 'invalid_transition' };

export type SuspendAccount = Command<SuspendAccountInput, SuspendAccountResult>;

/** Vô hiệu hoá account (FR-012). Domain guard: `active → suspended`. */
export class SuspendAccountUseCase implements SuspendAccount {
  readonly #accounts: AccountStore;

  public constructor(deps: { accounts: AccountStore }) {
    this.#accounts = deps.accounts;
  }

  public async execute(input: SuspendAccountInput): Promise<SuspendAccountResult> {
    const snapshot = await this.#accounts.findById(input.subject);
    if (snapshot === undefined) {
      return { rejected: 'not_found' };
    }
    const account = Account.reconstitute(snapshot),
      error = account.suspend();
    if (error !== undefined) {
      return { rejected: 'invalid_transition' };
    }
    await this.#accounts.save(account.snapshot());
    return { suspended: true };
  }
}

export type SuspendAccountUseCaseTypeCheck = SuspendAccountUseCase extends SuspendAccount
  ? true
  : false;

/** Input của ReactivateAccount. */
export interface ReactivateAccountInput {
  readonly subject: Subject;
}

export type ReactivateAccountResult =
  | { readonly reactivated: true }
  | { readonly rejected: 'not_found' | 'invalid_transition' };

export type ReactivateAccount = Command<ReactivateAccountInput, ReactivateAccountResult>;

/** Kích hoạt lại account đã suspended (FR-012a). `deleted` là terminal. */
export class ReactivateAccountUseCase implements ReactivateAccount {
  readonly #accounts: AccountStore;

  public constructor(deps: { accounts: AccountStore }) {
    this.#accounts = deps.accounts;
  }

  public async execute(input: ReactivateAccountInput): Promise<ReactivateAccountResult> {
    const snapshot = await this.#accounts.findById(input.subject);
    if (snapshot === undefined) {
      return { rejected: 'not_found' };
    }
    const account = Account.reconstitute(snapshot),
      error = account.reactivate();
    if (error !== undefined) {
      return { rejected: 'invalid_transition' };
    }
    await this.#accounts.save(account.snapshot());
    return { reactivated: true };
  }
}

export type ReactivateAccountUseCaseTypeCheck = ReactivateAccountUseCase extends ReactivateAccount
  ? true
  : false;

/** Input của DeleteAccount. */
export interface DeleteAccountInput {
  readonly subject: Subject;
}

export type DeleteAccountResult =
  | { readonly deleted: true }
  | { readonly rejected: 'not_found' | 'already_deleted' };

export type DeleteAccount = Command<DeleteAccountInput, DeleteAccountResult>;

/**
 * Xoá account — tombstone (FR-012c). `sub` không bao giờ tái sử dụng (invariant
 * 7); aggregate chỉ đánh dấu trạng thái, timestamp tombstone do infrastructure
 * ghi. Idempotency có chủ đích ở đây: tombstone đã là trạng thái cuối, caller
 * cần phân biệt `already_deleted` để không ghi audit nhầm lần xoá thứ hai.
 */
export class DeleteAccountUseCase implements DeleteAccount {
  readonly #accounts: AccountStore;

  public constructor(deps: { accounts: AccountStore }) {
    this.#accounts = deps.accounts;
  }

  public async execute(input: DeleteAccountInput): Promise<DeleteAccountResult> {
    const snapshot = await this.#accounts.findById(input.subject);
    if (snapshot === undefined) {
      return { rejected: 'not_found' };
    }
    if (snapshot.status === 'deleted') {
      return { rejected: 'already_deleted' };
    }
    const account = Account.reconstitute(snapshot),
      error = account.delete();
    if (error !== undefined) {
      // Guard chỉ trả account_deleted trên tombstone — đã kiểm phía trên;
      // Nhánh này là bảo vệ kiểu, không phải path thật.
      return { rejected: 'already_deleted' };
    }
    await this.#accounts.save(account.snapshot());
    return { deleted: true };
  }
}

export type DeleteAccountUseCaseTypeCheck = DeleteAccountUseCase extends DeleteAccount
  ? true
  : false;

/** Input của GetAccount. */
export interface GetAccountInput {
  readonly subject: Subject;
}

/** View công khai của account — không lộ verifiedAt/revokedAt nội bộ. */
export interface AccountView {
  readonly subject: Subject;
  readonly status: AccountStatus;
  readonly createdAt: number;
  readonly emails: readonly {
    readonly key: string;
    readonly state: 'pending' | 'verified' | 'revoked';
    readonly addedAt: number;
  }[];
}

export type GetAccount = Query<GetAccountInput, AccountView | undefined>;

/** Tra cứu account theo subject; `undefined` = không tồn tại. */
export class GetAccountUseCase implements GetAccount {
  readonly #accounts: AccountStore;

  public constructor(deps: { accounts: AccountStore }) {
    this.#accounts = deps.accounts;
  }

  public async execute(input: GetAccountInput): Promise<AccountView | undefined> {
    const snapshot: AccountSnapshot | undefined = await this.#accounts.findById(input.subject);
    if (snapshot === undefined) {
      return undefined;
    }
    return {
      createdAt: snapshot.createdAt,
      emails: snapshot.emails.map((e) => ({
        addedAt: e.addedAt,
        key: e.key,
        state: e.state,
      })),
      status: snapshot.status,
      subject: snapshot.subject,
    };
  }
}

export type GetAccountUseCaseTypeCheck = GetAccountUseCase extends GetAccount ? true : false;
