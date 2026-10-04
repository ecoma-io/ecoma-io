# 02 — Delivery

> **Phạm vi:** Code được validate, test, migrate, release, deploy và rollback như thế nào?
> Topology, data ownership, invariant → `01-architecture.md` · backup/DR, observability, runbook → `03-operations.md` ·
> platform fact → `04-platform-facts.md` · Nx taxonomy, DDD, testing architecture → `05-code-architecture.md` · runbook của service → `services/<service>/`.

---

## 1. Delivery Flow

```text
local (Lefthook)
  → Nx affected
  → validation (lint · typecheck · test · contract check · security scan)
  → build
  → migration gate (khi storage schema đổi)
  → deploy Worker
  → post-deploy verification (promotion gate)
```

- **Gate bắt buộc:** contract check (§3), migration gate (§3), promotion gate (§7.1). Gate fail → dừng pipeline.
- `nx affected` quyết định unit nào đi qua pipeline; release một unit không đụng unit khác.
- Mọi deploy unit là Worker (`01` §1): không image, không registry, không GitOps reconcile. Deploy là lệnh có trả về — bước kế tiếp chạy ngay khi lệnh thành công.

---

## 2. Git and Nx

**Trunk-Based Development** trên `main`, **Conventional Commits** với Commitlint: `fix`/`feat` bắt buộc scope là Nx project; bot types/scopes được whitelist (`chore(deps)`, `chore(release)`…); cấm `BREAKING CHANGE`/`!` ngoài policy.

- **Lefthook** chạy lint, typecheck, test, build, secret scan trước commit.
- **Nx affected** giảm số task phải chạy; **Nx project graph** xác định phụ thuộc; **Nx Remote Cache** reuse kết quả task (trusted CI được ghi, PR/fork không — §6); GitHub Actions cache cho dependency/tooling của CI.
- Quét: **Semgrep**, **Gitleaks**; **Renovate** cập nhật dependency; review hỗ trợ bằng **Open Code Review**.
- Module-boundary lint enforce ranh giới project — không lặp chi tiết ở đây.

Taxonomy (`apps`/`libs`/`tests`) và cấu trúc Nx project → [`05-code-architecture.md`](./05-code-architecture.md).

---

## 3. Contracts và Database Migration

### Contracts

| Loại contract           | Công cụ                                                   | Gate                                       |
| ----------------------- | --------------------------------------------------------- | ------------------------------------------ |
| API nội bộ              | Pact (consumer-driven)                                    | publish + verification                     |
| API công khai `llm-api` | OpenAPI + `oasdiff` + SDK conformance                     | protocol compatibility (`01` invariant 15) |
| Async events            | JSON Schema / AsyncAPI-compatible + contract test         | producer/consumer compatibility            |
| DB compatibility        | `drizzle-broker` (`schema.contract.json` theo DB project) | `can-i-deploy`                             |

- Lifecycle: **publish → verification → compatibility (`can-i-deploy`) → promotion.** Breaking change bị chặn trước khi deploy bởi Contracts Registry.
- `<bc>-contracts` là boundary artifact, không phải DDD layer → `05-code-architecture.md`. Contracts Registry chỉ là thành phần delivery gate, không phải specification ở đây.

**Track PostgreSQL** (`db-identity`, `db-payment`, `db-llm-gateway`):

- Migration từ **CI runner**, pin `drizzle-kit`; normalize snapshot → `schema.contract.json`; mỗi app version khai báo `[minSchema, maxSchema]`; registry ghi version đang chạy và rollback window (toàn bộ là Worker version).
- Migration chạy **một lần trong CI runner**, kết nối thẳng database bằng PostgreSQL client, giữ **advisory lock**, dùng role _migrator_ của DB đó (role runtime của app chỉ có DML).
- Phân loại Safe/Unsafe. **Expand** chạy trước rollout; **contract** chỉ chạy sau rollback window và khi bản cũ nhất không còn live.
- Không down-migration → **forward-fix**. Backfill là job idempotent riêng, có checkpoint và resume.
- Trước migration production: on-demand base backup, ghi mốc thời gian/LSN vào release record (`03` §3.1).
- `can-i-deploy --force` chỉ qua GitHub Environment approval + audit log.

**Track D1** (`push`, `push-job`, `mail`, `mail-job` — mỗi service một D1):

- Migration là file `.sql` trong `migrations/` của service, áp dụng bằng `wrangler d1 migrations apply`; bảng `d1_migrations` của chính DB ghi tập đã chạy (`04` DB8).
- Tuân thủ expand → compatible rollout → contract (`01` invariant 10); không down-migrate.
- Chạy trong CI runner với Wrangler token scoped theo môi trường — **không** qua Hyperdrive, **không** qua PostgreSQL migration runner. Contract tooling riêng cho D1 chưa chốt (§12).

