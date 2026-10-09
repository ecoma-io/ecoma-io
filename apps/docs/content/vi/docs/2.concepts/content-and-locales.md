---
title: Nội dung và ngôn ngữ
description: Cách nội dung tài liệu được bản địa hoá và cách content path ánh xạ sang public route.
---

# Nội dung và ngôn ngữ

Nội dung tài liệu **bản địa hoá ngay tại nguồn**: mỗi trang tồn tại ở từng
locale, và content path ánh xạ trực tiếp sang public route.

## Nội dung bản địa hoá

Content của docs nằm trong `apps/docs/content`:

```text
content/
├── en/
│   └── docs/
│       └── getting-started/
│           └── installation.md
└── vi/
    └── docs/
        └── getting-started/
            └── installation.md
```

Mỗi locale có **bản riêng** của mọi trang, viết tự nhiên theo ngôn ngữ đó —
không phải bản dịch máy từ ngôn ngữ kia.

## Content path → public route

File path dưới `content/<locale>` trở thành pathname công khai trùng khớp:

```text
content/en/docs/getting-started/installation.md
                  ↓
/en/docs/getting-started/installation

content/vi/docs/getting-started/installation.md
                  ↓
/vi/docs/getting-started/installation
```

**Không có** locale mapping thủ công ở từng trang — thư mục chính là route.

## URL tự chứa

Vì locale là một phần của URL, mỗi tài liệu có một địa chỉ canonical tự chứa.
Liên kết trong tài liệu luôn ở trong locale hiện tại:

```text
/en/docs/concepts/public-web   ← liên kết của người đọc tiếng Anh
/vi/docs/concepts/public-web   ← liên kết của người đọc tiếng Việt
```

## Navigation theo ngôn ngữ

Sidebar, breadcrumbs và previous/next của docs được sinh từ content tree
**lọc theo locale hiện tại**. Người đọc tiếng Anh chỉ thấy cây tiếng Anh; cây
tiếng Việt không rò rỉ vào, và prev/next không bao giờ nhảy qua locale.

---

_Trước: [Web công khai](/vi/docs/concepts/public-web) · Tiếp: [Hướng dẫn](/vi/docs/guides)_
