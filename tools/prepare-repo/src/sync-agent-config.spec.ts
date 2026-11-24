import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { syncAgentConfig } from './sync-agent-config';
import { ROOT_DIR, gitEnv } from './utils';

/**
 * Mọi cây thư mục test đều là một git repository thật (`git init`), vì
 * `syncAgentConfig` resolve repo root và gọi `git check-ignore` qua shell.
 *
 * Git spawn trong fixture dùng `gitEnv()` từ utils để scrub mọi biến `GIT_*`:
 * lefthook pre-push chạy suite này với `GIT_DIR` trỏ vào repo thật của
 * workspace, và giá trị đó thắng `cwd` — không scrub thì `git init` của fixture
 * ghim vào repo thật và mọi kiểm tra ignore chạy nhầm trên workspace.
 */

async function repo(shape: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dx-sync-'));

  // Mỗi entry fixture là một đường dẫn độc lập; mkdir+write fan-out song song.
  // Mkdir với `recursive: true` cũng phủ trường hợp thư mục đã tồn tại, nên thứ
  // Tự giữa các entry không quan trọng.
  await Promise.all(
    Object.entries(shape).map(([relativePath, contents]) => {
      const full = join(root, relativePath);

      return relativePath.endsWith('/')
        ? mkdir(full, { recursive: true })
        : mkdir(join(full, '..'), { recursive: true }).then(() =>
            writeFile(full, contents, 'utf8'),
          );
    }),
  );

  execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnv(), stdio: 'ignore' });

  return root;
}

async function makeDir(path: string): Promise<string> {
  await mkdir(path, { recursive: true });

  return path;
}

/** SKILL.md hợp lệ tối thiểu cho fixture; `body` là phần sau frontmatter. */
function skillMd(name: string, body: string): string {
  return ['---', `name: ${name}`, `description: ${name} skill`, '---', body].join('\n');
}

const roots: string[] = [],
  extraDirs: string[] = [],
  logs: string[] = [];

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
  const found: Record<string, true> = {},
    walk = async (dir: string, base: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }),
        // Các thư mục con độc lập; duyệt song song, kết quả gom vào chung object.
        subdirs = new Set(
          entries
            .filter(
              (entry) =>
                !(base === '' && entry.name === '.git') &&
                entry.isDirectory() &&
                !entry.isSymbolicLink(),
            )
            .map((entry) => entry.name),
        );
      await Promise.all(
        entries.map(async (entry) => {
          if (base === '' && entry.name === '.git') {
            return;
          }

          const relativePath = base === '' ? entry.name : `${base}/${entry.name}`;
          found[relativePath] = true;

          if (subdirs.has(entry.name)) {
            await walk(join(dir, entry.name), relativePath);
          }
        }),
      );
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
  const lines: Record<string, true> = {},
    walk = async (dir: string, base: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });

      // Các thư mục con độc lập; duyệt song song, stat từng file cũng độc lập.
      await Promise.all(
        entries.map(async (entry) => {
          if (base === '' && entry.name === '.git') {
            return;
          }

          const relativePath = base === '' ? entry.name : `${base}/${entry.name}`,
            full = join(dir, entry.name);

          if (entry.isSymbolicLink()) {
            lines[`${relativePath} symlink`] = true;

            return;
          }

          if (entry.isDirectory()) {
            lines[`${relativePath} dir`] = true;
            await walk(full, relativePath);
          } else {
            const info = await stat(full);
            lines[`${relativePath} file ${String(info.size)} ${String(info.mtimeMs)}`] = true;
          }
        }),
      );
    };

  await walk(root, '');

  return lines;
}

