# Transactional Mailer Job Architecture

> **Phạm vi:** boundary, lifecycle, state ownership, idempotency, retry model, invariants của `transactional-mailer-job`.
> Mail Command contract (producer side) → `docs/services/transactional-mail/01-architecture.md` §5 · error matrix → [`03-operations.md`](./03-operations.md) §3 · requirement → [`02-requirements.md`](./02-requirements.md).

## 1. Mục đích

`transactional-mailer-job` là delivery worker thực hiện mail delivery cho các `Mail Message` mà `transactional-mail` đã render và enqueue. Worker thuộc **delivery plane**:

```text
transactional-mailer-job
├── Cloudflare Worker (module worker, KHÔNG có HTTP route)
├── Cloudflare Queue consumer `ecoma-mail-delivery`
└── Cloudflare D1 `mail-job` (job execution state của chính service này)
```

```text
transactional-mail (D1 `mail`)
       │
       │ Mail Command
       ▼
Cloudflare Queue
       │
       ▼
transactional-mailer-job ──── D1 `mail-job`
       │
       │ relay protocol
       ▼
Mail Relay (provider)
```

Worker không quyết định gửi cho ai, template nào — quyết định đã materialize ở control plane và đóng vào Mail Command. Worker chỉ thực hiện giao.

---

## 2. Phạm vi

### 2.1. Trong phạm vi

1. Consume Mail Command từ Cloudflare Queue.
2. Validate message schema và version; reject command không hợp lệ / chứa secret (non-retryable).
3. Resolve runtime delivery data qua private interface của `transactional-mail`.
4. Kiểm tra delivery còn eligible (chưa terminal ở control plane).
5. Thực hiện mail delivery qua provider (relay); phân loại kết quả theo error matrix.
6. Retry các lỗi retryable; ghi và dùng job state trên D1 `mail-job`.
7. Báo outcome cho control plane qua private interface.
8. Ack hoặc retry từng Queue message theo outcome của chính nó.

### 2.2. Ngoài phạm vi

Worker không chịu trách nhiệm: render template / chọn template · quyết định recipient (chỉ nhận qua runtime material) · chọn provider (single relay do control plane materialize — provider thật chưa chốt) · quản lý secret/credential (control plane giữ và decrypt) · đọc/ghi D1 `mail` của control plane · business logic của application.

---

## 3. Worker Boundary

Ranh giới của worker là một Mail Command cụ thể (`delivery_id`). Queue message chứa quyết định của control plane. Worker coi các trường sau là immutable: `delivery_id`, `message_id`, `app`, `template`, `payload` (subject, body) — không thay đổi chúng để tìm delivery khác.

---

## 4. Mail Command contract

- Contract mirror của control plane — shape đầy đủ ở `docs/services/transactional-mail/01-architecture.md` §5; required fields của consumer ở [`02-requirements.md`](./02-requirements.md) FR-002.
- `version` bắt buộc — command `version !== 1` bị reject `unsupported-version` (non-retryable).
- Command chứa nội dung **đã render**; worker không render lại.
- Command KHÔNG được chứa `recipient`, credential, token, secret: danh sách key cấm mirror từ control plane; command lọt key cấm bị reject `forbidden-field` (non-retryable) — kiểm tra trước khi chạm provider hay D1.
- Kích thước trong giới hạn Queue message (`docs/overview/04-platform-facts.md` QU6) — control plane đã chặn payload vượt ngưỡng từ trước.

---

## 5. Runtime resolution và delivery runtime

Queue chỉ tham chiếu `delivery_id`. Worker resolve runtime material qua private interface của `transactional-mail` (Service Binding `TRANSACTIONAL_MAIL_SERVICE`):

```text
Queue → delivery_id → GET /internal/deliveries/:delivery_id → { message, provider }
```

