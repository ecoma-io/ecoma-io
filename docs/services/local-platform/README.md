# Local Platform

Hạ tầng deployment **local** dùng chung cho mọi deploy unit, chạy trên Docker của máy developer: một Docker network, Traefik (HTTPS entrypoint duy nhất), PostgreSQL (TimescaleDB + pgvector) với persistent volume — mỗi Git worktree một bộ riêng, cách ly bằng namespace hash. Deploy unit đầu tiên dùng nó là `home` (`apps/home`, Nitro preset `node-server`).

Đây là hạ tầng **local**, không phải environment: staging/production của app đi đường Cloudflare Workers qua Wrangler và không đi qua đây ([`02-delivery.md`](../../overview/02-delivery.md) §7.4.1).

⚠️ **Lệch có chủ đích so với contract stack ở `02-delivery.md` §7.4.1**: ở đó `local` là stack _dùng một lần_ trên `file://` để xác minh contract, _không chạm tài nguyên thật_, tên thuộc bộ `local`/`staging`/`production`. Local platform ở đây dùng stack `local-<namespace>` **mang vĩnh viễn** (volume PostgreSQL `retainOnDelete`, dữ liệu sống qua nhiều lần deploy/destroy) và provision resource thật trên máy developer. §7.4.1 là hợp đồng cho đường environment thật, chưa cập nhật theo local platform này.

## Documents

- [01-architecture.md](./01-architecture.md) — ownership, namespace cách ly worktree, contract outputs, invariants.
- [03-operations.md](./03-operations.md) — prerequisites, luồng deploy, URL/certificate, teardown, smoke, giới hạn đã biết.
