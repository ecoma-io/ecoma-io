---
name: nx-workspace
description: "Explore and understand the Ecoma Nx workspace. USE WHEN answering questions about workspace projects, project configuration or tasks. ALSO USE WHEN an nx command fails, or before running a task you need to check available targets and resolved configuration. EXAMPLES: 'What projects are in this workspace?', 'How is project X configured?', 'What depends on library Y?', 'What targets can I run?', 'Cannot find configuration for task', 'debug nx task failure'."
---

# Nx Workspace Exploration

Read-only exploration of the Ecoma Nx workspace: workspace structure, resolved
project configuration, available targets, the project graph, and affected
projects. Nothing in this skill changes the workspace.

## Repository invariants

- The package manager is **pnpm** (`packageManager: pnpm@12.10.1` in the root
  `package.json`, workspace defined in `pnpm-workspace.yaml`). Always invoke Nx
  as `pnpm nx <command>`; never bare `nx`, `npx nx`, or `yarn nx`. A globally
  installed `nx` may be an older major version than this workspace uses.
- The workspace runs **Nx 23.3.0** (`nx` and every `@nx/*` package pinned in the
  root `package.json`). Confirm with `pnpm nx --version`; if the reported version
  differs from `package.json`, that is a dependency-install problem, not a
  command problem — surface it instead of working around it.
- Prefer Nx's own discovery output over reading files by hand. The commands below
  return **resolved** configuration: plugin inference and workspace defaults
  included. Reading a single source file shows only part of the picture.

## Listing Projects

```bash
# List all projects (structured output)
pnpm nx show projects --json

# Filter by directory glob
pnpm nx show projects -p 'apps/*'
pnpm nx show projects -p 'libs/*'

# Filter by tag (this repo tags projects with type:, scope:, runtime:)
pnpm nx show projects -p 'tag:scope:public'
pnpm nx show projects -p 'tag:type:lib'
pnpm nx show projects -p 'tag:runtime:edge'

# Filter by project type
pnpm nx show projects --type app
pnpm nx show projects --type lib

# Projects that expose a specific target
pnpm nx show projects --withTarget build
pnpm nx show projects --withTarget typecheck
```

The `-p`/`--projects` filter works across many Nx commands and supports explicit
names, globs, `tag:<name>` references, and negation (`!<pattern>`).

## Project Configuration

Use `pnpm nx show project <name> --json` for a project's full resolved
configuration — targets inferred by plugins included.

**Do not read `project.json` to understand a project.** In this workspace most
projects have no `project.json` at all: their configuration lives in an `nx`
field inside the project's `package.json`, and most targets are _inferred_ by the
plugins configured in `nx.json`. Only reading a source file gives a partial,
sometimes empty, answer.

```bash
# Full resolved configuration (targets included)
pnpm nx show project @ecoma-io/home --json

# Specific fields
pnpm nx show project @ecoma-io/home --json | jq '{name, root, projectType, tags}'
pnpm nx show project @ecoma-io/home --json | jq '.tags'
pnpm nx show project @ecoma-io/home --json | jq -r '.root'
```

## Targets

Targets are what can be run on a project. Which targets a project has is decided
by the plugins in `nx.json` plus any `nx.targets` in its `package.json`.

```bash
# Target names available on a project
pnpm nx show project @ecoma-io/dx --json | jq '.targets | keys'

# Full configuration for one target
pnpm nx show project @ecoma-io/home --json | jq '.targets.build'

# Target inputs/outputs (what feeds caching)
pnpm nx show project @ecoma-io/home --json | jq '.targets.build.inputs'
```

**Always check that a target exists before invoking it.** Target sets differ per
project type, so never assume a target name. `pnpm nx run <project>:<target>`
for a target the project does not have fails with `Cannot find configuration for
task`.

**Scope validation to what changed.** Prefer running a task on the specific
project(s) whose files changed over workspace-wide runs. Use
`pnpm nx run <project>:<target>` for one project, and reach for `run-many` or
`--affected` only when the change genuinely spans projects. Do not default to
running a target across the whole workspace when one project changed —
workspace-wide runs are slow and bury the signal you are looking for.

