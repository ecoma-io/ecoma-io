# Web Push Notification Job Operations

> **Phạm vi:** Queue/retry/DLQ operations, provider failure handling, runbook, rollout, capacity của `web-push-notification-job`.
> Error matrix canonical → `docs/services/push-notification/03-operations.md` §5 · outbox runbook (control plane) → `docs/services/push-notification/03-operations.md` §4 · system Queue rules → `docs/overview/03-operations.md` §11.3 · platform fact → `docs/overview/04-platform-facts.md` §2.8.

## 1. Runtime

```text
web-push-notification-job
├── Cloudflare Worker
├── Cloudflare Queue consumer
└── Cloudflare D1 `push-job`
```

Worker không expose public HTTP API và **không truy cập D1 của `push-notification` hay service khác**. D1 `push` thuộc control plane; D1 `push-job` thuộc service này, authoritative cho job state (attempt, processed marker, việc kẹt — `01-architecture.md` §11b). Không có path nào tới PostgreSQL. Private communication với `push-notification` qua `Service Binding` hoặc cơ chế private tương đương.

**D1 `push-job`:** migration bằng `wrangler d1 migrations` (track D1 — `docs/overview/02-delivery.md` §3). D1 không thuộc Backup/DR scope, retention/quota chưa chốt → `docs/overview/03-operations.md` §3.1 và §10; recovery ở mức service → §17.

## 2. Deployment

Deployment phải bao gồm: Worker · Queue Consumer · Dead Letter Queue · Service Binding · D1 binding `push-job` · Runtime Secrets.

- Deployment MUST không yêu cầu downtime của `push-notification`.
- Worker version mới phải consume được các Queue message version đang được hỗ trợ.
- Mechanics deploy/rollback chung → `docs/overview/02-delivery.md` §7–§8.

## 3. Configuration

Runtime configuration tối thiểu:

```text
QUEUE · PUSH_NOTIFICATION_SERVICE · LOG_LEVEL · ENVIRONMENT
```

Ngoài biến cấu hình, Worker phải có **D1 binding** tới `push-job` — không có binding này thì job state không ghi được (FR-022). Sensitive configuration (`delivery runtime authentication`, encryption key nếu dùng) không lưu trong source code — chính sách secret → `docs/overview/02-delivery.md` §6.

## 4. Queue Configuration

Queue phải có: `consumer`, `batch size`, `batch timeout`, `max retries` (retry policy + backoff), `max concurrency`, `dead letter queue`, per-message ACK/retry.

- **Per-message ACK/retry là bắt buộc:** mỗi message trong batch ACK, retry hoặc chuyển DLQ độc lập; message fail permanent MUST không retry lại các message khác trong batch.
- **Retention:** message không được consume trong retention bị xoá vĩnh viễn; message trong DLQ sống trong cửa sổ retention ngắn (giá trị → `docs/overview/04-platform-facts.md` QU3/QU5, hệ quả vận hành → `docs/overview/03-operations.md` §11.3). Không có retention-loss path nào khác để lấy message về — đó là lý do reconciliation trên D1 `push-job` là bắt buộc (FR-022, §14.10).
- Queue message phải có schema version (NFR-008).
- Concurrency phù hợp `provider rate limit`, expected latency, Worker limits (`docs/overview/04-platform-facts.md` §2.2). Không scale worker vượt khả năng xử lý của provider.

## 5. Retry Policy

Phân loại mã lỗi theo **error matrix canonical** ở `docs/services/push-notification/03-operations.md` §5; mục này chỉ nêu policy của delivery worker:

- Retry bounded, exponential backoff, jitter nếu cần, **per-message** — không theo batch; không retry vô hạn.
- Lỗi rõ ràng là permanent không đưa trở lại retry loop; persist + ACK.
- `404` (provider chứng minh) → invalidate subscription + ACK, không retry.
- `401`/`403` → provider credential/configuration failure: permanent cho delivery attempt (mark failed + ACK, không retry), provider-level path, **không** invalidate subscription (§7.2).
- `413` → permanent payload failure: persist + ACK.
- Runtime API transient failure → transient/retry.
- Không hard-code `401/403 = invalid subscription`.