- Worker được phép nhận: message status, recipient, subject/body render, provider endpoint + credential.
- Interface là **delivery lookup**, không phải routing API — worker không dùng để khám phá delivery khác.
- `transactional-mailer-job` **không truy cập D1 `mail`** — mọi control plane data đi qua private interface; worker có D1 riêng (`mail-job`) cho job state (§7).
- Credential chỉ được trả cho trusted worker qua private channel (header principal `svc.transactional-mailer-job`); credential không bao giờ nằm trong Queue.

---

## 6. Delivery lifecycle

```text
Queue Message
     │
     ▼
Validate (version, schema, forbidden keys)
     │
     ▼
Resolve Runtime (private interface)
+ Check Eligibility (message chưa terminal ở control plane?)
     │
     ▼
Upsert job processing (attempts++)
     │
     ▼
Send (provider/relay)
     │
     ├── ok ---------> mark sent → báo outcome → ack
     ├── retryable --> retry()  (attempts đã tăng; redelivery idempotent)
     ├── permanent ---> mark failed → báo outcome → ack
     └── credential --> mark failed (credential) → báo outcome → ack
```

Worker chỉ ack sau khi outcome đã persist (hoặc delivery đã vào retry path). D1 ghi lỗi → `retry()`, không ack.

---

## 7. State ownership (D1 `mail-job`)

Hai tầng state, hai owner:

| Tầng            | Owner                      | Lưu ở đâu                     | Vai trò                                                          |
| --------------- | -------------------------- | ----------------------------- | ---------------------------------------------------------------- |
| Logical message | `transactional-mail`       | D1 `mail` (qua private API)   | Trạng thái đúng của thư: `accepted/queued/sent/failed`           |
| Job execution   | `transactional-mailer-job` | D1 `mail-job` (binding riêng) | Việc đã làm: attempt, outcome, delivery nào đã xử lý, marker ack |

Trường chính của `mail_jobs`: `delivery_id` (PK — idempotency key cấp logical delivery) · `message_id` · `status` (`processing|sent|failed`) · `attempts` · `last_error` · `last_error_class` · `outcome_reported` · timestamps; index `(status, updated_at)`.

- D1 `mail-job` là authoritative cho job state — không phải KV, không phải memory Worker.
- D1 `mail-job` **không** chứa logical message state, recipient hay nội dung thư.
- Queue không phải source of truth: message mất trong retention được tìm lại bằng reconciliation trên D1 `mail-job` (chưa chốt — [`03-operations.md`](./03-operations.md) §10).
- Mọi ghi qua `db.batch()` (platform behavior → `docs/overview/04-platform-facts.md` DB2; D1 transaction tương tác chưa xác minh → `docs/overview/01-architecture.md` §10).

---

## 8. Delivery Eligibility

Worker kiểm tra delivery còn eligible trước khi gọi provider:

- message ở control plane đã `sent`/`failed` → **không gửi lại**: đồng bộ job terminal, ack (hoặc báo nốt outcome nếu marker chưa ghi — crash window).
- delivery không tồn tại (`404`) → ghi job `failed` (`delivery-not-found`), báo control plane, ack (không retry).
- Provider endpoint không cấu hình → `provider-not-configured` (credential-class), ghi failed, ack.

Không có reroute: single relay được materialize bởi control plane.

---

## 9. Idempotency

`delivery_id` là idempotency key → logical delivery idempotency: `same delivery_id → same logical delivery`.

### 9.1. Logical idempotency ≠ external exactly-once

Crash window được chấp nhận: provider accepted → worker crash trước khi persist `sent` → Queue retry → duplicate external mail có thể xảy ra. Worker chỉ đảm bảo: không tạo logical delivery mới; state transition không lặp sai. Client có thể dùng correlation/`message_id` để dedupe UX về sau.

### 9.2. Duplicate handling

```text
getJob(delivery_id)
    ↓
job terminal?
    ↓
outcome_reported = 1 → ack (không gửi lại, không báo)
outcome_reported = 0 → báo nốt outcome (crash window) → mark → ack
job processing (chưa terminal) → continue (attempts++)
```

