# Ecoma.io Documentation

> Tài liệu phản ánh thiết kế và kỳ vọng phát triển của hệ thống, **không** phải trạng thái hiện tại. Không mặc định mọi thành phần được mô tả đã tồn tại.

## Ba trục tài liệu

| Trục                                        | Trả lời                                             | Index                                                |
| ------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| [`architecture/`](./architecture/README.md) | Hệ thống tổ chức ra sao, phải tuân thủ quy tắc gì   | [`architecture/README.md`](./architecture/README.md) |
| [`domains/`](./domains/README.md)           | Context nào sở hữu trách nhiệm/dữ liệu/contract nào | [`domains/README.md`](./domains/README.md)           |
| [`solutions/`](./solutions/README.md)       | Application/service nào hiện thực, bằng cách nào    | [`solutions/README.md`](./solutions/README.md)       |

Ba trục là ba góc nhìn khác nhau, không phải ba bản mô tả lặp lại cùng một hệ thống.

## Architecture — system level

1. [Architecture](./architecture/01-architecture.md) — topology, ranh giới service, data ownership, invariants.
2. [Delivery](./architecture/02-delivery.md) — Git, CI/CD, contracts, migration, môi trường, release và rollback.
3. [Operations](./architecture/03-operations.md) — backup/DR, hành vi khi sự cố, observability, alert và database hosting tier.
4. [Platform Facts](./architecture/04-platform-facts.md) — capability và giới hạn đã xác minh của nền tảng.
5. [Code Architecture](./architecture/05-code-architecture.md) — Nx project structure, Bounded Context, DDD layers, dependency rules, contracts.
6. [Testing](./architecture/06-testing.md) — testing architecture: quyền sở hữu test, layout thư mục (`apps/<app>/tests/`, `system-tests/`), ba target Nx canonical (`test`, `test-integration`, `system-test`), môi trường test.
7. [Roadmap](./architecture/roadmap.md) — Phase 1–7: task IDs, dependency, parallelization, contract freeze points.

## Domains

Catalog đầy đủ (trách nhiệm, ranh giới, deploy units) → [Domains](./domains/README.md) — **canonical** cho ngôn ngữ domain dùng chung, catalog bounded context, context map và ranh giới chưa chốt ở cấp nghiệp vụ.

Thư mục context:

- [Account](./domains/account/README.md) — bounded context `account` (một deploy unit): UI + BFF + login/consent + credential + browser session, sở hữu `db-account`.
- [Auth](./domains/auth/README.md) — bounded context `auth` (một deploy unit): API-only OAuth 2.0/OIDC authorization server (issuer `https://auth.ecoma.io`), sở hữu `db-auth`.
- [Staff Access](./domains/staff-access/README.md) — bounded context `staff-access` (target: deploy unit riêng — Phase 1): staff directory, role/permission catalog, product entitlement, authorization audit. Ngày nay trách nhiệm nằm trong `backoffice`; evolution → [`domains/staff-access/README.md`](./domains/staff-access/README.md) §4; 12 ADR → [`adr/`](./domains/staff-access/adr/README.md).
- [Pact Broker](./domains/pact-broker/README.md) — bounded context `pact-broker` (hai deploy unit API + dashboard): hợp đồng consumer-driven contract testing (pacts, verifications, can-i-deploy), sở hữu tenant/membership/role của chính broker và machine credentials, sở hữu `db-pact-broker`.
- [Transactional Mail](./domains/transactional-mail/README.md) — control plane của bounded context `transactional-mail` (Cloudflare D1).
- [Push Notification](./domains/push-notification/README.md) — control plane của bounded context `push-notification` (Cloudflare D1).

Bounded context chưa có thư mục tài liệu riêng (`llm`, `payment`) — thiết kế hiện nằm ở [Architecture](./architecture/01-architecture.md) §2/§4 và catalog trong [Domains](./domains/README.md) §3.

## Solutions

Application/composition/deploy unit — index đầy đủ → [Solutions](./solutions/README.md):

- [Backoffice](./solutions/backoffice/README.md) — composition/UI + BFF vận hành nội bộ; **không** sở hữu database nghiệp vụ (staff/RBAC thuộc Staff Access — target; hiện tại app `backoffice` vẫn sở hữu theo A21–A24).
- [Remote Cache](./solutions/remote-cache/README.md) — self-hosted Nx remote cache (target: multi-tenant SaaS bounded context, Nx-first); disposable build state theo A18, roadmap mở rộng protocol → [Roadmap](./architecture/roadmap.md) Phase 7.
- [Local Platform](./solutions/local-platform/README.md) — hạ tầng Docker local dùng chung (network, Traefik, PostgreSQL) mỗi worktree một bộ, và đường deploy local của deploy unit; đặt trong `solutions/` vì nó phục vụ **mọi** service, không phải vì nó là một — ngoại lệ này được ghi ở [`AGENTS.md`](./AGENTS.md) §3.
- [Transactional Mailer Job](./solutions/transactional-mailer-job/README.md) — delivery plane của `transactional-mail` (Cloudflare Queue + D1 `mail-job`).
- [Web Push Notification Job](./solutions/web-push-notification-job/README.md) — delivery plane của `push-notification` (Cloudflare Queue + D1 `push-job`).
- [Auth Nonce Prune Job](./solutions/auth-nonce-prune-job/README.md) — cron Worker dọn nonce hết hạn cho hai kho nonce của đường nội bộ (`db-auth`, `db-account`); maintenance plane của `auth`, không sở hữu storage.

## Ranh giới tài liệu

| Vị trí                              | Chứa                                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `architecture/`                     | Quyết định và policy **của toàn hệ thống**                                                                                                                              |
| `domains/README.md`                 | Ngôn ngữ domain, **catalog bounded context**, context map, ranh giới chưa chốt ở cấp nghiệp vụ                                                                          |
| `domains/<context>/`                | Specification của một bounded context (boundary, domain model, contracts, authorization boundary)                                                                       |
| `architecture/04-platform-facts.md` | **Fact của nền tảng**, kèm nguồn · ngày · mức tin cậy                                                                                                                   |
| `solutions/<name>/`                 | Thiết kế, requirement và runbook **của composition/deploy unit/job** · ngoại lệ `solutions/local-platform/` — hạ tầng local dùng chung, không thuộc bounded context nào |
