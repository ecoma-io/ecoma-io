import { BrowserSession } from '@ecoma-io/account-domain';
import type { SessionRef, Subject } from '@ecoma-io/account-domain';

import type { Command, Query } from '@ecoma-io/usecase-primitives';

import { FixedClock } from '../testing/fixed-clock';
import { InMemoryBrowserSessionStore } from '../testing/in-memory-browser-session-store';
import { InMemoryUnitOfWork } from '../testing/in-memory-unit-of-work';
import {
  ListLiveSessionsUseCase,
  RevokeAllSessionsUseCase,
  RevokeSessionUseCase,
  RotateSessionAtAuthenticationUseCase,
} from './browser-session-usecases';
import type {
  ListLiveSessions,
  RevokeAllSessions,
  RevokeSession,
  RotateSessionAtAuthentication,
} from './browser-session-usecases';

function ref(n: number): SessionRef {
  return `ref-${n}` as SessionRef;
}
function subject(n: number): Subject {
  return `sub-${n}` as Subject;
}

function anonymousSession(n: number, createdAt: number): BrowserSession {
  return BrowserSession.startAnonymous({ now: createdAt, sessionRef: ref(n) });
}

describe('browser session contracts', () => {
  it('rotateSessionAtAuthentication implements Command', () => {
    type I = Parameters<RotateSessionAtAuthenticationUseCase['execute']>[0];
    type O = Awaited<ReturnType<RotateSessionAtAuthenticationUseCase['execute']>>;
    expectTypeOf<RotateSessionAtAuthentication>().toExtend<Command<I, O>>();
  });

  it('listLiveSessions implements Query', () => {
    type I = Parameters<ListLiveSessionsUseCase['execute']>[0];
    type O = Awaited<ReturnType<ListLiveSessionsUseCase['execute']>>;
    expectTypeOf<ListLiveSessions>().toExtend<Query<I, O>>();
  });

  it('revokeSession implements Command', () => {
    type I = Parameters<RevokeSessionUseCase['execute']>[0];
    type O = Awaited<ReturnType<RevokeSessionUseCase['execute']>>;
    expectTypeOf<RevokeSession>().toExtend<Command<I, O>>();
  });

  it('revokeAllSessions implements Command', () => {
    type I = Parameters<RevokeAllSessionsUseCase['execute']>[0];
    type O = Awaited<ReturnType<RevokeAllSessionsUseCase['execute']>>;
    expectTypeOf<RevokeAllSessions>().toExtend<Command<I, O>>();
  });
});

describe('RotateSessionAtAuthenticationUseCase', () => {
  it('rotates anonymous → authenticated in one transaction', async () => {
    expect.hasAssertions();
    const clock = new FixedClock(10_000),
      sessions = new InMemoryBrowserSessionStore(),
      unitOfWork = new InMemoryUnitOfWork();
    sessions.seed(subject(1), anonymousSession(1, 5000));
    const useCase = new RotateSessionAtAuthenticationUseCase({
        clock,
        sessions,
        unitOfWork,
      }),
      result = await useCase.execute({
        newSessionRef: ref(2),
        presentSessionRef: ref(1),
        subject: subject(1),
      });

    if (!('rotated' in result) || !result.rotated) {
      throw new Error('expected rotated result');
    }
    expect(result.newSnapshot.state).toBe('authenticated');
    expect(result.newSnapshot.acr).toBe('urn:ecoma:acr:email-otp');
    expect(result.newSnapshot.rotatedFrom).toBe(ref(1));
    const old = await sessions.findById(ref(1));
    expect(old?.revokedAt).not.toBeNull();
  });

  it('refuses to rotate an authenticated session of another account', async () => {
    expect.hasAssertions();
    const clock = new FixedClock(10_000),
      sessions = new InMemoryBrowserSessionStore(),
      unitOfWork = new InMemoryUnitOfWork(),
      authenticated = anonymousSession(1, 5000);
    authenticated.authenticate(ACR_EMAIL, 6000);
    sessions.seed(subject(1), authenticated);
    const useCase = new RotateSessionAtAuthenticationUseCase({
        clock,
        sessions,
        unitOfWork,
      }),
      result = await useCase.execute({
        newSessionRef: ref(2),
        presentSessionRef: ref(1),
        subject: subject(2),
      });
    expect(result).toStrictEqual({ rejected: 'present_session_not_anonymous' });
    // Phiên của account khác phải còn nguyên.
    expect((await sessions.findById(ref(1)))?.revokedAt).toBeNull();
  });

  it('rejects when the present session is unknown', async () => {
    expect.hasAssertions();
    const clock = new FixedClock(10_000),
      sessions = new InMemoryBrowserSessionStore(),
      useCase = new RotateSessionAtAuthenticationUseCase({
        clock,
        sessions,
        unitOfWork: new InMemoryUnitOfWork(),
      });
    await expect(
      useCase.execute({
        newSessionRef: ref(2),
        presentSessionRef: ref(99),
        subject: subject(1),
      }),
    ).resolves.toStrictEqual({ rejected: 'present_session_not_live' });
  });

  it('rejects when the rotate CAS loses (old session already revoked)', async () => {
    expect.hasAssertions();
    const clock = new FixedClock(10_000),
      sessions = new InMemoryBrowserSessionStore();
    sessions.failNextRotate = true;
    sessions.seed(subject(1), anonymousSession(1, 5000));
    const useCase = new RotateSessionAtAuthenticationUseCase({
        clock,
        sessions,
        unitOfWork: new InMemoryUnitOfWork(),
      }),
      result = await useCase.execute({
        newSessionRef: ref(2),
        presentSessionRef: ref(1),
        subject: subject(1),
      });
    expect(result).toStrictEqual({ rejected: 'present_session_not_live' });
    await expect(sessions.findById(ref(2))).resolves.toBeUndefined();
  });
});

