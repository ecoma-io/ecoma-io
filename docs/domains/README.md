# Domains

> **Phạm vi:** ngôn ngữ domain dùng chung của Ecoma, catalog các bounded context, context map theo kiến trúc đích, và các ranh giới còn chưa chốt. Đây là **tài liệu canonical** cho ba thứ đó; mọi tài liệu khác chỉ tham chiếu, không sao chép.
>
> Tài liệu này **không** chứa topology/hostname/routing → [`01-architecture.md`](../architecture/01-architecture.md) · database/binding → [`01`](../architecture/01-architecture.md) §4 · Nx project graph/tag/DDD layer → [`05-code-architecture.md`](../architecture/05-code-architecture.md) · API/event schema/protocol → machine-readable contract · deployment/CI/CD/runbook/platform fact → [`02`](../architecture/02-delivery.md)/[`03`](../architecture/03-operations.md)/[`04`](../architecture/04-platform-facts.md) · trạng thái triển khai → không ghi ở đây.
>
> **Quy tắc đọc:** tài liệu này mô tả **kiến trúc đích**, không phải hiện trạng. Một bounded context không bị loại khỏi catalog vì thiếu runtime, database, hay provisioning — `payment` và `llm` là ví dụ. "Chưa triển khai" không đồng nghĩa "chưa chốt": chỉ những quyết định **thật sự chưa có đáp án** mới vào §5.

---

## 1. Mục đích và cách đọc

Domain map trả lời bốn câu hỏi:

1. **Ngôn ngữ domain dùng chung là gì?** (§2) — các thuật ngữ xuyên hệ thống, mỗi thuật ngữ mang nghĩa gì trong Ecoma, context nào sở hữu nó, và nó khác các thuật ngữ hay bị nhầm.
2. **Bounded context nào tồn tại, trách nhiệm và ranh giới ra sao?** (§3) — catalog.
3. **Các context tương tác với nhau như thế nào trong kiến trúc đích?** (§4) — context map.
4. **Còn ranh giới nào thật sự chưa chốt?** (§5) — chỉ những mục đó, không phải "chưa implement".

### 1.1 Bốn trục không được nhầm lẫn

| Trục                   | Nghĩa                                                                     | Ví dụ                                                                        | Nơi canonical                                        |
| ---------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Bounded context**    | Ranh giới nghiệp vụ — ai sở hữu trách nhiệm và dữ liệu của một capability | `pact-broker`                                                                | **Domain map (tài liệu này)**                        |
| **Deploy unit**        | Một Worker/runtime unit chạy request                                      | `account`, `auth`                                                            | [`01`](../architecture/01-architecture.md) §2        |
| **Nx scope**           | Trục sở hữu code (`scope:*`)                                              | `scope:messaging` bao trùm control + delivery plane của `transactional-mail` | [`05`](../architecture/05-code-architecture.md) §6.3 |
| **Deployment project** | Project Pulumi provision hạ tầng                                          | `deploys/account-deploy`                                                     | [`05`](../architecture/05-code-architecture.md) §2.1 |

Một bounded context có thể có **nhiều** deploy unit (A10) — đó là chủ đích, không phải bất thường. Một scope có thể bao trùm nhiều deploy unit cùng context. Deployment project sở hữu **hạ tầng**, không sở hữu bounded context. Nhầm bốn trục này thành một là nguồn gốc của mọi nhầm lẫn trong navigation và ownership. `account` và `auth` là hai bounded context riêng — tách deploy unit của chúng không phải ví dụ cho trục này; ví dụ đúng là `pact-broker` (một context, hai deploy unit) và `transactional-mail` (control plane + delivery plane).

### 1.2 Quy tắc về hiện trạng

- **Không** có cột/ký hiệu "đã implement / chưa implement / chưa provision / chưa deploy" trong catalog hay context map. Trạng thái triển khai là thuộc tính của implementation, không phải của domain map.
- "Chưa triển khai nhưng đã kiến trúc hoá" (ví dụ `payment`) **vẫn nằm trong catalog** với đầy đủ trách nhiệm và ranh giới — vì tài liệu kiến trúc đã định nghĩa nó.
- "Chưa chốt quyết định" (ví dụ hợp đồng crediting giữa `payment` và `llm`) **không** phải "chưa triển khai" — nó vào §5, không vào catalog.

---

## 2. Ngôn ngữ domain dùng chung

Mỗi thuật ngữ dưới đây được định nghĩa theo **nghĩa Ecoma**, không theo nghĩa chung của industry. Glossary này **không** ép các bounded context dùng chung một từ vựng: mỗi context giữ autonomy trong naming nội bộ; đây chỉ là bản đồ để các context nói chuyện được với nhau.

### 2.1 Account / Account ID / `sub`

