# 01 — Architecture

> **Phạm vi:** system topology, deploy/service boundary, data ownership, cross-service communication, security boundary, hostname/routing (gồm production/non-production boundary, routing boundary và preview architecture boundary), architectural decisions và system invariants. Không chứa: preview deployment mechanics, preview lifecycle (creation/cleanup), CI/CD implementation, release mechanics, migration → `02-delivery.md` · backup/DR, observability, runbook, database hosting tier chi tiết → `03-operations.md` · platform limit → `04-platform-facts.md` · DDD layer, Nx project → `05-code-architecture.md` · design của một service → `docs/services/<service>/`.

---

## 1. System Topology

**Mọi deploy unit chạy trên Cloudflare Workers; chỉ tầng lưu trữ nằm ngoài Workers.**

```text
Client
  │
  ▼
Cloudflare ── DNS · TLS · WAF · Rate Limiting · Turnstile
  │
  ├── Public hostname (§7) ──► apps · identity · backoffice · payment · llm-api · cache   (ecoma.io — production, không qua Router)
  ├── Non-production hostname (§7) ──► Router → staging / preview Worker                  (ecoma.io.vn)
  ├── Internal, không hostname công khai ──► push/mail control + job workers · janitor
  │
  ▼
Workers (deploy unit độc lập · Service Binding nội bộ)
  │
  ├── PostgreSQL   Worker → Hyperdrive → Workers VPC Service → Cloudflare Tunnel → private network
  │                identity · payment · llm-api · backoffice   (mỗi service một database · query cache OFF)
  ├── D1           Worker → D1 binding            · push · mail bounded context
  ├── KV / Queue   Worker → binding               · non-authoritative
  ├── Queue consumer Worker ── asynchronous delivery / background work
  ├── External provider ── LLM · email · web push · payment
  └── R2/B2 ── backup copy · build artifact       · không business authority
```

### 1.1 Ba đường truy cập lưu trữ

| Nhóm           | Đường duy nhất từ application code                                                             |
| -------------- | ---------------------------------------------------------------------------------------------- |
| **PostgreSQL** | `Worker → Hyperdrive → Workers VPC Service → Cloudflare Tunnel → private network → PostgreSQL` |
| **D1**         | `Worker → D1 binding → D1`                                                                     |
| **KV / Queue** | `Worker → KV/Queue binding`                                                                    |

- Hyperdrive là boundary duy nhất từ application code tới PostgreSQL; origin private chỉ reachable qua Workers VPC Service + Cloudflare Tunnel, TLS bắt buộc, query cache OFF trên mọi đường correctness (limit và source → `04`).
- D1 không đi qua Hyperdrive, không có Tunnel, không có VPS.
- **Không có Worker nào giữ correctness state:** isolate không ổn định giữa hai request, `/tmp` memory-backed; mọi authoritative state nằm ở PostgreSQL hoặc D1, và không dựa vào `ctx.waitUntil()` cho correctness write.
- Application, database connectivity và database hosting thay đổi theo ba nhịp khác nhau; chỉ tầng hosting thay đổi theo trigger vận hành, nên nâng cấp hạ tầng không thành rewrite (tier → `03` §6).

---

## 2. Deploy / Service Boundaries

