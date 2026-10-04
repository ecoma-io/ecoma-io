# Transactional Mailer Job Requirements

## 1. Mục đích

Yêu cầu chức năng, phi chức năng, bảo mật và constraint của `transactional-mailer-job`. Design → [`01-architecture.md`](./01-architecture.md); runbook và config → [`03-operations.md`](./03-operations.md).

---

# 2. Functional Requirements

## FR-001 — Consume Mail Command

Worker MUST consume Mail Command từ Queue `ecoma-mail-delivery` (bounded retry + DLQ — config: `docs/services/transactional-mailer-job/03-operations.md` §2). Command có `version`; chỉ `version = 1` được xử lý.

### Acceptance Criteria

- Command hợp lệ được xử lý end-to-end (send → report → ack).
- Command `version ≠ 1` bị reject `unsupported-version`, **không gọi provider**, ghi job `failed`, ack.
- Body không parse được (không có `delivery_id`) → ack (không retry, không ghi được state).

---

## FR-002 — Validate Mail Command

Command phải có: `delivery_id`, `message_id`, `app`, `template.{name,version,locale}`, `payload.{subject,body}`, `created_at`. Command KHÔNG được chứa key cấm (danh sách mirror từ control plane).

### Acceptance Criteria

- Thiếu trường bắt buộc → `invalid-command`, ack.
- Có key cấm (`secret`, `token`, `recipient`, `api_key`...) → `forbidden-field`, ack; log chỉ tên trường, không log giá trị.
- Cả hai đều không gọi provider.

---

## FR-003 — Runtime Resolution

Worker MUST resolve runtime material qua private Service Binding `TRANSACTIONAL_MAIL_SERVICE` (`GET /internal/deliveries/:delivery_id`) trước khi gọi provider.

### Acceptance Criteria

- Delivery tồn tại → nhận `{ message, provider }` (recipient, subject, body, endpoint, credential).
- Delivery không tồn tại (`404`) → ghi job `failed` (`delivery-not-found`), ack.
- Control plane unavailable (fetch lỗi / 5xx / 403) → `retry()` (không ack, không gọi provider).

---

## FR-004 — Eligibility

Worker MUST NOT gửi lại delivery mà control plane đã đánh `sent`/`failed`.

### Acceptance Criteria

- Message đã terminal ở control plane → đồng bộ job terminal, ack, không gọi provider.
- Job terminal + `outcome_reported = 0` → báo nốt outcome (crash window) → mark → ack.

---

## FR-005 — Delivery qua Provider

Worker MUST gọi provider với runtime material, và lưu attempt vào D1 `mail-job`.

### Acceptance Criteria

- Provider success (`2xx`) → mark job `sent`, báo outcome `sent`, ack.
- Provider `429`/`5xx`/network/timeout → ghi `last_error` (`retryable`), `retry()`.
- Provider `401`/`403` → mark job `failed` (`credential`), báo outcome `failed/credential`, ack — **không retry**.
- Provider 4xx khác → mark job `failed` (`permanent`), báo outcome, ack — không retry.
- Endpoint chưa cấu hình → mark job `failed` (`provider-not-configured`, credential-class), ack.

---

## FR-006 — Job State (D1 `mail-job`)

Worker MUST ghi job execution state vào D1 riêng: insert `processing` (attempts = 1), increment attempts trên redelivery (đúng với row đã đọc), ghi `last_error`, chuyển `sent`/`failed`, đánh dấu `outcome_reported`.

### Acceptance Criteria

- Mỗi message mới → 1 job row, attempts = 1.
- Redelivery (cùng `delivery_id`, không terminal) → attempts++.
- D1 ghi lỗi ở BẤT KỲ bước nào → `retry()`, **không ack**.

---

## FR-007 — Báo Outcome cho Control Plane

Worker MUST báo kết quả qua `POST /internal/deliveries/:delivery_id/outcome`.

### Acceptance Criteria

- Path success: report `sent` → mark `outcome_reported = 1` → ack.
- Path failed: report `failed` + `error_class` → mark → ack.
- Report lỗi (unavailable) → `retry()`.
- Report `404` (message biến mất) → log error, ack (không retry được).

