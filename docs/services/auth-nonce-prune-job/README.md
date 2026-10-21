# Auth Nonce Prune Job

`auth-nonce-prune-job` là cron Worker dọn nonce hết hạn cho **hai** kho nonce của
đường nội bộ: `auth.internal_nonces` (db-auth) và `account.internal_nonces`
(db-account) — thay GitHub Action `.github/workflows/identity-nonce-prune.yaml`
(issue #82). Worker thuộc **maintenance plane**: nó không nằm trên serving path
của hai service nào, không expose HTTP, và không sở hữu storage — nó dọn dữ
liệu trong đúng một bảng của mỗi owner bằng một role tối thiểu của owner đó.

## Runtime / deploy unit

```text
auth-nonce-prune-job
├── Cloudflare Worker (module worker — chỉ `scheduled()`, KHÔNG `fetch`)
├── Cron Trigger nhịp `17 3 * * *` (03:17 UTC = 10:17 ICT)
└── Hyperdrive binding DB_AUTH    → db-auth    (role `ecoma_auth_nonce_pruner`)
└── Hyperdrive binding DB_ACCOUNT → db-account (role `ecoma_account_nonce_pruner`)
```

- Không D1, không Queue, không KV, không state cục bộ: tiến độ = dữ liệu thật còn
  lại trên từng database (mỗi lô DELETE tự commit).
- Hai database là của **hai owner khác** (`auth` và `account`); Worker dùng chung
  thuật toán qua một adapter (`src/prune.ts`), KHÔNG import code của hai app đó.
- Không có runbook dài ở đây: deploy/cron/runbook → [`03-operations.md`](./03-operations.md).

## Documents

- [`01-architecture.md`](./01-architecture.md) — boundary, thuật toán, caps, phân
  loại lỗi, permission model, invariants.
- [`03-operations.md`](./03-operations.md) — deploy, cron config, runbook hỏng,
  trạng thái runtime.

Nguồn liên quan:

- Cơ chế tracking mà job này thay và học thuyết retention →
  [`docs/services/auth/03-operations.md`](../auth/03-operations.md) §3.3
  (đoạn "Prune định kỳ" ghi cả hai kho, tài liệu canonical của cơ chế prune là
  thư mục này).
- Platform fact Hyperdrive + trần cron →
  [`docs/overview/04-platform-facts.md`](../../overview/04-platform-facts.md).