| Service / Unit                                                                | Runtime                        | Public/Internal       | Hostname / Interface                  | Storage owner                           |
| ----------------------------------------------------------------------------- | ------------------------------ | --------------------- | ------------------------------------- | --------------------------------------- |
| `home` · `blogs` · `docs` · `api-reference`                                   | Edge (Worker)                  | Public                | `ecoma.io` — path `/<locale>/<mount>` | —                                       |
| `router`                                                                      | Edge (Worker)                  | Non-production entry  | `ecoma.io.vn` — route table           | —                                       |
| `identity`                                                                    | Edge (Worker)                  | Public                | `accounts.ecoma.io`                   | `db-identity` (PostgreSQL)              |
| `backoffice`                                                                  | Edge (Worker)                  | Public, có auth       | `office.ecoma.io`                     | PostgreSQL (business data) · RBAC (§10) |
| `payment`                                                                     | Edge (Worker)                  | Public + webhook      | `payment.ecoma.io`                    | `db-payment` (PostgreSQL)               |
| `llm-api`                                                                     | Edge (Worker)                  | Public + admin nội bộ | `api.ecoma.io/llm`                    | `db-llm-gateway` (PostgreSQL)           |
| `llm-home` · `llm-seller` · `llm-console` · `llm-models` · `llm-subscription` | Edge (Worker)                  | Public / có auth      | mount theo `project.json`             | không sở hữu DB — ghi qua contract/API  |
| `push-notification`                                                           | Edge (Worker)                  | Internal API          | Service Binding                       | `push` (D1)                             |
| `web-push-notification-job`                                                   | Edge (Worker) + Queue consumer | Internal              | Queue consumer, không hostname        | `push-job` (D1)                         |
| `transactional-mail`                                                          | Edge (Worker)                  | Internal API          | Service Binding                       | `mail` (D1)                             |
| `transactional-mailer-job`                                                    | Edge (Worker) + Queue consumer | Internal              | Queue consumer, không hostname        | `mail-job` (D1)                         |
| `cache`                                                                       | Edge (Worker)                  | Public data plane     | `cache.ecoma.io`                      | Nx cache artifact — non-authoritative   |
| `janitor`                                                                     | Edge (Worker)                  | Internal              | Cron Trigger, không hostname          | tài nguyên Preview tạm                  |

- Tách nhiều deploy unit là chủ đích (A10): đổi gì ở một unit cũng phải qua contract test và module-boundary lint.
- Secret dùng native Worker Secrets theo môi trường deploy; không có service quản lý secret riêng.
- Chi tiết thiết kế của service đã có → `docs/services/<service>/`; service chưa có specification thì chưa có thư mục (theo `docs/AGENTS.md`).

---

## 3. Monorepo

Taxonomy (`apps`/`libs`/`tests`), DDD layer, dependency direction, Nx tag và testing → [`05-code-architecture.md`](./05-code-architecture.md). `01` không mô tả taxonomy/layer.

---

## 4. Data Ownership

| Domain state                                             | Owner                       | Authoritative storage |
| -------------------------------------------------------- | --------------------------- | --------------------- |
| Tài khoản, session, audit                                | `identity`                  | `db-identity` (PG)    |
| Ledger credit, giao dịch, payout seller                  | `payment`                   | `db-payment` (PG)     |
| API key, quota, usage, reservation, settlement           | `llm-api`                   | `db-llm-gateway` (PG) |
| Notification domain state (device, subscription, outbox) | `push-notification`         | `push` (D1)           |
| Push job/delivery execution state                        | `web-push-notification-job` | `push-job` (D1)       |
| Mail template, message metadata, intent                  | `transactional-mail`        | `mail` (D1)           |
| Mail job/delivery execution state                        | `transactional-mailer-job`  | `mail-job` (D1)       |
| Seller/workspace, offer, catalog, thống kê               | `llm-*` apps                | — qua contract/API    |
| Business data của `backoffice` cần persistence           | `backoffice`                | PostgreSQL            |
| RBAC của `backoffice`                                    | chưa chốt                   | — (§10)               |

**Storage model** — quy tắc architectural, không phải platform limit (limit → `04`):

| Storage                            | Vai trò                          | Business authority |
| ---------------------------------- | -------------------------------- | ------------------ |
| PostgreSQL                         | Core relational state            | **Yes**            |
| D1                                 | Supporting service state         | **Yes**            |
| KV · Queue · Worker memory · cache | Async · ephemeral · acceleration | **No**             |
| R2/B2                              | Backup copy · build artifact     | **No**             |

