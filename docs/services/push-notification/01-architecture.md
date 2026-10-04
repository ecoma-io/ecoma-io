# Push Notification Service Architecture

> **Phạm vi:** purpose, boundary, domain design, transaction/outbox boundary, interface/security/observability boundary, data ownership và architectural invariants của `push-notification`.
> Requirement → [`02-requirements.md`](./02-requirements.md) · vận hành/runbook → [`03-operations.md`](./03-operations.md) · system-wide policy → `docs/overview/` · delivery plane → `docs/services/web-push-notification-job/`.

---

## 1. Mục đích

`push-notification` là **control plane** thống nhất cho hệ thống Push Notification: quản lý vòng đời của `Device`, `Push Subscription`, `Push Provider`, `Push Notification`, `Push Delivery` và `Push Routing Policy`.

Service tiếp nhận notification intent từ business service, xác định `Device`/`Push Subscription` phù hợp, chọn `Transport` và `Provider`, tạo `Push Delivery`, rồi đưa `Delivery Command` vào Cloudflare Queue để delivery worker xử lý bất đồng bộ. Giai đoạn đầu hỗ trợ `Web Push`; kiến trúc cho phép mở rộng `App Push` mà không đổi contract của caller (§13).

---

## 2. Phạm vi

**Trong phạm vi:** quản lý `Device`/`Push Subscription` · `Push Provider` + credential theo `App` · tiếp nhận notification intent · `Push Routing` theo policy · tạo và quản lý logical state của `Push Delivery` · đưa `Delivery Command` vào Queue (qua outbox — §6) · internal API cho application và `Admin API` cho `Backoffice`.

**Ngoài phạm vi** — thuộc delivery worker (`docs/services/web-push-notification-job/`): thực hiện `Web Push`/`APNs`/`FCM` delivery · quản lý `Browser Push Service` · retry network delivery, xử lý DLQ. Thuộc business service: logic quyết định **khi nào** cần notification.

---

## 3. Kiến trúc tổng thể

```text
Ecoma Applications (backoffice · llm-seller · llm-console)
                    │  notification intent (internal API)
                    ▼
         ┌─────────────────────────┐
         │   push-notification     │  Cloudflare Worker (control plane)
         │   Device / Subscription │  D1 `push`
         │   Provider / Routing    │  Queue producer + Outbox Publisher
         │   Delivery / Admin API  │
         └───────────┬─────────────┘
                     │ Delivery Command
                     ▼
             Cloudflare Queue ──► web-push-notification-job (delivery plane)
                                       │
                                       ▼
                               Browser Push Service (Web Push)
```

- `push-notification` là **control plane**: Cloudflare Worker + D1 `push` + Queue producer; internal API, không public hostname — Service Binding theo `docs/overview/01-architecture.md` §2.
- `*-push-notification-job` là **delivery plane**: Worker + Queue consumer + D1 riêng cho job state. Ranh giới giữa hai plane là Cloudflare Queue.
- `web-push-notification-job` **không truy cập D1 `push`** — dữ liệu control plane đi qua private delivery interface (§8.1).
- Mỗi environment (`development`, `staging`, `production`) dùng D1, Queue, provider configuration và secrets độc lập.

---

## 4. Architectural principles

### 4.1. Routing chỉ được thực hiện tại `push-notification`

Service là nơi duy nhất quyết định: gửi cho `Device` nào, dùng `Transport`/`Provider` nào, có gửi hay không, có loại bỏ subscription khỏi delivery hay không. Delivery worker chỉ nhận `Delivery Command` đã materialize (`transport`, `provider_id`, `subscription_id`) và thực thi.

### 4.2. `Transport` và `Provider` là hai abstraction khác nhau

- `Transport` (`web`, `app`) — phương thức `Device` nhận notification.
- `Provider` (`web-push`, `fcm`, `apns`) — hệ thống bên ngoài thực hiện delivery.

`Chrome`, `Firefox`, `Edge` là `Browser Push Service` nằm dưới `web-push` protocol — **không** phải `Provider` abstraction của domain. Với `Web Push`, `Push Subscription` chứa `endpoint` do `Browser Push Service` cấp; service dùng `Web Push` protocol và credential tương ứng để delivery.

### 4.3. `App` là first-class concept

Mỗi `Push Subscription` thuộc về đúng một `App`; `App` không suy luận từ `Provider` — một `App` dùng được nhiều `Provider` và ngược lại. Namespace các `App` cô lập với nhau (§8.2).

---

## 5. Domain model

### 5.1. Device — identity và association

