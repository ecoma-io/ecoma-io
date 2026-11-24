# Common Review Checklist

## 1. Cách sử dụng

Checklist này áp dụng cho mọi loại review. Reviewer phải kết hợp checklist chung với checklist chuyên biệt theo phạm vi thay đổi.

Trạng thái từng mục:

- `Pass`: Đã kiểm tra và đáp ứng.
- `Fail`: Có vấn đề cần xử lý.
- `Partial`: Mới đáp ứng một phần hoặc cần thêm bằng chứng.
- `N/A`: Không áp dụng, cần nêu lý do khi mục có liên quan đến phạm vi.

Không đánh dấu `Pass` chỉ vì không tìm thấy vấn đề trong lúc đọc nhanh.

## 2. Context và Scope

- [ ] Vấn đề và lý do thay đổi được mô tả rõ.
- [ ] Mục tiêu và phạm vi thay đổi được xác định.
- [ ] Phần ngoài phạm vi được nêu khi cần thiết.
- [ ] Stakeholder, actor, Domain, Ecoma Platform hoặc system bị ảnh hưởng được xác định.
- [ ] Facts được phân biệt với Assumptions.
- [ ] Các Open Questions quan trọng được nêu rõ.
- [ ] Phiên bản hoặc commit được review có thể xác định.

## 3. Decision Consistency

- [ ] Các Decision Records liên quan đã được tìm và đối chiếu.
- [ ] Không mâu thuẫn với Decision đang `Accepted` mà chưa có xử lý.
- [ ] Nếu thay đổi quyết định cũ, có liên kết và impact analysis.
- [ ] Trạng thái Proposal, Open Question và Decision không bị nhập nhằng.
- [ ] Authority cần thiết được xác định.
- [ ] Rationale giải thích được vì sao chọn phương án.
- [ ] Trade-off và consequences được ghi nhận.

## 4. Ownership và Boundaries

- [ ] Có owner cho từng responsibility quan trọng.
- [ ] Không nhập nhằng ownership giữa Ecoma Platform, Domain (LLM/GPU) và system.
- [ ] Không tạo shared responsibility mà không có cơ chế quyết định.
- [ ] Dependency và boundary bị ảnh hưởng được xác định.
- [ ] Không giả định các khái niệm ở các lớp khác nhau ánh xạ một-một.
- [ ] Các ngoại lệ hoặc boundary crossing có lý do và contract rõ.

## 5. Completeness và Correctness

- [ ] Các thuật ngữ quan trọng được dùng nhất quán.
- [ ] Mô hình hoặc thiết kế bao phủ các scenario chính.
- [ ] Các trường hợp ngoại lệ và failure case quan trọng được xem xét.
- [ ] Không có mâu thuẫn nội bộ rõ ràng.
- [ ] Các sơ đồ có legend, scope và source of truth phù hợp.
- [ ] Các tuyên bố có thể kiểm chứng được hỗ trợ bằng evidence.
- [ ] Mỗi nội dung quan trọng được ghi tại tài liệu sở hữu chính.
- [ ] Các tài liệu liên quan tham chiếu đến source of truth thay vì sao chép định nghĩa.
- [ ] Không có nhiều tài liệu cùng tuyên bố là nguồn sở hữu chính cho một khái niệm.
- [ ] Các tài liệu bị ảnh hưởng bởi thay đổi đã được xác định và cập nhật.
- [ ] Trách nhiệm duy trì tài liệu sau thay đổi được xác định khi cần.

## 6. Impact và Evolution

- [ ] Tác động xuyên lớp được đánh giá.
- [ ] Tác động đến consumer, dependency và integration được đánh giá.
- [ ] Migration hoặc compatibility được xem xét nếu cần.
- [ ] Khả năng rollback hoặc recovery được xem xét khi phù hợp.
- [ ] Các rủi ro còn lại được nêu rõ.
- [ ] Các follow-up có owner và điều kiện hoàn thành.
- [ ] Có cách xác minh implementation hoặc mô hình sau thay đổi.

## 7. Review Quality

- [ ] Reviewer có chuyên môn phù hợp.
- [ ] Reviewer đã công bố xung đột lợi ích nếu có.
- [ ] Findings có severity, căn cứ và expected resolution.
- [ ] Các bất đồng quan trọng được ghi nhận.
- [ ] Kết luận review phù hợp với findings còn mở.
- [ ] Approval được thực hiện bởi authority đúng phạm vi.
- [ ] Review Record trỏ đúng phiên bản được review.

## 8. Kết luận

- [ ] Không còn Blocker.
- [ ] Major đã được xử lý hoặc rủi ro được authority chấp nhận rõ ràng.
- [ ] Minor còn lại có owner và follow-up nếu được phép.
- [ ] Review outcome được ghi nhận.
- [ ] Decision Record được cập nhật nếu cần.
- [ ] Review Record được lưu và liên kết.
