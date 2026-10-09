---
title: Phát triển cục bộ
description: Vòng lặp phát triển cụ thể — khởi động app, kiểm tra trang, đổi nội dung, chạy test, build.
---

# Phát triển cục bộ

Hướng dẫn này đi qua vòng lặp phát triển hằng ngày của một public app.

## 1. Khởi động app

Từ root workspace, khởi động dev server của ứng dụng docs:

```bash
cd apps/docs
pnpm exec nuxt dev
```

Server lắng nghe tại `http://localhost:4203` — port được pin trong `devServer`
của `nuxt.config.ts` ứng dụng. Nx target `serve` chạy cùng một lệnh đó:
`npx nx serve @ecoma-io/docs`.

## 2. Kiểm tra một trang

Mở một tài liệu trên trình duyệt, ví dụ:

```text
http://localhost:4203/vi/docs/getting-started/installation
```

Quan sát trang đã render: header với global navigation và bộ chuyển ngôn ngữ,
sidebar của docs, breadcrumbs, mục lục, và liên kết trước/tiếp. Dùng _View
Source_ của trình duyệt để xác nhận trang được server-render.

## 3. Thay đổi nội dung

Nội dung Markdown nằm dưới `apps/docs/content`. Sửa một trang tiếng Việt và mở
bản tiếng Anh tương ứng để thấy cả hai:

```bash
# chọn một trang, ví dụ
$EDITOR apps/docs/content/vi/docs/guides/local-development.md
```

`nuxt dev` nhận thay đổi; trang reload với nội dung mới.

## 4. Chạy test

Từ root workspace, chạy unit test:

```bash
pnpm exec nx test docs
```

Lệnh này chạy các suite Vitest đặt cạnh ứng dụng docs — gồm test path-validation
và content-resolution.

## 5. Build

Ứng dụng docs là một static site, nên build production prerender mọi trang:

```bash
npx nx build-static @ecoma-io/docs
```

Output nằm trong `apps/docs/.output/public` — HTML đã prerender cùng asset, với
symlink `apps/docs/dist` trỏ tới đó. Hai Nx target tiêu thụ output này:

- `npx nx serve-static @ecoma-io/docs` phục vụ nó cục bộ ở port 4200.
- `npx nx deploy @ecoma-io/docs` publish nó lên Cloudflare như một assets-only
  Worker (`build-static` tự chạy trước).

Cần xem lại site đã build mà không deploy, hãy trỏ bất kỳ static file server
nào vào thư mục output, ví dụ:

```bash
npx serve apps/docs/dist
```

---

_Trước: [Hướng dẫn](/vi/docs/guides) · Tiếp: [Xây dựng một trang công khai](/vi/docs/guides/building-a-public-page)_
