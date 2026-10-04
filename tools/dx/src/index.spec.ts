import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { app } from './index.js';

const execFileAsync = promisify(execFile);

const DX_ROOT = resolve(import.meta.dirname, '..');
const ENTRY = join(DX_ROOT, 'index.ts');

/**
 * Chạy CLI trong một tiến trình con.
 *
 * Tiến trình cha đã nạp module này rồi, nên một kiểm tra trong cùng tiến trình sẽ
 * không chứng minh được điều gì về phân tích argument hay cách nối `runMain`.
 * citty ghi usage ra stderr, nên cả hai stream đều được đọc.
 */
async function dx(...args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync('node', [
    join(DX_ROOT, '../../node_modules/tsx/dist/cli.mjs'),
    ENTRY,
    ...args,
  ]);

  return `${stdout}${stderr}`;
}

describe('app', () => {
  it('names itself', () => {
    // citty định kiểu `meta` là resolvable, nhưng một object thuần vẫn là giá trị
    // hợp lệ cho nó — bóc kiểu ra thay vì gọi nó.
    const meta = app.meta as { name?: string; description?: string };

    expect(meta.name).toBe('Ecoma DX');
    expect(meta.description).toBe('Devtools for ecoma-io repository');
  });

  it('declares repo-prepare, gen-claude-md and pr-check', () => {
    // Set thay cho mảng sort: cùng đẳng thức tập hợp, không mutation và không
    // cần `toSorted` (lib của repository hiện là es2022).
    expect(new Set(Object.keys(app.subCommands ?? {}))).toEqual(
      new Set(['repo-prepare', 'gen-claude-md', 'pr-check']),
    );
  });

  it('resolves each subcommand to a command definition, not a module namespace', async () => {
    // citty cần định nghĩa; `import()` trả về `{ default }`. Một namespace chưa bóc
    // type-check dưới `any` được nhưng lại fail lúc dispatch.
    for (const [, load] of Object.entries(app.subCommands ?? {})) {
      const resolved = await (load as () => Promise<unknown>)();
      expect(resolved).toHaveProperty('meta');
      expect(resolved).toHaveProperty('run');
    }
  });
});

describe('dx cli', () => {
  it('does nothing when no subcommand is given', async () => {
    // `run()` trần là một no-op có chủ đích, nên bản thân `dx` im lặng và exit 0.
    // Usage chỉ hiện ra sau --help.
    await expect(dx()).resolves.toBe('');
  });

  it('lists every subcommand in help', async () => {
    const output = await dx('--help');

    expect(output).toContain('Ecoma DX');
    expect(output).toContain('repo-prepare');
    expect(output).toContain('gen-claude-md');
    expect(output).toContain('pr-check');
  });

  it('describes each subcommand', async () => {
    expect(await dx('repo-prepare', '--help')).toContain('Prepare repository');
    expect(await dx('gen-claude-md', '--help')).toContain('Generate Claude.md');
    expect(await dx('pr-check', '--help')).toContain('Check a pull request');
  });
});