- **Account** — bằng chứng đăng nhập của một người dùng; là trách nhiệm nghiệp vụ của bounded context `account`. Gồm credential, MFA/passkey, browser session, profile, preference, privacy/legal consent. Không phải "user nghiệp vụ" của bất kỳ application nào.
- **Account ID (`sub`)** — opaque identifier của account, không tái sử dụng, không tái phát hành. Là **tham chiếu** mà các context khác (vd. `staff-access` staff member, `pact-broker` tenant membership) dùng để liên kết; **không** phải foreign key xuyên database, và **không** phải quan hệ sở hữu (A21).
- **Khác biệt:** `sub` ≠ email (email là contact credential + login identifier, không phải OIDC `sub`); `sub` ≠ staff member (staff là khái niệm của `staff-access`, liên kết bằng `sub`).

### 2.2 Authentication / Authorization

- **Authentication** — chứng minh người dùng đã xác thực. Nguồn sự thật: `account` (`db-account`). `auth` **không** tự trả lời được câu hỏi này; nó nhận kết quả qua contract đã xác thực.
- **Authorization** — quyết định người dùng được làm gì trên tài nguyên của một application. Nguồn sự thật: application sở hữu tài nguyên đó, với permission catalog do `staff-access` định nghĩa. Token hợp lệ **không** tự động hàm ý quyền (A22, invariant 32).

### 2.3 Staff / Role / Permission / Entitlement / OAuth scope

- **Staff** — người dùng được gán vai trò trong `staff-access`; liên kết account bằng `sub`. Trạng thái staff **không** phải trạng thái account (invariant 31).
- **Role** — tập permission gán cho staff trong `staff-access` (role built-in + custom role — custom role v1 **tắt** theo ADR-0004).
- **Permission** — capability theo hình `domain.action`, catalog do `staff-access` sở hữu; backend sở hữu tài nguyên tự enforce trên mọi protected request (A23).
- **Entitlement** — quyền **sử dụng một sản phẩm** (product-level availability) của một nhân sự, do `staff-access` sở hữu. Entitlement **không** phải authorization: nó không trả lời allow/deny cho từng operation; sản phẩm tự authorize bằng dữ liệu của chính nó (ADR-0009).
- **OAuth scope** — quyền truy cập protocol mà client yêu cầu trong luồng OAuth 2.0/OIDC. **Không** phải application-level permission, không mang trạng thái staff, không đủ granularity cho object-level check. `auth` không nhúng role/permission nghiệp vụ vào token (A22).

### 2.4 Tenant / Membership / Workspace

- **Tenant** — ranh giới cách ly dữ liệu của một tổ chức/customer. Trong Ecoma, `pact-broker` sở hữu tenant/membership/role **của chính broker**; các context khác (vd. `llm`) có khái niệm workspace/seller riêng và không dùng chung tenant của broker.
- **Membership** — quan hệ giữa một account (`sub`) và một tenant, kèm role trong tenant đó. Membership **không** được cấp tự động khi signup/login — kể cả tenant nội bộ `ecoma-internal`; provision vào tenant nội bộ bắt đầu với quyền `Member` trừ khi có quy trình cấp quyền quản trị rõ ràng.
- **Workspace** — không gian làm việc trong `llm` (seller/workspace, offer, catalog, thống kê). Khác tenant của broker; không đồng nhất hai khái niệm.

### 2.5 Payment / Credit / Ledger / Transaction / Payout

- **Payment** — bounded context sở hữu ledger credit, payment transaction và seller payout. Chưa có deploy unit; vẫn là bounded context vì tài liệu kiến trúc đã định nghĩa trách nhiệm và data ownership.
- **Credit** — đơn vị giá trị lưu trong ledger của `payment` (`db-payment`, `01` §4). Quan hệ giữa credit của `payment` và quota của `llm` là **chưa chốt** — không giả định hai bên dùng chung một nguồn sự thật; xem §5.1.
- **Ledger** — sổ cái credit do `payment` sở hữu (`db-payment`).
- **Payment transaction** — giao dịch thanh toán do `payment` sở hữu.
- **Payout** — chi trả cho seller do `payment` sở hữu.

### 2.6 Quota / Usage / Reservation / Settlement

- **Quota** — giới hạn tài nguyên (token/request) mà `llm-api` cấp cho một consumer/key; authority nằm ở PostgreSQL (`db-llm-gateway`) (A7, invariant 16).
- **Usage** — lượng tài nguyên đã thực sự tiêu thụ, được ghi bền vào PostgreSQL.
- **Reservation** — bản ghi bền giữ quota tại thời điểm reserve; idempotent theo `reservation_id` (A7).
- **Settlement** — quá trình chốt usage đã phục vụ vào PostgreSQL; idempotent theo `reservation_id`. Settlement debt (usage đã phục vụ nhưng chưa ghi được bền) là correctness requirement chưa chốt (xem [`03`](../architecture/03-operations.md) §3.2b và §5.3 dưới).

### 2.7 Provider

"Provider" mang **ba nghĩa khác nhau** tuỳ context — phải phân biệt theo context đang nói:

