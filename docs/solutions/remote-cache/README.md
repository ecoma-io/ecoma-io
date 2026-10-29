# Remote Cache

Self-hosted remote cache cho Nx: tái sử dụng kết quả task để rút ngắn build/CI. Đây là **disposable build state** — mất cache thì task chạy lại được, không mất correctness.

> **Target evolution (Phase 4+):** service được định hướng thành bounded context `remote-cache` — multi-tenant SaaS, Nx-first (MVP), roadmap protocol sau đó là Gradle → Turborepo → Bazel/Moonrepo (chỉ roadmap, không phải phạm vi MVP). Target sẽ sở hữu tenant/project/membership/API key/quota/retention/usage metering/audit; hiện tại vẫn là disposable build state theo A18. Roadmap → [`architecture/roadmap.md`](../../architecture/roadmap.md) Phase 4/7. MVP dùng API key riêng của service; entitlement integration deferred.

## Responsibility

- Phục vụ đúng Nx remote cache protocol (`GET`/`PUT /v1/cache/{hash}`) với Bearer API key project-scoped.
- Stream immutable cache artifact tới object storage durable (S3-compatible; MVP: Backblaze B2).
- Không phải source of truth, không phải serving dependency của application nào (A18, invariant 22 — [`docs/architecture/01-architecture.md`](../../architecture/01-architecture.md)).

## Runtime

- Deploy unit: Cloudflare Worker; data plane public duy nhất `https://cache.ecoma.io`.
- Control plane (projects, API keys, partitions) private, qua Service Binding, không hostname công khai.

## Documents

- [01-architecture.md](./01-architecture.md) — boundary, request flow, storage partitioning, invariants.
- [02-requirements.md](./02-requirements.md) — FR/NFR, non-goals, acceptance criteria.
- [03-operations.md](./03-operations.md) — configuration, CI, verification, runbook.
