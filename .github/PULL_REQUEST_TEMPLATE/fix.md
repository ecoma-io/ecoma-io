<!--
  Tiêu đề PR (tiếng Anh — CI kiểm bằng `pnpm dx pr-check`):
    fix(<scope>): <subject>
  - scope là tên Nx project (vd: identity, transactional-mail, docs, dx)
  - Title có đúng một Nx scope; một PR chỉ mang một `fix`, không trộn `feat`
  - PR dùng squash merge → tiêu đề PR trở thành commit title trên main
  - Breaking change chỉ hợp lệ với type feat/fix

  Body PR viết tiếng Việt; giữ nguyên file path, error code, technical term.
-->

## Linked issue

Closes #

## Mô tả lỗi

<!-- Triệu chứng quan sát được; kèm log/error code nguyên văn (không dịch). -->

## Root cause

<!-- Nguyên nhân gốc. -->

## Cách sửa

-

## Test tái hiện

<!-- Test fail trước khi fix, pass sau khi fix; hoặc lý do không cần test. -->

## Kiểm chứng

<!-- Lệnh đã chạy và kết quả. -->

```bash

```

## Checklist

- [ ] PR chỉ chứa đúng một fix; đã link issue ở trên
- [ ] Tiêu đề PR tiếng Anh, theo Conventional Commits
- [ ] `lint` / `test` / `build` chạy xanh local trước khi push
- [ ] Không đưa secret vào Git; không log prompt/response body
- [ ] Docs được cập nhật nếu behavior/contract thay đổi (tiếng Việt)
- [ ] Đã rebase lên `main` mới nhất; CI xanh và mọi conversation đã resolve trước khi mark Ready for review