| Context              | Provider nghĩa là                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `payment`            | Payment provider (cổng thanh toán bên ngoài) — tài liệu kiến trúc đề cập, chi tiết chưa có |
| `transactional-mail` | Mail relay provider (Cloudflare Email Service mặc định v1) — delivery plane dùng           |
| `push-notification`  | Push provider (`web-push`/`fcm`/`apns`) + provider credential — control plane quản lý      |

Không có "provider chung" xuyên các context.

### 2.8 Message / Notification / Delivery

- **Message** — một email giao dịch do `transactional-mail` sở hữu (template, message, outbox). Consumer tạo qua `POST /v1/messages`.
- **Notification** — một ý định thông báo do `push-notification` sở hữu (Push Notification → Routing → Push Delivery).
- **Delivery** — một lần gửi thực sự (Web Push / email) do delivery plane (job worker) thực hiện, dưới sự điều khiển của control plane. Delivery **không** quyết định recipient/template/content — control plane materialize.
- **Transport** vs **Provider** (push): Transport là kênh (`web`/`app`); Provider là nhà cung cấp (`web-push`/`fcm`/`apns`). Hai trục độc lập.

### 2.9 Pact / Verification / Version / Environment / can-i-deploy

- **Pact** — hợp đồng consumer-driven giữa consumer và provider, do `pact-broker` lưu và phân phát.
- **Verification** — kết quả kiểm tra provider có thoả pact hay không.
- **Version** — phiên bản của một pacticipant (service) được publish.
- **Environment** — môi trường deployment mà broker ghi nhận (deployed/undeployed versions).
- **can-i-deploy** — truy vấn broker trả lời "version này có thể deploy vào environment này không", dựa trên verification + deployment record. Broker **ghi nhận** deployment, **không thực hiện** deployment thật (invariant broker).
- **Machine token** — credential riêng cho Pact CLI/CI; không chia sẻ với browser session.

### 2.10 Bounded Context vs Deploy Unit

- **Bounded Context** — ranh giới nghiệp vụ; sở hữu trách nhiệm và dữ liệu (§3).
- **Deploy Unit** — một Worker/runtime unit chạy request; có thể nhiều deploy unit trong một bounded context (A10).
- **Quy tắc:** deploy unit **không** tạo bounded context mới. `pact-broker-api` và `pact-broker-app` cùng là `pact-broker`; `transactional-mailer-job` cùng là `transactional-mail`; `web-push-notification-job` cùng là `push-notification`. Ngược lại, `account` và `auth` là ví dụ cho chiều đối: hai bounded context **riêng** (§3), mỗi context một deploy unit serving + một database owner.

---

## 3. Catalog bounded context

### 3.1 Bảng catalog

| Bounded Context      | Trách nhiệm                                                                                                                                                                                                          | Sở hữu và ranh giới                                                                                                                                                                  | Deploy units liên quan                                                               | Tài liệu chi tiết                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `account`            | Bằng chứng đăng nhập, account lifecycle + status, credential (email OTP login), MFA/TOTP/passkey, recovery codes, authentication evidence + model ACR assurance, browser session, profile/preference/privacy request | Sở hữu `db-account` (PG); `sub` là tham chiếu opaque không FK; **không** sở hữu giao thức OAuth 2.0/OIDC — đẩy kết quả xác thực sang `auth` qua contract back-channel                | `account`                                                                            | [`domains/account`](../domains/account/README.md)                                                                                                                |
| `auth`               | OAuth 2.0/OIDC authorization server: authorization transaction, consent decision, clients, grants, authorization codes, tokens, revocation, discovery, JWKS, signing keys                                            | Sở hữu `db-auth` (PG); API-only, không UI; **không** tự xác minh danh tính — nhận kết quả xác thực của `account` qua contract đã xác thực; không đọc `db-account`                    | `auth`, `auth-nonce-prune-job` (maintenance)                                         | [`domains/auth`](../domains/auth/README.md)                                                                                                                      |
| `staff-access`       | Staff directory, lifecycle, permission catalog, role, staff-role assignment, product entitlement, authorization audit                                                                                                | Sở hữu staff/RBAC/entitlement/audit; **không** sở hữu danh tính account hay credential; enforcement chia đôi: catalog govern ở đây, resource-owning backend tự enforce (A21–A24)     | target: `staff-access` (Phase 1)                                                     | [`domains/staff-access`](../domains/staff-access/README.md), [`adr/`](../domains/staff-access/adr/README.md)                                                     |
| `pact-broker`        | Consumer-driven contract testing: pacts, verifications, can-i-deploy, environments/deployment record, tenant/membership/role **của broker**, machine token                                                           | Broker sở hữu tenant/membership/role của chính nó; `sub` opaque; broker ghi nhận deployment, không thực hiện deployment thật                                                         | `pact-broker-api`, `pact-broker-app`                                                 | [`domains/pact-broker`](../domains/pact-broker/README.md)                                                                                                        |
| `transactional-mail` | Control plane email giao dịch: template, message, outbox; nhận request từ consumer, render, enqueue delivery                                                                                                         | Control plane sở hữu `mail` (D1); delivery plane (mailer-job) là deploy unit của context này, không context ngang hàng; consumer `account`/`auth`/`payment` tạo message qua contract | `transactional-mail`, `transactional-mailer-job` (delivery)                          | [`domains/transactional-mail`](../domains/transactional-mail/README.md), [`solutions/transactional-mailer-job`](../solutions/transactional-mailer-job/README.md) |
| `push-notification`  | Control plane notification: device, subscription, provider, routing, delivery state machine; nhận notification intent, tạo delivery, enqueue                                                                         | Control plane sở hữu `push` (D1); delivery plane (web-push-notification-job) là deploy unit; producer là account/auth/payment/llm-api theo tài liệu                                  | `push-notification`, `web-push-notification-job` (delivery)                          | [`domains/push-notification`](../domains/push-notification/README.md), [`solutions/web-push-notification-job`](../solutions/web-push-notification-job/README.md) |
| `llm`                | API key, quota, usage, reservation, settlement tại gateway; workspace/seller/offer/catalog/thống kê tại các app llm-*                                                                                                | `llm-api` sở hữu `db-llm-gateway` (PG) và là quota/settlement authority (A7); các app `llm-*` không sở hữu DB, ghi qua contract/API. Các app không tách thành context riêng          | `llm-api`, `llm-home`, `llm-seller`, `llm-console`, `llm-models`, `llm-subscription` | [`01`](../architecture/01-architecture.md) §2, §4                                                                                                                |
| `payment`            | Ledger credit, payment transaction, seller payout                                                                                                                                                                    | Sở hữu `db-payment` (PG); deploy unit `payment` phục vụ public + payment webhook tại `payment.ecoma.io` (`01` §2, §7)                                                                | `payment`                                                                            | [`01`](../architecture/01-architecture.md) §2, §4                                                                                                                |

