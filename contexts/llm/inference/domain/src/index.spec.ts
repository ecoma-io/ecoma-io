/**
 * Ghim public surface: mọi operation được tài liệu hoá đều được export, và
 * không có export nào kéo theo I/O hay state toàn cục.
 */

import { describe, expect, it } from 'vitest';

import * as api from './index';

describe('public API surface', () => {
  it('exports the aggregate root with its factory and reconstitute', () => {
    expect(typeof api.LogicalRequest).toBe('function');
    expect(typeof api.LogicalRequest.create).toBe('function');
    expect(typeof api.LogicalRequest.reconstitute).toBe('function');
  });

  it('exports the evidence vocabulary and helpers', () => {
    expect(api.EXECUTION_EVIDENCE).toEqual({
      not_sent: 'not_sent',
      may_have_executed: 'may_have_executed',
      confirmed_completed: 'confirmed_completed',
      confirmed_not_executed: 'confirmed_not_executed',
    });
    expect(typeof api.canTransitionEvidence).toBe('function');
    expect(typeof api.classifyAttemptOutcome).toBe('function');
    expect(typeof api.isExecutionEvidence).toBe('function');
  });

  it('exports the error taxonomy through a single factory', () => {
    expect(typeof api.inferenceDomainError).toBe('function');
    expect(typeof api.isInferenceDomainError).toBe('function');
    expect(api.INFERENCE_DOMAIN_ERROR_MESSAGES.request_closed).toBe(
      'The logical request is already closed.',
    );
  });
});

describe('purity of the public surface', () => {
  it('is deterministic for identical inputs', () => {
    const input = {
      requestId: 'req_det',
      admittedAt: 1_700_000_000_000,
      policy: { maxAttempts: 2, deadlineAt: 1_700_000_060_000 },
    };
    const first = api.LogicalRequest.create(input);
    const second = api.LogicalRequest.create(input);
    expect(first.ok && second.ok ? first.value.snapshot() : null).toEqual(
      first.ok && second.ok ? second.value.snapshot() : null,
    );
  });

  it('does not mutate the caller input', () => {
    const input = {
      requestId: 'req_det',
      admittedAt: 1_700_000_000_000,
      policy: { maxAttempts: 2, deadlineAt: 1_700_000_060_000 },
    };
    const snapshot = structuredClone(input);
    api.LogicalRequest.create(input);
    expect(input).toEqual(snapshot);
  });
});
