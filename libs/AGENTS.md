# Library Instructions

- Each directory under `libs/` is an Nx library owned by one bounded context. Naming is flat: `libs/<bc>-domain`, `libs/<bc>-application`, `libs/<bc>-infrastructure`, `libs/<bc>-contracts`. No nested `libs/<bc>/domain`, no generic `libs/domain` or `libs/application`.
- Not every bounded context needs all four libraries; create a layer only when the context actually needs it.
- `domain` → no dependency on `application` or `infrastructure`; `application` → `domain`; `infrastructure` → `application`/`domain`.
- `contracts` → a provider-owned boundary artifact, not a DDD layer: no domain implementation, no business logic, never a shared domain model.
- Importing another context's implementation is forbidden unless the architecture explicitly allows it; cross-context access goes through that context's contract.
- Libraries hold reusable domain or technical logic; do not turn them into hidden application/service boundaries, and do not add application-specific infrastructure, deployment logic, secrets, or environment-specific configuration.
- Align dependencies with the library's Nx `scope` and `runtime`; prefer explicit interfaces and dependency injection over importing concrete infrastructure implementations.
- Follow the project's local `AGENTS.md` when present; it overrides these rules for that subtree.
- Canonical reference: [`docs/overview/05-code-architecture.md`](../docs/overview/05-code-architecture.md).