### 3.2 Ghi chú per-context

**`account`.** Một deploy unit, một DB owner (`db-account`). Sở hữu danh tính đăng nhập và mọi UI tài khoản; **không** sở hữu giao thức OAuth 2.0/OIDC — kết quả xác thực được **đẩy** sang `auth` qua contract back-channel (`01` §6, invariant 27). Design chi tiết → service docs.

**`auth`.** Một deploy unit serving (API-only) + `auth-nonce-prune-job` là maintenance plane của context, không sở hữu storage. Sở hữu giao thức OAuth 2.0/OIDC và mọi protocol state; **không** tự xác minh danh tính và **không** render UI account (`01` §6, invariant 24). Hai context `account`/`auth` có hai database, hai owner, hai role riêng (A2, A9) — tách này tạo service/deployment/protocol/security boundary riêng (A10). Design chi tiết → service docs.

**`pact-broker`.** Hai deploy unit (API + dashboard app) cùng một context. Broker sở hữu tenant/membership/role **của chính broker**, không suy ra từ `staff-access` hay scope khác (A21). Quyền truy cập sản phẩm từ Staff Access **không thay thế** authorization bên trong broker; nhân sự nội bộ không tự động có quyền trên customer tenants; tenant nội bộ `ecoma-internal` được bootstrap **tường minh và có kiểm soát**, không qua signup/login; thu hồi entitlement không cascade-delete customer membership hay machine credentials ngoài vòng đời nhân sự. `sub` opaque. can-i-deploy là câu trả lời dựa trên verification + deployment record; broker **ghi nhận** deployment, **không thực hiện** deployment thật. Dogfooding: `llm-console`, `llm-seller`, `backoffice` publish/verify qua broker.

**`transactional-mail`.** Control plane + delivery plane. `transactional-mailer-job` là delivery unit của context này, không phải peer context. Consumer tạo message qua contract `POST /v1/messages`: `account`, `auth`, `payment` ([`02-requirements.md`](../domains/transactional-mail/02-requirements.md) của mail).

**`push-notification`.** Control plane + delivery plane. `web-push-notification-job` là delivery unit. Producer notification intent theo tài liệu: `account`/`auth`, `payment`, `llm-api` (push [`01-architecture.md`](../domains/push-notification/01-architecture.md) §12); Admin API cho `backoffice`. Applications phiên bản đầu: `backoffice` · `llm-seller` · `llm-console` (push `02-requirements` §2.1). Routing chỉ ở control plane; Transport (`web`/`app`) và Provider (`web-push`/`fcm`/`apns`) là hai trục độc lập.

**`llm`.** Một bounded context dù có nhiều app. `llm-api` sở hữu gateway DB và là quota/settlement authority (A7). Các app `llm-*` không sở hữu DB, ghi qua contract/API. **Không** tách `llm-home`/`llm-seller`/... thành bounded context riêng chỉ vì chúng là app/deploy unit — deploy unit không tạo context (§1.1).

**`payment`.** Context có đầy đủ định nghĩa kiến trúc: deploy unit `payment` (public + payment webhook, `payment.ecoma.io`) và data ownership `db-payment`. Trách nhiệm nghiệp vụ (ledger credit, payment transaction, seller payout) đã chốt ở `01` §2/§4; **hợp đồng với `llm`** là phần chưa chốt (§5.1). Thiếu runtime không loại context.

