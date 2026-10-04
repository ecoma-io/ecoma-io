# Transactional Mail Operations

## 1. Runtime

`transactional-mail` là Cloudflare Worker nội bộ (không hostname riêng); thiết kế → [`01-architecture.md`](./01-architecture.md).

```text
transactional-mail
├── Cloudflare Worker
├── Cloudflare D1 `mail`
└── Cloudflare Queue producer `ecoma-mail-delivery`
```

- D1 `mail` là domain state duy nhất của service (owner: control plane). Không path nào từ service khác tới D1 `mail`; delivery worker truy cập qua private interface (Service Binding `TRANSACTIONAL_MAIL_SERVICE`).
- Migration D1 bằng `wrangler d1 migrations` (chạy theo track D1 trong `docs/overview/02-delivery.md` §3). D1 **không** thuộc Backup/DR scope — dữ liệu có thể mất, service recover ở mức service; chính sách → `docs/overview/03-operations.md` §3.1.

---

## 2. Deployment

Deployment của Worker phải đi kèm (theo `wrangler.jsonc`):

- D1 binding `mail` (`database_name: mail`) — `database_id` được điền sau `wrangler d1 create mail`.
- Queue producer `ecoma-mail-delivery` (binding `QUEUE`).
- Worker Secret `MAIL_PROVIDER_TOKEN` — credential của mail relay; `MAIL_PROVIDER_ENDPOINT` là biến thường (không phải secret).
- Observability enabled.

Kiểm tra sau deploy:

```text
GET /health → { service: 'transactional-mail', status: 'ok', time }
```

Test smoke: tạo message với app thật → assert `201` → đợi outbox publish → assert message `queued`/`sent` theo delivery worker.

Rollback theo Worker version đã publish, không rollback D1 — `docs/overview/02-delivery.md` §7–§8.

---

## 3. Configuration

| Biến/Binding             | Kiểu          | Mô tả                                                                    |
| ------------------------ | ------------- | ------------------------------------------------------------------------ |
| D1 `mail`                | binding       | Domain state của service.                                                |
| Queue producer `QUEUE`   | binding       | Queue `ecoma-mail-delivery` — chỉ Outbox Publisher được send.            |
| `MAIL_PROVIDER_ENDPOINT` | biến          | Endpoint của mail relay (trả cho delivery worker qua private interface). |
| `MAIL_PROVIDER_TOKEN`    | Worker Secret | Credential của relay — không bao giờ vào Queue/log.                      |

Sensitive configuration không được lưu trong source.

---

## 4. Queue Configuration (producer side)

Control plane là producer; consumer cấu hình ở `docs/services/transactional-mailer-job/03-operations.md`. Điều cần giữ ở phía này:

- Ngưỡng render payload dưới giới hạn Queue message (`docs/overview/04-platform-facts.md` QU6) — vượt → `413` trước khi enqueue.
- At-least-once (`docs/overview/04-platform-facts.md` QU1): duplicate publish là expected, consumer idempotent theo `delivery_id`.
- Command có `version` (hiện = 1).

Consumer/delivery worker báo outcome xuyên private interface; control plane **không** thực hiện retry delivery.

---

## 5. Outbox Operations

### 5.1. Publish

Trigger: `POST /internal/outbox/publish` (cơ chế cron/relay chưa chốt — `docs/overview/01-architecture.md` §10). Mỗi lần chạy:

```text
claim ≤ limit (mặc định 10) item pending + reclaim item publishing quá lease
per item: buildMailCommand từ message → QUEUE.send
thành công → batch: outbox published + message queued
thất bại → attempts++, available_at += backoff * 2^(attempts-1); hết attempts → failed
```

### 5.2. Duplicate publish safe

Cùng delivery_id được claim lại (crash) → gửi lại command với cùng delivery_id → consumer idempotent. Không cần dedupe phía publisher.

### 5.3. Outbox backlog / outbox không chạy

Nếu message `accepted` lâu nhưng không sang `queued`, kiểm tra:

```text
1. outbox có item pending chưa tới available_at không → publisher đang chạy?
2. Outbox có item published nhưng message chưa queued không (data lệch)
3. QUEUE.send lỗi liên tục → last_error → relay/Queue
4. item failed hết attempts → cần replay hoặc xử lý tay (5.4)
```

Reconcile theo `D1 mail_outbox` — cơ chế tự động chưa chốt (`docs/overview/03-operations.md` §10); hiện publish thủ công/nội bộ.

### 5.4. Replay / Data Repair

