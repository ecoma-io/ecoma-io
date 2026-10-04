# Transactional Mail Requirements

## 1. Phạm vi

Tài liệu này định nghĩa yêu cầu chức năng/phi chức năng, security requirement, constraint và non-goals của `transactional-mail` — control plane tiếp nhận yêu cầu gửi mail, render template, lưu domain state vào D1 `mail` và enqueue delivery qua transactional outbox.

Thiết kế → [`01-architecture.md`](./01-architecture.md) · vận hành → [`03-operations.md`](./03-operations.md).

---

# 2. Functional Requirements

## FR-001 — Tạo Mail Message

Service MUST cung cấp `POST /v1/messages` để application tạo message.

Request cần: `template`, `recipient`, `locale` (optional), `variables` (optional), `correlation_id` (optional). `app` và `principal_id` lấy từ principal header — **không bao giờ từ body**.

Service MUST trả `201` khi tạo mới, `200` khi replay idempotent (cùng `app` + `Idempotency-Key`).

### Acceptance Criteria

- Request hợp lệ trả `201` kèm `{ id, delivery_id, app, template, status, created, created_at }`.
- Replay cùng key + cùng app trả `200` kèm message cũ, không tạo outbox mới.
- `app` truyền trong body bị bỏ qua; `app`/`principal_id` luôn từ header.
- Template không active/không tồn tại trả `404`.

---

## FR-002 — Principal và Idempotency

Service MUST xác thực principal từ `X-ECOMA-PRINCIPAL` + `X-ECOMA-APP` (pattern `svc.<name>`). Request thiếu principal → `401`.

Service MUST dùng `Idempotency-Key` làm idempotency key. Key bắt buộc, ≤ 128 ký tự. Replay cùng `(app, key)` trả message cũ.

### Acceptance Criteria

- Thiếu principal/app → `401`.
- Principal sai định dạng → `401`.
- Thiếu `Idempotency-Key` → `400`.
- Replay → không duplicate domain row, không duplicate outbox row.

---

## FR-003 — Render từ Template

Service MUST chọn template `active` theo `(name, locale)` (default locale `en`) và render `{{ variable }}` từ `variables`.

Payload render phải nằm dưới ngưỡng an toàn của service — đặt nhỏ hơn giới hạn Queue message (`docs/overview/04-platform-facts.md` QU6).

### Acceptance Criteria

- Variable thiếu trong request khi render → chuỗi rỗng (không crash).
- Render vượt ngưỡng → `413` trước khi ghi.
- `variables` ≤ 50 key, key khớp `^[a-zA-Z0-9_]{1,64}$`, value primitive ≤ 10000 ký tự.

---

## FR-004 — Outbox (transactional outbox)

Domain row và outbox row MUST được ghi trong **một** `db.batch()`.

Outbox state machine: `pending → publishing → published | failed`, có `attempts`, `available_at`, `claimed_at`, `claimed_by`, `last_error` (thiết kế → [`01-architecture.md`](./01-architecture.md) §6).

### Acceptance Criteria

- Domain + outbox nằm cùng batch — một statement fail → toàn bộ rollback.
- Claim dùng `WHERE status = 'pending'` — một publisher thắng mỗi item.
- Lease quá hạn (`claimed_at < now - leaseMs`) được reclaim.
- `QUEUE.send` thất bại → item về `pending`, `attempts++`, `available_at` lùi theo backoff; hết attempts → `failed`.
- Publish thành công → outbox `published`, message `queued`, trong một batch.

---

## FR-005 — Private Delivery Interface

Service MUST cung cấp cho `transactional-mailer-job`:

`GET /internal/deliveries/:delivery_id` → runtime material (recipient, subject, body, provider endpoint + credential) và `POST /internal/deliveries/:delivery_id/outcome` → `{ outcome: 'sent' | 'failed', error_class? }`.

Interface là delivery lookup, không phải routing API; principal khác → `403`.

### Acceptance Criteria

