# Web Push Notification Job Architecture

> **Phạm vi:** boundary, runtime resolution, state ownership, idempotency, lifecycle và architectural invariants của `web-push-notification-job`.
> Design của control plane (state machine, routing, idempotency model) → `docs/services/push-notification/01-architecture.md` · error matrix canonical → `docs/services/push-notification/03-operations.md` §5 · requirement → [`02-requirements.md`](./02-requirements.md) · vận hành → [`03-operations.md`](./03-operations.md).

## 1. Mục đích

`web-push-notification-job` là delivery worker thực hiện `Web Push` delivery cho các `Push Delivery` đã được `push-notification` tạo và enqueue. Worker là một phần của **delivery plane** — không quyết định notification gửi cho ai hay bằng transport nào.

```text
push-notification
       |
       | Delivery Command
       v
Cloudflare Queue
       |
       v
web-push-notification-job ──── D1 `push-job`
       |
       | Web Push Protocol
       v
Browser Push Service
```

## 2. Phạm vi

### 2.1. Trong phạm vi

- Consume `Delivery Command` từ Cloudflare Queue và validate schema.
- Resolve runtime delivery data qua private interface của `push-notification`.
- Kiểm tra delivery còn eligible, thực hiện `Web Push`, phân loại kết quả delivery.
- Retry lỗi transient; báo `Push Subscription` không còn hợp lệ khi provider chứng minh.
- Cập nhật `Push Delivery` state theo state machine do control plane định nghĩa.
- Ack/reject từng Queue message theo delivery outcome (per-message ACK/retry).
- Ghi và dùng job execution state trên D1 `push-job` (attempt, processed marker, việc kẹt); chạy reconciliation cho job state của chính mình.

### 2.2. Ngoài phạm vi

- Tạo `Push Notification`, resolve recipient/`Device`, chọn `Transport`/`Provider`/tìm subscription thay thế, áp dụng `app > web`, thực hiện `FCM`/`APNs`.
- Quản lý `Push Provider` hay `Push Subscription` lifecycle ngoài việc báo trạng thái invalid.
- Truy cập D1 của service khác hay PostgreSQL (`docs/overview/01-architecture.md` invariant 5; không có Hyperdrive binding — `docs/overview/03-operations.md` §11.4).
- Quản lý business logic của application.

## 3. Worker Boundary

Ranh giới của worker là một `Delivery Command` cụ thể. Queue message đã chứa decision của control plane; các trường `delivery_id`, `notification_id`, `subscription_id`, `provider_id`, `transport`, `payload` là **immutable** — worker không thay đổi chúng để tìm một delivery khác.

```text
Push Notification → Push Routing → Push Delivery → Cloudflare Queue → Web Push Worker → External Web Push Provider
```

## 4. Supported Delivery

Phiên bản đầu chỉ hỗ trợ `transport = web` / `provider.type = web-push`. Message không thuộc scope (ví dụ `transport = app`) bị từ chối an toàn — không được chuyển sang provider hoặc transport khác.

## 5. Delivery Command

Queue message tối thiểu gồm `version` (bắt buộc để hỗ trợ evolution của Queue contract), `delivery_id`, `notification_id`, `subscription_id`, `provider_id`, `transport`, `payload`.

Queue message **không được chứa**: VAPID private key, provider secret, access token, hay bất kỳ private credential nào.

## 6. Runtime Resolution

Queue chỉ tham chiếu `subscription_id`, `provider_id`, `delivery_id`. Worker resolve runtime configuration qua **private delivery interface** của `push-notification`:

```text
Queue → delivery_id → Private Delivery Runtime API → Push Delivery · Push Subscription · Push Provider · Provider Credential → Worker
```

- Interface chỉ dành cho trusted delivery worker, không phải public API. Worker được lấy delivery state, subscription delivery material, provider runtime configuration; **không** dùng interface để tìm subscription khác, đổi provider, reroute, thay đổi recipient hay transport.
- Interface là **delivery lookup theo `delivery_id`**, không phải routing API: không có tham số khám phá theo `app`/`user`/`transport`/`provider`.
- `web-push-notification-job` **không truy cập D1 `push`** — mọi dữ liệu control plane đi qua private interface. Worker có D1 riêng `push-job` cho job execution state. Hai D1 là hai storage resource, mỗi thứ một owner (`docs/overview/01-architecture.md` invariant 5).

## 7. Delivery Runtime

