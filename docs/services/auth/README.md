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

`auth` chỉ có `GET /health` (`apps/auth/src/main.ts`). **Chưa có** endpoint protocol OAuth 2.0/OIDC, chưa có schema, database hay binding. `db-auth` là **target đã chốt, chưa provision**.

## Documents

| Document                                     | Nội dung                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`01-architecture.md`](./01-architecture.md) | Boundary, data model `db-auth`, OAuth 2.0/OIDC secure defaults, login/consent protocol, session binding, revocation, invariants |
| [`02-requirements.md`](./02-requirements.md) | FR/NFR/SR/CR có ID, non-goals, threat model, privacy/compliance, acceptance matrix                                              |
| [`03-operations.md`](./03-operations.md)     | Deployment, binding, role & migration, key rotation, monitoring, alerting, failure modes, restore, runbook                      |
