# Architecture Roadmap — Phase 1 → Phase 7

Roadmap triển khai các phase sau Phase 0. Phase 0 chỉ audit + tài liệu; **không** phase nào dưới đây được triển khai trong PR Phase 0. Task IDs theo dạng `P<n>.<m>`; dependency ghi là task ID hoặc artifact phải có.

## Phase 1 — Staff Access contracts và service

> **Quy ước xuyên phase:** mọi task xây deploy unit mới (Staff Access service P1.4, outbox relay P2.2, reconciliation job P2.4, remote-cache app P4.x) bao gồm cả việc đứng lên deploy unit đó: Nx project, `deploy-eligibility` entry trong deployment map, và đường deploy local. Deploy production/staging **không** nằm trong các phase này — xem mục "Deploy infra prerequisite" cuối file.

- **P1.1** Chốt domain model Staff Access (staff, role, permission, assignment, entitlement, audit) và schema ownership (target `db-staff-access`).
- **P1.2** Chốt API/event contracts: management API cho staff/role/permission/assignment, entitlement read model cho sản phẩm, audit query.
- **P1.3** Chốt entitlement model khác với authorization: entitlement = product availability; authorization = per-resource/per-operation.
- **P1.4** Implement Staff Access service + unit/integration tests.
- **P1.5** ADR mới supersede phạm vi A21: Staff Access tiếp quản trách nhiệm đã gán cho `backoffice` (ADR-0013).
- **Deliverables:** service spec finalized, OpenAPI/contract, migration, tests.
- **Acceptance:** staff CRUD, role/permission catalog, assignment, entitlement read, audit append-only; không sync call per request.
- **Depends on:** Phase 0 docs.
- **Parallel:** P1.1/P1.2/P1.3 song song; P1.4 sau P1.1–P1.3; P1.5 song song với P1.1.

## Phase 2 — Entitlement event delivery và revocation

- **P2.1** Transactional outbox trong DB của Staff Access (cùng transaction với state change).
- **P2.2** Relay outbox → Cloudflare Queues (hoặc cơ chế được ADR lựa chọn) với idempotency key, retry, DLQ, replay.
- **P2.3** Consumer idempotent ở từng sản phẩm: duplicate/out-of-order handling, revision/version.
- **P2.4** Reconciliation job + metric freshness.
- **P2.5** Thiết kế/test cơ chế đáp ứng revocation SLA (normal ≤60s, high ≤5s) — **không** mặc định queue-only đạt ≤5s; fail-closed/fail-open, re-check-at-write-time là control thứ hai.
- **Depends on:** P1.2, ADR-0002/0009 audit.
- **Parallel:** P2.1/P2.5 song song; P2.2 sau P2.1; P2.3 sau P2.2; P2.4 song song với P2.3.

## Phase 3 — Pact Broker integration

- **P3.1** Bootstrap `ecoma-internal` tenant tường minh qua **bootstrap script độc lập** (không phụ thuộc deploy pipeline — pipeline staging/production chưa tồn tại, xem `02-delivery.md` §12; khi pipeline được xây ở phase khác thì script này được gọi từ đó), không cấp membership khi signup/login.
- **P3.2** Provision entitlement → membership nội bộ chỉ bắt đầu với quyền Member trừ khi có quy trình cấp quyền quản trị rõ ràng.
- **P3.3** Đảm bảo revoke entitlement không ảnh hưởng customer membership/machine credentials độc lập.
- **P3.4** Test machine credential lifecycle và tenant isolation.
- **Depends on:** P1.2, P2.2, P2.5 (SLA mechanism phải lock trước Phase 3 rollout — freeze point).
- **Parallel:** P3.1 song song với P1 (không phụ thuộc SLA); P3.2/P3.3 sau P2.3 **và** P2.5; P3.4 sau P3.2.

## Phase 4 — Remote Cache Nx MVP

- **P4.1** Multi-tenant control plane: tenant/project/membership/API key/scope. Chuyển từ disposable infra sang SaaS bounded context cần **ADR mới** theo A18 (`01` §8) — tạo cùng lúc với P4.1.
- **P4.2** Data plane Nx upload/download, object storage, metadata, namespace isolation.
- **P4.3** Quota, retention, usage metering, audit ở mức MVP.
- **P4.4** Security: CI credential, fork/PR write protection, cross-tenant isolation.
- **P4.5** Tests: cache hit/miss, multi-tenant, credential, write protection, build correctness khi cache miss.
- **Depends on:** Phase 0 docs, P1 contracts (entitlement integration deferred — MVP dùng API key riêng).
- **Parallel:** P4.1/P4.4 song song; P4.2 sau P4.1; P4.3 song song với P4.2; P4.5 sau P4.2.
- **Note:** entitlement integration cho Remote Cache deferred sang phase sau MVP.

