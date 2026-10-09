import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syncAgentConfig } from './sync-agent-config.js';
import { ROOT_DIR } from './utils.js';

/**
 * Mọi cây thư mục test đều là một git repository thật (`git init`), vì
 * `syncAgentConfig` resolve repo root và gọi `git check-ignore` qua shell.
 */
async function repo(shape: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dx-sync-'));

  for (const [relativePath, contents] of Object.entries(shape)) {
    const full = join(root, relativePath);

    if (relativePath.endsWith('/')) {
      await mkdir(full, { recursive: true });
    } else {
      await mkdir(join(full, '..'), { recursive: true });
      await writeFile(full, contents, 'utf8');
    }
  }

  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });

  return root;
}

async function makeDir(path: string): Promise<string> {
  await mkdir(path, { recursive: true });

  return path;
}

const roots: string[] = [];
const extraDirs: string[] = [];
const logs: string[] = [];

/** Dựng repo và ghi nhớ để dọn ở afterEach. */
async function makeRepo(shape: Record<string, string>): Promise<string> {
  const root = await repo(shape);
  roots.push(root);

  return root;
}

async function makeTempDir(prefix = 'dx-sync-out-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  extraDirs.push(dir);

  return dir;
}

/**
 * Mọi đường dẫn tương đối bên trong `root`, trừ `.git`.
 *
 * Trả về dạng object để có thể `toEqual` theo nội dung bất kể thứ tự duyệt của
 * `readdir` — không cần sort (`.sort` bị linter cấm, `.toSorted` cần lib es2023
 * mà dx không dùng).
 */
async function listTree(root: string): Promise<Record<string, true>> {
  const found: Record<string, true> = {};

  const walk = async (dir: string, base: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (base === '' && entry.name === '.git') {
        continue;
      }

      const relativePath = base === '' ? entry.name : `${base}/${entry.name}`;
      found[relativePath] = true;

      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await walk(join(dir, entry.name), relativePath);
      }
    }
  };

  await walk(root, '');

  return found;
}

/**
 * Ảnh chụp trạng thái để so sánh giữa hai lần chạy: path, loại và mtime.
 *
 * Cũng là dạng object (không cần sort), kèm mtime để phát hiện file bị ghi lại.
 */
async function snapshot(root: string): Promise<Record<string, true>> {
  const lines: Record<string, true> = {};

  const walk = async (dir: string, base: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (base === '' && entry.name === '.git') {
        continue;
      }

      const relativePath = base === '' ? entry.name : `${base}/${entry.name}`;
      const full = join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        lines[`${relativePath} symlink`] = true;
        continue;
      }

      if (entry.isDirectory()) {
        lines[`${relativePath} dir`] = true;
        await walk(full, relativePath);
      } else {
        const info = await stat(full);
        lines[`${relativePath} file ${String(info.size)} ${String(info.mtimeMs)}`] = true;
      }
    }
  };

  await walk(root, '');

  return lines;
}

