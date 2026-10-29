# Architecture

Nguyên tắc và cấu trúc kiến trúc chung của toàn hệ thống Ecoma — trả lời câu hỏi: **toàn hệ thống được tổ chức như thế nào và phải tuân thủ quy tắc gì?** Trục này nói về hệ thống như một tổng thể; trách nhiệm của từng bounded context → [`docs/domains/`](../domains/README.md); application/service hiện thực → [`docs/solutions/`](../solutions/README.md).

| Document                                               | Nội dung                                                                                                                                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`01-architecture.md`](./01-architecture.md)           | System topology, deploy unit, data ownership, cross-service communication, security boundary, hostname/routing, architectural decisions (A1–A24) và system invariants (1–36); ADR per-context nằm trong `docs/domains/<context>/adr/` |
| [`02-delivery.md`](./02-delivery.md)                   | Git, Nx, CI/CD, contracts delivery, migration, environments, release và rollout                                                                                                                                                       |
| [`03-operations.md`](./03-operations.md)               | Deployment operations, observability, failure handling, backup/DR, recovery, operational policies                                                                                                                                     |
| [`04-platform-facts.md`](./04-platform-facts.md)       | Verified external platform facts (Cloudflare, PostgreSQL, …) — có nguồn và ngày xác minh                                                                                                                                              |
| [`05-code-architecture.md`](./05-code-architecture.md) | Nx project structure, bounded context ↔ scope, DDD layers, dependency rules, contracts                                                                                                                                                |
| [`06-testing.md`](./06-testing.md)                     | Testing architecture — taxonomy, ownership/layout, Nx target contracts, test environment                                                                                                                                              |

## Ba trục tài liệu

| Trục                                         | Trả lời                                             | Canonical cho                                                                         |
| -------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`architecture/`](./README.md) (thư mục này) | Hệ thống tổ chức ra sao, quy tắc gì                 | System policy, decision, invariant, platform fact, delivery/testing/code architecture |
| [`domains/`](../domains/README.md)           | Context nào sở hữu trách nhiệm/dữ liệu/contract nào | Ngôn ngữ domain, catalog bounded context, context map, ranh giới chưa chốt            |
| [`solutions/`](../solutions/README.md)       | Application/service nào hiện thực, bằng cách nào    | Thiết kế, requirement, runbook của từng composition/deploy unit                       |

Ba trục là ba góc nhìn, không phải ba bản mô tả lặp lại cùng một hệ thống. Mỗi fact/decision có đúng một canonical location — bảng đầy đủ ở [`docs/AGENTS.md`](../AGENTS.md) §4.
