import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { app } from './index.js';

const execFileAsync = promisify(execFile);

const DX_ROOT = resolve(import.meta.dirname, '..');
const ENTRY = join(DX_ROOT, 'index.ts');
const TSX = join(DX_ROOT, '../../node_modules/tsx/dist/cli.mjs');

/**
 * Chạy CLI trong một tiến trình con.
 *
 * Tiến trình cha đã nạp module này rồi, nên một kiểm tra trong cùng tiến trình sẽ
 * không chứng minh được điều gì về phân tích argument hay cách nối `runMain`.
 * citty ghi usage ra stderr, nên cả hai stream đều được đọc.
 */
async function dx(...args: string[]): Promise<string> {
  return dxFrom(DX_ROOT, ...args);
}

/** Như `dx` nhưng chỉ định cả working directory của tiến trình con. */
async function dxFrom(cwd: string, ...args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync('node', [TSX, ENTRY, ...args], { cwd });

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

  it('declares repo-prepare, sync-agent-config and pr-check', () => {
    // Set thay cho mảng sort: cùng đẳng thức tập hợp, không mutation và không
    // cần `toSorted` (lib của repository hiện là es2022).
    expect(new Set(Object.keys(app.subCommands ?? {}))).toEqual(
      new Set(['repo-prepare', 'sync-agent-config', 'pr-check']),
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
    expect(output).toContain('sync-agent-config');
    expect(output).toContain('pr-check');
  });

  it('describes each subcommand', async () => {
    expect(await dx('repo-prepare', '--help')).toContain('Prepare repository');
    expect(await dx('sync-agent-config', '--help')).toContain('Sync agent configuration');
    expect(await dx('pr-check', '--help')).toContain('Check a pull request');
  });

  it('runs sync-agent-config from a working directory other than the repository root', async () => {
    // Đường dẫn tới module và tới `tsx` được resolve từ vị trí file này, còn
    // tiến trình con chạy ở một chỗ hoàn toàn khác — nên một lần gọi thành công
    // chứng minh command không phụ thuộc vào cwd của caller.
    const output = await dxFrom(tmpdir(), 'sync-agent-config', '--help');

    expect(output).toContain('Sync agent configuration');
  });
});