`Device` là logical identity của một thiết bị mà một `User` nhận `Push Notification`; một `Device` có nhiều `Push Subscription` thuộc các `Transport` khác nhau — cơ sở của `Transport Priority` (§5.5). **Device Identity** (logical `device_id` đã lưu) và **Device Association** (cơ chế gắn subscription vào đúng `device_id`) là hai khái niệm riêng:

- Web client v1: client tạo `device_id` ngẫu nhiên (UUID) khi lần đầu đăng ký, lưu tại client; mọi request đăng ký/ghi subscription gửi kèm `device_id`; không có `device_id` hợp lệ thì không tạo subscription; `device_id` được gán cho `User` của phiên đăng nhập khi đăng ký.
- Native app tương lai: link installation vào logical `Device` phải dùng explicit authenticated mechanism do application protocol định nghĩa riêng — không thiết kế chi tiết ở đây.
- Association **không bao giờ** suy luận gián tiếp: không dùng IP, User-Agent, browser name, network hay metadata không ổn định để nhận diện hai subscription là cùng một physical device.

### 5.2. Push Subscription

Một endpoint cụ thể mà notification có thể gửi tới, gắn `user_id`, `device_id`, `app`, `transport`, provider tham chiếu, status, timestamps. Với `Web Push`, tối thiểu lưu dữ liệu cần cho protocol: `endpoint`, `p256dh`, `auth`.

```text
active ──> disabled      (unregister · admin disable · worker xác định không hợp lệ)
active ──> expired
```

Subscription không còn hợp lệ (`disabled`/`expired`) **không** tiếp tục nhận delivery mới.

### 5.3. Push Provider

Cấu hình delivery provider do service quản lý (`type`, `name`, `status`, app scope, credential reference, configuration); credential nhạy cảm không trả về qua API đọc configuration (§9).

**Provider disable semantics** (áp dụng thống nhất):

```text
provider disabled ──> không tạo NEW delivery
```

- Chỉ có nghĩa **dừng routing cho delivery mới**; delivery đã materialize với `provider_id` giữ nguyên quyết định đó — queued delivery tiếp tục xử lý, **không** implicit cancel.
- Reroute delivery đã materialize sang provider khác là **administrative recovery operation riêng**, chủ đích, có audit — không xảy ra tự động.
- **Provider scope theo `App`:** credential tách theo `App`, thay đổi/rotate/migrate độc lập từng `App`, giới hạn blast radius.

**Provider selection (v1):** mỗi tổ hợp `App` + `Transport` có đúng một active primary provider. Nhiều provider cùng `App`+`Transport` mà không xác định được primary: routing **fail safely** — không chọn random, không chọn theo thứ tự database. `priority`, `fallback`, `weighted routing` là future extension, v1 không implement.

### 5.4. Push Notification

Yêu cầu gửi notification tới một hoặc nhiều `User`; **không** gắn trực tiếp với `Push Subscription`:

```text
Push Notification ──> Push Routing ──> Push Delivery[]
```

Một notification có zero, one hoặc nhiều delivery độc lập.

### 5.5. Push Routing và Transport Priority

Thứ tự routing: resolve users → devices → subscriptions → filter ineligible → apply routing policy → select transport → select provider → create `Push Delivery`. Routing **hoàn tất trước khi** message vào Queue (§6).

`Transport Priority` mặc định `app > web`: `Device` có cả hai subscription hợp lệ cho cùng `App` thì chỉ tạo delivery cho `App Push`; `App Push` không tồn tại/không eligible thì dùng `Web Push`. Priority **chỉ** áp dụng khi hai subscription được chứng minh thuộc cùng một `Device` — không collapse delivery giữa hai `Device` khác nhau của cùng `User`.

### 5.6. Push Delivery và state

Resource độc lập, luôn tham chiếu một `Push Subscription`; mỗi delivery có `delivery_id` duy nhất.

```text
pending ──> queued ──> processing ──> delivered
                                 ├──> failed
   (cancelled từ pending/queued · expired từ queued/processing)
```

`delivered`, `failed`, `expired`, `cancelled` là **terminal state** — transition table → `02-requirements.md` FR-015. Control plane tạo và quản lý logical state; delivery worker cập nhật kết quả delivery, **không** thay đổi routing decision đã tạo.

---

## 6. Transaction và outbox boundary

Sau khi routing hoàn tất, `Push Notification`, `Push Delivery` và `Outbox Entry` được ghi trong cùng một transaction của D1 `push`; `Outbox Publisher` publish `Delivery Command` vào Queue **sau** khi transaction đã commit.

