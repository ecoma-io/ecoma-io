/**
 * Unit test cho `server/lib/data-domain.ts` — phần **thuần** của data domain:
 * allowlist, validator hình dạng, mask, publicSessionId, view builders.
 *
 * Mọi hàm persistence (SELECT/UPDATE/INSERT thật) được integration test trên
 * PostgreSQL thật (`integration-specs/`); ở đây neo những hợp đồng mà một sai
 * sót không thấy được bằng đọc code: locale/color_mode reject-không-fallback,
 * `sub` trong body bị bỏ qua, timezone từ chối theo IANA thật, mask không lộ
 * local-part, định danh phiên không bao giờ là `session_ref`.
 */

import { describe, expect, it } from 'vitest';

import {
  COLOR_MODE_ALLOWLIST,
  countVerifiedEmails,
  DATA_EVENT_TYPES,
  findVerifiedEmailOwner,
  isValidTimeZone,
  LOCALE_ALLOWLIST,
  maskEmail,
  parsePreferencesPatch,
  publicSessionId,
  revokeEmailGuarded,
  toEmailView,
  toSessionView,
} from './data-domain';

// -------------------------------------------------------------------------------------------
// Fake pool — các hàm persistence chỉ cần `query` (hoặc `connect` cho hàm có
// transaction); này là unit test của logic bao quanh câu SQL, không phải test
// SQL. `connect()` trả client chia sẻ cùng hàng đợi response và gọi `release`
// là no-op.
// -------------------------------------------------------------------------------------------

type FakeRow = Record<string, unknown>;

/** Một response của fake pool: hàng, hoặc `{ rowCount }` cho UPDATE/DELETE. */
type FakeResponse = FakeRow[] | { rowCount: number };

function fakePool(responses: FakeResponse[]): {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: FakeRow[]; rowCount: number | null }>;
  connect: () => Promise<{
    query: (
      sql: string,
      values?: unknown[],
    ) => Promise<{ rows: FakeRow[]; rowCount: number | null }>;
    release: () => void;
  }>;
  readonly calls: { sql: string; values: unknown[] | undefined }[];
} {
  const calls: { sql: string; values: unknown[] | undefined }[] = [];
  let index = 0;
  const query = async (
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: FakeRow[]; rowCount: number | null }> => {
    calls.push({ sql, values });
    const response = responses[index] ?? [];
    index += 1;
    if (Array.isArray(response)) {
      return { rows: response, rowCount: response.length };
    }
    return { rows: [], rowCount: response.rowCount };
  };
  return {
    calls,
    query,
    connect: async () => ({ query, release: () => undefined }),
  };
}

describe('data-domain policy constants', () => {
  it('locks the v1 allowlists and audit event names', () => {
    expect(LOCALE_ALLOWLIST).toEqual(['en', 'vi']);
    expect(COLOR_MODE_ALLOWLIST).toEqual(['system', 'light', 'dark']);
    expect(Object.values(DATA_EVENT_TYPES)).toEqual([
      'data_profile_updated',
      'data_preferences_updated',
      'data_email_added',
      'data_email_verified',
      'data_email_resend_sent',
      'data_email_revoked',
      'data_session_revoked',
      'data_current_session_revoked',
    ]);
  });
});

describe('isValidTimeZone', () => {
  it('accepts the documented default and common IANA zones', () => {
    expect(isValidTimeZone('Asia/Ho_Chi_Minh')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    // Alias IANA vẫn hợp lệ — DateTimeFormat nhận cả primary ID lẫn alias.
    expect(isValidTimeZone('Asia/Saigon')).toBe(true);
  });

  it('rejects non-IANA and adversarial inputs', () => {
    expect(isValidTimeZone('Mars/Phobos')).toBe(false);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('UTC\x00DROP TABLE users')).toBe(false);
    expect(isValidTimeZone('UTC; DROP TABLE account.user_preferences')).toBe(false);
    expect(isValidTimeZone(42 as unknown as string)).toBe(false);
    expect(isValidTimeZone(null as unknown as string)).toBe(false);
    // Chuỗi cực dài không được treo hay trả true.
    expect(isValidTimeZone('UTC/'.repeat(500) + 'X')).toBe(false);
  });
});

