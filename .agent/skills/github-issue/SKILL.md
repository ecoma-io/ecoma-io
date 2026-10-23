---
name: github-issue
description: Apply when creating, drafting, revising, or reviewing GitHub
  Issues, when searching existing Issues and PRs before starting work, or
  when defining independently trackable implementation work that needs an
  Issue. USE WHEN asked to open an issue, file a bug, track a unit of work,
  or check whether work already exists. NOT for PR titles or PR bodies
  (commitlint, pr-check and the clarity skill govern those).
---

# GitHub Issues

Operationalize the `Workflow` and `Language` sections of the root
`AGENTS.md` for the Issue step: decide whether an Issue should exist, find
existing work, and write the title and body. This skill introduces no
competing process. Writing quality is governed by
`.agent/skills/clarity/SKILL.md` — apply it to every Issue body. The three
Issue forms in `.github/ISSUE_TEMPLATE/` remain the target structures for
the types they cover.

## Repository facts

Verified against the repository and its GitHub configuration at authoring
time; re-verify values with the commands shown before relying on them:

- **Nothing machine-enforces Issue rules.** `pnpm dx pr-check` and
  commitlint validate PR titles and commits only. commitlint never sees an
  Issue title, and the ASCII-only rule applies to commit messages, not to
  Issues.
- The **title is written in English**. This is a repository convention,
  nearly universal in practice, not an enforced rule. Older Issues with
  Vietnamese titles are legacy, not precedent.
- The **body is written in Vietnamese** — a written rule in `AGENTS.md`
  (`Language`). Keep file paths, commands, error codes, identifiers,
  product names and API names unchanged. Explain a technical term in plain
  Vietnamese when the reader needs the explanation; never translate it into
  something less precise.
- Titles conventionally carry a Conventional-Commit-style prefix
  `type(scope): summary` (`feat`, `fix`, `chore`, `docs`, `test`, ...). The
  scope is free-form: an Nx project, a bounded context (`identity`), or an
  area (`dx`). The one-Nx-project scope restriction and the feat/fix commit
  budget are PR/commit rules; do not apply them to Issues.
- Labels in use: `bug`, `enhancement`, `documentation`, `dependencies`,
  plus GitHub defaults (`duplicate`, `good first issue`, `help wanted`,
  `invalid`, `question`, `wontfix`). Confirm with
  `gh label list --repo ecoma-io/ecoma-io` before setting any.
  API-created Issues are commonly unlabeled. Never invent a label.
- No milestones exist and assignees are not used — confirm with
  `gh api repos/ecoma-io/ecoma-io/milestones`. Never set either.

## Decide whether an Issue should exist

Match the request to one case before anything else:

| Case                                                            | Action                                                                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| The user explicitly asks for an Issue                           | Create it, after the search below.                                                                                           |
| Implementation work that must be tracked per `AGENTS.md`        | One Issue per independently trackable unit — work that can land as its own PR and be reviewed on its own.                    |
| Exploratory work with unclear scope                             | Investigate first; create the Issue once the work is defined.                                                                |
| Standalone explanation, advice, or review inside an existing PR | No Issue; deliver the answer in place. Track follow-up work separately only when it becomes an independently trackable unit. |
| Work already tracked by an existing Issue or PR                 | Reuse or link it; never create a parallel one.                                                                               |

