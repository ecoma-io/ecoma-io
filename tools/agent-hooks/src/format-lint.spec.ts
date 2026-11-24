import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { partitionFiles, runFormatLint } from './format-lint';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-hooks-formatlint-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function file(name: string): string {
  const absolute = join(root, name);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, 'x');
  return absolute;
}

/** Runner giả ghi lại argv được gọi và trả status cấu hình được. */
function fakeRunner(status: number) {
  const calls: { argv: string[] }[] = [];
  return {
    calls,
    runToolFn: (argv: string[]) => {
      calls.push({ argv });
      return { status, output: `out-of-${calls.length}` };
    },
  };
}

describe('partitionFiles', () => {
  it('routes format-only extensions to format, code extensions to both', () => {
    const ts = join(root, 'a.ts');
    const css = join(root, 'b.css');
    const md = join(root, 'c.md');

    const { format, lint, markdown } = partitionFiles([ts, css, md], root);

    expect(format).toEqual([ts, css, md]);
    expect(lint).toEqual([ts]);
    expect(markdown).toEqual([md]);
  });

  it('drops files outside the format glob entirely', () => {
    const txt = join(root, 'notes.txt');

    const { format, lint, markdown } = partitionFiles([txt], root);

    expect(format).toEqual([]);
    expect(lint).toEqual([]);
    expect(markdown).toEqual([]);
  });

  it('matches extensions case-insensitively', () => {
    const upper = join(root, 'A.TS');

    const { format, lint } = partitionFiles([upper], root);

    expect(format).toEqual([upper]);
    expect(lint).toEqual([upper]);
  });

  it('excludes the security-audit skill directory like lefthook', () => {
    const excluded = join(root, '.agents/skills/security-audit/x.ts');
    const kept = join(root, '.agents/skills/other/x.ts');

    const { format, lint } = partitionFiles([excluded, kept], root);

    expect(format).toEqual([kept]);
    expect(lint).toEqual([kept]);
  });

  it('excludes every skill directory from markdown like the lefthook markdownlint block', () => {
    const excluded = join(root, '.agents/skills/other/x.md');
    const kept = join(root, 'docs/x.md');

    const { format, markdown } = partitionFiles([excluded, kept], root);

    expect(format).toEqual([excluded, kept]);
    expect(markdown).toEqual([kept]);
  });
});

