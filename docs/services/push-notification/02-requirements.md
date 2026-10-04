# Push Notification Service Requirements

> **Phạm vi:** functional/non-functional/security requirements, API capabilities, scope và non-goals của `push-notification`. Design/boundary/invariants → [`01-architecture.md`](./01-architecture.md) · vận hành → [`03-operations.md`](./03-operations.md). Viết tắt: MUST/MUST NOT là yêu cầu bắt buộc.

---

## 1. Mục đích

Định nghĩa yêu cầu của `push-notification`: quản lý `Device`, `Push Subscription`, `Push Provider`; tiếp nhận notification intent; thực hiện `Push Routing`; tạo `Push Delivery`; đưa delivery vào Cloudflare Queue; cung cấp internal API cho application và `Admin API` cho `Backoffice`. Kiến trúc phải cho phép bổ sung `App Push` mà không phá vỡ notification contract hiện tại (NFR-010).

---

## 2. Scope và non-goals

### 2.1. Phạm vi phiên bản đầu

```text
Apps        backoffice · llm-seller · llm-console
Transport   web
Provider    web-push
Delivery    web-push-notification-job
```

### 2.2. Non-goals

Phiên bản đầu **chưa bắt buộc** triển khai: `Transport = app`; `Provider = fcm`/`apns`; `app-push-notification-job` — nhưng data model/API contract/routing model **MUST NOT** ngăn cản việc bổ sung (NFR-010).

Ngoài scope (không triển khai): email notification, SMS, in-app notification inbox, notification template engine, campaign management, scheduled notification, marketing analytics, multi-channel orchestration.

---

## 3. Functional Requirements

### FR-001 — Application Isolation

Service **MUST** hỗ trợ nhiều `App`. Mọi `Push Subscription` **MUST** thuộc về đúng một `App`; mọi `Push Notification Request` **MUST** xác định `App`; application không được truy cập namespace của application khác nếu không có authorization phù hợp.

### FR-002 — Device Management

Service **MUST** quản lý `Device` dưới một `User`; `Device` **MUST** có unique identifier; một `Device` có thể có nhiều `Push Subscription`. Device identity **MUST NOT** suy luận bằng IP hoặc User-Agent.

### FR-003 — Push Subscription Registration

Service **MUST** cung cấp API để đăng ký `Push Subscription`. Với `Web Push`, subscription **MUST** lưu đủ dữ liệu để delivery worker thực hiện `Web Push`. Register/update/disable subscription hoạt động; tránh tạo subscription trùng không cần thiết.

### FR-004 — Subscription Lifecycle

Subscription **MUST** có lifecycle `active`, `disabled`, `expired`. Chỉ `active` đủ điều kiện tạo `Push Delivery`. Service **MUST** hỗ trợ disable khi: user unregister, administrator disable, delivery worker xác định subscription không còn hợp lệ.

### FR-005 — Push Provider Management

Service **MUST** quản lý `Push Provider` (`id`, `type`, `name`, `status`, `configuration`, `credential reference`, `app scope`; status `enabled`/`disabled`). Với mỗi `App` + `Transport`, **chỉ có đúng một active primary provider**. Nếu nhiều provider cùng `App`+`Transport` mà không xác định được primary, routing **MUST** fail safely — **MUST NOT** chọn random, **MUST NOT** chọn theo thứ tự database. Provider **MUST** active và thuộc scope hợp lệ trước khi tạo delivery.

### FR-006 — Provider Credential Management

Credential **MUST** được bảo vệ khi lưu trữ, **không lưu plaintext trong Cloudflare D1**; **MUST NOT** xuất hiện trong API response, Queue message, application log, audit log không được bảo vệ. **MUST** ghi `credential_encryption_version` khi lưu; hỗ trợ encryption key rotation; hỗ trợ credential rotation. Rotation không yêu cầu thay đổi `Push Subscription`.

### FR-007 — Provider Scope per App

Provider configuration **MUST** hỗ trợ scope theo `App`. Thay đổi provider của một `App` không ảnh hưởng `App` khác. Không có ambiguity giữa hai provider cho cùng `App` + `Transport` trong v1.

### FR-008 — Notification Creation

Service **MUST** cung cấp API tạo `Push Notification`. Request tối thiểu: `app`, `recipient` (`user_id` hoặc nhiều `user_id`), `notification` (`title`, `body`, `url`, `data`). Caller **MUST NOT** cần biết `transport`/`provider`/`subscription`. `app` **MUST** derive từ authenticated principal; không khớp → từ chối.

