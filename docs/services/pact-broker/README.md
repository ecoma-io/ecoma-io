# Pact Broker

Bounded context `pact-broker`: hợp đồng consumer-driven contract testing cho hệ sinh thái Ecoma, dogfooding-ready. Hai deploy unit:

- **`pact-broker-api`** (`apps/pact-broker-api`) — Worker Hono API-only, tương thích Pact CLI, sở hữu `db-pact-broker` (PostgreSQL qua Hyperdrive).
- **`pact-broker-app`** (`apps/pact-broker-app`) — Nuxt BFF + dashboard, không chạm database, xác thực qua OIDC của `auth`.

Thiết kế nguồn: [`docs/services/pact-broker/01-architecture.md`](./01-architecture.md).

## Hiện trạng

Phase foundation đang triển khai: schema `db-pact-broker` (migration 0001), API core (pacticipants/versions/pacts/verifications), tenant isolation + RBAC, machine token. Chưa có: webhook outbound, badge, dashboard UI hoàn chỉnh, provision Hyperdrive thật (binding placeholder fail-closed như `db-account`/`db-auth`).

## Documents

| Document                                       | Nội dung                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| [`01-architecture.md`](./01-architecture.md)   | Ranh giới, data model, tenant isolation, auth model, invariants    |
| [`02-requirements.md`](./02-requirements.md)   | FR/NFR/SR có ID, non-goals, threat model, acceptance               |
| [`UPSTREAM_MAPPING.md`](./UPSTREAM_MAPPING.md) | Ánh xạ từng module của upstream `pact-broker-workers` → đích Ecoma |
| [`03-operations.md`](./03-operations.md)       | Migration, provisioning, runbook                                   |
