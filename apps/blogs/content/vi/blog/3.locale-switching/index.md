---
title: Locale switching không bao giờ nói dối
description: Language switcher chỉ được offer thứ tồn tại. Đây là cách danh sách link được suy ra từ content thật.
date: '2026-09-16'
author: John Martin
tags:
  - i18n
  - ux
featured: false
---

# Locale switching không bao giờ nói dối

Điều tệ nhất một language switcher có thể làm là offer một bản dịch không tồn
tại. Reader bấm vào, rơi vào trang 404, và học được rằng switcher nói dối.
Nên quy tắc ở đây rất đơn giản:

> Link switcher chỉ được render khi bản dịch thực sự tồn tại.

## Availability đến từ content

Với mỗi trang, app hỏi content collection xem những locale nào có document ở
cùng resource path. Switcher render từ câu trả lời đó - không phải từ registry
đầy đủ. Nếu một trang chỉ có tiếng Anh, reader tiếng Anh không thấy link tiếng
Việt, vì đằng sau nó không có gì cả.

## Slug là khoá nối

Các bản dịch dùng chung một slug. `/en/blog/locale-switching` và
`/vi/blog/locale-switching` là cùng một article, nên việc chuyển locale nghĩa
là thay đúng một segment:

```text
/en/blog/locale-switching
       |
       v
/vi/blog/locale-switching
```

Không có bảng mapping per-page, không có chuỗi redirect sau switcher - path
được dựng lại bởi builder của chính nền tảng, thứ từ chối output hỏng lúc
compile thay vì phục vụ nó.

## Metadata theo cùng quy tắc

Các link `hreflang` alternate trong head của trang được dựng từ cùng câu trả
lời availability. Một trang không bao giờ quảng bá với search engine một bản
dịch mà nó không offer cho reader.

| Bề mặt          | Nguồn chân lý                    |
| --------------- | -------------------------------- |
| Link switcher   | content query                    |
| Link `hreflang` | content query                    |
| `canonical`     | path hiện tại, production origin |

Một query, ba bề mặt, không lệch nhau.

---

_Registry định nghĩa những locale nào tồn tại được nhắc đến trong bài
[content build-time](/en/blog/build-time-content)._