describe('syncAgentConfig - skills synchronization', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.map((value) => String(value)).join(' '));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    logs.splice(0);
    await Promise.all(roots.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
    await Promise.all(extraDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it('copies nested skills and their supporting resources, not only SKILL.md', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/skills/demo/SKILL.md': skillMd('demo', '# demo\n'),
      '.agents/skills/demo/assets/logo.txt': 'logo\n',
      '.agents/skills/demo/references/notes.md': 'notes\n',
      '.agents/skills/other/SKILL.md': skillMd('other', '# other\n'),
    });

    await syncAgentConfig(root);

    const expected = {
      demo: true,
      'demo/SKILL.md': true,
      'demo/assets': true,
      'demo/assets/logo.txt': true,
      'demo/references': true,
      'demo/references/notes.md': true,
      other: true,
      'other/SKILL.md': true,
    };

    await expect(listTree(join(root, '.claude/skills'))).resolves.toStrictEqual(expected);
    await expect(listTree(join(root, '.opencode/skills'))).resolves.toStrictEqual(expected);
  });

  it('mirrors content exactly', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/skills/demo/SKILL.md': skillMd('demo', '# demo\n'),
      '.agents/skills/demo/references/notes.md': 'notes\n',
    });

    await syncAgentConfig(root);

    // The two destinations are independent reads over the same fixture.
    await Promise.all(
      ['.claude/skills', '.opencode/skills'].map((dest) =>
        expect(readFile(join(root, dest, 'demo/references/notes.md'), 'utf8')).resolves.toBe(
          'notes\n',
        ),
      ),
    );
  });

  it('writes to both destinations even though they are gitignored', async () => {
    expect.hasAssertions();
    // Chỉ cây nguồn tôn trọng .gitignore; đích là output sinh tự động nên việc
    // Nó bị bỏ qua không được chặn ghi.
    const root = await makeRepo({
      '.agents/skills/demo/SKILL.md': skillMd('demo', '# demo\n'),
      '.gitignore': '.claude/skills/\n.opencode/skills/\n',
    });

    await syncAgentConfig(root);

    expect(existsSync(join(root, '.claude/skills/demo/SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.opencode/skills/demo/SKILL.md'))).toBe(true);
  });

  it('updates changed files and removes stale destination files and directories', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/skills/demo/SKILL.md': skillMd('demo', 'v1\n'),
      '.agents/skills/demo/references/notes.md': 'notes\n',
    });

    await syncAgentConfig(root);

    // Đổi nội dung nguồn, bỏ một cây con, rồi bồi thêm entry thừa vào đích.
    await writeFile(join(root, '.agents/skills/demo/SKILL.md'), skillMd('demo', 'v2\n'), 'utf8');
    await rm(join(root, '.agents/skills/demo/references'), { force: true, recursive: true });
    // Mỗi đích nhận đúng một cây fixture độc lập; stale-dir được tạo trong cùng
    // Chuỗi promise với file nằm trong nó.
    await Promise.all(
      ['.claude/skills', '.opencode/skills'].flatMap((dest) => [
        makeDir(join(root, dest, 'demo/stale-dir')).then(() =>
          writeFile(join(root, dest, 'demo/stale-dir/x.md'), 'x\n', 'utf8'),
        ),
        writeFile(join(root, dest, 'demo/stale.md'), 'x\n', 'utf8'),
      ]),
    );

    await syncAgentConfig(root);

    // The two destinations are independent reads over the same fixture.
    await Promise.all(
      ['.claude/skills', '.opencode/skills'].map((dest) =>
        expect(readFile(join(root, dest, 'demo/SKILL.md'), 'utf8')).resolves.toBe(
          skillMd('demo', 'v2\n'),
        ),
      ),
    );
    expect(existsSync(join(root, '.claude/skills/demo/references'))).toBeFalsy();
    expect(existsSync(join(root, '.claude/skills/demo/stale-dir'))).toBeFalsy();
    expect(existsSync(join(root, '.claude/skills/demo/stale.md'))).toBeFalsy();
    expect(existsSync(join(root, '.opencode/skills/demo/references'))).toBeFalsy();
    expect(existsSync(join(root, '.opencode/skills/demo/stale-dir'))).toBeFalsy();
    expect(existsSync(join(root, '.opencode/skills/demo/stale.md'))).toBeFalsy();
  });

  it('replaces a destination file that collides with a source directory', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ '.agents/skills/demo/SKILL.md': skillMd('demo', '# demo\n') });

    await makeDir(join(root, '.claude/skills'));
    await writeFile(join(root, '.claude/skills/demo'), 'a file where a dir belongs\n', 'utf8');

    await syncAgentConfig(root);

    const info = await lstat(join(root, '.claude/skills/demo'));

    expect(info.isDirectory()).toBe(true);
    expect(existsSync(join(root, '.claude/skills/demo/SKILL.md'))).toBe(true);
  });

  it('preserves the existing destination when .agents/skills is absent', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ 'svc/AGENTS.md': 'rules\n' });

    // Mỗi đích nhận đúng một cây fixture độc lập; mkdir chạy trong cùng chuỗi
    // Promise với file nằm trong nó.
    await Promise.all(
      ['.claude/skills', '.opencode/skills'].map((dest) =>
        makeDir(join(root, dest, 'demo')).then(() =>
          writeFile(join(root, dest, 'demo/SKILL.md'), 'keep me\n', 'utf8'),
        ),
      ),
    );

    await syncAgentConfig(root);

    // The two destinations are independent reads over the same fixture.
    await Promise.all(
      ['.claude/skills', '.opencode/skills'].map((dest) =>
        expect(readFile(join(root, dest, 'demo/SKILL.md'), 'utf8')).resolves.toBe('keep me\n'),
      ),
    );

    expect(logs.some((line) => line.includes('.agents/skills') && /skip/iu.test(line))).toBe(true);
  });

  it('empties the destination for an existing but empty source directory', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/skills/': '',
      '.claude/skills/demo/SKILL.md': 'stale\n',
      '.opencode/skills/demo/SKILL.md': 'stale\n',
    });

    await syncAgentConfig(root);

    await expect(listTree(join(root, '.claude/skills'))).resolves.toStrictEqual({});
    await expect(listTree(join(root, '.opencode/skills'))).resolves.toStrictEqual({});
  });

  it('creates an empty destination for an existing but empty source directory', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ '.agents/skills/': '' });

    await syncAgentConfig(root);

    // The two destinations are independent checks over the same fixture.
    await Promise.all(
      ['.claude/skills', '.opencode/skills'].map(async (dest) =>
        expect((await stat(join(root, dest))).isDirectory()).toBe(true),
      ),
    );
  });

  it('skips gitignored source files and directories', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/skills/demo/SKILL.md': skillMd('demo', '# demo\n'),
      '.agents/skills/demo/secret.md': 'shh\n',
      '.agents/skills/ignored-dir/a.md': 'a\n',
      '.gitignore': 'ignored-dir/\n.agents/skills/demo/secret.md\n',
    });

    await syncAgentConfig(root);

    for (const dest of ['.claude/skills', '.opencode/skills']) {
      expect(existsSync(join(root, dest, 'demo/SKILL.md'))).toBe(true);
      expect(existsSync(join(root, dest, 'demo/secret.md'))).toBeFalsy();
      expect(existsSync(join(root, dest, 'ignored-dir'))).toBeFalsy();
    }
  });

  it('does not follow a file symlink that escapes the source tree', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ '.agents/skills/demo/SKILL.md': skillMd('demo', '# demo\n') }),
      outside = await makeTempDir();
    await writeFile(join(outside, 'secret.md'), 'secret\n', 'utf8');
    await symlink(join(outside, 'secret.md'), join(root, '.agents/skills/demo/link.md'));

    await syncAgentConfig(root);

    expect(existsSync(join(root, '.claude/skills/demo/link.md'))).toBeFalsy();
    expect(existsSync(join(root, '.opencode/skills/demo/link.md'))).toBeFalsy();
    expect(logs.some((line) => line.includes('skipped symlink'))).toBe(true);
  });

  it('does not follow a directory symlink', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ '.agents/skills/demo/SKILL.md': skillMd('demo', '# demo\n') }),
      outside = await makeTempDir();
    await makeDir(join(outside, 'hidden'));
    await writeFile(join(outside, 'hidden/x.md'), 'x\n', 'utf8');
    await symlink(join(outside, 'hidden'), join(root, '.agents/skills/demo/linked'));

    await syncAgentConfig(root);

    expect(existsSync(join(root, '.claude/skills/demo/linked'))).toBeFalsy();
    expect(existsSync(join(root, '.opencode/skills/demo/linked'))).toBeFalsy();
  });

  it('refuses a symlinked .claude instead of writing and deleting outside the repository', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ '.agents/skills/demo/SKILL.md': skillMd('demo', '# demo\n') }),
      outside = await makeTempDir();
    await makeDir(join(outside, 'skills/important-skill'));
    await writeFile(join(outside, 'skills/important-skill/data.md'), 'keep\n', 'utf8');
    await symlink(outside, join(root, '.claude'));

    // Chuỗi path `.claude/skills` trông như nằm trong repository, nhưng thao tác
    // Thật sẽ rơi vào `outside` — phải từ chối thay vì ghi/xoá ở đó.
    await expect(syncAgentConfig(root)).rejects.toThrow(/symbolic link/u);

    expect(existsSync(join(outside, 'skills/important-skill/data.md'))).toBe(true);
    expect(existsSync(join(outside, 'skills/demo'))).toBeFalsy();
    expect(existsSync(join(root, '.opencode'))).toBeFalsy();
  });

  it('refuses a symlinked .agents/skills source root instead of following it', async () => {
    expect.hasAssertions();
    const root = await makeRepo({}),
      outside = await makeTempDir();
    await makeDir(join(outside, 'demo'));
    await writeFile(join(outside, 'demo/SKILL.md'), '# demo\n', 'utf8');
    await makeDir(join(root, '.agents'));
    await symlink(outside, join(root, '.agents', 'skills'));

    await expect(syncAgentConfig(root)).rejects.toThrow(/symbolic link/u);

    expect(existsSync(join(root, '.claude'))).toBeFalsy();
  });

  it('handles names that merely start with two dots', async () => {
    expect.hasAssertions();
    // `..stale` là tên hợp lệ, không phải đường dẫn thoát ra ngoài. Nếu phép
    // Kiểm tra dùng `startsWith('..')` thì entry này bị từ chối lúc dọn, và vì
    // `repo-prepare` chạy trong `pnpm prepare` nên cả bước chuẩn bị sẽ hỏng.
    // Phía nguồn không thể giữ tên kiểu vậy nữa: thư mục trực tiếp dưới
    // `.agents/skills` giờ phải là skill hợp lệ, và `..data` không qua được
    // Validation — nên tên chấm-hai-chấm chỉ còn được canh ở phía đích, phía mà
    // `assertInside` bảo vệ khi dọn.
    const root = await makeRepo({
      '.agents/skills/data/SKILL.md': skillMd('data', 'x\n'),
      '.claude/skills/..stale/y.md': 'y\n',
      '.opencode/skills/..stale/y.md': 'y\n',
    });

    await syncAgentConfig(root);

    for (const dest of ['.claude/skills', '.opencode/skills']) {
      expect(existsSync(join(root, dest, 'data/SKILL.md'))).toBe(true);
      expect(existsSync(join(root, dest, '..stale'))).toBeFalsy();
    }
  });

  it('rejects a gitignored SKILL.md instead of mirroring a skill without it', async () => {
    expect.hasAssertions();
    // ValidateSkills thấy SKILL.md tồn tại, nhưng mirror tôn trọng gitignore và
    // Bỏ qua file đó — đích sinh ra một skill thiếu SKILL.md, đúng hỏng hóc mà
    // Validation tồn tại để chặn. Nên đây là lỗi nguồn, không phải output lệch.
    const root = await makeRepo({
      '.agents/skills/demo/SKILL.md': skillMd('demo', '# demo\n'),
      '.gitignore': '.agents/skills/demo/SKILL.md\n',
    });

    await expect(syncAgentConfig(root)).rejects.toThrow(
      /\.agents\/skills\/demo\/SKILL\.md is gitignored/u,
    );

    expect(existsSync(join(root, '.claude'))).toBeFalsy();
    expect(existsSync(join(root, '.opencode'))).toBeFalsy();
  });

  it('rejects a skills source that is a file instead of a directory', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ '.agents/skills': 'not a directory\n' });

    await expect(syncAgentConfig(root)).rejects.toThrow(/is not a directory/u);

    expect(existsSync(join(root, '.claude'))).toBeFalsy();
  });

  it('rejects a destination skills path that is a file instead of a directory', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ '.agents/skills/demo/SKILL.md': skillMd('demo', '# demo\n') });
    await makeDir(join(root, '.claude'));
    await writeFile(join(root, '.claude/skills'), 'a file where a dir belongs\n', 'utf8');

    await expect(syncAgentConfig(root)).rejects.toThrow(/exists but is not a directory/u);
  });

  it('refuses a symlinked .claude/skills destination instead of writing through it', async () => {
    expect.hasAssertions();
    // AssertNoSymlinkPath kiểm từng thành phần: chỉ test case `.claude` là symlink
    // Ở trên chưa canh được symlink đặt sâu hơn một cấp.
    const root = await makeRepo({ '.agents/skills/demo/SKILL.md': skillMd('demo', '# demo\n') }),
      outside = await makeTempDir();
    await makeDir(join(root, '.claude'));
    await symlink(outside, join(root, '.claude', 'skills'));

    await expect(syncAgentConfig(root)).rejects.toThrow(/symbolic link/u);

    expect(existsSync(join(outside, 'demo'))).toBeFalsy();
  });

  it('runs repeatedly without rewriting or removing anything on the second run', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/skills/demo/SKILL.md': skillMd('demo', '# demo\n'),
      '.agents/skills/demo/references/notes.md': 'notes\n',
      'svc/AGENTS.md': 'rules\n',
    });

    await syncAgentConfig(root);
    const before = await snapshot(root);

    logs.splice(0);
    await syncAgentConfig(root);

    await expect(snapshot(root)).resolves.toStrictEqual(before);
    expect(logs.filter((line) => /created|copied|updated|removed/u.test(line))).toStrictEqual([]);
  });
});

