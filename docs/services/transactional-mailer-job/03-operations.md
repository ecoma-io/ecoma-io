# Transactional Mailer Job Operations

## 1. Runtime, deployment và configuration

Deploy unit gồm đúng các resource sau (thiếu binding nào thì service không chạy đúng — `docs/services/transactional-mailer-job/01-architecture.md` §1):

```text
Worker              — không hostname, không HTTP API
Queue consumer      — ecoma-mail-delivery (+ DLQ)
Service Binding     — TRANSACTIONAL_MAIL_SERVICE → transactional-mail
D1 binding          — mail-job (thiếu → job state không ghi được — 02 FR-006)
```

- Provision D1 trước khi deploy: `wrangler d1 create mail-job` → điền `database_id` vào `wrangler.jsonc`.
- Migration: `wrangler d1 migrations apply mail-job --config wrangler.jsonc` (D1 migration track → `docs/overview/02-delivery.md` §3).
- Worker **không** giữ provider credential: credential thuộc control plane (Worker Secret `MAIL_PROVIDER_TOKEN`), chỉ lấy qua private runtime interface.
- Deployment không yêu cầu downtime của `transactional-mail`; worker version mới phải consume được Mail Command version đang hỗ trợ (`version = 1`). Deploy/rollback Worker version → `docs/overview/02-delivery.md` §7–8.
- Vận hành D1 `mail-job`: D1 **không** thuộc Backup/DR scope — dữ liệu có thể mất, service recover ở mức service (`docs/overview/03-operations.md` §3.1); retention/quota D1 `mail-job` chưa chốt (`docs/overview/03-operations.md` §10); không nằm trong ngân sách `max_connections` PostgreSQL (§11.4).

---

## 2. Queue configuration

Cấu hình service (xem `wrangler.jsonc`):

```text
consumer             ecoma-mail-delivery
max_retries          3
dead_letter_queue    ecoma-mail-delivery-dlq
per-message ACK/retry — bắt buộc
```

- Semantics platform (batch, ack API, retention, giới hạn) → `docs/overview/04-platform-facts.md` §2.8 (QU1–QU8); Queue rules toàn hệ thống → `docs/overview/03-operations.md` §11.3.
- **Per-message ACK/retry là bắt buộc:** mỗi message ACK/retry/đưa DLQ độc lập; một message fail MUST không retry các message khác trong cùng batch (QU4).
- **Retention:** message không consume kịp bị xoá vĩnh viễn (Free 24 giờ cố định · Paid 4–14 ngày — QU5). Không có retention-loss path nào khác để lấy message về — đó là lý do reconciliation trên D1 `mail-job` là bắt buộc (§10).
- Queue message phải có schema version.
- Concurrency cấu hình theo provider rate limit; không scale vượt khả năng xử lý của relay.

---

## 3. Error classification và retry policy

**Đây là error matrix canonical của mail delivery** — classification cho consumer; design rules → `docs/services/transactional-mailer-job/01-architecture.md` §10.

| Loại           | Ví dụ                                                               | Retry?                                    | Hành động                                                |
| -------------- | ------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------- |
| **retryable**  | 429, 5xx, network, timeout, D1 write lỗi, control plane unavailable | Có — bounded `max_retries` + backoff (§2) | `retry()` — không ack khi state chưa persist             |
| **permanent**  | 4xx khác (invalid recipient, payload reject)                        | Không                                     | mark `failed` → report → ack                             |
| **credential** | 401/403, provider-not-configured                                    | Không                                     | mark `failed` → report → ack; xử lý ở control plane (§5) |
| **contract**   | `invalid-command`, `unsupported-version`, `forbidden-field`         | Không                                     | mark `failed` (nếu có delivery_id) → report → ack        |

Bốn loại MUST tách bạch, không gộp chung:

- **Transient (429/5xx/network/timeout)** → `retry()` (attempts tăng); theo dõi backlog — giảm pressure provider thay vì tăng concurrency.
- **401/403 là credential-class:** không retry delivery này; rotate `MAIL_PROVIDER_TOKEN` / cấu hình `MAIL_PROVIDER_ENDPOINT` ở control plane (§5) — delivery **tiếp theo** sẽ dùng credential mới; worker không tự retry, không đổi provider.
- **Permanent** là delivery-level issue — không ảnh hưởng delivery khác.
- **Contract** non-retryable — retry không sửa được command sai.
- Retry qua `message.retry()` per message; không vô hạn; permanent/credential/contract không bao giờ quay lại retry loop.
- Timeout hữu hạn cho provider request (mặc định 10 s) — timeout phân loại `retryable`.

---

## 4. Dead Letter Queue