---

## FR-008 — Duplicate Message

Worker MUST xử lý duplicate an toàn theo `delivery_id`.

### Acceptance Criteria

- Duplicate message, job đã terminal, `outcome_reported = 1` → ack, không gửi lại.
- Duplicate message, job `sent` nhưng outcome chưa báo → báo nốt, ack.
- Duplicate message không được tạo duplicate logical delivery.

---

# 3. Non-Functional Requirements

## NFR-001 — Per-message ack/retry

Một message fail MUST NOT force retry các message khác trong cùng batch — dùng `ack()`/`retry()` per message.

### Acceptance Criteria

- Fail message A (retryable) → A `retry()`, B `ack()` bình thường.

---

## NFR-002 — Không secret/recipient trong log

Recipient, subject/body, endpoint, credential MUST NOT xuất hiện trong log ở bất kỳ đường nào (thành công hay lỗi) — log qua whitelist field.

### Acceptance Criteria

- Không log sentinel recipient/credential/subject trên path success và path provider failure.
- Command chứa secret bị reject → log không có giá trị secret.

---

## NFR-003 — At-least-once + idempotency

Queue là at-least-once (`docs/overview/04-platform-facts.md` QU1); worker idempotent theo `delivery_id`. Crash window (provider đã nhận, chưa persist) được chấp nhận — duplicate external mail có thể xảy ra (`docs/services/transactional-mailer-job/01-architecture.md` §9.1).

### Acceptance Criteria

- Redelivery cùng `delivery_id` không gửi lại.
- Redelivery khi job còn `processing` → attempts++ và tiếp tục.

---

## NFR-004 — Bounded retry

Retry bounded theo `max_retries` rồi vào DLQ (`docs/overview/04-platform-facts.md` QU2/QU3). Không retry vô hạn.

### Acceptance Criteria

- Retry path chỉ qua `message.retry()`; DLQ nối cho consumer.
- Lỗi permanent/credential không bao giờ đi vào retry loop.

---

# 4. Security Requirements

## SR-001 — Không truy cập D1 của service khác

Worker MUST NOT đọc/ghi D1 `mail` hay database khác. Mọi control plane data đi qua `TRANSACTIONAL_MAIL_SERVICE`.

### Acceptance Criteria

- Không có binding nào tới `mail`; chỉ có D1 `mail-job`.

---

## SR-002 — Command không chứa secret

Command lọt key cấm bị reject trước khi chạm provider hay D1. Credential chỉ đến từ runtime material qua private interface.

### Acceptance Criteria

- Command chứa key secret/api_key → reject, provider không được gọi.
- Danh sách key cấm mirror danh sách phía control plane.

---

## SR-003 — Timeout hữu hạn

External request MUST có timeout hữu hạn (mặc định 10 s); timeout phân loại `retryable`.

### Acceptance Criteria

- Mọi provider request có timeout cấu hình được.
- Timeout không giữ Queue message vô hạn.

---

# 5. Constraints

## CR-001 — Không thêm runtime dependency

Chạy với dependency repo hiện có, đúng runtime `runtime:edge` (taxonomy → `docs/overview/05-code-architecture.md`).

### Acceptance Criteria

- Không runtime dependency mới.
- Không import Node builtin.

---

## CR-002 — Platform limits

Job phải vận hành trong giới hạn platform: Queue batch/ack semantics (`docs/overview/04-platform-facts.md` QU4), D1 statement/parameter (DB4), consumer duration (QU6). Giới hạn chi tiết → overview; service chỉ cần bảo đảm per-message ack và job state ghi được trong budget đó.

---

# 6. Non-goals

Các boundary ngoài phạm vi worker (canonical ở [`01-architecture.md`](./01-architecture.md) §2.2): không render template · không quyết định recipient (chỉ nhận qua runtime material) · không chọn/reroute provider (single relay do control plane materialize — provider thật chưa chốt) · không quản lý secret/credential · không đọc/ghi D1 `mail` · không business logic của application.