- **Outbox item `failed`**: điều tra `last_error`; khi nguyên nhân hết, reset item (`status=pending, attempts=0, available_at=now`) — repair thủ công tạm thời; Admin tooling chưa chốt (mục 10).
- **Message đã `sent` rồi**: không tạo outbox mới — consumer idempotent theo `delivery_id`, không gửi lại.

---

## 6. Observability

- Log chỉ chứa whitelisted fields (event, route, method, status, app, principal_id, message_id, delivery_id, trạng thái message/outbox, error_code...). **Recipient, subject/body render, credential không bao giờ được log.** Quy tắc chung (trace, privacy, retention) → `docs/overview/03-operations.md` §4.
- Metrics (đề xuất): `messages_created` (theo app) · `messages_created_idempotent_replay` · `outbox_claimed` · `outbox_published` · `outbox_failed` · `outbox_stuck_over_lease` · `queue_send_errors` · `template_not_found`.
- Dashboards (đề xuất): outbox backlog (pending quá hạn `available_at`) · outbox stuck (publishing vượt lease) · tỉ lệ idle→queued chậm · lỗi template/render (4xx/413).

---

## 7. Alerting

| Điều kiện                                         | Mức     | Ý nghĩa                                                                                |
| ------------------------------------------------- | ------- | -------------------------------------------------------------------------------------- |
| Outbox pending tăng liên tục / pending không giảm | Warning | Publisher không chạy hoặc `QUEUE.send` lỗi                                             |
| Outbox `failed` > 0                               | Page    | Dữ liệu đang chết — item không bao giờ vào Queue (`docs/overview/03-operations.md` §5) |
| Outbox publishing vượt lease thường xuyên         | Warning | Publisher crash giữa chừng (reclaim hoạt động nhưng tần suất cao)                      |
| 4xx rate tăng (template/render/validation)        | Warning | Contract gọi sai hoặc template thiếu                                                   |
| D1 không ghi được                                 | Page    | Toàn bộ create message lỗi — xem log error                                             |

Không alert theo một message failure đơn lẻ; aggregate theo `app`.

---

## 8. Common Failure Modes

### 8.1. Create message lỗi (5xx)

Kiểm tra: D1 up? Lỗi batch rollback? Statement vượt giới hạn (`docs/overview/04-platform-facts.md` DB4)? migration schema chưa chạy?

### 8.2. Message `accepted` mãi, không `queued`

Đi theo mục 5.3 (outbox). Thường: publisher không chạy (trigger chưa chốt) hoặc `QUEUE.send` fail liên tục.

### 8.3. Message `queued` mãi không `sent`

Delivery worker xử lý — `docs/services/transactional-mailer-job/03-operations.md`. Control plane chỉ thấy qua private interface.

### 8.4. Idempotent replay trả khác nhau

Kiểm tra `Idempotency-Key` đúng key; chỉ request cùng `app` được dedupe. Header `X-ECOMA-PRINCIPAL`/`X-ECOMA-APP` phải ổn định giữa các request của cùng client.

---

## 9. Disaster Recovery

- D1 `mail` — authority duy nhất của service — **không** thuộc Backup/DR scope: chính sách → `docs/overview/03-operations.md` §3.1; service recover ở mức service. Không backup/restore D1 của service khác.
- Worker runtime phải disposable: mất instance không mất domain state.
- ⚠️ Message mất do Queue retention (giới hạn → `docs/overview/04-platform-facts.md` QU5) không nằm trong cửa sổ recover từ D1: việc đã enqueue mất nhưng domain state còn; xử lý theo reconciliation (chưa chốt — `docs/overview/03-operations.md` §10).

---

## 10. Capacity Management

Capacity điều chỉnh theo:

- Kích thước Queue message và tốc độ publisher claim (`docs/overview/04-platform-facts.md` QU6).
- Tăng trưởng `mail_messages`/`mail_outbox` so với giới hạn D1 (`docs/overview/04-platform-facts.md` DB4).
- Consumer throughput của `transactional-mailer-job` (provider rate limit).

Không dùng raw request rate của application làm sole scaling signal.

---

## 11. Operational Invariants

1. Rollback/restart an toàn nhờ idempotency — cùng `delivery_id` không tạo logical delivery mới.
2. Worker version mới phải consume được Queue command version hiện tại (contract `version`).
3. Mỗi outbox item publish chỉ sau claim; duplicate publish an toàn, không dedupe phía publisher.
4. Secret/recipient không xuất hiện trong Queue/log/DLQ — kiểm tra định kỳ bằng log sample.

Architectural invariants (D1 authority, request path, isolation) → [`01-architecture.md`](./01-architecture.md) §8.