### 3.1 Migration runner phải độc lập topology

- **Chốt: migration PostgreSQL là CI job, dùng PostgreSQL client kết nối thẳng.** Cần đúng endpoint, credential, tên database — có sẵn ở mọi database hosting tier (`03` §6). Đổi tier chỉ đổi biến môi trường, lệnh migration không đổi.
- Loại trừ mọi đường chạy migration từ trong Worker: Hyperdrive **không hỗ trợ advisory lock** (`04` HD6) nên không giữ được lock chống chạy chồng; `cloudflare:sockets` chỉ plaintext TCP (`04` VP2) — không có TLS cho credential; Worker cron chạy migration nghĩa là migration phụ thuộc application plane.
- Đường vào database này là **admin path** riêng cho CI, không phải application access path (`01` §1.1). Credential `_migrator` chỉ tồn tại trong CI secret store, không bao giờ là Worker secret (§6).

---

## 4. Môi trường

Baseline VPS database-only của ecoma — quyết định của ecoma, không phải platform minimum; validate bằng load test + restore drill → `03` §2.1.

| Môi trường       | Workers            | PostgreSQL                                                      | D1                                                          | Kích hoạt         |
| ---------------- | ------------------ | --------------------------------------------------------------- | ----------------------------------------------------------- | ----------------- |
| **Local**        | Wrangler/Miniflare | qua Docker Compose hoặc mock                                    | D1 local hoặc mock                                          | Dev               |
| **PR Preview**   | Worker Preview     | mock hoặc DB preview tách biệt; **không bao giờ** DB production | namespace/DB riêng theo PR; **không bao giờ** D1 production | PR                |
| **CI ephemeral** | —                  | Testcontainers PostgreSQL                                       | Miniflare D1                                                | PR (khi affected) |
| **Staging**      | Workers `stg-*`    | database staging riêng                                          | D1 staging riêng                                            | Merge `main`      |
| **Production**   | Workers production | database production                                             | D1 production                                               | Merge Release PR  |

**Database staging là tối ưu chi phí, không phải chiến lược availability:**

- Staging dùng chung database host với production (`03` §6) → **không** phải HA test, không dùng để kiểm chứng failure domain độc lập.
- Load test (k6) chạy ngoài giờ cao điểm hoặc trên host staging riêng.
- Khi contention xảy ra production được ưu tiên; tách host staging là **operational trigger** (`03` §6), không phải phase roadmap.

---

## 5. Preview (Worker Preview)

### 5.1 Nguyên tắc

- **Mỗi unit chỉ có một Worker identity lâu dài; PR không tạo Worker mới.** Mỗi PR tạo một **Worker Preview** dưới identity đó — `llm-api` không ngoại lệ.
- Preview có code, vars, secrets, bindings, URL, observability riêng; **không kế thừa cấu hình production**; cấu hình nằm trong `previews` block.
- Preview là **untrusted runtime** (`01` §6) và không ghi được storage production — enforced bằng binding, không bằng quy ước (`01` invariant 2).

### 5.2 Isolation theo tài nguyên

| Tài nguyên         | Hành vi Preview                               | Chính sách ecoma                                                                  |
| ------------------ | --------------------------------------------- | --------------------------------------------------------------------------------- |
| Worker code/config | Isolated                                      | Mặc định                                                                          |
| KV, R2             | Cùng namespace/bucket = cùng data             | PR cần isolation phải có namespace/prefix riêng                                   |
| **D1**             | Binding trỏ DB nào thì ghi DB đó              | **Không bao giờ bind D1 production vào Preview**                                  |
| **Hyperdrive/PG**  | Binding trỏ origin nào thì ghi origin đó      | **Không bao giờ bind Hyperdrive production vào Preview**                          |
| Queue              | Produce được, **không** consume được          | Chỉ bind queue riêng/test; không thiết kế E2E dựa vào Preview consumer (`04` QU7) |
| Service Binding    | Gọi **production deployment** của Worker đích | Không coi là Preview-to-Preview isolation                                         |
| Workflow, Cron     | Target production                             | Không dùng làm Preview dependency                                                 |

- Chặn bằng binding: mọi environment phải khai báo `hyperdrive` / `d1_databases` / `kv_namespaces` / `queues` **tường minh**, không kế thừa mảng top-level; `previews` không được khai báo `id`/binding của production — lint config kiểm (`01` invariant 2).

### 5.3 Dependency mode (CI khai báo cho từng app)