- **"D1 transaction" trong tài liệu service = một `db.batch()`** (`docs/overview/04-platform-facts.md` DB2 — D1 auto-commit, `db.batch()` gộp write atomically). Không dựa vào `BEGIN`/`COMMIT`/isolation level — hành vi transaction tương tác chưa xác minh (`docs/overview/01-architecture.md` §10).
- **Không được giả định D1 commit và Queue publish là atomic** — hai hệ thống khác nhau; Queue publish là asynchronous boundary **sau** transaction.

### 6.1. Push Outbox Model

Record durable ghi lại một `Delivery Command` cần publish vào Queue:

```text
id · delivery_id · status · attempts · available_at
claimed_at · claimed_by · published_at · last_error · timestamps

pending ──> publishing ──> published    (Queue.send() thành công — terminal)
                  └──────> failed       (vượt ngưỡng attempts — recoverable, không xóa tự động)
```

- `pending` đã ghi trong transaction, chờ claim; `available_at` cho backoff. `publishing` đang giữ lease. `failed` vượt ngưỡng attempts nhưng vẫn recoverable để operator xử lý. `delivery_id` là tham chiếu duy nhất từ outbox record tới logical delivery.

### 6.2. Outbox Publisher

Component của control plane, nằm trong (hoặc cùng deployment với) Worker — **không** thuộc delivery plane, không thực hiện delivery. Design rules:

- Claim record `pending` sau khi transaction commit, giữ lease hạn định; publisher crash → lease hết hạn → claim lại.
- **Không** thực hiện network call tới Queue hay external provider bên trong D1 transaction.
- Crash sau `Queue.send()` nhưng chưa mark `published` → publish lại lần thứ hai: hệ thống ưu tiên **duplicate thay vì mất message**; duplicate xử lý idempotently ở consumer theo `delivery_id` (§7).
- Record `published` xóa theo retention; record `failed` không xóa tự động. Tham số vận hành (poll interval, batch, lease timeout, backoff, monitoring) → `03-operations.md` §4.

---

## 7. Delivery idempotency

> Đây là canonical location của logical-idempotency / crash-window model cho cả push pair; `web-push-notification-job` tham chiếu mục này.

Cloudflare Queue là **at-least-once** (`docs/overview/04-platform-facts.md` QU1). Mỗi `Push Delivery` có một `delivery_id` duy nhất — **logical delivery idempotency key**: consumer nhận lại cùng `Delivery Command` không tạo thêm logical delivery mới; không dùng random identifier mới cho mỗi retry.

**Logical exactly-once khác external exactly-once:**

```text
logical exactly-once  !=  exactly-once external provider side effect
```

Crash window phải được chấp nhận: provider accept → worker crash trước khi persist `delivered` → Queue retry → **duplicate external notification có thể xảy ra**. Kết luận:

- hệ thống đảm bảo idempotent **logical state** (một `delivery_id` là một logical delivery, state transition không lặp sai);
- external duplicate notification nằm trong crash window đã chấp nhận; `delivery_id` **không** phải bằng chứng exactly-once ở external provider;
- client/service worker có thể dùng `notification_id` để deduplicate UX trong tương lai.

`Push Delivery` truy vết được theo chuỗi: `notification_id → delivery_id → subscription_id → provider_id`.

---

## 8. Interface boundary

### 8.1. Internal API và Admin API

- **Internal API** cho các application `ecoma-io`: đăng ký device/subscription, tạo notification (capability → `02-requirements.md` §4). Service **không có public API** (`docs/overview/01-architecture.md` §2).
- **Admin API** cho `Backoffice`: provider/credential/app-provider mapping/subscription/device/delivery (capability list → `02-requirements.md` FR-017).
- `Backoffice` **không** truy cập trực tiếp credential provider và **không** gọi trực tiếp `FCM`/`APNs`/`Browser Push Service`.
- Private delivery interface cho delivery worker: delivery lookup theo `delivery_id` (runtime data + credential), **không** phải routing API.

### 8.2. Application boundary

Mọi request phải xác định rõ `app`, và `app` MUST đến từ **authenticated principal**, không phải arbitrary body value: service đối chiếu `app` trong body với identity của principal; không khớp → từ chối. Recipient (`user_id`) chỉ dùng được khi principal có quyền gửi notification tới recipient đó. Application không gửi được notification vào namespace của application khác; application authorization kiểm tra trước khi tạo `Push Notification`.

---

## 9. Security boundary

Credential của `Push Provider` là secret; service đảm bảo:

