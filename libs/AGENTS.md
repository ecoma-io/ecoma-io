# Library Instructions

- Each directory under `libs/` is an Nx library owned by one bounded context. Naming is flat: `libs/<bc>-domain`, `libs/<bc>-application`, `libs/<bc>-infrastructure`, `libs/<bc>-contracts`. No nested `libs/<bc>/domain`, no generic `libs/domain` or `libs/application`.
- Not every bounded context needs all four libraries; create a layer only when the context actually needs it.
- Tags follow the three-dimension taxonomy (`scope:*`, `type:*`, `runtime:*` — see `docs/overview/05-code-architecture.md` §6): a `libs/<bc>-domain` project carries `type:domain`, an `-application` project `type:application`, an `-infrastructure` project `type:infrastructure`, a `-contracts` project `type:contracts`. `runtime:universal` is an explicit compatibility commitment (a `universal` project may depend only on `universal` projects), not a library default — assign it only when dependencies justify it.
- `domain` → no dependency on `application` or `infrastructure` (enforced transitively); `application` → `domain`; `infrastructure` → `application`/`domain`.
- `contracts` → a provider-owned boundary artifact, not a DDD layer: no domain implementation, no business logic, never a shared domain model. Contracts may be depended on across scopes; their own imports must not reach any implementation type.
- Importing another context's implementation is forbidden unless the architecture explicitly allows it; cross-context access goes through that context's contract.
- Libraries hold reusable domain or technical logic; do not turn them into hidden application/service boundaries, and do not add application-specific infrastructure, deployment logic, secrets, or environment-specific configuration.
- Align dependencies with the library's Nx `scope` and `runtime`; prefer explicit interfaces and dependency injection over importing concrete infrastructure implementations.
- Follow the project's local `AGENTS.md` when present; it overrides these rules for that subtree.
- Canonical reference: [`docs/overview/05-code-architecture.md`](../docs/overview/05-code-architecture.md).
