# Transactional Mail Architecture

> **Phạm vi:** purpose, boundary, domain model, outbox design, private interface, invariants của `transactional-mail`.
> Requirement → [`02-requirements.md`](./02-requirements.md) · vận hành → [`03-operations.md`](./03-operations.md) · delivery plane → `docs/services/transactional-mailer-job/` · system-wide policy → `docs/overview/`.

## 1. Mục đích

`transactional-mail` là control plane của mail bounded context: tiếp nhận yêu cầu gửi mail từ application, render message từ template, lưu domain state vào D1 `mail` và đưa việc giao vào Cloudflare Queue thông qua **transactional outbox** (`docs/overview/03-operations.md` §11.4).

```text
transactional-mail
├── Cloudflare Worker (internal API, không hostname riêng)
├── Cloudflare D1 `mail`
└── Cloudflare Queue producer `ecoma-mail-delivery`
```

```text
Application
    ↓ POST /v1/messages
transactional-mail ──── D1 `mail`
    ↓ Outbox Publisher
Cloudflare Queue
    ↓
transactional-mailer-job ──── private interface
```

Worker **KHÔNG** thực hiện mail delivery: provider delivery thuộc `transactional-mailer-job`. Quyết định gửi cho ai, template nào được materialize tại control plane và đóng vào Mail Command; worker chỉ việc giao.

Binding/runtime resource: D1 `mail`, Queue producer `ecoma-mail-delivery`, Service Binding `TRANSACTIONAL_MAIL_SERVICE` (delivery worker trỏ tới worker này).

---

## 2. Phạm vi

### 2.1. Trong phạm vi

1. Tiếp nhận `Create Message Request` từ application.
2. Xác thực principal và idempotency key.
3. Chọn template active theo `(name, locale)`.
4. Render subject/body từ template + variables.
5. Tạo `Mail Message` + `Outbox Item` trong **một** `db.batch()` (transactional outbox).
6. Publish Mail Command sang Queue qua Outbox Publisher (không trong request path).
7. Cung cấp private delivery interface cho delivery worker.

### 2.2. Ngoài phạm vi

Worker không chịu trách nhiệm: gọi mail relay/provider (thuộc delivery worker) · retry/delivery quota · template CRUD (Admin API chưa có — Chưa chốt) · chọn provider (single relay, Chưa chốt) · đọc/ghi D1 của service khác · state của delivery worker (`transactional-mailer-job` có D1 `mail-job` riêng).

---

## 3. Worker Boundary

Ranh giới của worker là một `Create Message Request` ứng với một `Mail Message`. Sau khi message được ghi (request path), mọi bước tiếp theo đều đi qua Outbox:

```text
Create Message Request
    → Validate (principal + idempotency)
    → Select Template (active) → Render payload
    → db.batch([INSERT message, INSERT outbox])   ← MỘT transaction
    → Outbox Publisher (không nằm trong request path)
    → Cloudflare Queue
```

---

## 4. Domain Model

Quy ước thời gian: mọi cột `*_at` là epoch milliseconds (UTC). Chi tiết schema → migration files; dưới đây là thiết kế level.

### 4.1. `mail_templates`

Bản khai báo template: `id`, `name`, `locale` (default `en`), `version`, `subject_template`, `body_template`, `status` (`active`/`disabled`), timestamps; `UNIQUE (name, locale, version)`.

- Template chỉ được chọn khi `status = active`.
- CRUD template (Admin API) chưa chốt; schema hỗ trợ versioning, service hoạt động với template seed.

### 4.2. `mail_messages`

Lá thư đã render: `id` (`msg_`), `app` (từ principal header), `principal_id`, `template_id`/`template_name`/`template_version`, `locale`, `recipient` (**KHÔNG bao giờ** vào Queue/log), `variables_json`, `subject_rendered`, `body_rendered`, `status` (`accepted → queued → sent | failed`), `delivery_id` (`dlv_`, UNIQUE), `idempotency_key`, `correlation_id`, `failure_reason`, timestamps.

- `delivery_id` là idempotency key cấp logical delivery phía consumer.
- `UNIQUE (app, idempotency_key)` — replay cùng key + cùng app trả về message cũ (200), không tạo outbox mới.

