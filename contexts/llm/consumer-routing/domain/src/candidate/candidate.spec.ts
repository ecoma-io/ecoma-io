import { describe, expect, it } from 'vitest';

import {
  CandidateAggregate,
  CANDIDATE_STATUS,
  createCandidateId,
  isCandidate,
  isCandidateCapability,
  isCandidateId,
  isCandidateStatus,
  type Candidate,
  type CandidateId,
} from './candidate';

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    candidateId: 'cand-a',
    status: CANDIDATE_STATUS.active,
    priority: 1,
    capability: { model: 'claude-3-5-sonnet', streaming: true },
    endpoints: ['https://endpoint-a.example.com'],
    offerId: 'offer-1',
    ...overrides,
  } as Candidate;
}

describe('candidate', () => {
  it('recognizes a valid candidate', () => {
    expect(isCandidate(candidate())).toBe(true);
  });

  it('rejects invalid status candidates', () => {
    expect(isCandidate(candidate({ status: 'inactive' } as unknown as Candidate))).toBe(false);
    expect(isCandidate(candidate({ status: 'unknown' } as unknown as Candidate))).toBe(false);
  });

  it('rejects malformed candidates', () => {
    expect(isCandidate(null)).toBe(false);
    expect(isCandidate({} as Candidate)).toBe(false);
    expect(isCandidate(candidate({ candidateId: '' as CandidateId }))).toBe(false);
    expect(isCandidate(candidate({ capability: { model: '', streaming: true } }))).toBe(false);
    expect(isCandidate(candidate({ endpoints: [''] }))).toBe(false);
    expect(isCandidate(candidate({ offerId: '' }))).toBe(false);
  });

  it('guards candidate id, status, and capability', () => {
    expect(isCandidateId('cid')).toBe(true);
    expect(isCandidateId('')).toBe(false);
    expect(isCandidateStatus('active')).toBe(true);
    expect(isCandidateStatus('unknown')).toBe(false);
    expect(isCandidateCapability({ model: 'm', streaming: true })).toBe(true);
    expect(isCandidateCapability({ model: 'm' } as unknown as Candidate)).toBe(false);
  });

  it('createCandidateId builds a branded id and rejects bad input', () => {
    expect(() => createCandidateId('cid')).not.toThrow();
    expect(() => createCandidateId('')).toThrow(TypeError);
    expect(createCandidateId('cid')).toBe('cid');
  });

  it('aggregate context exposes eligibility conditions as methods', () => {
    const aggregate = new CandidateAggregate(candidate());
    expect(aggregate.isActive()).toBe(true);
    expect(aggregate.matchesCapability({ model: 'claude-3-5-sonnet', streaming: true })).toBe(true);
    expect(aggregate.matchesCapability({ model: 'other-model', streaming: true })).toBe(false);
    expect(aggregate.matchesCapability({ model: 'claude-3-5-sonnet', streaming: false })).toBe(
      false,
    );
    expect(aggregate.toRecord()).toEqual(candidate());
  });

  it('aggregate context reports inactive for disabled and retired', () => {
    expect(new CandidateAggregate(candidate({ status: 'disabled' })).isActive()).toBe(false);
    expect(new CandidateAggregate(candidate({ status: 'retired' })).isActive()).toBe(false);
  });

  it('aggregate constructor rejects an invalid record', () => {
    expect(() => new CandidateAggregate(null)).toThrow(TypeError);
    expect(() => new CandidateAggregate(candidate({ offerId: '' }))).toThrow(TypeError);
  });
});