## Phase 5 — Backoffice composition

- **P5.1** Backoffice dùng Staff Access API cho nhân sự/quyền nội bộ.
- **P5.2** Backoffice dùng API của Pact Broker và Remote Cache cho nghiệp vụ sản phẩm.
- **P5.3** Không truy cập trực tiếp database của domain khác.
- **P5.4** Hiển thị trạng thái entitlement/sync và audit cần thiết.
- **Depends on:** P1.2, P3.2, P4.1.
- **Parallel:** P5.1/P5.2 song song sau dependency; P5.3/P5.4 sau.

## Phase 6 — Test, local stack và CI integration

- **P6.1** Unit tests nhanh với mock boundary phù hợp (`test` target).
- **P6.2** Integration tests persistence/API/messaging thực (`test-integration` target).
- **P6.3** E2E xuyên deploy unit là suite độc lập trong `system-tests/e2e/<suite>/` (Nx project riêng, target `system-test`) — không nhét vào suite app-owned; E2E một app thì colocated theo `06-testing.md` §2.
- **P6.4** Local deployment theo Nx dependency graph và quy trình đã thống nhất.
- **P6.5** E2E xuyên service: grant entitlement, dùng sản phẩm, revoke access.
- **P6.6** Test duplicate/out-of-order events, recovery, cross-tenant isolation, machine credentials.
- **P6.7** Smoke tests local stack + build không phụ thuộc cache availability.
- **Depends on:** P2.3, P3.4, P4.5, P5.4.

## Phase 7 — Remote Cache expansion và operational hardening

- **P7.1** Đo throughput, concurrency, hit ratio, bandwidth, storage cost của Nx MVP.
- **P7.2** Rate/resource limiting, quotas, retention, audit, vận hành.
- **P7.3** Xác định protocol adapter tiếp theo bằng nhu cầu thị trường (Gradle → Turborepo → Bazel/Moonrepo) — mỗi protocol một phase riêng.
- **Depends on:** P4.5 + production traffic data (đòi hỏi deploy production đã tồn tại — xem "Deploy infra prerequisite").
- **Parallel:** P7.1/P7.2 song song; P7.3 sau P7.1.

## Dependency summary

```
Phase 0 (docs) ──► Phase 1 (Staff Access contracts/service)
                      ├─► Phase 2 (entitlement delivery) ──► Phase 3 (Pact Broker integration)
                      ├─► Phase 4 (Remote Cache Nx MVP) ──► Phase 7 (expansion)
                      └─► Phase 5 (Backoffice composition) ──► Phase 6 (test/local/CI)
Phase 6 depends on Phase 2, 3, 4, 5.
```

## Contract freeze points (không được thay đổi sau khi lock)

- Staff Access API/event contracts (P1.2) lock trước Phase 2 consumer implementation.
- Entitlement event schema (P2.1) lock trước Phase 3/5.
- Remote Cache control-plane API (P4.1) lock trước Phase 5 integration.
- Revocation SLA mechanism (P2.5) lock trước Phase 3 rollout.

## Deploy infra prerequisite (không thuộc phase nào ở đây)

Staging/production pipeline, delivery runner và migration runner **chưa tồn tại** (`02-delivery.md` §12 preamble). P3.1 chỉ đứng khi có bootstrap script độc lập; P7.1/P7.3 (đo production traffic) và bất kỳ rollout thật nào phải chờ deploy infra được xây — xây nó là một phase/workstream riêng do deploy team sở hữu, không gán vào Phase 1–7 này.

## Open decisions cần giải quyết trong Phase 1–2 (không phải Phase 0)

- Cơ chế cụ thể đáp ứng revocation ≤5s (ADR-0002 target, chưa chốt).
- Relay outbox: Worker relay / Queue / NATS (01 §10).
- Remote Cache control-plane storage engine (PostgreSQL vs D1) — open decision.
- Remote Cache usage rights: MVP dùng API key riêng; entitlement integration deferred.
- Remote Cache quota-exceeded write behavior: hành vi khi write vượt quota (429/403, non-fatal cho caller — cache miss phải dẫn đến build bình thường) phải được pin trước khi implement P4.3.
- Remote Cache lifecycle enforcement mechanism: cách data plane biết lifecycle state của tenant/project mà không query database trong hot path (bất biến fail-closed ở `solutions/remote-cache` §2.1 vs. data plane không phụ thuộc DB) — candidates: cached configuration với TTL ngắn + fail-closed khi stale/unknown, re-check-at-write-time cho write path — phải được chốt trước khi implement P4.4.
