# Account

`account` là deploy unit giữ **bằng chứng đăng nhập** và mọi UI liên quan tài khoản trong bounded context `identity`. Bổ sung `auth` (authorization server, API-only) — cùng context, hai database riêng.

```text
account.ecoma.io  (Nuxt UI + BFF: account · login · consent)
   └──► db-account     users · profile · email · credential · MFA/passkey · session · preference · privacy

              ▲                    ▲
              └── back-channel xác minh session (account đẩy sang auth) ──┘
                                    ▼
                    db-auth      (grant · token — account đọc qua contract, không đọc DB)
```

Ranh giới context tại system level → [`docs/overview/01-architecture.md`](../../overview/01-architecture.md) §2.1 · rule Nx cho `scope:identity` → [`docs/overview/05-code-architecture.md`](../../overview/05-code-architecture.md) §6.3.

## Hiện trạng

`account` đã có backend thật (`apps/account`): 6 migration `db-account` (`apps/account/db/migrations/` — trong đó `0004` đổi `authn_level` → `acr`, `0005` `email_addresses`, `0006` `otp_challenges`), contract internal `GET /internal/account/status` (envelope HMAC) và luồng đăng nhập email-OTP qua bốn route `/api/auth/{challenge,verify,session,logout}` (`apps/account/server/api/auth/`) — anti-enumeration, OTP chỉ lưu digest HMAC, session cookie `__Host-account-session` chỉ lưu hash. **Chưa có**: login/consent UI (luồng OTP là API thuần), contract back-channel mà `account` đẩy sang `auth` (`/internal/session/verified` phía caller), đường cấp `emailAddresses` cho user, prune job. `db-account` vẫn **chưa provision**. Chi tiết: [`04-implementation.md`](./04-implementation.md).

## Documents

| Document                                         | Nội dung                                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| [`01-architecture.md`](./01-architecture.md)     | Boundary, data model `db-account`, session/cookie security, contract, vòng đời account, invariants |
| [`02-requirements.md`](./02-requirements.md)     | FR/NFR/SR/CR có ID, non-goals, threat model, privacy/compliance, acceptance matrix                 |
| [`03-operations.md`](./03-operations.md)         | Deployment, binding, role & migration, monitoring, alerting, failure modes, restore, runbook       |
| [`04-implementation.md`](./04-implementation.md) | Trạng thái triển khai, phát hiện chặn về Service Binding, phần còn chưa có                         |
