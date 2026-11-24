import { describe, expect, it } from 'vitest';

import { matchHook } from './matcher';

describe('matchHook', () => {
  it('matches any value when the event has no matcher concept', () => {
    expect(matchHook(undefined, undefined)).toBe(true);
    expect(matchHook('Bash', undefined)).toBe(true);
  });

  it('matches all tools for empty, star, or missing matcher', () => {
    expect(matchHook(undefined, 'Bash')).toBe(true);
    expect(matchHook('', 'Bash')).toBe(true);
    expect(matchHook('*', 'Bash')).toBe(true);
  });

  it('matches case-insensitively by substring', () => {
    expect(matchHook('bash', 'Bash')).toBe(true);
    expect(matchHook('Edit|Write', 'Write')).toBe(true);
    expect(matchHook('edit|write', 'MultiEdit')).toBe(true);
  });

  it('does not match unrelated tools', () => {
    expect(matchHook('Edit|Write', 'Bash')).toBe(false);
    expect(matchHook('^notebook$', 'NotebookEdit')).toBe(false);
  });

  it('returns false for an invalid regex instead of throwing', () => {
    expect(matchHook('[unclosed', 'Bash')).toBe(false);
  });
});
