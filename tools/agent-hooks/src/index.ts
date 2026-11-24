import { defineCommand } from 'citty';

import formatLint from './format-lint-command';

const app = defineCommand({
  meta: {
    name: 'agent-hooks',
    description: 'Hooks cho agent coding (Claude Code, OpenCode) chạy như một tool Nx của repo',
    version: '0.1.0',
  },
  subCommands: {
    'format-lint': formatLint,
  },
});

export default app;
