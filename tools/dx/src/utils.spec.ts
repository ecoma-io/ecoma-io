import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ROOT_DIR, runCommand } from './utils.js';

// Mock bằng đúng specifier mà utils.ts import, để cả hai resolve về cùng một
// module id thay vì resolve lẫn nhau qua normalization của Vitest.
vi.mock('node:child_process', () => ({ execSync: vi.fn<typeof execSync>() }));

const execSyncMock = vi.mocked(execSync);

describe('ROOT_DIR', () => {
  it('points at the directory holding tools/dx', () => {
    // Canh chừng lần nhảy `../../..`: lệch đúng một cấp sẽ rơi vào tools/, vốn vẫn
    // tồn tại và sẽ âm thầm khiến mọi command chạy sai chỗ.
    expect(existsSync(join(ROOT_DIR, 'tools/dx'))).toBe(true);
  });

  it('is absolute, so callers never depend on the current directory', () => {
    expect(ROOT_DIR).toBe(resolve(ROOT_DIR));
  });
});

describe('runCommand', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    execSyncMock.mockReset();
    execSyncMock.mockReturnValue('' as unknown as ReturnType<typeof execSync>);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs in the repository root, not the caller directory', () => {
    runCommand('pnpm exec lefthook install');

    expect(execSyncMock).toHaveBeenCalledWith('pnpm exec lefthook install', {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
  });

  it('passes caller options through', () => {
    runCommand('lefthook install', { stdio: 'ignore' });

    expect(execSyncMock).toHaveBeenCalledWith('lefthook install', {
      cwd: ROOT_DIR,
      stdio: 'ignore',
    });
  });

  it('stays quiet and keeps going when the command succeeds', () => {
    runCommand('ok');

    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('reports the failing command and exits non-zero', () => {
    execSyncMock.mockImplementation(() => {
      throw new Error('boom');
    });

    runCommand('pnpm exec lefthook install');

    expect(errorSpy).toHaveBeenCalledWith('Command failed: pnpm exec lefthook install');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
