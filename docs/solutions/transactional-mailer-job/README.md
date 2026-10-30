# Transactional Mailer Job

Delivery worker (delivery plane) thực hiện mail delivery cho các `Mail Message` mà `transactional-mail` đã render và enqueue. Worker chỉ thực hiện giao — không render, không chọn template, không quyết định recipient, không chọn provider.

## Runtime / deploy unit

- Cloudflare Worker — không hostname, không HTTP API; Queue consumer của `ecoma-mail-delivery` (Mail Command) và `ecoma-mail-lifecycle-events` (lifecycle ingest, chưa provision Event Subscriptions).
- D1 `mail-job` — job execution state của service; không truy cập D1 `mail` hay D1 của service khác.
- Control plane `transactional-mail` — resolve runtime material và báo outcome qua private Service Binding; credential **không** đi qua private interface, không bao giờ vào Queue/log.
- External: provider mail — v1 là Cloudflare Email Service qua binding `send_email` (cùng account, không credential HTTP); adapter Resend giữ lại làm adapter phụ (endpoint + credential là Worker Secret của chính worker này, không đến từ control plane).

## Documents

- [Architecture](./01-architecture.md) — boundary, lifecycle, state ownership, idempotency, retry model, invariants.
- [Requirements](./02-requirements.md) — FR/NFR/SR/CR và acceptance criteria.
- [Operations](./03-operations.md) — queue/retry/DLQ config, runbook, rollout, capacity.
