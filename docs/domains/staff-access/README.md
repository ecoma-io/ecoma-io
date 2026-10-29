# Staff Access

`staff-access` là bounded context sở hữu **quyền truy cập nội bộ của nhân sự**: nhân sự nội bộ và trạng thái truy cập, catalog vai trò/permission dành cho nhân sự, việc gán vai trò/quyền, entitlement cho phép nhân sự sử dụng các sản phẩm nội bộ, và audit mọi thay đổi quyền/entitlement.

> **Trạng thái:** bounded context **đã được kiến trúc hoá đầy đủ** nhưng **chưa có deploy unit riêng**. Ngày nay trách nhiệm của nó nằm trong `backoffice` — evolution ra sao xem §4. Tài liệu trong thư mục này là **contract thiết kế**, không phải mô tả code hiện có.

## 1. Trách nhiệm

1. **Staff directory và lifecycle** — nhân sự nội bộ, trạng thái truy cập nội bộ (active/suspended/terminated).
2. **Permission catalog và role** — catalog permission `domain.action`, role built-in + custom (custom role v1 tắt — ADR-0004), staff-role assignment.
3. **Product entitlement** — quyền sử dụng sản phẩm nội bộ (backoffice, pact-broker, remote-cache…) của từng nhân sự; sự khác biệt giữa entitlement (product-level availability) và authorization (per-resource/per-operation) là ranh giới bắt buộc — ADR-0009.
4. **Audit** — mọi thay đổi quyền/entitlement để lại audit record (actor, target, action, thời điểm, kết quả, lý do, correlation ID).

Staff Access **không** phải IdP thứ hai và **không** phải credential store: authentication đi qua `account`/`auth` như mọi application khác; nó chỉ tiêu thụ **Account ID** (`sub`) như tham chiếu opaque.

## 2. Ranh giới với các context khác

| Context                 | Sở hữu (rút gọn)                                                                                         | Không sở hữu (rút gọn)                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `account`               | Dữ liệu danh tính: hồ sơ, email đã xác thực, credential, MFA/passkey, browser session, authn audit       | Staff membership, staff role, permission assignment — trạng thái staff ≠ trạng thái account (invariant 31) |
| `auth`                  | Giao thức OAuth 2.0 / OIDC: flows, clients, token issuance/revocation                                    | Business role/permission — **OAuth scope ≠ application-level permission** (A22)                            |
| `staff-access`          | Staff directory/lifecycle, permission/role catalog, assignment, product entitlement, authorization audit | Không phải IdP, không phải credential store; không tự enforce trên resource của context khác               |
| Resource-owning backend | Enforce permission trên operation + tài nguyên của chính nó, trên **mọi** protected request (A23)        | Không tự phát minh permission ngoài catalog                                                                |

Enforcement chia đôi: **catalog govern ở Staff Access; backend enforce ở resource-owning backend.** Token hợp lệ không phải bằng chứng privilege còn hiện hành (A24).

## 3. Entitlement và truyền trạng thái

- Mỗi sản phẩm authorize bằng dữ liệu/quy tắc **thuộc quyền sở hữu của chính nó**; không gọi Staff Access đồng bộ trên mỗi request để hỏi quyền (ADR-0009).
- Thay đổi entitlement/role được ghi cùng transactional outbox trong một transaction (A8) và truyền đến các sản phẩm bằng event bất đồng bộ. **Cơ chế cụ thể và cách bảo đảm revocation latency là quyết định chưa chốt** — xem [`architecture/01-architecture.md`](../../architecture/01-architecture.md) §10 và ADR-0002.
- Entitlement event **không** phải internal authorization-result contract: nó truyền **tính khả dụng sản phẩm**, không truyền verdict allow/deny cho từng request.

## 4. Evolution từ `backoffice`

Quyền staff/RBAC ban đầu được ghi vào `backoffice` (A21–A24, ADR-0001…0012) — quyết định đó vẫn đúng về trách nhiệm nghiệp vụ, nhưng **vị trí sở hữu** sẽ chuyển sang `staff-access` khi deploy unit riêng được xây (roadmap Phase 1 → [`docs/architecture/roadmap.md`](../../architecture/roadmap.md)). Cụ thể:

- **Đã chốt và giữ nguyên:** domain model (staff/role/permission/assignment/audit), 12 ADR, các invariant 31–36, nguyên tắc revocation latency theo risk class.
- **Chuyển sở hữu sang `staff-access`:** database staff/RBAC/audit hiện của `apps/backoffice` (`db-backoffice`) và mọi API quản trị nhân sự/quyền.
- **`backoffice` còn lại:** composition/UI + BFF — không sở hữu nghiệp vụ Staff Access (chi tiết → [`docs/solutions/backoffice/README.md`](../../solutions/backoffice/README.md)).

Việc chuyển này **không** âm thầm sửa quyết định cũ: khi implement, cần một ADR mới ghi rõ việc `staff-access` tiếp quản trách nhiệm đã được A21 gán cho `backoffice` và supersede phạm vi tương ứng.

## 5. Tài liệu

| Document                                     | Nội dung                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`01-architecture.md`](./01-architecture.md) | Ranh giới, domain model khái niệm, authorization model và nơi enforce, invariants   |
| [`02-requirements.md`](./02-requirements.md) | Yêu cầu bảo mật, threat model, acceptance matrix, non-goals, tham chiếu             |
| [`03-onboarding.md`](./03-onboarding.md)     | Onboarding staff: gate displayName, fail-closed vs degrade, cache, chỗ gắn gate 2FA |
| [`adr/`](./adr/README.md)                    | Architectural decision record — mười hai quyết định đã chốt (ADR-0001…0012)         |