describe('syncAgentConfig - CLAUDE.md generation', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.map((value) => String(value)).join(' '));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    logs.splice(0);
    await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
    await Promise.all(extraDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('creates CLAUDE.md for every directory that has AGENTS.md but none yet', async () => {
    const root = await makeRepo({
      'svc/AGENTS.md': 'rules\n',
      'libs/a/b/AGENTS.md': 'deep\n',
      'docs/README.md': 'docs\n',
    });

    await syncAgentConfig(root);

    expect(existsSync(join(root, 'svc/CLAUDE.md'))).toBe(true);
    expect(existsSync(join(root, 'libs/a/b/CLAUDE.md'))).toBe(true);
    expect(existsSync(join(root, 'docs/CLAUDE.md'))).toBe(false);
  });

  it('points CLAUDE.md at AGENTS.md so one file stays the source of truth', async () => {
    const root = await makeRepo({ 'svc/AGENTS.md': 'rules\n' });

    await syncAgentConfig(root);

    expect(await readFile(join(root, 'svc/CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');
  });

  it('logs the created path relative to ROOT_DIR', async () => {
    const root = await makeRepo({ 'svc/AGENTS.md': 'rules\n' });

    await syncAgentConfig(root);

    expect(logs.some((line) => line.startsWith('created ') && line.endsWith('svc/CLAUDE.md'))).toBe(
      true,
    );
  });

  it('never overwrites an existing CLAUDE.md, including a hand-written one', async () => {
    const root = await makeRepo({
      'svc/AGENTS.md': 'rules\n',
      'svc/CLAUDE.md': 'hand written\n',
    });

    await syncAgentConfig(root);

    expect(await readFile(join(root, 'svc/CLAUDE.md'), 'utf8')).toBe('hand written\n');
  });

  it('does not write through a symlinked CLAUDE.md that points at AGENTS.md', async () => {
    const root = await makeRepo({ 'svc/AGENTS.md': 'rules\n' });
    await symlink('AGENTS.md', join(root, 'svc', 'CLAUDE.md'));

    await syncAgentConfig(root);

    // Nguồn sự thật không được phép bị ghi đè qua symlink.
    expect(await readFile(join(root, 'svc', 'AGENTS.md'), 'utf8')).toBe('rules\n');
    expect(await readFile(join(root, 'svc', 'CLAUDE.md'), 'utf8')).toBe('rules\n');
    expect(logs.some((line) => line.startsWith('created '))).toBe(false);
  });

  it('does not write through a symlinked CLAUDE.md that escapes the repository', async () => {
    const root = await makeRepo({ 'svc/AGENTS.md': 'rules\n' });
    const outside = await makeTempDir();
    await writeFile(join(outside, 'outside.txt'), 'precious\n', 'utf8');
    await symlink(join(outside, 'outside.txt'), join(root, 'svc', 'CLAUDE.md'));

    await syncAgentConfig(root);

    // Symlink trỏ ra ngoài repository: ghi qua nó sẽ sửa file ngoài repo.
    expect(await readFile(join(outside, 'outside.txt'), 'utf8')).toBe('precious\n');
    expect(logs.some((line) => line.startsWith('created '))).toBe(false);
  });
});

describe('syncAgentConfig - skills synchronization', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.map((value) => String(value)).join(' '));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    logs.splice(0);
    await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
    await Promise.all(extraDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('copies nested skills and their supporting resources, not only SKILL.md', async () => {
    const root = await makeRepo({
      '.agent/skills/demo/SKILL.md': '# demo\n',
      '.agent/skills/demo/references/notes.md': 'notes\n',
      '.agent/skills/demo/assets/logo.txt': 'logo\n',
      '.agent/skills/other/SKILL.md': '# other\n',
    });

    await syncAgentConfig(root);

    const dest = join(root, '.claude/skills');

    expect(await listTree(dest)).toEqual({
      demo: true,
      'demo/SKILL.md': true,
      'demo/assets': true,
      'demo/assets/logo.txt': true,
      'demo/references': true,
      'demo/references/notes.md': true,
      other: true,
      'other/SKILL.md': true,
    });
  });

  it('mirrors content exactly', async () => {
    const root = await makeRepo({
      '.agent/skills/demo/SKILL.md': '# demo\n',
      '.agent/skills/demo/references/notes.md': 'notes\n',
    });

    await syncAgentConfig(root);

    expect(await readFile(join(root, '.claude/skills/demo/references/notes.md'), 'utf8')).toBe(
      'notes\n',
    );
  });

  it('writes to the destination even though .claude/skills is gitignored', async () => {
    // Chỉ cây nguồn tôn trọng .gitignore; đích là output sinh tự động nên việc
    // nó bị bỏ qua không được chặn ghi.
    const root = await makeRepo({
      '.gitignore': '.claude/skills/\n',
      '.agent/skills/demo/SKILL.md': '# demo\n',
    });

    await syncAgentConfig(root);

    expect(existsSync(join(root, '.claude/skills/demo/SKILL.md'))).toBe(true);
  });

  it('updates changed files and removes stale destination files and directories', async () => {
    const root = await makeRepo({
      '.agent/skills/demo/SKILL.md': 'v1\n',
      '.agent/skills/demo/references/notes.md': 'notes\n',
    });

    await syncAgentConfig(root);

    // Đổi nội dung nguồn, bỏ một cây con, rồi bồi thêm entry thừa vào đích.
    await writeFile(join(root, '.agent/skills/demo/SKILL.md'), 'v2\n', 'utf8');
    await rm(join(root, '.agent/skills/demo/references'), { recursive: true, force: true });
    await makeDir(join(root, '.claude/skills/demo/stale-dir'));
    await writeFile(join(root, '.claude/skills/demo/stale-dir/x.md'), 'x\n', 'utf8');
    await writeFile(join(root, '.claude/skills/demo/stale.md'), 'x\n', 'utf8');

    await syncAgentConfig(root);

    const dest = join(root, '.claude/skills');

    expect(await readFile(join(dest, 'demo/SKILL.md'), 'utf8')).toBe('v2\n');
    expect(existsSync(join(dest, 'demo/references'))).toBe(false);
    expect(existsSync(join(dest, 'demo/stale-dir'))).toBe(false);
    expect(existsSync(join(dest, 'demo/stale.md'))).toBe(false);
  });

  it('replaces a destination file that collides with a source directory', async () => {
    const root = await makeRepo({ '.agent/skills/demo/SKILL.md': '# demo\n' });

    await makeDir(join(root, '.claude/skills'));
    await writeFile(join(root, '.claude/skills/demo'), 'a file where a dir belongs\n', 'utf8');

    await syncAgentConfig(root);

    const info = await lstat(join(root, '.claude/skills/demo'));

    expect(info.isDirectory()).toBe(true);
    expect(existsSync(join(root, '.claude/skills/demo/SKILL.md'))).toBe(true);
  });

  it('preserves the existing destination when .agent/skills is absent', async () => {
    const root = await makeRepo({ 'svc/AGENTS.md': 'rules\n' });

    await makeDir(join(root, '.claude/skills/demo'));
    await writeFile(join(root, '.claude/skills/demo/SKILL.md'), 'keep me\n', 'utf8');

    await syncAgentConfig(root);

    expect(await readFile(join(root, '.claude/skills/demo/SKILL.md'), 'utf8')).toBe('keep me\n');
    expect(logs.some((line) => line.includes('.agent/skills') && /skip/iu.test(line))).toBe(true);
  });

  it('empties the destination for an existing but empty source directory', async () => {
    const root = await makeRepo({
      '.agent/skills/': '',
      '.claude/skills/demo/SKILL.md': 'stale\n',
    });

    await syncAgentConfig(root);

    expect(await listTree(join(root, '.claude/skills'))).toEqual({});
  });

  it('creates an empty destination for an existing but empty source directory', async () => {
    const root = await makeRepo({ '.agent/skills/': '' });

    await syncAgentConfig(root);

    expect(await listTree(join(root, '.claude/skills'))).toEqual({});
    expect((await stat(join(root, '.claude/skills'))).isDirectory()).toBe(true);
  });

  it('skips gitignored source files and directories', async () => {
    const root = await makeRepo({
      '.gitignore': 'ignored-dir/\n.agent/skills/demo/secret.md\n',
      '.agent/skills/demo/SKILL.md': '# demo\n',
      '.agent/skills/demo/secret.md': 'shh\n',
      '.agent/skills/ignored-dir/a.md': 'a\n',
    });

    await syncAgentConfig(root);

    const dest = join(root, '.claude/skills');

    expect(existsSync(join(dest, 'demo/SKILL.md'))).toBe(true);
    expect(existsSync(join(dest, 'demo/secret.md'))).toBe(false);
    expect(existsSync(join(dest, 'ignored-dir'))).toBe(false);
  });

  it('does not follow a file symlink that escapes the source tree', async () => {
    const root = await makeRepo({ '.agent/skills/demo/SKILL.md': '# demo\n' });
    const outside = await makeTempDir();
    await writeFile(join(outside, 'secret.md'), 'secret\n', 'utf8');
    await symlink(join(outside, 'secret.md'), join(root, '.agent/skills/demo/link.md'));

    await syncAgentConfig(root);

    expect(existsSync(join(root, '.claude/skills/demo/link.md'))).toBe(false);
    expect(logs.some((line) => line.includes('skipped symlink'))).toBe(true);
  });

  it('does not follow a directory symlink', async () => {
    const root = await makeRepo({ '.agent/skills/demo/SKILL.md': '# demo\n' });
    const outside = await makeTempDir();
    await makeDir(join(outside, 'hidden'));
    await writeFile(join(outside, 'hidden/x.md'), 'x\n', 'utf8');
    await symlink(join(outside, 'hidden'), join(root, '.agent/skills/demo/linked'));

    await syncAgentConfig(root);

    expect(existsSync(join(root, '.claude/skills/demo/linked'))).toBe(false);
  });

  it('refuses a symlinked .claude instead of writing and deleting outside the repository', async () => {
    const root = await makeRepo({ '.agent/skills/demo/SKILL.md': '# demo\n' });
    const outside = await makeTempDir();
    await makeDir(join(outside, 'skills/important-skill'));
    await writeFile(join(outside, 'skills/important-skill/data.md'), 'keep\n', 'utf8');
    await symlink(outside, join(root, '.claude'));

    // Chuỗi path `.claude/skills` trông như nằm trong repository, nhưng thao tác
    // thật sẽ rơi vào `outside` — phải từ chối thay vì ghi/xoá ở đó.
    await expect(syncAgentConfig(root)).rejects.toThrow(/symbolic link/u);

    expect(existsSync(join(outside, 'skills/important-skill/data.md'))).toBe(true);
    expect(existsSync(join(outside, 'skills/demo'))).toBe(false);
  });

  it('refuses a symlinked .agent/skills source root instead of following it', async () => {
    const root = await makeRepo({});
    const outside = await makeTempDir();
    await makeDir(join(outside, 'demo'));
    await writeFile(join(outside, 'demo/SKILL.md'), '# demo\n', 'utf8');
    await makeDir(join(root, '.agent'));
    await symlink(outside, join(root, '.agent', 'skills'));

    await expect(syncAgentConfig(root)).rejects.toThrow(/symbolic link/u);

    expect(existsSync(join(root, '.claude'))).toBe(false);
  });

  it('handles names that merely start with two dots', async () => {
    // `..data` là tên hợp lệ, không phải đường dẫn thoát ra ngoài. Nếu phép kiểm
    // tra dùng `startsWith('..')` thì entry này bị từ chối lúc dọn, và vì
    // `repo-prepare` chạy trong `pnpm prepare` nên cả bước chuẩn bị sẽ hỏng.
    const root = await makeRepo({
      '.agent/skills/..data/x.md': 'x\n',
      '.claude/skills/..stale/y.md': 'y\n',
    });

    await syncAgentConfig(root);

    expect(existsSync(join(root, '.claude/skills/..data/x.md'))).toBe(true);
    expect(existsSync(join(root, '.claude/skills/..stale'))).toBe(false);
  });

  it('runs repeatedly without rewriting or removing anything on the second run', async () => {
    const root = await makeRepo({
      'svc/AGENTS.md': 'rules\n',
      '.agent/skills/demo/SKILL.md': '# demo\n',
      '.agent/skills/demo/references/notes.md': 'notes\n',
    });

    await syncAgentConfig(root);
    const before = await snapshot(root);

    logs.splice(0);
    await syncAgentConfig(root);

    expect(await snapshot(root)).toEqual(before);
    expect(logs.filter((line) => /created|copied|updated|removed/u.test(line))).toEqual([]);
  });

  it('skips .git instead of walking the object store', async () => {
    const root = await makeRepo({ 'svc/AGENTS.md': 'rules\n' });

    // `.git` không nằm trong `.gitignore`, nên nếu không chặn tường minh thì
    // walker sẽ đi vào đó. Đặt sẵn một `AGENTS.md` bên trong để phép kiểm tra
    // thực sự phát hiện được việc chặn `.git` bị gỡ: một cây `git init` trống
    // không có `AGENTS.md` nào trong `.git`, nên khẳng định trên log sẽ luôn
    // đúng kể cả khi guard bị xoá.
    const gitDir = join(root, '.git');
    await mkdir(join(gitDir, 'hooks'), { recursive: true });
    await writeFile(join(gitDir, 'hooks', 'AGENTS.md'), 'inside git\n', 'utf8');

    await syncAgentConfig(root);

    expect(existsSync(join(gitDir, 'hooks', 'CLAUDE.md'))).toBe(false);
    expect(logs.some((line) => line.includes('.git/'))).toBe(false);
  });
});

