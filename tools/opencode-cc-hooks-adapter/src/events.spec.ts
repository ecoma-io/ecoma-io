import { describe, expect, it } from 'vitest';

import {
  buildSessionHookInput,
  buildToolHookInput,
  collectAdditionalContext,
  findBlockResult,
  findUpdatedInput,
  toRecord,
} from './events';
import type { HookResult } from './types';

describe('buildToolHookInput', () => {
  it('maps OpenCode tool event data to Claude hook input', () => {
    expect(
      buildToolHookInput(
        'PreToolUse',
        { sessionId: 'ses_1', tool: 'bash', args: { command: 'ls' } },
        '/repo',
      ),
    ).toEqual({
      session_id: 'ses_1',
      cwd: '/repo',
      hook_event_name: 'PreToolUse',
      tool_name: 'bash',
      tool_input: { command: 'ls' },
    });
  });
});

describe('buildSessionHookInput', () => {
  it('maps session event data without tool fields', () => {
    expect(buildSessionHookInput('SessionStart', { sessionId: 'ses_2' }, '/repo')).toEqual({
      session_id: 'ses_2',
      cwd: '/repo',
      hook_event_name: 'SessionStart',
    });
  });
});

describe('findBlockResult', () => {
  it('returns the first block result', () => {
    const results: HookResult[] = [
      { action: 'allow' },
      { action: 'block', reason: 'no' },
      { action: 'block', reason: 'also no' },
    ];
    expect(findBlockResult(results)).toEqual({ action: 'block', reason: 'no' });
  });

  it('returns undefined when nothing blocks', () => {
    expect(findBlockResult([{ action: 'allow' }])).toBeUndefined();
    expect(findBlockResult([])).toBeUndefined();
  });
});

describe('findUpdatedInput', () => {
  it('returns the first result carrying updatedInput', () => {
    const results: HookResult[] = [
      { action: 'allow' },
      { action: 'allow', updatedInput: { a: 1 } },
    ];
    expect(findUpdatedInput(results)).toEqual({ a: 1 });
  });

  it('returns undefined when no result updates input', () => {
    expect(findUpdatedInput([{ action: 'block', reason: 'x' }])).toBeUndefined();
  });
});

describe('collectAdditionalContext', () => {
  it('collects non-empty context strings in order', () => {
    const results: HookResult[] = [
      { action: 'allow', additionalContext: 'one' },
      { action: 'allow' },
      { action: 'allow', additionalContext: '' },
      { action: 'allow', additionalContext: 'two' },
    ];
    expect(collectAdditionalContext(results)).toEqual(['one', 'two']);
  });
});

describe('toRecord', () => {
  it('keeps object input and normalizes non-objects to an empty record', () => {
    expect(toRecord({ a: 1 })).toEqual({ a: 1 });
    expect(toRecord('freeform')).toEqual({});
    expect(toRecord(null)).toEqual({});
    expect(toRecord([1, 2])).toEqual({});
    expect(toRecord(undefined)).toEqual({});
  });
});
