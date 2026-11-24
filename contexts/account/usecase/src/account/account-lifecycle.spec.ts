import { Account } from '@ecoma-io/account-domain';
import type { EmailAddressKey, Subject } from '@ecoma-io/account-domain';

import type { Command, Query } from '@ecoma-io/usecase-primitives';

import { InMemoryAccountStore } from '../testing/in-memory-account-store';
import {
  DeleteAccountUseCase,
  GetAccountUseCase,
  ReactivateAccountUseCase,
  SuspendAccountUseCase,
} from './account-lifecycle';
import type {
  DeleteAccount,
  GetAccount,
  ReactivateAccount,
  SuspendAccount,
} from './account-lifecycle';

const EMAIL = 'a'.repeat(64) as EmailAddressKey;

function subject(n: number): Subject {
  // Base32 viết thường (a–z, 2–7): mã hoá n thành số nhị phân rồi map sang
  // Bảng chữ cái 32 ký tự — không digit lạ rơi vào pattern của Subject.
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let entropy = '';
  for (let i = 0; i < 32; i += 1) {
    entropy = alphabet[(n + i * 7) % 32] + entropy;
  }
  return `sub_${entropy}` as Subject;
}

function provision(s: Subject): Account {
  return Account.provisionFromInvitation({ emailKey: EMAIL, now: 1000, subject: s });
}

describe('account lifecycle contracts', () => {
  it('suspendAccount implements Command', () => {
    type I = Parameters<SuspendAccountUseCase['execute']>[0];
    type O = Awaited<ReturnType<SuspendAccountUseCase['execute']>>;
    expectTypeOf<SuspendAccount>().toExtend<Command<I, O>>();
  });

  it('reactivateAccount implements Command', () => {
    type I = Parameters<ReactivateAccountUseCase['execute']>[0];
    type O = Awaited<ReturnType<ReactivateAccountUseCase['execute']>>;
    expectTypeOf<ReactivateAccount>().toExtend<Command<I, O>>();
  });

  it('deleteAccount implements Command', () => {
    type I = Parameters<DeleteAccountUseCase['execute']>[0];
    type O = Awaited<ReturnType<DeleteAccountUseCase['execute']>>;
    expectTypeOf<DeleteAccount>().toExtend<Command<I, O>>();
  });

  it('getAccount implements Query', () => {
    type I = Parameters<GetAccountUseCase['execute']>[0];
    type O = Awaited<ReturnType<GetAccountUseCase['execute']>>;
    expectTypeOf<GetAccount>().toExtend<Query<I, O>>();
  });
});

describe('SuspendAccountUseCase', () => {
  it('suspends an active account', async () => {
    expect.hasAssertions();
    const accounts = new InMemoryAccountStore(),
      s = subject(1);
    accounts.seed(provision(s));
    const useCase = new SuspendAccountUseCase({ accounts });

    await expect(useCase.execute({ subject: s })).resolves.toStrictEqual({ suspended: true });
    expect((await accounts.findById(s))?.status).toBe('suspended');
  });

  it('returns not_found for unknown subject', async () => {
    expect.hasAssertions();
    const accounts = new InMemoryAccountStore(),
      useCase = new SuspendAccountUseCase({ accounts });
    await expect(useCase.execute({ subject: subject(9) })).resolves.toStrictEqual({
      rejected: 'not_found',
    });
  });

  it('returns invalid_transition when already suspended', async () => {
    expect.hasAssertions();
    const accounts = new InMemoryAccountStore(),
      s = subject(2);
    accounts.seed(provision(s));
    const useCase = new SuspendAccountUseCase({ accounts });
    await useCase.execute({ subject: s });

    await expect(useCase.execute({ subject: s })).resolves.toStrictEqual({
      rejected: 'invalid_transition',
    });
  });
});

describe('ReactivateAccountUseCase', () => {
  it('reactivates a suspended account', async () => {
    expect.hasAssertions();
    const accounts = new InMemoryAccountStore(),
      s = subject(3);
    accounts.seed(provision(s));
    const suspend = new SuspendAccountUseCase({ accounts }),
      reactivate = new ReactivateAccountUseCase({ accounts });
    await suspend.execute({ subject: s });

    await expect(reactivate.execute({ subject: s })).resolves.toStrictEqual({ reactivated: true });
    expect((await accounts.findById(s))?.status).toBe('active');
  });

  it('returns invalid_transition for an active account', async () => {
    expect.hasAssertions();
    const accounts = new InMemoryAccountStore(),
      s = subject(4);
    accounts.seed(provision(s));
    const reactivate = new ReactivateAccountUseCase({ accounts });
    await expect(reactivate.execute({ subject: s })).resolves.toStrictEqual({
      rejected: 'invalid_transition',
    });
  });

  it('refuses a deleted account — terminal', async () => {
    expect.hasAssertions();
    const accounts = new InMemoryAccountStore(),
      s = subject(5);
    accounts.seed(provision(s));
    await new DeleteAccountUseCase({ accounts }).execute({ subject: s });
    const reactivate = new ReactivateAccountUseCase({ accounts });

    await expect(reactivate.execute({ subject: s })).resolves.toStrictEqual({
      rejected: 'invalid_transition',
    });
  });
});

describe('DeleteAccountUseCase', () => {
  it('deletes an active account — tombstone', async () => {
    expect.hasAssertions();
    const accounts = new InMemoryAccountStore(),
      s = subject(6);
    accounts.seed(provision(s));
    const useCase = new DeleteAccountUseCase({ accounts });

    await expect(useCase.execute({ subject: s })).resolves.toStrictEqual({ deleted: true });
    expect((await accounts.findById(s))?.status).toBe('deleted');
  });

  it('is idempotent-aware: reports already_deleted on second call', async () => {
    expect.hasAssertions();
    const accounts = new InMemoryAccountStore(),
      s = subject(7);
    accounts.seed(provision(s));
    const useCase = new DeleteAccountUseCase({ accounts });
    await useCase.execute({ subject: s });

    await expect(useCase.execute({ subject: s })).resolves.toStrictEqual({
      rejected: 'already_deleted',
    });
  });

  it('returns not_found for unknown subject', async () => {
    expect.hasAssertions();
    const accounts = new InMemoryAccountStore(),
      useCase = new DeleteAccountUseCase({ accounts });
    await expect(useCase.execute({ subject: subject(8) })).resolves.toStrictEqual({
      rejected: 'not_found',
    });
  });
});

describe('GetAccountUseCase', () => {
  it('returns a public view without revoked timestamps', async () => {
    expect.hasAssertions();
    const accounts = new InMemoryAccountStore(),
      s = subject(10),
      account = provision(s);
    account.registerEmail('b'.repeat(64) as EmailAddressKey, 2000);
    account.revokeEmail('b'.repeat(64) as EmailAddressKey, 3000);
    accounts.seed(account);
    const useCase = new GetAccountUseCase({ accounts }),
      view = await useCase.execute({ subject: s });
    expect(view?.status).toBe('active');
    expect(view?.emails).toHaveLength(2);
    expect(view?.emails[1]).toStrictEqual({
      addedAt: 2000,
      key: 'b'.repeat(64),
      state: 'revoked',
    });
    expect(JSON.stringify(view)).not.toContain('revokedAt');
    expect(JSON.stringify(view)).not.toContain('verifiedAt');
  });

  it('returns undefined for unknown subject', async () => {
    expect.hasAssertions();
    const accounts = new InMemoryAccountStore(),
      useCase = new GetAccountUseCase({ accounts });
    await expect(useCase.execute({ subject: subject(11) })).resolves.toBeUndefined();
  });
});