1. Credential mã hóa khi lưu trữ, **không** lưu plaintext trong D1 `push`.
2. Credential không xuất hiện trong API response, application log, audit log không được bảo vệ.
3. Credential **không** đưa vào Cloudflare Queue message.
4. Delivery worker chỉ nhận provider reference và dùng credential qua private interface (§8.1).
5. `Admin API` và internal API có authentication/authorization riêng (§8).

`Cloudflare Worker Secret` (hoặc cơ chế tương đương) làm root key cho encryption credential — không cần Secrets Service riêng.

---

## 10. Failure isolation

Failure của một provider không làm hỏng toàn bộ service; failure của một `App` không ảnh hưởng `App` khác — provider configuration và delivery cô lập theo `App`, `Transport`, `Provider`. `Provider disabled` dừng routing delivery mới; delivery đã materialize giữ nguyên `provider_id`, không implicit cancel, không tự động reroute (§5.3).

---

## 11. Observability boundary

Mọi operation quan trọng có correlation chain: `request_id → notification_id → delivery_id → subscription_id → provider_id`.

Log **không** được chứa: subscription secret, private key, provider credential, access token, payload chứa dữ liệu nhạy cảm ngoài phạm vi cần thiết. Inventory metric/log/alert → `03-operations.md` §10–§11; system-wide observability policy → `docs/overview/03-operations.md` §4.

---

## 12. Data ownership và dependency rule

`push-notification` (Worker + D1 `push` + Queue producer) là owner của:

```text
Device · Push Subscription · Push Provider · Push Provider Credential
App–Provider Mapping · Push Notification · Push Delivery · Push Routing Policy · Outbox · Audit
```

Các domain service khác chỉ là **producer của notification intent** (`identity`, `payment`, `llm-api` → API/event) — không quản lý trực tiếp `Push Subscription` hay `Push Delivery`. Cross-service đi qua API/event/Service Binding theo `docs/overview/01-architecture.md` §5.

```text
Business Services ──notification intent──► push-notification
                                              │ delivery command
                                              ▼
                                       Cloudflare Queue
                                              │
                                              ▼
                                     Delivery Jobs (transport-level delivery only)
```

- `push-notification` **không** phụ thuộc implementation của business service.
- Không dependency ngược: delivery worker **không** gọi `payment`/`identity`/business service (enforcement → `docs/overview/05-code-architecture.md`).

---

## 13. Extensibility và architectural direction

Kiến trúc mục tiêu: một API thống nhất; một domain model cho `Web Push` và `App Push`; routing tập trung; delivery bất đồng bộ; failure isolation; không dependency trực tiếp giữa business service và push provider.

- **Hiện tại:** `Transport = web`, `Provider = web-push`, delivery qua `web-push-notification-job`.
- **Mở rộng:** thêm `Transport = app`, `Provider = fcm`/`apns`, thêm `app-push-notification-job` — application vẫn gửi cùng một `Push Notification Request`; khác biệt do `Routing Policy` và `Provider Selection` xử lý (§4.2, §5.5).
- `push-notification` giữ nhỏ ở mức domain và control plane; provider-specific implementation đẩy xuống delivery worker tương ứng.

---

## 14. Architectural invariants

1. `push-notification` là nơi duy nhất thực hiện `Push Routing`; delivery worker không routing lại.
2. `App` là first-class boundary; `Transport` và `Provider` là hai abstraction độc lập.
3. `Push Delivery` luôn tham chiếu một `Push Subscription`; mỗi delivery một `delivery_id` duy nhất.
4. Queue message phải idempotent; không suy luận cùng `Device` chỉ từ IP/User-Agent/metadata không ổn định.
5. `app` ưu tiên hơn `web` khi hai subscription thuộc cùng một `Device`.
6. Provider credential không xuất hiện trong Queue message, API response hay log.
7. Provider/`App` failure cô lập; `Provider disabled` dừng routing mới, không implicit reroute delivery đã materialize.
8. Business service không quản lý trực tiếp subscription/delivery; `push-notification` không thực hiện transport delivery.
9. Việc bổ sung `App Push` không yêu cầu đổi notification contract cơ bản.
10. Mỗi `App` + `Transport` đúng một active primary provider trong v1; không có primary → routing fail safely.
11. `Push Notification`, `Push Delivery`, `Outbox Entry` nằm trong cùng một `db.batch()`; D1 commit và Queue publish không atomic; duplicate Queue publish phải được chấp nhận.
12. `app` trong notification request lấy từ authenticated principal, không phải arbitrary body value.
13. `delivery_id` đảm bảo logical idempotency, **không** đảm bảo exactly-once external provider side effect (§7).
