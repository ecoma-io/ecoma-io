import { defineCommand } from 'citty';
import { execFile } from 'node:child_process';
import type { Dirent, Stats } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

import { parseAgentSource, renderClaudeAgent, renderOpencodeAgent } from './agent-frontmatter';
import type { AgentSource } from './agent-frontmatter';
import { parseSkillSource } from './skill-frontmatter';
import { ROOT_DIR, gitEnv } from './utils';

const execFileAsync = promisify(execFile),
  /**
   * Cây nguồn `.agents/` là source of truth; mỗi đích là output sinh.
   *
   * Nhãn chỉ dùng để in thông báo; đường dẫn thật được ghép từ `dir`.
   */
  AGENTS_SOURCE_LABEL = '.agents/agents',
  SKILLS_SOURCE_LABEL = '.agents/skills';

/**
 * Mỗi đích nhận một bản sao của cùng cây nguồn.
 *
 * Claude Code chỉ đọc skill từ `.claude/skills/` và subagent từ `.claude/agents/`.
 * OpenCode đọc `.opencode/skills/` và `.opencode/agents/`. Không đích nào đọc
 * trực tiếp `.agents/`, nên mọi đích đều phải được sinh.
 */
interface AgentTarget {
  /** `agent-frontmatter` renderer dùng cho đích này. */
  readonly format: 'claude' | 'opencode';
  readonly skills: string;
  readonly agents: string;
}

const TARGETS: readonly AgentTarget[] = [
    { agents: '.claude/agents', format: 'claude', skills: '.claude/skills' },
    { agents: '.opencode/agents', format: 'opencode', skills: '.opencode/skills' },
  ],
  /** Thư mục gốc git đã resolve, nhớ theo `dir` để khỏi spawn `rev-parse` lặp lại. */
  repoRoots = new Map<string, string>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `error` có mang đúng `code` hay không (exit code của tiến trình, hoặc errno). */
function hasCode(error: unknown, code: number | string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}