Runtime delivery material phải đủ để worker thực hiện một Web Push request: `Delivery` (`delivery_id`, `status`, `payload`), `Subscription` (`endpoint`, `p256dh`, `auth`), `Provider` (`provider_id`, `type`, `configuration`, `credential`). `Provider Credential` chỉ được trả cho trusted worker qua private channel; không lưu credential trong Queue.

## 8. Delivery Lifecycle

```text
Validate → Resolve Runtime → Check Delivery Eligibility → Send Web Push
   ├── success ────────────→ Mark Delivered
   ├── transient ──────────→ Retry
   ├── permanent ──────────→ Mark Failed (credential/payload failure — KHÔNG tự invalidate subscription)
   └── invalid ────────────→ Mark Failed → Disable Subscription
```

Worker chỉ acknowledge message sau khi outcome đã được persist hoặc delivery đã được chuyển vào retry/DLQ path.

## 9. Delivery Eligibility

Trước khi gọi provider, worker kiểm tra delivery còn eligible. Không còn eligible khi: `delivery already delivered`, `delivery cancelled`, `subscription disabled/expired`, `provider disabled`. Delivery đã hoàn thành → coi là duplicate, không gửi lại.

`provider disabled` **không phải trigger reroute**: delivery đã materialize với `provider_id`; worker chỉ xác định delivery không còn eligible và xử lý theo state/policy của control plane.

## 10. Idempotency

`delivery_id` là idempotency key, đảm bảo **logical delivery idempotency**. Cloudflare Queue at-least-once, crash window (provider accept → worker crash trước khi persist → Queue retry → duplicate external notification) và ranh giới logical-vs-external **đã canonical ở `docs/services/push-notification/01-architecture.md` §7** — worker tuân thủ model đó:

- không tạo logical delivery mới khi cùng message được deliver lại; logical state transition không bị lặp sai;
- duplicate external notification trong crash window là khả năng đã chấp nhận;
- race giữa hai executions của cùng `delivery_id` xử lý bằng persistent state transition hoặc concurrency control (§11b).

## 11. Delivery State Ownership

`push-notification` là owner của `Push Delivery` state. Worker request transition theo state machine của control plane (`queued → processing → delivered/failed`); không tạo state mới và không chuyển delivery từ `delivered/failed/expired/cancelled` về trạng thái chưa xử lý.

### 11b. Job State trên D1 `push-job`

| Tầng                 | Owner                       | Lưu ở đâu                     | Vai trò                                                            |
| -------------------- | --------------------------- | ----------------------------- | ------------------------------------------------------------------ |
| **Logical delivery** | `push-notification`         | D1 `push` (qua private API)   | Trạng thái đúng của delivery: `queued/processing/delivered/failed` |
| **Job execution**    | `web-push-notification-job` | D1 `push-job` (binding riêng) | Việc đã làm: attempt, ack, delivery nào đã xử lý, việc kẹt         |

Job execution state tối thiểu trong D1 `push-job`: attempt record (idempotent theo `delivery_id` + `attempt`), processed marker (duplicate Queue message skip ngay), reconciliation data (việc kẹt — đã nhận nhưng quá ngưỡng chưa kết thúc, hoặc đã persist nhưng chưa ack).

- D1 `push-job` là **authoritative cho job state** của service này (`docs/overview/01-architecture.md` A19, invariant 6) — không dùng KV, bộ nhớ Worker hay `/tmp` làm nơi duy nhất.
- D1 `push-job` **không** chứa logical delivery state; ghi đè nó không thay đổi trạng thái delivery của control plane.
- Queue **không** là source of truth: mất message sau retention thì việc được tìm lại bằng reconciliation job đọc D1 `push-job`.

## 12. Retry Model

Retry điều khiển bởi **provider error classification** — error matrix canonical ở `docs/services/push-notification/03-operations.md` §5 (dùng chung control/delivery plane). Quy tắc riêng của worker:

- **Transient** (`429`/`5xx`/network/timeout, runtime API transient) → retry bounded, exponential backoff, tôn trọng `Retry-After`.
- **`404`** (provider chứng minh subscription invalid) → mark failed, invalidate subscription, ACK.
- **`401`/`403`** → provider credential/configuration failure: permanent cho delivery attempt (mark failed + ACK), **không** retry, **không** invalidate subscription — worker **không** hard-code `401/403 = invalid subscription`.
- **`413`** → permanent payload failure: mark failed, ACK.
- Không tự động reroute sang provider khác khi provider fail — `provider_id` do control plane materialize.

