# DX Tool Instructions

- Machine-enforceable repository policy lives in DX (`pnpm dx pr-check`): the GitHub Actions step only runs the command, so YAML never re-implements policy. The command enforces exactly the PR policy documented in the root `AGENTS.md` — the title rules and the development-commit `feat`/`fix` invariant — and nothing else: diff inspection, file/project counts and the semantic "one logical change" judgement belong to human/AI review.
- Rules reuse the repository's source of truth: commitlint validates titles and parses development-commit types from the same configuration (parser preset included), never a parallel rule set, a second Conventional Commit parser, a hard-coded Nx project list, or GitHub's `pull_request.commits` count.
- pr-check is deterministic and offline: the development-commit range comes from the event payload's base/head SHAs against the checkout's local git history, and unavailable context or history fails the check closed. Configuration, event data and git access are injectable inputs.
- Treat `ROOT_DIR` as the repository root; commands must not depend on the caller's current working directory, and every command must be deterministic, repeatable and testable.
- Repository preparation must remain safe for repeated execution.
- Recursive repository operations must respect `.gitignore`.
- `CLAUDE.md` is generated from `AGENTS.md`; do not make `CLAUDE.md` the source of truth.
