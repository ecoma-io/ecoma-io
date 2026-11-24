import { describe, expect, it, vi } from 'vitest';

import { runHooks } from './runner';
import type { HookInput, HookMatcher } from './types';

const input: HookInput = {
  session_id: 'ses_1',
  cwd: '/repo',
  hook_event_name: 'PostToolUse',
};

describe('runHooks', () => {
  it('returns empty for missing or empty matchers', async () => {
    await expect(runHooks('PostToolUse', undefined, 'Bash', input)).resolves.toEqual([]);
    await expect(runHooks('PostToolUse', [], 'Bash', input)).resolves.toEqual([]);
  });

  it('skips matchers whose pattern does not match the tool', async () => {
    const matchers: HookMatcher[] = [
      { matcher: 'WebFetch', hooks: [{ type: 'command', command: 'echo should-not-run' }] },
    ];

    const results = await runHooks('PostToolUse', matchers, 'Bash', input);

    expect(results).toEqual([]);
  });

  it('runs every matching handler in parallel and returns all results', async () => {
    const matchers: HookMatcher[] = [
      {
        matcher: 'bash',
        hooks: [
          { type: 'command', command: 'echo one' },
          { type: 'command', command: 'echo two' },
        ],
      },
      { matcher: '', hooks: [{ type: 'command', command: 'echo three' }] },
    ];

    const results = await runHooks('PostToolUse', matchers, 'Bash', input);

    expect(results).toHaveLength(3);
    expect(results.every((result) => result.action === 'allow')).toBe(true);
  });

  it('converts a failing handler into an error result without breaking the rest', async () => {
    const matchers: HookMatcher[] = [
      {
        matcher: 'Bash',
        hooks: [
          { type: 'command', command: 'exit 3' },
          { type: 'command', command: 'echo ok' },
        ],
      },
    ];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const results = await runHooks('PostToolUse', matchers, 'Bash', input);

    expect(results).toHaveLength(2);
    expect(results.some((result) => result.action === 'error')).toBe(true);
    expect(results.some((result) => result.action === 'allow')).toBe(true);
    warn.mockRestore();
  });

  it('matches every handler when the event has no tool', async () => {
    const matchers: HookMatcher[] = [
      { matcher: 'Write', hooks: [{ type: 'command', command: 'echo session' }] },
    ];

    const results = await runHooks('SessionStart', matchers, undefined, input);

    expect(results).toHaveLength(1);
  });
});
