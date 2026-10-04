import { defineCommand } from 'citty';
import { execFile } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';

import { ROOT_DIR } from './utils.js';

const execFileAsync = promisify(execFile);

/**
 * Git có bỏ qua `path` hay không.
 *
 * Lệnh kiểm tra chạy từ chính thư mục của path chứ không phải từ ROOT_DIR: một
 * path nằm ngoài ROOT_DIR sẽ biến thành đối số `../..`, mà git từ chối với
 * "outside repository" — và sự từ chối đó sẽ bị đọc thành "không bị bỏ qua".
 */
async function isIgnored(path: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', dirname(path), 'check-ignore', '-q', '--', basename(path)]);

    return true;
  } catch {
    return false;
  }
}

/**
 * Viết một CLAUDE.md cạnh mọi AGENTS.md chưa có file đó.
 *
 * AGENTS.md vẫn là source of truth — file được sinh ra chỉ là một include, nên
 * một CLAUDE.md viết tay không bao giờ bị ghi đè. Thư mục bị gitignore được bỏ
 * qua để không đụng tới cây thư mục đã sinh.
 */
export async function genClaudeMD(dir: string = ROOT_DIR): Promise<void> {
  if (await isIgnored(dir)) {
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
      .filter((entry) => entry.isDirectory())
      .map((entry) => genClaudeMD(join(dir, entry.name))),
  );
}

export default defineCommand({
  meta: {
    name: 'gen-claude-md',
    description: 'Generate Claude.md',
  },

  async run() {
    console.log('Generate CLAUDE.md');
    await genClaudeMD();
  },
});