- **Mỗi authoritative storage resource có đúng một business owner** (A9). Một service có thể sở hữu nhiều storage resource; storage resource không bao giờ có nhiều owner.
- Chọn PostgreSQL hay D1 theo **bounded context** (transactional requirement, relational complexity, portability, operational cost, workload, recovery), **không** theo mức quan trọng của dữ liệu: criticality quyết định durability/backup/retention, không tự nó quyết định technology (A20).
- Database hosting tier ở mức khái niệm: **Tier 0** self-hosted PostgreSQL → **Tier 1** managed → **Tier 2** managed HA — chỉ mô tả PostgreSQL; D1 là managed service, không thuộc thang tier này. Trigger, sizing, backup, RPO/RTO → `03` §6.

---

## 5. Cross-Service Communication

```text
Service A ──► API (sync) / Event (async) / Service Binding ──► Service B
   ✗ truy cập trực tiếp database hoặc implementation nội bộ của Service B
```

- Cross-service **chỉ** qua API, event hoặc Service Binding. Không tồn tại cross-database query; cần dữ liệu do service khác sở hữu thì synchronous API, event, hoặc local projection được đồng bộ có chủ đích.
- Cùng một Cloudflare account: Worker ↔ Worker đi qua Service Binding, không qua internet. Event liên service giao bằng HTTPS có idempotency key và xác thực service-to-service.
- Event bất đối xứng đi qua **transactional outbox** nằm chung transaction với state (A8): bản ghi event không mất khi commit thành công — nhưng cơ chế relay/reconciliation để gửi đi chưa chốt (§10). Queue chỉ là delivery channel, không bao giờ là source of truth; consumer phải idempotent; thứ tự là thuộc tính của consumer, không phải của kênh.
- Mọi event có tên, version, schema, idempotency key, correlation ID, chính sách compat/replay, và breaking change bị chặn ở Contracts Registry (`02` §3).

---

## 6. Security Boundaries

- **Secret:** production secret không bao giờ xuất hiện trong PR build hay Preview runtime; Worker runtime chỉ giữ credential mà role đó cần; secret dùng native Worker Secrets theo môi trường deploy, xoay vòng đi qua delivery gate (`02` §6).
- **Database:** không truy cập database của service khác (§5); PostgreSQL không có địa chỉ công khai — mọi đường vào đi qua Workers VPC Service + Cloudflare Tunnel; D1 chỉ qua D1 binding; private database không public.
- **External boundary:** hostname public và API công khai phải có authentication/authorization phù hợp; cookie session isolate theo từng hostname (`__Host-*`, `HttpOnly`, `Secure`, `SameSite=Lax`); authorization không dựa vào độ khó đoán của ID.
- **Shared-origin `ecoma.io/*`:** XSS ở một app ảnh hưởng app cùng origin → strict CSP + nonce, cấm inline script, sanitize server-side; thao tác nhạy cảm cần step-up auth; `accounts`/`office`/`payment` luôn là hostname riêng.
- **Observability:** không tự xây ngoài Axiom, không được là serving-path dependency; không log prompt/response body, không log sensitive payload (`03` §4).
- **Preview là runtime không tin cậy** và không ghi được storage production — enforced bằng binding, không bằng quy ước (`02` §5).

---

## 7. Hostname / Routing

| Hostname            | Vai trò                                                        |
| ------------------- | -------------------------------------------------------------- |
| `ecoma.io`          | **Production public domain** — web production                  |
| `ecoma.io.vn`       | **Non-production domain** — staging + preview                  |
| `accounts.ecoma.io` | Identity (OIDC/OAuth)                                          |
| `office.ecoma.io`   | Backoffice                                                     |
| `payment.ecoma.io`  | Payment, payment webhook                                       |
| `api.ecoma.io/llm`  | Public API của `llm-api` — base path `/llm` là public contract |
| `cache.ecoma.io`    | Data plane của `cache`                                         |

**Ranh giới routing (A13):**

```text
Production:    Client → ecoma.io → Cloudflare → production Worker
Non-production: Client → ecoma.io.vn → Non-production Router → staging / preview Worker
```

