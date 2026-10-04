# Ecoma.io Documentation

> Tài liệu phản ánh thiết kế và kỳ vọng phát triển của hệ thống, **không** phải trạng thái hiện tại. Không mặc định mọi thành phần được mô tả đã tồn tại.

## Overview — system level

1. [Architecture](./overview/01-architecture.md) — topology, ranh giới service, data ownership, invariants.
2. [Delivery](./overview/02-delivery.md) — Git, CI/CD, contracts, migration, môi trường, release và rollback.
3. [Operations](./overview/03-operations.md) — backup/DR, hành vi khi sự cố, observability, alert và database hosting tier.
4. [Platform Facts](./overview/04-platform-facts.md) — capability và giới hạn đã xác minh của nền tảng.
5. [Code Architecture](./overview/05-code-architecture.md) — Nx project structure, Bounded Context, DDD layers, dependency rules, contracts và testing architecture.

## Services

- [Cache](./services/cache/README.md) — self-hosted Nx remote cache.
- [Push Notification](./services/push-notification/README.md) — control plane của notification (Cloudflare D1).
- [Web Push Notification Job](./services/web-push-notification-job/README.md) — delivery worker Web Push (Cloudflare Queue + D1 `push-job`).
- [Transactional Mail](./services/transactional-mail/README.md) — control plane của email giao dịch (Cloudflare D1).
- [Transactional Mailer Job](./services/transactional-mailer-job/README.md) — delivery worker email (Cloudflare Queue + D1 `mail-job`).

## Ranh giới tài liệu

| Vị trí                          | Chứa                                                  |
| ------------------------------- | ----------------------------------------------------- |
| `overview/`                     | Quyết định và policy **của toàn hệ thống**            |
| `overview/04-platform-facts.md` | **Fact của nền tảng**, kèm nguồn · ngày · mức tin cậy |
| `services/<service>/`           | Thiết kế, requirement và runbook **của service**      |
