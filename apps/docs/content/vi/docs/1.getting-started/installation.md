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

Mỗi thư mục trên là một package của pnpm workspace. `apps/docs` là ứng dụng
tài liệu mà bạn đang đọc.

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

Build ứng dụng docs tạo ra Nitro server bundle và static asset:

```text
.nuxt/         artifact build của Nuxt
.output/       output của Nitro (server + public asset)
```

`nitro.config.ts` của apps/docs chọn preset **`cloudflare-module`** để output
có thể deploy lên Cloudflare Workers.

> **Cảnh báo** — không bao giờ commit secret vào `.dev.vars*` hoặc `.env*`.
> Cấu hình Worker cục bộ chỉ dùng cho phát triển.

---

_Tiếp: [Các bước đầu tiên](/vi/docs/getting-started/first-steps)_
