import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { extractHookFiles, rawPathsFromToolInput } from './payload';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-hooks-payload-'));
  // subdir để kiểm tra file nằm sâu trong root vẫn được nhận
  mkdirSync(join(root, 'src'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function file(name: string, directory = ''): string {
  const absolute = join(root, directory, name);
  writeFileSync(absolute, 'x');
  return absolute;
}

describe('rawPathsFromToolInput', () => {
  it('collects single-path fields from all known aliases', () => {
    const raw = rawPathsFromToolInput({
      path: 'a.ts',
      filePath: 'b.ts',
      file_path: 'c.ts',
    });

    expect(raw).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('collects strings and objects from files[] and edits[]', () => {
    const raw = rawPathsFromToolInput({
      files: ['f1.ts', { path: 'f2.ts' }, { filePath: 'f3.ts' }, 42, null],
      edits: [{ path: 'e1.ts' }, 'e2.ts'],
    });

    expect(raw).toEqual(['f1.ts', 'f2.ts', 'f3.ts', 'e1.ts', 'e2.ts']);
  });

  it('ignores non-string single fields and non-list arrays', () => {
    const raw = rawPathsFromToolInput({ path: 123, files: 'not-a-list', edits: { path: 'x' } });

    expect(raw).toEqual([]);
  });

  it('returns empty for null or missing tool_input', () => {
    expect(rawPathsFromToolInput(null)).toEqual([]);
    expect(rawPathsFromToolInput(undefined)).toEqual([]);
  });
});

describe('extractHookFiles', () => {
  it('resolves relative paths against root and keeps absolute ones', () => {
    const kept = file('a.ts', 'src');
    const absolute = file('b.ts');

    const files = extractHookFiles({ tool_input: { file_path: 'src/a.ts' } }, root);
    expect(files).toEqual([kept]);

    const files2 = extractHookFiles({ tool_input: { file_path: absolute } }, root);
    expect(files2).toEqual([absolute]);
  });

  it('skips files outside root, including .. escapes', () => {
    const outside = join(tmpdir(), `agent-hooks-outside-${Date.now()}.ts`);
    writeFileSync(outside, 'x');
    try {
      expect(extractHookFiles({ tool_input: { file_path: outside } }, root)).toEqual([]);
      expect(extractHookFiles({ tool_input: { file_path: '../package.json' } }, root)).toEqual([]);
    } finally {
      rmSync(outside);
    }
  });

  it('skips missing files and directories', () => {
    expect(extractHookFiles({ tool_input: { file_path: 'nope.ts' } }, root)).toEqual([]);
    expect(extractHookFiles({ tool_input: { file_path: 'src' } }, root)).toEqual([]);
  });

  it('deduplicates while preserving first-seen order', () => {
    const a = file('a.ts', 'src');
    const b = file('b.ts', 'src');

    const files = extractHookFiles(
      { tool_input: { files: ['src/a.ts', 'src/b.ts', 'src/a.ts'] } },
      root,
    );

    expect(files).toEqual([a, b]);
  });

  it('treats root itself as outside the kept set', () => {
    expect(extractHookFiles({ tool_input: { file_path: root } }, root)).toEqual([]);
  });

  it('returns empty for a payload without tool_input', () => {
    expect(extractHookFiles({}, root)).toEqual([]);
  });
});