### 12.1. Per-message Processing

Worker xử lý từng Queue message độc lập: failure của message A không ảnh hưởng ACK/retry của message B, C trong cùng batch.

## 13. Subscription Invalidation

Nếu provider xác nhận subscription không còn hợp lệ, worker báo `push-notification` chuyển `active → disabled/expired`; delivery mới tới subscription này không được tạo. Worker chỉ báo invalid khi **provider response chứng minh** (thường `404`); worker không tự xóa subscription khỏi database.

## 14. Provider Handling

Worker dùng `provider_id` đã được routing, không fallback sang provider khác khi provider fail. Worker không suy luận provider từ browser/`User-Agent`/IP/endpoint hostname — provider identity là `provider_id` do control plane quyết định.

## 15. Web Push Payload

Worker nhận payload đã tạo ở control plane; có thể thực hiện transformation bắt buộc bởi Web Push Protocol nhưng không thay đổi business semantics: không tạo title mới, đổi notification type, deep link, template hay thêm business data.

## 16. Timeout

External provider request có timeout hữu hạn; worker không giữ Queue message ở trạng thái processing vô hạn. Timeout phân loại transient, trừ khi provider adapter xác định permanent.

## 17. Concurrency

Worker có thể process nhiều Queue messages đồng thời; mỗi execution độc lập theo `delivery_id`. Concurrency không phá idempotency; không yêu cầu global ordering. Cùng `delivery_id` xử lý đồng thời → chỉ một execution được thực hiện delivery thành công, execution còn lại xử lý như duplicate/conflict.

## 18. Security Boundary

Worker là trusted delivery component:

- **Có quyền:** đọc delivery runtime data, dùng provider credential, cập nhật delivery outcome, invalidate subscription.
- **Không có quyền:** tạo notification, reroute, modify provider configuration, modify subscriptions khác, access admin configuration API.

Provider credential phải: mã hóa khi lưu trữ, chỉ giải mã trong trusted execution, không xuất hiện trong logs/Queue/error message.

## 19. Observability

Mỗi execution giữ correlation chain `request_id → notification_id → delivery_id → subscription_id → provider_id`, đủ để trả lời: delivery nào, subscription nào, provider nào, attempt nào, outcome nào, latency bao nhiêu. Không log: endpoint credential, `p256dh`, `auth` secret, VAPID private key, provider secret. Metric/dashboard/alert inventory → [`03-operations.md`](./03-operations.md) §11–§12.

## 20. Failure Isolation

- Failure của một delivery không fail toàn bộ batch (per-message ACK/retry độc lập).
- Provider failure không làm mất những delivery khác.
- `push-notification` runtime API transient failure retry theo policy nhưng không khiến worker tự tìm alternate route.

## 21. Scaling

Worker scale độc lập với `push-notification` API. Scale driver: Queue backlog, delivery latency, provider throughput. Không cần tăng capacity theo request rate của control plane nếu notification chưa được enqueue.

## 22. Future Compatibility

Kiến trúc cho phép thêm `app-push-notification-job` cho `transport = app` mà không thay đổi worker contract: cùng Queue, rẽ theo transport. Worker không cần biết implementation của job worker khác.

## 23. Architectural Invariants

1. Worker chỉ xử lý `transport = web`.
2. Worker không thực hiện `Push Routing`, không tìm subscription thay thế, không chọn provider khác.
3. `delivery_id` là idempotency key ở **logical state**; external provider exactly-once không được guarantee (`push-notification/01-architecture.md` §7).
4. Queue message không chứa provider credential.
5. Worker không truy cập D1 của service khác — chỉ dùng D1 `push-job` cho job state của chính mình.
6. Runtime data resolve từ private delivery interface; interface là delivery lookup theo `delivery_id`, không phải routing API.
7. Worker không thay đổi business semantics của payload.
8. Chỉ invalidate subscription khi provider response chứng minh; `401/403` là provider-level failure, không bulk-disable.
9. Duplicate Queue message không tạo duplicate logical delivery; delivery đã hoàn thành không gửi lại.
10. Provider failure không làm thay đổi routing decision; provider disabled không phải trigger reroute.
11. Worker chỉ cập nhật delivery outcome theo state machine hợp lệ.
12. External request có timeout hữu hạn; secret không xuất hiện trong log.
13. Per-message ACK/retry — một message fail không force retry các message khác trong batch.
