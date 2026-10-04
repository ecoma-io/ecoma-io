# Web Push Notification Job Requirements

> **Phạm vi:** FR/NFR/SR và non-goals của `web-push-notification-job`. Design → [`01-architecture.md`](./01-architecture.md) · vận hành → [`03-operations.md`](./03-operations.md) · error matrix canonical → `docs/services/push-notification/03-operations.md` §5.

## 1. Functional Requirements

### FR-001 — Queue Consumption

Worker MUST consume `Delivery Command` từ Cloudflare Queue, chỉ xử lý message thuộc `transport = web` và `provider.type = web-push`. Worker MUST hỗ trợ **per-message acknowledgement/retry**: mỗi message trong một batch ACK, retry hoặc chuyển DLQ độc lập theo outcome của chính nó. Message không thuộc scope MUST được xử lý như unsupported delivery — không gửi provider, không retry vô hạn.

### FR-002 — Message Validation

Worker MUST validate `version`, `delivery_id`, `notification_id`, `subscription_id`, `provider_id`, `transport`, `payload`. Thiếu field bắt buộc MUST không gửi tới external provider. `version` không được hỗ trợ MUST xử lý theo non-retryable error policy.

### FR-003 — Runtime Resolution

Worker MUST resolve runtime delivery data cho `delivery_id` — đủ để validate delivery, load subscription, load provider, obtain provider credential. Worker MUST chỉ resolve đúng delivery được chỉ định; MUST NOT dùng runtime API để tìm delivery thay thế.

### FR-004 — Delivery Eligibility

Worker MUST kiểm tra `delivery status`, `subscription status`, `provider status`, `transport`, `provider type` trước khi external delivery. Không còn eligible MUST skip hoặc mark theo state machine mà không gọi provider.

### FR-005 — Web Push Delivery

Worker MUST thực hiện delivery bằng Web Push Protocol với subscription endpoint/keys và provider configuration/credential do control plane chọn. Happy path: `Queue → resolve runtime → Web Push → provider success → delivery = delivered → ACK`.

### FR-006 — Idempotency

Worker MUST dùng `delivery_id` làm idempotency key — guarantee **logical delivery identity**, MUST NOT diễn giải là exactly-once external provider side effect (`01-architecture.md` §10; model canonical → `push-notification/01-architecture.md` §7). Duplicate execution MUST NOT tạo duplicate logical delivery; delivery đã `delivered` MUST NOT gửi provider lần nữa.

### FR-007 — Delivery State

Worker MUST cập nhật delivery outcome (`delivered`, `failed`) thông qua private interface. Worker MUST NOT tạo state ngoài state machine định nghĩa ở control plane.

### FR-008 — Retry

Worker MUST retry transient errors (network, timeout, temporary provider failure, rate limiting, temporary server failure). Phân loại MUST theo error matrix canonical (`push-notification/03-operations.md` §5). Retry MUST: có giới hạn, dùng backoff, không tạo delivery mới, giữ nguyên `delivery_id`, áp dụng **per-message** — không theo batch.

### FR-009 — Permanent Failure, Subscription Invalidation và Provider Authentication Failure

Worker MUST không retry vô hạn permanent errors. Khi **provider response chứng minh** subscription không còn hợp lệ (thường `404`): (1) mark delivery failed/permanent; (2) request disable/expire subscription; (3) ACK sau khi state persist. Worker MUST NOT xóa trực tiếp DB record, tạo subscription mới hay chọn subscription khác.

Provider credential/configuration failure (`401`/`403`) và payload failure (`413`) là permanent cho delivery attempt nhưng MUST NOT dẫn tới disable subscription; worker MUST NOT disable subscriptions hàng loạt vì credential/configuration sai.

### FR-011 — Provider Selection

Worker MUST dùng `provider_id` từ Queue message. Worker MUST NOT chọn provider khác khi provider hiện tại fail; MUST NOT infer provider từ browser hoặc endpoint metadata.

### FR-012 — Payload Preservation

Worker MUST preserve notification payload semantics; MAY thực hiện transformation cần thiết cho Web Push Protocol. Worker MUST NOT thay đổi `title`, `body`, `url`, `application data` theo business logic riêng.

### FR-013 — Timeout

External provider request MUST có timeout hữu hạn; MUST không giữ Queue execution ở trạng thái processing vô hạn.

### FR-014 — Duplicate Concurrency

Worker MUST xử lý race condition khi cùng `delivery_id` được consume đồng thời; chỉ một execution được hoàn tất logical delivery, execution còn lại skip hoặc retry safely tùy persistent state. External send trùng lặp (nếu có) thuộc crash-window (FR-006).

### FR-017 — Runtime API Failure

Private delivery-runtime API tạm thời unavailable → transient failure. Worker MUST NOT fallback sang truy cập D1 của `push-notification` (hay service khác), direct database access, đọc control plane state từ D1 `push-job`, alternate subscription hay alternate provider. D1 `push-job` là job state — không thay thế được runtime API vì không chứa delivery/subscription/provider runtime.

### FR-018 — Queue Acknowledgement

Worker MUST dùng per-message acknowledgement/retry. Chỉ ACK khi: delivery succeeded; hoặc delivery permanently failed và outcome đã record; hoặc message invalid/unsupported đã xử lý an toàn. Worker MUST để Queue retry khi transient error (`429`/`5xx`/network/timeout), runtime API transient failure. Message fail permanent MUST không force retry các message khác trong cùng batch.

