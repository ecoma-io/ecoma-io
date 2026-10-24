import { defineCommand } from 'citty';

import { LOCAL_STACK_STEPS, runLocalStackStep, type LocalStackStep } from './local-stack-step.js';

/**
 * Entry của target Nx `local-stack-step` (qua `nx:run-commands`).
 *
 * Đối số bắt buộc `--stack` + `--step` — cặp giá trị này do KHAI BÁO target
 * quyết định (package.json của từng deploy project), không do người dùng gõ tự do. Cả hai
 * được validate fail-closed: tổ hợp sai là lỗi khai báo target, phải nổi lên
 * ngay thay vì chạy nhầm stack.
 */
export default defineCommand({
  meta: {
    name: 'local-stack-step',
    description:
      'Run one local-lane deployment step (up/env/smoke) for one deploy project; invoked by Nx targets, not by hand',
  },

  args: {
    stack: {
      type: 'string',
      description: 'Deploy project name (e.g. platform-deploy)',
      required: true,
    },
    step: {
      type: 'string',
      description: `Which step to run: ${LOCAL_STACK_STEPS.join('|')}`,
      required: true,
    },
    'worktree-root': {
      type: 'string',
      description: 'Worktree root (defaults to the repository ROOT_DIR)',
      required: false,
    },
  },

  async run({ args }) {
    const step = args.step as LocalStackStep;
    if (!LOCAL_STACK_STEPS.includes(step)) {
      console.error(
        `[local-stack-step] unknown step "${args.step}" — expected one of: ${LOCAL_STACK_STEPS.join(', ')}`,
      );
      process.exitCode = 1;
      return;
    }
    process.exitCode = await runLocalStackStep(args.stack, step, {
      worktreeRoot: args['worktree-root'],
    });
  },
});
