<!--
  Tiêu đề PR (tiếng Anh — CI kiểm bằng `pnpm dx pr-check`):
    <type>(<scope>): <subject>
    <type>: <subject>
  - Dành cho PR không mang `feat`/`fix` nào: type chore / docs / ci / refactor / test / style / perf / build...
  - scope là tên Nx project (vd: identity, transactional-mail, docs, dx). Scope không bắt buộc; nếu có thì chỉ được đúng một
  - PR dùng squash merge → tiêu đề PR trở thành commit title trên main
  - Thay đổi là feature hoặc bug fix, hay có breaking change → dùng template Feature/Fix

  Body PR viết tiếng Việt; giữ nguyên file path, error code, technical term.
-->

## Linked issue

Closes #

## Loại thay đổi

<!-- chore / docs / ci / refactor / test / ... -->

## Lý do

<!-- Tại sao cần thay đổi này. -->

## Thay đổi

-

## Kiểm chứng

<!-- Lệnh đã chạy và kết quả. -->

```bash

```

## Checklist

- [ ] PR chỉ chứa đúng một thay đổi; đã link issue ở trên (hoặc giải thích vì sao không cần issue)
- [ ] Tiêu đề PR tiếng Anh, theo Conventional Commits
- [ ] `lint` / `test` / `build` chạy xanh local trước khi push
- [ ] Không đưa secret vào Git; không log prompt/response body
- [ ] Docs/README được cập nhật nếu thêm, xoá hoặc đổi tên tài liệu (tiếng Việt)
- [ ] Đã rebase lên `main` mới nhất; CI xanh và mọi conversation đã resolve trước khi mark Ready for review
