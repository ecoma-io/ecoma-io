import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { genClaudeMD } from './gen-claude-md.js';

/** Dựng một cây thư mục tạm để vứt đi; caller tự đặt tên ngay tại chỗ. */
async function tree(shape: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dx-gen-'));

  for (const [relativePath, contents] of Object.entries(shape)) {
    const full = join(root, relativePath);
    if (relativePath.endsWith('/')) {
      await mkdir(full, { recursive: true });
    } else {
      await mkdir(join(full, '..'), { recursive: true });
      await writeFile(full, contents, 'utf8');
    }
  }

  return root;
}

describe('genClaudeMD', () => {
  const created: string[] = [];

  const make = async (shape: Record<string, string>) => {
    const root = await tree(shape);
    created.push(root);
    return root;
  };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('creates CLAUDE.md for a directory that has only AGENTS.md', async () => {
    const root = await make({ 'svc/AGENTS.md': 'rules\n' });

    await genClaudeMD(root);

    expect(existsSync(join(root, 'svc/CLAUDE.md'))).toBe(true);
  });

  it('points CLAUDE.md at AGENTS.md so one file stays the source of truth', async () => {
    const root = await make({ 'svc/AGENTS.md': 'rules\n' });

    await genClaudeMD(root);

    const { readFile } = await import('node:fs/promises');
    expect(await readFile(join(root, 'svc/CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');
  });

  it('never overwrites an existing CLAUDE.md', async () => {
    const root = await make({
      'svc/AGENTS.md': 'rules\n',
      'svc/CLAUDE.md': 'hand written\n',
    });

    await genClaudeMD(root);

    const { readFile } = await import('node:fs/promises');
    expect(await readFile(join(root, 'svc/CLAUDE.md'), 'utf8')).toBe('hand written\n');
  });

  it('creates nothing in a directory with no AGENTS.md', async () => {
    const root = await make({ 'svc/README.md': 'docs\n' });

    await genClaudeMD(root);

    expect(existsSync(join(root, 'svc/CLAUDE.md'))).toBe(false);
  });

  it('descends into nested directories', async () => {
    const root = await make({ 'a/b/c/AGENTS.md': 'deep\n' });

    await genClaudeMD(root);

    expect(existsSync(join(root, 'a/b/c/CLAUDE.md'))).toBe(true);
  });

  it('walks the same tree twice without failing', async () => {
    const root = await make({ 'svc/AGENTS.md': 'rules\n' });

    await genClaudeMD(root);
    await expect(genClaudeMD(root)).resolves.toBeUndefined();
  });
});

describe('genClaudeMD respects .gitignore', () => {
  const created: string[] = [];

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  /** Một repository thật, vì lệnh kiểm tra ignore gọi shell tới git. */
  async function repo(shape: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'dx-ignore-'));
    created.push(root);

    for (const [relativePath, contents] of Object.entries(shape)) {
      const full = join(root, relativePath);
      await mkdir(join(full, '..'), { recursive: true });
      await writeFile(full, contents, 'utf8');
    }

    execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });

    return root;
  }

  it('skips a gitignored directory', async () => {
    const root = await repo({
      '.gitignore': 'build/\n',
      'build/AGENTS.md': 'generated\n',
      'src/AGENTS.md': 'real\n',
    });

    await genClaudeMD(root);

    expect(existsSync(join(root, 'build/CLAUDE.md'))).toBe(false);
    expect(existsSync(join(root, 'src/CLAUDE.md'))).toBe(true);
  });

  it('skips a gitignored file pattern inside a tracked directory', async () => {
    const root = await repo({
      '.gitignore': '*.tmp.md\n',
      'notes.tmp.md': 'scratch\n',
      'notes/AGENTS.md': 'real\n',
    });

    await genClaudeMD(root);

    expect(existsSync(join(root, 'notes/CLAUDE.md'))).toBe(true);
  });
});
