import { INVITATION_STATE } from '@ecoma-io/account-domain';
import type { EmailAddressKey } from '@ecoma-io/account-domain';
export { type Invitation } from '@ecoma-io/account-domain';
import type { Command, Query } from '@ecoma-io/usecase-primitives';

import { InMemoryInvitationStore } from '../testing/in-memory-invitation-store';
import { FixedClock } from '../testing/fixed-clock';
import { SequentialIdGenerator } from '../testing/id-generators';
import { GetInvitationUseCase, ListOpenInvitationsByAddressUseCase } from './invitation-queries';
import { IssueInvitationUseCase } from './issue-invitation';
import { RevokeInvitationUseCase } from './revoke-invitation';
import type { GetInvitation, ListOpenInvitationsByAddress } from './invitation-queries';
import type { IssueInvitation } from './issue-invitation';
import type { RevokeInvitation } from './revoke-invitation';

const ADDRESS = 'a'.repeat(64) as EmailAddressKey;

function makeDeps() {
  const clock = new FixedClock(1_000_000),
    invitations = new InMemoryInvitationStore(),
    ids = new SequentialIdGenerator();
  return { clock, ids, invitations };
}

describe('invitation use case contracts', () => {
  it('issueInvitationUseCaseTypeCheck implements Command', () => {
    type I = Parameters<IssueInvitationUseCase['execute']>[0];
    type O = Awaited<ReturnType<IssueInvitationUseCase['execute']>>;
    expectTypeOf<IssueInvitation>().toExtend<Command<I, O>>();
  });

  it('revokeInvitationUseCaseTypeCheck implements Command', () => {
    type I = Parameters<RevokeInvitationUseCase['execute']>[0];
    type O = Awaited<ReturnType<RevokeInvitationUseCase['execute']>>;
    expectTypeOf<RevokeInvitation>().toExtend<Command<I, O>>();
  });

  it('getInvitationUseCaseTypeCheck implements Query', () => {
    type I = Parameters<GetInvitationUseCase['execute']>[0];
    type O = Awaited<ReturnType<GetInvitationUseCase['execute']>>;
    expectTypeOf<GetInvitation>().toExtend<Query<I, O>>();
  });

  it('listOpenInvitationsByAddressUseCaseTypeCheck implements Query', () => {
    type I = Parameters<ListOpenInvitationsByAddressUseCase['execute']>[0];
    type O = Awaited<ReturnType<ListOpenInvitationsByAddressUseCase['execute']>>;
    expectTypeOf<ListOpenInvitationsByAddress>().toExtend<Query<I, O>>();
  });
});

describe('IssueInvitationUseCase', () => {
  it('issues an open invitation with default TTL', async () => {
    const { clock, invitations, ids } = makeDeps(),
      useCase = new IssueInvitationUseCase({ clock, ids, invitations }),
      out = await useCase.execute({ addressKey: ADDRESS });

    expect(out.raceLost).toBe(false);
    expect(out.invitation.state).toBe(INVITATION_STATE.Open);
    expect(out.invitation.addressKey).toBe(ADDRESS);
    expect(out.invitation.expiresAt - out.invitation.issuedAt).toBe(7 * 24 * 3600 * 1000);
    await expect(invitations.findById(out.invitation.id)).resolves.toEqual(out.invitation);
  });

  it('honours custom ttlSeconds', async () => {
    const { clock, invitations, ids } = makeDeps(),
      useCase = new IssueInvitationUseCase({ clock, ids, invitations }),
      out = await useCase.execute({ addressKey: ADDRESS, ttlSeconds: 60 });
    expect(out.invitation.expiresAt - out.invitation.issuedAt).toBe(60_000);
  });

  it('reports raceLost when the store rejects the insert', async () => {
    const { clock, ids } = makeDeps(),
      invitations = new InMemoryInvitationStore({ rejectNextInsert: true }),
      useCase = new IssueInvitationUseCase({ clock, ids, invitations }),
      out = await useCase.execute({ addressKey: ADDRESS });
    expect(out.raceLost).toBeTruthy();
  });
});