### 3.3 Completeness check

Catalog hiện tại có 8 bounded context (trong đó `staff-access` là **target architecture**, chưa có deploy unit riêng — việc `staff-access` tiếp quản staff/RBAC từ `backoffice` đã được chốt bằng [ADR-0013](../domains/staff-access/adr/0013-staff-access-ownership-transfer.md), deploy unit/runtime còn chờ roadmap Phase 1 P1.4; xem [`domains/staff-access/README.md`](../domains/staff-access/README.md) §4). `backoffice` là composition/UI + BFF — không phải bounded context vì không sở hữu dữ liệu nghiệp vụ; spec của nó nằm ở [`solutions/backoffice`](../solutions/backoffice/README.md). Các thành phần còn lại của repo **không** phải bounded context nghiệp vụ — phân loại ở §6. Nếu phát hiện một capability nghiệp vụ mới không thuộc các context trên, phải thêm vào catalog (và cập nhật §4/§5 tương ứng) thay vì nhét vào một context có sẵn mà không xem xét.

---

## 4. Context map

### 4.1 Legend

- **Mũi tên liền `A → B`** = A phụ thuộc/nhờ B về mặt nghiệp vụ (A là consumer, B là provider), hoặc A gửi intent/event sang B.
- **Mũi tên đứt nét `A -.-> B`** = quan hệ chỉ có mặt consumer/producer trong tài liệu, flow chi tiết chưa có tài liệu (R4), hoặc quan hệ còn **OPEN** (R6 — hai chiều đứt nét).
- **`sub` (opaque reference)** = tham chiếu không FK xuyên database; toàn vẹn là responsibility của contract + reconciliation.
- **Control plane / Delivery plane** = cùng một bounded context, hai deploy unit với trách nhiệm khác nhau; delivery plane không quyết định recipient/template/content.
- **Catalog govern / Backend enforce** = `staff-access` định nghĩa permission; resource-owning backend tự enforce.
- Mermaid chỉ là hình minh hoạ; **bảng §4.3 là canonical** (mỗi quan hệ có mô tả + nguồn). Màu/ký hiệu không mang ý nghĩa duy nhất.

### 4.2 Sơ đồ (Mermaid)

```mermaid
flowchart LR
  account[account]
  auth[auth]
  staff-access[staff-access]
  backoffice[backoffice (composition)]
  pact[pact-broker<br/>api + app]
  mail[transactional-mail<br/>+ mailer-job]
  push[push-notification<br/>+ web-push-job]
  llm[llm<br/>llm-api + llm-* apps]
  payment[payment]

  account -- "sub opaque ref" --> staff-access
  auth -- "sub opaque ref (access token)" --> pact
  account -- "email OTP flow (R3)" --> mail
  auth -. "mail consumer, flow chưa có tài liệu (R3)" .-> mail
  payment -. "mail consumer (R4)" .-> mail
  staff-access -- "catalog govern, backend enforce (R5)" --> account
  staff-access -- "catalog govern, backend enforce (R5)" --> auth
  staff-access -- "catalog govern, backend enforce (R5)" --> llm
  staff-access -- "catalog govern, backend enforce (R5)" --> payment
  payment <-. "crediting / settlement OPEN (R6)" .-> llm
  account -- "notification intent producer (R7)" --> push
  auth -- "notification intent producer (R7)" --> push
  payment -- "notification intent producer (R7)" --> push
  llm -- "notification intent producer (R7)" --> push
  backoffice -- "Admin API (R8)" --> push
  pact -- "verification / can-i-deploy (R9)" --> account
  pact -- "verification / can-i-deploy (R9)" --> auth
  pact -- "verification / can-i-deploy (R9)" --> backoffice
  pact -- "verification / can-i-deploy (R9)" --> llm
```

⚠️ Sơ đồ chỉ minh hoạ các quan hệ có tài liệu hậu thuẫn. Mũi tên `payment ↔ llm` được đánh dấu **OPEN** — xem §5.1, không kết luận về hướng gọi hay về nguồn sự thật.

### 4.3 Bảng quan hệ (canonical)