describe('parsePreferencesPatch', () => {
  it('accepts a full patch and rejects values outside the allowlists', () => {
    expect(parsePreferencesPatch({ locale: 'vi', timezone: 'UTC', colorMode: 'dark' })).toEqual({
      locale: 'vi',
      timezone: 'UTC',
      colorMode: 'dark',
    });
    // Locale sai → reject toàn bộ (FR-008a: reject, không fallback).
    expect(parsePreferencesPatch({ locale: 'fr' })).toBe(false);
    expect(parsePreferencesPatch({ locale: 'VI' })).toBe(false);
    expect(parsePreferencesPatch({ colorMode: 'blue' })).toBe(false);
    expect(parsePreferencesPatch({ timezone: 'Mars/Phobos' })).toBe(false);
  });

  it('ignores a client-supplied sub (FR-008d) and unknown keys', () => {
    expect(
      parsePreferencesPatch({
        sub: 'attacker-sub',
        locale: 'en',
        nonsense: true,
      }),
    ).toEqual({ locale: 'en' });
    expect(parsePreferencesPatch({ sub: 'only-sub' })).toEqual({});
  });

  it('rejects wrong-typed values', () => {
    expect(parsePreferencesPatch({ locale: 42 })).toBe(false);
    expect(parsePreferencesPatch({ timezone: ['UTC'] })).toBe(false);
    expect(parsePreferencesPatch({ colorMode: null })).toBe(false);
    expect(parsePreferencesPatch('not-an-object')).toBe(false);
    expect(parsePreferencesPatch(null)).toBe(false);
  });

  it('accepts an empty patch (partial update semantics, FR-008e)', () => {
    expect(parsePreferencesPatch({})).toEqual({});
  });
});

describe('maskEmail', () => {
  it('masks the local part and keeps the domain', () => {
    expect(maskEmail('user@example.com')).toBe('u***@example.com');
    expect(maskEmail('long.local.part@sub.domain.example')).toBe(
      'l**************@sub.domain.example',
    );
  });

  it('keeps local parts of two characters or fewer intact', () => {
    expect(maskEmail('a@b.co')).toBe('a@b.co');
    expect(maskEmail('ab@example.com')).toBe('ab@example.com');
  });

  it('never leaks more than the first character of the local part', () => {
    const masked = maskEmail('secretname@example.com');
    expect(masked.startsWith('s*********@example.com')).toBe(true);
    expect(masked.includes('ecretname')).toBe(false);
  });
});

describe('publicSessionId', () => {
  it('is a 64-char hex digest and never equals the raw session_ref', async () => {
    const ref = 'sess_live_0000000000000000000000000000';
    const id = await publicSessionId(ref);
    expect(id).toMatch(/^[0-9a-f]{64}$/u);
    expect(id).not.toBe(ref);
    // Deterministic — cùng ref ra cùng id.
    expect(await publicSessionId(ref)).toBe(id);
  });

  it('differs for different refs (no collision on prefix)', async () => {
    expect(await publicSessionId('a')).not.toBe(await publicSessionId('b'));
  });

  it('matches the documented construction SHA-256("session-public:" + ref)', async () => {
    const { createHash } = await import('node:crypto');
    const ref = 'construct-check-ref';
    expect(await publicSessionId(ref)).toBe(
      createHash('sha256').update(`session-public:${ref}`).digest('hex'),
    );
  });
});

describe('toSessionView', () => {
  it('exposes no session_ref, no id_hash, no cookie material', async () => {
    const ref = 'sess_view_ref_value';
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const expiresAt = new Date(createdAt.getTime() + 12 * 3600 * 1000);
    const view = await toSessionView(
      { session_ref: ref, created_at: createdAt, expires_at: expiresAt },
      { idleSeconds: 12 * 3600, currentRef: ref },
    );
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(ref);
    expect(serialized).not.toContain('id_hash');
    expect(view.isCurrent).toBe(true);
    expect(view.createdAt).toBe('2026-01-01T00:00:00.000Z');
    // lastSeenAt suy từ expires_at - idle: hết 12h idle nghĩa là vừa hoạt động.
    expect(view.lastSeenAt).toBe('2026-01-01T00:00:00.000Z');
    expect(view.expiresAt).toBe('2026-01-01T12:00:00.000Z');
  });

  it('marks isCurrent false for other sessions of the same user', async () => {
    const view = await toSessionView(
      {
        session_ref: 'other-ref',
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        expires_at: new Date('2026-01-01T12:00:00.000Z'),
      },
      { idleSeconds: 0, currentRef: 'current-ref' },
    );
    expect(view.isCurrent).toBe(false);
  });
});

