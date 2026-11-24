import { createServer } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { executeHook, interpolateEnvVars, outputToResult, parseHookOutput } from './executor';
import type { CommandHandler, HookInput } from './types';

const input: HookInput = {
  session_id: 'ses_1',
  cwd: '/repo',
  hook_event_name: 'PreToolUse',
  tool_name: 'bash',
  tool_input: { command: 'ls' },
};

describe('parseHookOutput', () => {
  it('parses a JSON object and rejects invalid or empty text', () => {
    expect(parseHookOutput('{"decision":"block"}')).toEqual({ decision: 'block' });
    expect(parseHookOutput('  ')).toBeNull();
    expect(parseHookOutput('not json')).toBeNull();
  });
});

describe('outputToResult', () => {
  it('maps block variants to a block result with reason', () => {
    expect(outputToResult({ decision: 'block', reason: 'no' })).toEqual({
      action: 'block',
      reason: 'no',
      updatedInput: undefined,
      additionalContext: undefined,
    });
    expect(outputToResult({ continue: false, stopReason: 'halt' })?.action).toBe('block');
    expect(outputToResult({ ok: false })?.action).toBe('block');
  });

  it('defaults the reason when blocking without one', () => {
    expect(outputToResult({ decision: 'block' })?.reason).toBe('Blocked by hook');
  });

  it('maps allow and carries hookSpecificOutput fields', () => {
    expect(
      outputToResult({
        hookSpecificOutput: { updatedInput: { a: 1 }, additionalContext: 'note' },
      }),
    ).toEqual({
      action: 'allow',
      updatedInput: { a: 1 },
      additionalContext: 'note',
    });
    expect(outputToResult(null)).toEqual({ action: 'allow' });
  });
});

describe('interpolateEnvVars', () => {
  it('replaces $VARS from the environment and drops unset ones', () => {
    vi.stubEnv('CC_TEST_TOKEN', 'secret');
    expect(interpolateEnvVars('Bearer $CC_TEST_TOKEN')).toBe('Bearer secret');
    expect(interpolateEnvVars('$CC_MISSING_X')).toBe('');
    expect(interpolateEnvVars('$lowercase-kept')).toBe('$lowercase-kept');
    vi.unstubAllEnvs();
  });
});

describe('executeHook with command handler', () => {
  it('parses structured JSON output from stdout on exit 0', async () => {
    const handler: CommandHandler = {
      type: 'command',
      command: 'echo \'{"decision":"block","reason":"no writes"}\'',
    };

    const result = await executeHook(handler, input);

    expect(result).toMatchObject({ action: 'block', reason: 'no writes' });
  });

  it('blocks with stderr as reason on exit code 2', async () => {
    const handler: CommandHandler = {
      type: 'command',
      command: "echo 'denied' >&2; exit 2",
    };

    const result = await executeHook(handler, input);

    expect(result).toEqual({ action: 'block', reason: 'denied' });
  });

  it('allows plain stdout without JSON on exit 0', async () => {
    const handler: CommandHandler = { type: 'command', command: 'echo plain' };

    const result = await executeHook(handler, input);

    expect(result).toEqual({ action: 'allow' });
  });

  it('reports an error without blocking on other exit codes', async () => {
    const handler: CommandHandler = { type: 'command', command: "echo 'boom' >&2; exit 1" };

    const result = await executeHook(handler, input);

    expect(result.action).toBe('error');
  });

  it('passes the hook input as JSON on stdin', async () => {
    const handler: CommandHandler = {
      type: 'command',
      command: 'grep -q \'"hook_event_name":"PreToolUse"\' && echo ok',
    };

    const result = await executeHook(handler, input);

    expect(result.action).toBe('allow');
  });

  it('reports a spawn error without throwing', async () => {
    const handler: CommandHandler = { type: 'command', command: 'no-such-binary-xyz' };

    const result = await executeHook(handler, input);

    expect(result.action).toBe('error');
  });
});

describe('executeHook with http handler', () => {
  it('posts the input JSON and parses the JSON response', async () => {
    let received: { body: string; headers: Record<string, string> } | undefined;
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on('end', () => {
        received = {
          body,
          headers: { type: request.headers['content-type'] ?? '' },
        };
        response.setHeader('Content-Type', 'application/json');
        response.end('{"decision":"block","reason":"policy"}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const result = await executeHook({ type: 'http', url: `http://127.0.0.1:${port}` }, input);

      expect(result).toMatchObject({ action: 'block', reason: 'policy' });
      expect(received?.headers.type).toBe('application/json');
      expect(JSON.parse(received?.body ?? '{}')).toMatchObject({ session_id: 'ses_1' });
    } finally {
      server.close();
    }
  });

  it('reports an error for a non-2xx response', async () => {
    const server = createServer((_request, response) => {
      response.statusCode = 500;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const result = await executeHook({ type: 'http', url: `http://127.0.0.1:${port}` }, input);

      expect(result.action).toBe('error');
    } finally {
      server.close();
    }
  });

  it('reports an error when the server is unreachable', async () => {
    const result = await executeHook({ type: 'http', url: 'http://127.0.0.1:1' }, input);

    expect(result.action).toBe('error');
  });
});

describe('executeHook with prompt/agent handlers', () => {
  it('replaces $ARGUMENTS with the input JSON and parses the model output', async () => {
    const generate = vi
      .fn<(prompt: string) => Promise<string>>()
      .mockResolvedValue('{"hookSpecificOutput":{"additionalContext":"model note"}}');

    const result = await executeHook(
      { type: 'prompt', prompt: 'Check $ARGUMENTS' },
      input,
      generate,
    );

    expect(result).toMatchObject({ action: 'allow', additionalContext: 'model note' });
    expect(generate).toHaveBeenCalledWith(expect.stringContaining('"session_id":"ses_1"'));
  });

  it('errors when no model generation is available', async () => {
    const result = await executeHook({ type: 'prompt', prompt: 'x' }, input);

    expect(result.action).toBe('error');
  });

  it('errors when generation rejects', async () => {
    const generate = vi
      .fn<(prompt: string) => Promise<string>>()
      .mockRejectedValue(new Error('model down'));

    const result = await executeHook({ type: 'agent', prompt: 'x' }, input, generate);

    expect(result.action).toBe('error');
  });

  it('errors on prompt timeout', async () => {
    const generate = vi
      .fn<(prompt: string) => Promise<string>>()
      .mockImplementation(() => new Promise<string>(() => {}));

    const result = await executeHook({ type: 'prompt', prompt: 'x', timeout: 1 }, input, generate);

    expect(result.action).toBe('error');
  });
});
