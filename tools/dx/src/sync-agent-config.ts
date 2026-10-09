import { defineCommand } from 'citty';
import { execFile } from 'node:child_process';
import type { Dirent, Stats } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

import { ROOT_DIR } from './utils.js';

const execFileAsync = promisify(execFile);

/**
 * Cây skills: `.agent/skills` là source of truth, `.claude/skills` là output sinh.
 *
 * Hai nhãn này chỉ dùng để in thông báo; đường dẫn thật được ghép từ `dir`.
 */
const SKILLS_SOURCE_LABEL = '.agent/skills';
const SKILLS_DEST_LABEL = '.claude/skills';

/** Thư mục gốc git đã resolve, nhớ theo `dir` để khỏi spawn `rev-parse` lặp lại. */
const repoRoots = new Map<string, string>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `error` có mang đúng `code` hay không (exit code của tiến trình, hoặc errno). */
function hasCode(error: unknown, code: number | string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}

/**
 * `stat` trả `null` khi path không tồn tại; mọi lỗi khác (vd `EACCES`) được ném
 * tiếp, vì nuốt chúng thành "không tồn tại" sẽ biến một lỗi quyền thành một lần
 * đồng bộ im lặng.
 */
async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) {
      return null;
    }

    throw error;
  }
}

/** Giống `statOrNull` nhưng không đi theo symlink — dùng cho mọi entry ở đích. */
async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) {
      return null;
    }

    throw error;
  }
}

/** `readdir` trả mảng rỗng khi thư mục chưa tồn tại; mọi lỗi khác được ném tiếp. */
async function readdirOrEmpty(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (hasCode(error, 'ENOENT')) {
      return [];
    }

    throw error;
  }
}

/**
 * Thư mục gốc của git repository chứa `dir`.
 *
 * Resolve một lần rồi nhớ lại: mọi lần kiểm tra ignore sau đó dùng cùng giá trị,
 * nên walker không spawn `git rev-parse` cho từng thư mục.
 */
async function gitRepoRoot(dir: string): Promise<string> {
  const cached = repoRoots.get(dir);
  if (cached !== undefined) {
    return cached;
  }

  let root: string;
  try {
    const { stdout } = await execFileAsync('git', ['-C', dir, 'rev-parse', '--show-toplevel']);
    root = stdout.trim();
  } catch (error) {
    throw new Error(
      `Could not resolve the git repository root for ${dir}: ${errorMessage(error)}`,
      {
        cause: error,
      },
    );
  }

  if (root === '') {
    throw new Error(`Could not resolve the git repository root for ${dir}: git returned no path`);
  }

  repoRoots.set(dir, root);

  return root;
}

/**
 * Git có bỏ qua `path` hay không.
 *
 * Path được truyền dưới dạng tương đối so với gốc repository, và lệnh chạy với
 * `-C repoRoot`: một pattern neo vào gốc như `/build` chỉ so khớp đúng khi git
 * nhìn thấy path đầy đủ tính từ gốc, chứ không phải một `basename` rời rạc.
 *
 * Kết quả được diễn giải chặt: exit code 0 là bị bỏ qua, exit code 1 là không bị
 * bỏ qua, còn mọi kết cục khác (git thiếu, exit 128, path ngoài repository...) là
 * lỗi thật và phải nổi lên — không bao giờ bị đọc thành "không bị bỏ qua", vì như
 * vậy walker sẽ lặng lẽ quét cả `node_modules`.
 */
