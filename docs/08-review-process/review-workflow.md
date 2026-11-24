# Review Workflow

## 1. Mục đích

Tài liệu này quy định các bước thực hiện một review từ lúc đề xuất thay đổi đến khi review được kết thúc và lưu bằng chứng.

Quy trình áp dụng cho tài liệu, Decision Record, mô hình domain, thiết kế hệ thống và thay đổi implementation có ảnh hưởng kiến trúc.

## 2. Tổng quan quy trình

```text
Identify Change
      |
      v
Classify Review Level
      |
      v
Prepare Review Package
      |
      v
Assign Reviewers
      |
      v
Perform Review
      |
      v
Record Findings
      |
      v
Resolve Findings <----+
      |                |
      v                |
Re-review -------------+
      |
      v
Review Conclusion
      |
      v
Approval (if required)
      |
      v
Publish and Archive
```

## 3. Bước 1 — Identify Change

Author xác định:

- Vấn đề hoặc nhu cầu.
- Nội dung đang thay đổi.
- Mục tiêu và phạm vi.
- Các tài liệu, quyết định, Domain, Bounded Context hoặc system liên quan.
- Có thay đổi Decision Record hay không.
- Có thay đổi Invariant, contract, security boundary hoặc data ownership hay không.

Đầu ra: mô tả thay đổi đủ rõ để phân loại review.

## 4. Bước 2 — Classify Review Level

Author đề xuất mức R0–R3 theo `review-policy.md`.

Khi phân loại cần đánh giá:

- Mức độ ảnh hưởng đến business ownership và trách nhiệm.
- Số lượng Domain, Context hoặc system bị ảnh hưởng.
- Tác động đến dữ liệu, security, finance hoặc external contract.
- Khả năng đảo ngược.
- Mức độ rủi ro nếu quyết định sai.
- Khả năng phát hiện lỗi sau khi triển khai.

Reviewer hoặc Review Coordinator có thể yêu cầu nâng mức nếu phạm vi hoặc rủi ro bị đánh giá thấp.

Đầu ra: mức review và lý do phân loại.

## 5. Bước 3 — Prepare Review Package

Author chuẩn bị gói review gồm:

1. Mô tả vấn đề và mục tiêu.
2. Nội dung thay đổi hoặc liên kết tới diff.
3. Các Fact, Assumption, Proposal và Open Question có liên quan.
4. Decision Records đang có hiệu lực.
5. Các phương án đã cân nhắc và rationale.
6. Impact analysis.
7. Checklist phù hợp đã tự kiểm tra.
8. Test, diagram, prototype hoặc evidence cần thiết.
9. Những nội dung cần reviewer tập trung phản biện.

Không yêu cầu chuẩn bị mọi loại artifact cho mọi review. Gói review phải đủ để reviewer hiểu thay đổi mà không phải tự đoán bối cảnh.

## 6. Bước 4 — Assign Reviewers

Chọn reviewer theo phạm vi chuyên môn và authority matrix.

- Review chuyên môn phải có người hiểu domain hoặc technical area liên quan.
- Thay đổi xuyên nhiều lớp cần reviewer cho các lớp bị ảnh hưởng.
- R2/R3 cần xem xét tính độc lập và xung đột lợi ích.
- Người approve phải có authority phù hợp; không mặc định reviewer là approver.
- Nếu chưa xác định được authority, review có thể tiếp tục ở mức đánh giá chuyên môn nhưng không được tuyên bố quyết định đã được approve.

Đầu ra: danh sách reviewer, approver dự kiến và phạm vi trách nhiệm.

## 7. Bước 5 — Perform Review

Reviewer thực hiện theo thứ tự:

1. Hiểu vấn đề và phạm vi.
2. Kiểm tra facts, assumptions và constraints.
3. Đối chiếu Architecture Principles và các Decision Records đang có hiệu lực.
4. Sử dụng checklist chung và checklist chuyên biệt.
5. Kiểm tra các tình huống bình thường, ngoại lệ và thất bại.
6. Đánh giá tác động xuyên lớp.
7. Ghi findings có căn cứ.

Reviewer nên phân biệt:

- Lỗi hoặc mâu thuẫn bắt buộc sửa.
- Rủi ro cần authority chấp nhận.
- Câu hỏi cần thêm bằng chứng.
- Cải tiến tùy chọn.

Không nên viết lại toàn bộ tài liệu thay cho Author nếu chỉ cần nêu vấn đề và tiêu chí cần đáp ứng.

## 8. Bước 6 — Record Findings

Mọi finding có ảnh hưởng đến kết luận phải được ghi trong Review Record hoặc công cụ review có thể truy vết.

Finding cần có severity, vị trí, vấn đề, hệ quả và yêu cầu xử lý.

Nếu finding dẫn đến thay đổi phạm vi, Author phải cập nhật impact analysis và có thể cần phân loại lại review level.

## 9. Bước 7 — Resolve Findings