### 4.3. `mail_outbox`

`id` (`obx_`), `delivery_id` (UNIQUE), `status`, `attempts`, `available_at`, `claimed_at`, `claimed_by`, `published_at`, `last_error`, timestamps; index claim theo `(status, available_at)`. State machine và claim → §6.

---

## 5. Delivery Command

Queue message tối thiểu (contract của Queue `ecoma-mail-delivery`):

```json
{
  "version": 1,
  "delivery_id": "dlv_...",
  "message_id": "msg_...",
  "correlation_id": null,
  "app": "ecoma",
  "template": { "name": "welcome", "version": 1, "locale": "en" },
  "payload": {
    "subject": "Welcome An",
    "body": "Hi An, your code is 123456"
  },
  "created_at": 1700000000000
}
```

- `version` bắt buộc để hỗ trợ evolution của Queue contract.
- Command chứa nội dung **đã render** — delivery worker không render lại, không reroute.
- Command KHÔNG chứa: `recipient`, provider credential, token, secret. Danh sách key cấm là contract, assert bằng contract test; consumer reject command lọt key cấm là `forbidden-field` (non-retryable).

---

## 6. Transactional Outbox

### 6.1. Vì sao phải outbox

`D1 commit` và `Queue send` không atomic: ghi domain row rồi send có thể mất message (crash giữa hai bước); send rồi ghi sẽ tạo ghost message. Outbox xếp việc publish thành state, đưa cả hai việc vào transaction của D1 (`db.batch()` — `docs/overview/04-platform-facts.md` DB2): domain row + outbox row cùng một batch — hoặc cả hai, hoặc không cái nào.

### 6.2. State machine

```text
pending ──claim──► publishing ──publish success──► published
   │                     │
   │                     └──publish failure (attempts++)──► pending (backoff)
   │                     └──attempts >= maxAttempts──────► failed
   └──(available_at chưa tới)── chưa được claim
```

- **Claim:** optimistic claim (`WHERE status = 'pending'`) — chỉ một publisher thắng.
- **Lease:** `publishing` nhưng `claimed_at` quá cũ (`now - leaseMs`) bị xem là crashed → reclaim.
- **Publish:** buildMailCommand từ message row → `QUEUE.send()`. Thành công → batch `[outbox → published, message → queued]`; thất bại → `attempts++`, `last_error`, backoff `available_at`, về `pending` (hoặc `failed` nếu hết attempts).
- **Không có network call nào nằm trong `db.batch()`** — chỉ publish sau khi claim; ghi kết quả luôn sau commit của claim.
- Bản chất **at-least-once** (`docs/overview/04-platform-facts.md` QU1): duplicate publish là expected, consumer idempotent theo `delivery_id`.

### 6.3. Trigger

Publish được kích hoạt bởi Outbox Publisher endpoint (`POST /internal/outbox/publish` — có thể gọi từ cron). Cơ chế trigger (cron schedule / Worker relay) chưa chốt → `docs/overview/01-architecture.md` §10; hiện endpoint nội bộ là cơ chế duy nhất.

---

## 7. Private Interface (delivery runtime)

### 7.1. Nhận diện caller

Giữa hai Worker cùng một Cloudflare account, Service Binding không cần token (`docs/overview/01-architecture.md` §5). Worker vẫn giữ lớp kiểm soát tối thiểu: yêu cầu `X-ECOMA-PRINCIPAL = svc.transactional-mailer-job`. Caller khác → `403`.

### 7.2. Interface này là gì

- `GET /internal/deliveries/:delivery_id` → runtime material cho consumer: message (`delivery_id`, `message_id`, `app`, `status`, `recipient`, `subject`, `body`) + provider (`endpoint`, `credential`).
  - `recipient`, `subject`, `body` và provider credential **chỉ** xuất hiện ở đây (không vào Queue, không vào log).
  - `credential` lấy từ Worker Secret `MAIL_PROVIDER_TOKEN` của control plane.
- `POST /internal/deliveries/:delivery_id/outcome` → consumer báo `{ outcome: 'sent' | 'failed', error_class? }`; cập nhật `mail_messages.status` (chỉ `queued → sent | failed`); idempotent — outcome lặp khi message đã terminal trả `{ updated: false }`.

