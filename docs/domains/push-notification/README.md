# Push Notification

`push-notification` là **control plane** của hệ thống Push Notification: quản lý `Device`, `Push Subscription`, `Push Provider`, `Push Notification`, `Push Delivery` và `Push Routing Policy`; tiếp nhận notification intent từ business service, thực hiện routing, tạo delivery + outbox trong cùng một D1 transaction, rồi publish `Delivery Command` vào Cloudflare Queue.

```text
Application ──► push-notification ──► Cloudflare Queue ──► web-push-notification-job ──► Web Push Provider
```

## Runtime / deploy unit

- Cloudflare Worker (control plane) — internal API, Service Binding; không public hostname (`docs/architecture/01-architecture.md` §2, §6). Trạng thái: `workers_dev: false` **đã đóng trong implementation** (`apps/push-notification/wrangler.jsonc` và `apps/web-push-notification-job/wrangler.jsonc` đều đặt và không có `routes`/hostname công khai) — vẫn còn là điều kiện kiểm tra khi thêm environment mới; **launch gate** → [`03-operations.md`](./03-operations.md) §2.
- Storage owner: D1 `push` (mỗi environment một D1 riêng).
- Queue producer: `ecoma-push-delivery` (+ DLQ `ecoma-push-delivery-dlq`).
- Delivery plane: [`web-push-notification-job`](../../solutions/web-push-notification-job/README.md) — deploy unit độc lập, không truy cập D1 `push`.

## Documents

| Document                                     | Nội dung                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| [`01-architecture.md`](./01-architecture.md) | Purpose, boundary, domain design, transaction/outbox boundary, invariants    |
| [`02-requirements.md`](./02-requirements.md) | Functional/non-functional/security requirements, API capabilities, non-goals |
| [`03-operations.md`](./03-operations.md)     | Deployment, Queue/outbox, provider operations, observability, runbook        |
