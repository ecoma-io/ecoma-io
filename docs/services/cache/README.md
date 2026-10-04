# Cache Service

Self-hosted remote cache cho Nx: tái sử dụng kết quả task để rút ngắn build/CI. Đây là **disposable build state** — mất cache thì task chạy lại được, không mất correctness.

## Responsibility

- Phục vụ đúng Nx remote cache protocol (`GET`/`PUT /v1/cache/{hash}`) với Bearer API key project-scoped.
- Stream immutable cache artifact tới object storage durable (S3-compatible; MVP: Backblaze B2).
- Không phải source of truth, không phải serving dependency của application nào (A18, invariant 22 — [`docs/overview/01-architecture.md`](../../overview/01-architecture.md)).

## Runtime

- Deploy unit: Cloudflare Worker; data plane public duy nhất `https://cache.ecoma.io`.
- Control plane (projects, API keys, partitions) private, qua Service Binding, không hostname công khai.

## Documents

- [01-architecture.md](./01-architecture.md) — boundary, request flow, storage partitioning, invariants.
- [02-requirements.md](./02-requirements.md) — FR/NFR, non-goals, acceptance criteria.
- [03-operations.md](./03-operations.md) — configuration, CI, verification, runbook.