Granularity follows the same judgement as PRs: one Issue covers one
independently reviewable logical change. A single PR that fixes six related
findings gets one Issue, not six (see #102). Do not create Issues to appear
thorough. When you discover candidate follow-up work while executing
someone else's unit, record it as a proposal in the current Issue or PR —
create an Issue only when the work qualifies as independently trackable and
your task includes starting it. If the requested outcome cannot be
established from the request and available evidence, ask one focused
question or record the unresolved decision; do not implement under an
invented scope.

## Search before creating

Search existing Issues and PRs, open and closed:

```bash
gh issue list --repo ecoma-io/ecoma-io --state all --search "<keywords>" --limit 20
gh pr list --repo ecoma-io/ecoma-io --state all --search "<keywords>" --limit 20
```

Search by the outcome's domain and purpose — which service, which behavior
— not only by title words. Titles vary widely while outcomes overlap: the
topic "backoffice authentication" spans the decision #116, the
implementation #197, and the enforcement #86, all open at once. Then:

1. Read the body of every plausible candidate; never decide from titles.
2. Classify each candidate: a work unit, a coordination ledger that stays
   open across PRs (#46, #137), a measurement record (#14), or a
   precondition tracker (#62). Never turn a record into your work item, and
   never append new findings to an archived record.
3. State one of three outcomes:
   - **Reuse** — an open Issue already tracks the same outcome. Work under
     it. A task that already has an Issue (including one created for the
     current mission) is reuse, not coincidence.
   - **Link** — same topic, materially different outcome. Reference the
     related Issue in the new body and explain the distinction in one
     sentence.
   - **Create** — the outcome is genuinely uncovered. Say in one sentence
     how it differs from the closest candidate.
4. Treat closed Issues as sources of binding decisions: cite the finding or
   constraint ID instead of re-deriving it (the constraints recorded in
   #102 bind later work on those findings).

If search is unavailable or incomplete, state the limitation. Never claim
duplicate detection was comprehensive when it was not.

## Write the English title

The title must communicate the primary outcome or defect without requiring
the reader to open the body:

- One main, independently trackable outcome. Sub-items belong in the body;
  a title that reads like a changelog of six fixes is a body, not a
  title. A deliberate batch unit is the exception: it may enumerate its
  finding IDs in the title, as #102 does.
- Precise nouns and verbs that say what changes or what is wrong. For
  implementation work prefer a direct action-oriented outcome; for bugs
  describe the defect.
- Name the affected subsystem in the scope when it aids identification.
- Keep exact technical identifiers where they disambiguate
  (`oauth_clients`, `requirePermission`).

Weak — the verb asserts nothing observable on its own:
`Improve the system` · `Fix issue` · `Harden authentication` ·
`Optimize performance` · `Complete Phase 1`

These words are acceptable when qualified by a specific outcome
(`Reduce CI test runtime by ...` states an observable change); alone they
are not.

Strong — outcome-first, in this repository's style:
`Reject expired refresh tokens during session renewal` ·
`Prevent duplicate transactional email jobs` ·
`Document local deployment recovery procedures`

These are style models, not claims that those tasks exist here.

Add the conventional prefix when the type is clear
(`fix(backoffice): ...`, `docs(dx): ...`). There is no length limit, no
`[BUG]` marker convention, and no ASCII constraint: nothing validates Issue
titles.

## Write the Vietnamese body

Apply `.agent/skills/clarity/SKILL.md` to the whole body: purpose,
problem, outcome and completion criteria in short Vietnamese sentences,
one main idea per sentence. Identifiers, paths, commands and error codes
stay in English.

Map the body to the matching form when the type is one of the three form
types — mirror its fields as `##` headings, minus the form widgets:

- Bug (`bug_report.yml`): `## Hiện trạng` (or the form's `Mô tả lỗi`),
  `## Cách tái hiện` (or `Các bước tái hiện`), `## Kỳ vọng`; add
  `## Tiêu chí chấp nhận`, `## Scope`, `## Log / error code`,
  `## Môi trường` when they carry information.
- Feature (`feature_request.yml`): `## Vấn đề` (or `## Mục tiêu`),
  `## Đề xuất` when an approach exists, `## Phạm vi`, `## Tiêu chí chấp
  nhận`, `## Ràng buộc` when meaningful. When the change touches the
  architecture boundaries, state which constraints were considered instead
  of copying the form's checkboxes blindly.
- Documentation (`documentation.yml`): the affected path, what is wrong or
  missing, the source of truth.

Any other kind (ledger, measurement record, decision Issue) uses free
structure. The most frequent headings in existing Issues are `## Bối
cảnh`, `## Phạm vi`, `## Ràng buộc` and `## Mục tiêu`; `## Trạng thái`,
`## Workstreams` and `## Non-goals` belong to coordination ledgers
(#46, #137), while `## Liên quan` also appears on plain work-unit Issues.
Every heading must carry information — no empty placeholders to complete
a template.

Ground every material claim, and keep the categories distinguishable:

- **Đã verify** — current behavior you inspected; name the file, commit or
  command output. #115 is the model: a table of wrong claims with
  `file:line`, anchored to a commit.
- **Yêu cầu của người dùng** — desired behavior as stated by the user.
- **Suy luận** — inference supported by evidence; say from what.
- **Giả thuyết chưa xác minh** — see #14's separation of hypotheses from
  facts. When a bug's root cause is unknown, describe the observed symptom
  and condition, and label the cause as unverified. Never invent repro
  steps, `file:line` references, or benchmark numbers: a number appears
  only when it was measured, with method and environment.

Acceptance criteria (`## Tiêu chí chấp nhận`) state observable outcomes a
reviewer can check — a behavior, a test result, a file state. Quality
words — `tối ưu`, `hoàn thiện`, `mạnh mẽ`, `ổn định`, `đúng chuẩn`,
`hoạt động tốt` — must not stand alone as requirements; replace each with
the specific behavior or verifiable result. A criterion must not merely
restate the objective or prescribe unnecessary implementation detail. Do
not invent thresholds or benchmark targets: define a number only when the
user or repository evidence supports it.

Mark proposals as đề xuất; mark established decisions with their source
(ADR, Issue, user request). A proposal is never written as a decision
(`docs/AGENTS.md` forbids promoting a proposal to a committed decision
without an architectural decision).

Keep the body proportionate: a small change needs a few lines; a
cross-service change needs context, dependencies and explicit non-goals.
Length never compensates for an unclear title — title and body must convey
the same objective.

Pass the body through a file, not an inline shell string, so backticks,
`$` and Vietnamese text survive intact:

```bash
gh issue create --repo ecoma-io/ecoma-io \
  --title "fix(dx): ..." \
  --body-file <path-to-body-file>
```

## Create the Issue safely

- Create only when the task requires it and the search above is done.
- Set only verified, existing values. Prefer no label over an invented
  one; `bug`, `enhancement`, `documentation` match the form types. Never
  set a milestone or assignee.
- Include verified references to related Issues, PRs, documents and
  evidence as exact links (`#N`, paths), not paraphrase.
- If the user asks only for a draft, return the title and body without
  creating.
- Run the creation command, then read the URL from its output. Report the
  Issue URL only after creation succeeds. If it fails, report the actual
  blocker together with the prepared title and body. Never reconstruct a
  URL from an issue number or claim success.
- Security-sensitive work: check `SECURITY.md` at the repository root
  before publishing details in a public Issue. Secret variable names, binding
  paths and rotation mechanisms may be discussed; secret values, tokens,
  cookie contents, prompt/response bodies and customer data never enter an
  Issue, public or private.

Do not reopen, edit, close, or relabel an Issue you did not create without
explicit authorization. Adding information to someone else's Issue happens
through a comment; editing is for Issues your session owns (the ledger
pattern of #46). The `duplicate` label marks a duplicate only after
confirmation, and closing another unit's Issue is not your call. Update
your own Issue to match reality when work completes (`AGENTS.md`,
`Workflow`).

## Review before submitting

Answer these before creating; revise substantiated defects:

1. Can the reader get the main objective from the title alone?
2. Does the body say why the work matters and what result is required?
3. Can every completion criterion be verified without guessing?
4. Are verified facts, user requirements, inferences and unknowns
   distinguishable?
5. Does every heading add necessary information?
6. Could any sentence be read in two materially different ways?
7. Are technical terms and identifiers accurate?
8. Can the body lose wording without losing information an implementer
   needs?
9. Is the Issue genuinely new, properly linked, or correctly reused?
10. Does the content comply with repository policy and the task's
    authorization?

## Boundaries

- This skill governs Issues. PR titles and PR bodies follow the PR policy
  in `AGENTS.md` and `pr-check`; the writing-quality rules are shared
  (`clarity`), the format rules are not.
- Do not modify Issue templates, `AGENTS.md`, GitHub settings, label sets
  or workflows as part of writing an Issue. Propose such changes as their
  own work unit.
- The canonical sources outrank this file: `AGENTS.md` (workflow,
  language), `.agent/skills/clarity/SKILL.md` (writing quality), and the
  forms in `.github/ISSUE_TEMPLATE/`. When they conflict with this file,
  they win and this file should be corrected.
