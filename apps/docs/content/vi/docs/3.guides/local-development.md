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

Server lắng nghe tại `http://localhost:4203`.

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

Build production kiểm tra SSR, sinh static asset và preset Cloudflare:

```bash
cd apps/docs
pnpm exec nuxt build
```

Output nằm trong `.output/`. Có thể preview cục bộ:

```bash
npx wrangler dev .output/server/index.mjs --assets .output/public
```

---

_Trước: [Hướng dẫn](/vi/docs/guides) · Tiếp: [Xây dựng một trang công khai](/vi/docs/guides/building-a-public-page)_
