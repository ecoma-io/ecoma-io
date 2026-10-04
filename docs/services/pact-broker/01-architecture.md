# Pact Broker — Architecture

> Phạm vi: thiết kế bounded context `pact-broker` — ranh giới hai deploy unit, mô hình dữ liệu `db-pact-broker`, tenant isolation, auth model, invariants.
> Mapping từ upstream `bison-digital/pact-broker-workers` → [`UPSTREAM_MAPPING.md`](./UPSTREAM_MAPPING.md) · yêu cầu → [`02-requirements.md`](./02-requirements.md) · vận hành → [`03-operations.md`](./03-operations.md).
> **Hiện trạng:** implementation đang chạy; `db-pact-broker` **chưa provision** — Hyperdrive binding là placeholder fail-closed, đúng quy ước `db-account`/`db-auth`.

---

## 1. Mục đích và ranh giới

`pact-broker` lưu và phân phát **hợp đồng consumer-driven contract** (pacts), kết quả verification, và trạng thái deploy (`can-i-deploy`) cho mọi dịch vụ Ecoma. Dogfooding: `llm-console`, `llm-seller`, `backoffice`… publish/verify pact qua broker này.

| Sở hữu                                                                                                                                                                                                                       | Không sở hữu                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pacticipants · versions · branches/tags · pacts + content SHA · verifications · matrix/can-i-deploy · environments · deployed/undeployed versions · **tenant + membership + role của broker** · **machine token của broker** | danh tính người dùng (dùng `sub` từ access token của `auth`, tham chiếu opaque) · quyền nghiệp vụ scope khác · deployment thật (broker chỉ ghi nhận, không thực hiện) |

- **Broker là nguồn sự thật** cho tenant membership/role **của riêng broker**: role Owner/Admin/Member/Viewer của một tenant pact broker không suy ra từ role backoffice hay bất kỳ scope nào khác (A21 của `overview/01`).
- `sub` là tham chiếu opaque, **không FK** sang `db-account`/`db-auth` — cùng quy ước identity: `db-pact-broker` không đọc database nào khác, và không database nào khác đọc nó.
- Pact CLI và CI pipeline dùng **machine token** riêng; credential này không bao giờ chia sẻ với browser session.

## 2. Runtime

```text
apps/pact-broker-api   (Cloudflare Worker, Hono; API-only, Pact CLI-compatible)
├── Hyperdrive binding → db-pact-broker   (PostgreSQL; query cache OFF)
└── Worker Secrets: PACT_BROKER_INTERNAL_SECRET (HMAC internal, tương lai)

apps/pact-broker-app   (Cloudflare Worker, Nuxt 4 + Nitro preset cloudflare_module)
├── BFF server routes → gọi pact-broker-api (Service Binding hoặc fetch nội bộ)
└── Browser session: OIDC qua auth.ecoma.io; browser KHÔNG chạm DB, KHÔNG tin
    userId/sub/role/permission do client gửi
```

- Migration chạy từ **CI runner** bằng credential `_migrator` qua `nx run pact-broker-api:db:migrate` — **không bao giờ** chạy DDL từ Worker (HD6: Hyperdrive không hỗ trợ advisory lock; runner cần `pg_advisory_lock`).
- Không chạy advisory lock, `LISTEN/NOTIFY`, `PREPARE` qua Hyperdrive ở serving path (HD6).

## 3. Data model — `db-pact-broker`

Schema ứng dụng tên `pact`. Ba nhóm bảng:

### 3.1 Tenant + membership + machine token (lớp Ecoma, viết mới)

```text
pact.tenants ─┬─< pact.tenant_members >─ sub (opaque)
              │        (role: owner|admin|member|viewer)
              ├─< pact.machine_tokens
              └─< mọi bảng domain phía dưới (tenant_id NOT NULL)
```