## 6. Dead Letter Queue

Message chuyển tới DLQ khi: retry exhausted · unsupported message · poison message · unrecoverable processing error.

DLQ message phải giữ: `delivery_id`, `notification_id`, `subscription_id`, `provider_id`, original message, failure metadata. Không đưa secret vào DLQ payload.

## 7. Provider Failure Handling

Tách bạch bốn loại failure — không gộp chung:

### 7.1. Subscription failure

Provider chứng minh subscription invalid (thường `404`) → mark delivery failed → disable subscription → ACK. Chỉ loại này mới invalidate subscription.

### 7.2. Provider credential/configuration failure

`401`/`403` → record provider-level failure theo `provider_id` → alert operator → mark delivery failed (permanent cho delivery attempt — FR-009) → ACK. Không retry; **không** invalidate subscription — credential được rotate hoặc provider bị disable ở control plane để các delivery **tiếp theo** thành công. Không disable subscriptions của provider chỉ do credential/configuration lỗi.

### 7.3. Provider outage

`5xx`/`429`/network (provider down hoặc throttling) → transient → retry với backoff → theo dõi backlog, giảm pressure thay vì tăng concurrency. Không reroute — delivery giữ `provider_id` đã materialize.

### 7.4. Payload failure

`413` → permanent → mark delivery failed → ACK (không retry). Payload failure là delivery-level issue; không ảnh hưởng subscription eligibility.

## 8. Provider Credential Rotation

Khi `push-notification` thay đổi credential (Backoffice → Admin API → provider configuration updated), các delivery mới dùng credential mới; delivery đang nằm trong Queue **không** chứa credential cũ. Worker resolve credential tại delivery time qua private runtime interface và không cache credential lâu hơn policy cho phép. Worker không cần biết credential được encrypt thế nào trong database — decrypt thuộc control plane.

## 9. Provider Disable

Provider bị disable → không có delivery mới (routing phía control plane). Queue message đã tồn tại vẫn xử lý theo policy do control plane định nghĩa; worker **không** tự ý reroute sang provider khác (`01-architecture.md` §9).

## 10. Rollout và Worker Restart

**Worker restart** có thể xảy ra bất kỳ lúc nào: persistent delivery state quyết định `already delivered` hay `still pending` — không dựa vào process memory; duplicate Queue message sau restart phải an toàn (FR-001, NFR-002).

**Rollout sequence:** `deploy new Worker → health/startup verification → consume small backlog → observe error rate → continue rollout`. Theo dõi: `queue backlog`, `delivery latency`, `delivery success rate`, `retry rate`, `DLQ rate`, `provider error rate`, `worker exceptions`.

Rollback Worker version → `docs/overview/02-delivery.md` §8. Rollback khi: abnormal failure rate · unexpected duplicate delivery · schema incompatibility · provider authentication failure · persistent runtime resolution failure.

## 11. Observability

Dashboard tối thiểu:

- **Queue:** `queue backlog` · `queue age` · `consumer errors` · `DLQ size`
- **Delivery:** `delivery success rate` · `delivery failure rate` · `retry rate` · `delivery latency`
- **Provider:** `provider requests` · `provider errors` · `provider latency` · `provider rate limiting`
- **Subscription:** `active subscriptions` · `invalidated subscriptions` · `subscription invalidation rate`
- **Job state (D1 `push-job`):** job đã nhận nhưng quá ngưỡng chưa kết thúc (kẹt) · processed marker lỗi / reconciliation sweep age · tuổi message lớn nhất trong Queue (so với retention — `docs/overview/03-operations.md` §11.3)

