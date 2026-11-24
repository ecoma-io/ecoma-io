/**
 * Bảng quyết định identity thuần: id tất định, resolveRequestId, canonicalJson.
 */
import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  deriveAttemptId,
  deriveChargeId,
  deriveCompletionId,
  deriveFinancialReservationId,
  deriveQuotaReservationId,
  deriveSettlementId,
  resolveRequestId,
} from './identity.js';

describe('deterministic id derivation', () => {
  it('derives quota reservation id from request_id alone', () => {
    expect(deriveQuotaReservationId('req-1')).toBe('quota:req-1');
  });

  it('derives attempt id from request_id and attempt_no', () => {
    expect(deriveAttemptId('req-1', 2)).toBe('attempt:req-1:2');
  });

  it('derives financial reservation id from (request_id, attempt_id)', () => {
    expect(deriveFinancialReservationId('req-1', 'attempt:req-1:1')).toBe(
      'finres:req-1:attempt:req-1:1',
    );
  });

  it('derives settlement, charge and completion ids deterministically', () => {
    expect(deriveSettlementId('req-1', 'attempt:req-1:1')).toBe('settle:req-1:attempt:req-1:1');
    expect(deriveChargeId('req-1', 'attempt:req-1:1')).toBe('charge:req-1:attempt:req-1:1');
    expect(deriveCompletionId('req-1')).toBe('chatcmpl-req-1');
  });

  it('keeps the two reservation identities independent', () => {
    const attemptId = deriveAttemptId('req-1', 1);
    expect(deriveQuotaReservationId('req-1')).not.toBe(
      deriveFinancialReservationId('req-1', attemptId),
    );
  });
});

describe('resolveRequestId', () => {
  it('returns provided id for a valid header value', () => {
    expect(resolveRequestId('  abc  ')).toEqual({ kind: 'provided', requestId: 'abc' });
  });

  it('rejects an over-length header without generating', () => {
    expect(resolveRequestId('x'.repeat(201))).toEqual({ kind: 'invalid' });
  });

  it('rejects an empty header without generating', () => {
    expect(resolveRequestId('   ')).toEqual({ kind: 'invalid' });
  });

  it('falls back to the injected generator only when the header is absent', () => {
    expect(resolveRequestId(undefined, () => 'uuid-1')).toEqual({
      kind: 'generated',
      requestId: 'uuid-1',
    });
    expect(resolveRequestId(undefined)).toEqual({ kind: 'invalid' });
    // Sai hình vẫn không tự sinh.
    expect(resolveRequestId('', () => 'uuid-1')).toEqual({ kind: 'invalid' });
  });
});

describe('canonicalJson', () => {
  it('sorts object keys recursively so key order does not change the hash input', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('preserves array order', () => {
    expect(canonicalJson([2, 1])).toBe('[2,1]');
  });

  it('drops undefined fields (JSON.stringify semantics)', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('distinguishes different payloads', () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });

  it('serializes scalars and null without wrapping', () => {
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson('s')).toBe('"s"');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(undefined)).toBe('null'); // JSON.stringify(undefined) ?? 'null'
  });

  it('hashes equal for key orders differing only in nested objects (replay-safe)', () => {
    const left = canonicalJson({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
    });
    const right = canonicalJson({
      max_tokens: 5,
      messages: [{ content: 'hi', role: 'user' }],
      model: 'm',
    });
    expect(left).toBe(right);
  });

  it('is stable when two sibling keys sort equal at compare time (deterministic order)', () => {
    // Comparator trả 0 cho hai key bằng nhau — sort giữ ổn định, hai lần chạy
    // cùng input cho cùng chuỗi.
    const value = { b: 1, B: 2, a: 3 };
    expect(canonicalJson(value)).toBe(canonicalJson({ a: 3, B: 2, b: 1 }));
  });
});