describe('RevokeInvitationUseCase', () => {
  it('revokes an open invitation', async () => {
    const { clock, invitations, ids } = makeDeps(),
      issue = new IssueInvitationUseCase({ clock, ids, invitations }),
      revoke = new RevokeInvitationUseCase({ clock, invitations }),
      { invitation } = await issue.execute({ addressKey: ADDRESS }),
      result = await revoke.execute({ id: invitation.id });
    expect(result).toEqual({ revoked: true });
    expect((await invitations.findById(invitation.id))?.state).toBe(INVITATION_STATE.Revoked);
  });

  it('returns not_open for unknown id or already-terminal invitation', async () => {
    const { clock, invitations, ids } = makeDeps(),
      issue = new IssueInvitationUseCase({ clock, ids, invitations }),
      revoke = new RevokeInvitationUseCase({ clock, invitations }),
      { invitation } = await issue.execute({ addressKey: ADDRESS });
    await revoke.execute({ id: invitation.id });

    await expect(revoke.execute({ id: invitation.id })).resolves.toEqual({ rejected: 'not_open' });
    await expect(revoke.execute({ id: 'nope' as never })).resolves.toEqual({
      rejected: 'not_open',
    });
  });

  it('returns expired when the invitation passed its TTL', async () => {
    const { clock, invitations, ids } = makeDeps(),
      issue = new IssueInvitationUseCase({ clock, ids, invitations }),
      revoke = new RevokeInvitationUseCase({ clock, invitations }),
      { invitation } = await issue.execute({ addressKey: ADDRESS, ttlSeconds: 10 });

    clock.advance(11_000);
    await expect(revoke.execute({ id: invitation.id })).resolves.toEqual({ rejected: 'expired' });
    expect((await invitations.findById(invitation.id))?.state).toBe(INVITATION_STATE.Expired);
  });
});

describe('GetInvitationUseCase', () => {
  it('returns the snapshot or undefined', async () => {
    const { clock, invitations, ids } = makeDeps(),
      issue = new IssueInvitationUseCase({ clock, ids, invitations }),
      get = new GetInvitationUseCase({ invitations }),
      { invitation } = await issue.execute({ addressKey: ADDRESS });

    await expect(get.execute({ id: invitation.id })).resolves.toEqual(invitation);
    await expect(get.execute({ id: 'nope' as never })).resolves.toBeUndefined();
  });
});

describe('ListOpenInvitationsByAddressUseCase', () => {
  it('returns only open, unexpired invitations of the address', async () => {
    const { clock, invitations, ids } = makeDeps(),
      issue = new IssueInvitationUseCase({ clock, ids, invitations }),
      list = new ListOpenInvitationsByAddressUseCase({ invitations }),
      first = await issue.execute({ addressKey: ADDRESS }),
      second = await issue.execute({ addressKey: ADDRESS });
    await issue.execute({ addressKey: ADDRESS, ttlSeconds: 10 });

    clock.advance(20_000);
    const open = await list.execute({ addressKey: ADDRESS, now: clock.now() });
    expect(open.map((i) => i.id).toSorted()).toEqual(
      [first.invitation.id, second.invitation.id].toSorted(),
    );

    clock.advance(7 * 24 * 3600 * 1000);
    await expect(list.execute({ addressKey: ADDRESS, now: clock.now() })).resolves.toEqual([]);
  });

  it('is empty for an address without invitations', async () => {
    const { clock, invitations } = makeDeps(),
      list = new ListOpenInvitationsByAddressUseCase({ invitations });
    await expect(list.execute({ addressKey: ADDRESS, now: clock.now() })).resolves.toEqual([]);
  });
});

// Re-export để spec tự kiểm import công khai của use case issue (một nguồn).
