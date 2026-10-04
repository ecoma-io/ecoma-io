# `@ecoma-io/account`

App Nuxt 4 chạy trên Cloudflare Workers, giữ **account UI + BFF** của bounded context
`identity` — kể cả login và consent UI.

Đây là **một trong hai** deploy unit của context đó. Endpoint protocol OAuth 2.0/OIDC
thuộc deploy unit kia (`auth` ở `apps/auth`, Worker `ecoma-auth`), không phải app này.
Reference: `docs/overview/01-architecture.md` §2.

## Phạm vi app

| Phần                                      | Trạng thái                             |
| ----------------------------------------- | -------------------------------------- |
| `GET /health`                             | có — protocol-only, không query DB     |
| `GET /ready`                              | có — kiểm `db-account`, fail closed    |
| `GET /internal/account/status`            | có — contract HMAC, `auth` là consumer |
| BFF cho browser (cookie session)          | **chưa có**                            |
| Login / consent UI                        | **chưa có**                            |
| Back-channel contract mà `account` đẩy đi | **chưa có**                            |

## Chạy

```bash
pnpm nx dev account          # http://localhost:4202
pnpm nx test account
pnpm nx lint account
pnpm nx build account
pnpm dx arch-check
```

Dev server dùng `wrangler.jsonc` cho binding. Vì `db-account` **chưa được provision**,
`/ready` sẽ trả `503` ở local — đó là hành vi đúng, xem mục "Những gì chưa có".

## Biến môi trường

Tất cả qua `runtimeConfig` của Nuxt, tức convention `NUXT_*`. Không có chỗ nào trong
code tự đọc `process.env` cho config.

| Biến                              | Bắt buộc | Mặc định                           | Ý nghĩa                                                |
| --------------------------------- | -------- | ---------------------------------- | ------------------------------------------------------ |
| `NUXT_INTERNAL_HMAC_SECRET`       | **có**   | không có                           | Secret HMAC cho internal contract. Tối thiểu 32 ký tự. |
| `NUXT_INTERNAL_AUTH_SKEW_SECONDS` | không    | `300` (trong `identity-contracts`) | Cửa sổ skew của envelope HMAC, tính bằng giây.         |

⚠️ Worker **không khởi động được** nếu thiếu secret hoặc secret quá ngắn
(`server/plugins/config.ts` kiểm lúc boot và `throw`). Cố tình: internal HMAC với
secret rỗng thì **chấp nhận mọi chữ ký**, tức tắt hẳn xác thực. "Cho chạy được với
secret rỗng" không phải degrade an toàn.

Ở production, đặt secret bằng Worker Secret (`wrangler secret put`), không đặt trong
`wrangler.jsonc`.

## Internal contract

`GET /internal/account/status?sub=sub_…`

Trả **đúng một** trường `status`, thuộc `active | suspended | deleted | not_found`.
Không có email, tên, profile hay trường định danh nào khác (FR-011b).

Xác thực bằng **envelope HMAC** qua ba header `x-ecoma-internal-timestamp`,
`x-ecoma-internal-nonce`, `x-ecoma-internal-signature`. Endpoint này
**không** nhận cookie trình duyệt (SR-010) — Service Binding không thay được signature
vì Cloudflare không document bất kỳ tín hiệu nào cho Worker phân biệt request qua
binding với request từ internet.

## Vì sao `/health` không query DB

`/health` chỉ chứng minh Worker đã khởi động. Nếu liveness phụ thuộc DB thì DB chết ⇒
`/health` lỗi ⇒ orchestrator restart Worker ⇒ Worker mới lại hỏi DB vẫn chết ⇒ restart
loop vô ích, vừa tăng tải lên DB đang chết vừa che mất nguyên nhân thật. Thứ cần hỏi
là `/ready`, và thứ cần sửa là `db-account`.

## Hyperdrive

Binding `DB_ACCOUNT` khai trong `wrangler.jsonc`, đọc ở `server/utils/bindings.ts`.

