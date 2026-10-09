---
title: Xây dựng một trang công khai
description: Cách một trang công khai kết hợp app, layout-public, i18n-public và content.
---

# Xây dựng một trang công khai

Một trang công khai trên Ecoma là sự kết hợp của 4 tầng:

```text
apps/<app>      →  ứng dụng: routing, content, UI riêng của docs
        ↓
layout-public   →  PublicShell, global navigation, mount topology
        ↓
i18n-public     →  locale dimension: registry, parse, switch
        ↓
content         →  markdown được bản địa hoá, render từ content tree
```

## 1. Ứng dụng sở hữu routing và content

Ứng dụng docs định nghĩa một file-based route cho toàn bộ nội dung tài liệu.
Route validate pathname theo contract topology chung, rồi resolve document từ
content collection.

Nếu topology không hợp lệ, route bị từ chối trước khi lookup content; nếu content
không tồn tại, trang trả về 404.

## 2. layout-public cung cấp shell

Mọi trang docs đều render shell chung thay vì header/footer riêng:

```vue
<PublicShell :path="route.path">
  <!-- nội dung docs -->
</PublicShell>
```

Shell parse pathname một lần, render header (brand, global navigation, bộ
chuyển ngôn ngữ) và footer — không cần tái hiện lại trên mỗi app.

## 3. i18n-public sở hữu locale

Locale, metadata của locale, và việc chuyển đổi giữa các locale đều đến từ
`i18n-public`. Khi chuyển ngôn ngữ trên trang docs, shell gọi `switchLocale()`
để giữ nguyên document và chỉ đổi segment locale:

```text
/en/docs/concepts/public-web
        ↓
/vi/docs/concepts/public-web
```

Ứng dụng docs không tự implement locale parsing hay path rewriting.

## 4. Content render tại app

Trang query collection `docs` bằng pathname chính xác và render document bằng
`ContentRenderer` — typography bạn thấy (heading, code block, table,
blockquote) là rendering riêng của app, không phải dịch vụ render chung.

---

_Trước: [Phát triển cục bộ](/vi/docs/guides/local-development)_