| Mode | Cách                                         | Dùng khi                                                                  |
| ---- | -------------------------------------------- | ------------------------------------------------------------------------- |
| A    | Preview → Service Binding → **production** B | Đã chứng minh tương thích, read-only/được bảo vệ — theo quy ước và review |
| B    | Preview A → HTTPS + preview auth → Preview B | Cần test cross-service thật; B có Access hoặc service token               |
| C    | Mock                                         | Mặc định cho PR smoke                                                     |

Từ D2 trở đi mặc định Mode C (hoặc A); không E2E chéo giữa các Preview. **Preview routing** (router động cho preview trên cùng domain) chưa chốt — xem mục 12.

### 5.4 Hostname, cleanup, auth

- **Hostname:** ưu tiên `workers.dev`; custom domain chỉ khi UX cần origin ổn định, sau khi xác minh certificate/Access/routing (§12).
- **Cleanup:** không dựa vào `pull_request: closed`. **Worker Janitor** (cron ~6 giờ) quét tài nguyên theo tag/prefix PR, đối chiếu trạng thái PR qua GitHub API; PR đóng hoặc tuổi > 7 ngày → xoá Preview và dọn resource.
- **Auth:** `MockOidcAdapter` ký JWT cùng format production (trang chọn user/role từ seed data), bảo vệ 3 lớp. Org strict service token auth là mặc định (`04` AC1) — chỉ **Service Auth policy** cấp quyền.
- Giới hạn platform (số lượng Preview, retention, hành vi Queue preview) → `04-platform-facts.md`; Preview của service riêng → `services/<service>/03-operations.md`.

---

## 6. Trust boundary, secrets

```text
PR source ──build──► Untrusted artifact ──► Trusted deploy workflow ──► Preview / Staging / Production
                      (no secrets)           (protected branch,          (credential theo environment)
                                              environment-scoped)
```

1. PR build không có secret; PR từ fork không có deploy credential.
2. Trusted workflow chỉ lấy artifact đã build; credential theo GitHub Environment (`preview`, `staging`, `production`).
3. Environment production chỉ cho `main`/Release PR + reviewer.
4. Preview runtime chỉ có preview/test credentials; không bind production secret.
5. Cloudflare management token không vào Worker runtime.
6. **Không có control plane nào kéo workload từ Git** — deploy bằng Wrangler API token scoped, không orchestrator, không manifest.
   > **Ngoại lệ có chủ đích:** D1 migration (§3) chạy qua Wrangler API vì D1 không có đường kết nối trực tiếp. Đây là schema change cho database managed, không mở cửa cho pattern GitOps/manifest khác.
7. **Quản lý secret: native Worker Secrets.** Đặt bằng `wrangler secret put` (deploy) hoặc `wrangler versions secret put` (chỉ stage), theo môi trường deploy; không có service trung gian. Vì `wrangler secret put` **deploy ngay lập tức** (`04` WS1), xoay vòng secret phải đi qua `wrangler versions secret put` + `versions deploy` để không bypass delivery gate. Secrets **không kế thừa** giữa named environments (`04` WS3) — mỗi environment set riêng; `secrets.required` khai báo danh sách bắt buộc.
8. Worker **version** là đơn vị bất biến (`04` WV1); rollback chọn version đã publish, không rebuild; không image, không digest.
9. Access service token tách theo environment; Preview không giữ token production. Chi tiết rotate → `03` §8.
10. **Nx remote cache:** trusted CI được ghi shared cache; PR/fork **không** có write credential. Credential lấy từ local secret store / GitHub Environment, không commit vào Git → [`services/cache/03-operations.md`](../services/cache/03-operations.md).
11. **Credential của CI runner:** migration runner (§3.1) giữ credential `_migrator` trong CI secret store — không tồn tại trong bất kỳ Worker nào.

**Pulumi state:** R2 bucket riêng theo environment, token giới hạn theo bucket, passphrase riêng (vị trí/credential → `03` §3.1).

---

## 7. Release và rollout

- **Nx Release**, chạy hoàn toàn trong GitHub Actions: Release PR tự dựng (`nx release version` + changelog) → merge → tag `{projectName}@{version}`. Publish không dùng cho app/service — deploy là job riêng, `wrangler deploy`, sinh Worker version bất biến (`04` WV1).
- Mỗi deployment có file cấu hình riêng để rollout độc lập. Không có bước bất đồng bộ nào — `wrangler deploy` trả về khi deploy xong.
- Thứ tự khi thêm unit mới: **Infra → storage expand → `llm-api` → Workers → Router → promotion gate.** Sau đó mỗi release chỉ rollout unit bị ảnh hưởng.
- **Rollback tại release:** chọn Worker version đã publish, không rebuild, không revert Git (`04` WV1–WV3); chi tiết → §8.
- Chuỗi storage: **expand → deploy → migrate (nếu cần) → verify → enable → contract** — contract chỉ chạy sau rollback window (§3).