**Metric tối thiểu phải expose:** `deliveries_consumed` · `deliveries_delivered` · `deliveries_failed` · `deliveries_retried` · `deliveries_skipped` · `subscriptions_invalidated` · `provider_request_total/success/failure/latency` · `queue_consumer_errors` · `runtime_resolution_errors` · `retry_count` · `dlq_messages`.

## 12. Alerts

```text
Queue backlog tăng liên tục · DLQ > 0 → Page (khớp docs/overview/03-operations.md §5)
Reconciliation: job kẹt quá ngưỡng chưa kết thúc, hoặc sweep thất bại/quá hạn
Delivery failure rate tăng · Provider error rate tăng · Runtime API failure tăng
Worker exception tăng · Provider authentication failure
```

Alert MUST được **aggregate theo `provider_id`, `app`, `transport`** — không alert theo một message failure đơn lẻ; không dùng `delivery_id`/`notification_id` làm alert dimension (chỉ dùng trong log/tracing).

**Ngoại lệ:** `DLQ > 0` và alert reconciliation **không** nằm dưới quy tắc aggregate — đó là alert về dữ liệu đang chết, không phải rate.

## 13. Operational Correlation

Mọi incident phải truy được: `request_id → notification_id → delivery_id → subscription_id → provider_id`. Khi debug một notification cụ thể, operator phải xác định được: `created → routed → queued → consumed → delivered / failed`.

## 14. Common Failure Modes

### 14.1. Queue backlog tăng

Kiểm tra theo thứ tự: `worker active? → runtime API healthy? → provider reachable? → provider rate limited? → worker concurrency đủ?`. Không tăng concurrency trước khi xác định provider là bottleneck.

### 14.2. Delivery failures tăng đột biến

Phân loại theo `provider_id`, error class, `transport`, subscription status. Nếu chỉ một provider bị ảnh hưởng, không kết luận worker lỗi toàn hệ thống.

### 14.3. Runtime resolution failures

Kiểm tra: Service Binding · authentication · `push-notification` health · `delivery_id` existence · subscription/provider state. Không truy cập DB trực tiếp để workaround.

### 14.4. DLQ tăng

Phân loại trước: `schema error` · `unsupported transport` · `provider error` · `runtime API error` · `bug`. Chỉ replay sau khi nguyên nhân đã được xử lý. Không replay message có subscription đã permanent invalid (§15).

### 14.5. Duplicate notification

1. Tìm `notification_id`/`delivery_id`. 2. Kiểm tra Queue delivery count (at-least-once redelivery). 3. Kiểm tra idempotency state. 4. Kiểm tra crash window — model canonical ở `docs/services/push-notification/01-architecture.md` §7. 5. Kiểm tra worker acknowledgement/retry behavior.

Duplicate do Queue redelivery + idempotency thiếu phải sửa ở consumer. Duplicate trong crash window là hành vi đã chấp nhận — không "sửa" bằng cách giảm Queue retry mà bỏ qua idempotency.

### 14.6. 401/403 spike

1. Phân loại theo `provider_id`. 2. Kiểm tra credential còn hạn / rotation đang dở. 3. Kiểm tra provider configuration thay đổi gần đây. 4. **KHÔNG** disable subscription hàng loạt. Xử lý ở provider level: rotate credential / sửa configuration / disable provider nếu systemic (§7.2).

### 14.7. 404 / invalid subscription spike

1. Phân loại theo `provider_id`, `app`, `transport`. 2. Xác định `404` do endpoint hết hạn (bình thường sau khi user revoke) hay classification sai (`401`/`403` bị coi là invalid?). 3. Kiểm tra subscription invalidation rate. 4. Nếu bất thường: dừng mảng invalidate, điều tra root cause. Chỉ `404` (hoặc response tương đương) hợp lệ để invalidate subscription.

### 14.8. 429 spike

