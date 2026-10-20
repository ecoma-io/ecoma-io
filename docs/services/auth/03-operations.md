# Auth — Operations

> Phạm vi: vận hành `auth` — deployment, binding, role & migration, key rotation, monitoring, alerting, failure modes, restore và runbook.
> Thiết kế → [`01-architecture.md`](./01-architecture.md) · yêu cầu → [`02-requirements.md`](./02-requirements.md) · system-level backup/DR → [`docs/overview/03-operations.md`](../../overview/03-operations.md) · delivery → [`docs/overview/02-delivery.md`](../../overview/02-delivery.md).
> **Hiện trạng:** endpoint protocol và glue internal đã có trong code (`apps/auth`), 13 migration của `db-auth` nằm ở `apps/auth/migrations/`; **không database nào được provision** và Worker chưa khai environment staging/production. Các phần deployment/restore/runbook dưới đây là kế hoạch cho khi provision.

---

## 1. Runtime

```text
auth.ecoma.io  (Cloudflare Worker · API-only · Hono)
├── Hyperdrive binding → db-auth   (query cache OFF)
└── Service Binding  → account     (auth là CONSUMER của contract auth → account,
                                      dùng để hỏi trạng thái account lúc phát hành — §6.0)
```

⚠️ Worker identity lâu dài — `ecoma-auth`, không có suffix môi trường; staging là `stg-ecoma-auth`. PR không tạo Worker mới ([`02` §5.1](../../overview/02-delivery.md)).

## 2. Deployment

