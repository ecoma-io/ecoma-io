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

## 3. Document Scope

### `overview/`

- `01-architecture.md`: system boundaries, ownership, deploy units, dependencies, architectural decisions and invariants.
- `02-delivery.md`: Git, Nx, CI/CD, contracts delivery, migrations, environments, release and rollout.
- `03-operations.md`: deployment operations, observability, failure handling, backup/DR, recovery and operational policies.
- `04-platform-facts.md`: verified external platform facts only.
- `05-code-architecture.md`: Nx project structure, Bounded Context, DDD layers, dependency rules, contracts and testing architecture.

`overview/` describes services only at boundary level. Design details, API, storage, procedures and runbooks belong in service documents.

### `services/<service>/`

- `README.md`: navigation and service summary, kept very short.
- `01-architecture.md`: service design, boundary, runtime, data and dependencies.
- `02-requirements.md`: functional/non-functional requirements and non-goals.
- `03-operations.md`: deployment, configuration, monitoring, failure handling, recovery and runbook.

Service documents describe **only that service**.

## 4. Canonical Source

Each fact or decision has exactly **one canonical location**:

| Content                             | Canonical location                 |
| ----------------------------------- | ---------------------------------- |
| System architecture/policy          | `overview/`                        |
| Code architecture                   | `overview/05-code-architecture.md` |
| Service design/behaviour/operations | `services/<service>/`              |
| External platform fact              | `overview/04-platform-facts.md`    |
| Exact API/schema/contract           | Machine-readable contract          |

Do not duplicate the same decision across multiple documents.

## 5. README Index

- `docs/README.md` must reflect the current documentation structure.
- Each `services/<service>/README.md` must reflect the actual documents of that service.
- When **adding, deleting or renaming a document/directory**, update the related README/index files in the same change.
- Do not leave READMEs pointing to documents that do not exist, or missing documents that fall within the README's scope.

## 6. Change Rules

- Do not turn a proposal, roadmap or spike alternative into a committed decision without an architectural decision.
- When changing a decision or platform fact, update the related cross-references and IDs.
- When adding a new document, first clearly define its **scope and canonical location**; do not create a document just to hold a few lines.
- When deleting or merging documents, move any content that remains canonical to the correct location before deleting.

## 7. Service Documentation

Do not create `services/<name>/` if the service has no implementation or written specification.

Do not create empty scaffold documents just to preserve the structure.

Do not add `database.md`, `api.md`, `testing.md` or similar documents merely because a subject appears in the service. Split it out only when the subject has its own **scope, lifecycle or ownership** large enough to warrant it.

## 8. Platform Facts

`overview/04-platform-facts.md` contains only verified facts.

Each fact needs an appropriate source, date/snapshot and confidence.

Do not put recommendations, preferences or architectural decisions in this file.