Race giữa hai executions cùng `delivery_id` xử lý bằng conditional UPDATE trên `attempts`/`status` đã đọc (optimistic) — execution thua đứng ngoài.

---

## 10. Retry model

Retry điều khiển bởi **error matrix** — bảng phân loại canonical ở [`03-operations.md`](./03-operations.md) §3. Quy tắc thiết kế:

- Hai loại failure không retry: **permanent** (payload/policy) và **credential** (`401/403`) — credential fail là provider-level issue; xử lý ở control plane (rotate credential, cấu hình endpoint), không retry delivery, không đổi provider.
- Retry bounded theo `max_retries` của Queue consumer + backoff; hết retry mà không có DLQ thì message bị xoá (`docs/overview/04-platform-facts.md` QU2/QU3) — DLQ `ecoma-mail-delivery-dlq` là bắt buộc (config → `03-operations.md` §2).
- **Per-message processing:** mỗi Queue message xử lý độc lập — một message fail KHÔNG force retry message khác trong cùng batch; dùng `ack()`/`retry()` per message, không `ackAll()`/`retryAll()`.
- D1 ghi lỗi hoặc runtime API lỗi tạm thời → `retry()`, không ack khi state chưa persist.
- **Timeout và concurrency:** external provider request có timeout hữu hạn (mặc định 10 s); timeout phân loại `retryable` (network) — không giữ Queue message processing vô hạn. Consumer xử lý tuần tự từng message trong batch; giới hạn batch/consumer duration → `docs/overview/04-platform-facts.md` QU4/QU6. Mỗi execution độc lập theo `delivery_id`; concurrency không phá idempotency nhờ conditional UPDATE trên D1 `mail-job`.

---

## 11. Provider Handling

Provider identity của delivery do control plane quyết định; worker không suy luận provider từ recipient hostname hay tham số nào khác.

- Worker gọi provider qua adapter (hiện là HTTP relay placeholder) dùng endpoint + credential từ runtime material.
- Endpoint chưa cấu hình → `provider-not-configured` (credential-class) — không retry vô hạn.
- Provider thật chưa chốt; khi chốt chỉ thay adapter, giữ nguyên contract phía consumer.

---

## 12. Failure Isolation

Failure của một delivery không fail cả batch (per-message ack/retry). Failure của provider không mất các delivery khác. Failure tạm thời của runtime API → retry theo policy, không tìm alternate route.

---

## 13. Security và observability boundary

Worker là trusted delivery component — có quyền: đọc runtime material, dùng provider credential, báo outcome. Không có quyền: tạo message, thay đổi template, đổi recipient, truy cập D1 khác, truy cập admin configuration.

Credential phải: không xuất hiện trong Queue/DLQ/log/error message; chỉ decrypt ở control plane, worker nhận credential đã sẵn sàng dùng.

Log chỉ qua whitelist field (`delivery_id`, `message_id`, `app`, template name/version, job status, attempts, outcome, error class/code). **Recipient, subject/body render, endpoint, credential không bao giờ được log.** Metric và alert → `03-operations.md` §8.

---

## 14. Architectural Invariants

1. Worker chỉ xử lý `Mail Command` version hiện tại; version khác bị reject `unsupported-version`.
2. Worker không render lại, không reroute, không đổi recipient.
3. `delivery_id` là idempotency key ở logical state; external exactly-once không được guarantee (§9.1).
4. Queue command không chứa secret/recipient/credential.
5. Worker không truy cập D1 `mail` hay D1 service khác — chỉ dùng D1 `mail-job`.
6. Runtime data resolve từ private interface; interface là delivery lookup, không phải routing API.
7. Retry theo error matrix (`03-operations.md` §3); `401/403` là credential-class, không retry.
8. D1 ghi lỗi → `retry()`, không ack.
9. Duplicate Queue message không tạo duplicate logical delivery; job terminal → không gửi lại.
10. Per-message ack/retry; một message fail không retry cả batch.
11. Secret không xuất hiện trong Queue/DLQ/log.
12. Worker có timeout hữu hạn cho external request.