Author phản hồi từng finding bằng một trong các cách:

- **Fixed:** Đã sửa và cung cấp vị trí hoặc bằng chứng.
- **Clarified:** Bổ sung thông tin để chứng minh không có lỗi.
- **Accepted Risk:** Đề nghị chấp nhận rủi ro; cần authority phù hợp phê duyệt.
- **Disputed:** Không đồng ý và nêu căn cứ.
- **Deferred:** Chuyển thành follow-up có owner và thời hạn; chỉ được dùng nếu finding không chặn approval và authority chấp thuận.

Không tự đóng finding chỉ bằng cách đổi trạng thái. Reviewer hoặc người được giao xác nhận bằng chứng xử lý.

## 10. Bước 8 — Re-review

Reviewer kiểm tra:

- Finding đã được xử lý đúng chưa.
- Thay đổi sửa finding có tạo vấn đề mới không.
- Các tài liệu và Decision Record liên quan đã được cập nhật chưa.
- Phạm vi thay đổi có vượt ra ngoài review ban đầu không.

Nếu thay đổi mới làm đổi bản chất quyết định, cần review lại phần liên quan và phân loại mức độ nếu cần.

## 11. Bước 9 — Review Conclusion

Reviewer hoặc Review Coordinator tổng hợp:

- Findings còn mở.
- Findings đã xử lý.
- Rủi ro được chấp nhận.
- Checklist đã áp dụng.
- Kết luận: `Approved`, `Approved with Conditions`, `Changes Requested`, `Rejected` hoặc `Not Reviewed`.

Chỉ đưa ra kết luận `Approved` khi không còn finding chặn và bằng chứng đủ cho phạm vi review.

## 12. Bước 10 — Approval

Nếu thay đổi cần approval:

1. Xác định loại quyết định và authority.
2. Cung cấp Review Record cùng Decision Record và impact analysis.
3. Approver xem xét kết luận review, rủi ro và phạm vi quyền hạn.
4. Approver chấp thuận, từ chối hoặc yêu cầu bổ sung.
5. Ghi người approve, thời điểm, điều kiện và rationale.

Approval phải tuân theo `decision-process.md` và `review-authority.md`.

Kết luận review không tự động chuyển Decision Record thành `Accepted`.

## 13. Bước 11 — Publish and Archive

Sau khi review và approval hoàn tất, trước khi publish:

1. Xác minh artifact hoặc commit chuẩn bị publish đúng là phiên bản đã được review và approve.
2. Kiểm tra các condition có thời điểm hoàn thành trước publish đã được đáp ứng.
3. Nếu artifact thay đổi sau approval, đánh giá xem thay đổi có ảnh hưởng rationale, findings, decision hoặc approval conditions không.
4. Nếu có ảnh hưởng, thực hiện re-review phần liên quan trước khi publish.
5. Ghi lại chính xác commit, version hoặc revision cuối cùng được publish trong Review Record.

Sau đó:

- Cập nhật tài liệu nguồn sở hữu.
- Cập nhật Decision Record và status nếu có.
- Liên kết Review Record với PR, commit hoặc tài liệu.
- Tạo follow-up work item cho điều kiện còn lại.
- Lưu Review Record theo `review-records/README.md`.
- Thông báo kết quả cho stakeholder bị ảnh hưởng nếu cần.

## 14. Khi nào phải review lại

Phải review lại khi:

- Nội dung được review thay đổi đáng kể.
- Một finding Blocker hoặc Major được xử lý bằng cách thay đổi phương án.
- Xuất hiện evidence mới làm thay đổi rationale.
- Phạm vi tác động mở rộng.
- Quyết định hoặc nguyên tắc liên quan thay đổi.
- Phiên bản được approve không còn là phiên bản dự kiến publish hoặc implement.

Không cần review lại toàn bộ nếu thay đổi chỉ là editorial và không ảnh hưởng ý nghĩa, nhưng Author phải bảo đảm diff không làm thay đổi nội dung được approve.

## 15. Review khẩn cấp

Trong incident:

1. Ghi nhận lý do cần hành động trước review đầy đủ.
2. Xác định người có authority vận hành.
3. Thực hiện thay đổi tối thiểu.
4. Lưu bằng chứng và phạm vi thay đổi.
5. Sau khi ổn định, tạo Review Record và retrospective review.
6. Xác định quyết định lâu dài, rollback hoặc cleanup.

Review khẩn cấp không được bỏ qua bước ghi nhận lịch sử.

## 16. Điều kiện kết thúc

Một review chỉ kết thúc khi:

- Phạm vi và phiên bản được review đã xác định.
- Mức review và checklist được ghi nhận.
- Reviewer đã đưa ra kết luận.
- Không còn finding chặn hoặc rủi ro đã được authority phù hợp chấp nhận.
- Approval đã hoàn tất nếu cần.
- Review Record đã được lưu và liên kết.
- Follow-up có owner và điều kiện đóng.