### FR-009 — Routing

Routing **MUST** hoàn tất trước khi enqueue delivery (resolve → filter → policy → transport → provider → create → enqueue). Delivery worker **MUST NOT** thực hiện lại routing. Mọi delivery trong Queue **MUST** trỏ tới một subscription cụ thể và chứa `transport`, `provider_id`, `subscription_id`.

### FR-010 — Transport Priority

Mặc định `app > web`: `Device` có cả subscription hợp lệ thì chỉ tạo delivery cho `App Push`; nếu `App Push` không tồn tại/không eligible thì dùng `Web Push`. Priority **chỉ** áp dụng giữa subscriptions thuộc cùng một logical `Device`; **MUST NOT** áp dụng giữa hai `Device` khác nhau của cùng `User`.

### FR-011 — Device Association

Service **MUST** chỉ áp dụng priority giữa các subscription thuộc cùng một logical `Device`. **MUST NOT** coi hai subscription cùng `User` là cùng `Device`. **MUST NOT** dùng IP, User-Agent, network, browser name để xác định device equality.

### FR-012 — Push Delivery Creation

Mỗi delivery **MUST** có unique `delivery_id`. Delivery **MUST** lưu tối thiểu: `delivery_id`, `notification_id`, `user_id`, `device_id`, `subscription_id`, `app`, `transport`, `provider_id`, `status`, `created_at`. Một notification có zero, one hoặc nhiều deliveries.

### FR-013 — Queue Publishing và Outbox

`Notification`, `Delivery`, `Outbox Entry` **MUST** persist trong cùng một D1 transaction — cụ thể là cùng một `db.batch()` (`docs/overview/04-platform-facts.md` DB2); **MUST NOT** dựa vào `BEGIN`/`COMMIT`/isolation level vì chưa xác minh (`docs/overview/01-architecture.md` §10). D1 commit và Queue publish **MUST NOT** coi là atomic — publish bởi `Outbox Publisher` sau commit; duplicate publish phải được chấp nhận. Queue message **MUST** chứa `version`, `delivery_id`, `notification_id`, `subscription_id`, `provider_id`, `transport`, `payload` và **MUST NOT** chứa provider secret.

### FR-014 — Idempotency

Mỗi `delivery_id` đảm bảo **logical delivery identity**, **MUST NOT** diễn giải là exactly-once external provider side effect (`01-architecture.md` §7). Queue consumer **MUST** xử lý duplicate message; duplicate Queue message **MUST NOT** tạo thêm logical delivery. Duplicate external notification trong crash window được chấp nhận.

### FR-015 — Delivery State

Delivery state **MUST** là `pending`, `queued`, `processing`, `delivered`, `failed`, `expired`, `cancelled`. Transition hợp lệ: `pending→queued`, `queued→processing`, `processing→delivered`, `processing→failed`, `pending|queued→cancelled`, `queued|processing→expired`. `delivered`, `failed`, `expired`, `cancelled` là **terminal state** — không transition ngược/ra.

### FR-016 — Invalid Subscription Handling

Khi delivery worker xác định subscription không còn hợp lệ, subscription **MUST** disable/expire. Service **MUST NOT** tạo delivery mới cho subscription đã xác định không hợp lệ.

### FR-017 — Admin API

Service **MUST** cung cấp `Admin API` cho `Backoffice`, hỗ trợ quản lý: `Provider`, `Provider Credential`, `App Provider Mapping`, `Subscription`, `Device`, `Delivery`. Administrator **MUST** có thể: xem configuration, enable/disable provider, rotate credential, inspect/disable subscription, inspect delivery, test delivery. `credential rotation`, `provider enable/disable`, `provider test`, `delivery retry` yêu cầu administrative authorization. `DELETE` là **logical revoke/disable**; physical deletion chỉ theo retention/cleanup policy.

### FR-018 — Provider Test

Test **MUST** gồm configuration test + actual delivery tới target đã authorization. Test result **MUST** phân biệt: `configuration invalid`, `authentication failed`, `provider rejected request`, `subscription invalid`, `delivery accepted`. Test phải có audit record; payload không chứa dữ liệu nhạy cảm không cần thiết.

### FR-019 — Authentication và Authorization

Internal application API và `Admin API` **MUST** có authorization boundary riêng; service không có public API. `app` identity **MUST** derive từ authenticated principal — đối chiếu với body; không khớp → từ chối. Application chỉ được quản lý subscription thuộc scope mình và gửi notification trong scope được cấp quyền.

### FR-020 — Audit

