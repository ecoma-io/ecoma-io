# 05 — Code Architecture

> **Phạm vi:** Nx project taxonomy, Bounded Context trong code, DDD layer structure, dependency direction, contract project, testing
> architecture và architecture enforcement.
> Không chứa: topology, data ownership, invariant → `01-architecture.md` · CI/CD, migration, cách chạy test → `02-delivery.md` ·
> design chi tiết của một service → `services/<service>/`.

---

## 1. Principles

1. **Bounded Context first, layer second.** `libs/<bc>-*` là coding structure của một bounded context: layer là hậu tố của thư mục đó, không phải cây thư mục riêng. Bounded context chỉ là khái niệm code cho `libs/<bc>-*` — `apps/`, `tests/`, `docs/` không phải bounded context.
2. **`apps/` là runtime / composition / deploy boundary.** Mỗi app là composition root và là deploy unit độc lập.
3. **Business logic thuộc `libs/`.** App wire library lại với nhau; app không chứa domain logic.
4. **`libs/` giữ flat.** Không có nested directory và không có generic cross-domain layer.
5. **Không có generic `libs/domain`, `libs/application`, `libs/infrastructure`, `libs/contracts`.** Domain model của một context
   không được dùng chung bởi context khác.
6. **Một Bounded Context sở hữu code của chính nó.** Consumer đi qua contract, không import implementation của provider.

## 2. Canonical Nx structure

```text
apps/
  <runtime-project>              # Worker / web / infra deploy unit

libs/
  <bc>-domain                    # entities · value objects · domain services · domain errors
  <bc>-application               # use cases · ports · orchestration
  <bc>-infrastructure            # adapters · repositories · external clients
  <bc>-contracts                 # boundary artifact, KHÔNG phải DDD layer

tests/
  <e2e-project>                  # E2E và cross-service E2E
```

`libs/<bc>-*` là naming convention canonical.

```text
✗  libs/domain            libs/application            libs/contracts
✗  libs/<bc>/domain       libs/<bc>/application        libs/<bc>/infrastructure
```

Bounded Context **không** bắt buộc có đủ 4 library. Chỉ tạo layer khi context thực sự cần layer đó; một `-contracts` chỉ tồn tại
khi context đó có boundary thật sự với bên ngoài.

## 3. Dependency direction

Mũi tên `↑` = "phụ thuộc vào" — project ở dưới phụ thuộc project ở trên:

```text
<bc>-domain
    ↑
<bc>-application
    ↑
<bc>-infrastructure
```

`apps/<runtime-project>` là composition root: nó **phụ thuộc các library cần thiết** để compose context, không nằm trong chuỗi
phụ thuộc nội bộ của một context.

| Project               | Được phụ thuộc                                                     |
| --------------------- | ------------------------------------------------------------------ |
| `<bc>-domain`         | Không `application`, không `infrastructure`, không Nx project khác |
| `<bc>-application`    | `<bc>-domain`                                                      |
| `<bc>-infrastructure` | `<bc>-application`, `<bc>-domain`                                  |
| runtime / app         | Library của các context mà nó compose                              |
| service A             | **Không** import implementation của service B                      |
| service B             | Chỉ qua boundary / interface / contract được phép của B            |

`<bc>-contracts` đứng ngoài chuỗi này: nó là artifact mà provider **publish** và consumer **depend on**, không phải một tầng để
import theo hướng trên.

## 4. Contracts

`<bc>-contracts` là **boundary project/artifact**, không phải DDD layer:

- **Provider-owned** — contract thuộc về một provider (context sở hữu nó) và provider chịu trách nhiệm về nó.
- **Độc lập với implementation** — consumer phụ thuộc contract thay vì provider implementation.
- **Không** chứa domain implementation, **không** chứa business logic.
- **Nhiều consumers depend vào cùng một provider contract là bình thường** (kể cả consumers từ các context khác nhau).
- **Không** trở thành shared domain model — contract không được tồn tại như model domain dùng chung giữa nhiều bounded contexts; nếu nhiều context cùng phụ thuộc vào model dữ liệu chung thay vì API của một provider, contract đó đang lệch vai trò.

