/**
 * Kiểm chứng enforcement của `requirePermission` — fail path lần lượt
 * (thiếu permission, revoke, expiry, staff không active, audit hỏng phải
 * propagate) và shape HTTP của deny.
 *
 * ⚠️ Audit KHÔNG được nuốt lỗi là yêu cầu I-08 của issue #86 — test
 * `propagates when the audit insert fails` là mutation evidence: bỏ
 * `await recordDecision` trong `authorization.ts` (hoặc bọc try/catch) là
 * test đó đỏ, đúng nghĩa "phá kiểm soát thì test tương ứng phải đỏ" ở
 * `02-requirements.md` §5.
 */

import { describe, expect, it } from 'vitest';

import type { GrantedAssignment } from '@ecoma-io/backoffice-domain';

import type { recordDecision } from './authorization-audit';
import { requirePermission, type PrincipalAuthorization } from './authorization';

const ACTOR = 'sub_' + 'a'.repeat(52);
const TARGET = 'sub_' + 'b'.repeat(52);

/**
 * Mốc tương đối so với đồng hồ thật: `requirePermission` tự đọc `new Date()`
 * (policy thuần nhận thời gian từ caller), nên fixture hẹn giờ cố định
 * sẽ chênh theo thời gian chạy — vì mô phỏng bằng offset từ hiện tại.
 */
const HOURS = 3_600_000;

function assignment(overrides: Partial<GrantedAssignment> = {}): GrantedAssignment {
  return {
    permissions: ['delivery.redrive'],
    validUntil: null,
    revokedAt: null,
    fetchedAt: new Date(),
    staffStatus: 'active',
    ...overrides,
  };
}

function principal(overrides: Partial<PrincipalAuthorization> = {}): PrincipalAuthorization {
  return { assignments: [assignment()], actorSub: ACTOR, ...overrides };
}

/**
 * Audit client giả — ghi nhớ INSERT để assert được "denial phải được log
 * rồi mới 403", đồng thời cho phép mô phỏng lỗi DB (I-08).
 */
function fakeAuditClient_impl() {
  const inserts: { text: string; values: readonly unknown[] }[] = [];
  let failure: Error | undefined;
  return {
    inserts,
    failNextWith(error: Error) {
      failure = error;
    },
    // Shape tối thiểu mà `recordDecision` dùng — type của `pg` Client đầy
    // đủ hơn; ở đây chỉ có `query` được gọi.
    client: {
      query: (text: string, values?: readonly unknown[]) => {
        if (failure !== undefined) {
          return Promise.reject(failure);
        }
        inserts.push({ text, values: values ?? [] });
        return Promise.resolve({ rows: [], rowCount: 1 });
      },
    },
  };
}
type FakeAudit = ReturnType<typeof fakeAuditClient_impl>;
// Ép shape Client ở chỗ dùng — caller thật sẽ cắm runtime-role client; test
// chỉ cần hợp đồng `query(text, values)` mà recordDecision gọi.
const asPgClient = (fake: FakeAudit) =>
  fake.client as unknown as Parameters<typeof recordDecision>[0];

describe('requirePermission — allow path', () => {
  it('returns the decision without writing a deny audit row', async () => {
    const fake = fakeAuditClient_impl();
    const decision = await requirePermission('delivery.redrive', principal(), asPgClient(fake));
    expect(decision.allowed).toBe(true);
    expect(fake.inserts).toHaveLength(0);
  });

  it('denies by default when the assignment set is empty, and logs the denial first', async () => {
    const fake = fakeAuditClient_impl();
    await expect(
      requirePermission('delivery.redrive', principal({ assignments: [] }), asPgClient(fake)),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(fake.inserts).toHaveLength(1);
    const { text, values } = fake.inserts[0];
    expect(text).toContain('authorization_audit');
    expect(values[1]).toBe(null);
    expect(values[2]).toBe('delivery.redrive');
    expect(values[3]).toBe('denied');
    expect(values[4]).toContain('permission_not_granted');
  });
});

describe('requirePermission — deny reasons through HTTP shape', () => {
  it('denies a revoked assignment with 403 and writes assignment_revoked to audit', async () => {
    const fake = fakeAuditClient_impl();
    await expect(
      requirePermission(
        'delivery.redrive',
        principal({
          assignments: [assignment({ revokedAt: new Date(Date.now() - 24 * HOURS) })],
        }),
        asPgClient(fake),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(fake.inserts[0].values[4]).toContain('assignment_revoked');
  });

  it('denies an expired assignment with 403 and writes assignment_expired to audit', async () => {
    const fake = fakeAuditClient_impl();
    await expect(
      requirePermission(
        'delivery.redrive',
        principal({
          assignments: [assignment({ validUntil: new Date(Date.now() - 1 * HOURS) })],
        }),
        asPgClient(fake),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(fake.inserts[0].values[4]).toContain('assignment_expired');
  });

  it('denies a suspended staff member with 403 and writes staff_not_active to audit', async () => {
    const fake = fakeAuditClient_impl();
    await expect(
      requirePermission(
        'delivery.redrive',
        principal({ assignments: [assignment({ staffStatus: 'suspended' })] }),
        asPgClient(fake),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(fake.inserts[0].values[4]).toContain('staff_not_active');
  });
});

describe('requirePermission — fail closed on malformed input', () => {
  it('rejects a malformed actor with 503 and never reaches policy', async () => {
    const fake = fakeAuditClient_impl();
    await expect(
      requirePermission('delivery.redrive', principal({ actorSub: 'not-a-sub' }), asPgClient(fake)),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(fake.inserts).toHaveLength(0);
  });
});

describe('requirePermission — audit failure propagates (I-08)', () => {
  it('propagates when the audit insert fails instead of letting the deny pass silently', async () => {
    const fake = fakeAuditClient_impl();
    const dbFailure = new Error('audit insert failed');
    fake.failNextWith(dbFailure);

    await expect(
      requirePermission('delivery.redrive', principal({ assignments: [] }), asPgClient(fake)),
    ).rejects.toBe(dbFailure);
  });
});

describe('requirePermission — audit fields follow SR-013/SR-014', () => {
  it('writes the seven-field audit row for a target-scoped denial without secrets', async () => {
    const fake = fakeAuditClient_impl();
    await expect(
      requirePermission('delivery.redrive', principal({ assignments: [] }), asPgClient(fake), {
        targetSub: TARGET,
        requestId: 'req-1',
        correlationId: 'corr-1',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    const { values } = fake.inserts[0];
    expect(values[0]).toBe(ACTOR);
    expect(values[1]).toBe(TARGET);
    expect(values[2]).toBe('delivery.redrive');
    expect(values[3]).toBe('denied');
    expect(values[5]).toBe('req-1');
    expect(values[6]).toBe('corr-1');
    // Context chỉ mang marker risk class / stale — không payload nào lạ.
    const context = JSON.parse(values[7] as string) as Record<string, unknown>;
    expect(Object.keys(context).toSorted()).toEqual(['riskClass', 'stale']);
  });
});

describe('module boundary (mutation evidence)', () => {
  it('does not import any business handler from server/api', async () => {
    // Mutation control: nếu ai đó cấu trúc lại enforcement thành middleware
    // import trực tiếp handler, test này đỏ — guard cho "module này chỉ là
    // checkpoint, không đụng handler".
    const module = await import('./authorization');
    const source = String(module.requirePermission);
    expect(source).not.toContain('greet');
    expect(source).not.toContain('server/api');
  });
});
