# Pact Broker — Requirements

> Yêu cầu chức năng (FR), phi chức năng (NFR), bảo mật (SR) có ID cho bounded context `pact-broker`.
> Thiết kế → [`01-architecture.md`](./01-architecture.md) · mapping upstream → [`UPSTREAM_MAPPING.md`](./UPSTREAM_MAPPING.md).

## 1. Functional

| ID     | Yêu cầu                                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-001 | Pact CLI publish được pact: `PUT /pacts/provider/{p}/consumer/{c}/version/{v}` và `POST /contracts/publish` (batch, validate-all-before-write).        |
| FR-002 | CLI đọc được `pacts-for-verification` với selector tag/branch/mainBranch/deployed; index HAL công bố các link mà CLI gate (`pb:publish-contracts`, …). |
| FR-003 | Record verification result; matrix trả về đầy đủ consumer/provider/version/verification; tri-state `deployable`.                                       |
| FR-004 | `can-i-deploy --to-environment                                                                                                                         | --to-tag | --branch` fail-closed: unknown = không deploy được. |
| FR-005 | Environments CRUD; record deployed/undeployed version qua đường `pact-broker-client` (POST `/deployed-versions/environment/{env}`).                    |
| FR-006 | Multi-tenant: mọi domain data gắn tenant; không request nào đọc/ghi lệch tenant (DB composite constraint enforce).                                     |
| FR-007 | Default tenant idempotent on first provision; race-safe dưới concurrency.                                                                              |
| FR-008 | Machine token: tạo (plaintext hiện 1 lần), list (chỉ metadata), revoke (hiệu lực tức thời), scope read/write/admin.                                    |
| FR-009 | RBAC Owner/Admin/Member/Viewer: Owner quản lý members; Admin quản lý environments/webhooks/tokens; Member publish; Viewer read-only.                   |
| FR-010 | Dashboard `pact-broker-app`: xem pacts, verifications, matrix, environments, tokens; quản lý trong phạm vi role (BFF + OIDC).                          |
| FR-011 | Audit event cho mọi thay đổi đặc quyền (token, membership, environment).                                                                               |
| FR-012 | HAL responses tương thích Pact CLI ≥ 2.86 (branch/build-url publish); index compatibility version `2.107.0`.                                           |

## 2. Non-functional

| ID      | Yêu cầu                                                                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-001 | Mọi timestamp `timestamptz` UTC.                                                                                                               |
| NFR-002 | Migration idempotent, forward-fix only, chạy từ CI runner với `pg_advisory_lock`; role `_migrator` không bao giờ là Worker secret.             |
| NFR-003 | Worker không DDL; serving path không advisory lock/LISTEN/PREPARE (HD6).                                                                       |
| NFR-004 | Test: unit pure (port từ upstream), integration PostgreSQL thật qua testcontainers, API test qua Hono `app.request` — không cần dịch vụ ngoài. |
| NFR-005 | Bootstrap/build/test/migrate không cần Account/Auth/broker production nào đang sống.                                                           |
| NFR-006 | Token lookup qua hash PK; phản hồi auth 401 đồng nhất; audit phân biệt reason.                                                                 |
| NFR-007 | Body limit 10MB (publish batch 4MB, single pact 1MB) giống upstream; streaming check trước khi đọc body.                                       |

## 3. Security

| ID     | Yêu cầu                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SR-001 | Không shared token global như upstream: mỗi token gắn đúng một tenant + scopes; không token cross-tenant.                                                          |
| SR-002 | Token lưu hash-only (SHA-256); plaintext không bao giờ ghi DB hay log.                                                                                             |
| SR-003 | Không public-read default như upstream `ALLOW_PUBLIC_READ`: mọi endpoint domain (trừ badge nếu bật) yêu cầu credential.                                            |
| SR-004 | Browser không gửi được role/permission mà BFF tin: mọi authorization check chạy server-side trên token đã verify.                                                  |
| SR-005 | CORS mặc định chặn chéo-origin; chỉ mở cho origin dashboard đã cấu hình.                                                                                           |
| SR-006 | Webhook outbound mặc định TẮT; bật đòi SSRF guard chứng minh được (HTTPS-only, block private/loopback/metadata, DNS rebinding defense). Production path không bật. |
| SR-007 | Không log Authorization header, token, body pact ở đường lỗi.                                                                                                      |
| SR-008 | Audit append-only ở DB (trigger chặn UPDATE).                                                                                                                      |

## 4. Non-goals (hiện tại)

- Webhook outbound production (SR-006 — tắt cho đến khi có SSRF guard).
- Badge SVG public (đòi public read — mâu thuẫn SR-003; cân nhắc sau).
- UI quản lý tenant toàn hệ thống (dashboard chỉ thấy tenant của mình).
- Cross-tenant sharing pacts (nhất thiết tenant-isolated).
- BFF session/principal auth cho `pact-broker-app` (#144) — hoãn tới khi đường mang credential tới BFF được chốt (ADR-0011 pattern, xem #116). Dashboard hiện fail-closed theo broker-config (503 khi thiếu config) và read-only (read-only-bff invariant); machine token scope `read` server-side.
- Migration UI/down-migration.

## 5. Acceptance

| Kiểm chứng                                                                                                         | Bằng chứng bắt buộc                                     |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Publish bằng payload Pact CLI thật (fixture từ upstream test helpers) qua cả hai đường PUT và `/contracts/publish` | API test xanh + index HAL chứa link gate                |
| `can-i-deploy` với verification fail → exit fail; unknown → exit fail                                              | API test assert tri-state + reason                      |
| Hai request đồng thời `ensureDefaultTenant` cùng sub                                                               | Integration test PostgreSQL thật, đúng 1 tenant         |
| Row lệch tenant (INSERT tham chiếu chéo)                                                                           | Integration test bị FK từ chối ở DB                     |
| Revoke token rồi dùng ngay                                                                                         | API test 401 ngay request đầu sau revoke                |
| Migration chạy 2 lần liên tiếp                                                                                     | Integration test lần 2 là no-op                         |
| `nx typecheck lint test test-integration` của cả hai app                                                           | Xanh local, không skip có chủ đích ngoài Docker-missing |