Có thể chứa, khi bounded context thực sự cần: `OpenAPI`, `Pact`, `JSON Schema`, `AsyncAPI`-compatible schema, DB schema
contract. Nội dung và tooling của từng contract → `02-delivery.md` §3.

## 5. Testing architecture

| Tầng              | Vị trí                            | Quy tắc                                                              |
| ----------------- | --------------------------------- | -------------------------------------------------------------------- |
| Unit test         | Colocated trong owning Nx project | Không có project test dùng chung chỉ để chứa unit test               |
| Contract test     | Ở boundary/contract context       | Consumer verify contract, không import provider internals            |
| E2E               | Nx project riêng trong `tests/`   | Chạy qua public surface của deploy unit                              |
| Cross-service E2E | Nx project riêng trong `tests/`   | Chạy qua runtime/service boundary; **không** import domain internals |

Không tạo `libs/testing` hoặc `libs/<bc>-tests` chỉ để chứa unit test nếu không có architectural reason. Công cụ, môi trường và
pipeline chạy test → `02-delivery.md` §10.

## 6. Nx tags

Mọi Nx project phải có **đúng một tag mỗi dimension** — `scope:*`, `type:*`, `runtime:*`. Tag schema được validate bởi
`pnpm dx arch-check` (§8).

### 6.1 `type` — trách nhiệm kiến trúc

`type` nói project **chịu trách nhiệm gì về kiến trúc**, không nói ngôn ngữ, framework, deployment format hay project kind của
Nx (`projectType` app/library vẫn là cấu hình Nx riêng, không liên quan).

| Tag                   | Trách nhiệm                                                        |
| --------------------- | ------------------------------------------------------------------ |
| `type:domain`         | Domain models, business invariants, domain services, domain errors |
| `type:application`    | Use cases, orchestration, ports                                    |
| `type:infrastructure` | Adapters, implementations của framework/external system            |
| `type:contracts`      | Boundary artifact và protocol/schema contract, không logic         |
| `type:composition`    | Deployable apps, BFF, Workers, entrypoint compose dependencies     |
| `type:tooling`        | Developer tooling, DX automation, repository utilities             |

### 6.2 `runtime` — ràng buộc môi trường thực thi

`runtime` nói project **chạy ở đâu được**, không nói ngôn ngữ (không tag theo Rust/JS).

| Tag                 | Ý nghĩa                                                                         |
| ------------------- | ------------------------------------------------------------------------------- |
| `runtime:edge`      | Cloudflare Workers — Web API, không Node builtin, không OS process              |
| `runtime:browser`   | Browser-only (DOM, window) — không chạy trên edge                               |
| `runtime:native`    | OS process: Rust executable, Node.js CLI tool                                   |
| `runtime:universal` | **Cam kết tương thích** — dependency của project cho phép chạy mọi runtime trên |

`runtime:universal` không phải default cho library: đó là một lời cam kết hai chiều — project chỉ được phụ thuộc project
`universal` khác, vì dependency quyết định nơi project chạy được. Cấp `universal` khi dependency thật sự cho phép (vd
một thư viện pure string logic, zero dependency).

### 6.3 `scope` — ownership / dependency boundary

`scope` nói project thuộc **sở hữu của ai**: một bounded context hoặc một vùng ownership chia sẻ.

Trục ownership có hai tầng nền: `scope:shared` là **đáy** — chỉ được phụ thuộc `scope:shared` (không platform, không
implementation, không contract của scope nghiệp vụ nào — `onlyDependOnLibsWithTags` khớp bất kỳ tag nào trong allowlist nên
đưa `type:contracts` vào đây là mở `shared → contracts của scope bất kỳ`, đảo chiều tầng đáy) — còn
`scope:platform` được phép phụ thuộc thêm `shared` và `type:contracts` của scope bất kỳ. Chiều ngược lại (`shared` → `platform`)
bị chặn chủ đích: platform đã phụ thuộc shared, mở chiều ngược là mời dependency cycle giữa hai tầng nền.

