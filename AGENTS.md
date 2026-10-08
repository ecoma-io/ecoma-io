# Repository Instructions

## Source of truth

- Current code/config defines current behavior; inspect it before changing anything.
- `docs/overview/*.md` describes the target design, not necessarily the current implementation. Do not implement planned state merely because it is documented.
- `docs/overview/04-platform-facts.md` contains time-sensitive platform facts; verify current official provider documentation before relying on a platform limit or capability.

## Language

- Write **Vietnamese** in: `docs/` (see `docs/AGENTS.md` for its document rules), code comments and JSDoc, issue bodies, pull request bodies, and README files.
- Keep **English** for: proper nouns, technical and domain terminology, product and service names, framework and library names, protocol names, architecture patterns, API names, configuration keys, file paths, commands, code identifiers, commit messages, and pull request titles.
- Write **English** for: `AGENTS.md` files themselves — they are agent instructions, so they stay English; and test case titles (`it` / `describe` / `test`), which describe behaviour rather than prose.
- Keep **English** in two places that are read by machines or by other tools rather than by a person reading prose: CLI output written with `console.log`, and the `message` fields of the Semgrep rules in `.github/semgrep/`.
- Use Vietnamese for the explanation, rationale and surrounding prose; use English for the term itself. Do not translate a term when translating it would reduce technical precision.
- In an issue or pull request body written in Vietnamese, keep issue titles, branch names, pull request titles, file paths, and error codes unchanged.
- Do not translate existing content just because this policy is new. Apply it when writing or editing.

## Non-negotiable architecture

- One service owns each database; another service must not access that database directly.
- Cross-service communication uses the defined API/event contracts, not shared database access.
- `llm-api` runs on Cloudflare Workers and serves under `/llm`.
- The database is quota authority and settlement authority; quota changes must remain reconstructible from durable database state.
- Inter-service events use the transactional outbox and idempotency.
- Secrets never enter Git, PR builds, or Preview runtime from production environments.
- One Cloudflare account owns every environment; secrets use native Worker Secrets and deployment environment mechanisms.
- Database changes use expand → compatible rollout → contract; prefer forward-fix over data rollback.
- Do not introduce node-local application state that breaks recovery or topology changes.
- Observability must not become a serving-path dependency; never log prompt/response bodies.

## Change discipline

- Preserve existing behavior unless the task explicitly changes the contract.
- Inspect the affected Nx project/graph and repository configuration before editing.
- Make the smallest change that satisfies the task and run the relevant validation before finishing.
- Do not silently resolve documented not yet finalized, proposed or future-phase decisions into implementation.

## Workflow

- Priority: fix bugs first, then feature improvements — unless I ask to prioritise something specific; my call overrides these rules.
- Every non-trivial task gets, in this order, before any code is written — by me directly or by dispatched subagents:
  1. Issue filed, branch pushed to the remote, draft PR opened against the default branch and linking the issue.
  2. Update code and verify it locally before committing.
  3. Push to the PR, monitor CI and Code Review/Scanning, and resolve every problem until CI is green, all conversations are resolved and the PR is ready for review.
- Every commit — mine or a subagent's — is cryptographically signed; never push an unsigned commit. If commit signing isn't available, tell me instead of working around it.
- When a task decomposes into independent units, dispatch them as concurrent subagents (multiple Agent calls in a single message) instead of implementing units one at a time. Put the issue number, branch, and draft PR in each subagent's prompt; give agents that edit the same repo concurrently their own worktree (`isolation: "worktree"`); and dispatch a dependent unit only after the units it depends on have reported back. The coordinating session synthesizes results and routes follow-ups; it does not do the units' file edits itself unless explicitly asked.
- Single-unit work with nothing to parallelize can be done directly, still through the gate above. Requests phrased as handoff/handover are full ownership transfers to a single subagent that carries the unit end to end — no parallel split, no supervision. Report every dispatched subagent in the session summary alongside issues filed.

### Pull requests

- One PR = one independently reviewable logical change; judging that stays a human/AI review responsibility — no check approximates it from file or project counts, and `pr-check` does not inspect the diff. A PR that is neither a feature nor a bug fix (docs, chore, CI, refactor...) is legitimate and uses the `others` template, and a single logical change may still touch several Nx projects, tests, docs and configuration files. Development branches may carry any number of commits — the repository never requires one commit per PR.
- `pnpm dx pr-check` is the machine-enforced PR policy entry point; CI runs it on every PR:
  - PR title: any valid Conventional Commit type (`feat`, `fix`, `chore`, `docs`, `refactor`, `ci`, ...). Scope is optional; when present it must be exactly one valid Nx project, e.g. `fix(dx): ...`. Squash merge makes that title the commit subject and the PR body the commit body, and the title drives changelog generation, so both are written deliberately.
  - Development commits: any number are allowed; zero `feat`/`fix` commits is valid, at most one `feat` or `fix` commit is allowed, and two or more — including `feat` + `fix` together — is invalid.
- Squash merge only: merge commits and rebase merges are disabled, direct merges and direct pushes to `main` are prohibited, and every PR lands through the merge queue — these are GitHub repository/ruleset settings, which `pr-check` deliberately does not pretend to enforce.
- Feed the queue proactively: the moment a PR is approved, its CI is green, and nothing blocks it (no unmerged PR it depends on — stacked children retarget and follow once their base lands), put it into the merge queue immediately; a green PR never sits idle to be batched with others.
- Interdependent work uses GitHub Stacked PRs; keep rebasing the downstream branches so every child stays in sync with the PR it depends on. Rebase onto the latest default branch before pushing and before marking a PR ready for review.
