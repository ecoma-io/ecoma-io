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
    'arch-check': () => import('./arch-check.js').then((m) => m.default),
    'gitleaks-scope': () => import('./gitleaks-scope.js').then((m) => m.default),
    'semgrep-scan': () => import('./semgrep-scan.js').then((m) => m.default),
    'commit-signing': () => import('./commit-signing-command.js').then((m) => m.default),
    'provision-gate': () => import('./provision-gate-command.js').then((m) => m.default),
    'local-deploy': () => import('./local-deploy-command.js').then((m) => m.default),
    'local-status': () => import('./local-status-command.js').then((m) => m.default),
    'local-destroy': () => import('./local-destroy-command.js').then((m) => m.default),
    'local-cleanup': () => import('./local-cleanup-command.js').then((m) => m.default),
  },
});