Bounded context/product scope (`identity`, `backoffice`, `llm`, `payment`, …) được phụ thuộc **toàn bộ implementation** của
hai tầng nền — đó là vai trò foundation layer, khác hẳn dependency chéo scope nghiệp vụ: giữa các scope nghiệp vụ ngang hàng,
chỉ được phụ thuộc qua `type:contracts` của provider, không bao giờ import implementation của scope khác.

Scope hiện dùng: `public`, `shared`, `platform`, `identity`, `backoffice`, `llm`, `payment`, `messaging`, `notifications`,
`local`. Scope mới thêm vào phải được khai báo trong constraint của `.oxlintrc.json` và `KNOWN_SCOPES` của
`tools/dx/src/arch-tags.ts` — hai nguồn này được test ràng buộc đồng bộ hai chiều: scope nào thiếu constraint, constraint
nào nhắm scope lạ, hay runtime constraint lệch ma trận compatibility đều bị test bắt.

## 7. Dependency rules

Hai lượt kiểm với cơ chế khác nhau, bổ sung cho nhau:

**Lượt direct + transitive theo tag — Oxlint module boundaries** (`@nx/enforce-module-boundaries` trong `.oxlintrc.json`):

| Source                   | Quy tắc                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `type:domain`            | Không phụ thuộc `application`/`infrastructure`/`composition`/`tooling` — **transitive**                     |
| `type:application`       | Không phụ thuộc `infrastructure`/`composition`/`tooling` — **transitive**                                   |
| `type:infrastructure`    | Chỉ phụ thuộc `domain`/`application`/`contracts`/`infrastructure`                                           |
| `type:contracts`         | Không phụ thuộc bất kỳ type implementation nào — **transitive**                                             |
| `type:composition`       | Chỉ compose `domain`/`application`/`infrastructure`/`contracts` — app không import app                      |
| `type:tooling`           | Chỉ phụ thuộc `type:tooling`                                                                                |
| bounded context scope    | Được dùng implementation của tầng nền (`shared`, `platform`); scope nghiệp vụ khác chỉ qua `type:contracts` |
| `scope:shared`           | Chỉ phụ thuộc `scope:shared` — không contract của scope khác (đáy của trục ownership)                       |
| `scope:platform`         | Chỉ phụ thuộc `scope:platform`/`scope:shared` + `type:contracts`                                            |
| composition edge/browser | Chỉ phụ thuộc lib `runtime:edge`/`universal` (tương ứng `browser`) — lượt direct                            |

`notDependOnLibsWithTags` là **transitive**: domain không chạm application kể cả qua chuỗi lib trung gian. `onlyDependOnLibsWithTags`
khớp **bất kỳ tag nào** trong danh sách nên allowlist scope đọc theo vai trò: tầng nền có mặt trong allowlist của bounded
context là vì chúng là foundation layer được dùng trọn vẹn, không phải ngoại lệ chéo scope; implementation của scope nghiệp
vụ khác không có mặt trong allowlist nào, và kể khi một edge import trượt vào allowlist, constraint `type:*` phía trên vẫn
chặn hướng đó. Contracts được phép chéo scope (consumer phụ thuộc contract của provider) nhưng không bao giờ chạm
implementation của provider — constraint `type:contracts` transitive chặn hướng đó. Allowlist `type:composition` cố ý
KHÔNG chứa `type:composition` lẫn `type:tooling`: một deploy unit không bao giờ import trực tiếp deploy unit khác (app là
composition root, không phải implementation cho app khác), và tooling là dev lane không làm lib runtime; các combo runtime
dưới đây cũng không có hai type đó ở lượt direct — import chéo app không trượt qua được lượt nào.

**Lượt graph-wide — `pnpm dx arch-check`** (`tools/dx`):

- Tag schema: đúng một `scope:*`, `type:*`, `runtime:*` mỗi project; value thuộc allowlist; không còn value legacy
  (`type:web`, `type:service`, `type:lib`, `type:tool`, `runtime:node`, và **mọi** tag mang prefix `layer:*` — dimension đã
  bị xoá nên bị chặn theo prefix, không theo danh sách value).