1. Kiểm tra provider rate limit / throttling. 2. Giảm effective concurrency thay vì tăng. 3. Kiểm tra retry có respect `Retry-After`. 4. Theo dõi backlog — không resolve bằng tăng concurrency vô hạn.

### 14.9. Outbox backlog (control plane)

Delivery chưa bao giờ xuất hiện trong Queue → kiểm tra `push-notification` outbox backlog / publisher publish fail. Runbook: `docs/services/push-notification/03-operations.md` §4. Worker không tự xử lý outbox.

### 14.10. Message mất sau Queue retention (không tới DLQ)

Delivery **không bao giờ** xuất hiện trong Queue hoặc biến mất trước khi vào DLQ:

1. Kiểm tra tuổi message lớn nhất trong Queue so với retention (`docs/overview/04-platform-facts.md` QU5).
2. Đọc D1 `push-job`: delivery đã nhận nhưng quá ngưỡng chưa kết thúc? hoặc đã persist outcome nhưng chưa ack?
3. Dùng reconciliation job quét D1 `push-job` tìm việc kẹt và re-deliver qua Queue (FR-022).
4. Không ghi logical delivery state — việc đó thuộc `push-notification`.

Mất message sau retention là **mất việc đã enqueue, không mất state** (`docs/overview/03-operations.md` §11.3): state nằm ở database nên reconciliation trên D1 `push-job` là đường recovery duy nhất — không có nó thì retention loss im lặng.

## 15. Replay

Replay từ DLQ phải giữ nguyên `delivery_id`; không tạo `Push Delivery` mới. Trước replay kiểm tra `delivery state` · `subscription state` · `provider state`:

- Delivery đã `delivered` → replay MUST không gửi lại.
- Subscription đã `disabled`/`expired` vì invalid (permanent) → **không replay**.
- Provider đang `disabled` hoặc credential đang lỗi → xử lý nguyên nhân trước khi replay.
- Không replay message có `transport`/`provider.type` ngoài scope worker.

## 16. Security Operations

Operator MUST không đưa secret vào: issue · incident channel · log query · screenshot · DLQ. Credential rotation thực hiện qua Admin API của control plane; sau rotation verify: `new test delivery succeeds` · `old credential is no longer used` (§8).

## 17. Disaster Recovery

Storage authoritative duy nhất của service này là D1 `push-job` (job execution state); D1 không thuộc Backup/DR scope → `docs/overview/03-operations.md` §3.1. Push Delivery/Subscription/Provider thuộc D1 `push` của `push-notification` — service chỉ đọc qua private delivery-runtime API, không backup và không restore.

- Worker runtime disposable; mất Worker instance không làm mất delivery state.
- Mất Queue consumer tạm thời không làm mất message trước khi retry/DLQ policy exhausted.
- ⚠️ Message bị xoá do **retention** không nằm trong cửa sổ đó: việc đã enqueue mất, job state còn trong D1 `push-job` → tìm lại bằng reconciliation (§14.10).

## 18. Capacity Management

Capacity điều chỉnh theo: `queue backlog` · `oldest message age` · `delivery latency` · `provider throughput` · `worker execution time`. Mục tiêu: giữ backlog ổn định, tránh vượt provider rate limit. Không dùng raw request rate của `push-notification` làm sole scaling signal.

## 19. Operational Invariants

1. Worker không có public application API.
2. Secret không nằm trong Queue hoặc DLQ.
3. Retry phải bounded (per-message, backoff, không vô hạn).
4. Chỉ subscription failure được provider chứng minh (thường `404`) mới invalidate subscription; `401/403` là provider-level failure, không bulk-disable.
5. Credential rotation không yêu cầu thay đổi Queue contract.
6. Worker restart không làm mất persistent delivery state.
7. Rollback Worker không phá vỡ supported Queue schema; deployment không yêu cầu downtime của `push-notification`.

> Architectural invariants (no reroute, D1 ownership, idempotency theo `delivery_id`, per-message ACK, state machine) → `01-architecture.md` §23.
