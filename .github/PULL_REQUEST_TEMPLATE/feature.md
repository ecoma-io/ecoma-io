<!--
  Tiêu đề PR (tiếng Anh — CI kiểm bằng `pnpm dx pr-check`):
    feat(<scope>): <subject>
  - scope là tên Nx project (vd: identity, transactional-mail, docs, dx)
  - Title có đúng một Nx scope; một PR chỉ mang một `feat`, không trộn `fix`
  - PR dùng squash merge → tiêu đề PR trở thành commit title trên main
  - Breaking change chỉ hợp lệ với type feat/fix

  Body PR viết tiếng Việt; giữ nguyên file path, error code, technical term.
-->

## Linked issue

Closes #

## Mô tả

<!-- Thay đổi này làm gì và tại sao cần. -->

## Thay đổi chính

-

## Kiểm chứng

<!-- Lệnh đã chạy và kết quả (lint / typecheck / test / build...). -->

```bash

```

## Checklist

- [ ] PR chỉ chứa đúng một tính năng; đã link issue ở trên
- [ ] Tiêu đề PR tiếng Anh, theo Conventional Commits
- [ ] `lint` / `test` / `build` chạy xanh local trước khi push
- [ ] Không đưa secret vào Git; không log prompt/response body
- [ ] Docs được cập nhật nếu behavior/contract thay đổi (tiếng Việt)
- [ ] Đã rebase lên `main` mới nhất; CI xanh và mọi conversation đã resolve trước khi mark Ready for review