async function isIgnored(path: string, repoRoot: string): Promise<boolean> {
  const relativePath = relative(repoRoot, path).split(sep).join('/');

  // Chính gốc repository không bao giờ bị bỏ qua, mà git cũng từ chối một path
  // rỗng — trả lời luôn thay vì spawn.
  if (relativePath === '') {
    return false;
  }

  try {
    await execFileAsync('git', ['-C', repoRoot, 'check-ignore', '-q', '--', relativePath]);

    return true;
  } catch (error) {
    if (hasCode(error, 1)) {
      return false;
    }

    throw new Error(`git check-ignore failed for ${relativePath}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

/**
 * Viết một CLAUDE.md cạnh mọi AGENTS.md chưa có file đó.
 *
 * AGENTS.md vẫn là source of truth — file được sinh chỉ là một include, nên một
 * CLAUDE.md viết tay không bao giờ bị ghi đè. Thư mục bị gitignore được bỏ qua để
 * không đụng tới cây thư mục đã sinh, và `.git` bị chặn tường minh: nó không nằm
 * trong `.gitignore`, nên nếu không chặn thì walker sẽ quét toàn bộ object store.
 * Symlink không được đi theo (`isDirectory()` là false với symlink), nên không có
 * đường nào thoát khỏi cây nguồn.
 */
async function generateClaudeFiles(dir: string, repoRoot: string): Promise<void> {
  if (await isIgnored(dir, repoRoot)) {
    return;
  }

  const entries = await readdir(dir, { withFileTypes: true });

  const hasAgents = entries.some((entry) => entry.isFile() && entry.name === 'AGENTS.md');
  const hasClaude = entries.some((entry) => entry.isFile() && entry.name === 'CLAUDE.md');

  if (hasAgents && !hasClaude) {
    const claudePath = join(dir, 'CLAUDE.md');

    await writeFile(claudePath, '@AGENTS.md\n', 'utf8');

    console.log(`created ${relative(ROOT_DIR, claudePath)}`);
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name !== '.git')
      .map((entry) => generateClaudeFiles(join(dir, entry.name), repoRoot)),
  );
}

/**
 * Chắc chắn rằng `target` nằm bên trong `root` trước khi xoá.
 *
 * `.claude/skills` là output sinh tự động nên việc dọn dẹp nó là bình thường,
 * nhưng một lỗi ghép path có thể biến thao tác xoá thành vụ xoá nhầm ra ngoài
 * cây đích.
 */
function assertInside(root: string, target: string): void {
  const relativePath = relative(root, target);

  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Refusing to remove ${target}: it is outside ${root}`);
  }
}

/** Xoá một entry, sau khi chắc chắn nó nằm trong cây đích. */
async function removeInside(root: string, target: string): Promise<void> {
  assertInside(root, target);

  await rm(target, { recursive: true, force: true });
}

/**
 * Copy `sourcePath` sang `destPath`, chỉ khi nội dung thực sự khác.
 *
 * So sánh nội dung trước khi ghi là điều kiện để lần chạy thứ hai không đụng tới
 * file nào và không báo thay đổi. Đích được đọc bằng `lstat`: một symlink ở đích
 * bị thay bằng file thật thay vì ghi xuyên qua nó.
 */
async function copyFileIfChanged(
  sourcePath: string,
  destPath: string,
  destRoot: string,
  label: string,
): Promise<void> {
  const destStat = await lstatOrNull(destPath);

  if (destStat !== null && destStat.isFile() && !destStat.isSymbolicLink()) {
    const [sourceContents, destContents] = await Promise.all([
      readFile(sourcePath),
      readFile(destPath),
    ]);

    if (sourceContents.equals(destContents)) {
      return;
    }

    await copyFile(sourcePath, destPath);
    console.log(`updated ${label}`);

    return;
  }

  if (destStat !== null) {
    // Đích đang là thư mục hoặc symlink trong khi nguồn là file: dọn kiểu cũ
    // trước khi ghi, để không ghi xuyên qua nó.
    await removeInside(destRoot, destPath);
    await copyFile(sourcePath, destPath);
    console.log(`updated ${label}`);

    return;
  }

  await copyFile(sourcePath, destPath);
  console.log(`copied ${label}`);
}

/**
 * Đồng bộ đệ quy một thư mục nguồn sang đích: đích trở thành bản sao đúng của
 * nguồn — thêm file mới, cập nhật file đổi, xoá entry không còn ở nguồn.
 *
 * Nguồn tôn trọng `.gitignore`; đích thì không, vì nó là output sinh tự động.
 * Symlink trong nguồn bị bỏ qua kèm thông báo: đi theo một symlink có thể đọc
 * file nằm ngoài cây nguồn, mà cây skills không cần tới symlink — bỏ qua là lựa
 * chọn an toàn. Entry bị bỏ qua cũng không được tính là có mặt ở nguồn, nên bản
 * sao cũ của nó ở đích sẽ bị dọn.
 */
