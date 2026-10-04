# Push Notification Service Operations

> **Phạm vi:** vận hành của `push-notification` (control plane): deployment/config, outbox và Queue publishing, provider và credential operations, monitoring/alerting, reconciliation, runbook, capacity, retention.
> Delivery-side runbook (retry, DLQ processing, worker operations) → `docs/services/web-push-notification-job/03-operations.md`. System-wide policies (pipeline, observability, backup/DR, alert tổng thể) → `docs/overview/02-delivery.md`, `docs/overview/03-operations.md`. Platform facts → `docs/overview/04-platform-facts.md`.
> Design của service (topology, domain model, routing, state machine, outbox model, idempotency) → [`01-architecture.md`](./01-architecture.md).

**Mục tiêu vận hành:** không mất `Push Notification` sau khi request accept theo contract · không tạo duplicate logical delivery · cô lập failure theo `App`/`Provider`/`Device`/`Subscription` · rotate credential không downtime · truy vết được theo `notification_id`, `delivery_id`, `provider_id`.

## 1. Operational topology

```text
Ecoma Apps ──► push-notification (API · Admin API · Routing · Persistence · Outbox Publisher)
                        │ produce
                        ▼
              Cloudflare Queue  ecoma-push-delivery ──► web-push-notification-job ──► Browser Push Service
```

- Hai service **deploy và scale độc lập**; state đúng của notification nằm ở D1 `push`, không nằm ở Queue (`docs/overview/03-operations.md` §11.3).
- Queue semantics/retention → `docs/overview/04-platform-facts.md` §2.8 · system Queue rules → `docs/overview/03-operations.md` §11.3 · thiết kế topology → [`01-architecture.md`](./01-architecture.md) §3.

## 2. Environment và Cloudflare resources

Mỗi environment (`development`, `staging`, `production`) có resource độc lập: Queue · D1 · provider configuration · secrets · observability. Environment matrix → `docs/overview/02-delivery.md` §4.

**Production tối thiểu:** Worker `push-notification` · Worker `web-push-notification-job` · D1 `push` (owner: push-notification) · D1 `push-job` (owner: web-push-notification-job) · Queue `ecoma-push-delivery` · DLQ `ecoma-push-delivery-dlq`.

- DLQ giữ message vượt retry limit; behavior → `docs/overview/04-platform-facts.md` QU3. Mọi production consumer MUST có DLQ (`docs/overview/01-architecture.md` invariant 9).
- **Local:** mô phỏng tối thiểu `push-notification` + `web-push-notification-job` + Queue + database; provider thực tế không gọi mặc định từ local — dùng mock/test provider cho `success` · `429` · `5xx` · `timeout` · `invalid subscription` · `invalid credential`. Local secret qua `.dev.vars`/`.env`, không commit Git.
- **Staging:** resource độc lập (Queue, database, provider configuration, secrets); cùng schema và Queue contract với production; **không** dùng production provider credential.

## 3. Queue configuration

Queue chính: `ecoma-push-delivery` · DLQ: `ecoma-push-delivery-dlq`. **Không** tạo Queue riêng cho từng `App` trừ khi có requirement mới chứng minh cần isolation ở mức Queue. Consumer: `web-push-notification-job` (consumer config → `docs/services/web-push-notification-job/03-operations.md` §4).

```text
batch size · batch timeout · message retries · retry delay · max concurrency · dead letter queue
```

- `batch size`/`batch timeout` điều chỉnh theo provider rate limit, request latency, memory usage, expected volume (platform batch semantics → `docs/overview/04-platform-facts.md` QU4).
- **Per-message ACK/retry là bắt buộc** (FR-013): message fail permanent MUST không retry lại các message khác trong cùng batch — áp dụng cả khi troubleshooting (§15). Duplicate Queue message là expected, không phải lỗi — consumer idempotent theo `delivery_id` (`01-architecture.md` §7).

## 4. Outbox Operations

