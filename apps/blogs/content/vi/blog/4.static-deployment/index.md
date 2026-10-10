---
title: Deploy một blog như static assets
description: Không Worker script, không database binding - toàn bộ deployment là một thư mục file và một trang 404.
date: '2026-09-23'
author: John Martin
tags:
  - deployment
  - cloudflare
featured: false
---

# Deploy một blog như static assets

Deployment của blog này không chứa code nào. Cấu hình Worker khai báo một
thư mục file, một trang 404, và không gì khác.

## Config nói gì

```jsonc
{
  "assets": {
    "directory": ".output/public",
    "not_found_handling": "404-page",
    "html_handling": "drop-trailing-slash",
  },
}
```

Ba quyết định đáng giải thích:

- **Không `main`** - không có Worker script thì không có gì thực thi theo từng
  request. Nền tảng phục vụ file trực tiếp, vừa là chế độ phục vụ rẻ nhất vừa
  là chế độ đáng tin nhất.
- **`404-page`** - một URL lạ nhận 404 status thật kèm error page thật. Fallback
  kiểu SPA trả 200 cho mọi thứ, âm thầm biến typo thành "trang" có thể index.
- **`drop-trailing-slash`** - URL canonical ở đây không có trailing slash.
  Chế độ mặc định `auto-trailing-slash` sẽ redirect địa chỉ canonical sang một
  địa chỉ không canonical - vĩnh viễn.

## 404 là một phần của sản phẩm

Một blog mà trả 200 mềm cho mọi slug lạ sẽ đào tạo reader mất niềm tin vào link
của nó. Phục vụ 404 thật cho `/vi/blog/not-an-article` là deployment đang làm
đúng việc của nó.

## Có identity mà không cần script

Deployment vẫn mang một Worker identity cho nền tảng - preview và định tuyến
môi trường khoá vào đó - nhưng identity không phải một file thực thi. Nó là
một cái tên cho một thư mục file, và đó chính xác là những gì bề mặt này là.

---

_Đường đọc trước, deployment sau: [content được resolve ở build
time](/en/blog/build-time-content) giải thích vì sao không có runtime database
nào để bind._
