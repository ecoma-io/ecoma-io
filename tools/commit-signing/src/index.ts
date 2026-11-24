import { defineCommand } from 'citty';

import { checkHeadCommitSignature, checkPushedCommitSignatures } from './commit-signing';
import type { SigningCheckResult } from './commit-signing';

function report(mode: 'head' | 'push', result: SigningCheckResult): void {
  if (result.ok) {
    // Nói rõ đã kiểm bao nhiêu commit: "0" là thông tin có giá trị, người đọc
    // Cần phân biệt "không có gì để kiểm" với "đã kiểm và không thấy vấn đề".
    console.log(
      result.checked === 0
        ? 'Commit signing check passed: nothing to check.'
        : `Commit signing check passed: ${result.checked} unpushed commit(s) are signed.`,
    );
    return;
  }
  const headlines = {
    head: 'Commit signing check failed:',
    push: 'Commit signing check failed:',
  };
  console.error(headlines[mode]);
  for (const problem of result.problems) {
    console.error(problem);
  }

  process.exitCode = 1;
}

export default defineCommand({
  args: {
    check: {
      default: 'push',
      description:
        'Which gate to run: "config" (pre-commit), "head" (post-commit) or "push" (pre-push)',
      type: 'string',
    },
  },

  meta: {
    description: 'Check commit signature of unpushed commits',
    name: 'commit-signing',
  },

  run: () => {
    /* Empty */
  },

  subCommands: {
    head: {
      meta: {
        description: 'Check commit signature of the HEAD commit',
      },
      run: () => {
        const result: SigningCheckResult = checkHeadCommitSignature();
        report('head', result);
      },
    },
    push: {
      meta: {
        description: 'Check commit signature of unpushed commits',
      },
      run: () => {
        const result: SigningCheckResult = checkPushedCommitSignatures();
        report('push', result);
      },
    },
  },
});