describe('syncAgentConfig - failure handling', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.map((value) => String(value)).join(' '));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    logs.splice(0);
    await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
    await Promise.all(extraDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('reports a directory that is not a git repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dx-sync-plain-'));
    extraDirs.push(root);
    await writeFile(join(root, 'AGENTS.md'), 'rules\n', 'utf8');

    await expect(syncAgentConfig(root)).rejects.toThrow(/git repository root/u);
  });

  it('surfaces a git invocation failure instead of treating it as "not ignored"', async () => {
    const root = await makeRepo({ '.agent/skills/demo/SKILL.md': '# demo\n' });

    // Lần chạy đầu resolve và nhớ repo root; phá `.git` rồi chạy lại khiến
    // `git check-ignore` trả exit code khác 0 và 1 — đó phải là lỗi thật, chứ
    // không bị đọc thành "không bị bỏ qua".
    await syncAgentConfig(root);
    await rm(join(root, '.git'), { recursive: true, force: true });

    await expect(syncAgentConfig(root)).rejects.toThrow(/check-ignore failed/u);
  });

  // Chạy dưới root thì quyền bị bỏ qua, nên kiểm tra này vô nghĩa.
  it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'surfaces a permission error instead of swallowing it',
    async () => {
      const root = await makeRepo({ '.agent/skills/demo/SKILL.md': '# demo\n' });
      const dest = await makeDir(join(root, '.claude/skills'));

      await chmod(dest, 0o500);
      try {
        await expect(syncAgentConfig(root)).rejects.toThrow(/EACCES|permission/u);
      } finally {
        await chmod(dest, 0o700);
      }
    },
  );

  it('leaves nothing behind outside the destination when the source is missing', async () => {
    const root = await makeRepo({ 'svc/AGENTS.md': 'rules\n' });
    const before = await listTree(root);

    await syncAgentConfig(root);

    // Chỉ CLAUDE.md mới được sinh; không có `.agent/skills` thì đích không đụng tới.
    expect(await listTree(root)).toEqual({ 'svc/CLAUDE.md': true, ...before });
    expect(existsSync(join(root, '.claude/skills'))).toBe(false);
  });

  it('keeps ROOT_DIR out of the removal path', async () => {
    // Không có `.agent/skills` trong repo tạm: bản sao dọn dẹp phải không bao
    // giờ chạm tới gì ngoài `.claude/skills`.
    const root = await makeRepo({ 'svc/AGENTS.md': 'rules\n' });

    await syncAgentConfig(root);

    expect(relative(ROOT_DIR, root).startsWith('..')).toBe(true);
    expect(existsSync(join(ROOT_DIR, '.claude', 'skills'))).toBe(false);
  });
});