- Production **không đi qua Router**; không có global router hay routing abstraction trên production request path. Router chỉ phục vụ non-production — mục đích của `ecoma.io.vn` là để staging/preview dùng routing đơn giản mà không tạo thêm latency hay operational dependency cho production.
- Implementation của Router thuộc delivery (`02` §12); `01` chỉ ghi architecture boundary và invariant.
- **Locale (production, A13):** public URL là `/<locale>/<mount>/<path>`, locale là segment đầu tiên của mọi URL, English cũng mang prefix `/en`; `/` chỉ là locale-resolution entry point, không serve content; không có domain thị trường. Locale strategy của production giữ nguyên, không phụ thuộc vào sự tách domain non-production.
- `mount` ≠ tên app; app không phục vụ SEO không vào public route table. Production match `mount` thẳng trên path (không qua Router, không strip prefix); các hostname riêng không nằm trong route table public web.
- Mỗi resource có đúng hai URL public (`/en/...` và `/vi/...`), self-canonical, `hreflang` hai chiều `en` ↔ `vi-VN`; đổi locale chỉ khi người dùng chủ động chọn (302), không tự đổi theo IP/`Accept-Language`/cookie.
- Staging và Preview phục vụ dưới `ecoma.io.vn` (non-production); staging worker dùng prefix `stg-*`; mechanics deployment → `02` §5.

---

## 8. Architectural Decisions

| ID  | Decision                                                                                                                                                                                         | Rationale / điều kiện đảo ngược                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **Edge-first:** mọi deploy unit chạy trên Cloudflare Workers; database là tầng duy nhất nằm ngoài Workers                                                                                        | Một runtime, một failure model. Đảo ngược khi có yêu cầu compute không vừa Worker                                                  |
| A2  | **PostgreSQL ngay từ đầu** cho `identity`, `payment`, `llm-api`: mỗi owner một database + một role riêng trong cùng instance ở tier khởi đầu                                                     | Tránh migrate database về sau; ownership theo **database**, không phải instance                                                    |
| A3  | Database tự host trên một VPS ở tier khởi đầu, không orchestrator, không control plane                                                                                                           | Chỉ là tier triển khai, không phải application contract; nâng cấp qua database hosting tier (`03` §6)                              |
| A4  | Backup base + WAL archive → **R2** trong cùng Cloudflare account với runtime (A12); bản sao mã hoá sang provider thứ hai là phòng tuyến cuối cùng                                                | Một account chứa cả runtime lẫn backup → cần một tuyến copy ngoài account/provider; immutability → `03` §3.1                       |
| A5  | Core services nối PostgreSQL qua **Hyperdrive** (Workers VPC Service + Cloudflare Tunnel); query cache OFF trên đường correctness; không advisory lock / `LISTEN`-`NOTIFY` / SQL-level `PREPARE` | Hyperdrive là boundary duy nhất; cache bật mặc định và không invalidate khi ghi; các cấm là platform limit (`04`)                  |
| A7  | **PostgreSQL là quota authority và settlement authority** của `llm-api`: mọi `reserve` ghi bản ghi bền ngay khi giữ quota; `settle`/`release` idempotent theo `reservation_id`                   | Không store nào ngoài database là authority; `waitUntil()` và Queue không phải durable settlement                                  |
| A8  | Event liên service qua **transactional outbox** trong database, giao bằng HTTPS có idempotency key; Queue chỉ là delivery channel                                                                | Outbox nằm chung transaction với state; relay/reconciliation chưa chốt (§10)                                                       |
| A9  | **Mỗi storage resource một service sở hữu**                                                                                                                                                      | Service khác dùng API/event/binding, không chạm storage đó (§5)                                                                    |
| A10 | Tách nhiều deploy unit là chủ đích, mỗi bounded context một unit                                                                                                                                 | Bắt buộc contract test và module-boundary lint                                                                                     |
| A12 | Một Cloudflare account cho mọi environment                                                                                                                                                       | Xem lại khi ngân sách cho phép tách account                                                                                        |
| A13 | `ecoma.io` là production public domain, locale-first; `ecoma.io.vn` là non-production domain (staging + preview); Router chỉ phục vụ non-production — production request path không qua Router   | Tách domain để staging/preview có routing đơn giản, không thêm latency/operational dependency cho production.                      |
| A16 | Rollback = rollback **Worker version** đã publish, không rollback database; migration expand → contract                                                                                          | Chi tiết → `02` §8                                                                                                                 |
| A18 | `cache` là Edge deploy unit độc lập — disposable build state                                                                                                                                     | Không phải production source of truth, không phải serving dependency; thiết kế → [`services/cache/`](../services/cache/README.md)  |
| A19 | **D1 là authoritative storage** của push/mail control plane và job workers, truy cập bằng D1 binding trực tiếp                                                                                   | Native workload, không cần PostgreSQL capability; dữ liệu không critical — không thuộc Backup/DR scope, retention/quota → `03` §10 |
| A20 | Chọn database theo **bounded context**, không theo criticality của dữ liệu                                                                                                                       | Criticality quyết định durability/backup, không quyết định technology (§4)                                                         |

