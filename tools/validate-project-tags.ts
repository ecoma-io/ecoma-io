// Validates that every Nx project carries exactly one `scope:*` and one
// `kind:*` tag from the known lists, so the module-boundary depConstraints in
// .oxlintrc.json always match a defined policy. Run via `pnpm exec tsx`.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SCOPES = new Set([
  'account',
  'auth',
  'staff-access',
  'transactional-mail',
  'llm-consumer-routing',
  'llm-consumer-tenant',
  'llm-financial',
  'llm-inference',
  'llm-marketplace',
  'llm-seller',
  'llm-serving',
  'llm-usage',
  'kernel',
  'agent-hooks',
  'commit-signing',
  'opencode-cc-hooks-adapter',
  'prepare-repo',
]);
const KINDS = new Set(['domain', 'usecase', 'tooling']);

const roots: string[] = [];
function walk(dir: string): void {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (entry === 'project.json') roots.push(p);
  }
}
for (const top of ['contexts', 'kernels', 'tools']) {
  const p = join(top);
  if (existsSync(p)) walk(p);
}

let failed = false;
for (const file of roots) {
  const project = JSON.parse(readFileSync(file, 'utf8'));
  const name: string = project.name ?? file;
  const tags: string[] = project.tags ?? [];
  const report = (msg: string): void => {
    console.error(`[validate-project-tags] ${name}: ${msg}`);
    failed = true;
  };

  const scopes = tags.filter((t) => t.startsWith('scope:'));
  const kinds = tags.filter((t) => t.startsWith('kind:'));
  const unknown = tags.filter((t) => !t.startsWith('scope:') && !t.startsWith('kind:'));
  if (unknown.length > 0) report(`unknown tag dimensions: ${unknown.join(', ')}`);
  if (scopes.length === 0) report('missing scope:* tag');
  if (scopes.length > 1) report(`multiple scope tags: ${scopes.join(', ')}`);
  if (kinds.length === 0) report('missing kind:* tag');
  if (kinds.length > 1) report(`multiple kind tags: ${kinds.join(', ')}`);
  if (scopes.length === 1 && !SCOPES.has(scopes[0].slice('scope:'.length)))
    report(`unknown scope: ${scopes[0]}`);
  if (kinds.length === 1 && !KINDS.has(kinds[0].slice('kind:'.length)))
    report(`unknown kind: ${kinds[0]}`);
}

if (failed) process.exit(1);
console.log(`[validate-project-tags] OK: ${roots.length} projects checked`);