| #   | Quan hệ                                                                         | Mô tả                                                                                                                                                                                                                                   | Nguồn                                                     |
| --- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| R1  | `account` → `staff-access` (sub reference)                                      | `staff-access` liên kết staff member bằng `sub` của account; là tham chiếu, không FK xuyên DB. Authentication đi qua `auth`/`account` như mọi application                                                                               | `01` §2.2, A21, invariant 7 (cross-service database)      |
| R2  | `auth` → `pact-broker` (sub reference)                                          | Broker dùng `sub` từ access token do `auth` phát hành (opaque, không FK); tenant mặc định được provision **tường minh** qua bootstrap script, không tự động khi signup/login                                                            | `domains/pact-broker` §3.1, §4                            |
| R3  | `account`/`auth` → `transactional-mail`                                         | Cả hai là consumer được liệt kê của mail control plane (`domains/transactional-mail` §2.1): luồng email-OTP của `account` gửi mail qua `POST /v1/messages` (template login-OTP); luồng mail của `auth` chưa có tài liệu riêng (như R4)  | `domains/transactional-mail` §2.1, `domains/account` §3.7 |
| R4  | `payment` → `transactional-mail`                                                | `payment` là consumer được liệt kê của mail control plane (tạo message qua contract). Chi tiết template/flow chưa có trong tài liệu hiện tại                                                                                            | `domains/transactional-mail` §2.1 (consumer list)         |
| R5  | `staff-access` ↔ resource-owning contexts (`account`, `auth`, `llm`, `payment`) | `staff-access` định nghĩa permission catalog + assignment + product entitlement; resource-owning backend tự enforce trên mọi protected request. Không có sync call per request; state lan truyền bằng batch/event-based sync (ADR-0009) | A21–A24, ADR-0009, `staff-access` §5                      |
| R6  | `payment` ↔ `llm` (quota/usage/reservation/settlement)                          | **OPEN.** `payment` sở hữu ledger credit/transaction/payout; `llm` sở hữu quota/usage/reservation/settlement tại gateway. Hợp đồng giữa hai context (crediting, reconciliation, settlement) chưa chốt — xem §5.1                        | `01` §4 (ownership), A7, `03` §3.2b                       |
| R7  | `account`/`auth`/`payment`/`llm-api` → `push-notification`                      | Các context này là producer notification intent (account/auth events; payment; llm-api). Routing chỉ ở control plane                                                                                                                    | `push-notification` §12                                   |
| R8  | `backoffice` → `push-notification`                                              | Admin API (caller hiện tại là composition `backoffice`): quản lý provider/credential/app-provider mapping/subscription/device/delivery (enable/disable, rotate credential, emergency hold/revoke, inspect, test)                        | `push-notification` §1, §8.1, `02-requirements` FR-017    |
| R9  | `pact-broker` ↔ verified services                                               | Broker lưu pacts, ghi nhận verification, trả `can-i-deploy` (tri-state fail-closed); dogfooding bởi `llm-console`, `llm-seller`, `backoffice`. Broker **ghi nhận** deployment, không thực hiện deployment thật                          | `domains/pact-broker` §1, §6                              |
| R10 | Delivery jobs ↔ control plane (mail/push)                                       | `transactional-mailer-job` và `web-push-notification-job` là deploy unit của context mẹ; consume Queue, resolve runtime qua private interface, ghi job state vào D1 riêng. Không quyết định recipient/template/content                  | `solutions/*-job` §1–§2                                   |

### 4.4 Quan hệ được xem xét nhưng chưa có tài liệu hậu thuẫn

Các quan hệ sau **không** được vẽ thành arrow trong §4.2 vì tài liệu hiện tại chưa hậu thuẫn đủ; chúng vào §5 nếu là quyết định chưa chốt, hoặc chỉ đơn giản là "không có quan hệ":

- `payment` → `account` (sub reference cho payout recipient?) — chưa có tài liệu; không suy ra.
- `llm` → `account` (workspace/seller liên kết account?) — chưa có tài liệu về mapping; không suy ra.
- `payment` → `push-notification` producer — có trong danh sách producer (R7), nhưng flow chi tiết (trigger, payload, idempotency) chưa có tài liệu; producer-level only.
- Direct call giữa `payment` và `llm` — không kết luận là có hay không; §5.1 giữ mở.

---

## 5. Ranh giới chưa chốt

Chỉ những mục **thật sự chưa có đáp án**. Mỗi mục nói rõ: cái gì **đã chốt**, cái gì **chưa**, **vì sao quan trọng**, **link nguồn**. Không copy toàn bộ bảng unresolved của `01` §10.

### 5.1 Hợp đồng crediting / reconciliation / settlement giữa `payment` và `llm`

- **Đã chốt:** trách nhiệm phân chia — `payment` sở hữu ledger credit/transaction/payout (`db-payment`); `llm` sở hữu quota/usage/reservation/settlement tại gateway (`db-llm-gateway`, A7). Hai nguồn sự thật khác nhau, hai DB khác nhau.
- **Chưa chốt:** credit từ `payment` có liên quan thế nào tới quota của `llm` (không kết luận là có cơ chế cấp quota tự động); ledger credit và quota usage là một đại lượng hay hai; quan hệ giữa credit/seller payout và settlement của gateway ra sao (không phát minh refund/chargeback semantics); reconciliation giữa hai nguồn sự thật; có cần direct call giữa hai context không và theo hướng nào.
- **Vì sao quan trọng:** nếu ngầm giả định "payment tự tạo quota" hoặc "cùng source of truth", sẽ vi phạm A7 (PostgreSQL là quota authority) và ownership §4. Đây là ranh giới có nguy cơ bị "lấp đầy" bằng giả định nếu không ghi rõ.
- **Nguồn:** `01` §4 (ownership table), A7, invariant 16, `03` §3.2b (settlement debt).