describe('toEmailView', () => {
  it('returns the masked address plus status and flags, no normalized hash', () => {
    const view = toEmailView({
      id: '11111111-1111-1111-1111-111111111111',
      address_normalized: 'user@example.com',
      address_hash: 'ab'.repeat(32),
      status: 'verified',
      is_sign_in: true,
      verified_at: new Date('2026-01-02T00:00:00.000Z'),
      created_at: new Date('2026-01-01T00:00:00.000Z'),
    } as never);
    expect(view.address).toBe('u***@example.com');
    expect(view.status).toBe('verified');
    expect(view.isSignIn).toBe(true);
    expect(view.verifiedAt).toBe('2026-01-02T00:00:00.000Z');
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('address_hash');
    expect(serialized).not.toContain('user@example.com');
  });

  it('clears isSignIn for a pending row even when the flag is set', () => {
    const view = toEmailView({
      id: '22222222-2222-2222-2222-222222222222',
      address_normalized: 'pending@example.com',
      address_hash: 'cd'.repeat(32),
      status: 'pending',
      is_sign_in: true,
      verified_at: null,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
    } as never);
    expect(view.isSignIn).toBe(false);
    expect(view.status).toBe('pending');
    expect(view.verifiedAt).toBeNull();
  });
});

describe('persistence helpers use parameterized queries against schema-qualified tables', () => {
  it('countVerifiedEmails counts only verified rows of the given sub', async () => {
    const pool = fakePool([[{ count: 2 }]]);
    const n = await countVerifiedEmails(pool as never, 'sub-1');
    expect(n).toBe(2);
    const call = pool.calls[0];
    if (!call) {
      throw new Error('expected one query');
    }
    expect(call.sql).toContain('account.email_addresses');
    expect(call.sql).toContain("status = 'verified'");
    expect(call.values).toEqual(['sub-1']);
  });

  it('findVerifiedEmailOwner scopes by hash and verified status', async () => {
    const pool = fakePool([[{ user_sub: 'owner-1' }]]);
    const owner = await findVerifiedEmailOwner(pool as never, 'ab'.repeat(32));
    expect(owner).toEqual({ userSub: 'owner-1' });
    const call = pool.calls[0];
    if (!call) {
      throw new Error('expected one query');
    }
    expect(call.sql).toContain('address_hash = $1');
    expect(call.sql).toContain("status = 'verified'");
  });

  it('revokeEmailGuarded revokes only non-revoked owned rows and returns revoked', async () => {
    // Một statement khoá toàn bộ hàng của sub (ORDER BY id FOR UPDATE), đếm
    // verified từ snapshot đã khoá, rồi UPDATE. Fake pool trả hai hàng:
    // đích `pending` (`e1`) và một hàng verified khác — đủ guard.
    const pool = fakePool([
      [],
      [
        { id: 'e1', status: 'pending' },
        { id: 'e2', status: 'verified' },
      ],
      { rowCount: 1 },
    ]);
    const outcome = await revokeEmailGuarded(pool as never, { userSub: 'sub-1', id: 'e1' });
    expect(outcome).toBe('revoked');
    // Thứ tự: BEGIN, SELECT-all-lock, UPDATE, COMMIT.
    const lock = pool.calls[1];
    const update = pool.calls[2];
    if (!lock || !update) {
      throw new Error('expected BEGIN + SELECT + UPDATE');
    }
    expect(lock.sql).toContain('ORDER BY id');
    expect(lock.sql).toContain('FOR UPDATE');
    expect(lock.values).toEqual(['sub-1']);
    expect(update.sql).toContain("status <> 'revoked'");
    expect(update.values).toEqual(['sub-1', 'e1']);
  });

  it('revokeEmailGuarded blocks when the caller has a single verified address left', async () => {
    // Hàng đích `verified` là hàng verified DUY NHẤT của sub → 'last_verified',
    // và KHÔNG có statement UPDATE nào chạy.
    const pool = fakePool([[], [{ id: 'e1', status: 'verified' }]]);
    const outcome = await revokeEmailGuarded(pool as never, { userSub: 'sub-1', id: 'e1' });
    expect(outcome).toBe('last_verified');
    // BEGIN + SELECT-all-lock + COMMIT — không UPDATE.
    expect(pool.calls).toHaveLength(3);
  });

  it('revokeEmailGuarded reports missing for an unknown row', async () => {
    // Snapshot không chứa id được hỏi → 'missing' dù sub có hàng khác.
    const pool = fakePool([[], [{ id: 'e2', status: 'verified' }]]);
    const outcome = await revokeEmailGuarded(pool as never, { userSub: 'sub-1', id: 'e1' });
    expect(outcome).toBe('missing');
    // BEGIN + SELECT-all-lock + COMMIT — không UPDATE.
    expect(pool.calls).toHaveLength(3);
  });

  it('revokeEmailGuarded reports already_revoked for a previously revoked row', async () => {
    const pool = fakePool([[], [{ id: 'e1', status: 'revoked' }]]);
    const outcome = await revokeEmailGuarded(pool as never, { userSub: 'sub-1', id: 'e1' });
    expect(outcome).toBe('already_revoked');
    // BEGIN + SELECT-all-lock + COMMIT — idempotent, không UPDATE, không audit.
    expect(pool.calls).toHaveLength(3);
  });
});