Tham số vận hành (design → `01-architecture.md` §6):

```text
poll interval · batch size · claim lease timeout
max publish attempts · retry backoff (available_at) · published retention (cleanup)
```

### 4.1. Record operations

| Record       | Trạng thái                       | Thao tác operator                                                                                                                  |
| ------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pending`    | chờ claim, `available_at <= now` | backlog quá hạn tuổi → §4.2, runbook §15.2                                                                                         |
| `publishing` | giữ lease hạn định               | quá `claim lease timeout` → lease hết hạn, claim lại; lặp liên tục → kiểm tra publisher errors · Queue publish errors · D1 (§10.3) |
| `published`  | `Queue.send()` thành công        | xóa theo retention — không cần thao tác                                                                                            |
| `failed`     | vượt `max publish attempts`      | **không** xóa tự động → §4.2                                                                                                       |

- `Queue.send()` thành công trước khi mark `published` → publish lại là expected: chấp nhận duplicate, không chấp nhận mất message. Publisher crash → lease hết hạn → claim lại; **không** network call tới Queue hay provider bên trong D1 transaction (`01-architecture.md` §6.2).

### 4.2. Reconciliation

Chạy khi: alert record `pending`/`publishing` quá hạn tuổi (§11) · alert `failed` tích tụ (§11) · sau incident Queue publish failure · nghi ngờ notification đã accept nhưng không thấy delivery trong Queue.

| Phát hiện                                   | Hành động                                                                                                                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `publishing` kẹt quá lease                  | lease tự hết hạn và claim lại; lặp lại → sửa nguyên nhân ở publisher/Queue/D1 trước                                                     |
| `pending` backlog                           | sửa nguyên nhân (Queue publish errors · D1 · publisher health) → publisher tự catch up → monitor backlog về 0                           |
| `failed` record                             | xem `last_error` → sửa nguyên nhân (config/Queue/D1) → **retry** record; không xác định được → **manual investigation**, giữ `failed`   |
| Outbox khớp nhưng delivery không tiến triển | đối chiếu delivery state với outbox trong D1 `push`; không ghi đè state ngoài Admin API (`POST /admin/v1/deliveries/:id/retry`, FR-017) |

- **Retry** chỉ sau khi nguyên nhân đã sửa; delivery permanent failure → **mark failed** theo §5. Record `failed` do publisher đánh dấu khi vượt attempts — operator giữ, **không xóa**, khi chưa rõ nguyên nhân. Outbox record không được mất trước khi publish thành công (§17).
- Delivery-side reconciliation → `docs/services/web-push-notification-job/02-requirements.md` FR-022 · `docs/overview/03-operations.md` §10.

## 5. Delivery failure classification (Web Push Error Classification)

**Error matrix canonical** dùng thống nhất cho control plane và delivery plane (`docs/services/web-push-notification-job/03-operations.md` tham chiếu về đây):

| HTTP        | Class                                     | Action                                    |
| ----------- | ----------------------------------------- | ----------------------------------------- |
| `2xx`       | success                                   | mark delivered, ACK                       |
| `429`       | transient / retry                         | backoff, tôn trọng `Retry-After`          |
| `5xx`       | transient / retry                         | retry                                     |
| `404`       | subscription invalidation                 | mark failed, invalidate subscription, ACK |
| `401`/`403` | provider credential/configuration failure | provider-level failure path — xem dưới    |
| `413`       | permanent payload failure                 | mark failed, ACK, không retry             |

- **Transient** (timeout, connection reset, 5xx, 429, DNS tạm): retry. **Permanent** (subscription invalid, endpoint expired, provider-level credential invalid — **không** invalidate subscription, malformed payload): mark failed, ACK. **Unknown:** retry → vượt limit → DLQ. Subscription invalidation **chỉ** khi provider chứng minh endpoint không còn hợp lệ (thường `404`).
- **`401`/`403`:** mark failed, ACK, ghi nhận theo `provider_id` và alert; **không retry**, **không** invalidate subscription, không disable hàng loạt — remediation ở §6/§7 cho các delivery tiếp theo.
- **429:** tôn trọng `Retry-After`, tránh tight retry loop; backlog do 429 → giảm effective concurrency, không tăng concurrency vô hạn (§16).
- Không tự động reroute sang provider khác nếu routing policy không cho phép (`01-architecture.md` §5.3).

## 6. Provider operations

### 6.1. Configuration management

Provider quản lý qua `Admin API`: `create` · `update` · `enable` · `disable` · `test` · `rotate credential`. Mọi thay đổi production provider phải có audit record (§14). Validation trước production enable — chỉ `disabled → enabled` sau khi pass: `configuration schema` · `credential availability` · `credential validity` · `provider connectivity` · `test delivery`. Operational rule: `one active primary provider per App + Transport` — `Admin API` MUST từ chối cấu hình tạo ambiguity, không bao giờ chọn provider random/thứ tự database (`01-architecture.md` §5.3).

### 6.2. Provider health

Theo dõi health theo `provider_id`, `app`, `transport` — không chỉ theo provider type (ví dụ `backoffice / web / provider-a` và `llm-seller / web / provider-b` quan sát độc lập). Metrics/dashboard → §10.

### 6.3. Provider disable procedure

`Admin API → disable provider → dừng routing delivery mới`

- Delivery đã materialize — kể cả trong Queue — tiếp tục theo `provider_id` đã ghi; disable **không** implicit cancel, **không** tự động reroute (`01-architecture.md` §5.3).
- Không tự ý đổi queued delivery từ provider A sang B — routing mutation, có thể gây duplicate. **Administrative reroute** là operation riêng, chủ đích, có audit — theo dõi queued deliveries trước khi quyết định.

### 6.4. Provider test runbook

Select provider (`provider_id`) → select target subscription đã authorization (`subscription_id`) → execute test delivery → inspect `delivery_id` và provider response. Test result phân loại theo `02-requirements.md` FR-018; test có audit record, payload không chứa dữ liệu nhạy cảm không cần thiết.

## 7. Credential và secret operations

### 7.1. Storage boundary

Credential lưu **encrypted at root key**; root key/runtime secret dùng `Cloudflare Worker Secret` — plaintext `vars` không dùng để lưu secret. Credential không nằm trong wrangler configuration, Git, Queue, application log, audit log, API response.

### 7.2. Provider credential rotation

```text
tạo credential mới → lưu → validate → activate → gửi test notification
→ monitor delivery → revoke credential cũ → audit rotation
```

**Không revoke credential cũ trước khi credential mới validate thành công.** Cấm đảo thứ tự (`revoke old → deploy new` khi deployment mới chưa xác nhận). Rotation không yêu cầu restart toàn bộ application.

### 7.3. Credential encryption-key rotation

Không rotate root key kiểu replace đột ngột — dùng multi-key: `K1 active → K2 introduced (read K1+K2, ghi mới dùng K2) → reencrypt records bằng K2 (background job, batch, idempotent) → verify không còn record nào cần K1 → retire K1`. Không retire `K1` khi còn record chưa reencrypt (`credential_encryption_version` còn trỏ `K1`); quan sát metric số record theo key version — tương ứng `02-requirements.md` FR-006.

### 7.4. Infrastructure secrets

Secret cấp infrastructure (database credential, encryption key, application auth secret, Cloudflare API credential) rotate theo policy chung — `docs/overview/03-operations.md` §8 (quarterly, native Worker Secrets). Local secret qua `.dev.vars`/`.env`, không commit Git.

## 8. Database operations

D1 `push` chứa (inventory): `devices` · `push_subscriptions` · `push_providers` · `push_provider_credentials` · `push_app_provider_mappings` · `push_notifications` · `push_deliveries` · `push_outbox` · `audit_records`.

- Ownership và transaction model (`db.batch()` gộp write; không network call trong D1 transaction) → `01-architecture.md` §6, §12 · `docs/overview/04-platform-facts.md` DB2.
- **Không service khác truy cập trực tiếp D1 `push`** — `web-push-notification-job` resolve runtime data qua private interface, sở hữu D1 `push-job` riêng (`docs/overview/01-architecture.md` §4).
- Outbox claim cần index theo `status + available_at`; write latency tăng khi transaction lớn.

**Migration:** track D1 canonical ở `docs/overview/02-delivery.md` §3 (expand → compatible rollout → contract, không down-migrate). Yêu cầu đặc thù: migration idempotent hoặc có guard chống apply hai lần · backward-compatible với Worker version đang chạy · Queue message schema có `version` · theo dõi D1 schema version.

**Backup/DR scope:** D1 `push` **không** thuộc Backup/DR scope — không backup strategy, không restore runbook, không đưa vào RPO/RTO matrix (`docs/overview/03-operations.md` §3.1); Time Travel (`04` DB5) là capability destructive của platform, **không** phải cam kết phục hồi. Recovery → §12.

## 9. Deployment, rollout và rollback

### 9.1. Deployment boundary

Hai service deploy độc lập — một service deploy được mà không cần service còn lại nếu contract không đổi. Pipeline/preview/promotion gate → `docs/overview/02-delivery.md`.

### 9.2. Queue contract rollout

Thay đổi Queue contract theo hướng backward compatible: `deploy consumer hỗ trợ old + new → deploy producer dùng new format → monitor → remove old support`.

**MUST NOT** deploy producer new format khi old consumer chưa hiểu message mới. Breaking contract → dùng **new queue / version**, không inplace breaking change. Ba loại version phải quản lý: `API version` · `Queue message version` · `Database schema version`.

### 9.3. Post-deployment verification

`API health · Queue publish · Queue consume · provider test · delivery success · error rate · queue backlog`

### 9.4. Rollback

Phân biệt: `code rollback` · `queue contract rollback` · `provider configuration rollback`. **Không có** hạng mục "schema rollback": không rollback D1 migration — cùng quy tắc PostgreSQL (`docs/overview/02-delivery.md` §3): chỉ expand → contract + forward-fix. Rollback Worker theo version đã publish → `docs/overview/02-delivery.md` §8.

## 10. Observability

### 10.1. Correlation và structured logging

Correlation chain: `request_id → notification_id → delivery_id → subscription_id → provider_id` — log phải cho phép tìm toàn bộ lifecycle từ `request_id` hoặc `delivery_id`. Mỗi log entry nên có: `timestamp` · `level` · `service` · `environment` · các id trên · `app` · `transport` · `event` · `error_code` · `duration_ms`. **Không log:** private key, access token, subscription secret, provider credential; payload notification redacted khi chứa sensitive data. Policy chung → `docs/overview/03-operations.md` §4.

### 10.2. Metrics

```text
notifications_created_total · notifications_rejected_total
deliveries_created_total · deliveries_queued_total · deliveries_delivered_total · deliveries_failed_total
subscriptions_active · subscriptions_disabled · subscriptions_expired
queue_publish_failures_total · queue_backlog · queue_oldest_message_age · queue_retry_rate · queue_processing_failures_total
outbox_pending · outbox_publishing_aged · outbox_failed
provider_requests_total · provider_success_total · provider_failures_total
provider_429_total · provider_5xx_total · provider_auth_failures_total · provider_latency_ms · provider_invalid_subscription_total
dlq_messages
```

- Dimension tối thiểu theo `provider_id`, `app`, `transport`. **Không** dùng `user_id`, `notification_id`, `delivery_id`, `endpoint` làm high-cardinality label — chỉ dùng trong log/tracing.

### 10.3. Dashboard

| Nhóm     | Nội dung                                                                            |
| -------- | ----------------------------------------------------------------------------------- |
| Queue    | backlog · tuổi message lớn nhất · processing rate · retry rate · failure rate · DLQ |
| Outbox   | `pending` · `publishing` quá tuổi (stale lease) · `failed` · queue publish errors   |
| Delivery | success rate · failure rate · latency · invalid subscription                        |
| Provider | success · error rate · 429 · 5xx · authentication failure (401/403) · latency       |
| Service  | request rate · API latency/error · Worker errors · D1 errors · queue publish errors |

Filter theo `app`, `transport`, `provider`.

### 10.4. Health checks

- **Liveness:** chỉ kiểm tra process/runtime hoạt động — không phụ thuộc provider, database, Queue. **Readiness:** phản ánh trạng thái dependency cần thiết để nhận request an toàn.

## 11. Alerts

Alert system-level (DLQ không rỗng, backup,…) → `docs/overview/03-operations.md` §5; dưới đây là điều kiện riêng của service (ưu tiên rate/anomaly, không alert theo một failure đơn lẻ):

| Nhóm         | Điều kiện                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Queue        | backlog tăng liên tục · tuổi message lớn nhất tăng · retry rate tăng · processing failure tăng · `DLQ > 0` |
| Outbox       | record `pending`/`publishing` quá hạn tuổi · `failed` tích tụ (§4)                                         |
| Delivery     | delivery failure rate tăng · delivery latency tăng                                                         |
| Provider     | 429 rate tăng · 5xx rate tăng · provider authentication failure (`401/403`) · latency tăng                 |
| Subscription | invalid subscription tăng bất thường                                                                       |
| Service      | API error rate tăng · Worker invocation failure tăng · D1 error tăng · queue publish errors tăng           |

## 12. Backup và recovery

- **D1 `push` ngoài Backup/DR scope** — policy system → `docs/overview/03-operations.md` §3.1.
- **Rebuild flow:** re-seed provider configuration → restore service → verify queue connectivity → verify routing → client re-subscribe / rebuild state → send test notification. Không restore đè; Time Travel không phải runbook của ecoma (§8).
- **Mất delivery worker:** restore worker → reconnect consumer → process Queue backlog. Message mất sau retention tìm lại bằng reconciliation trên D1 `push-job` của `web-push-notification-job` (→ `docs/services/web-push-notification-job/03-operations.md`).
- **Backup duy nhất của service này là credential** (không nằm trong D1).

## 13. Data retention và cleanup

Retention định nghĩa độc lập cho từng loại: `Push Notification` (ngắn) · `Push Delivery` (dài hơn — metadata cho history) · `Audit Record` (dài nhất) · `Log` · `Metrics` · `DLQ`. Không giữ payload lâu hơn mức cần thiết; retention thực tế tuân regulatory requirement. Retention/quota của D1 `push` là operational item chưa chốt → `docs/overview/03-operations.md` §10.

- `DELETE` subscription/provider trong Admin API là **logical revoke/disable** (`02-requirements.md` §4.3); physical cleanup chỉ thuộc retention/cleanup process.
- **Periodic cleanup:** expired subscriptions · disabled subscriptions · orphan devices · stale provider configuration. Không xóa ngay subscription chỉ vì không có delivery gần đây — `last_seen_at` chỉ dùng cho cleanup policy khi đã chốt threshold.

## 14. Admin operations

- Operation nguy hiểm yêu cầu explicit confirmation tại `Backoffice`: `disable provider` · `delete provider` · `revoke credential` · `disable many subscriptions` · `replay many DLQ messages`.
- Bulk operation phải ghi: `operator` · `timestamp` · `reason` · `scope` · `result`.
- Audit event bắt buộc → `02-requirements.md` FR-020; audit record không chứa secret.
- DLQ replay là administrative operation: giữ nguyên `delivery_id` · không tạo notification/delivery mới · không bỏ qua idempotency · ghi audit · không replay nếu subscription đã permanent invalid.

## 15. Incident runbooks

### 15.1. Incident: Queue backlog

```text
provider health → 429/5xx · provider latency → consumer health · Worker errors → concurrency · per-message ACK/retry
→ outbox backlog (§4) · database latency → provider outage (§15.4)
→ giảm pressure nếu provider throttling (§16) → monitor backlog recovery
```

### 15.2. Incident: Outbox backlog

```text
Queue publish errors · publisher Worker errors → D1 error/latency
→ stale lease (`publishing` quá claim lease timeout — §4.1)
→ reconcile `pending`/`failed` (§4.2) → monitor backlog
```

### 15.3. Incident: Invalid credential

```text
xác nhận spike 401/403 theo `provider_id` · `app` → disable provider nếu systemic
→ rotate credential (§7.2) → verify configuration → test delivery (§6.4) → monitor recovery
```

Không ghi credential mới vào log. Sau khi credential mới active, delivery đang failed vì `401/403` không tự replay (§5).

### 15.4. Incident: Provider outage

```text
xác nhận outage · `provider_id` · affected `app`/`transport` → queue backlog · delivery failure rate · 429/5xx · consumer errors
→ không tăng concurrency vô hạn — bounded retry (§16) → monitor backlog
→ verify outage đã hết → test delivery (§6.4) → enable lại provider nếu đã disable → monitor recovery
```

Không replay toàn bộ DLQ nếu root cause chưa sửa.

### 15.5. Incident: DLQ growth

```text
lấy sample message · kiểm tra failure type → provider · subscription state → phân loại systemic / per-message
→ sửa root cause → test một message → replay theo batch nhỏ → monitor
```

Không replay toàn bộ DLQ khi chưa biết nguyên nhân (§14).

### 15.6. Incident: Duplicate delivery

```text
tìm `notification_id` · `delivery_id` → Queue delivery count · idempotency state → worker acknowledgement · retry behavior
```

Duplicate do Queue redelivery + missing idempotency → sửa ở **consumer**; không giảm Queue retry để "chữa" duplicate mà bỏ qua idempotency.

## 16. Backpressure và capacity

Khi downstream provider chậm: `provider latency ↑ → worker processing time ↑ → queue backlog ↑`. **Không** giải quyết mặc định bằng tăng `max concurrency` — xác định bottleneck trước: `provider rate limit` · `provider latency` · `database latency` · `network` · `Worker CPU/memory`. Giới hạn concurrency của Queue → `docs/overview/04-platform-facts.md` QU6.

**Capacity** đánh giá theo: `notifications/second` · `deliveries/second` · average payload size · provider latency · provider rate limit · queue backlog. **Không** lấy `notifications/second` làm throughput duy nhất — metric quan trọng hơn là `deliveries/second`.

## 17. Operational invariants

1. Không có delivery tới `disabled` subscription; không có delivery qua `disabled` provider cho routing mới.
2. Không có Queue message, log, audit record hay DLQ payload chứa secret/credential.
3. Một `delivery_id` chỉ đại diện cho một logical delivery; duplicate Queue message không tạo duplicate logical delivery.
4. Provider failure không làm mất delivery metadata; outbox record recoverable tới khi publish thành công; record `failed` không xóa tự động.
5. DLQ luôn được cấu hình trong production; không replay DLQ trước khi xác định nguyên nhân failure.
6. Không tăng consumer concurrency vô hạn để xử lý provider throttling.
7. Credential rotation không yêu cầu downtime; production và staging không dùng chung Queue hoặc provider credential.
8. Mọi administrative mutation quan trọng đều được audit.
9. Worker (delivery plane) không thực hiện rerouting; disable provider không implicit cancel/reroute delivery đã materialize.
10. Queue contract có version và migrate theo backward-compatible strategy (§9.2).
11. `App` và `Transport` phải có trong mọi operational metric và trace cần thiết.