async function mirror(
  sourceDir: string,
  destDir: string,
  destRoot: string,
  repoRoot: string,
  base: string,
): Promise<void> {
  const sourceEntries = await readdir(sourceDir, { withFileTypes: true });

  const effective: { entry: Dirent; sourcePath: string; relativePath: string }[] = [];

  for (const entry of sourceEntries) {
    const sourcePath = join(sourceDir, entry.name);
    const relativePath = base === '' ? entry.name : `${base}/${entry.name}`;

    if (await isIgnored(sourcePath, repoRoot)) {
      continue;
    }

    if (entry.isSymbolicLink()) {
      console.log(`skipped symlink ${SKILLS_SOURCE_LABEL}/${relativePath}`);
      continue;
    }

    effective.push({ entry, sourcePath, relativePath });
  }

  const effectiveNames = new Set(effective.map(({ entry }) => entry.name));

  for (const entry of await readdirOrEmpty(destDir)) {
    if (effectiveNames.has(entry.name)) {
      continue;
    }

    const label = `${SKILLS_DEST_LABEL}/${base === '' ? entry.name : `${base}/${entry.name}`}`;

    await removeInside(destRoot, join(destDir, entry.name));
    console.log(`removed ${label}`);
  }

  for (const { entry, sourcePath, relativePath } of effective) {
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      const destStat = await lstatOrNull(destPath);

      if (destStat !== null && !destStat.isDirectory()) {
        await removeInside(destRoot, destPath);
      }

      await mkdir(destPath, { recursive: true });
      await mirror(sourcePath, destPath, destRoot, repoRoot, relativePath);
    } else if (entry.isFile()) {
      await copyFileIfChanged(
        sourcePath,
        destPath,
        destRoot,
        `${SKILLS_DEST_LABEL}/${relativePath}`,
      );
    }
  }
}

/**
 * Đồng bộ `.agent/skills` sang `.claude/skills`.
 *
 * Nguồn thiếu thì bỏ qua kèm thông báo và để nguyên đích — không tạo, không xoá.
 * Nguồn tồn tại (kể cả rỗng) thì đích được đồng bộ thành bản sao đúng của nguồn.
 */
async function syncSkills(dir: string, repoRoot: string): Promise<void> {
  const source = join(dir, '.agent', 'skills');
  const dest = join(dir, '.claude', 'skills');

  const sourceStat = await statOrNull(source);

  if (sourceStat === null) {
    console.log(`Skipped skills sync: ${SKILLS_SOURCE_LABEL} does not exist`);

    return;
  }

  if (!sourceStat.isDirectory()) {
    throw new Error(`${SKILLS_SOURCE_LABEL} is not a directory: ${source}`);
  }

  const destStat = await lstatOrNull(dest);

  // Đích là output sinh tự động, nhưng không vì thế mà xoá bừa: một file lạc ở
  // đúng vị trí `.claude/skills` là trạng thái hỏng, và ghi đè nó sẽ là đoán mò.
  if (destStat !== null && !destStat.isDirectory()) {
    throw new Error(`${SKILLS_DEST_LABEL} exists but is not a directory: ${dest}`);
  }

  await mkdir(dest, { recursive: true });

  await mirror(source, dest, dest, repoRoot, '');
}

/**
 * Đồng bộ cấu hình agent cho repository.
 *
 * Hai việc: sinh `CLAUDE.md` cạnh mỗi `AGENTS.md` còn thiếu, và đồng bộ
 * `.agent/skills` sang `.claude/skills`. Idempotent: chạy lại không sinh thêm
 * thay đổi nào.
 */
export async function syncAgentConfig(dir: string = ROOT_DIR): Promise<void> {
  const repoRoot = await gitRepoRoot(dir);

  await generateClaudeFiles(dir, repoRoot);
  await syncSkills(dir, repoRoot);
}

export default defineCommand({
  meta: {
    name: 'sync-agent-config',
    description: 'Sync agent configuration',
  },

  async run() {
    console.log('Sync agent configuration');
    await syncAgentConfig();
  },
});
