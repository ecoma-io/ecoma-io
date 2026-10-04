# Application Instructions

- `apps/` holds only runtime, composition and deploy projects — each directory is an independent Nx deploy unit (web app, Worker service, infrastructure app). It is not a place for arbitrary project types; contract projects live with their bounded context (`libs/<bc>-contracts` — see `docs/overview/05-code-architecture.md`).
- An app is a composition root: wire the libraries its bounded contexts need; keep business logic in `libs/`.
- Preserve the project's Nx `type`, `scope`, and `runtime` boundaries. Do not bypass module-boundary rules to access another domain.
- A project must access another project's data only through its defined API, event contract, or other explicitly documented interface; never access another service's database directly.
- Keep deploy units independently buildable, testable, releasable, and deployable.
- Do not introduce shared mutable state or node-local state that violates the architecture's recovery/topology requirements.
- Runtime-specific code must respect its Nx `runtime` boundary; do not introduce Node-only dependencies into `runtime:edge` projects.
- Follow the project's local `AGENTS.md` when present; it overrides these rules for that subtree.
- Canonical reference: [`docs/overview/05-code-architecture.md`](../docs/overview/05-code-architecture.md).
