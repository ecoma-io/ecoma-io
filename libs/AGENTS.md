# Repository Instructions — `libs/`

## Phạm vi

Mỗi thư mục con `libs/<bc>-<layer>` là một Nx project. Cấu trúc, tag và ranh giới phụ thuộc → [`docs/overview/05-code-architecture.md`](../docs/overview/05-code-architecture.md).

## Tag bắt buộc

Mỗi project mang **đúng một** tag mỗi chiều: `type:*`, `scope:*`, `runtime:*`. `pnpm dx arch-check` chạy trên **toàn workspace** trong CI, không theo `nx affected` — tag sai ở project không đổi file nào vẫn phải đỏ.

⚠️ **Hai kiểu cấm khác nhau trong `.oxlintrc.json`, và đọc nhầm thì viết sai luật:**

- `notDependOnLibsWithTags` — cấm **transitive**: mọi project _reachable_, kể cả qua trung gian.
- `onlyDependOnLibsWithTags` — allowlist **direct edge**; project ngoài danh sách bị chặn ở lượt import trực tiếp.

| `type`           | Không được phụ thuộc (transitive)                                   | Allowlist direct                                       |
| ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| `domain`         | `application`, `infrastructure`, `composition`, `tooling`           | —                                                      |
| `contracts`      | `domain`, `application`, `infrastructure`, `composition`, `tooling` | —                                                      |
| `application`    | `infrastructure`, `composition`, `tooling`                          | —                                                      |
| `infrastructure` | —                                                                   | `domain`, `application`, `contracts`, `infrastructure` |
| `composition`    | —                                                                   | `domain`, `application`, `contracts`, `infrastructure` |

⚠️ **`type:infrastructure` ĐƯỢC import `type:application`.** Đó là hướng bình thường — adapter cần use case để gọi. Đừng viết luật cấm ngược lại.

⚠️ **`type:contracts` không import `type:domain`, kể cả gián tiếp.** Contract là thứ provider **publish** để consumer phụ thuộc vào, không phải một tầng để đi theo chiều phụ thuộc. Vì vậy kiểu dùng chung được khai báo lại ở tầng contracts dưới dạng union `wire`, không import union của domain.

⚠️ **Tag không phân biệt được hai deploy unit cùng scope.** `apps/account` và `apps/auth` đều là `type:composition` + `scope:identity`, nên **không** tag nào chặn được app khai báo binding trỏ sang database của app kia. Ranh giới đó là credential không cho phép ([`docs/overview/05-code-architecture.md`](../docs/overview/05-code-architecture.md) §6.3).

## Import

- `.oxlintrc.json` cấm `node:*` **và** 18 builtin trần (kể cả `crypto`) trong `libs/**`. Chỉ `*.{spec,test}.{ts,tsx,js,jsx,mts,cts}` được miễn.
- `libs/` không dùng alias: import tương đối trong lib, và package name `@ecoma-io/<name>` khi app dùng.
- ⚠️ **App dùng `@ecoma-io/*` phải khai báo `alias` tường minh trong `nuxt.config.ts`.** `tsconfig.base.json#paths` rỗng và `vite.resolve.tsconfigPaths` **không** resolve được package của workspace lúc runtime.

## Contract với peer service

⚠️ **Dùng chung contract phải là quyết định có issue, không phải tiện lợi khi code.** Hai deploy unit có thể dùng chung `identity-contracts`, nhưng chỉ sau khi bờ của contract đã được chốt ở tài liệu. Lệch ở canonical string, tên header, cửa sổ skew hay cách kiểm replay sẽ hỏng **im lặng ở cả hai đầu** — không có lỗi biên dịch nào bắt được.

## Ngôn ngữ

- Comment và JSDoc: **tiếng Việt**.
- Test title (`it` / `describe`): **tiếng Anh**.
- Commit message: tiếng Anh, ASCII-only.

## Kiểm tra

```bash
pnpm nx run-many -t test lint typecheck -p <project> --skip-nx-cache
pnpm dx arch-check
```

⚠️ `--skip-nx-cache` là bắt buộc khi bạn vừa sửa một file mà chỉ được đọc **lúc runtime** (ví dụ config của commitlint): Nx cache lại kết quả xanh cũ và test chạy lại y hệt file cũ.
