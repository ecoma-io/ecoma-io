---
title: Blog này là gì (và không phải gì)
description: Đây là một vertical slice demo - layout thật, pipeline thật, content editorial một cách có chủ ý.
date: '2026-10-07'
author: John Martin
tags:
  - meta
featured: false
---

# Blog này là gì (và không phải gì)

Mọi thứ bạn đang đọc ở đây là một **bản demo**. Các article được viết để
exercise cơ chế - listing, selection featured, bài liên quan, trước/sau, locale
switching, resolve media - với văn editorial viết cho mục đích đó.

## Cái gì thật

- Layout bạn đang đọc render từ đúng các code path mà một article production
  sẽ đi qua.
- Pipeline build là pipeline production: Markdown vào, page prerendered ra,
  mọi link và ảnh được resolve ở build time.
- Hành vi 404, URL canonical, và locale alternate bị ràng buộc, không phải
  mô phỏng.

![Sơ đồ pipeline: Markdown chảy qua static build và ra file HTML, CSS, SVG thuần](../../../assets/build-time-pipeline.svg)

## Cái gì không

- Bản thân các article không phải tài liệu sản phẩm; bề mặt docs sở hữu việc
  đó.
- Tên, ngày và byline là dữ liệu demo.
- Không có CMS đằng sau - publish là một commit.

## Cách review

Click quanh một cách có chủ đích:

1. Mở [bài featured](/vi/blog/url-model), rồi dùng trước/sau để đi hết danh
   sách.
2. Chuyển locale giữa chừng article và xác nhận slug sống sót qua cuộc hành
   trình.
3. Truy cập `/vi/blog/not-a-real-article` và kiểm tra bạn nhận được 404 thật.
4. Xem head của bất kỳ trang nào: một URL canonical và các `hreflang` alternate
   chỉ trỏ tới những trang tồn tại.

---

_Bắt đầu ở đâu cũng được - [bài mô hình URL](/vi/blog/url-model) là một điểm
khởi đầu tốt như mọi điểm khác._
