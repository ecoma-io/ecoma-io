# Auth

`auth` là **authorization server OAuth 2.0 / OpenID Connect** của Ecoma: API-only, không UI, issuer `https://auth.ecoma.io`. Bổ sung `account` (UI + BFF) — cùng bounded context `identity`, hai database riêng.

```text
auth.ecoma.io  (API-only: /authorize · /token · discovery · JWKS · revoke)
   └──► db-auth      client · authorization transaction/code · consent · grant · token · revocation · signing-key metadata

                    ▲                    │
                    └── nhận kết quả xác minh session từ account (push) ──┘
```

Ranh giới context tại system level → [`docs/overview/01-architecture.md`](../../overview/01-architecture.md) §2.1 · rule Nx cho `scope:identity` → [`docs/overview/05-code-architecture.md`](../../overview/05-code-architecture.md) §6.3.

## Hiện trạng

Authorization server OAuth 2.0/OIDC đã có trong code (`apps/auth`): provider `oidc-provider` 9.12.2 chạy qua bridge `cloudflare:node` (`apps/auth/src/oidc/`), glue login/consent với `account` qua ba contract internal HMAC (`/internal/session/verified`, `/internal/consent/context`, `/internal/consent/decide`), và 13 migration của `db-auth` (`apps/auth/migrations/`). Route chia hai lane (`apps/auth/src/main.ts`): Hono giữ `/health`, `/ready`, `/.well-known/*`, `/authorize`, `/authorize/confirm`, `/internal/*`; provider giữ `/auth`, `/token`, `/jwks.json`, `/revocation`, `/session/end`. `GET /ready` kiểm hai điều: cả hai binding bắt buộc (`HYPERDRIVE`, `ACCOUNT_SERVICE`) đã gắn và `db-auth` reachable — không probe service `account` qua binding; fail closed: thiếu binding hay DB chết ⇒ `503` + `Retry-After` ([03-operations.md §2](./03-operations.md)).

**Chưa có**: `db-auth` chưa provision; Worker `ecoma-auth` chưa khai environment staging/production (`apps/auth/wrangler.jsonc`).

## Documents

| Document                                     | Nội dung                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`01-architecture.md`](./01-architecture.md) | Boundary, data model `db-auth`, OAuth 2.0/OIDC secure defaults, login/consent protocol, session binding, revocation, invariants |
| [`02-requirements.md`](./02-requirements.md) | FR/NFR/SR/CR có ID, non-goals, threat model, privacy/compliance, acceptance matrix                                              |
| [`03-operations.md`](./03-operations.md)     | Deployment, binding, role & migration, key rotation, monitoring, alerting, failure modes, restore, runbook                      |