- Hyperdrive binding trỏ `db-auth` (**tên binding**, không host/port/user).
- Worker Secret cho signing key — `AUTH_SIGNING_KEY` (PKCS#8 PEM) cùng `AUTH_SIGNING_KEY_ID`; lịch xoay **chưa chốt** (§4).
- Worker Secret `AUTH_INTERNAL_SECRET` — bắt buộc, cùng giá trị với `account` (§3.3).
- Observability enabled.

⚠️ **Bật `nodejs_compat` là bắt buộc, khác gì các app Nuxt.** Provider `oidc-provider` là package Node: bridge `cloudflare:node` (`apps/auth/src/oidc/runtime.ts`) dựng một `http.Server` Node thật trong isolate rồi chuyển request vào bằng `handleAsNodeRequest`. `wrangler.jsonc` của `auth` đã khai `nodejs_compat` với `compatibility_date 2026-10-05`; `.oxlintrc.json` vẫn chặn Node builtin trực tiếp trong code application (`runtime:edge`) — đường Node hợp lệ duy nhất là qua bridge của provider.

⚠️ **KHÔNG khai báo binding storage nào cho tới khi `db-auth` được provision.** Binding trỏ database chưa tồn tại là config hỏng, không phải config "chưa dùng".

Kiểm sau deploy:

```text
GET /health → 200 { service: 'auth', status: 'ok' }
GET /ready  → 200 { service: 'auth', status: 'ready' }        # khi mọi dependency sống
GET /ready  → 503 { error: 'service_unavailable' } + Retry-After   # khi có dependency chết
```

⚠️ **`/ready` là readiness có kiểm phụ thuộc; `/health` là liveness không chạm DB.**
Cùng một hợp đồng với `account` ([../account/03-operations.md](../account/03-operations.md) §2,
nơi cài đặt bên kia là `apps/account/server/routes/ready.get.ts`, bên này là
`apps/auth/src/main.ts`). Riêng `auth` có hai dependency bắt buộc và route kiểm
**cả hai**:

- `HYPERDRIVE` tới `db-auth` — probe là một `SELECT` trên `auth.oauth_clients` qua
  `createPostgresClient` (`apps/auth/src/main.ts`), tức record gốc đầu tiên của
  schema (`0001`) với credential `ecoma_auth_runtime`: database nửa schema hay
  grant sai đều làm probe thất bại, không chỉ database chết.
- `ACCOUNT_SERVICE` — binding tới `account`, thiếu nó thì không hỏi được trạng
  thái account (control point fail-closed lúc phát hành).

Hành vi fail-closed: thiếu binding ⇒ `503` + `Retry-After` (mã ổn định
`binding_missing` trong log); DB không kết nối được ⇒ `503` + `Retry-After`
(`db_unreachable`). Response **không** nêu tên binding thiếu, **không** message
của driver (có thể rò connection string) — nguyên nhân nằm ở log cùng mã ổn định.
`/ready` trả `503` khi một dependency chết không phải là báo động giả: đây là
tín hiệu cho orchestrator ngừng traffic mới, đúng chỗ nó thuộc về.

Rollback theo Worker version đã publish, **không** rollback database ([`02` §8](../../overview/02-delivery.md)).

## 3. Database, role và migration

| Database  | Owner  | Runtime role         | Migrator role         |
| --------- | ------ | -------------------- | --------------------- |
| `db-auth` | `auth` | `ecoma_auth_runtime` | `ecoma_auth_migrator` |

Role model giống [`../account/03-operations.md`](../account/03-operations.md) §3: owner (ngoài VPS cho DR) · migrator (chỉ CI runner) · runtime (chỉ DML).

### 3.1 Chặn chéo — điều kiện bắt buộc

```sql
REVOKE CONNECT ON DATABASE db-account FROM ecoma_auth_runtime;
```

```sql
SELECT has_database_privilege('ecoma_auth_runtime', 'db-account', 'CONNECT');  -- phải = false
```

Câu `REVOKE` không phụ thuộc table nào tồn tại → từ chối được ngay từ khi database tạo ra. Đây là lớp enforce thật, không phải tag Nx: cả hai app đều mang `scope:identity` nên tag không phân biệt được chúng ([`05` §6.3](../../overview/05-code-architecture.md)).

### 3.2 Migration

- **Greenfield provisioning, không phải data migration.** Không có `db-identity` nào tồn tại để kế thừa. Danh sách migration đã có trong repo tại `apps/auth/migrations/`: `0001` schema + `oauth_clients` tới `0013` (`oidc_state` — một bảng, bảy kind giao thức của provider); `0012` đổi tên cột `authn_level` → `acr` (đồng bộ với `0004` của `db-account`), `0013` là trạng thái OIDC cho provider. Danh sách này phục vụ provisioning lần đầu khi `db-auth` được tạo; các file đã được test phủ (integration suite của `apps/auth`).
- Migration chạy từ **CI runner** bằng PostgreSQL client kết nối thẳng, dùng role `_migrator_`, giữ advisory lock ([`02` §3.1](../../overview/02-delivery.md)).
- **Migration history độc lập** với `db-account`.
- ⚠️ **Thứ tự mở rộng:** authorization transaction và authorization code **phải** nằm trong PostgreSQL — consume-once cần compare-and-set trong database. KV eventual consistency ≥ 60 s (KV1), 1 write/giây/key (KV2) và tài liệu chính thức khuyến cáo không dùng cho atomic operation (KV6); Queue là at-least-once (QU1). Không có lựa chọn nào cho consume-once đúng ([`01-architecture.md`](./01-architecture.md) §3.3).
- Expand → compatible rollout → contract; không down-migration, **forward-fix**.

Thứ tự provisioning: infrastructure (database + ba role + `REVOKE` chéo) → expand schema → binding Hyperdrive → compatible rollout → contract.

### 3.3 Envelope nội bộ — secret, kho nonce và mã lỗi

Vận hành của envelope HMAC dùng chung với `account`. Giao thức, canonical form và taxonomy lỗi có **một** nguồn sự thật: [`01-architecture.md`](./01-architecture.md) §5.1.8; cài đặt ở `libs/identity-contracts` (`internal-auth.ts`). Mục này chỉ nói phần vận hành.

#### Secret

| Mục             | Giá trị                                                                                                                                                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`          | Worker Secret `AUTH_INTERNAL_SECRET` (**bắt buộc**)                                                                                                                                                                                                         |
| `account`       | Worker Secret `NUXT_INTERNAL_HMAC_SECRET` (Nuxt đổi tên sang convention `NUXT_*`; `nuxt.config.ts` map lại thành `internalHmacSecret`)                                                                                                                      |
| Skew (tuỳ chọn) | `AUTH_INTERNAL_SKEW_SECONDS` (và `NUXT_INTERNAL_AUTH_SKEW_SECONDS` phía `account`), **chuỗi chữ số thập phân** (số nguyên giây **dương**, `MIN_SKEW_SECONDS` = 1, tối đa `MAX_SKEW_SECONDS` = 3600); bỏ trống thì dùng `DEFAULT_SKEW_SECONDS` (300) của lib |

⚠️ **Skew phải thoả cả hai biên, và hai biên sống ở lib chứ không ở từng service.** `MIN_SKEW_SECONDS` = 1 vì cửa sổ `0` không phải "chặt nhất" mà là hỏng: `now` phía nhận và `timestamp` phía gọi là hai lần đọc đồng hồ khác nhau nên hiệu gần như luôn ≥ 1, tức cửa sổ `0` từ chối gần như mọi envelope hợp lệ. `MAX_SKEW_SECONDS` = 3600 vì skew kéo TTL của nonce theo (`timestamp + skew + buffer`), nên một giá trị gõ sai (`86400`) làm phình bảng `auth.internal_nonces` theo đúng cửa sổ đó. Cả hai service **từ chối giá trị ngoài biên lúc khởi động** (fail lúc boot, không im lặng chạy với mặc định), và cả hai đọc **cùng** hai hằng của `libs/identity-contracts` — trần cục bộ ở một service là chỗ hai phía lệch nhau.

⚠️ **Hai Worker phải giữ CÙNG một giá trị.** Đây là secret đối xứng, không phải cặp khoá công khai/bí mật: `auth` ký bằng nó thì `account` verify được bằng đúng nó, và ngược lại. Lệch một bên là **mọi** request nội bộ `401` — hỏng đóng, không hỏng mở.

⚠️ **Không có giá trị mặc định và không có fallback.** `loadAuthConfig` gọi `requireSecret(env.AUTH_INTERNAL_SECRET, …)` và ném lúc khởi động nếu thiếu; middleware của `account` trả `401` khi secret rỗng. Không có nhánh nào coi "chưa cấu hình" là "cho phép". **Không bao giờ** đặt giá trị thật của secret vào Git, vào PR build hay vào Preview runtime (non-negotiable; [`02` §5.3](../../overview/02-delivery.md)).

⚠️ **Rotate secret là thao tác phải đồng thời, và hiện không có giai đoạn overlap.** `v1=` trong header chữ ký là version của **scheme**, không phải `kid` của khoá, nên không có cách để hai bên tạm thời chấp nhận hai giá trị. Đổi secret nghĩa là: (1) chấp nhận một cửa sổ request nội bộ `401`, rồi (2) đặt cùng giá trị mới ở cả hai Worker. Làm ngược thứ tự (đặt một bên trước) chỉ kéo dài cửa sổ đó. Nếu cần rotate không gián đoạn thì phải thêm `kid` vào envelope — một thay đổi giao thức, không phải thao tác vận hành.

#### Kho nonce

| Service   | Bảng                      | Migration                                             |
| --------- | ------------------------- | ----------------------------------------------------- |
| `auth`    | `auth.internal_nonces`    | `apps/auth/migrations/0010_internal_nonces.sql`       |
| `account` | `account.internal_nonces` | `apps/account/db/migrations/0003_internal_nonces.sql` |

- Nonce là duy nhất **theo từng service nhận**, nên hai bảng là hai kho độc lập — nonce đã chiếm ở `db-account` không bảo vệ được request đến `auth`. Mỗi service chỉ chạm database của mình.
- Quyền của `ecoma_auth_runtime` trên bảng này là `SELECT, INSERT` — **không** `UPDATE`, **không** `DELETE`. Nới `expires_at` của một nonce đã ghi là nới cửa sổ replay; xoá một nonce **còn hiệu lực** còn nặng hơn: nó mở lại cửa sổ replay cho đúng envelope đó. Prune vì vậy là job của `ecoma_auth_migrator`, theo học thuyết retention đã viết trong `0009_grants_and_isolation.sql` ("Dọn dữ liệu hết TTL là job của migrator, không phải đường của serving path").
- `internal_nonces` đã nằm trong sweep quyền của `apps/auth/migrations/README.md` §"Sweep kiểm tra quyền" ô (2) và (2c) — chạy sweep đó sau khi áp `0010`.

**Prune (runbook)** — chạy trên database của chính service đó:

`db-auth`: bằng role **`ecoma_auth_migrator`**, không phải runtime (runtime không có `DELETE` trên `auth.internal_nonces`):

```sql
WITH deleted AS (
  DELETE FROM auth.internal_nonces
   WHERE nonce = ANY (ARRAY(
           SELECT nonce FROM auth.internal_nonces
            WHERE expires_at < now() LIMIT 10000))
   RETURNING 1)
SELECT count(*) FROM deleted;
```

`db-account`: `account.internal_nonces` **được** cấp `DELETE` cho runtime (ngoại lệ có giải thích tại `apps/account/db/migrations/0002_roles_and_grants.sql`), nên chạy được bằng `ecoma_account_runtime`:

```sql
WITH deleted AS (
  DELETE FROM account.internal_nonces
   WHERE nonce = ANY (ARRAY(
           SELECT nonce FROM account.internal_nonces
            WHERE expires_at < now() LIMIT 10000))
   RETURNING 1)
SELECT count(*) FROM deleted;
```

⚠️ **Chạy lặp, không chạy một câu lớn.** Hai câu trên là **một lô**: lặp lại cho tới khi `count(*)` về `0` hoặc dưới `LIMIT`. Một câu `DELETE … WHERE expires_at < now()` trần giữ một transaction cho tới khi chạy hết — backlog lớn thì transaction lớn, giữ khóa lâu và có thể bị kill rồi rollback toàn bộ, không xóa được hàng nào. Predicate `expires_at < now()` giữ nguyên ở mọi lô, nên chạy lại sau khi đứt giữa chừng vẫn an toàn. `count(*)` thay cho `RETURNING nonce` để giá trị nonce không rơi vào terminal hay buffer của client.

**Prune định kỳ (lịch chạy)** — ~~`.github/workflows/identity-nonce-prune.yaml`, job `prune-auth`~~ ⚠️ **workflow này KHÔNG còn tồn tại nữa:** toàn bộ file CD — trong đó có `identity-nonce-prune.yaml` — đã bị xoá khỏi nhánh phát triển `johnitvn/numbfish` ở commit `f68105b6` ("fix: remove all CD", 2026-10-16) và **không bao giờ vào `main`** (trên `main` chỉ còn `ci.yaml`, `code-analysis.yml`, `code-review.yml`). Mô tả bên dưới được **giữ nguyên làm đặc tả cơ chế cần hiện thực lại**, không phải mô tả một job đang chạy: prune nonce **chưa có hiện thực nào cả** (việc hiện thực lại thuộc Workstream E/delivery theo plan Identity BC hardening, không phải cho PR #47 này).

- **Cơ chế:** CI runner kết nối thẳng tới database bằng PostgreSQL client, tức đúng đường admin path đã dùng cho migration ([`../../overview/02-delivery.md`](../../overview/02-delivery.md) §3.1) — không phải `scheduled()` handler trong Worker. Lý do là quyền hạn: runtime của `auth` **không có** `DELETE` trên `auth.internal_nonces` (khối grant ở `apps/auth/migrations/0010_internal_nonces.sql`), và credential `_migrator_` không bao giờ là Worker secret ([`02`](../../overview/02-delivery.md) §6). Job chạy bằng `ecoma_auth_migrator`.
- **Một script dùng chung, schema do job truyền vào.** Script prune nằm ở một chỗ duy nhất trong workflow (`PRUNE_SCRIPT` ở cấp workflow) và nhận `SERVICE` / `TARGET_SCHEMA` / `EXPECTED_IDENTITY` từ `env:` của từng job, nên hai job không thể lệch nhau về mặt câu lệnh. Script kiểm `to_regclass` + `has_table_privilege` của chính role nó đang kết nối **trước** khi xoá và so với `EXPECTED_IDENTITY`; sai role, sai bảng hay thiếu quyền thì dừng ở `outcome=identity_mismatch` trước khi chạm dữ liệu. Không chỗ nào hard-code `auth.…` hay `account.…` trong script chung.
- **Xoá theo lô có giới hạn, không phải một câu DELETE suốt đời.** Một câu `DELETE … WHERE expires_at < now()` trên backlog lớn giữ transaction cho tới khi job bị kill và **rollback toàn bộ** — job đỏ vĩnh viễn, backlog không giảm một hàng nào. Thay vào đó mỗi lần chạy lặp tối đa `MAX_BATCHES=50` lô, mỗi lô `BATCH_SIZE=20000` hàng (dự phòng `LIMIT` trong `ARRAY(...)`, xoá qua `nonce = ANY (…)` — `nonce` là PRIMARY KEY), mỗi câu lệnh có `statement_timeout=60000` và `lock_timeout=30000`. Vòng dừng khi một lô xoá dưới `BATCH_SIZE` (hết backlog), hoặc khi chạm một trong hai trần `MAX_BATCHES=50` / `MAX_SECONDS=600`. (Con số `LIMIT 10000` trong hai câu SQL ở trên là **runbook chạy tay**, không phải tham số của job: job dùng `BATCH_SIZE=20000`. Cùng một vị từ, khác tham số — không phải khác hợp đồng.)
  - **Chạm trần không tự nói còn backlog, nên job hỏi thẳng database.** Lô cuối có thể vừa xoá hết sạch đúng vào lúc chạm trần (ví dụ số nonce hết hạn đúng bằng `MAX_BATCHES × BATCH_SIZE`). Khẳng định `backlog_remains=true` mà không kiểm thì một kho **đã sạch** vẫn báo đỏ ở mọi lần chạy — cũng là tín hiệu sai, chỉ khác chiều. Nên sau khi chạm trần, script chạy một phép `SELECT EXISTS(… WHERE expires_at < now())` rẻ (đi qua index `expires_at`) rồi mới kết luận:
    - probe `t` (backlog **còn**) → `outcome=cap_hit` + `cap=<batches|seconds>` + `backlog_remains=true` + **exit 1**. Fail closed: một backlog lớn dần trong im lặng là đúng thứ job này sinh ra để chặn. Lần chạy kế tiếp tiếp tục từ chỗ còn lại, và người vận hành chạy tay để drain nhanh.
    - probe `f` (đã drain hết) → `outcome=ok` + **exit 0**. Chạm trần mà đã xong thì là thành công; báo đỏ sẽ buộc người trực điều tra một run đã sạch.
    - Không chạm trần (dừng vì lô rỗng hoặc lô cuối nhỏ) → `outcome=ok`, không tốn một vòng gọi nào; `| Backlog remains |` ở step summary ghi `not_probed`.
  - **Trần chỉ chứng minh ta dừng sớm, không chứng minh còn backlog.** Một job `ok` ở lần chạy hôm nay không nói hôm sau sẽ không phình; đó là lý do tần suất là một chính sách vận hành và không phải một cam kết bảo mật (xem bullet tần suất bên dưới).
  - `timeout-minutes: 25` của mỗi job lớn hơn tổng thời lượng xấu nhất **bên trong** script (preflight ≤225s + vòng lô ≤`MAX_SECONDS` + một lô cuối ≤225s + backlog probe ≤225s = 1275s < 1500s), nên không có cảnh runner kill-rollback giữa chừng. Một ngoại lệ phải biết: lần chạy đầu tiên trên runner sạch phải **pull image** trước khi script chạy, và thời gian pull đó **không** bị bất kỳ hằng số nào trong script trần. Nếu pull quá `timeout-minutes`, job chết ở trạng thái `cancelled` chứ không phải `cap_hit` — đọc `cap`/`pruned` trong log để phân biệt hai tình huống đó.
- **Hai job độc lập, không credential dùng chung.** `prune-account` là một job riêng, dùng `ecoma_account_migrator` trên `db-account` và không chạm `db-auth`; hai bên không chia sẻ secret. Vì vậy một bên hỏng thì run đỏ ở đúng bên đó, không có bên nào được báo thành công thay bên kia.
- **Tần suất:** một lần mỗi ngày (`cron` `17 3 * * *`, giờ UTC = 10:17 ICT). Đây là **chính sách vận hành, không phải một cam kết bảo mật**: nonce cũ nằm lại vẫn là nonce đã bị chiếm và vẫn chặn replay. Hàng đợi `schedule` của GitHub có thể bị trì hoãn hoặc bỏ khi tải cao, và không có SLA cho thời điểm chạy ([`04`](../../overview/04-platform-facts.md) §2.17 GH1–GH4) — đừng đọc "03:17" như một bảo đảm.
- **Quan sát được:** mỗi job in một dòng cuối `service=<auth|account> outcome=<ok|cap_hit|db_unreachable|statement_failed|identity_mismatch|invalid_dsn|not_configured|unexpected_output> pruned=<n> batches=<n> duration_s=<n> retries=<n>`, cộng một dòng `service=… batch=<n> deleted=<n> total=<n>` cho mỗi lô. Trường `pruned=`/`batches=` trong **mọi** dòng lỗi là số đếm **thật** đã xoá tới thời điểm hỏng, không phải `0` cứng — một lô đã commit rồi lô sau hỏng vẫn phải báo ra nó đã xoá bao nhiêu, vì log nói "chưa xoá gì" trong khi hàng trăm nghìn nonce đã biến mất là tín hiệu sai theo hướng nguy hiểm. Job còn ghi thêm một bảng tổng kết vào `$GITHUB_STEP_SUMMARY` (xem dòng `| Backlog remains |` ở phần trạng thái cap bên dưới), để người trực đọc được trạng thái mà không phải mở log. **Không** nonce, không chữ ký, không secret, không connection string, không thân request: projection của `DELETE` là `RETURNING 1` và được bọc trong CTE để chỉ `count(*)` ra tới stdout, nên giá trị nonce không bao giờ rời database. `DATABASE_URL` chỉ được truyền vào container **theo tên** (`docker run --env DATABASE_URL`, không `--env DATABASE_URL=…`), nên nó không bao giờ vào argv của host.
  - **Hai dòng, hai kênh, hai hình dạng.** Dòng `service=… batch=…` và dòng `service=… outcome=…` ra **stdout**. Dòng lỗi `::error::…` và cảnh báo `::warning::…` ra **stderr**. `run_or_report` in dòng lỗi **rồi** `exit 1`, nên `set -e` không kịp cắt ngang im lặng: một đường ra không có dòng `service=… outcome=…` nghĩa là một lần hỏng không đọc được, và đó là điều tệ nhất với một job không người trực. Dòng lỗi luôn kèm `what=<tên bước>` để phân biệt `identity_check`, `batch_delete` và `backlog_probe`; hai outcome `unexpected_output` khác nhau ở đúng chỗ đó.
  - **Chín outcome đầy đủ.** Ngoài tám outcome trong dòng cuối, mỗi lần thử lại in thêm một dòng `::warning::service=… outcome=retrying psql_exit=<n> attempt=<n>/<MAX_ATTEMPTS> backoff_s=<n>`. `retrying` là outcome thứ chín và **không** xuất hiện trong dòng cuối — nó chỉ là tiến độ giữa chừng, dòng cuối vẫn là `db_unreachable` nếu hết số lần thử.
- **Khi hỏng:** fail closed. Chỉ lỗi transport mới được thử lại — mã thoát `2` của `psql` (mất kết nối, bao gồm **sai password**) và `125` của `docker` (không chạy được container) — tối đa `MAX_ATTEMPTS=3` lần với backoff; mọi mã thoát khác dừng ngay ở `outcome=statement_failed`. Kết quả rỗng ở bước kiểm identity cũng là lỗi. Câu lệnh idempotent và mỗi lô là một transaction riêng, nên một run đứt giữa đường chạy lại vẫn an toàn: không có trạng thái dở dang phải sửa, chỉ còn backlog nhỏ hơn.
- **Chạy tay có kiểm soát:** `workflow_dispatch`. Guard của workflow chỉ chấp nhận ref `main`, nhưng **lớp bảo vệ thật** là deployment branch policy của Environment `nonce-prune-auth`: một dispatch từ ref khác chạy **bản workflow trên chính ref đó**, nên guard trong file không tự bảo vệ chính nó ([`02`](../../overview/02-delivery.md) §6.13, [`04`](../../overview/04-platform-facts.md) §2.17 GH6–GH8).

⚠️ **Trạng thái: workflow đã bị xoá — CHƯA có hiện thực nào.** Đặc tả dưới đây (lịch, batch, cap, outcome, runbook) là bản thiết kế đã rà kỹ, giữ lại làm **baseline tái hiện thực** cho Workstream E/delivery; hiện thực cũ (file workflow ở commit `f68105b6`) đã bị gỡ và chưa bao giờ vào `main`. Ba điều kiện dưới đây vẫn áp dụng nguyên vẹn khi tái hiện thực — db-auth chưa được provision:

1. **Branch policy của Environment — và thứ tự đặt nó TRƯỚC secret.** Khai `environment:` trong workflow khiến GitHub **tự tạo** Environment ở lần chạy đầu tiên nếu nó chưa tồn tại: không branch policy, không protection rule ([`02`](../../overview/02-delivery.md) §6.13). Nên đây **không** thể là một điều kiện "đã có sẵn trước khi workflow tồn tại". Thứ tự đúng: (a) workflow vào `main`; (b) lần chạy đầu tiên — theo lịch hoặc `workflow_dispatch` thủ công — tạo Environment ngầm và job đỏ ở `outcome=not_configured`; (c) đặt deployment branch policy **giới hạn đúng `main`** ("Protected branches", hoặc custom policy chỉ khớp `main`; **không** để mặc định "All branches"); (d) **sau cùng** mới đặt secret `DB_AUTH_MIGRATOR_URL` / `DB_ACCOUNT_MIGRATOR_URL`. Đặt secret trước branch policy là để credential `_migrator_` nằm trong một Environment mà mọi ref đều dispatch được — và ở trạng thái đó **không còn lớp fail-closed nào trong repo**.
   Branch policy này là lớp bảo vệ **duy nhất** cho credential `_migrator_`: một tài khoản ghi được vào repo có thể push một nhánh sửa workflow (kể cả xoá bước guard) rồi dispatch chính nhánh đó, nên guard trong file **không** tự bảo vệ chính nó ([`02`](../../overview/02-delivery.md) §6.13; [`04`](../../overview/04-platform-facts.md) §2.17 GH6–GH7). Không có gì trong repo kiểm được lớp này — nó phải được xác minh ngoài luồng trước khi job theo lịch được tin.
2. Secret `DB_AUTH_MIGRATOR_URL` (và `DB_ACCOUNT_MIGRATOR_URL`) trong đúng Environment đó.
3. Đường kết nối từ CI runner tới PostgreSQL của từng database, **không** mở public PostgreSQL và **không** nới firewall/network policy ([`03`](../../overview/03-operations.md) §2.1). DSN trong `DB_*_MIGRATOR_URL` **phải** ghi `sslmode` tường minh: job đặt sàn `PGSSLMODE=require`, nhưng libpq cho conninfo **thắng** environment nên DSN là nguồn quyết định — và một DSN ghi `sslmode=prefer`/`disable` sẽ hạ sàn đó xuống đúng giá trị nó ghi. Vì vậy script tự kiểm `sslmode` trong DSN và dừng ở `outcome=insecure_dsn` trước khi kết nối, thay vì tin vào sàn environment. `require` chỉ bảo đảm **có mã hoá**, không xác minh cert; posture đầy đủ (`verify-ca`/`verify-full`) vẫn **chưa chốt** theo spike S1 ([`03`](../../overview/03-operations.md) §2.1), nên đây là sàn tối thiểu chứ không phải quyết định thay S1.

⚠️ **Không đặt `required reviewers` hay wait timer trên hai Environment này.** Job chạy theo lịch không có người bấm duyệt: một required-reviewer rule sẽ làm run **treo ở trạng thái chờ** (không phải đỏ), và một job dọn dữ liệu treo mỗi ngày thì không dọn gì cả — trái với hợp đồng fail-closed ở trên, vốn chỉ đúng khi job **đỏ**. Cần kiểm soát thêm thì dùng branch policy, không dùng approval gate ([`04`](../../overview/04-platform-facts.md) §2.17 GH8).

Thiếu secret thì job **đỏ** với `outcome=not_configured` chứ không im lặng bỏ qua: một job dọn dữ liệu không chạy được là một lỗi cần thấy. Chỉ khi cả ba điều kiện trên được xác minh bằng một lần chạy thật thì trạng thái ở đây mới đổi thành `đã xác minh runtime`.

⚠️ Chưa prune thì bảng phình ra theo lưu lượng request nội bộ — đó là vấn đề **vận hành, không phải bảo mật**: một nonce cũ nằm lại vẫn là một nonce đã bị chiếm, nên nó vẫn chặn replay. Không được vì thế mà "dọn" bằng `TRUNCATE`: xoá sạch kho bằng một câu lệnh **mở lại** cửa sổ replay cho mọi envelope còn trong skew, trong khi prune theo `expires_at` thì không. Cùng lý do, không xoá theo tuổi cố định và không hạ tần suất xuống mức "chạy khi nhớ".

#### Mã lỗi và trạng thái

| Nhóm                                                                                                     | HTTP  | Ghi chú                               |
| -------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------- |
| Thiếu header, timestamp sai định dạng/ngoài skew, nonce yếu/đã chiếm, chữ ký sai hoặc sai version scheme | `401` | Không nêu lý do cụ thể trong response |
| Thân vượt 64 KiB                                                                                         | `413` | Thân request — §5.1.8                 |
| Kho nonce hoặc DB không gọi được                                                                         | `503` | Fail closed, **không** cho qua        |

Log một lần từ chối chỉ ghi `reason` (`missing_header`, `bad_timestamp`, `weak_nonce`, `replayed_nonce`, `bad_signature`, `invalid_field`, `no_secret`, `no_binding`, `db_unreachable`) cùng `event`, `route`, `method`, `status`. **Không** ghi giá trị header: `x-ecoma-internal-signature` là chữ ký HMAC, và một chữ ký trong log là giá trị còn tái dùng được trong cửa sổ skew. Cũng **không** nối `error`/message của driver `pg` vào log — message của nó có thể chứa connection string.

⚠️ **Vì sao dòng log này là một phần của cơ chế chống replay, không phải trang trí.** Response `401` **cố tình** không phân biệt lý do (một response nói `bad_signature` là một oracle dò chữ ký), nên `reason` trong log là chỗ **duy nhất** phân biệt được `replayed_nonce` — dấu vết của một lần phát lại thật — với một chữ ký sai thông thường. Cùng vậy, `503` không mang thông tin nào để phân biệt "kho nonce không gọi được" với một sự cố hạ tầng khác: `reason: 'db_unreachable'` là dấu vết duy nhất.

⚠️ **Tập `reason` không giống nhau ở hai chiều**, vì mỗi bên có nhánh riêng **trước khi** chạm `verifyRequest`: `auth` (`apps/auth/src/main.ts`) chỉ sinh mã của lib cộng `db_unreachable`; `account` (`apps/account/server/middleware/internal-auth.ts`) ghi thêm `no_secret` và `no_binding`. Hai mã đó không tồn tại ở `auth` vì thiếu secret/binding là lỗi nạp config ở đó (`config.ts` ném), không phải một nhánh từ chối.

Cả hai chiều ghi ở cùng một mức (`log`, không phải `warn`) để một truy vấn theo mức không bỏ sót một nửa sự kiện. `account` đi qua `writeLog` (`key=value`), `auth` ghi một dòng JSON — định dạng khác nhau vì `auth` không có sink nào dùng chung với `apps/account`, nhưng **tập trường là cùng một hợp đồng**, và dòng của `auth` là tập đóng: `route`/`method`/`status` là hằng của route, `reason` là mã trong union.

## 4. Key custody và rotation

⚠️ **Lịch xoay chưa chốt** ([`01-architecture.md`](./01-architecture.md) §9). Những gì đã chốt và những gì còn mở:

**Đã chốt:**

- `db-auth` lưu **chỉ metadata**: `kid`, algorithm, status, `not_before`, `expires_at` (`auth.signing_keys`, migration 0007). **Private key không lưu trong `db-auth`** — đó là database có thể bị restore lên máy mới, bị đọc qua bản sao và lọt vào tay operator có quyền đọc.
- **Private key là Worker Secret `AUTH_SIGNING_KEY`** (PKCS#8 PEM) cùng `AUTH_SIGNING_KEY_ID` — cả hai bắt buộc, `apps/auth/src/config.ts` ném lúc khởi động nếu thiếu. Provider ký JWT ES256 (`id_token_signed_response_alg` pin `ES256` cho mọi client, TTL ID token 300 giây).
- JWKS phục vụ **public key** tại `/jwks.json`.
- Xoá `kid` khỏi JWKS **trước** khi phát hành bản thay thế.

**Chưa chốt (có trigger):**

| Mục                  | Vì sao cần quyết định trước                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------- |
| Lịch xoay và overlap | Token ký bằng key cũ phải còn hợp lệ tới hết TTL                                              |
| TTL của key          | Phải ≥ TTL access token, nếu không token đang sống không verify được                          |
| Compromise response  | Xoá `kid` là một nước, nhưng token đã ký bằng key đó vẫn là chữ ký hợp lệ cho tới khi hết hạn |

⚠️ **Rủi ro khi key bị lộ: token đã cấu hình bằng key đó vẫn được chấp nhận tới hết hạn** dù đã xoá khỏi JWKS — và ở mô hình verify offline, resource server **không hỏi được** nên không có cách nào biết `kid` đã bị xoá. Xoá `kid` chặn **token mới**, không thu hồi **token cũ**. Muốn thu hồi cả token cũ thì phải dựa vào revocation control plane ([`01-architecture.md`](./01-architecture.md) §6.5), không dựa vào JWKS.

## 5. Environment isolation

| Môi trường | Database                      | Credential                         |
| ---------- | ----------------------------- | ---------------------------------- |
| Production | `db-auth`                     | `ecoma_auth_runtime` thật          |
| Staging    | Database riêng, cùng instance | Role staging riêng                 |
| PR Preview | DB preview riêng/mock         | **Không** có production credential |

- **Không bao giờ** bind Hyperdrive production vào Preview.
- ⚠️ **Cả hai hướng binding đều là đường xác thực, không phải read-only.** `account` → `auth` (`POST /internal/session/verified`) là nơi `auth` nhận danh tính đã xác minh; `auth` → `account` (`GET /internal/account/status`) là control point fail-closed lúc phát hành ([`01-architecture.md`](./01-architecture.md) §5.1, §6.0). Worker đích giữ Hyperdrive production nên Preview gọi binding là **ghi vào dữ liệu production**. **Login/consent E2E và kiểm tra trạng thái account đều không chạy dependency mode A** — dùng Mode C (mock, mặc định cho smoke) hoặc Mode B với service token riêng theo môi trường ([`02` §5.3](../../overview/02-delivery.md)). Mỗi môi trường khai báo binding tường minh; thiếu binding thì fail closed, không rơi về đường không xác thực.
- ⚠️ **Staging không phải bằng chứng HA.** `db-auth` và `db-account` cùng nằm trên **một PostgreSQL instance**, nên staging **không** kiểm chứng được failure domain độc lập — sập instance là sập cả hai service identity cùng lúc ([`03` §3.2](../../overview/03-operations.md), [`03` §3.2c](../../overview/03-operations.md)). Một run staging xanh chứng minh logic và contract chạy đúng, **không** chứng minh tách lỗi. Muốn kiểm chứng HA thì phải theo trigger và tier ở [`03` §6](../../overview/03-operations.md).

## 6. Hyperdrive

- Query cache **OFF** (HD3/HD4 → [`01` invariant 14](../../overview/01-architecture.md)). Đặc biệt quan trọng ở `auth`: cache trả kết quả cũ cho _authorization transaction đã consume_ hoặc _token đã thu hồi_ là lỗi bảo mật, không phải lỗi hiệu năng.
- Config tách biệt để **repoint được độc lập** khi DR.
- Ngân sách connection tính theo từng config (HD9/HD13); tách `identity` **nhân đôi** số config → [`03` §2.1](../../overview/03-operations.md).
- Không advisory lock / `LISTEN`/`NOTIFY` / SQL-level `PREPARE` (HD6).

## 7. Observability

- **Không log** token, `code_verifier`, refresh token, `account_session_ref`, client secret hay assertion. Log chỉ chứa whitelisted fields (event, route, `client_id`, `sub`, `kid`, error code).
- **Không** phải serving-path dependency.

Metrics (đề xuất):

| Metric                                                 | Ý nghĩa                                                                                         |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `authorize_requests_total{outcome}`                    | `success`/`denied`/`invalid_request`/`error`                                                    |
| `token_requests_total{grant_type,outcome}`             | Phát hiện việc dùng grant type bị cấm (Implicit/ROPC) hoặc PKCE fail                            |
| `codes_issued_total` / `codes_reused_total`            | `codes_reused_total > 0` là tín hiệu nghi vấn — code single-use nên không bao giờ được dùng lại |
| `refresh_reuse_detected_total`                         | Dấu hiệu refresh token bị lộ                                                                    |
| `tokens_issued_total` / `tokens_revoked_total{reason}` | Theo dõi thu hồi                                                                                |
| `revocation_checks_total{outcome}`                     | `outcome=fail_closed` tăng → revocation control plane có vấn đề                                 |
| `contract_errors_total{target}`                        | Back-channel lỗi                                                                                |
| `reconciliation_lag_seconds`                           | Độ trễ giữa thay đổi ở `account` và projection ở `db-auth`                                      |
| `db_query_duration` / pool size                        | Đường DB                                                                                        |

⚠️ **`codes_reused_total` và `refresh_reuse_detected_total` không phải metric "bình thường".** Cả hai đều là dấu hiệu tấn công hoặc bug; giá trị khác 0 cần điều tra, không aggregate bỏ qua.

## 8. Alerting

| Điều kiện                                           | Mức     | Ý nghĩa                                                                                  |
| --------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `db-auth` không ghi được                            | Page    | Toàn bộ authorization và token issuance lỗi                                              |
| `refresh_reuse_detected_total > 0`                  | Page    | Refresh token có thể đã bị lấy; cần thu hồi family và điều tra                           |
| `codes_reused_total` tăng                           | Page    | Authorization code bị replay hoặc bug single-use                                         |
| `revocation_checks_total{outcome=fail_closed}` tăng | Page    | Revocation control plane không trả lời được — fail closed đang chặn user                 |
| Tỉ lệ `invalid_request` tăng vượt ngưỡng            | Warning | Sai redirect URI, thiếu PKCE, thiếu `state`, hoặc client bug                             |
| Grant type bị cấm xuất hiện                         | Warning | Client đang thử Implicit/ROPC — có thể là client cũ hoặc tấn công                        |
| `reconciliation_lag_seconds` vượt ngưỡng            | Warning | `auth` không học kịp trạng thái account                                                  |
| Tỉ lệ 5xx tăng khi `account` down                   | Warning | Back-channel đang fail closed như thiết kế; theo dõi **thời lượng**, không phải từng lần |
| JWKS không có key khả dụng                          | Page    | Token mới không ký được                                                                  |

## 9. Failure modes

| Sự cố                                                                                     | Hành vi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Đóng băng |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **`db-auth` down**                                                                        | `auth` 503. `account` vẫn phục vụ session và account management — mất token authority không được phép thành mất account                                                                                                                                                                                                                                                                                                                                                                                                            | Không     |
| **`account` down**                                                                        | Login/consent fail — `auth` **fail closed**, không cấp code. Token đã cấp cho client **vẫn hợp lệ theo mô hình token đã chốt** ([`01-architecture.md`](./01-architecture.md) §6.1); không có degraded path cho authorization mới                                                                                                                                                                                                                                                                                                   | Không     |
| **Back-channel contract down** (`account` → `auth`)                                       | **Fail closed** — không cấp code. Đây là đường xác thực, không có degraded path                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Không     |
| **Revocation control plane unavailable**                                                  | **Fail closed tại phát hành** (điểm kiểm soát A) — trạng thái thu hồi unknown ≠ active, nên không phát hành token. ⚠️ Fail closed **không** áp dụng cho resource server verify offline — ở đó không có lệnh gọi nào để hỏi ([`01-architecture.md`](./01-architecture.md) §6.1). Đây là hành vi đúng, không phải sự cố để "fix bằng cách cho qua"                                                                                                                                                                                   | Không     |
| **Toàn instance PostgreSQL/VPS down**                                                     | `auth` 503 — cùng một sự kiện với `account` ([`03` §3.2](../../overview/03-operations.md))                                                                                                                                                                                                                                                                                                                                                                                                                                         | Có        |
| **Signing key bị lộ**                                                                     | Xoá `kid` khỏi JWKS **trước** (chặn token mới), phát hành bản thay thế **sau**, **và** ghi `token_revocations` mức toàn subject. ⚠️ Xoá `kid` một mình **không** vô hiệu token đã cấu ở verifier đã cache JWKS; và ở mô hình verify offline, ghi `token_revocations` **không** có tác dụng với resource server vì nó không hỏi nguồn thu hồi đó — nó chỉ giữ `auth` không cấp token mới. **Không** tuyên bố containment trước khi cả hai điều kiện ở §11.1 thỏa (runbook §11.1, [`01-architecture.md`](./01-architecture.md) §6.5) | Không     |
| **Token tự ký bằng key bị lộ**                                                            | Thu hồi theo subject **không** chặn được — attacker ký với `sub` tuỳ ý. Cách duy nhất là thay key, và hiệu lực phụ thuộc cache của verifier; hạ TTL **không** rút ngắn `exp` của token đã cấp (§11.1)                                                                                                                                                                                                                                                                                                                              | Không     |
| **Consent/authorization result bị delay, replay hoặc retry**                              | CAS consume → lần hai bị từ chối; không cấp code thứ hai                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Không     |
| **`__Host-auth-browser` cookie bị mất** (xoá cookie, đổi trình duyệt, sang thiết bị khác) | Bước push và `/authorize/complete` bị từ chối; browser bắt đầu `/authorize` mới. ⚠️ Đây **không** phải sự cố xác thực — cookie chỉ chứng minh quan hệ browser↔transaction, không chứng minh user đã đăng nhập ([`01-architecture.md`](./01-architecture.md) §5.3)                                                                                                                                                                                                                                                                  |
| **Push bị từ chối vì `browser_confirmed` chưa thoả**                                      | Transaction không bind danh tính; chính là hành vi chống pre-binding. Điều tra bằng cách hỏi user đã mở `/authorize/confirm` chưa, **không** bằng cách nới điều kiện                                                                                                                                                                                                                                                                                                                                                               |
| **Hết hạn rotation `K_auth`**                                                             | Xoá khóa cũ là tác vụ theo lịch, **có điều kiện** — chỉ khi mọi transaction dùng `key_version` đó đã hết TTL ([`01-architecture.md`](./01-architecture.md) §5.6)                                                                                                                                                                                                                                                                                                                                                                   |
| **`account` đã suspend nhưng event chưa tới**                                             | Chặn lần phát hành kế tiếp **nếu** nó đọc trạng thái sau commit — race in-flight vẫn tồn tại ([`01-architecture.md`](./01-architecture.md) §6.0). Độ trễ tối đa chấp nhận được chưa chốt                                                                                                                                                                                                                                                                                                                                           | Không     |

### 9.1 Isolation ≠ availability

Hai database trên một instance tách được **authorization blast radius** — hỏng logic `db-auth` không làm sập `account` — nhưng **không** tách được failure domain. `db-auth` down là `auth` down; instance PostgreSQL/VPS down là **cả hai** service down ([`03` §3.2](../../overview/03-operations.md)).

## 10. Restore

⚠️ **`pg_dumpall` dump toàn cluster** (`04` PG1) và thường cần superuser (PG2) → hai database identity **luôn restore cùng nhau**. Cần **restore path độc lập theo database** cho lớp "chỉ một DB hỏng"; WAL/PITR là lớp crash-recovery chung.

| Tình huống                                    | Hành vi                                                                                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db-auth` mất, `db-account` còn               | `auth` unavailable. Account người dùng vẫn đăng nhập được. **Mọi grant cũ coi như mất** — không có authority để kiểm chứng chúng còn sống hay không                                                     |
| `db-account` mất, `db-auth` còn               | `account` unavailable. Grant còn nguyên giá trị → **thu hồi hàng loạt** grant của các account mất **trước khi cho traffic trở lại** ([`../account/03-operations.md`](../account/03-operations.md) §9.2) |
| `db-auth` restore từ điểm cũ hơn `db-account` | `db-auth` có thể chứa token đã bị thu hồi ở phía kia, hoặc grant cho account không còn tồn tại. **Reconcile hai chiều trước khi mở traffic**                                                            |
| Cả hai mất                                    | Rebuild theo [`03` §3.3](../../overview/03-operations.md)                                                                                                                                               |

⚠️ **Restore lệch thời điểm là trạng thái không an toàn theo mặt authorization.** Grant chỉ resolve được nếu `db-account` có account tương ứng tại cùng thời điểm. Restore hai database từ **cùng một restore point** là bắt buộc, và sau đó phải reconcile — không coi dữ liệu là hợp lệ chỉ vì nó từng tồn tại.

## 11. Runbook

| Tình huống                                    | Bước                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Signing key bị lộ**                         | (1) Xoá `kid` khỏi JWKS **ngay** — chặn token **mới** trước. (2) Phát hành key thay thế. (3) **Ghi `token_revocations` mức toàn subject** — có tác dụng **tại `auth`** (không cấp token mới) và tại verifier **có** kiểm nguồn thu hồi; ⚠️ **không** có tác dụng với verifier JWT offline vì nó không hỏi ([`01-architecture.md`](./01-architecture.md) §6.5). (4) **Hạ TTL access token cho các token cấp sau này** — ⚠️ việc này **không** rút ngắn `exp` của token đã được cấp với TTL dài, nên nó **không** thu hẹp được cửa sổ chấp nhận token cũ. **Sau đó, hai việc theo dõi incident** (không thay thế 4 thao tác trên và **không** phải điều kiện containment — §11.1): **(5)** rà audit, xem token đã phát hành từ thời điểm nghi ngờ lộ, để ước lượng cửa sổ bị xâm nhập; **(6)** thu hồi grant/refresh family liên quan tại `auth` — tác dụng thuộc phía `auth`, không phải phía resource server verify offline |
| **Revocation system outage**                  | Fail closed theo [`01-architecture.md`](./01-architecture.md) §6. Không có degraded path "cho qua" — đó là việc biến sự cố khả năng sẵn có thành mất quyền kiểm soát. Báo incident; phục hồi rồi mới mở lại                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Phát hiện token theft**                     | Thu hồi refresh family (reuse detection hoặc chủ động), ghi `token_revocations` cho subject, kiểm audit phát hành token quanh thời điểm bất thường                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Client bị lộ `client_secret`**              | Rotate secret; cân nhắc thu hồi grant của client đó — tùy chính sách, chưa chốt ([`01-architecture.md`](./01-architecture.md) §9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **`db-auth` hỏng logic**                      | Đóng băng ghi → restore PITR sang instance mới → verify invariant qua Hyperdrive → repoint config `db-auth` → **reconcile với `db-account`** → mở lại                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Account bị suspend nhưng `auth` chưa biết** | Chặn tại thời điểm phát hành; chạy reconciliation để đồng bộ projection; kiểm outbox `account` có phát chưa                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Restore lệch thời điểm**                    | Đóng băng cả hai service; restore từ cùng restore point; reconcile hai chiều trước khi mở traffic                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### 11.1 Signing key bị compromise — bốn thao tác khác nhau, và điều kiện tuyên bố containment

⚠️ **Bảng ở §11 là bản tóm tắt của §11.1, và nó phải có cùng ngữ nghĩa với §11.1.** Khi hai chỗ lệch nhau, §11.1 là canonical; sự lệch đó là bug tài liệu, không phải hai quy trình khác nhau.

| #   | Thao tác                                          | Chặn được cái gì                                                                        | **Không** chặn cái gì                                                          |
| --- | ------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | **Ngừng ký bằng key bị lộ** (xoá `kid` khỏi JWKS) | Token **mới** ký bằng key đó, kể cả do attacker tự ký                                   | Token ký bằng key đó đã tồn tại; token ký bằng key khác                        |
| 2   | **Phát hành key thay thế**                        | Token mới ký bằng key mới                                                               | Không tự động làm token cũ hết hiệu lực                                        |
| 3   | **Ghi `token_revocations` mức toàn subject**      | Token đã cấu, **tại verifier có kiểm nguồn thu hồi**; và giữ `auth` không cấp token mới | Verifier verify offline — nó **không** hỏi nguồn thu hồi này                   |
| 4   | **Hạ TTL access token cho token cấp từ giờ**      | Rút ngắn cửa sổ của các token **được cấp sau thời điểm đó**                             | **Không** ảnh hưởng token đã được cấp với TTL dài — `exp` đã ký không đổi được |

**Sau khi làm 1–4** — hai việc theo dõi incident, không thay thế bốn thao tác trên và **không** phải điều kiện containment:

5. **Rà audit** — token đã phát hành từ thời điểm nghi ngờ lộ; dùng để ước lượng cửa sổ bị xâm nhập, không dùng để kết luận token nào còn dùng được.
6. **Thu hồi grant liên quan** — thu hồi refresh family và grant của subject bị ảnh hưởng tại `auth`; tác dụng thuộc phía `auth`, không phải phía resource server verify offline (cùng giới hạn với bước 3).

⚠️ **Bước 3 là bước dễ bị hiểu sai nhất, và hiểu sai là nguy hiểm.** Ghi `token_revocations` chỉ có tác dụng với verifier **có hỏi** nguồn thu hồi đó. Ở mô hình verify offline, resource server **không** hỏi — nó chỉ kiểm chữ ký. Ghi bản ghi thu hồi cho một mô hình không dùng nó là **hành động không có tác dụng**, dù nó trông như đã xử lý.

⚠️ **Không được tuyên bố "đã thu hồi token" nếu mô hình verify là offline.** Trong mô hình đó, hành động đúng là ghi `token_revocations` để _phía `auth`_ không cấp token mới và để reconciliation có đường truy vết — chứ không phải để "thu hồi" ở phía resource server.

**Kẻ tấn công dùng private key bị lộ để tự ký token** — đây là tình huống mà thu hồi theo subject **không** bao phủ:

- Attacker tự ký token với `sub` **tuỳ ý** — kể cả `sub` chưa từng tồn tại, hoặc thuộc tài khoản mà hắn không hề biết.
- Vì vậy "ghi `token_revocations` cho các subject đã biết" **không** chặn được token này. Danh sách subject của hệ thống không phải danh sách subject attacker có thể dùng.
- Cách duy nhất chặn được là **thay key** — và ở mô hình offline, hiệu lực của việc thay key phụ thuộc cache của verifier.

**Điều kiện để tuyên bố sự cố đã được containment** — phải thỏa **cả hai**, không được chỉ một:

| Điều kiện                                                                      | Cách xác minh                                                                                                                                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Key bị lộ không còn ký được token nào** mà **bất kỳ** verifier nào chấp nhận | Mọi cache JWKS đã hết hạn **hoặc** đã purge chủ động. ⚠️ Ở mô hình offline đây là **cửa sổ theo cache**, không phải thời điểm bạn quyết định — không có cách nào đóng nó ngay lập tức |
| **Token đã cấu hợp lệ đã hết hiệu lực**                                        | TTL đã trôi qua, **hoặc** verifier có mạch kiểm thu hồi và thấy bản ghi ở bước 3                                                                                                      |

⚠️ **Nếu mô hình verify offline thì không thể tuyên bố containment ngay sau khi làm bước 1–6.** Phải chờ hết cửa sổ cache của mọi resource server. Trong thời gian đó, kết luận đúng là **"đã giới hạn khả năng cấp token mới, chưa chặn được token tự ký"** — ghi vậy vào hồ sơ incident, đừng ghi "đã thu hồi".

**Quyết định đã có trong code, phản chiếu vào runbook** (mô hình verify và TTL — [`01-architecture.md`](./01-architecture.md) §6.2, §9):

| Đã chốt                                | Giá trị                                                                                                                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mô hình verify của resource server** | Offline JWT: access token là JWT ES256 TTL 300 giây; **không** có `/introspect`, có `/revocation` — bước 3 có tác dụng tại `auth` và tại verifier có kiểm nguồn thu hồi, không có tác dụng với verifier offline |
| **TTL access token**                   | 300 giây (`apps/auth/src/oidc/provider.ts`) — cửa sổ chấp nhận token cũ sau containment tối đa là 5 phút                                                                                                        |

| Cần chốt                    | Vì sao nó quyết định cả runbook này                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Cơ chế purge cache JWKS** | Có chủ động được không, hay phải chờ HTTP cache header hết hạn. Quyết định này quyết định "đã containment" sớm hay muộn |

⚠️ **Không được giả định `/introspect` hay denylist đã tồn tại.** Provider **không** mount `/introspect` (`features.introspection` tắt) và `/revocation` chỉ là endpoint thu hồi chủ động do client gọi (RFC 7009) — không phải denylist mà verifier offline tự hỏi. Giới hạn ở mô hình offline là giới hạn **thật** — không phải thiếu sót của tài liệu.

## 12. Operational invariants

1. Runtime role chỉ DML trên `db-auth`, không `CONNECT` sang `db-account` (§3.1).
2. Migrator role chỉ sống trong CI secret store; không bao giờ là Worker secret.
3. Query cache OFF trên Hyperdrive config `db-auth`.
4. Không Hyperdrive config nào của identity trỏ production origin từ Preview.
5. Migration history độc lập với `db-account`; rollback Worker **không** rollback database.
6. `db-auth` có restore path độc lập **và** được drill hằng tháng; restore hai database dùng cùng restore point rồi reconcile.
7. Mất `db-account` khiến grant mất ý nghĩa → thu hồi hàng loạt trước khi cho traffic trở lại.
8. Private signing key không nằm trong `db-auth`; chỉ metadata.
9. Revocation unavailable → fail closed; không có degraded path.
10. Không token, `code_verifier`, refresh token, `account_session_ref` hay secret nào xuất hiện trong log, audit, alert hay Queue message.
11. **Xoá `kid` không đồng nghĩa đã thu hồi.** Sự cố signing key chỉ được tuyên bố containment khi **cả** cache JWKS của mọi resource server đã hết hạn/purge **và** token đã cấu đã hết hiệu lực (§11.1).
12. Ghi `token_revocations` chỉ có tác dụng ở nơi **có** hỏi nguồn thu hồi. Không được mô tả nó là đã thu hồi token ở resource server verify offline.

Architectural invariants → [`01-architecture.md`](./01-architecture.md) §8 · [`docs/overview/01-architecture.md`](../../overview/01-architecture.md) §9.
