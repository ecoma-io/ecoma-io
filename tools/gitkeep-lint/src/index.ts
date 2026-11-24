import { defineCommand } from 'citty';
import { resolve } from 'node:path';

import { checkGitkeepFiles, collectGitkeepFiles, findRepositoryGitkeepFiles } from './gitkeep-lint';

/**
 * Positional args là danh sách file/thư mục cần lint, relative với cwd (kiểu
 * oxfmt); không có positional thì quét toàn bộ working tree (chế độ CI).
 */
export default defineCommand({
  meta: {
    description: 'Check .gitkeep files only exist in empty directories',
    name: 'gitkeep-lint',
  },

  run: (ctx) => {
    const targets = ctx.args._ as string[];

    let keepFiles: string[];
    if (targets.length === 0) {
      keepFiles = findRepositoryGitkeepFiles();
    } else {
      keepFiles = [];
      for (const target of targets) {
        try {
          keepFiles.push(...collectGitkeepFiles(resolve(process.cwd(), target)));
        } catch (error) {
          console.error(`gitkeep-lint: ${target}: ${(error as Error).message}`);
          process.exitCode = 1;
          return;
        }
      }
    }

    const violations = checkGitkeepFiles(keepFiles);
    if (violations.length === 0) {
      // Số 0 cũng có giá trị: phân biệt "không có gì để kiểm" với "đã kiểm và sạch".
      console.log(
        keepFiles.length === 0
          ? 'Gitkeep lint passed: no .gitkeep files found.'
          : `Gitkeep lint passed: ${keepFiles.length} .gitkeep file(s) checked.`,
      );
      return;
    }
    console.error(`Gitkeep lint failed: ${violations.length} redundant .gitkeep file(s):`);
    for (const violation of violations) {
      console.error(`  ${violation}`);
    }
    process.exitCode = 1;
  },
});
