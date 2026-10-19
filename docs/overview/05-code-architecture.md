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
  <runtime-project>              # Worker / web / composition root của một deploy unit runtime

deploys/
  platform-deploy                # tầng platform hạ tầng mà mọi deployment project khác phụ thuộc
  <unit>-deploy                  # Pulumi deployment project của một deploy unit

libs/
  <bc>-domain                    # entities · value objects · domain services · domain errors
  <bc>-application               # use cases · ports · orchestration
  <bc>-infrastructure            # adapters · repositories · external clients
  <bc>-contracts                 # boundary artifact, KHÔNG phải DDD layer

tests/
  <e2e-project>                  # E2E và cross-service E2E
```

`libs/<bc>-*` và `deploys/<unit>-deploy` là naming convention canonical.

```text
✗  libs/domain            libs/application            libs/contracts
✗  libs/<bc>/domain       libs/<bc>/application        libs/<bc>/infrastructure
```

Bounded Context **không** bắt buộc có đủ 4 library. Chỉ tạo layer khi context thực sự cần layer đó; một `-contracts` chỉ tồn tại
khi context đó có boundary thật sự với bên ngoài.

### 2.1 Nhóm deployment — `deploys/`

`deploys/` là nhóm project **thứ hai** cạnh `apps/`, và nó **không** phải một bounded context: `deploys/` không chứa domain
logic, use case hay adapter — nó chứa **Pulumi deployment project**, tức phần khai báo cách một deploy unit được
provision.

| Project                 | Sở hữu việc gì                                                            |
| ----------------------- | ------------------------------------------------------------------------- |
| `platform-deploy`       | Tài nguyên hạ tầng dùng chung cho mọi deploy unit của một environment     |
| `deploys/<unit>-deploy` | Tài nguyên hạ tầng riêng của một deploy unit; phụ thuộc `platform-deploy` |

**Ranh giới provisioning ↔ application release.** Đây là ranh giới quan trọng nhất của nhóm này, và nó **không** nằm ở
tầng code mà ở tầng vòng đời:

- **Provisioning** (Pulumi, project trong `deploys/`) **tạo/cập nhật/xoá tài nguyên hạ tầng**: Worker identity, binding,
  D1/KV/R2/Queue, DNS, Hyperdrive. Nó **không** build, **không** version, **không** phát hành release.
- **Application release** (Nx Release + Wrangler, project trong `apps/`) **build và deploy Worker version**. Nó
  **không** tạo tài nguyên hạ tầng.
- **Database migration** (migration runner, CI job) áp schema; nó là **chủ sở hữu thứ ba**, không thuộc cả hai vế trên.

Một application release **không** chạy `pulumi up`: đổi hạ tầng và phát hành ứng dụng là hai workflow tách biệt, với
ownership tách biệt → bảng sở hữu từng loại resource ở `02-delivery.md` §9.1.

**Prerequisite platform.** Mọi `deploys/<unit>-deploy` **bắt buộc** phụ thuộc `platform-deploy`, và đó là hướng phụ thuộc
được phép duy nhất giữa các deployment project. `platform-deploy` **không** được phụ thuộc ngược lại bất kỳ
`deploys/<unit>-deploy` nào — nếu không, tầng platform sẽ kéo theo vòng đời của từng deploy unit và platform prerequisite
biến thành cycle. Cấm luôn cả edge giữa hai deployment unit khác nhau: một deploy unit phụ thuộc deploy unit khác là cách duy
nhất để hai stack Pulumi trở thành một chu trình lifecycle, nên `validateDeploymentGraph` (`tools/dx/src/arch-tags.ts`) báo
`cross-unit-deploy-dependency`.

⚠️ **Bất biến vị trí ⇔ tag.** Một project đặt trong `deploys/` phải mang `type:deployment`, và một project mang
`type:deployment` phải đặt trong `deploys/`. Nếu chỉ kiểm tag thì `deploys/` chỉ là quy ước đặt tên: một project trong
`deploys/` mà gắn tag khác sẽ đi vòng qua mọi lượt kiểm deployment. Lượt này (`misplaced-deployment-project`) là duy nhất có
thể nhìn thấy điều đó, và nó chạy trước mọi lượt khác trong `validateDeploymentGraph`.

⚠️ **Phụ thuộc trên Nx project graph ≠ thứ tự chạy task.** Khai `platform-deploy` là prerequisite là khai quan hệ trên
**project graph** — nó cho biết cái gì phụ thuộc cái gì, và là điều kiện để kiểm tra được trước khi apply. Nó **không** tự
sắp thứ tự `pulumi up` giữa các stack. Thứ tự thực thi, approval, và việc reconcile bao nhiêu stack trong một lần chạy là
**execution contract** của workflow, và nó **chưa** được hiện thực (`02-delivery.md` §7.4.1 · §12). Đừng đọc quan hệ
project graph thành một cam kết về thứ tự.

**Sai lệch cần biết:** tag `type:deployment` (dưới đây) phân biệt deployment project với **adapter implementation**, chứ
không phân biệt deployment project với **infrastructure adapter của một service**. `platform-deploy` và một
`deploys/<unit>-deploy` thuộc trục _deployment_; `libs/<bc>-infrastructure` thuộc trục _implementation trong ứng dụng_. Deploy
project không import implementation của service, và service không import deploy project — dependency đi một chiều từ
deployment sang **khai báo nhu cầu hạ tầng**, không phải sang code ứng dụng.

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

| Project                 | Được phụ thuộc                                                     |
| ----------------------- | ------------------------------------------------------------------ |
| `<bc>-domain`           | Không `application`, không `infrastructure`, không Nx project khác |
| `<bc>-application`      | `<bc>-domain`                                                      |
| `<bc>-infrastructure`   | `<bc>-application`, `<bc>-domain`                                  |
| runtime / app           | Library của các context mà nó compose                              |
| `deploys/<unit>-deploy` | `platform-deploy` — không phụ thuộc `apps/` hay `libs/`            |
| `platform-deploy`       | Không `deploys/<unit>-deploy`, không `apps/`/`libs/`               |
| service A               | **Không** import implementation của service B                      |
| service B               | Chỉ qua boundary / interface / contract được phép của B            |

`<bc>-contracts` đứng ngoài chuỗi này: nó là artifact mà provider **publish** và consumer **depend on**, không phải một tầng để
import theo hướng trên.

**Ngoại lệ đã biết — `deploys/*-deploy` → `tools/dx` (nguồn).** `platform-deploy` và `home-deploy` import **nguồn** của
`tools/dx` qua đường dẫn tương đối (`../../tools/dx/src/...`, bật tường minh `@nx/enforce-module-boundaries` tại đúng dòng
import) để dùng chung một định nghĩa namespace và contract outputs — lý do và ràng buộc ts-node ghi ở `tsconfig.json` của
từng deploy project. Nx ghi nhận cạnh này trên project graph dưới dạng `static` (plugin `@nx/js/typescript` suy từ import),
nên cache `typecheck`/`lint` của deploy project vẫn phụ thuộc đúng file `tools/dx/src` được import. Cạnh đó **không** nằm
trong `validateDeploymentGraph` theo cùng chuẩn `deploys/<unit>-deploy → platform-deploy`: nó là Tooling (định nghĩa chia sẻ
thời gian chạy), không phải prerequisite lifecycle giữa hai stack — import tương đối không sinh cycle lifecycle vì `tools/dx`
không deploy resource nào. Deploy project mới import `tools/dx` theo đường này phải giữ hai oxlint-disable tường minh tại
đúng dòng import, không nới luật chung.

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
| `type:deployment`     | Infrastructure provisioning/deployment orchestration (`deploys/`)  |
| `type:tooling`        | Developer tooling, DX automation, repository utilities             |

**`type:deployment` khác `type:infrastructure` ở đâu, và vì sao phải tách.** Cả hai đều nằm ngoài bounded context, nhưng
trả lời hai câu hỏi khác nhau: `type:infrastructure` là **adapter trong ứng dụng** (một `libs/<bc>-infrastructure` chạy
_trong_ tiến trình Worker, gọi Postgre qua Hyperdrive), còn `type:deployment` là **orchestration hạ tầng** (một project
Pulumi _ngoài_ ứng dụng, gọi Cloudflare API để tạo/cập nhật/xoá tài nguyên). Gộp chúng sẽ cho phép một deploy project import
adapter của service — đúng cách lách ranh giới ownership mà `01-architecture.md` invariant 7 chặn. Repo hiện đang chuyển
các project trong `deploys/` từ `type:infrastructure` sang `type:deployment`; xem §10.

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

Deployment project trong `deploys/` mang `runtime:native`: Pulumi program chạy như một tiến trình Node.js CLI ngoài
Worker, cùng hàng với `type:tooling` — đây là lý do chúng nằm ngoài ma trận compatibility của edge/browser.

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

**Một scope có thể có nhiều app.** Scope là trục **ownership**, không phải trục deploy unit: `identity` là bounded
context, còn `account` và `auth` là hai deploy unit độc lập trong đó (`01` §2.1). Cả hai app đều mang
`type:composition` + `scope:identity` + `runtime:edge` — cùng scope, cùng tag, không có tag riêng cho từng deploy unit.
Ranh giới giữa chúng **không** do tag Nx enforce: constraint `type:composition` cấm app import app, và đó là ranh giới
duy nhất mà tag đảm bảo. Ranh giới protocol/UI giữa `account` và `auth` là quyết định kiến trúc, enforce bằng review và
contract test — không phải bằng tag mới.

**Scope của deployment project là ranh giới provisioning, không phải bounded context.** Một `deploys/<unit>-deploy` mang
`scope` của deploy unit mà nó provision (cùng scope với app tương ứng), vì nó sở hữu **hạ tầng** của unit đó chứ không
sở hữu một context nghiệp vụ mới. Hệ quả cần nói rõ: deployment project **không** được phép phụ thuộc `libs/<bc>-*` của
scope khác — nó khai báo hạ tầng, không gọi implementation của service. Đây là ranh giới ở tầng **provisioning ownership**,
tách khỏi ranh giới ở tầng **service dependency** mà contract test bảo vệ.

⚠️ **Khoảng trống enforcement thật, cần biết khi debug:** tag Nx **không** phân biệt được hai app cùng `scope:identity`,
nên nó cũng **không** chặn được việc một app chạm database của app kia. Việc thêm Hyperdrive binding trỏ sang
`db-auth` trong `apps/account` đi qua mọi lượt kiểm ở §7. Đó là lý do ranh giới database của identity được enforce
ở tầng **grant mức database** (`REVOKE CONNECT` chéo) chứ không ở tầng module graph — cấu hình không đủ, phải có
credential không cho phép (`services/account/03-operations.md` §3.1).

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
| `type:deployment`        | Chỉ phụ thuộc `type:deployment` (cụ thể là `platform-deploy`); không compose code ứng dụng                  |
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

**Prerequisite platform được kiểm ở tầng nào.** Quan hệ `deploys/<unit>-deploy` → `platform-deploy` là quan hệ trên
project graph, nên nó thuộc phạm vi của `arch-check` (lượt graph-wide) chứ không phải lượt Oxlint direct: một deployment
project khai sai tên prerequisite, hoặc `platform-deploy` nào đó lỡ phụ thuộc ngược một `<unit>-deploy`, đều lộ ra ở lượt
đọc graph. Đây là kiểm **cấu trúc prerequisite**, không phải kiểm **thứ tự chạy** — xem §2.1.

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

| Phần                                                | Trạng thái hiện tại                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/` = runtime / composition / deploy            | ✅ Đúng; mọi app đều là deploy unit `runtime:edge`, tag `type:composition`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `libs/<bc>-*` theo bounded context                  | 🚧 Bounded context `identity` có đủ chuỗi layer, tách theo deploy unit `auth`: `libs/identity-domain` (`type:domain`/`runtime:universal`) — gồm mô hình ACR `urn:ecoma:acr:*` (`src/acr.ts`, thang bậc `authn_level` đã xoá); `libs/identity-contracts` (`type:contracts`/`runtime:universal`) — envelope HMAC + payload `POST /internal/session/verified`; và bốn lib của phía `auth` mang `scope:identity`/`runtime:edge`: `identity-auth-domain`, `identity-auth-contracts`, `identity-auth-application` (`type:application`), `identity-auth-infrastructure` (`type:infrastructure` — CAS authorization transaction/code, store Postgres). Không có `libs/identity-application`/`libs/identity-infrastructure` chung — tách theo app thay cho tên layer chung. Các thư viện public web cũ (`i18n-public`, `layout-public`, `error-pages`) đã được hợp nhất vào `apps/home` như module app-local (`app/i18n`, `app/layout`, `app/error-pages`) — đó là hợp nhất trong app, không phải `libs/`. Riêng artwork brand logo (`libs/logo` cũ) đã được hợp nhất vào `app/brand`, và sau đó được rút ra thành `libs/ui-ecoma-logo` (`@ecoma-io/ui-ecoma-logo`, `type:application`/`scope:shared`/`runtime:universal`) — library UI dùng chung, không phải app-local. |
| `tests/` cho E2E                                    | ❌ Chưa có                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `deploys/` = provisioning                           | 🚧 Layout canonical đã dựng: 11 Pulumi deployment project, `platform-deploy` là tầng platform prerequisite. `platform-deploy` + `home-deploy` hiện thực local platform với managed resource thật (network, Traefik, PostgreSQL, container home — apply tường minh qua `pnpm dx local-deploy`, xem `services/local-platform/`); 9 project còn lại là scaffold — `Pulumi.yaml` + một `index.ts` chỉ log, zero managed resource. Target `provision` chỉ in kế hoạch và **không** chạy `pulumi up`; chưa có workflow CI nào chạy Pulumi (`02-delivery.md` §7.4.1 · §12). Tên project khớp thư mục, mọi project mang `type:deployment` + scope theo deploy unit + `runtime:native`, và mọi project trừ `platform-deploy` khai cạnh `implicitDependencies` tới nó.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Dependency constraints `type` / `scope` / `runtime` | ✅ Enforce bằng Oxlint boundaries + `pnpm dx arch-check` trong CI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `<bc>-contracts`                                    | 🚧 `libs/identity-contracts` là project contracts đầu tiên (bounded context `identity`). `libs/transactional-mail-contracts` (`@ecoma-io/transactional-mail-contracts`, `type:contracts`/`scope:messaging`/`runtime:universal`) đã có cho bounded context `transactional-mail` — publish Queue command, private delivery interface và public `POST /v1/messages`. Contract registry chưa dựng (`02` §3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Rust toolchain                                      | ✅ Pin sẵn `rust-toolchain.toml`; chưa có Cargo project nên chưa có target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