/**
 * `lstat` trả `null` khi path không tồn tại; mọi lỗi khác (vd `EACCES`) được ném
 * tiếp, vì nuốt chúng thành "không tồn tại" sẽ biến một lỗi quyền thành một lần
 * đồng bộ im lặng.
 *
 * Dùng `lstat` chứ không phải `stat` ở mọi chỗ: một symlink phải được nhìn thấy
 * là symlink để bị từ chối hoặc thay thế, chứ không phải để đi theo nó rồi ghi
 * xuyên qua.
 */
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
    const { stdout } = await execFileAsync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      env: gitEnv(),
    });
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
  // Rỗng — trả lời luôn thay vì spawn.
  if (relativePath === '') {
    return false;
  }

  try {
    await execFileAsync('git', ['-C', repoRoot, 'check-ignore', '-q', '--', relativePath], {
      env: gitEnv(),
    });

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
 * Chắc chắn rằng `target` nằm bên trong cây `root` trước khi xoá.
 *
 * Các thư mục đích là output sinh tự động nên việc dọn dẹp chúng là bình thường,
 * nhưng một lỗi ghép path có thể biến thao tác xoá thành vụ xoá nhầm ra ngoài
 * cây đích.
 *
 * Thoát ra ngoài chỉ khi tương đối bắt đầu bằng đúng một thành phần `..` (hoặc
 * `../`): so khớp `startsWith('..')` sẽ từ chối nhầm một entry tên `..data`, và vì
 * `repo-prepare` chạy trong `pnpm prepare`, một từ chối nhầm như vậy làm hỏng cả
 * bước chuẩn bị repository.
 */
function assertInside(root: string, target: string): void {
  const relativePath = relative(root, target);

  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Refusing to remove ${target}: it is outside ${root}`);
  }
}

/**
 * Xoá một entry, sau khi chắc chắn nó nằm trong cây đích.
 *
 * `rm` không đi theo symlink ở chính `target`, nên các thư mục cha là thứ duy nhất
 * có thể làm lệnh xoá rơi ra ngoài cây đích. Những thư mục cha đó đã được
 * `assertNoSymlinkPath` kiểm tra trước mọi lần ghi hoặc xoá, và trong một lần chạy
 * chúng chỉ được tạo bởi chính lệnh này — nên không cần thêm phép kiểm tra symlink
 * ở đây. `assertInside` vẫn được giữ như một lớp phòng thủ độc lập: nó chặn
 * `..`, đường dẫn tuyệt đối và việc xoá nhầm chính gốc, tức những sai sót ghép
 * path mà phép kiểm tra symlink không nhìn thấy.
 */
async function removeInside(root: string, target: string): Promise<void> {
  assertInside(root, target);

  await rm(target, { force: true, recursive: true });
}

/**
 * Chặn đích đi qua symlink trước khi ghi hay xoá bất cứ thứ gì.
 *
 * `assertInside` so khớp chuỗi path, nên nó không thấy được một symlink ở chính
 * đường dẫn tới đích: khi `.claude` là symlink, mọi thao tác trên `.claude/skills`
 * vẫn "trông như" nằm trong repository nhưng thực tế lại rơi vào thư mục mà
 * symlink trỏ tới — xoá và ghi ra ngoài repository. Vì vậy phải kiểm tra từng
 * thành phần đường dẫn tới đích, và từ chối thay vì đoán ý người dùng.
 */
async function assertNoSymlinkPath(dir: string, segments: string[]): Promise<string> {
  // Duyệt đệ quy từng thành phần: dừng ngay ở segment đầu tiên vắng mặt, nên mỗi
  // Phép lstat phải chờ kết quả của phép trước.
  const check = async (current: string, [head, ...tail]: string[]): Promise<void> => {
    if (head === undefined) {
      return;
    }

    const next = join(current, head),
      stats = await lstatOrNull(next);

    if (stats === null) {
      // Phần còn lại chưa tồn tại: `mkdir -p` sẽ tạo thư mục thật, không symlink.
      return;
    }

    if (stats.isSymbolicLink()) {
      throw new Error(
        `Refusing to sync agent configuration: ${relative(dir, next)} is a symbolic link`,
      );
    }

    await check(next, tail);
  };

  await check(dir, segments);

  return join(dir, ...segments);
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
    // Trước khi ghi, để không ghi xuyên qua nó.
    await removeInside(destRoot, destPath);
    await copyFile(sourcePath, destPath);
    console.log(`updated ${label}`);

    return;
  }

  await copyFile(sourcePath, destPath);
  console.log(`copied ${label}`);
}

/** Ghi `contents` vào `destPath`, chỉ khi nội dung thực sự khác. */
async function writeIfChanged(
  destPath: string,
  contents: string,
  destRoot: string,
  label: string,
): Promise<void> {
  const destStat = await lstatOrNull(destPath);

  if (destStat !== null && destStat.isFile() && !destStat.isSymbolicLink()) {
    if ((await readFile(destPath, 'utf8')) === contents) {
      return;
    }

    await writeFile(destPath, contents, 'utf8');
    console.log(`updated ${label}`);

    return;
  }

  if (destStat !== null) {
    await removeInside(destRoot, destPath);
    await writeFile(destPath, contents, 'utf8');
    console.log(`updated ${label}`);

    return;
  }

  await writeFile(destPath, contents, 'utf8');
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
  labelRoot: string,
  repoRoot: string,
  sourceLabel: string,
  base: string,
): Promise<void> {
  const sourceEntries = await readdir(sourceDir, { withFileTypes: true }),
    // Mỗi entry được kiểm ignore bằng một spawn git riêng; các entry độc lập với
    // nhau nên được kiểm song song.
    ignoredStatuses = await Promise.all(
      sourceEntries.map(async (entry) => ({
        entry,
        ignored: await isIgnored(join(sourceDir, entry.name), repoRoot),
        relativePath: base === '' ? entry.name : `${base}/${entry.name}`,
      })),
    ),
    effective = ignoredStatuses
      .filter(({ entry, ignored }) => {
        if (ignored) {
          return false;
        }

        if (entry.isSymbolicLink()) {
          console.log(
            `skipped symlink ${sourceLabel}/${base === '' ? entry.name : `${base}/${entry.name}`}`,
          );
          return false;
        }

        return true;
      })
      .map(({ entry, relativePath }) => ({
        entry,
        relativePath,
        sourcePath: join(sourceDir, entry.name),
      })),
    effectiveNames = new Set(effective.map(({ entry }) => entry.name)),
    // Entry thừa ở đích là các cây độc lập; xoá song song.
    stale = (await readdirOrEmpty(destDir)).filter((entry) => !effectiveNames.has(entry.name));
  await Promise.all(
    stale.map(async (entry) => {
      await removeInside(destRoot, join(destDir, entry.name));
      console.log(`removed ${relative(labelRoot, join(destDir, entry.name))}`);
    }),
  );

  // Mỗi entry nguồn có cây đích riêng, không đụng chéo nhau; đồng bộ song song.
  await Promise.all(
    effective.map(async ({ entry, sourcePath, relativePath }) => {
      const destPath = join(destDir, entry.name);

      if (entry.isDirectory()) {
        const destStat = await lstatOrNull(destPath);

        if (destStat !== null && !destStat.isDirectory()) {
          await removeInside(destRoot, destPath);
        }

        await mkdir(destPath, { recursive: true });
        await mirror(
          sourcePath,
          destPath,
          destRoot,
          labelRoot,
          repoRoot,
          sourceLabel,
          relativePath,
        );
      } else if (entry.isFile()) {
        await copyFileIfChanged(sourcePath, destPath, destRoot, relative(labelRoot, destPath));
      }
    }),
  );
}

/**
 * Validate contract tối thiểu của mọi skill directory trực tiếp dưới nguồn.
 *
 * Mirror copy nguyên văn, nên một skill hỏng — thiếu `SKILL.md`, thiếu
 * frontmatter, `name` lệch thư mục — từng được copy y nguyên và thành một skill
 * mà loader của Claude Code bỏ qua im lặng: đích sinh ra trông đầy đủ nhưng
 * thiếu skill thật. Đó là lý do lỗi phải huỷ cả lần đồng bộ thay vì bỏ qua một
 * skill, và lý do hàm này phải chạy trước khi đích bị đụng tới.
 *
 * Contract chỉ bao `SKILL.md` ở đỉnh mỗi skill directory; file lồng sâu hơn
 * (`references/**`...) là dữ liệu tuỳ ý của skill. Entry không phải thư mục
 * thật (file rời, symlink) giữ nguyên hành vi mirror cũ: file được copy,
 * symlink bị bỏ qua kèm thông báo.
 */
async function validateSkills(sourceDir: string, repoRoot: string): Promise<void> {
  const entries = await readdir(sourceDir, { withFileTypes: true });

  // Mỗi skill directory được validate độc lập (spawn git riêng cho mỗi phép kiểm
  // Ignore); chạy song song, một lỗi nào đó cũng huỷ cả lần đồng bộ.
  await Promise.all(
    entries.map(async (entry) => {
      const skillDir = join(sourceDir, entry.name);

      if (await isIgnored(skillDir, repoRoot)) {
        return;
      }

      // `readdir({ withFileTypes: true })` dùng ngữ nghĩa `lstat`: một symlink
      // Trỏ vào thư mục có `isDirectory() === false`, nên điều kiện này lọc cả
      // Symlink — thứ mirror cũng bỏ qua, thay vì đi theo nó.
      if (!entry.isDirectory()) {
        return;
      }

      const label = `${SKILLS_SOURCE_LABEL}/${entry.name}`,
        skillMdLabel = `${label}/SKILL.md`,
        skillMdPath = join(skillDir, 'SKILL.md'),
        skillMdStat = await lstatOrNull(skillMdPath);

      if (skillMdStat === null) {
        throw new Error(`${skillMdLabel} is missing; every skill directory must provide SKILL.md`);
      }

      if (skillMdStat.isSymbolicLink()) {
        // Mirror sẽ bỏ qua symlink này và sinh ra một skill không có `SKILL.md`;
        // Lỗi nguồn phải nổi ra thay vì được dịch thành output thiếu file.
        throw new Error(`${skillMdLabel} must be a regular file, not a symbolic link`);
      }

      if (!skillMdStat.isFile()) {
        throw new Error(`${skillMdLabel} must be a regular file`);
      }

      if (await isIgnored(skillMdPath, repoRoot)) {
        // Mirror tôn trọng gitignore nên file này sẽ không được copy: đích sinh ra
        // Một skill thiếu SKILL.md — đúng hỏng hóc mà validation tồn tại để chặn.
        throw new Error(
          `${skillMdLabel} is gitignored; the mirrored skill would be missing its SKILL.md`,
        );
      }

      const skill = parseSkillSource(await readFile(skillMdPath, 'utf8'), skillMdLabel);

      // `name` là danh tính skill mà cả hai loader đọc; lệch tên thư mục thì đích
      // Chứa một skill mang tên khác với nơi nó nằm.
      if (skill.name !== entry.name) {
        throw new Error(
          `${label}: "name" must match the directory name ("${entry.name}"), got "${skill.name}"`,
        );
      }
    }),
  );
}

/**
 * Đồng bộ `.agents/skills` sang `destLabel`.
 *
 * Nguồn thiếu thì bỏ qua kèm thông báo và để nguyên đích — không tạo, không xoá.
 * Nguồn tồn tại (kể cả rỗng) thì đích được đồng bộ thành bản sao đúng của nguồn,
 * sau khi mọi skill directory đã được validate: một nguồn hỏng huỷ cả lần đồng
 * bộ cho đích này thay vì để mirror sinh output một nửa.
 */
async function syncSkills(dir: string, repoRoot: string, destLabel: string): Promise<void> {
  const source = await assertNoSymlinkPath(dir, ['.agents', 'skills']),
    sourceStat = await lstatOrNull(source);

  if (sourceStat === null) {
    console.log(`Skipped skills sync to ${destLabel}: ${SKILLS_SOURCE_LABEL} does not exist`);

    return;
  }

  if (!sourceStat.isDirectory()) {
    throw new Error(`${SKILLS_SOURCE_LABEL} is not a directory: ${source}`);
  }

  // Validate trước khi đích bị đụng tới: một skill hỏng phải huỷ cả lần đồng bộ
  // Cho đích này thay vì để mirror chạy được một nửa rồi mới chết.
  await validateSkills(source, repoRoot);

  const [destParent, destName] = destLabel.split('/'),
    dest = await assertNoSymlinkPath(dir, [destParent, destName]),
    destStat = await lstatOrNull(dest);

  // Đích là output sinh tự động, nhưng không vì thế mà xoá bừa: một file lạc ở
  // Đúng vị trí đích là trạng thái hỏng, và ghi đè nó sẽ là đoán mò.
  if (destStat !== null && !destStat.isDirectory()) {
    throw new Error(`${destLabel} exists but is not a directory: ${dest}`);
  }

  await mkdir(dest, { recursive: true });

  await mirror(source, dest, dest, dir, repoRoot, SKILLS_SOURCE_LABEL, '');
}

/**
 * Đọc và validate mọi định nghĩa subagent trong `.agents/agents`.
 *
 * Trả mảng rỗng khi thư mục nguồn vắng mặt — khác với "có nhưng rỗng": một nguồn
 * rỗng hợp lệ sẽ dọn sạch đích, còn nguồn vắng mặt thì đích phải được giữ nguyên.
 */
async function readAgents(
  sourceDir: string,
  repoRoot: string,
): Promise<{ name: string; agent: AgentSource }[] | null> {
  const sourceStat = await lstatOrNull(sourceDir);

  if (sourceStat === null) {
    return null;
  }

  if (!sourceStat.isDirectory()) {
    throw new Error(`${AGENTS_SOURCE_LABEL} is not a directory: ${sourceDir}`);
  }

  const entries = await readdir(sourceDir, { withFileTypes: true }),
    // Mỗi định nghĩa agent được đọc và validate độc lập; chạy song song. Một lỗi
    // Nguồn nào cũng huỷ cả lần đồng bộ nhờ Promise.all.
    parsed = await Promise.all(
      entries.map(async (entry) => {
        const sourcePath = join(sourceDir, entry.name);

        if (await isIgnored(sourcePath, repoRoot)) {
          return;
        }

        if (entry.isSymbolicLink()) {
          console.log(`skipped symlink ${AGENTS_SOURCE_LABEL}/${entry.name}`);
          return;
        }

        // Chỉ `.md` là định nghĩa agent. Entry khác (`.gitkeep`, `README`, thư mục)
        // Bị bỏ qua kèm thông báo thay vì làm hỏng cả lần đồng bộ: một file rác
        // Trong thư mục nguồn không phải lý do để mọi agent ngừng được sinh.
        if (!entry.isFile() || extname(entry.name) !== '.md') {
          console.log(`skipped ${AGENTS_SOURCE_LABEL}/${entry.name}: not a .md agent definition`);
          return;
        }

        const label = `${AGENTS_SOURCE_LABEL}/${entry.name}`,
          agent = parseAgentSource(await readFile(sourcePath, 'utf8'), label),
          expectedName = basename(entry.name, '.md');

        // `name` là danh tính agent cho cả hai đích, còn tên file là thứ quyết định
        // Agent ID ở `opencode`. Lệch nhau thì hai đích nhìn thấy hai agent khác
        // Tên, nên đây là lỗi nguồn chứ không phải chi tiết định dạng.
        if (agent.name !== expectedName) {
          throw new Error(
            `${label}: "name" must match the file name ("${expectedName}"), got "${agent.name}"`,
          );
        }

        return { agent, name: agent.name };
      }),
    );

  // Thứ tự nguồn được giữ nguyên sau khi lọc bỏ entry bị bỏ qua.
  return parsed.filter(
    (agent): agent is { name: string; agent: AgentSource } => agent !== undefined,
  );
}

/**
 * Sinh định nghĩa subagent cho mọi đích.
 *
 * Đích là bản sao đúng của nguồn: file không còn ở nguồn bị xoá. Nguồn vắng mặt
 * thì mọi đích được giữ nguyên.
 */
async function syncAgents(dir: string, repoRoot: string): Promise<void> {
  const source = await assertNoSymlinkPath(dir, ['.agents', 'agents']),
    agents = await readAgents(source, repoRoot);

  if (agents === null) {
    console.log(`Skipped agents sync: ${AGENTS_SOURCE_LABEL} does not exist`);

    return;
  }

  // Các đích được đồng bộ tuần tự: một đích hỏng để đích còn lại nguyên vẹn và
  // Lần chạy kế tiếp tự hoà chính. Chuỗi promise thay cho vòng lặp await.
  const names = new Set(agents.map((agent) => `${agent.name}.md`)),
    syncTarget = async (target: AgentTarget): Promise<void> => {
      const [destParent, destName] = target.agents.split('/'),
        writeAgent =
          (dest: string) =>
          (agent: { name: string; agent: AgentSource }): Promise<void> => {
            const destPath = join(dest, `${agent.name}.md`);

            if (target.format === 'claude') {
              return writeIfChanged(
                destPath,
                renderClaudeAgent(agent.agent),
                dest,
                relative(dir, destPath),
              );
            }

            const rendered = renderOpencodeAgent(agent.agent);

            for (const warning of rendered.warnings) {
              console.log(`${AGENTS_SOURCE_LABEL}/${agent.name}.md: ${warning}`);
            }

            return writeIfChanged(destPath, rendered.contents, dest, relative(dir, destPath));
          },
        syncDest = async (dest: string): Promise<void> => {
          const destStat = await lstatOrNull(dest);

          if (destStat !== null && !destStat.isDirectory()) {
            throw new Error(`${target.agents} exists but is not a directory: ${dest}`);
          }

          await mkdir(dest, { recursive: true });

          // Entry thừa ở đích là các cây độc lập; xoá song song.
          const stale = (await readdirOrEmpty(dest)).filter((entry) => !names.has(entry.name));
          await Promise.all(
            stale.map(async (entry) => {
              await removeInside(dest, join(dest, entry.name));
              console.log(`removed ${relative(dir, join(dest, entry.name))}`);
            }),
          );

          // Mỗi agent ghi ra file riêng, không đụng chéo nhau; ghi song song.
          await Promise.all(agents.map(writeAgent(dest)));
        };
      const dest = await assertNoSymlinkPath(dir, [destParent, destName]);
      await syncDest(dest);
    };

  await TARGETS.reduce(
    (previous, target) => previous.then(() => syncTarget(target)),
    Promise.resolve(),
  );
}

/**
 * Đồng bộ cấu hình agent cho repository.
 *
 * Hai việc: mirror `.agents/skills` sang mọi đích, và sinh định nghĩa subagent
 * từ `.agents/agents` cho mọi đích. Idempotent: chạy lại không sinh thêm thay
 * đổi nào.
 *
 * Các đích được ghi tuần tự và không có giao dịch chung: nếu lệnh hỏng giữa
 * chừng, đích đã ghi xong có thể lệch với đích còn lại cho tới lần chạy sau.
 * Không có cách nào tránh điều đó mà vẫn ghi thẳng vào chỗ hai tool đọc, và vì
 * bước này chạy lại an toàn, lần chạy kế tiếp tự hoà chính — đó là lý do hành vi
 * này được ghi nhận chứ không được xử lý bằng một cơ chế swap phức tạp hơn.
 */
export async function syncAgentConfig(dir: string = ROOT_DIR): Promise<void> {
  const repoRoot = await gitRepoRoot(dir);

  // Skills sync validate và ghi theo từng đích; chuỗi promise giữ nguyên thứ tự
  // Tuần tự giữa các đích.
  await TARGETS.reduce(
    (previous, target) => previous.then(() => syncSkills(dir, repoRoot, target.skills)),
    Promise.resolve(),
  );

  await syncAgents(dir, repoRoot);
}

export default defineCommand({
  meta: {
    description: 'Sync agent configuration',
    name: 'sync-agent-config',
  },

  async run() {
    console.log('Sync agent configuration');
    await syncAgentConfig();
  },
});