describe('syncAgentConfig - skill validation', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.map((value) => String(value)).join(' '));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    logs.splice(0);
    await Promise.all(roots.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
    await Promise.all(extraDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it('rejects a skill directory without SKILL.md and creates no destination', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/skills/broken/notes.md': 'no skill contract here\n',
      '.agents/skills/good/SKILL.md': skillMd('good', '# good\n'),
    });

    await expect(syncAgentConfig(root)).rejects.toThrow(
      /\.agents\/skills\/broken\/SKILL\.md is missing/u,
    );

    expect(existsSync(join(root, '.claude'))).toBeFalsy();
    expect(existsSync(join(root, '.opencode'))).toBeFalsy();
  });

  it('rejects a symlinked SKILL.md and names the file instead of mirroring a skill without it', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ '.agents/skills/good/SKILL.md': skillMd('good', '# good\n') }),
      outside = await makeTempDir();
    await writeFile(join(outside, 'real.md'), '# real\n', 'utf8');
    await mkdir(join(root, '.agents/skills/broken'), { recursive: true });
    await symlink(join(outside, 'real.md'), join(root, '.agents/skills/broken/SKILL.md'));

    await expect(syncAgentConfig(root)).rejects.toThrow(
      /\.agents\/skills\/broken\/SKILL\.md must be a regular file, not a symbolic link/u,
    );

    expect(existsSync(join(root, '.claude'))).toBeFalsy();
    expect(existsSync(join(root, '.opencode'))).toBeFalsy();
  });

  it('rejects a name that does not match the directory', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/skills/demo/SKILL.md': skillMd('other', '# demo\n'),
    });

    await expect(syncAgentConfig(root)).rejects.toThrow(
      /\.agents\/skills\/demo: "name" must match the directory name \("demo"\), got "other"/u,
    );
  });

  it('keeps the previously synced destination intact when a new skill is invalid', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ '.agents/skills/good/SKILL.md': skillMd('good', '# good\n') });

    await syncAgentConfig(root);

    // Thêm một skill hỏng (frontmatter YAML không parse được) rồi chạy lại: lần
    // Chạy thứ hai phải chết trước khi đụng tới đích, để bản sao hợp lệ từ lần
    // Trước còn nguyên và skill hỏng không bị mirror một nửa.
    await mkdir(join(root, '.agents/skills/broken'), { recursive: true });
    await writeFile(
      join(root, '.agents/skills/broken/SKILL.md'),
      ['---', 'name: [unclosed', '---', 'Body.'].join('\n'),
      'utf8',
    );

    await expect(syncAgentConfig(root)).rejects.toThrow(
      /\.agents\/skills\/broken\/SKILL\.md: invalid YAML frontmatter/u,
    );

    for (const dest of ['.claude/skills', '.opencode/skills']) {
      expect(existsSync(join(root, dest, 'good/SKILL.md'))).toBe(true);
      expect(existsSync(join(root, dest, 'broken'))).toBeFalsy();
    }
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
    await Promise.all(roots.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
    await Promise.all(extraDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it('reports a directory that is not a git repository', async () => {
    expect.hasAssertions();
    const root = await mkdtemp(join(tmpdir(), 'dx-sync-plain-'));
    extraDirs.push(root);
    await writeFile(join(root, 'AGENTS.md'), 'rules\n', 'utf8');

    await expect(syncAgentConfig(root)).rejects.toThrow(/git repository root/u);
  });

  it('surfaces a git invocation failure instead of treating it as "not ignored"', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ '.agents/skills/demo/SKILL.md': skillMd('demo', '# demo\n') });

    // Lần chạy đầu resolve và nhớ repo root; phá `.git` rồi chạy lại khiến
    // `git check-ignore` trả exit code khác 0 và 1 — đó phải là lỗi thật, chứ
    // Không bị đọc thành "không bị bỏ qua".
    await syncAgentConfig(root);
    await rm(join(root, '.git'), { force: true, recursive: true });

    await expect(syncAgentConfig(root)).rejects.toThrow(/check-ignore failed/u);
  });

  // Chạy dưới root thì quyền bị bỏ qua, nên kiểm tra này vô nghĩa.
  it(
    'surfaces a permission error instead of swallowing it',
    { skip: typeof process.getuid === 'function' && process.getuid() === 0 },
    async () => {
      expect.hasAssertions();
      const root = await makeRepo({ '.agents/skills/demo/SKILL.md': skillMd('demo', '# demo\n') }),
        dest = await makeDir(join(root, '.claude/skills'));

      await chmod(dest, 0o500);
      try {
        await expect(syncAgentConfig(root)).rejects.toThrow(/EACCES|permission/u);
      } finally {
        await chmod(dest, 0o700);
      }
    },
  );

  it('leaves nothing behind when both sources are missing', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ 'svc/AGENTS.md': 'rules\n' }),
      before = await listTree(root);

    await syncAgentConfig(root);

    // Không có nguồn nào trong `.agents/` thì không đích nào được tạo — và đặc
    // Biệt là không còn file `CLAUDE.md` nào được sinh.
    await expect(listTree(root)).resolves.toStrictEqual(before);
    expect(existsSync(join(root, '.claude'))).toBeFalsy();
    expect(existsSync(join(root, '.opencode'))).toBeFalsy();
    expect(existsSync(join(root, 'svc/CLAUDE.md'))).toBeFalsy();
  });

  it('logs paths relative to the processed directory, not to ROOT_DIR', async () => {
    expect.hasAssertions();
    // `syncAgentConfig` nhận `dir` để test và để tái sử dụng; đường dẫn trong log
    // Phải theo chính `dir` đó, nếu không một lần chạy trên cây ngoài workspace sẽ
    // In ra chuỗi `../../..` vô nghĩa.
    const root = await makeRepo({ '.agents/skills/demo/SKILL.md': skillMd('demo', '# demo\n') });

    await syncAgentConfig(root);

    expect(logs).toContain('copied .claude/skills/demo/SKILL.md');
    expect(logs).toContain('copied .opencode/skills/demo/SKILL.md');
    expect(logs.some((line) => line.includes('..'))).toBeFalsy();
  });

  it('keeps ROOT_DIR out of the removal path', async () => {
    expect.hasAssertions();
    // Không có `.agents/skills` trong repo tạm: bản sao dọn dẹp phải không bao
    // Giờ chạm tới gì ngoài `.claude/skills` của repo đang xử lý.
    const root = await makeRepo({ 'svc/AGENTS.md': 'rules\n' }),
      // Trạng thái `.claude/skills` của repo thật được chụp lại thay vì giả định
      // Nó luôn vắng mặt: spec CLI ở `index.spec.ts` cố ý chạy sync-agent-config
      // Thật trên ROOT_DIR, nên artifact đó có thể tồn tại sẵn tuỳ thứ tự chạy.
      // Điều cần chứng minh là lần chạy này không tạo, xoá hay đổi nó.
      generated = ['.claude/skills', '.claude/agents', '.opencode/skills', '.opencode/agents'].map(
        (label) => join(ROOT_DIR, ...label.split('/')),
      ),
      existedBefore = generated.map((path) => existsSync(path));

    await syncAgentConfig(root);

    expect(relative(ROOT_DIR, root).startsWith('..')).toBe(true);
    expect(generated.map((path) => existsSync(path))).toStrictEqual(existedBefore);
  });
});

