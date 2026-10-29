# Backoffice

`backoffice` là **composition: UI quản trị + BFF** phục vụ vận hành nội bộ. Nó phối hợp các API của các bounded context — Staff Access cho nhân sự/quyền, Pact Broker và Remote Cache cho nghiệp vụ sản phẩm — và **không sở hữu database nghiệp vụ** thay cho bất kỳ domain nào.

> **Trạng thái:** `apps/backoffice` hiện là Nuxt app UI prototype (`ssr: false`, AppShell, i18n `en`/`vi`/`zh-CN`) với dữ liệu mẫu trong bộ nhớ; các trang staff/roles/permissions chưa có persistence thật và app chưa đi qua pipeline release — lý do vẫn còn nguyên ở [`architecture/02-delivery.md`](../../architecture/02-delivery.md) §7.5. Ngày nay app còn sở hữu luôn nghiệp vụ staff/RBAC (migrations 0001–0006, auth runtime); tách nghiệp vụ đó sang Staff Access là **target architecture** — xem [`docs/domains/staff-access/README.md`](../../domains/staff-access/README.md) §4.

## 1. Vai trò composition

- **UI quản trị** cho staff: quản trị nhân sự, vai trò/quyền, và các thao tác vận hành trên sản phẩm nội bộ.
- **BFF** giữ token server-side, trình browser chỉ thấy session cookie hash-only; BFF verify token rồi forward với credential của riêng nó — đúng pattern `pact-broker-app`.
- **Không ghi trực tiếp vào database của domain khác** để bỏ qua API/contract; mọi dữ liệu nghiệp vụ đi qua API của context sở hữu.

## 2. Authentication và authorization

- Authentication qua `account`/`auth` như mọi application; token hợp lệ không phải bằng chứng privilege còn hiện hành (A24).
- Authorization deny-by-default, enforce ở resource-owning backend; UI visibility không phải authorization (A23). Chi tiết authorization model → [`docs/domains/staff-access/01-architecture.md`](../../domains/staff-access/01-architecture.md) §5.
- Onboarding staff (gate displayName, fail-closed, chỗ gắn 2FA) → [`docs/domains/staff-access/03-onboarding.md`](../../domains/staff-access/03-onboarding.md).

## 3. Tài liệu liên quan

| Trách nhiệm                                    | Tài liệu canonical                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Domain staff/role/permission/entitlement/audit | [`docs/domains/staff-access/`](../../domains/staff-access/README.md) (12 ADR nằm ở đó)      |
| 12 ADR staff/RBAC                              | [`docs/domains/staff-access/adr/`](../../domains/staff-access/adr/README.md)                |
| Onboarding staff                               | [`docs/domains/staff-access/03-onboarding.md`](../../domains/staff-access/03-onboarding.md) |
| UI/BFF design (thư mục này)                    | các tài liệu dưới đây khi được viết khi composition implement                               |
