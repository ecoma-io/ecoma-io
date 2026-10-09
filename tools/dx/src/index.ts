import { defineCommand } from 'citty';

export const app = defineCommand({
  meta: {
    name: 'Ecoma DX',
    description: 'Devtools for ecoma-io repository',
  },

  // Không có subcommand thì không làm gì; citty hiện usage sau --help.
  run: () => undefined,

  subCommands: {
    // `import()` resolve ra module namespace, nhưng citty cần chính định nghĩa
    // command, nên phải bóc default export ra.
    'repo-prepare': () => import('./repo-prepare.js').then((m) => m.default),
    'sync-agent-config': () => import('./sync-agent-config.js').then((m) => m.default),
    'pr-check': () => import('./pr-check.js').then((m) => m.default),
  },
});
