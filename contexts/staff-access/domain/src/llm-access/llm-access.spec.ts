/**
 * Ghim invariants của aggregate `LlmAccess`: entitlement nhị phân cho LLM
 * product duy nhất, revision tăng đơn điệu, revoked là terminal.
 */

import { createStaffId } from '../staff/staff-id';
import { LlmAccess } from './llm-access';

const NOW = 1_700_000_000_000,
  STAFF = createStaffId('a'.repeat(32));

describe('llmAccess.grant', () => {
  it('starts entitled at revision 1 for the llm product only', () => {
    expect.hasAssertions();
    const e = LlmAccess.grant({ now: NOW, staffId: STAFF });
    expect(e.isEntitled()).toBe(true);
    expect(e.revision()).toBe(1);
    expect(e.businessKey()).toStrictEqual({ product: 'llm', staffId: STAFF });
  });

  it('rejects invalid staffId and non-finite now', () => {
    expect.hasAssertions();
    expect(() => LlmAccess.grant({ now: NOW, staffId: 'sub_bad' as never })).toThrow(TypeError);
    expect(() => LlmAccess.grant({ now: Number.NaN, staffId: STAFF })).toThrow(TypeError);
  });
});

describe('llmAccess lifecycle', () => {
  it('revoke bumps revision monotonically and is terminal', () => {
    expect.hasAssertions();
    const e = LlmAccess.grant({ now: NOW, staffId: STAFF });
    expect(e.revoke(NOW + 1)).toBeUndefined();
    expect(e.isEntitled()).toBeFalsy();
    expect(e.revision()).toBe(2);
    expect(e.occurredAt()).toBe(NOW + 1);
    expect(e.revoke(NOW + 2)?.code).toBe('invalid_transition');
  });

  it('rejects non-finite now without mutating', () => {
    expect.hasAssertions();
    const e = LlmAccess.grant({ now: NOW, staffId: STAFF });
    expect(() => e.revoke(Number.NaN)).toThrow(TypeError);
    expect(e.isEntitled()).toBe(true);
  });
});

describe('llmAccess.reconstitute', () => {
  it('round-trips an entitled entry', () => {
    expect.hasAssertions();
    const e = LlmAccess.grant({ now: NOW, staffId: STAFF });
    expect(LlmAccess.reconstitute(e.snapshot()).snapshot()).toStrictEqual(e.snapshot());
  });

  it('round-trips a revoked entry', () => {
    expect.hasAssertions();
    const e = LlmAccess.grant({ now: NOW, staffId: STAFF });
    e.revoke(NOW + 1);
    expect(LlmAccess.reconstitute(e.snapshot()).snapshot()).toStrictEqual(e.snapshot());
  });

  it('rejects corrupt snapshots', () => {
    expect.hasAssertions();
    const entitled = LlmAccess.grant({ now: NOW, staffId: STAFF }).snapshot();
    // Product khác llm — ngoài scope Staff Access của repo này.
    expect(() => LlmAccess.reconstitute({ ...entitled, product: 'pact-broker' as never })).toThrow(
      TypeError,
    );
    expect(() => LlmAccess.reconstitute({ ...entitled, revision: 0 })).toThrow(TypeError);
    expect(() => LlmAccess.reconstitute({ ...entitled, revision: 1.5 })).toThrow(TypeError);
    expect(() => LlmAccess.reconstitute({ ...entitled, state: 'unknown' as never })).toThrow(
      TypeError,
    );
    expect(() =>
      LlmAccess.reconstitute({ ...entitled, occurredAt: entitled.createdAt - 1 }),
    ).toThrow(TypeError);

    const revoked = LlmAccess.grant({ now: NOW, staffId: STAFF });
    revoked.revoke(NOW + 1);
    const revokedSnap = revoked.snapshot();
    // Revoked với revision vẫn 1 là dữ liệu hỏng (một lần revoke phải bump).
    expect(() => LlmAccess.reconstitute({ ...revokedSnap, revision: 1 })).toThrow(TypeError);
  });
});
