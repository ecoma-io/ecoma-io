/**
 * Ghim ranh giới evidence: HTTP transport facts (status code, body shape,
 * header) KHÔNG bao giờ tự suy ra `confirmed_not_executed`. Chỉ statement
 * semantics của provider mới cho bằng chứng authoritative; mọi ca dối loạn
 * (429 không body, 500 có JSON, 404, timeout, connection reset, malformed
 * JSON) phải rơi về `may_have_executed` khi dispatch đã diễn ra.
 */

import { describe, expect, it } from 'vitest';

import {
  EXECUTION_EVIDENCE_VALUES,
  classifyEvidence,
  isAuthoritativeEvidence,
  isRetrySafeEvidence,
  EXECUTION_EVIDENCE,
} from './evidence';

/** Input transport thô như adapter quan sát được — domain không nhận kiểu này. */
interface TransportObservation {
  readonly status: number | null;
  readonly contentType: string | null;
  readonly bodyText: string | null;
  readonly failureKind: 'none' | 'timeout' | 'connection_reset' | 'dns' | 'tls';
}

/**
 * Helper mô phỏng lớp mapping **đúng** ở adapter: từ transport observation
 * suy ra facts cho `classifyEvidence`. Ghim ở đây rằng chỉ có
 * `providerConfirmedNotExecuted` semantics mới sinh `confirmed_not_executed`;
 * mọi CA KHÁC của HTTP đều fail-safe về `may_have_executed`.
 */
function factsFromTransport(
  observation: TransportObservation,
  dispatchAttempted: boolean,
): {
  dispatchAttempted: boolean;
  providerConfirmedCompleted: boolean;
  providerConfirmedNotExecuted: boolean;
} {
  let structured = false;
  try {
    structured =
      observation.status !== null &&
      observation.status >= 400 &&
      observation.status < 500 &&
      observation.contentType?.includes('application/json') === true &&
      observation.bodyText !== null &&
      observation.bodyText.trim().startsWith('{') &&
      JSON.parse(observation.bodyText).error?.type === 'request_rejected';
  } catch {
    // Malformed JSON: không parse được thì không phải structured rejection.
    structured = false;
  }
  const structured4xxRejection = structured;
  return {
    dispatchAttempted,
    providerConfirmedCompleted: false,
    // Chỉ structured 4xx JSON rejection của provider mới chứng minh "not executed".
    providerConfirmedNotExecuted: structured4xxRejection,
  };
}

/** Ca transport dối loạn mà adapter gặp thực tế. */
const TRANSPORT_CASES: readonly (readonly [string, TransportObservation])[] = [
  [
    '429 without a structured body',
    { status: 429, contentType: null, bodyText: null, failureKind: 'none' },
  ],
  [
    '429 with an HTML rate-limit page',
    {
      status: 429,
      contentType: 'text/html',
      bodyText: '<html>slow down</html>',
      failureKind: 'none',
    },
  ],
  [
    '429 with malformed JSON',
    { status: 429, contentType: 'application/json', bodyText: '{"error":', failureKind: 'none' },
  ],
  [
    '500 with a JSON body',
    {
      status: 500,
      contentType: 'application/json',
      bodyText: '{"error":{"type":"internal"}}',
      failureKind: 'none',
    },
  ],
  [
    '502 bad gateway without body',
    { status: 502, contentType: null, bodyText: null, failureKind: 'none' },
  ],
  [
    '503 service unavailable',
    { status: 503, contentType: null, bodyText: null, failureKind: 'none' },
  ],
  ['404 not found', { status: 404, contentType: null, bodyText: null, failureKind: 'none' }],
  [
    'timeout before any byte',
    { status: null, contentType: null, bodyText: null, failureKind: 'timeout' },
  ],
  [
    'connection reset mid-flight',
    { status: null, contentType: null, bodyText: null, failureKind: 'connection_reset' },
  ],
  [
    'dns resolution failure',
    { status: null, contentType: null, bodyText: null, failureKind: 'dns' },
  ],
  [
    'tls handshake failure',
    { status: null, contentType: null, bodyText: null, failureKind: 'tls' },
  ],
  [
    '2xx with malformed JSON body',
    { status: 200, contentType: 'application/json', bodyText: 'not-json', failureKind: 'none' },
  ],
];