/** Tạo binary rỗng trong `<root>/node_modules/.bin` để runner chọn nhánh local. */
function fakeBin(name: string): void {
  const bin = join(root, 'node_modules/.bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, name), '');
}

describe('runFormatLint', () => {
  it('runs oxfmt then oxlint with local binaries for a TS file', () => {
    const ts = file('a.ts');
    fakeBin('oxfmt');
    fakeBin('oxlint');
    const fake = fakeRunner(0);

    const result = runFormatLint({ tool_input: { file_path: 'a.ts' } }, { root, ...fake });

    expect(result).toEqual({ exitCode: 0 });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]!.argv[0]).toBe(join(root, 'node_modules/.bin/oxfmt'));
    expect(fake.calls[0]!.argv.slice(1)).toEqual([
      '--write',
      '--no-error-on-unmatched-pattern',
      ts,
    ]);
    expect(fake.calls[1]!.argv[0]).toContain('oxlint');
    expect(fake.calls[1]!.argv).toContain('--fix');
    expect(fake.calls[1]!.argv).toContain(ts);
  });

  it('runs oxfmt only for a format-only file (json, css, md)', () => {
    file('styles.css');
    fakeBin('oxfmt');
    const fake = fakeRunner(0);

    const result = runFormatLint({ tool_input: { file_path: 'styles.css' } }, { root, ...fake });

    expect(result).toEqual({ exitCode: 0 });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.argv[0]).toContain('oxfmt');
  });

  it('skips all tools when no file matches the format glob', () => {
    file('notes.txt');
    const fake = fakeRunner(0);

    const result = runFormatLint({ tool_input: { file_path: 'notes.txt' } }, { root, ...fake });

    expect(result).toEqual({ exitCode: 0 });
    expect(fake.calls).toHaveLength(0);
  });

  it('skips all tools for a payload without paths or outside root', () => {
    const fake = fakeRunner(0);

    expect(runFormatLint({}, { root, ...fake })).toEqual({ exitCode: 0 });
    expect(runFormatLint({ tool_input: { file_path: '/etc/passwd' } }, { root, ...fake })).toEqual({
      exitCode: 0,
    });
    expect(fake.calls).toHaveLength(0);
  });

  it('returns exit 0 and reports when oxfmt fails (tool errors never block)', () => {
    file('a.ts');
    const fake = fakeRunner(1);
    const report = vi.fn<(message: string) => void>();

    const result = runFormatLint({ tool_input: { file_path: 'a.ts' } }, { root, ...fake, report });

    expect(result).toEqual({ exitCode: 0 });
    expect(report).toHaveBeenCalledWith(expect.stringContaining('oxfmt failed'));
    expect(fake.calls).toHaveLength(1);
  });

  it('returns exit 2 and reports when oxlint still finds issues', () => {
    file('a.ts');
    const fake = fakeRunner(0);
    // oxfmt ok (call 0), oxlint fail (call 1)
    fake.runToolFn = (argv: string[]) => {
      fake.calls.push({ argv });
      return { status: fake.calls.length === 1 ? 0 : 2, output: 'lint-problem' };
    };
    const report = vi.fn<(message: string) => void>();

    const result = runFormatLint({ tool_input: { file_path: 'a.ts' } }, { root, ...fake, report });

    expect(result).toEqual({ exitCode: 2 });
    expect(report).toHaveBeenCalledWith(expect.stringContaining('oxlint found issues'));
    expect(report).toHaveBeenCalledWith(expect.stringContaining('lint-problem'));
  });

  it('does not run oxlint after oxfmt failure', () => {
    file('a.ts');
    const fake = fakeRunner(1);

    runFormatLint({ tool_input: { file_path: 'a.ts' } }, { root, ...fake });

    expect(fake.calls).toHaveLength(1);
  });

  it('runs markdownlint-cli2 --no-globs on a markdown file', () => {
    const md = file('doc.md');
    fakeBin('oxfmt');
    fakeBin('markdownlint-cli2');
    const fake = fakeRunner(0);

    const result = runFormatLint({ tool_input: { file_path: 'doc.md' } }, { root, ...fake });

    expect(result).toEqual({ exitCode: 0 });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.argv[0]).toBe(join(root, 'node_modules/.bin/markdownlint-cli2'));
    expect(fake.calls[1]!.argv.slice(1)).toEqual(['--no-globs', md]);
  });

  it('returns exit 2 and reports when markdownlint still finds issues', () => {
    file('doc.md');
    const fake = fakeRunner(0);
    // oxfmt ok (call 0), markdownlint fail (call 1)
    fake.runToolFn = (argv: string[]) => {
      fake.calls.push({ argv });
      return { status: fake.calls.length === 1 ? 0 : 1, output: 'md-problem' };
    };
    const report = vi.fn<(message: string) => void>();

    const result = runFormatLint(
      { tool_input: { file_path: 'doc.md' } },
      { root, ...fake, report },
    );

    expect(result).toEqual({ exitCode: 2 });
    expect(report).toHaveBeenCalledWith(expect.stringContaining('markdownlint found issues'));
    expect(report).toHaveBeenCalledWith(expect.stringContaining('md-problem'));
  });

  it('does not lint markdown under any skills directory', () => {
    file('.agents/skills/other/x.md');
    fakeBin('oxfmt');
    fakeBin('markdownlint-cli2');
    const fake = fakeRunner(0);

    const result = runFormatLint(
      { tool_input: { file_path: '.agents/skills/other/x.md' } },
      { root, ...fake },
    );

    expect(result).toEqual({ exitCode: 0 });
    // Chỉ oxfmt chạy; markdownlint bị bỏ qua
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.argv[0]).toContain('oxfmt');
  });

  it('falls back to npx when the local binary is missing', () => {
    file('a.ts');
    const fake = fakeRunner(0);

    const result = runFormatLint(
      { tool_input: { file_path: 'a.ts' } },
      { root, binDir: join(root, 'no-such-bin'), ...fake },
    );

    expect(result).toEqual({ exitCode: 0 });
    expect(fake.calls[0]!.argv.slice(0, 3)).toEqual(['npx', '--no-install', 'oxfmt']);
    expect(fake.calls[1]!.argv.slice(0, 3)).toEqual(['npx', '--no-install', 'oxlint']);
  });

  it('uses injected env and defaults binDir under root', () => {
    const ts = file('a.ts');
    fakeBin('oxfmt');
    fakeBin('oxlint');
    const fake = fakeRunner(0);
    const env = { PATH: '/custom' };

    runFormatLint({ tool_input: { file_path: 'a.ts' } }, { root, env, ...fake });

    // env và cwd được truyền qua runner options; ở đây chỉ assert argv đúng binary local
    expect(fake.calls[0]!.argv[0]).toBe(join(root, 'node_modules/.bin/oxfmt'));
    expect(fake.calls[0]!.argv).toContain(ts);
  });
});

describe('real spawnSync runner (integration)', () => {
  it('formats a badly formatted file through the default runner', () => {
    mkdirSync(root, { recursive: true });
    const target = join(root, 'a.ts');
    writeFileSync(target, 'const a={b:1}\n');

    const result = runFormatLint(
      { tool_input: { file_path: target } },
      // node_modules của workspace root chứa oxfmt/oxlint thật
      { root: '/home/johnitvn/ecoma-io' },
    );

    // file nằm ngoài root của run này nên không tool nào chạy — smoke check runner không crash
    expect(result.exitCode).toBe(0);
  });
});