describe('syncAgentConfig - agent definitions', () => {
  const REVIEWER = [
    '---',
    'name: reviewer',
    'description: Review code without changing it',
    'tools: Read, Grep, Bash',
    'model: claude-sonnet-5-5',
    '---',
    'You are a reviewer.',
    '',
  ].join('\n');

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.map((value) => String(value)).join(' '));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    logs.splice(0);
    await Promise.all(roots.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
    await Promise.all(extraDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it('generates one definition per target', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ '.agents/agents/reviewer.md': REVIEWER });

    await syncAgentConfig(root);

    // The two destinations are independent reads over the same fixture.
    await Promise.all(
      ['.claude/agents', '.opencode/agents'].map((dest) =>
        expect(listTree(join(root, dest))).resolves.toStrictEqual({ 'reviewer.md': true }),
      ),
    );
  });

  it('carries every declared field and the prompt into the Claude definition', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ '.agents/agents/reviewer.md': REVIEWER });

    await syncAgentConfig(root);

    const contents = await readFile(join(root, '.claude/agents/reviewer.md'), 'utf8');

    expect(contents).toContain('name: "reviewer"');
    expect(contents).toContain('description: "Review code without changing it"');
    expect(contents).toContain('tools: "Read, Grep, Bash"');
    expect(contents).toContain('model: "claude-sonnet-5-5"');
    expect(contents.endsWith('You are a reviewer.\n')).toBe(true);
  });

  it('gives OpenCode a subagent mode, permission rules and no Claude-only keys', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ '.agents/agents/reviewer.md': REVIEWER });

    await syncAgentConfig(root);

    const contents = await readFile(join(root, '.opencode/agents/reviewer.md'), 'utf8');

    expect(contents).not.toContain('name:');
    expect(contents).not.toContain('tools:');
    expect(contents).toContain('mode: subagent');
    expect(contents).toContain('description: "Review code without changing it"');
    expect(contents.endsWith('You are a reviewer.\n')).toBe(true);
  });

  it('defaults to subagent in OpenCode and writes no mode for Claude', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ '.agents/agents/reviewer.md': REVIEWER });

    await syncAgentConfig(root);

    await expect(readFile(join(root, '.opencode/agents/reviewer.md'), 'utf8')).resolves.toContain(
      'mode: subagent',
    );
    await expect(readFile(join(root, '.claude/agents/reviewer.md'), 'utf8')).resolves.not.toContain(
      'mode:',
    );
  });

  it('renders a primary mode in OpenCode and keeps it out of the Claude definition', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/agents/lead.md': [
        '---',
        'name: lead',
        'description: Coordinates other agents',
        'tools: Read, Agent',
        'mode: primary',
        '---',
        'You lead.',
        '',
      ].join('\n'),
    });

    await syncAgentConfig(root);

    const opencode = await readFile(join(root, '.opencode/agents/lead.md'), 'utf8');

    expect(opencode).toContain('mode: primary');
    expect(opencode).not.toContain('mode: subagent');
    await expect(readFile(join(root, '.claude/agents/lead.md'), 'utf8')).resolves.not.toContain(
      'mode:',
    );
  });

  it('accepts and renders mode: all', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/agents/both.md': [
        '---',
        'name: both',
        'description: Usable both ways',
        'mode: all',
        '---',
        'Prompt.',
        '',
      ].join('\n'),
    });

    await syncAgentConfig(root);

    await expect(readFile(join(root, '.opencode/agents/both.md'), 'utf8')).resolves.toContain(
      'mode: all',
    );
  });

  it('rejects an invalid mode and names the file and the accepted values', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/agents/reviewer.md': [
        '---',
        'name: reviewer',
        'description: Invalid mode',
        'mode: sometimes',
        '---',
        'Prompt.',
        '',
      ].join('\n'),
    });

    await expect(syncAgentConfig(root)).rejects.toThrow(
      /\.agents\/agents\/reviewer\.md.*"mode".*primary, subagent, all/u,
    );
  });

  it('rejects an empty mode', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/agents/reviewer.md': [
        '---',
        'name: reviewer',
        'description: Empty mode',
        'mode: ""',
        '---',
        'Prompt.',
        '',
      ].join('\n'),
    });

    await expect(syncAgentConfig(root)).rejects.toThrow(/\.agents\/agents\/reviewer\.md.*"mode"/u);
  });

  it('rejects a bare mode key instead of reading it as an omission', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/agents/reviewer.md': [
        '---',
        'name: reviewer',
        'description: Bare mode',
        'mode:',
        '---',
        'Prompt.',
        '',
      ].join('\n'),
    });

    await expect(syncAgentConfig(root)).rejects.toThrow(/\.agents\/agents\/reviewer\.md.*"mode"/u);
  });

  it('keeps mode from disturbing the other rendered fields', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/agents/reviewer.md': [
        '---',
        'name: reviewer',
        'description: Review code without changing it',
        'tools: Read, Grep, Bash',
        'model: claude-sonnet-5-5',
        'mode: primary',
        '---',
        'You are a reviewer.',
        '',
      ].join('\n'),
    });

    await syncAgentConfig(root);

    const claude = await readFile(join(root, '.claude/agents/reviewer.md'), 'utf8');

    expect(claude).toContain('name: "reviewer"');
    expect(claude).toContain('description: "Review code without changing it"');
    expect(claude).toContain('tools: "Read, Grep, Bash"');
    expect(claude).toContain('model: "claude-sonnet-5-5"');
    expect(claude).not.toContain('mode:');
    expect(claude.endsWith('You are a reviewer.\n')).toBe(true);

    const opencode = await readFile(join(root, '.opencode/agents/reviewer.md'), 'utf8');

    expect(opencode).toContain('mode: primary');
    expect(opencode.indexOf('effect: deny')).toBeLessThan(opencode.indexOf('effect: allow'));
    expect(opencode.endsWith('You are a reviewer.\n')).toBe(true);
  });

  it('puts the catch-all deny before the allowed actions', async () => {
    expect.hasAssertions();
    // OpenCode áp rule khai báo sau thắng rule khai báo trước, nên thứ tự này là
    // Thứ duy nhất thực sự giới hạn quyền của agent.
    const root = await makeRepo({
      '.agents/agents/reviewer.md': [
        '---',
        'name: reviewer',
        'description: Review only',
        'tools: Read, Grep',
        '---',
        'Prompt.',
        '',
      ].join('\n'),
    });

    await syncAgentConfig(root);

    const contents = await readFile(join(root, '.opencode/agents/reviewer.md'), 'utf8'),
      deny = contents.indexOf('effect: deny'),
      allow = contents.indexOf('effect: allow');

    expect(deny).toBeGreaterThan(-1);
    expect(deny).toBeLessThan(allow);
    expect(contents).toContain('action: "read"');
    expect(contents).toContain('action: "grep"');
    expect(contents).not.toContain('action: "shell"');
  });

  it('leaves permissions out when the source declares no tools', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/agents/helper.md': [
        '---',
        'name: helper',
        'description: Inherits the default tool access',
        '---',
        'Prompt.',
        '',
      ].join('\n'),
    });

    await syncAgentConfig(root);

    await expect(readFile(join(root, '.opencode/agents/helper.md'), 'utf8')).resolves.not.toContain(
      'permissions:',
    );
  });

  it('accepts tools as a YAML list', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/agents/reader.md': [
        '---',
        'name: reader',
        'description: Reads only',
        'tools:',
        '  - Read',
        '  - Glob',
        '---',
        'Prompt.',
        '',
      ].join('\n'),
    });

    await syncAgentConfig(root);

    await expect(readFile(join(root, '.claude/agents/reader.md'), 'utf8')).resolves.toContain(
      'tools: "Read, Glob"',
    );
  });

  it('warns and omits a model alias OpenCode cannot resolve', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/agents/quick.md': [
        '---',
        'name: quick',
        'description: Uses a Claude alias',
        'model: sonnet',
        '---',
        'Prompt.',
        '',
      ].join('\n'),
    });

    await syncAgentConfig(root);

    await expect(readFile(join(root, '.claude/agents/quick.md'), 'utf8')).resolves.toContain(
      'model: "sonnet"',
    );
    await expect(readFile(join(root, '.opencode/agents/quick.md'), 'utf8')).resolves.not.toContain(
      'model:',
    );
    expect(logs.some((line) => line.includes('provider/model'))).toBe(true);
  });

  it('removes definitions that no longer exist in the source', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ '.agents/agents/reviewer.md': REVIEWER });
    await syncAgentConfig(root);

    // Nguồn còn tồn tại nhưng rỗng là trạng thái hợp lệ, khác với nguồn vắng
    // Mặt: nó có nghĩa là không còn agent nào, nên đích phải được dọn.
    await rm(join(root, '.agents/agents'), { force: true, recursive: true });
    await makeDir(join(root, '.agents/agents'));

    await syncAgentConfig(root);

    expect(existsSync(join(root, '.claude/agents/reviewer.md'))).toBeFalsy();
    expect(existsSync(join(root, '.opencode/agents/reviewer.md'))).toBeFalsy();
  });

  it('preserves both destinations when .agents/agents is absent', async () => {
    expect.hasAssertions();
    const root = await makeRepo({});
    // Mỗi đích nhận đúng một cây fixture độc lập; mkdir chạy trong cùng chuỗi
    // Promise với file nằm trong nó.
    await Promise.all(
      ['.claude/agents', '.opencode/agents'].map((dest) =>
        makeDir(join(root, dest)).then(() =>
          writeFile(join(root, dest, 'hand.md'), 'keep me\n', 'utf8'),
        ),
      ),
    );

    await syncAgentConfig(root);

    // The two destinations are independent reads over the same fixture.
    await Promise.all(
      ['.claude/agents', '.opencode/agents'].map((dest) =>
        expect(readFile(join(root, dest, 'hand.md'), 'utf8')).resolves.toBe('keep me\n'),
      ),
    );

    expect(logs.some((line) => line.includes('.agents/agents') && /skip/iu.test(line))).toBe(true);
  });

  it('rejects a definition without frontmatter', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ '.agents/agents/broken.md': 'no frontmatter\n' });

    await expect(syncAgentConfig(root)).rejects.toThrow(/missing YAML frontmatter/u);
  });

  it('rejects an agents source that is a file instead of a directory', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ '.agents/agents': 'not a directory\n' });

    await expect(syncAgentConfig(root)).rejects.toThrow(/is not a directory/u);
  });

  it('rejects a destination agents path that is a file instead of a directory', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ '.agents/agents/reviewer.md': REVIEWER });
    await makeDir(join(root, '.claude'));
    await writeFile(join(root, '.claude/agents'), 'a file where a dir belongs\n', 'utf8');

    await expect(syncAgentConfig(root)).rejects.toThrow(/exists but is not a directory/u);
  });

  it('refuses a symlinked .claude/agents destination instead of writing through it', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ '.agents/agents/reviewer.md': REVIEWER }),
      outside = await makeTempDir();
    await makeDir(join(root, '.claude'));
    await symlink(outside, join(root, '.claude', 'agents'));

    await expect(syncAgentConfig(root)).rejects.toThrow(/symbolic link/u);

    expect(existsSync(join(outside, 'reviewer.md'))).toBeFalsy();
  });

  it('skips uppercase .MD entries like any other non-agent entry', async () => {
    expect.hasAssertions();
    // `extname` phân biệt hoa thường: `reviewer.MD` không phải định nghĩa agent,
    // Và hành vi skip kèm thông báo là lựa chọn có chủ đích của readAgents.
    const root = await makeRepo({
      '.agents/agents/other.MD': 'not matched by extname\n',
      '.agents/agents/reviewer.md': REVIEWER,
    });

    await syncAgentConfig(root);

    // The two destinations are independent checks over the same fixture.
    await Promise.all(
      ['.claude/agents', '.opencode/agents'].map((dest) =>
        expect(listTree(join(root, dest))).resolves.toStrictEqual({ 'reviewer.md': true }),
      ),
    );

    expect(logs.some((line) => line.includes('other.MD'))).toBe(true);
  });

  it('skips subdirectories and symlinks in the agents source', async () => {
    expect.hasAssertions();
    const root = await makeRepo({ '.agents/agents/reviewer.md': REVIEWER });
    await makeDir(join(root, '.agents/agents/nested'));
    await writeFile(join(root, '.agents/agents/nested/deep.md'), 'stale\n', 'utf8');

    const outside = await makeTempDir();
    await writeFile(join(outside, 'secret.md'), 'secret\n', 'utf8');
    await symlink(join(outside, 'secret.md'), join(root, '.agents/agents/link.md'));

    await syncAgentConfig(root);

    // The two destinations are independent checks over the same fixture.
    await Promise.all(
      ['.claude/agents', '.opencode/agents'].map((dest) =>
        expect(listTree(join(root, dest))).resolves.toStrictEqual({ 'reviewer.md': true }),
      ),
    );

    expect(logs.some((line) => line.includes('skipped symlink'))).toBe(true);
    expect(logs.some((line) => line.includes('nested'))).toBe(true);
  });

  it('keeps agent destinations byte-identical on a second run', async () => {
    expect.hasAssertions();
    // Idempotency của skills đã được canh; agents phải có cùng bảo đảm vì cùng
    // Chạy trong `pnpm prepare`.
    const root = await makeRepo({
      '.agents/agents/quick.md': [
        '---',
        'name: quick',
        'description: Uses a Claude alias',
        'model: sonnet',
        '---',
        'Prompt.',
        '',
      ].join('\n'),
      '.agents/agents/reviewer.md': REVIEWER,
    });

    await syncAgentConfig(root);
    const before = await snapshot(root);

    logs.splice(0);
    await syncAgentConfig(root);

    await expect(snapshot(root)).resolves.toStrictEqual(before);
    expect(logs.filter((line) => /copied|updated|removed/u.test(line))).toStrictEqual([]);
  });

  it('does not touch agent destinations when a skill is invalid', async () => {
    expect.hasAssertions();
    // SyncSkills chạy trước syncAgents: một nguồn skill hỏng phải chết trước khi
    // Bất kỳ đích nào bị đụng tới, kể cả đích của agents.
    const root = await makeRepo({
      '.agents/agents/reviewer.md': REVIEWER,
      '.agents/skills/broken/SKILL.md': '---\nname: [unclosed\n---\nBody.',
    });

    await expect(syncAgentConfig(root)).rejects.toThrow(/invalid YAML frontmatter/u);

    expect(existsSync(join(root, '.claude/agents'))).toBeFalsy();
    expect(existsSync(join(root, '.opencode/agents'))).toBeFalsy();
  });

  it('rejects a name that does not match the file name', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/agents/reviewer.md': [
        '---',
        'name: other',
        'description: Mismatched name',
        '---',
        'Prompt.',
        '',
      ].join('\n'),
    });

    await expect(syncAgentConfig(root)).rejects.toThrow(/must match the file name/u);
  });

  it('rejects an unknown frontmatter key', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/agents/reviewer.md': [
        '---',
        'name: reviewer',
        'description: Has an extra key',
        'temperature: 0.2',
        '---',
        'Prompt.',
        '',
      ].join('\n'),
    });

    await expect(syncAgentConfig(root)).rejects.toThrow(
      /unsupported frontmatter key "temperature"/u,
    );
  });

  it('rejects an empty tools list instead of generating a tool-less agent', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/agents/locked.md': [
        '---',
        'name: locked',
        'description: Declares tools but names none',
        'tools: ""',
        '---',
        'Prompt.',
        '',
      ].join('\n'),
    });

    // `tools:` rỗng từng sinh `tools: ""` cho Claude và chỉ một catch-all `deny`
    // Cho OpenCode — hai kết quả khác nhau từ cùng một nguồn mơ hồ. Bỏ hẳn key là
    // Cách duy nhất để nói "giữ bộ tool mặc định".
    await expect(syncAgentConfig(root)).rejects.toThrow(/names no tool/u);
  });

  it('skips non-.md entries in the source instead of failing the whole sync', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/agents/.gitkeep': '',
      '.agents/agents/notes.txt': 'not an agent\n',
      '.agents/agents/reviewer.md': REVIEWER,
    });

    await syncAgentConfig(root);

    // The two destinations are independent checks over the same fixture.
    await Promise.all(
      ['.claude/agents', '.opencode/agents'].map((dest) =>
        expect(listTree(join(root, dest))).resolves.toStrictEqual({ 'reviewer.md': true }),
      ),
    );

    expect(logs.some((line) => line.includes('not a .md agent definition'))).toBe(true);
  });

  it('rejects an unknown tool instead of silently dropping it', async () => {
    expect.hasAssertions();
    const root = await makeRepo({
      '.agents/agents/reviewer.md': [
        '---',
        'name: reviewer',
        'description: Typo in tools',
        'tools: Read, Bashe',
        '---',
        'Prompt.',
        '',
      ].join('\n'),
    });

    await expect(syncAgentConfig(root)).rejects.toThrow(/unknown tool "Bashe"/u);
  });
});