⚠️ **Query cache của Hyperdrive phải OFF** (`max_age = 0`). Cache bật mặc định 60s và
**không** invalidate khi ghi, nên contract status sẽ trả `active` cho một account vừa
bị `suspended` — đúng loại lỗi fail-open mà đường xác thực không được phép có. Tắt cache
là thao tác vận hành trên config `db-account`, **không** phải key trong
`wrangler.jsonc`.

Driver là `pg` (node-postgres), không phải Postgres.js: transaction-mode pooling của
Hyperdrive không hỗ trợ tin cậy `prepare: false`, mà `pg` không bật prepare.

## Những gì chưa có

Phần này liệt kê cái **không** tồn tại, để không ai đoán nhầm từ tên route:

- **`db-account` chưa được provision.** `id` Hyperdrive trong `wrangler.jsonc` là
  placeholder (`000…0`) cho tới khi config thật tồn tại; deploy sẽ fail tới lúc đó.
  Điền id giả vào production để "cho deploy chạy" là đổi một lỗi lộ ra sớm lấy một
  lỗi im lặng lúc chạy thật.
- **BFF cookie session, Login / Consent UI chưa có.** Bảng `users`,
  `account_sessions`, `login_handoffs`, `security_events` và `internal_nonces` đã có
  migration (`db/migrations/`) và được integration test phủ, nhưng chưa có route BFF
  nào dùng `account_sessions` — đường cookie chưa tồn tại ở runtime.
- **Prune job cho `internal_nonces` chưa có.** Mỗi request internal hợp lệ ghi một
  nonce; TTL (`timestamp của envelope + skew + buffer`) đã được test đảm bảo đúng
  thời lượng, nhưng `wrangler.jsonc` chưa khai `triggers.crons` nào dọn hàng hết
  hạn — bảng phình theo traffic cho tới khi prune tồn tại.
- **Hyperdrive chưa được đo bằng test.** Integration test kết nối `pg` thẳng vào
  PostgreSQL; hành vi Hyperdrive thật (transaction-mode pooling, query cache OFF)
  chỉ có ở môi trường deploy.

### Test còn thiếu (sau khi integration suite chạy thật)

Đây là phần còn lại của "chưa có test", viết sau khi suite tích hợp với
PostgreSQL 17 thật (testcontainers) đã có; không liệt kê những gì suite đã phủ:

- **Route `GET /internal/account/status` end-to-end.** Mapping `toContractStatus`
  có unit test, middleware có test end-to-end với `signRequest` thật, store có
  test trên database thật — nhưng chính handler route (query param →
  `selectAccountStatus` → validate → response) chưa chạy trong test nào.
- **`GET /ready`.** Chưa có test nào — kể cả nhánh fail-closed khi DB không trả
  lời.
- **Đường gọi qua Service Binding thật** (`auth → account`): test đi qua h3 app
  trong cùng process, không qua Worker-to-Worker binding; hợp đồng chữ ký đã có
  test, còn hạ tầng binding thì chưa.
- **Chạy trên Cloudflare Workers thật** (`wrangler dev` / Preview): không có
  smoke test nào sau deploy.

## Ghi chú build

`nuxt.config.ts` khai `nitro.alias` cho `pg-native`. Đây là bắt buộc, không phải tuỳ
chọn: preset `cloudflare-module` bật `noExternals`, nên `pg/lib/native/client.js`
`require('pg-native')` (optional dependency mà Node nuốt lỗi được) khiến Rollup fail
build. Stub ở `server/lib/pg-native.cjs` **ném lỗi khi được dựng** — trả object rỗng sẽ
biến code gọi `pg.native` thành client giả và hỏng im lặng ở production.

## Tham chiếu

- `docs/services/account/01-architecture.md` — §4 session/cookie, §5 contract
- `docs/services/account/02-requirements.md` — FR-011x, SR-010
- `docs/services/account/03-operations.md` — §1 runtime, §2 deployment, §5 Hyperdrive, §6 observability, §8 failure modes
- `docs/overview/01-architecture.md` §9 — invariants (2: Preview không ghi production, 4: application code chỉ chứa tên binding, 14: Hyperdrive query cache OFF, 25: `account` chỉ đọc/ghi `db-account`, 30: kiểm tra trạng thái account lúc phát hành)
