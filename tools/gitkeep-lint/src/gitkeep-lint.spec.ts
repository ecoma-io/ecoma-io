import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  checkGitkeepFiles,
  collectGitkeepFiles,
  findRepositoryGitkeepFiles,
  ROOT_DIR,
} from './gitkeep-lint';

describe('gitkeep-lint', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gitkeep-lint-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('collectGitkeepFiles', () => {
    it('collects nested .gitkeep files under a directory target', () => {
      mkdirSync(join(root, 'a/deep'), { recursive: true });
      writeFileSync(join(root, 'a/.gitkeep'), '');
      writeFileSync(join(root, 'a/deep/.gitkeep'), '');
      writeFileSync(join(root, 'a/deep/other.ts'), '');

      expect(collectGitkeepFiles(root)).toEqual([
        join(root, 'a/.gitkeep'),
        join(root, 'a/deep/.gitkeep'),
      ]);
    });

    it('accepts a single .gitkeep file target', () => {
      mkdirSync(join(root, 'a'));
      writeFileSync(join(root, 'a/.gitkeep'), '');

      expect(collectGitkeepFiles(join(root, 'a/.gitkeep'))).toEqual([join(root, 'a/.gitkeep')]);
    });

    it('ignores a missing .gitkeep (staged deletion) but rejects other missing paths', () => {
      expect(collectGitkeepFiles(join(root, 'gone/.gitkeep'))).toEqual([]);
      expect(() => collectGitkeepFiles(join(root, 'gone'))).toThrow('path does not exist');
    });

    it('rejects targets that are not .gitkeep files', () => {
      writeFileSync(join(root, 'index.ts'), '');

      expect(() => collectGitkeepFiles(join(root, 'index.ts'))).toThrow('not a .gitkeep file');
    });
  });

  describe('checkGitkeepFiles', () => {
    it('accepts a .gitkeep that is the only entry in its directory', () => {
      const keep = join(root, '.gitkeep');
      writeFileSync(keep, '');

      expect(checkGitkeepFiles([keep])).toEqual([]);
    });

    it('reports a .gitkeep next to any sibling file or directory', () => {
      mkdirSync(join(root, 'with-file'), { recursive: true });
      mkdirSync(join(root, 'with-dir'), { recursive: true });
      mkdirSync(join(root, 'with-dir/child'), { recursive: true });
      writeFileSync(join(root, 'with-file/.gitkeep'), '');
      writeFileSync(join(root, 'with-file/index.ts'), '');
      writeFileSync(join(root, 'with-dir/.gitkeep'), '');

      const violations = checkGitkeepFiles([
        join(root, 'with-dir/.gitkeep'),
        join(root, 'with-file/.gitkeep'),
      ]);
      expect(violations).toHaveLength(2);
      expect(violations[0]).toContain(join(root, 'with-dir/.gitkeep'));
      expect(violations[1]).toContain('with-file/.gitkeep: directory is not empty (index.ts)');
    });
  });

  describe('findRepositoryGitkeepFiles', () => {
    it('lists tracked and untracked .gitkeep files of the working tree', () => {
      execFileSync('git', ['init', join(root, 'repo')]);
      mkdirSync(join(root, 'repo/empty/nested'), { recursive: true });
      mkdirSync(join(root, 'repo/full'), { recursive: true });
      writeFileSync(join(root, 'repo/empty/nested/.gitkeep'), '');
      writeFileSync(join(root, 'repo/full/.gitkeep'), '');
      writeFileSync(join(root, 'repo/full/index.ts'), '');

      const keeps = findRepositoryGitkeepFiles(join(root, 'repo'));
      expect(keeps.filter((keep) => keep.startsWith(join(root, 'repo')))).toEqual([
        join(root, 'repo/empty/nested/.gitkeep'),
        join(root, 'repo/full/.gitkeep'),
      ]);
    });
  });

  it('resolves ROOT_DIR to the repository root', () => {
    expect(ROOT_DIR).toBe(resolve(import.meta.dirname, '../../..'));
    expect(existsSync(join(ROOT_DIR, 'package.json'))).toBe(true);
  });
});
