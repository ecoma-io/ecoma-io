import { defineCommand } from 'citty';
import { runCommand } from './utils';
import { syncAgentConfig } from './sync-agent-config';

export default defineCommand({
  meta: {
    description:
      'Repository preparation: installs Git hooks (lefthook) and synchronizes skills and subagent definitions from `.agents/` to `.claude/` and `.opencode/`.',
    name: 'repo-prepare',
  },
  async run() {
    console.log('Installing git hooks');
    runCommand('pnpm exec lefthook install');

    console.log('Sync agent configuration');
    await syncAgentConfig();
  },
});