describe('evidence never derives from transport facts', () => {
  it('maps every ambiguous transport case to may_have_executed after dispatch', () => {
    for (const [label, observation] of TRANSPORT_CASES) {
      const facts = factsFromTransport(observation, true);
      const evidence = classifyEvidence(facts);
      expect(evidence).toBe(EXECUTION_EVIDENCE.may_have_executed);
      if (evidence !== EXECUTION_EVIDENCE.may_have_executed) {
        throw new Error(`case ${label} misclassified`);
      }
    }
  });

  it('maps every ambiguous transport case to not_sent when dispatch never happened', () => {
    for (const [label, observation] of TRANSPORT_CASES) {
      const facts = factsFromTransport(observation, false);
      const evidence = classifyEvidence(facts);
      expect(evidence).toBe(EXECUTION_EVIDENCE.not_sent);
      if (evidence !== EXECUTION_EVIDENCE.not_sent) {
        throw new Error(`case ${label} misclassified`);
      }
    }
  });

  it('accepts confirmed_not_executed only from an explicit provider rejection statement', () => {
    const facts = factsFromTransport(
      {
        status: 422,
        contentType: 'application/json',
        bodyText: JSON.stringify({ error: { type: 'request_rejected' } }),
        failureKind: 'none',
      },
      true,
    );
    expect(classifyEvidence(facts)).toBe(EXECUTION_EVIDENCE.confirmed_not_executed);
    expect(isRetrySafeEvidence(EXECUTION_EVIDENCE.confirmed_not_executed)).toBe(true);
  });

  it('never lets HTTP status alone produce retry-safe evidence after dispatch', () => {
    // Không status nào (kể cả 4xx) tự nó là evidence: mọi status mà không có
    // structured rejection statement phải cho evidence KHÔNG retry-safe.
    for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504]) {
      const facts = factsFromTransport(
        { status, contentType: null, bodyText: null, failureKind: 'none' },
        true,
      );
      const evidence = classifyEvidence(facts);
      expect(isRetrySafeEvidence(evidence)).toBe(false);
      expect(isAuthoritativeEvidence(evidence)).toBe(false);
      if (isRetrySafeEvidence(evidence) || isAuthoritativeEvidence(evidence)) {
        throw new Error(`status ${status} produced authoritative evidence`);
      }
    }
  });
});

describe('evidence ordering invariants', () => {
  it('never downgrades a provider confirmation back to an uncertain level', () => {
    // Khi provider đã xác nhận, mọi facts kế tiếp mà vẫn giữ dữ kiện xác nhận
    // đó phải cho cùng giá trị authoritative — classifyEvidence không nhận
    // trạng thái cũ nên không thể tự hạ cấp.
    const confirmed = classifyEvidence({
      dispatchAttempted: true,
      providerConfirmedCompleted: true,
      providerConfirmedNotExecuted: false,
    });
    expect(confirmed).toBe(EXECUTION_EVIDENCE.confirmed_completed);
    // Facts mâu thuẫn (cả hai confirmation) vẫn phải chọn một nhánh authoritative.
    const contradictory = classifyEvidence({
      dispatchAttempted: true,
      providerConfirmedCompleted: true,
      providerConfirmedNotExecuted: true,
    });
    expect(isAuthoritativeEvidence(contradictory)).toBe(true);
  });

  it('returns only canonical vocabulary values for every fact combination', () => {
    for (const dispatchAttempted of [false, true]) {
      for (const providerConfirmedCompleted of [false, true]) {
        for (const providerConfirmedNotExecuted of [false, true]) {
          const evidence = classifyEvidence({
            dispatchAttempted,
            providerConfirmedCompleted,
            providerConfirmedNotExecuted,
          });
          expect(EXECUTION_EVIDENCE_VALUES.includes(evidence)).toBe(true);
        }
      }
    }
  });
});
