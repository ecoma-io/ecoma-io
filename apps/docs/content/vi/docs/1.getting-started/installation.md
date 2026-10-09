---
title: Cài đặt
description: Yêu cầu tiên quyết và tổng quan về phát triển cục bộ cho monorepo Ecoma.
---

# Cài đặt

Trang này mô tả những gì cần có trước khi chạy repository cục bộ, và ý nghĩa
cơ bản của "phát triển cục bộ" trong workspace này.

## Yêu cầu tiên quyết

Cần các công cụ sau:

| Công cụ     | Mục đích                      |
| ----------- | ----------------------------- |
| Node.js 24+ | Runtime cho tooling và build  |
| pnpm 12+    | Package manager cho workspace |
| Git         | Quản lý phiên bản             |

Version chính xác được pin trong repository: `.node-version` pin Node.js và
field `packageManager` trong `package.json` pin pnpm. Dùng Corepack hoặc cài
trực tiếp đúng các version đó là toàn bộ toolchain sẽ thống nhất với nhau.

> **Lưu ý** — trên macOS có thể cần `watchman` nếu trình theo dõi file báo
> rebuild không liên quan.

## Repository và workspace

Repository là một **monorepo** được quản lý bằng [Nx](https://nx.dev/) và pnpm:

```text
apps/    runtime và deploy unit (web app, service)
libs/    library dùng chung, thuộc bounded context
docs/    tài liệu kiến trúc và vận hành
tools/   tooling dành cho developer (dx CLI)
```

pnpm workspace bao phủ `apps/*`, `tools/*` và `docs`; các library dưới `libs/`
là Nx project không có `package.json` riêng, được resolve qua workspace alias.
Mọi thư mục còn lại trong layout trên là package của pnpm workspace. `apps/docs`
là ứng dụng tài liệu mà bạn đang đọc.

## Tổng quan phát triển cục bộ

Vòng lặp phát triển điển hình gồm ba bước.

### Cài dependencies

Từ root của workspace:

```bash
pnpm install
```

### Tạo type cho Nuxt

Nuxt sinh các file type trong `.nuxt/` một lần trước lần chạy đầu tiên:

```bash
cd apps/docs
pnpm exec nuxt prepare
```

### Khởi động dev server

```bash
pnpm exec nuxt dev
```

Dev server có thể truy cập tại `http://localhost:4203`:

```bash
curl -I http://localhost:4203/vi/docs/getting-started
```

Chạy unit test cho một app từ root:

```bash
pnpm exec nx test docs
```

## Build sẽ làm gì

Ứng dụng docs là một **static site**: `nitro.config.ts` chọn preset Nitro
**`static`**, nên mọi truy vấn content chạy ở build time trên Node và output
chỉ là file tĩnh — không có code runtime, không có database. Nx target build
chạy Nuxt kèm prerendering:

```bash
npx nx build-static @ecoma-io/docs
```

Output nằm trong `apps/docs/.output/public`:

```text
.output/public/           HTML đã prerender, một thư mục cho mỗi route
.output/public/_nuxt/     client asset đã hash
.output/public/__nuxt_content/  dump của content database
```

Nuxt cũng để lại symlink `dist` trỏ tới `.output/public` — đó là path mà target
`serve-static` phục vụ và là path mà `wrangler.jsonc` deploy
(`nx deploy @ecoma-io/docs` build static site trước, rồi publish như một
assets-only Worker).

> **Cảnh báo** — không bao giờ commit secret vào `.dev.vars*` hoặc `.env*`.
> Cấu hình Worker cục bộ chỉ dùng cho phát triển.

---

_Tiếp: [Các bước đầu tiên](/vi/docs/getting-started/first-steps)_