Message chuyển tới `ecoma-mail-delivery-dlq` khi: retry exhausted (`max_retries = 3`) · poison message (invalid/unsupported version) sau khi đã retry · unrecoverable processing error. Hết retry mà không có DLQ thì message bị xoá vĩnh viễn; message trong DLQ không consumer giữ 4 ngày (`docs/overview/04-platform-facts.md` QU3).

- DLQ message giữ nguyên Mail Command (delivery_id, message_id, app, template, payload render) + failure metadata ở D1 `mail-job`.
- Không đưa secret/recipient vào DLQ payload.

---

## 5. Provider credential rotation và secret operations

Khi `transactional-mail` thay credential (admin tooling — Chưa chốt ở control plane):

```text
MAIL_PROVIDER_TOKEN (Worker Secret của control plane) được thay
    ↓
các delivery mới lấy credential mới tại delivery time qua private runtime interface
```

- Delivery đang nằm trong Queue không chứa credential cũ — worker **không cần đổi gì**.
- Việc credential được encrypt thế nào trong D1 thuộc control plane.
- Operator MUST không đưa secret/recipient vào: issue · incident channel · log query · screenshot · DLQ.

---

## 6. Worker restart

Worker có thể restart bất kỳ lúc nào. Quyết định dựa trên persistent job state trên D1 `mail-job`, không dựa vào process memory: job đã terminal (`sent`/`failed`) thì **không gửi lại**; outcome chưa báo (`outcome_reported = 0`) thì báo nốt rồi ack; job còn `processing` thì `attempts++` và tiếp tục (flow đầy đủ → `docs/services/transactional-mailer-job/01-architecture.md` §9.2).

Duplicate Queue message sau restart phải an toàn.

---

## 7. Rollout

Rollout/rollback chung (Worker version, promotion gate) → `docs/overview/02-delivery.md` §7–8. Service-specific:

Theo dõi trong rollout: queue backlog · delivery latency · delivery success rate · retry rate · DLQ rate · provider error rate · worker exceptions.

Rollback khi xuất hiện: failure rate bất thường · duplicate delivery bất thường · schema incompatibility (Mail Command version) · 401/403 spike (credential) · runtime resolution failure kéo dài.

---

## 8. Observability, correlation và alerts

Observability system-wide (Axiom, dataset, retention, privacy) → `docs/overview/03-operations.md` §4. Tại đây chỉ metric/điều kiện của service:

**Dashboard tối thiểu:**

- **Queue:** backlog/age · consumer errors · DLQ size.
- **Delivery:** success rate · failure rate · retry rate · latency.
- **Provider:** requests · errors · latency · rate limiting.
- **Job state (D1 `mail-job`):** job nhận nhưng quá ngưỡng chưa kết thúc (kẹt) · sweep/reconciliation age · tuổi message lớn nhất trong Queue (so với retention — QU5).

**Log:** whitelist field (`docs/services/transactional-mailer-job/01-architecture.md` §13); recipient/subject/body/credential không bao giờ log. Mọi incident phải truy được `delivery_id → message_id → app` qua log chính — log phải trả lời: delivery nào, message nào, app nào, attempt nào, outcome nào, error class nào.

**Alert:**

```text
Queue backlog tăng liên tục
DLQ > 0 → Page (khớp docs/overview/03-operations.md §5)
Reconciliation: job kẹt quá ngưỡng, hoặc sweep thất bại/quá hạn
Delivery failure rate tăng · provider error rate tăng
Runtime API failure tăng · worker exception tăng
Provider authentication failure (401/403 spike)
```

Alert MUST **aggregate theo `app`** (và error class) — không alert theo một message failure đơn lẻ. **Ngoại lệ:** `DLQ > 0` và alert reconciliation không nằm dưới quy tắc aggregate.

---

## 9. Common failure modes

### 9.1. Queue backlog tăng

1. worker active? · 2. runtime API (`TRANSACTIONAL_MAIL_SERVICE`) healthy? · 3. provider reachable / rate limited? · 4. worker concurrency đủ?

Không tăng concurrency trước khi xác định provider có phải bottleneck.

### 9.2. Delivery failures tăng

Phân loại theo `app`, error class, provider status. Nếu chỉ một app bị ảnh hưởng, không kết luận worker lỗi toàn hệ thống.

### 9.3. Runtime resolution failures

Kiểm tra: Service Binding, control plane health, `delivery_id` tồn tại. **Không** truy cập D1 `mail` trực tiếp để workaround.

### 9.4. DLQ tăng

Phân loại: schema error (unsupported version) / forbidden field / provider error / runtime API error / bug. Chỉ replay sau khi nguyên nhân đã được xử lý.

