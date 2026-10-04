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

| Tag        | Ý nghĩa                                 |
| ---------- | --------------------------------------- |
| `scope:`   | Ownership / bounded context             |
| `layer:`   | Architectural layer của bounded context |
| `runtime:` | Runtime constraint                      |
| `type:`    | Project category                        |

Tag chuẩn hoá: `scope:<bounded-context>` và `layer:domain` · `layer:application` · `layer:infrastructure` · `layer:contracts`.
Repo hiện dùng `type`, `scope`, `runtime`; `layer` là **required architecture constraint**, chưa có trong Nx configuration
(mục 8).

## 7. Architecture enforcement

| Cơ chế                     | Chặn cái gì                                                                 |
| -------------------------- | --------------------------------------------------------------------------- |
| Nx dependency constraints  | Import vượt ranh giới `type` / `scope` / `runtime`                          |
| oxlint module boundaries   | Ranh giới project không được bypass; guard `runtime:edge` chặn Node builtin |
| Custom architecture checks | Rule không biểu đạt được bằng tag, khi cần                                  |

Phân biệt rõ **architecture rule** (điều tài liệu này phát biểu) với **current Nx configuration** (điều repo thực sự enforce).
Một rule chưa có cơ chế enforce là **required architecture constraint**, không phải đã implemented.

## 8. Current state

| Phần                                                | Trạng thái hiện tại                                                        |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| `apps/` = runtime / composition / deploy            | ✅ Đúng; mọi app đều là deploy unit `runtime:edge`                         |
| `libs/<bc>-*` theo bounded context                  | ❌ Chưa có. `libs/` chỉ có `i18n-public`, `layout-public` (`scope:public`) |
| `tests/` cho E2E                                    | ❌ Chưa có                                                                 |
| Dependency constraints `type` / `scope` / `runtime` | ✅ Enforce bằng oxlint; chưa có constraint theo `layer`                    |
| `<bc>-contracts`                                    | ❌ Chưa có project contracts nào; contract registry chưa dựng (`02` §3)    |
