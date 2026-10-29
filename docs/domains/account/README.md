# Account

`account` là bounded context giữ **bằng chứng đăng nhập** và mọi UI liên quan tài khoản; deploy unit cùng tên phục vụ nó. Bổ sung `auth` (authorization server, API-only) — bounded context riêng, hai database riêng.

```text
account.ecoma.io  (Nuxt UI + BFF: account · login · consent)
   └──► db-account     users · profile · email · credential · MFA/passkey · session · preference · privacy

              ▲                    ▲
              └── back-channel xác minh session (account đẩy sang auth) ──┘
                                    ▼
                    db-auth      (grant · token — account đọc qua contract, không đọc DB)
```

Ranh giới context tại system level → [`docs/architecture/01-architecture.md`](../../architecture/01-architecture.md) §2.1 · rule Nx theo scope của từng app → [`docs/architecture/05-code-architecture.md`](../../architecture/05-code-architecture.md) §6.3.

## Hiện trạng

`account` đã có backend thật (`apps/account`): 7 migration `db-account` (`apps/account/db/migrations/` — trong đó `0004` đổi `authn_level` → `acr`, `0005` `email_addresses`, `0006` `otp_challenges`, `0007` role pruner cho cron Worker dọn nonce), các contract internal `GET /internal/account/status` (trạng thái cho `auth`) và `GET /internal/account/profiles` (displayName theo batch cho `backoffice`) — đều qua envelope HMAC — và luồng đăng nhập email-OTP qua các route `/api/auth/{challenge,verify,session,logout}` (`apps/account/server/api/auth/`) — anti-enumeration, OTP chỉ lưu digest HMAC, session cookie `__Host-account-session` chỉ lưu hash. **Đã có cả UI lẫn BFF thật**: `/login`, `/login/continue`, `/consent` (`apps/account/app/pages/`) nối qua adapter thật `apps/account/app/account-data/real-adapter.ts` (`POST /api/auth/{challenge,verify,handoff}`, `POST /api/consent/{context,decide}`; BFF còn phục vụ `GET /api/auth/session` và `POST /api/auth/logout`), và back-channel đẩy `POST /internal/session/verified` + `POST /internal/consent/{context,decide}` sang `auth` qua Service Binding (`apps/account/server/api/auth/handoff.post.ts`). **Chưa có**: BFF cho thao tác dữ liệu tài khoản (profile, emails, notifications, preferences, privacy, security, sessions, applications — vẫn là mock, `isPreview` còn `true`), đường cấp `emailAddresses` cho user, prune `otp_challenges`. `account` **không** chạm `access_token`/`id_token` — nó không có đường lấy access token cho bên thứ ba, `auth` mới là bên cấp code. `db-account` vẫn **chưa provision**. Chi tiết: [`04-implementation.md`](./04-implementation.md).

## Documents

| Document                                         | Nội dung                                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| [`01-architecture.md`](./01-architecture.md)     | Boundary, data model `db-account`, session/cookie security, contract, vòng đời account, invariants |
| [`02-requirements.md`](./02-requirements.md)     | FR/NFR/SR/CR có ID, non-goals, threat model, privacy/compliance, acceptance matrix                 |
| [`03-operations.md`](./03-operations.md)         | Deployment, binding, role & migration, monitoring, alerting, failure modes, restore, runbook       |
| [`04-implementation.md`](./04-implementation.md) | Trạng thái triển khai, phát hiện chặn về Service Binding, phần còn chưa có                         |