### 7.1 Làn Worker và promotion gate

- **Atomic stateless:** version mới phục vụ 100% khi promote; không rolling giữa các version. Version skew giữa Service Binding là điều kiện bình thường — app bắt `ChunkLoadError` và reload tối đa một lần. Không drain; stream dài có thể bị cắt khi version bị thay → keepalive theo `01` invariant 19.
- **Promotion gate** cho mọi Worker DB-backed (đọc Axiom): request count, error rate, latency, stream abort rate, quota failures, reservation failures. Thiếu metrics → dừng promotion, **không** tự rollback.
- Staging tự cập nhật khi merge `main`; production cập nhật khi merge Release PR. Version Override để pin request test tương thích.
- Canary theo trọng số cho Worker → §12.

---

## 8. Rollback

| Đối tượng                 | Cách rollback                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Worker (mọi unit)         | Rollback về version đã build/verify, không rebuild (`04` WV2 — chỉ 100 version gần nhất). Rollback `cache` **không** purge cache artifacts |
| Dữ liệu                   | **Không rollback mặc định.** Expand → compatible rollout → quan sát rollback window → contract; forward-fix                                |
| Mất dữ liệu/sự cố hạ tầng | Restore PITR theo runbook có audit (`03`) — đây là DR, không phải application rollback                                                     |

Không có đường rollback nào đi qua migration: rollback Worker **không bao giờ** rollback database (`01` invariant 11).

---

## 9. Ranh giới tooling

| Tool             | Responsibility                                                         |
| ---------------- | ---------------------------------------------------------------------- |
| Nx               | project graph / task orchestration / affected                          |
| Wrangler         | Worker, D1, Preview, version, deploy, Worker Secrets                   |
| Pulumi           | infrastructure resources (DNS, R2, KV, Queues, D1, Hyperdrive, Access) |
| GitHub Actions   | trusted CI/CD execution                                                |
| Contract tooling | compatibility gate (Pact, oasdiff, `drizzle-broker`)                   |

Không khai báo cùng một resource ở hai công cụ. Workers VPC Service + Cloudflare Tunnel quản lý bằng Wrangler (`04` VP4); bootstrap hạ tầng một lần → `03`.

---

## 10. Test execution

| Tầng                          | Công cụ                                                                   | Chạy ở                                                                       |
| ----------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Unit/domain                   | Vitest                                                                    | PR                                                                           |
| Port conformance              | Miniflare + Testcontainers (PostgreSQL + TimescaleDB)                     | PR                                                                           |
| Worker integration            | `vitest-pool-workers`                                                     | PR                                                                           |
| `llm-api` integration/e2e     | CI runner + mock upstream                                                 | PR (khi affected)                                                            |
| API contract (nội bộ)         | Pact                                                                      | PR                                                                           |
| Public API                    | OpenAPI + `oasdiff` + SDK conformance                                     | PR                                                                           |
| Preview E2E                   | Playwright                                                                | Preview                                                                      |
| Staging E2E                   | OTP mailbox + OAuth nightly                                               | Staging                                                                      |
| `llm-api` load/soak           | k6 + mock upstream                                                        | Ngoài giờ cao điểm hoặc host riêng                                           |
| Restore test PostgreSQL       | Restore backup vào instance tạm trên host riêng                           | Định kỳ (`03` §3.4)                                                          |
| Nx remote cache compatibility | GET/PUT cache artifact, auth, immutable entry / 409, local → CI cache hit | PR ([`services/cache/03-operations.md`](../services/cache/03-operations.md)) |

Testing architecture (topology, vị trí unit/contract/E2E test) → `05-code-architecture.md`.

---

## 12. Chưa chốt

Chỉ chứa **delivery uncertainty**. Architectural decision → `01` §10 · operational uncertainty → `03` §10.

| Mục                                                                                                        | Kích hoạt                      |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Cách Nx Release ghi version cho deploy unit (package.json hay cách khác)                                   | Trước D2a                      |
| Preview database: 1 config chung + schema-per-PR hay chỉ mock                                              | Sau spike D2c                  |
| Preview routing — router động (KV + header routing) cho preview trên cùng domain, phục vụ E2E liên dịch vụ | Sau D2                         |
| Custom-domain scheme cho Preview                                                                           | Sau spike certificate/Access   |
| Canary theo trọng số cho Worker (Version Override + phân tách traffic)                                     | Khi có đủ lưu lượng để chia    |
| Dedicated Preview Workflow                                                                                 | Khi dùng Workflow              |
| Contract tooling cho D1 (tương đương `drizzle-broker`, §3)                                                 | Trước khi schema D1 production |
| Cơ chế bảo vệ khi migration runner chết giữa chừng (mất advisory lock)                                     | Trước migration production đầu |
