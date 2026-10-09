## Affected Projects

Find projects affected by changes in the current branch or against a base.

This workspace must use explicit `--base`/`--head` or `--files`/`--uncommitted`/
`--untracked` when the current branch cannot be auto-related to a base. Never
assume an implicit base.

```bash
# Affected with explicit base (recommended when auto-detect may be ambiguous)
pnpm nx show projects --affected --base=main
pnpm nx show projects --affected --base=origin/main

# Affected between two commits
pnpm nx show projects --affected --base=abc123 --head=def456

# Affected by specific files
pnpm nx show projects --affected --files=tools/dx/src/sync-agent-config.ts

# Affected by uncommitted changes
pnpm nx show projects --affected --uncommitted

# Affected by untracked files
pnpm nx show projects --affected --untracked

# Filter further: apps only, or exclude projects by pattern
pnpm nx show projects --affected --type app --base=main
pnpm nx show projects --affected --exclude="@ecoma-io/dx" --base=main
```

Tips:

- `pnpm nx show projects --json --affected --base=main` returns a JSON array and is
  easy to process with `jq`.
- The `--affected` command fails if the base reference does not exist or if git
  history does not allow computing the diff. If it fails, verify the SHAs/refs,
  ensure the remote is up to date, or use `--files` to target specific changed
  paths.
- Do not rely on "auto-detected" behavior on isolated feature branches without
  an upstream; pass explicit refs instead.
- Affected is computed by the project graph against changed files — it reflects
  real dependency changes, not directory proximity.
