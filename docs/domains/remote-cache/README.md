# Remote Cache

`remote-cache` là bounded context sở hữu **dịch vụ remote cache multi-tenant**: tenant, project, membership, API key machine credential, quota, retention, usage metering và audit. Data plane phục vụ giao thức cache (Nx-first); control plane quản lý toàn bộ state multi-tenant và không nằm trên hot path của cache traffic.

> **Trạng thái:** bounded context **đã được kiến trúc hoá** (ADR-0015 xác lập ranh giới và storage). Deploy unit `cache` hiện đang là disposable build state theo A18; evolution sang SaaS bounded context theo roadmap Phase 4. Spec kỹ thuật đầy đủ của deploy unit nằm ở [`solutions/remote-cache/`](../../solutions/remote-cache/README.md) — thư mục này giữ ranh giới nghiệp vụ và quyết định ownership, không nhân bản thiết kế service.

## 1. Trách nhiệm

1. **Tenant** — ranh giới cách ly của tổ chức/customer; lifecycle state riêng (`active`/`suspended`/`deleted`) với enforcement fail-closed.
2. **Project** — đơn vị isolation của cache; mỗi project thuộc đúng một tenant; namespace và storage scope derive từ project, không từ input client.
3. **Membership** — quan hệ người dùng ↔ tenant kèm role; vòng đời độc lập với API key machine credential.
4. **API key** — machine credential scoped theo project, read/write scope, revoke/expiry; hash-only ở storage, show-once lúc tạo; không `last_used_at` (observability không vào serving path).
5. **Quota/usage** (P4.3) — attribution theo project, PostgreSQL là authority.
6. **Audit** (P4.3) — mọi administrative mutation có entry actor/action/target/time/outcome.

## 2. Ranh giới với các context khác

| Context        | Sở hữu (rút gọn)                                     | Ranh giới với `remote-cache`                                                                                                                                                                |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pact-broker`  | Tenant/membership/role **của broker**, machine token | **Tenant của `remote-cache` ≠ tenant của `pact-broker`** — không dùng chung, không suy ra membership từ bên kia, không FK chéo database (glossary [`domains/README.md`](../README.md) §2.4) |
| `staff-access` | Entitlement product-level availability của nhân sự   | **Deferred cho MVP**: `remote-cache` dùng API key riêng; khi tích hợp thì chỉ qua entitlement event (ADR-0002/ADR-0009) — không sync-call, không authorization-result contract              |
| `backoffice`   | Composition/UI + BFF                                 | Consumer control-plane API của `remote-cache` (P5.2) — không chạm database                                                                                                                  |

Enforcement authorization bên trong `remote-cache` resolve từ principal (API key) và dữ liệu của chính nó — **catalog govern / backend enforce** giữ nguyên hình dạng chung của hệ thống.

## 3. Ownership và storage

- Database `db-remote-cache`, PostgreSQL, schema `remote_cache` — [ADR-0015](./adr/0015-remote-cache-bounded-context.md) (canonical).
- Ba-role pattern `ecoma_owner` / `ecoma_remote_cache_migrator` / `ecoma_remote_cache_runtime`, chặn chéo `REVOKE CONNECT`, Hyperdrive riêng với query cache OFF (pattern ADR-0001/ADR-0013).
- Data plane **không** phụ thuộc database trong hot path: chỉ đọc cached configuration; cache artifact nằm trên object storage (B2) và là disposable data, không phải authoritative state.

## 4. Tài liệu

| Document                                                                                 | Nội dung                                                                                                   |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [`adr/0015-remote-cache-bounded-context.md`](./adr/0015-remote-cache-bounded-context.md) | ADR duy nhất của context: xác lập bounded context, storage `db-remote-cache`, ranh giới tenant/entitlement |
| [`solutions/remote-cache/`](../../solutions/remote-cache/README.md)                      | Thiết kế deploy unit: boundary, request flow, storage partitioning, requirements, runbook                  |
