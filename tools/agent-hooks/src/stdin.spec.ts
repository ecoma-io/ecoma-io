import { afterEach, describe, expect, it, vi } from 'vitest';

import { readHookPayload } from './stdin';

const readFileSync = vi.hoisted(() => vi.fn<(fd: number, encoding: string) => string>());

vi.mock('node:fs', () => ({ readFileSync }));

afterEach(() => {
  vi.clearAllMocks();
});

describe('readHookPayload', () => {
  it('reads fd 0 (stdin) with utf8 and parses a valid JSON object', async () => {
    readFileSync.mockReturnValue('{"tool_input":{"file_path":"a.ts"},"tool_name":"Edit"}');

    const payload = await readHookPayload();

    expect(readFileSync).toHaveBeenCalledWith(0, 'utf8');
    expect(payload).toEqual({ tool_input: { file_path: 'a.ts' }, tool_name: 'Edit' });
  });

  it('returns empty object for invalid JSON', async () => {
    readFileSync.mockReturnValue('not json');

    expect(await readHookPayload()).toEqual({});
  });

  it('returns empty object for a non-object JSON value', async () => {
    readFileSync.mockReturnValue('[1,2]');

    expect(await readHookPayload()).toEqual({});
  });

  it('returns empty object when the read throws (closed stdin)', async () => {
    readFileSync.mockImplementation(() => {
      throw new Error('EBADF');
    });

    expect(await readHookPayload()).toEqual({});
  });
});