- Runtime compatibility **transitive trên project graph**: `edge` không được chạm `native`/`browser` qua bất kỳ chuỗi
  dependency nào (và đối ứng cho `browser`/`native`); `universal` chỉ được phụ thuộc `universal`.

Lượt graph-wide cần thiết vì Node builtin import không tạo graph edge trong Nx — guard builtin (không `node:*` trong
`apps/**`/`libs/**`) vẫn do override `no-restricted-imports` + `import/no-nodejs-modules` của Oxlint theo directory glob;
cấm import một _project native_ thì phải đọc tag trên graph.

## 8. Architecture enforcement

| Cơ chế                                   | Chặn cái gì                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| Oxlint module boundaries (`@nx/*`)       | Dependency direction theo `type`, scope boundary, runtime direct edge, Node builtin |
| `pnpm dx arch-check` (CI, unconditional) | Tag schema ba dimension, runtime compatibility transitive trên graph                |

`arch-check` chạy trên **toàn workspace** chứ không theo `nx affected`: một tag sai ở project không đổi file nào vẫn phải đỏ.

## 9. Rust toolchain

Workspace sẵn sàng cho crate tương lai; hiện chưa có Cargo project nên không có Nx target Rust nào được đăng ký.

- Toolchain pin ở `rust-toolchain.toml` (workspace root) — rustup áp theo directory, dùng chung local và CI; convention
  cùng họ với `.node-version`.
- Khi crate đầu tiên xuất hiện (`libs/<bc>-infrastructure` hoặc `tools/*`), đăng ký target per-project dùng executor
  `nx:run-commands` gọi `cargo fmt --check` / `cargo clippy` / `cargo test` / `cargo build`, cache inputs gồm
  `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml` và sources; `target-dir` riêng per-project khi cần tránh cache
  artifact đè nhau.
- **Không dùng `@monodon/rust`:** phiên bản hiện (3.0.0) khai báo dependency cứng `@nx/devkit ^22.0.0` trong khi workspace
  chạy Nx 23.3.0; các bản 2.x cũng chỉ hỗ trợ tới Nx < 21. Plugin còn yêu cầu `cargo metadata` chạy lúc build graph. Khi
  chưa có crate nào, plugin không infer được target nào — chi phí cài không đổi lại rủi ro version drift với Nx. Đánh giá
  lại khi Nx và plugin tương thích, hoặc khi số crate đủ nhiều để explicit targets thành gánh nặng.
- CI cài Rust toolchain **chỉ khi** workspace có Cargo project (kiểm sự tồn tại `**/Cargo.toml`), tránh mọi PR JS trả phí
  cài đặt không cần thiết.

## 10. Current state

| Phần                                                | Trạng thái hiện tại                                                                                                                                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/` = runtime / composition / deploy            | ✅ Đúng; mọi app đều là deploy unit `runtime:edge`, tag `type:composition`                                                                                                                                                                        |
| `libs/<bc>-*` theo bounded context                  | ❌ Chưa có. Workspace hiện không có `libs/` — các thư viện public web cũ (`i18n-public`, `layout-public`, `logo`, `error-pages`) đã được hợp nhất vào `apps/home` như module app-local (`app/i18n`, `app/layout`, `app/brand`, `app/error-pages`) |
| `tests/` cho E2E                                    | ❌ Chưa có                                                                                                                                                                                                                                        |
| Dependency constraints `type` / `scope` / `runtime` | ✅ Enforce bằng Oxlint boundaries + `pnpm dx arch-check` trong CI                                                                                                                                                                                 |
| `<bc>-contracts`                                    | ❌ Chưa có project contracts nào; contract registry chưa dựng (`02` §3)                                                                                                                                                                           |
| Rust toolchain                                      | ✅ Pin sẵn `rust-toolchain.toml`; chưa có Cargo project nên chưa có target                                                                                                                                                                        |
