# Documentation Instructions

## 1. Language

- Documentation in `docs/` is written in **Vietnamese**.
- Keep **technical terms, domain terms, product/service names, framework/library names, protocol names, architecture patterns, identifiers, API names, configuration keys, commands** and other standard terms in English.
- Do not translate a term when translating it would reduce technical precision.

## 2. Documentation Principles

- **Concise first**: use the fewest words while still conveying the full meaning within the correct scope.
- Each document has **one clear responsibility**.
- Do not write long documents that gather many topics together.
- Do not repeat information already present in another document; use references instead of copying.
- If a document regularly exceeds about **200 lines**, consider splitting the scope. Do not aggressively compress a file to the point of losing information, unless you can rephrase more concisely while preserving the information.
- Do not record implementation details that are already evident in source code, configuration, or machine-readable contracts.
- Documentation describes **why / what / boundary / invariant**; source code and configuration describe **how**.
- Documentation describes **target architecture**, not current implementation status. Deltas between target and current reality belong in PR descriptions, not in docs.

## 3. Document Scope

### `architecture/`

- `01-architecture.md`: system boundaries, ownership, deploy units, dependencies, architectural decisions and invariants.
- `02-delivery.md`: Git, Nx, CI/CD, contracts delivery, migrations, environments, release and rollout.
- `03-operations.md`: deployment operations, observability, failure handling, backup/DR, recovery and operational policies.
- `04-platform-facts.md`: verified external platform facts only.
- `05-code-architecture.md`: Nx project structure, Bounded Context, DDD layers, dependency rules, contracts.
- `06-testing.md`: canonical testing architecture — taxonomy, ownership/layout, Nx target contracts, test environment.
- `roadmap.md`: implementation roadmap for upcoming phases — task IDs, dependencies, contract freeze points. It is a plan, not committed architecture policy; decisions it references must live in ADRs or `01-architecture.md`.
- `README.md`: index of the architecture axis (three axes explained).

### `domains/`

- `README.md`: canonical domain map — shared domain language (glossary), bounded context catalog, context map, and genuinely undecided business boundaries.
- `domains/<context>/`: specification of one bounded context — boundary, domain model, contracts, authorization boundary, data ownership. One context may own several deploy units; a deploy unit does not create a context. `llm` and `payment` have no folder yet; their design lives in [`architecture/01-architecture.md`](./architecture/01-architecture.md) §2/§4 and the catalog in [`domains/README.md`](./domains/README.md) §3.

### `solutions/`

- `solutions/<name>/`: specification of one composition, deploy unit or job — design, requirements, runbook. Deploy units that are not bounded contexts (mailer-job, push-notification-job, auth-nonce-prune-job, local-platform) live here. `solutions/backoffice/` is the composition/UI + BFF; `solutions/remote-cache/` is the Remote Cache service spec (Nx-first, multi-tenant SaaS target).

### `domains/README.md` rules

- The domain map describes the **target architecture**. A bounded context stays in the catalog because the architecture docs define it — missing runtime, database or provisioning never removes one. Never mark catalog entries or context-map relations as implemented/unimplemented.
- Distinguish "not yet implemented but architected" (stays in the catalog) from "decision not yet made" (goes to its open-boundaries section only).
- Only genuinely undecided items belong in the open-boundaries section. A decision already settled by an ADR or an overview decision must not be re-listed as open; only the explicitly unresolved part of it may be.
- A deploy-unit spec (or a new app/job) does not create a bounded context. A new context enters the catalog only when the architecture docs define new business responsibility and data ownership.
- Shared infrastructure (`local-platform`, `remote-cache` while disposable build state, `janitor`, `deploys/*`, provisioning projects) is never a bounded context.
- Do not copy the catalog or the context map into other documents; reference [`domains/README.md`](./domains/README.md) instead.

### `solutions/<name>/`

- `README.md`: navigation and service summary, kept very short.
- `01-architecture.md`: service design, boundary, runtime, data and dependencies.
- `02-requirements.md`: functional/non-functional requirements and non-goals.
- `03-operations.md`: deployment, configuration, monitoring, failure handling, recovery and runbook.

Service/composition documents describe **only that service/composition**.

## 4. Canonical Source

Each fact or decision has exactly **one canonical location**:

| Content                                               | Canonical location                          |
| ----------------------------------------------------- | ------------------------------------------- |
| System architecture/policy                            | `architecture/`                             |
| Code architecture                                     | `architecture/05-code-architecture.md`      |
| Testing architecture                                  | `architecture/06-testing.md`                |
| Domain language, bounded context catalog, context map | `domains/README.md`                         |
| Service/composition design/behaviour/operations       | `solutions/<name>/` or `domains/<context>/` |
| External platform fact                                | `architecture/04-platform-facts.md`         |
| Exact API/schema/contract                             | Machine-readable contract                   |

Do not duplicate the same decision across multiple documents.

## 5. README Index

- `docs/README.md` must reflect the current documentation structure.
- Each `solutions/<name>/README.md` and `domains/<context>/README.md` must reflect the actual documents of that service/context.
- When **adding, deleting or renaming a document/directory**, update the related README/index files in the same change.
- Do not leave READMEs pointing to documents that do not exist, or missing documents that fall within the README's scope.

## 6. Change Rules

- Do not turn a proposal, roadmap or spike alternative into a committed decision without an architectural decision.
- When changing a decision or platform fact, update the related cross-references and IDs.
- When adding a new document, first clearly define its **scope and canonical location**; do not create a document just to hold a few lines.
- When deleting or merging documents, move any content that remains canonical to the correct location before deleting.

## 7. Service Documentation

Do not create `solutions/<name>/` or `domains/<context>/` if the service/context has no implementation or written specification.

Do not create empty scaffold documents just to preserve the structure.

Do not add `database.md`, `api.md`, `testing.md` or similar documents merely because a subject appears in the service. Split it out only when the subject has its own **scope, lifecycle or ownership** large enough to warrant it.

## 8. Platform Facts

`architecture/04-platform-facts.md` contains only verified facts.

Each fact needs an appropriate source, date/snapshot and confidence.

Do not put recommendations, preferences or architectural decisions in this file.
