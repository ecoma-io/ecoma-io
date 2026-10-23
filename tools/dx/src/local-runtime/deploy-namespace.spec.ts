import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  dockerResourceName,
  NAMESPACE_LENGTH,
  normalizeWorktreeRoot,
  pulumiStackName,
  worktreeNamespace,
} from './deploy-namespace.js';

/** Fixture worktree thật trên đĩa để realpath có cái mà resolve. */
const fixtures: string[] = [];

function makeFixture(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ns-fixture-${name}-`));
  fixtures.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

describe('normalizeWorktreeRoot', () => {
  it('trả về đường dẫn tuyệt đối đã realpath cho một thư mục có thật', () => {
    const dir = makeFixture('abs');
    expect(normalizeWorktreeRoot(dir)).toBe(dir);
  });

  it('resolve symlink về thư mục thật — hai đường dẫn trỏ cùng một đích ra MỘT kết quả', () => {
    const dir = makeFixture('real');
    const link = makeFixture('link');
    const linkPath = join(link, 'symlink');
    symlinkSync(dir, linkPath, 'dir');
    expect(normalizeWorktreeRoot(linkPath)).toBe(dir);
  });

  it('bỏ trailing separator và bỏ qua thành phần `.`', () => {
    const dir = makeFixture('slash');
    expect(normalizeWorktreeRoot(`${dir}/`)).toBe(dir);
    expect(normalizeWorktreeRoot(`${dir}/./`)).toBe(dir);
  });
});

describe('worktreeNamespace', () => {
  it('ổn định: cùng một normalized root luôn ra cùng một namespace', () => {
    const dir = makeFixture('stable');
    expect(worktreeNamespace(dir)).toBe(worktreeNamespace(dir));
  });

  it('ổn định qua trình bày khác nhau của cùng một root (`.`, trailing slash)', () => {
    const dir = makeFixture('stable2');
    expect(worktreeNamespace(`${dir}/.`)).toBe(worktreeNamespace(dir));
  });

  it('hai worktree root khác nhau ra hai namespace khác nhau', () => {
    const a = worktreeNamespace(makeFixture('one'));
    const b = worktreeNamespace(makeFixture('two'));
    expect(a).not.toBe(b);
  });

  it('đúng hình dạng: `w` + đúng NAMESPACE_LENGTH ký tự hex', () => {
    const ns = worktreeNamespace(makeFixture('shape'));
    expect(ns).toMatch(new RegExp(`^w[0-9a-f]{${NAMESPACE_LENGTH}}$`, 'u'));
  });
});

describe('dockerResourceName', () => {
  const ns = 'wabcdef123456';

  it('ghép prefix + namespace + kind theo đúng hình dạng', () => {
    expect(dockerResourceName(ns, 'network')).toBe(`ecoma-${ns}-network`);
    expect(dockerResourceName(ns, 'postgres-volume')).toBe(`ecoma-${ns}-postgres-volume`);
  });

  it('chứa namespace — hai worktree không trùng tên resource', () => {
    const a = dockerResourceName('w000000000001', 'traefik');
    const b = dockerResourceName('w000000000002', 'traefik');
    expect(a).not.toBe(b);
  });

  it('từ chối namespace không hợp lệ cho Docker name', () => {
    expect(() => dockerResourceName('W_UPPER', 'network')).toThrow(/namespace không hợp lệ/u);
    expect(() => dockerResourceName('', 'network')).toThrow(/namespace không hợp lệ/u);
    expect(() => dockerResourceName('has space', 'network')).toThrow(/namespace không hợp lệ/u);
  });
});

describe('pulumiStackName', () => {
  it('mỗi namespace một stack riêng — hai worktree không dùng chung state', () => {
    expect(pulumiStackName('w000000000001')).toBe('local-w000000000001');
    expect(pulumiStackName('w000000000002')).toBe('local-w000000000002');
  });

  it('ổn định qua các lần gọi', () => {
    expect(pulumiStackName('wabcdef123456')).toBe(pulumiStackName('wabcdef123456'));
  });
});

describe('isolation trên fixture thật — hai thư mục khác nhau', () => {
  it('namespace, docker name và stack của hai fixture khác nhau toàn bộ', () => {
    const dirA = makeFixture('iso-a');
    const dirB = makeFixture('iso-b');
    writeFileSync(join(dirA, 'marker.txt'), 'a');
    mkdirSync(join(dirB, 'sub'), { recursive: true });

    const nsA = worktreeNamespace(dirA);
    const nsB = worktreeNamespace(dirB);

    expect(nsA).not.toBe(nsB);
    expect(dockerResourceName(nsA, 'home')).not.toBe(dockerResourceName(nsB, 'home'));
    expect(pulumiStackName(nsA)).not.toBe(pulumiStackName(nsB));
  });
});