- **`tenants`**: `id` (uuid), `name` (unique, regex giống `nameSchema` upstream), `status` (`active|suspended|deleted`), timestamps. Default tenant per identity được provision **lần đầu** theo tên suy từ identity, **idempotent + race-safe** (INSERT ON CONFLICT — xem §4).
- **`tenant_members`**: `UNIQUE (tenant_id, sub)`; `role` CHECK IN ('owner','admin','member','viewer'). Composite FK về `tenants` và (khi thêm) unique-sub constraint cho phép DB-level enforce "member thuộc đúng tenant".
- **`machine_tokens`**: chỉ lưu **hash** SHA-256 của token (`token_hash` PRIMARY KEY); `tenant_id`, `name`, `scopes` (text CSV hoặc jsonb), `created_by_sub`, `revoked_at` (NULL = active). Không có `last_used_at` — ghi nó đòi UPDATE trên mọi request (observability thành serving-path dependency, trái bất biến); usage tracking khi cần thì đọc từ `audit_events` (append-only, off-path). Plaintext hiện **một lần** trong response của lệnh tạo; không đường nào đọc lại. Revoke = set `revoked_at`, hiệu lực **ngay lập tức** (mỗi request tra hash rồi check `revoked_at IS NULL`).
- Scopes: `read` (viewer trở lên), `write` (member trở lên: publish pact/verification), `admin` (Admin/Owner: environments, webhooks, membership). Token scope ≠ role của người — token là credential cấp sẵn quyền cố định, người tạo phải có role đủ cao.

### 3.2 Domain Pact (port từ upstream, thêm `tenant_id`)

Toàn bộ bảng upstream (`pacticipants`, `versions`, `tags`, `pacts`, `verifications`, `environments`, `deployed_versions`, `webhooks`, `webhook_executions`) được port sang PostgreSQL với:

- **`tenant_id uuid NOT NULL` trên mọi bảng domain** + composite UNIQUE/FK chéo bảng để isolation là thuộc tính của **schema**, không phải chỉ của query. Ví dụ:
  - `pacts`: `UNIQUE (tenant_id, consumer_version_id, provider_id)`; FK `(tenant_id, consumer_version_id) → versions (tenant_id, id)`.
  - `verifications`: FK `(tenant_id, pact_id) → pacts (tenant_id, id)` và `(tenant_id, provider_version_id) → versions (tenant_id, id)`.
  - `tags`: FK `(tenant_id, version_id) → versions (tenant_id, id)`, `UNIQUE (tenant_id, version_id, name)`.
- Như vậy một row "lệch tenant" (tham chiếu version của tenant khác) bị **FK từ chối ở tầng database**, ngay cả khi code có bug.
- Kết quả verification, content SHA, semantics branch/tag/buildUrl giữ nguyên behaviour upstream: `getOrCreateVersion` backfill-only; publish pact SHA-256 content, update-khi-đổi, 201/200; `deployed_versions.undeployed_at NULL` = đang deploy.
- Timestamps `timestamptz` (thay TEXT datetime của SQLite upstream).

### 3.3 Audit + append-only

- **`pact.audit_events`** (viết mới): append-only (trigger chặn UPDATE như `security_events`), ghi token tạo/revoke, membership change, environment change. Không log prompt/response — broker không xử lý payload người dùng cuối nào ngoài nội dung pact (nội dung pact là artifact test, được lưu ở `pacts.content` theo đúng nghiệp vụ).

## 4. Default tenant provisioning (race-safe)

Lần đầu một identity (sub) tương tác (dashboard login hoặc bootstrap endpoint), broker gọi `ensureDefaultTenant(sub)`:

1. `INSERT INTO pact.tenants (name, ...) VALUES ($defaultName, ...) ON CONFLICT (name) DO NOTHING RETURNING id` — `name` suy deterministic từ sub (vd `tenant-<sub-prefix>`), nên retry/concurrency hội tụ cùng một tên.
2. Nếu `ON CONFLICT` không trả row → SELECT row hiện có; nếu tenant đó `deleted`/`suspended` → fail-closed (không tự hồi sinh).
3. `INSERT INTO pact.tenant_members (tenant_id, sub, role) VALUES (...,'owner') ON CONFLICT (tenant_id, sub) DO NOTHING` — idempotent; thành viên có sẵn role cũ thì giữ nguyên.
4. Race test: hai connection đồng thời cùng sub phải cho đúng một tenant + một membership owner, không lỗi chết.