### 7.3. Interface này KHÔNG là gì

- Là **delivery lookup theo `delivery_id`**, không phải routing API — không có tham số khám phá theo `app`/`recipient`/`status` (khớp `docs/services/web-push-notification-job/01-architecture.md` §6).
- Không public: chỉ trusted delivery worker; không expose hostname.

Auth token/mTLS cho kiểm soát chặt hơn: chưa chốt — §10.

---

## 8. Architectural Invariants

1. D1 là source of truth của domain state; Queue không bao giờ là authority (`docs/overview/03-operations.md` §11.4).
2. Mỗi outbox item được claim bởi đúng một publisher (optimistic claim `WHERE status = 'pending'`).
3. `UNIQUE (app, idempotency_key)` bảo vệ replay: cùng key trả message cũ, không tạo outbox mới.
4. Principal lấy từ headers; `app` trong body bị bỏ qua (không bao giờ tin body).
5. Recipient và provider credential không nằm trong Queue command, không nằm trong log, không nằm trong DLQ.
6. Control plane không gọi provider trên request path; publish Queue chỉ xảy ra ở Outbox Publisher sau commit.
7. Không state node-local; không `ctx.waitUntil()` cho correctness write (`docs/overview/01-architecture.md` invariant 12).
8. Không có transaction tương tác (`BEGIN`/`COMMIT`) — chỉ `db.batch()` (`docs/overview/04-platform-facts.md` DB2; transaction tương tác D1 chưa xác minh — `docs/overview/01-architecture.md` §10).
9. Outbox claim và publish luôn sau commit; không network call nào nằm trong `db.batch()`.
10. Không đọc/ghi D1 của service khác (`docs/overview/01-architecture.md` invariant 7); không có path tới PostgreSQL (`docs/overview/01-architecture.md` §1.1).
11. Secret của service không vào Git/PR build/Preview runtime production (`docs/overview/02-delivery.md` §6).

---

## 9. Các quyết định convention-derived (cần xác nhận)

Những cái tên dưới đây suy từ tiền lệ có sẵn trong repo; chưa có quyết định chính thức trong `overview`:

| Mục                                     | Giá trị dùng                        | Suy từ                                     |
| --------------------------------------- | ----------------------------------- | ------------------------------------------ |
| Tên Queue                               | `ecoma-mail-delivery`               | `ecoma-push-delivery` (push-notification)  |
| Tên DLQ                                 | `ecoma-mail-delivery-dlq`           | `ecoma-push-delivery-dlq`                  |
| Binding Queue producer                  | `QUEUE`                             | convention binding chung                   |
| Service Binding                         | `TRANSACTIONAL_MAIL_SERVICE`        | `PUSH_NOTIFICATION_SERVICE` (web-push job) |
| Header principal                        | `X-ECOMA-PRINCIPAL` + `X-ECOMA-APP` | pattern `svc.<name>` common trong repo     |
| Định danh principal của delivery worker | `svc.transactional-mailer-job`      | pattern `svc.<service-name>`               |
| Đường dẫn private interface             | `/internal/...`                     | quy ước `/internal` (không public)         |
| Trigger outbox                          | `POST /internal/outbox/publish`     | chưa có cron — §6.3                        |

## 10. Chưa chốt (service)

| Mục                                     | Ghi chú                                                               |
| --------------------------------------- | --------------------------------------------------------------------- |
| CRUD template (Admin API)               | Chưa có admin surface; hiện template seed                             |
| Auth của private interface (token/mTLS) | Chưa chốt: hiện dựa Service Binding + header principal                |
| Provider/relay thật                     | Hiện là endpoint + Worker Secret của control plane; adapter chưa chốt |

Unresolved system-wide liên quan service → tham chiếu, không liệt kê lại:

- Cơ chế relay/trigger outbox → `docs/overview/01-architecture.md` §10.
- Reconciliation (outbox/job kẹt), retention/quota D1 `mail` → `docs/overview/03-operations.md` §10.
- Contract tooling cho D1 → `docs/overview/02-delivery.md` §12.