describe('ListLiveSessionsUseCase', () => {
  it('lists own live sessions newest first, hides expired and other subjects', async () => {
    expect.hasAssertions();
    const clock = new FixedClock(10_000),
      sessions = new InMemoryBrowserSessionStore();
    sessions.seed(subject(1), anonymousSession(1, 1000));
    sessions.seed(subject(1), anonymousSession(2, 2000));
    sessions.seed(subject(1), anonymousSession(3, 3000));
    // Của subject khác — không bao giờ xuất hiện trong list của subject(1).
    sessions.seed(subject(9), anonymousSession(4, 3500));
    // Now=10_000 ms vẫn nằm trong anonymous TTL 600s của mọi phiên → cả ba live,
    // Sắp newest first.
    const useCase = new ListLiveSessionsUseCase({ clock, sessions }),
      live = await useCase.execute({ subject: subject(1) });
    expect(live.map((s) => s.sessionRef)).toStrictEqual([ref(3), ref(2), ref(1)]);
    await expect(
      useCase.execute({ subject: subject(9) }).then((r) => r.map((s) => s.sessionRef)),
    ).resolves.toStrictEqual([ref(4)]);
  });
});

describe('RevokeSessionUseCase', () => {
  it('revokes own live session', async () => {
    expect.hasAssertions();
    const clock = new FixedClock(10_000),
      sessions = new InMemoryBrowserSessionStore();
    sessions.seed(subject(1), anonymousSession(1, 1000));
    const useCase = new RevokeSessionUseCase({ clock, sessions });

    await expect(
      useCase.execute({ sessionRef: ref(1), subject: subject(1) }),
    ).resolves.toStrictEqual({
      revoked: true,
    });
    expect((await sessions.findById(ref(1)))?.revokedAt).not.toBeNull();
  });

  it('refuses a session that is not live or not owned — same branch', async () => {
    expect.hasAssertions();
    const clock = new FixedClock(10_000),
      sessions = new InMemoryBrowserSessionStore();
    sessions.seed(subject(1), anonymousSession(1, 1000));
    const useCase = new RevokeSessionUseCase({ clock, sessions });
    await useCase.execute({ sessionRef: ref(1), subject: subject(1) });

    // Đã revoke rồi — cùng nhánh với "không tồn tại"/"của người khác".
    await expect(
      useCase.execute({ sessionRef: ref(1), subject: subject(1) }),
    ).resolves.toStrictEqual({
      rejected: 'not_found_or_not_owner',
    });
    await expect(
      useCase.execute({ sessionRef: ref(99), subject: subject(1) }),
    ).resolves.toStrictEqual({
      rejected: 'not_found_or_not_owner',
    });
  });
});

describe('RevokeAllSessionsUseCase', () => {
  it('revokes every own live session and reports the count', async () => {
    expect.hasAssertions();
    const clock = new FixedClock(10_000),
      sessions = new InMemoryBrowserSessionStore();
    sessions.seed(subject(1), anonymousSession(1, 1000));
    sessions.seed(subject(1), anonymousSession(2, 2000));
    sessions.seed(subject(1), anonymousSession(3, 3000));
    // Của subject khác — revoke-all của subject(1) không được đụng tới.
    sessions.seed(subject(9), anonymousSession(4, 3500));
    const useCase = new RevokeAllSessionsUseCase({ clock, sessions }),
      out = await useCase.execute({ subject: subject(1) });
    expect(out.revokedCount).toBe(3);
    // Gọi lần nữa — idempotent, count 0.
    await expect(useCase.execute({ subject: subject(1) })).resolves.toStrictEqual({
      revokedCount: 0,
    });
    // Phiên của subject khác còn nguyên.
    expect((await sessions.findById(ref(4)))?.revokedAt).toBeNull();
  });
});

const ACR_EMAIL = 'urn:ecoma:acr:email-otp' as never;