## 5. Auth model

### 5.1 Dashboard (`pact-broker-app`)

- Browser đăng nhập qua OIDC `auth.ecoma.io` (authorization code + PKCE); access token JWT ES256 TTL 300s verify offline bằng JWKS.
- BFF server-side giữ token, browser chỉ thấy session cookie `__Host-…` (hash-only ở server, đúng pattern `apps/account`).
- **Không tin bất kỳ claim nào do client gửi**: mọi request dashboard đi qua BFF; BFF verify token rồi forward với machine credentials của riêng app hoặc ForwardAuth header ký internal.
- RBAC trên BFF + API đều check: Viewer đọc, Member publish, Admin quản lý environments/webhooks, Owner quản lý members/tokens.

### 5.2 Machine token (Pact CLI + CI)

- `Authorization: Bearer pbk_<random>`; tra `SHA-256(token)` trong `machine_tokens`; so hash — không so plaintext, không timing leak (tra cứu hash qua PK là constant-time theo index).
- Fail: 401 đồng nhất, không phân biệt "token không tồn tại" vs "đã revoke" trong body (chỉ audit phân biệt).
- Token có scope; endpoint check scope **và** tenant của token; không có cross-tenant token.

### 5.3 Bootstrap independence

Build/test/migrate/bootstrap của broker **không yêu cầu** Account/Auth production đang sống:

- Unit + integration test dùng testcontainers PostgreSQL (`postgres:17-alpine`) — không Hyperdrive, không dịch vụ ngoài.
- Machine token cho CLI được tạo qua API có auth riêng trong test (bootstrap token từ migration seed có kiểm soát, chỉ trong môi trường test/local).
- Dashboard không bắt buộc để publish/verify (CLI path độc lập hoàn toàn).

## 6. `can-i-deploy` fail-closed

Giữ tri-state `deployable: boolean | null` từ upstream `matrix-summary`: `false` = có verification fail, `null` = unknown (thiếu dữ liệu/selector không khớp), `true` = mọi verification đã pass. CLI `can-i-deploy` khi `null` **phải** exit fail với reason rõ ràng ("unknown, not verified") — unknown không bao giờ được hiểu là safe. Port `summarizeMatrix` gần nguyên xi (pure, đã có unit test upstream).

## 7. Webhook (mặc định TẮT ở production path)

Upstream có webhook outbound. Cho đến khi có SSRF protection chứng minh được (HTTPS-only, block private/loopback/metadata IP ranges, chống DNS rebinding — xem `02-requirements.md` §threat), webhook outbound **không bật trong production path**: route trả 501 với lý do, flag config `PACT_BROKER_WEBHOOKS_ENABLED` mặc định `false` và production env không được phép set true. Schema vẫn tạo bảng để không phải expand/contract sau này.

## 8. Invariants

1. Một service một database: chỉ `pact-broker-api` chạm `db-pact-broker`. Dashboard không có Hyperdrive binding nào.
2. Tenant isolation là composite FK/unique ở DB level, không chỉ WHERE clause.
3. Token hash-only; plaintext hiện một lần; revoke hiệu lực tức thời.
4. `can-i-deploy` unknown ≠ safe (fail-closed tri-state).
5. Migration từ CI runner với advisory lock; Worker không bao giờ DDL.
6. Không down-migration; expand → compatible rollout → contract.
7. Bootstrap/build/test/migrate không phụ thuộc dịch vụ identity đang sống.
8. Pact CLI compatibility: index HAL công bố compatibility version `2.107.0` và các link `pb:publish-contracts`, `pb:pacticipant-branch-version`, `pb:provider-pacts-for-verification` mà CLI gate theo.
9. Audit append-only ở DB level.
10. Không log secret, token, credential.
