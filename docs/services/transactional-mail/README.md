# Transactional Mail

`transactional-mail` là control plane của mail bounded context: tiếp nhận yêu cầu gửi mail từ application, render message từ template, lưu domain state vào D1 `mail`, và đưa việc giao vào Cloudflare Queue thông qua **transactional outbox**.

## Runtime / deploy unit

- Cloudflare Worker — internal API, không hostname công khai.
- Storage: D1 `mail` — authority duy nhất của service.
- Produce Queue `ecoma-mail-delivery`; consumer là [`transactional-mailer-job`](../transactional-mailer-job/README.md).

## Boundary

- Control plane **không** gọi provider trên request path — provider delivery thuộc `transactional-mailer-job`.
- Recipient và provider credential không bao giờ vào Queue/log — chỉ qua private interface (Service Binding).

## Documents

- [01-architecture.md](./01-architecture.md) — boundary, domain model, outbox, private interface, invariants.
- [02-requirements.md](./02-requirements.md) — FR/NFR/SR/CR và non-goals.
- [03-operations.md](./03-operations.md) — deployment, configuration, outbox runbook, alert.