---

## 9. System Invariants

| #   | Rule                                                                                                                                           | Enforcement                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1   | PR/Preview không thấy production secret; Worker runtime chỉ giữ credential mà role đó cần                                                      | CI policy, GitHub Environments      |
| 2   | Preview không ghi storage production và không là open proxy — enforced bằng binding/test, không bằng quy ước                                   | Lint config + test                  |
| 3   | PostgreSQL không có địa chỉ công khai; đường vào canonical qua Workers VPC Service + Cloudflare Tunnel; không phục vụ client không xác thực    | Config check + port-scan định kỳ    |
| 4   | Application code chỉ chứa tên binding — không host, port, user hay node identity của provider nào                                              | Lint config review                  |
| 5   | Mỗi authoritative storage resource một business owner: PostgreSQL bằng role riêng grant tối thiểu ở mức database, D1 bằng binding riêng        | Nx module-boundary + kiểm tra grant |
| 6   | Mọi authoritative state nằm ở PostgreSQL hoặc D1; KV, Queue, cache và Worker memory không bao giờ là business authority                        | Conformance test + rà binding       |
| 7   | Cross-service không truy cập database hay implementation nội bộ của service khác                                                               | Module-boundary + contract test     |
| 8   | Mọi event consumer idempotent; không dựa thứ tự từ kênh                                                                                        | Contract test                       |
| 9   | Mọi path settlement/migration đi qua Queue phải có DLQ, hoặc không đi qua Queue                                                                | Queue config review                 |
| 10  | Migration backward-compatible (expand → contract); không down-migrate                                                                          | `drizzle-broker can-i-deploy`       |
| 11  | Rollback chỉ chọn Worker version đã publish; không bao giờ rollback authoritative storage                                                      | Pipeline + API rollback             |
| 12  | Không correctness nào phụ thuộc instance/host identity; không state ở isolate-global hay `/tmp`; không `ctx.waitUntil()` cho correctness write | Stateless contract test             |
| 13  | Mọi client Hyperdrive không dùng advisory lock / `LISTEN`-`NOTIFY` / SQL-level `PREPARE`; không giữ per-session state ngoài transaction        | Lint SQL + integration test         |
| 14  | Hyperdrive query cache OFF trên mọi đường correctness (ledger, quota, settlement)                                                              | Config check + đo `cacheStatus`     |
| 15  | Public API giữ protocol compatibility                                                                                                          | `oasdiff`, contract test            |
| 16  | Quota và settlement của `llm-api` nằm ở PostgreSQL mọi lúc; không fallback KV làm sai quota/usage/billing; `settle`/`release` idempotent       | Property test + reconciliation      |
| 17  | Đổi database hosting tier không đổi public API contract; hosting provider không lọt vào application contract                                   | `oasdiff` + rà seam                 |
| 18  | Mỗi Worker là deploy unit độc lập: deploy, promote và rollback theo từng unit                                                                  | Pipeline + contract test            |
| 19  | SSE keepalive ≤ 30 s, không im lặng > 60 s trên stream — bất biến của ecoma, không phải cam kết của Cloudflare                                 | Test stream qua staging             |
| 20  | `traceparent` truyền xuyên mọi hop (Worker ↔ Worker, Worker ↔ database); header được lọc `\r\n` trước log                                      | E2E test                            |
| 21  | Locale là segment đầu tiên của URL public production; mỗi resource đúng hai URL self-canonical; không tự đổi locale theo IP/header/cookie      | CI check URL canonical              |
| 22  | Shared Nx cache chỉ trusted environment được ghi; cache unavailable không ảnh hưởng application correctness                                    | Policy check + Nx fallback test     |
| 23  | Production request path (`ecoma.io`) không qua Router; Router chỉ phục vụ non-production (`ecoma.io.vn`)                                       | Config review                       |