Thao tác quản trị quan trọng **MUST** được audit — tối thiểu: `provider_created`, `provider_updated`, `provider_enabled`, `provider_disabled`, `credential_rotated`, `subscription_disabled`, `subscription_removed`, `notification_created`, `delivery_retried`. Audit record chứa actor và timestamp; secret **MUST NOT** ghi vào audit.

---

## 4. API capabilities

### 4.1. Application API

```text
POST   /v1/devices          GET/DELETE /v1/devices/:id
POST   /v1/subscriptions    PATCH/DELETE /v1/subscriptions/:id
POST   /v1/notifications
```

### 4.2. Admin API

```text
GET/POST /admin/v1/providers            GET/PATCH/DELETE /admin/v1/providers/:id
POST     /admin/v1/providers/:id/test
POST     /admin/v1/providers/:id/rotate-credential
GET      /admin/v1/devices
GET      /admin/v1/subscriptions        PATCH /admin/v1/subscriptions/:id
GET      /admin/v1/notifications
GET      /admin/v1/deliveries           POST  /admin/v1/deliveries/:id/retry
```

### 4.3. Delete semantics

`DELETE subscription` và `DELETE provider` là **logical revoke/disable**. Physical deletion chỉ theo retention/cleanup policy; historical references cần cho audit/delivery history **MUST NOT** xóa trước retention policy cho phép.

---

## 5. Non-Functional Requirements

### NFR-001 — Availability

Failure của một `Push Provider` **MUST NOT** làm unavailable toàn bộ service; failure của một `App` **MUST NOT** làm unavailable các `App` khác; failure của delivery worker **MUST NOT** làm mất notification request đã persist.

### NFR-002 — Asynchronous Delivery

API request **MUST NOT** chờ hoàn thành network delivery tới external provider. Success chỉ xác nhận notification đã accept và delivery đã persist/enqueue theo contract.

### NFR-003 — Retry Safety

Cloudflare Queue at-least-once (`docs/overview/04-platform-facts.md` QU1) → toàn bộ path **MUST** an toàn với duplicate execution; retry **MUST NOT** tạo duplicate logical delivery.

### NFR-004 — Failure Isolation

Failure của `App`, `Device`, `Subscription`, `Provider`, `Transport`, `Delivery Worker` phải cô lập; failure của một entity **MUST NOT** làm hỏng entity độc lập.

### NFR-005 — Performance

API đồng bộ **MUST** chỉ thực hiện: validate → persist → route → enqueue. **MUST NOT** thực hiện blocking network delivery tới external provider.

### NFR-006 — Scalability

Control plane, queue consumer và database scale độc lập; delivery throughput **MUST NOT** yêu cầu scale API theo cùng tỷ lệ.

### NFR-007 — Observability

Mọi notification và delivery **MUST** có correlation identifiers: `request_id → notification_id → delivery_id → subscription_id → provider_id`. Log **MUST** truy vết được lifecycle, **MUST NOT** chứa secret.

### NFR-008 — Security

Service **MUST** bảo vệ provider credential, Push Subscription credential, authorization boundary, application data, audit data. Secret **MUST** encrypted at rest, **MUST NOT** xuất hiện trong log/Queue/API response.

### NFR-009 — Data Integrity

Quan hệ giữa entities **MUST** được enforce; **MUST NOT** tạo cross-app resource trái phép hoặc invalid references.

### NFR-010 — Evolution (App Push)

Schema và API **MUST** cho phép bổ sung `Transport = app`, `Provider = fcm`/`apns`, `app-push-notification-job` mà không đổi core notification request contract; thêm provider mới **MUST NOT** yêu cầu đổi business service đang tạo notification. `Chrome`/`Firefox`/`Edge` là `Browser Push Service` dưới `web-push` protocol — không phải Provider abstraction.

---

## 6. Security Requirements

### SR-001 — Credential Encryption

Provider credential **MUST** được encrypted at rest.

### SR-002 — Credential Isolation

Credential **MUST** chỉ giải mã được bởi component có quyền thực hiện provider delivery hoặc provider validation.

### SR-003 — Queue Isolation

Queue message **MUST NOT** chứa private credential (private key, secret, access token, auth key, subscription secret).

### SR-004 — Administrative Access

`credential rotation`, `provider modification`, `provider deletion`, `delivery retry`, `subscription administration` **MUST** yêu cầu administrative authorization.

### SR-005 — Secret Redaction

Logging layer **MUST** redact `private key`, `secret`, `access token`, `auth key`, `subscription secret`.
