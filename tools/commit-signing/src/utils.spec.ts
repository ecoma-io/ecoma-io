import { execSync, type ExecSyncOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ROOT_DIR, gitEnv, runCommand } from './utils.js';

// Mock bằng đúng specifier mà utils.ts import, để cả hai resolve về cùng một
// Module id thay vì resolve lẫn nhau qua normalization của Vitest.
vi.mock(import('node:child_process'), () => ({
  // Mock của vitest làm phẳng overload của `execSync` thành một chữ ký, mà bốn
  // Overload gốc đòi hai kiểu trả về khác nhau; trả về `any` là cách duy nhất
  // Mock thỏa được mọi overload, còn assert vẫn qua `vi.mocked`.
  execSync: vi.fn<(command: string, options?: ExecSyncOptions) => any>(),
}));

const execSyncMock = vi.mocked(execSync);

describe('ROOT_DIR', () => {
  it('points at the directory holding tools/commit-signing', () => {
    expect.hasAssertions();
    // Canh chừng lần nhảy `../../..`: lệch đúng một cấp sẽ rơi vào tools/, vốn vẫn
    // Tồn tại và sẽ âm thầm khiến mọi command chạy sai chỗ.
    expect(existsSync(join(ROOT_DIR, 'tools/commit-signing'))).toBe(true);
  });

  it('is absolute, so callers never depend on the current directory', () => {
    expect.hasAssertions();
    expect(ROOT_DIR).toBe(resolve(ROOT_DIR));
  });
});

describe('runCommand', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>, exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    execSyncMock.mockReset();
    execSyncMock.mockReturnValue('');
    errorSpy = vi.spyOn(console, 'error').mockReturnValue();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      /* Empty */
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs in the repository root, not the caller directory', () => {
    expect.hasAssertions();
    runCommand('pnpm exec lefthook install');

    expect(execSyncMock).toHaveBeenCalledWith('pnpm exec lefthook install', {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
  });

  it('passes caller options through', () => {
    expect.hasAssertions();
    runCommand('lefthook install', { stdio: 'ignore' });

    expect(execSyncMock).toHaveBeenCalledWith('lefthook install', {
      cwd: ROOT_DIR,
      stdio: 'ignore',
    });
  });

  it('stays quiet and keeps going when the command succeeds', () => {
    expect.hasAssertions();
    runCommand('ok');

    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('reports the failing command and exits non-zero', () => {
    expect.hasAssertions();
    execSyncMock.mockImplementation(() => {
      throw new Error('boom');
    });

    runCommand('pnpm exec lefthook install');

    expect(errorSpy).toHaveBeenCalledWith('Command failed: pnpm exec lefthook install');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('gitEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('keeps every variable that is not part of the GIT_* family', () => {
    expect.hasAssertions();
    process.env.PATH = '/usr/bin';
    process.env.HOME = '/home/dx';

    const env = gitEnv();

    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/dx');
  });

  it('drops every GIT_* variable, not just the four the hooks export', () => {
    expect.hasAssertions();
    process.env.GIT_DIR = '/workspace/.git';
    process.env.GIT_WORK_TREE = '/workspace';
    process.env.GIT_INDEX_FILE = '/workspace/.git/index';
    process.env.GIT_COMMON_DIR = '/workspace/.git';
    process.env.GIT_OBJECT_DIRECTORY = '/workspace/.git/objects';
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CEILING_DIRECTORIES = '/home';
    process.env.GIT_NAMESPACE = 'ns';

    const env = gitEnv();

    expect(Object.keys(env).filter((key) => key.startsWith('GIT_'))).toStrictEqual([]);
  });

  it('does not mutate the parent environment', () => {
    expect.hasAssertions();
    process.env.GIT_DIR = '/workspace/.git';

    gitEnv();

    expect(process.env.GIT_DIR).toBe('/workspace/.git');
  });
});