Read both `executor` and `options` to learn what a target actually runs. The
top-level `command` field is empty on these targets, so do not judge a target by
it. In this workspace most inferred targets (from `@nx/js/typescript`,
`@nx/vitest`, `@nx/nuxt/plugin`) use the generic executor `nx:run-commands`, and
the real executable command is in `options.command` with its working directory in
`options.cwd`. Targets from other plugins use their own executor instead — for
example `lint` from `@nx/oxlint` has `executor: "@nx/oxlint:lint"` and no
`options.command`.

The common target names in this workspace come from the plugins configured in
`nx.json`:

| Target                                                                       | Provided by             |
| ---------------------------------------------------------------------------- | ----------------------- |
| `typecheck`                                                                  | `@nx/js/typescript`     |
| `lint`                                                                       | `@nx/oxlint`            |
| `test`, `test-ci`                                                            | `@nx/vitest`            |
| `build`, `serve`, `build-static`, `serve-static`, `build-deps`, `watch-deps` | `@nx/nuxt/plugin`       |
| `e2e`                                                                        | `@nx/playwright/plugin` |

Projects may also define their own targets (for example `deploy`,
`nuxt-prepare` on the web apps). A plugin only infers targets for projects that
match it, so not every target in the table exists on every project, and one may
exist on no project at all — `e2e` is currently inferred for none, because no
Playwright configuration exists yet. Treat the table as orientation only and
confirm against `pnpm nx show project <name> --json`.

## Dependency Graph

Dependencies come from the project graph Nx builds — from real imports, not from
directory layout. Two libraries in `libs/` are not related merely because their
names look similar.

```bash
# Whole graph as JSON
pnpm nx graph --print

# Dependencies of one project
pnpm nx graph --print | jq '.graph.dependencies["@ecoma-io/home"]'

# Projects that depend on a given library
pnpm nx graph --print | jq -r '.graph.dependencies | to_entries[] | select(.value[].target == "i18n-public") | .key'

# All project names in the graph
pnpm nx graph --print | jq -r '.graph.nodes | keys[]'
```

To answer "what depends on X", query the graph. Do not infer it from names or
from grepping import statements.

## Affected Projects

For affected-project commands, read
[the affected projects reference](references/AFFECTED.md).

## Workspace Configuration

Read `nx.json` for workspace-level configuration:

```bash
jq '.plugins' nx.json
jq '.targetDefaults' nx.json
jq '.namedInputs' nx.json
```

The workspace schema is available at `node_modules/nx/schemas/nx-schema.json`,
and the project schema at `node_modules/nx/schemas/project-schema.json`.

## Troubleshooting

Diagnose from what the workspace actually reports before changing anything:
read the resolved project configuration, the plugin inference in `nx.json`, the
installed versions, and the full error (re-run with `--verbose`). Do not edit
`nx.json` or reset caches as a first move — a cache reset hides a real
configuration or inference problem and the failure returns.

### "Cannot find configuration for task X:target"

The target does not exist on that project.

```bash
# What targets does the project actually have?
pnpm nx show project X --json | jq '.targets | keys'

# Does any project have that target?
pnpm nx show projects --withTarget target
```

### "Failed to load Nx plugin(s)"

Usually the dependencies are not installed for this checkout, not bad
configuration. Check that `node_modules` exists and that `pnpm nx --version`
matches the version pinned in the root `package.json` before touching `nx.json`.

### A project or target is missing from the results

A plugin only infers targets for projects it matches. Check the `include` /
`exclude` options for that plugin in `nx.json`, then confirm with
`pnpm nx show project <name> --json`.

## Boundaries

- This workspace uses `neverConnectToCloud: true` and has no Nx Cloud setup. Do
  not suggest Nx Cloud, remote caching, or cloud commands.
- It uses **oxlint** for linting and **oxfmt** for formatting; there is no
  Prettier. Do not suggest Prettier workflows.
- Project tags encode `type:`, `scope:`, and `runtime:` boundaries that the
  repository enforces (see `.oxlintrc.json` and the root `AGENTS.md`). Respect
  them; do not restate or re-derive their full definitions here.
- For architecture — bounded contexts, DDD layers, dependency direction — consult
  the canonical sources: the root `AGENTS.md` and
  `docs/overview/05-code-architecture.md`. Do not treat this skill as an
  architecture reference, and do not read `docs/overview/*.md` as a description
  of the current implementation.
- Everything here is read-only exploration. Do not run generators, migrations,
  `nx reset`, or `nx sync` as part of exploration.