### 9.5. Duplicate mail

1. tìm `delivery_id` / `message_id` · 2. kiểm tra Queue redelivery count (at-least-once — QU1) · 3. kiểm tra idempotency state (đã sent mà vẫn gửi lại?) · 4. kiểm tra crash window (provider nhận trước khi persist?).

Duplicate do redelivery + idempotency thiếu → sửa ở consumer. Duplicate trong crash window là hành vi đã chấp nhận (`docs/services/transactional-mailer-job/01-architecture.md` §9.1).

### 9.6. 401/403 spike

1. credential `MAIL_PROVIDER_TOKEN` của control plane còn hạn / rotation có dở không? · 2. endpoint có đúng không? · 3. **KHÔNG** retry hàng loạt — xử lý ở control plane (§5).

### 9.7. 429 spike

1. provider rate limit / throttling · 2. giảm effective concurrency thay vì tăng · 3. theo dõi backlog — không resolve bằng tăng concurrency vô hạn.

### 9.8. Command rejected tăng

Nếu `command_rejected` tăng (invalid/unsupported/forbidden-field): kiểm tra contract phía control plane đã deploy version mới chưa (version mismatch), hoặc có payload lọt key cấm (bug control plane).

### 9.9. Outbox backlog (control plane)

Nếu message không bao giờ tới Queue: xem `docs/services/transactional-mail/03-operations.md` §5. Worker không tự xử lý outbox.

### 9.10. Message mất sau Queue retention

Nếu delivery không bao giờ xuất hiện trong Queue hoặc biến mất trước khi vào DLQ:

1. tuổi message lớn nhất so với retention (QU5) · 2. đọc D1 `mail-job`: job nhận nhưng chưa kết thúc, hoặc đã persist nhưng chưa ack? · 3. reconciliation quét D1 `mail-job` để re-deliver qua Queue · 4. không ghi logical message state — việc đó thuộc `transactional-mail`.

Mất message sau retention là **mất việc đã enqueue, không mất state**. Reconciliation là đường recovery duy nhất — hiện **chưa chốt cơ chế** (§10).

---

## 10. Reconciliation và recovery

**Reconciliation (Chưa chốt):** cơ chế reconciliation cho job mail (ai quét D1 `mail-job` tìm job kẹt và re-deliver, chu kỳ bao nhiêu) **chưa chốt** — canonical entry ở `docs/overview/03-operations.md` §10. Service này chưa có cron/reconciliation; trước go-live phải có (tiền lệ: `docs/services/web-push-notification-job/02-requirements.md` FR-022).

**Recovery:**

- D1 `mail-job` là storage authoritative duy nhất của service — backup/DR scope → §1. Mail Message / Template thuộc D1 `mail` của `transactional-mail` — service chỉ đọc qua private interface, **không** backup/restore chúng.
- Worker runtime disposable; mất instance không mất job state.
- Mất Queue consumer tạm thời không mất message trước khi retry/DLQ exhausted. ⚠️ Message bị xoá do **retention** không nằm trong cửa sổ đó: việc đã enqueue mất, job state còn ở D1 `mail-job` → phải tìm lại bằng reconciliation (§9.10).

---

## 11. Replay

Replay từ DLQ phải giữ nguyên `delivery_id` — không tạo message mới.

Pre-replay validation (đọc state qua control plane, không chạm D1 `mail`):

- Job đã `sent` + `outcome_reported = 1` → **không replay** (sẽ gửi lại thư).
- Job `sent` nhưng outcome chưa báo → không replay; duplicate message sẽ tự báo nốt outcome.
- Job `failed` do credential → xử lý credential ở control plane trước khi replay (§5).
- Command không hợp lệ (unsupported version, forbidden field) → không replay; sửa root cause trước.

---

## 12. Capacity management

Capacity điều chỉnh theo: queue backlog · oldest message age · delivery latency · provider throughput · worker execution time.

Mục tiêu: giữ backlog ổn định, không vượt provider rate limit. Không dùng raw request rate của `transactional-mail` làm sole scaling signal.

---

## 13. Operational invariants

Boundary/idempotency/retry invariants → `docs/services/transactional-mailer-job/01-architecture.md` §14. Chỉ các invariant vận hành:

1. Worker restart không mất persistent job state (D1 `mail-job`).
2. Credential rotation không yêu cầu đổi Queue contract.
3. Rollback Worker không phá vỡ Mail Command version đang hỗ trợ.
4. Retry bounded; permanent/credential không retry; per-message ack/retry — một message fail không retry cả batch.
5. D1 ghi lỗi → retry, không ack.