### 5.2 Cơ chế lan truyền entitlement/authorization state của `staff-access` + revocation latency

- **Đã chốt:** ADR-0009 — **không** có contract nhận kết quả authorization; không sync call per request; chỉ batch/event-based sync. Backend tự enforce với dữ liệu nó có. ADR-0002 — target revocation latency `normal` ≤ 60s, `high` ≤ 5s (là target, không tự hiện đại hoá thành cơ chế). Hai ADR này phải được đọc **cùng nhau**.
- **Phân biệt bắt buộc — entitlement event ≠ authorization-result contract:** event truyền **tính khả dụng sản phẩm** (product availability — context được dùng sản phẩm này không) qua outbox/event; nó **không** phải một synchronous internal authorization-result contract và không truyền verdict allow/deny cho từng request (ADR-0009 vẫn nguyên hiệu lực). Per-product authorization vẫn dùng dữ liệu/quy tắc thuộc quyền sở hữu của chính sản phẩm.
- **Ràng buộc delivery:** Cloudflare Queues là **at-least-once, unordered, batch retry** (`04-platform-facts.md` QU1/QU4) — delivery bất đồng bộ có thể bị delay, retry, duplicate hoặc xử lý sai thứ tự. **Không được tuyên bố Queues đơn thuần bảo đảm độ trễ ≤5s.** Đáp ứng target `high` ≤ 5s (nếu được chốt) cần cơ chế bổ sung (re-check-at-write-time — đã là bắt buộc theo ADR-0002 — và/hoặc lease/revalidation/freshness bound); việc chọn cơ chế là **open decision**.
- **Chưa chốt:** hình thức cụ thể của batch/event-based sync (outbox event, batch pull, projection do backend giữ); cơ chế thiết kế đáp ứng ngưỡng latency trước khi bật role assignment thật; cách đo/verify target trong runtime; fail-closed hay fail-open khi event state stale.
- **Vì sao quan trọng:** ADR-0009 đã chốt **hình dạng** (không sync call), nhưng **cơ chế cụ thể** còn mở; nếu tự chọn một cơ chế và viết thành quyết định, sẽ vượt quá authority của tài liệu hiện tại. Âm thầm hạ SLA hoặc biến target ≤5s thành giả định là vi phạm A24.
- **Nguồn:** `staff-access/adr/0009`, `staff-access/adr/0002`, `01` §10 (bounded revocation latency), `04` QU1/QU4.

### 5.3 Settlement debt của `llm-api` (usage đã phục vụ nhưng chưa ghi bền)

- **Đã chốt:** Fail closed là chính sách đúng; reservation durable, settle/release idempotent theo `reservation_id` (A7, invariant 16). Settlement backlog age là operational signal.
- **Chưa chốt:** nhánh A (chấp nhận thất thoát) vs nhánh B (store bền ngoài VPS); RPO của store bền; settle theo lô giữa stream để giảm cửa sổ.
- **Vì sao quan trọng:** correctness requirement, không phải HA feature; ảnh hưởng revenue và quota.
- **Nguồn:** `03` §3.2b, `01` §10.

### 5.4 Relay outbox (cơ chế gửi event chéo service)

- **Đã chốt:** Event bất đối xứng đi qua transactional outbox nằm chung transaction với state (A8); Queue chỉ là delivery channel, không phải source of truth; consumer phải idempotent.
- **Chưa chốt:** Worker relay đọc bảng outbox, Queue hay NATS; cơ chế cụ thể.
- **Vì sao quan trọng:** mọi event chéo context (account→auth, payment→mail, staff-access→resource backend) đều phụ thuộc cơ chế này.
- **Nguồn:** `01` §5, §10.

### 5.5 Rate limit / negative auth cache cho `llm-api`

- **Đã chốt:** quota authority ở PostgreSQL; không fallback KV làm sai quota (A7, invariant 16).
- **Chưa chốt:** rate limit per-key/bucket và negative auth cache cho `api.ecoma.io/llm`; caller không phải Worker cho Admin API của `llm-api` (nếu có thì bảo vệ bằng gì).
- **Vì sao quan trọng:** cửa vào public của gateway; sai cấu hình ảnh hưởng toàn bộ đường metering.
- **Nguồn:** `01` §10 (hai hàng tương ứng).

### 5.6 Trigger của publisher outbox (push-notification)

- **Đã chốt:** producer notification intent (account/auth/payment/llm-api) và Admin API cho `backoffice`; routing chỉ ở control plane; Transport vs Provider hai trục; publisher **MUST** chạy định kỳ để claim record outbox đến hạn và entry point publish là route nội bộ của control plane.
- **Chưa chốt:** **cơ chế trigger** cụ thể của publisher (Cron Trigger, relay ngoài, cơ chế khác) — launch gate của PR implementation; và thuộc tính (ii) "không Worker invocation nào bị tính phí khi không có gì để publish" **chưa** được chứng minh cho cơ chế trigger nào.
- **Vì sao quan trọng:** quyết định chi phí vận hành và SLA recovery của outbox; không được giả định một trigger đã tồn tại.
- **Nguồn:** `domains/push-notification/01-architecture.md` §6 (publisher trigger, thuộc tính i/ii).

