# Ecoma.io Documentation

> Tài liệu phản ánh thiết kế và kỳ vọng phát triển của hệ thống, **không** phải trạng thái hiện tại. Không mặc định mọi thành phần được mô tả đã tồn tại.

## Overview — system level

1. [Architecture](./overview/01-architecture.md) — topology, ranh giới service, data ownership, invariants.
2. [Delivery](./overview/02-delivery.md) — Git, CI/CD, contracts, migration, môi trường, release và rollback.
3. [Operations](./overview/03-operations.md) — backup/DR, hành vi khi sự cố, observability, alert và database hosting tier.
4. [Platform Facts](./overview/04-platform-facts.md) — capability và giới hạn đã xác minh của nền tảng.
5. [Code Architecture](./overview/05-code-architecture.md) — Nx project structure, Bounded Context, DDD layers, dependency rules, contracts.
6. [Testing](./overview/06-testing.md) — testing architecture: quyền sở hữu test, layout thư mục (`apps/<app>/tests/`, `system-tests/`), ba target Nx canonical (`test`, `test-integration`, `system-test`), môi trường test.
7. [Domains](./overview/07-domains.md) — **canonical** cho ngôn ngữ domain dùng chung, catalog bounded context, context map và ranh giới chưa chốt ở cấp nghiệp vụ.

## Services

`docs/services/<name>/` theo **bounded context**, không theo deploy unit: một bounded context có thể có nhiều deploy unit, và tài liệu của context mô tả thiết kế chung cho tất cả. Catalog đầy đủ (trách nhiệm, ranh giới, deploy units) → [Domains](./overview/07-domains.md) §3; danh sách dưới đây chỉ là navigation.

Bounded context và deploy units của chúng:

- [Account](./services/account/README.md) — bounded context `account` (một deploy unit): UI + BFF + login/consent + credential + browser session, sở hữu `db-account`.
- [Auth](./services/auth/README.md) — bounded context `auth` (một deploy unit): API-only OAuth 2.0/OIDC authorization server (issuer `https://auth.ecoma.io`), sở hữu `db-auth`.
- [Backoffice](./services/backoffice/README.md) — bounded context `backoffice` (một deploy unit): staff directory, role/permission catalog và authorization audit cho thao tác đặc quyền; quyết định §10 đã chốt qua [ADR](./services/backoffice/adr/README.md).
- [Pact Broker](./services/pact-broker/README.md) — bounded context `pact-broker` (hai deploy unit API + dashboard): hợp đồng consumer-driven contract testing (pacts, verifications, can-i-deploy), sở hữu `db-pact-broker`.
- [Transactional Mail](./services/transactional-mail/README.md) — control plane của bounded context `transactional-mail` (Cloudflare D1).
- [Transactional Mailer Job](./services/transactional-mailer-job/README.md) — deploy unit delivery plane của cùng context `transactional-mail` (Cloudflare Queue + D1 `mail-job`).
- [Push Notification](./services/push-notification/README.md) — control plane của bounded context `push-notification` (Cloudflare D1).
- [Web Push Notification Job](./services/web-push-notification-job/README.md) — deploy unit delivery plane của cùng context `push-notification` (Cloudflare Queue + D1 `push-job`).

Bounded context chưa có thư mục tài liệu riêng (`llm`, `payment`) — thiết kế hiện nằm ở [Architecture](./overview/01-architecture.md) §2/§4 và catalog trong [Domains](./overview/07-domains.md) §3.

Không phải bounded context nhưng có tài liệu riêng:

- [Auth Nonce Prune Job](./services/auth-nonce-prune-job/README.md) — cron Worker dọn nonce hết hạn cho hai kho nonce của đường nội bộ (`db-auth`, `db-account`); maintenance plane của `auth`, không sở hữu storage.
- [Cache](./services/cache/README.md) — self-hosted Nx remote cache; disposable build state, không phải bounded context.
- [Local Platform](./services/local-platform/README.md) — hạ tầng Docker local dùng chung (network, Traefik, PostgreSQL) mỗi worktree một bộ, và đường deploy local của deploy unit; đặt trong `services/` vì nó phục vụ **mọi** service, không phải vì nó là một — ngoại lệ này được ghi ở [`AGENTS.md`](./AGENTS.md) §3 và ở bảng dưới.

## Ranh giới tài liệu

| Vị trí                          | Chứa                                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `overview/`                     | Quyết định và policy **của toàn hệ thống**                                                                                                         |
| `overview/07-domains.md`        | Ngôn ngữ domain, **catalog bounded context**, context map, ranh giới chưa chốt ở cấp nghiệp vụ                                                     |
| `overview/04-platform-facts.md` | **Fact của nền tảng**, kèm nguồn · ngày · mức tin cậy                                                                                              |
| `services/<service>/`           | Thiết kế, requirement và runbook **của service** · ngoại lệ `services/local-platform/` — hạ tầng local dùng chung, không thuộc bounded context nào |