### FR-019 — Dead Letter

Message không xử lý được sau khi hết retry MUST vào DLQ. DLQ message phải truy vết được bằng `delivery_id`, `notification_id`, `provider_id`, `subscription_id`.

### FR-020 — Observability

Mỗi delivery execution MUST emit structured logs với `delivery_id`, `notification_id`, `subscription_id`, `provider_id`, `attempt`, `outcome`, `duration`. Secret MUST được redact.

### FR-021 — Metrics

Worker MUST expose metrics cho `consumed`, `delivered`, `failed`, `retried`, `skipped`, `invalidated`, `dlq` và provider-level `success`/`failure`/`latency`. Inventory đầy đủ → `03-operations.md` §11.

### FR-022 — Job State và Reconciliation

Worker MUST lưu job execution state trên D1 `push-job` (attempt record, processed marker, việc kẹt), idempotent theo `delivery_id` — duplicate Queue message MUST được nhận diện và skip trước khi gọi provider. Worker MUST có reconciliation job định kỳ quét D1 `push-job` tìm: delivery đã nhận nhưng quá ngưỡng chưa kết thúc; delivery đã persist outcome nhưng chưa ack. Reconciliation MUST NOT ghi logical delivery state — chỉ xử lý job state và/hoặc re-deliver qua Queue. Worker MUST NOT lưu job state vào KV, bộ nhớ Worker hay `/tmp` như là nơi duy nhất.

- Đọc toàn bộ job state không cần Queue và không cần `push-notification`.
- Sau khi mất Queue message (hết retention), reconciliation vẫn nhận diện được việc kẹt từ D1 `push-job`.
- Duplicate message cho delivery đã có processed marker → skip, không gọi provider.

## 2. Non-Functional Requirements

### NFR-001 — Reliability

Worker MUST tolerate duplicate queue delivery, temporary provider outage, temporary runtime API outage, worker restart, network failure mà không tạo duplicate logical delivery.

### NFR-002 — Durability

Worker MUST rely trên persistent delivery state owned by `push-notification` và persistent job state trên D1 `push-job`. Không dùng in-memory state để quyết định delivery đã hoàn thành.

### NFR-003 — Scalability

Worker MUST scale independently from `push-notification` API; Queue backlog là đủ để drive worker scaling.

### NFR-004 — Failure Isolation

Mỗi message được xử lý, ACK, retry và chuyển DLQ độc lập: message thất bại MUST NOT làm thất bại hoặc force retry message khác trong cùng batch. Provider failure MUST NOT làm worker crash permanently.

### NFR-005 — Security

Provider credential và subscription credential data MUST: không nằm trong Queue, logs, error response; chỉ được access bởi trusted worker execution.

### NFR-006 — Performance

Worker MUST tránh runtime calls không cần thiết — mỗi delivery chỉ lookups cần thiết cho `delivery`/`subscription`/`provider`; không discovery hay broad queries.

### NFR-007 — Timeout Safety

Tất cả external I/O phải có timeout; không có unbounded retry hay unbounded execution.

### NFR-008 — Evolution

Queue message MUST có schema version; worker từ chối rõ ràng version không hỗ trợ; breaking change MUST tạo version mới. Trong rollout, consumer MUST hỗ trợ version hiện tại + version cũ (`push-notification/03-operations.md` §9.2).

### NFR-009 — Operational Safety

Worker phải có thể pause/resume consumption, deploy version mới, rollback mà không cần thay đổi notification routing logic.

### NFR-010 — Stateless Runtime

Worker runtime SHOULD stateless. Business state bền nằm ở `push-notification` (logical delivery, qua private interface) và D1 `push-job` (job execution). Queue giữ message tạm thời với retention hữu hạn — không phải nơi state bền (`docs/overview/03-operations.md` §11.3, `docs/overview/04-platform-facts.md` QU3/QU5).

## 3. Security Requirements

### SR-001 — Credential Isolation

Worker credential được cấp qua secure runtime mechanism; provider secret MUST NOT được commit vào repository.

### SR-002 — Queue Safety

Queue payload MUST NOT chứa provider private key, provider secret, access token. Không có secret xuất hiện trong Queue, log, metric, error response.

### SR-003 — Log Redaction

Worker MUST redact: subscription auth, `p256dh`, VAPID private key, provider secret, authorization header.

### SR-004 — Runtime API Authorization

Private delivery-runtime API MUST xác thực caller là trusted `web-push-notification-job`.

### SR-005 — Least Privilege

Worker permission chỉ đủ để: đọc selected delivery runtime, cập nhật delivery outcome, invalidate subscription, read/write job state trên D1 `push-job`. Worker không có quyền Admin API, không binding tới D1 của service khác, không có PostgreSQL/Hyperdrive binding.

## 4. Non-goals

- **Không routing/reroute** — chọn transport, chọn provider, tìm subscription thay thế thuộc `push-notification` (`01-architecture.md` §2.2).
- **Không support transport ngoài `web`** ở phiên bản đầu; thêm transport thuộc job worker khác.
- **Không sở hữu logical delivery state** — chỉ job execution state trên D1 `push-job`.
- **Không phải backup/DR owner** — D1 `push-job` không thuộc Backup/DR scope (`docs/overview/03-operations.md` §3.1); recovery ở mức service qua reconciliation.