- Caller principal `svc.transactional-mailer-job` được đọc runtime/ghi outcome.
- Principal khác → `403`.
- Delivery tồn tại → runtime material đúng; không tồn tại → `404`.
- Outcome không hợp lệ → `400`; outcome lặp khi đã terminal → `{ updated: false }` (idempotent).
- Outcome ghi với guard trạng thái đọc được — không ghi đè outcome đến sau.

---

# 3. Non-Functional Requirements

## NFR-001 — Không secret trong Queue/log

Recipient, subject/body và provider credential MUST NOT xuất hiện trong: Mail Command trên Queue, DLQ, log, error response.

Command chỉ chứa delivery intent đã render theo danh sách key cấm (contract). Log chỉ chứa whitelisted fields.

### Acceptance Criteria

- Contract test serialize command: assert không có key cấm, không có recipient/credential/token.
- Log chỉ chứa whitelisted fields; không trường nào chứa recipient/subject/credential.

---

## NFR-002 — At-least-once và idempotency

Mail Command trên Queue được giao **at-least-once** (`docs/overview/04-platform-facts.md` QU1). Consumer idempotent theo `delivery_id`; replay cùng delivery không tạo logical delivery mới.

### Acceptance Criteria

- Duplicate publish (cùng delivery_id) tới Queue an toàn.
- Duplicate message tới worker không gửi lại (kiểm tra ở `docs/services/transactional-mailer-job/`).
- Crash window (worker nhận được nhưng chưa ack) được chấp nhận trong design.

---

## NFR-003 — Transaction qua `db.batch()`

Không dùng transaction tương tác. Mọi thao tác ghi đi qua `db.batch()` (transaction tương tác D1 chưa xác minh — `docs/overview/01-architecture.md` §10).

### Acceptance Criteria

- Mọi thao tác ghi của service đều nằm trong `batch()` — không có ghi ngoài batch.
- Batch fail → rollback toàn bộ, không ghi nửa batch.

---

# 4. Security Requirements

## SR-001 — Principal không tới từ body

`app` và `principal_id` MUST đến từ authenticated principal. Body chỉ mang nghiệp vụ (`template`, `recipient`, `variables`...).

### Acceptance Criteria

- Body có chứa `app` khác → bị bỏ qua, không ảnh hưởng ghi nhận.

---

## SR-002 — Cô lập giữa các app

Message thuộc đúng `app` của principal. `GET /v1/messages/:id` của app khác → `404`.

### Acceptance Criteria

- Principal app A không đọc được message của app B.
- `GET` trả thông tin tối thiểu (không kèm recipient/payload khi không cần).

---

## SR-003 — Migration an toàn

Schema D1 `mail` thay đổi theo expand → compatible rollout → contract, không down-migrate (`docs/overview/01-architecture.md` invariant 10; track D1 → `docs/overview/02-delivery.md` §3). Không service khác truy cập D1 `mail` (`docs/overview/01-architecture.md` invariant 7).

---

# 5. Constraints

## CR-001 — Không thêm dependency

Service phải chạy với dependency hiện có của repo; không bổ sung runtime dependency mới.

### Acceptance Criteria

- Không có thêm package nào trong dependencies của app.

---

## CR-002 — Giới hạn platform

- Render payload vượt ngưỡng service → `413` trước khi enqueue; ngưỡng dưới giới hạn Queue message (`docs/overview/04-platform-facts.md` QU6).
- Ghi D1 phải nằm trong giới hạn statement/bound parameter/row size và số query mỗi invocation (`docs/overview/04-platform-facts.md` DB4) — ghi theo batch, không loop từng row.

---

# 6. Non-goals

- Không yêu cầu gọi provider, retry hay delivery quota — thuộc `docs/services/transactional-mailer-job/`.
- Không yêu cầu template admin CRUD (hiện seed; chưa chốt → [`01-architecture.md`](./01-architecture.md) §10).
- Không yêu cầu chọn provider/relay (chưa chốt → [`01-architecture.md`](./01-architecture.md) §10).
- Không yêu cầu backup/restore D1 `mail` — chính sách → `docs/overview/03-operations.md` §3.1.
- Ranh giới trách nhiệm đầy đủ → [`01-architecture.md`](./01-architecture.md) §2.2.
