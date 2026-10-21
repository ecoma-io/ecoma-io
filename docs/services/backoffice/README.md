# Backoffice

`backoffice` là application nghiệp vụ vận hành nội bộ — quản trị **staff directory**, quyền truy cập (**RBAC**), và các thao tác vận hành nhạy cảm trên tài nguyên do các service khác sở hữu.

> ⚠️ **Hiện trạng:** `apps/backoffice` là Nuxt app (`@ecoma-io/backoffice`, tags `type:composition` / `scope:backoffice` / `runtime:edge`) đã tích hợp AppShell (`app/app.vue`), với **UI prototype** gồm bốn route `/` · `/staff` · `/roles` · `/permissions` và `GET /api/greet`. i18n có `en` / `vi` / `zh-CN` và chọn được ngay trong app; `strategy: 'no_prefix'` nên locale **không** phải URL prefix. Trang `/` là landing trống có chủ ý (Issue #218) — chỉ dẫn sang ba khu vực prototype, không có metric bịa. Ba trang staff/roles/permissions đọc dữ liệu **prototype** từ adapter mock trong bộ nhớ (`app/backoffice-data/mock-adapter.ts`, `isPreview = true`) và luôn hiển thị banner dữ liệu mẫu; adapter đó **không** chứng minh có backend hay persistence — nó không gọi `fetch` và không truy cập storage. **Chưa có** authentication/authorization runtime, staff persistence, role/permission persistence, database binding hay RBAC enforcement nào được implement; `wrangler.jsonc` không có binding lưu trữ dữ liệu nào (chỉ có `ASSETS` phục vụ static asset). Hostname production đặt mục tiêu là `office.ecoma.io` ([`01` §7](../../overview/01-architecture.md)), custom domain chưa gán; app **không** nằm trong pipeline release và lý do vẫn còn nguyên — [`02-delivery.md` §7.5](../../overview/02-delivery.md). Toàn bộ tài liệu dưới đây là **contract thiết kế**, không phải trạng thái hiện tại — xem [`docs/README.md`](../../README.md) dòng disclaimer.

## 1. Mục đích

`backoffice` sở hữu hai thứ:

1. **Staff directory và RBAC domain** — staff membership, staff lifecycle, role/permission catalog, staff-role assignment, authorization audit records.
2. **Privileged-operation workflow** — các thao tác vận hành nhạy cảm, có audit và governance.

Nó **không** phải một IdP thứ hai và **không** phải credential store: authentication tới `backoffice` đi qua `account`/`auth` như mọi application khác, và `backoffice` chỉ tiêu thụ **Account ID** (`sub`) cùng token đã xác thực. Việc _định nghĩa_ một permission thuộc về catalog của `backoffice`; việc _enforce_ permission đó trên một operation cụ thể thuộc về **resource-owning backend** của chính resource đó (split được ghi ở [`01-architecture.md`](./01-architecture.md) §5).

## 2. Mối quan hệ với các bounded context khác

| Context      | Sở hữu (rút gọn)                                                                                            | Không sở hữu (rút gọn)                                                                     | Tài liệu                            |
| ------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------- |
| `account`    | Canonical account identity: hồ sơ, email đã xác thực, credential, MFA/passkey, browser session, authn audit | Staff membership, staff role, permission assignment, authorization policy của `backoffice` | [`README.md`](../account/README.md) |
| `auth`       | Giao thức OAuth 2.0 / OIDC: flows, clients, redirect URI validation, token issuance/validation/revocation   | Business role/permission của `backoffice` — **OAuth scope ≠ application-level permission** | [`README.md`](../auth/README.md)    |
| `backoffice` | Staff directory, staff lifecycle, role/permission catalog, staff-role assignment, authorization audit       | Không phải IdP, không phải credential store; không nhân bản credential/MFA/passkey state   | trang này                           |

- `account`/`auth` **không bao giờ ghi** vào dữ liệu staff/role/permission của `backoffice` — dù có chung hạ tầng PostgreSQL instance, cùng hạ tầng không có nghĩa chung write authority.
- Token hợp lệ **không** phải bằng chứng privilege còn hiện hành; đây là nguyên tắc chung của ba context (A22, A24).

Ranh giới system-level, data ownership và các quyết định kiến trúc tương ứng → [`docs/overview/01-architecture.md`](../../overview/01-architecture.md) §2.2 · §4 · §9 · A21–A24.

## 3. Tài liệu

| Document                                     | Nội dung                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `README.md`                                  | Index — trang bạn đang đọc                                                        |
| [`01-architecture.md`](./01-architecture.md) | Ranh giới, domain model khái niệm, authorization model và nơi enforce, invariants |
| [`02-requirements.md`](./02-requirements.md) | Yêu cầu bảo mật, threat model, acceptance matrix, non-goals, tham chiếu           |
| [`adr/`](./adr/README.md)                    | Architectural decision record — chín quyết định §10 đã chốt (ADR-0001…0009)       |

**Chưa có** `03-operations.md`: ứng dụng hiện tại là **UI prototype** với dữ liệu mẫu, chưa có runtime vận hành thật (chưa database binding, chưa authentication, chưa RBAC) nên không có runbook thật để phản ánh. App cũng **không** đi qua pipeline release — xem [`02-delivery.md` §7.5](../../overview/02-delivery.md) — nên không có lane vận hành nào để viết runbook. Theo [`docs/AGENTS.md`](../../AGENTS.md) §5 và §7, README phải phản ánh trạng thái thật và không được giữ scaffold rỗng.