> **Ghi chú:** đây là system invariants — cái phải luôn đúng. Cách delivery/operations/code architecture enforce từng invariant nằm ở `02`, `03`, `05`.

---

## 10. Unresolved Architecture

Chỉ chứa **architectural decision** chưa chốt. Operational uncertainty → `03` §10 · delivery uncertainty → `02` §12.

| Quyết định chưa chốt                                                                                                                                                                                                                  | Kích hoạt                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Settlement durability** — store bền cho usage đã phục vụ khi PostgreSQL down (nhánh A/B ở `03` §3.2b)                                                                                                                               | **Trước khi bật metering**                               |
| **RBAC storage ownership** của `backoffice`                                                                                                                                                                                           | Trước khi dựng backoffice                                |
| **Cơ chế relay outbox** — Worker relay đọc bảng outbox, Queue hay NATS                                                                                                                                                                | Trước tích hợp Saga                                      |
| **Rate limit per-key/bucket** và negative auth cache cho `api.ecoma.io/llm`                                                                                                                                                           | Trước D3 metering                                        |
| **Caller không phải Worker** cho Admin API của `llm-api`; nếu có thì bảo vệ bằng gì                                                                                                                                                   | Trước tích hợp đầu tiên                                  |
| **ID strategy** — mặc định UUIDv7, có đổi sang compact ID không                                                                                                                                                                       | Trước schema production                                  |
| **Identity auth architecture** — OIDC library, client registry, JWKS rotation, token TTL                                                                                                                                              | Trước identity thật                                      |
| **`llm-console`/`llm-seller` sang hostname riêng**                                                                                                                                                                                    | Theo threat model                                        |
| **TLS posture đường Hyperdrive↔origin** — chọn `require`/`verify-ca`/`verify-full` cho production; Hyperdrive default là `require`, VPC TCP service default là `verify_full` (`04` HD2, VP3); cần chốt cơ chế cung cấp CA certificate | Trước production                                         |
| **D1 transaction tương tác/isolation** — hành vi `BEGIN`/`COMMIT` tương tác và isolation level của D1 chưa được tài liệu chính thức đề cập, chưa xác minh thực tế — chốt trước khi design dựa vào interactive transaction             | Trước khi design transaction D1 tương tác                |
| **Spectrum/`cloudflared` TCP cho database qua tunnel** — gói Enterprise và khả năng vận chuyển TLS chưa có tài liệu chính thức                                                                                                        | Trước khi cân nhắc đường TCP trực tiếp thay VPC + Tunnel |
| **Spike S1** — chạy thật đường `Hyperdrive → Workers VPC Service → Tunnel` với TLS `verify-full`; đo latency p95                                                                                                                      | Trước D2b                                                |

Câu hỏi vận hành → `03` §10 · CI/delivery → `02` §12 · platform fact → `04`.