### 5.7 Các quan hệ context chưa có tài liệu hậu thuẫn

- **Đã chốt:** không có.
- **Chưa chốt:** mapping `account`↔`payment` (payout recipient?), `account`↔`llm` (workspace/seller ↔ account?), và bất kỳ quan hệ nào §4.4 liệt kê.
- **Vì sao quan trọng:** tránh "lấp đầy" bằng giả định. Khi tài liệu xuất hiện, cập nhật §4 + §5 cùng lúc.
- **Nguồn:** `01` §2, §4; service docs hiện tại.

> **Quy tắc:** một mục vào §5 chỉ khi **thật sự chưa có đáp án**. Những thứ "chưa triển khai nhưng đã kiến trúc hoá" (payment deploy unit, llm app) **không** vào đây. Những thứ đã chốt bằng ADR (ADR-0009 "không có result contract") **không** được viết lại như open — chỉ phần cơ chế cụ thể còn mở mới vào.

---

## 6. Phân loại các thành phần không phải bounded context nghiệp vụ

Các thành phần sau **không** phải bounded context nghiệp vụ; chúng được liệt kê để người đọc không nhầm deploy unit/infra với context.

| Thành phần                         | Bản chất                                                                                                                                                                                                                                                                                                         | Vì sao không phải bounded context                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backoffice`                       | Composition/UI + BFF cho vận hành nội bộ: phối hợp API của Staff Access, Pact Broker, Remote Cache. Việc `staff-access` tiếp quản staff/RBAC (A21–A24) đã chốt qua [ADR-0013](../domains/staff-access/adr/0013-staff-access-ownership-transfer.md); ngày nay app còn sở hữu staff/RBAC chờ P1.4 dựng deploy unit | Không sở hữu dữ liệu nghiệp vụ ở target; authentication qua `account`/`auth` như mọi application. Spec → [`solutions/backoffice`](../solutions/backoffice/README.md) |
| `home`                             | Deploy unit public (mount blog/docs/legal)                                                                                                                                                                                                                                                                       | Không sở hữu capability nghiệp vụ; là surface công khai                                                                                                              |
| `router`                           | Non-production entry (ecoma.io.vn)                                                                                                                                                                                                                                                                               | Chỉ phục vụ staging/preview routing                                                                                                                                  |
| `cache` (target: `remote-cache`)   | Edge deploy unit disposable build state (A18); **target** multi-tenant SaaS bounded context (`remote-cache`) owns tenant/project/membership/API key/quota/retention/usage/audit                                                                                                                                  | Currently disposable build state, không phải production source of truth; SaaS target → [`solutions/remote-cache`](../solutions/remote-cache/README.md)               |
| `janitor`                          | Cron Worker dọn Preview tạm                                                                                                                                                                                                                                                                                      | Maintenance plane                                                                                                                                                    |
| `auth-nonce-prune-job`             | Cron Worker dọn nonce hết hạn                                                                                                                                                                                                                                                                                    | Maintenance plane của `auth`, không sở hữu storage                                                                                                                   |
| `local-platform`                   | Hạ tầng Docker local dùng chung                                                                                                                                                                                                                                                                                  | Không thuộc bounded context nào; phục vụ mọi deploy unit (ngoại lệ trong `solutions/`)                                                                               |
| `deploys/*`                        | Project Pulumi provision hạ tầng                                                                                                                                                                                                                                                                                 | Provisioning ownership, không phải bounded context                                                                                                                   |
| `platform`/`shared`/`public` scope | Vùng ownership chia sẻ trong Nx                                                                                                                                                                                                                                                                                  | Trục ownership, không phải context nghiệp vụ                                                                                                                         |

---

## 7. Quy tắc bảo trì domain map

1. **Domain map này là canonical** cho ngôn ngữ domain, catalog và context map. Nếu một tài liệu khác cần các thông tin này, **tham chiếu** tài liệu này, không sao chép.
2. Thêm bounded context mới → thêm vào §3, cập nhật §4 và §5 nếu có quan hệ/chưa chốt liên quan.
3. Loại một capability khỏi catalog **chỉ** khi tài liệu kiến trúc không còn định nghĩa nó — không phải vì thiếu implementation.
4. Một mục vào §5 chỉ khi thật sự chưa có đáp án; đã chốt bằng ADR thì không viết lại như open.
5. Deploy unit mới không tự động tạo bounded context mới (§1.1, §2.10).
6. Shared infra (`local-platform`, `cache` với tư cách disposable build state, `janitor`, `deploys/*`) không bao giờ là bounded context (§6); việc `remote-cache` trở thành SaaS bounded context là **target architecture** cần ADR mới (A18 ghi rõ).
7. Khi open boundary được giải quyết (có ADR/quyết định), chuyển nội dung sang tài liệu canonical tương ứng và xoá khỏi §5 (hoặc giữ một dòng "đã chốt → link").
