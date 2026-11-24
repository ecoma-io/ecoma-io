# Review Record: `<Review Title>`

## 1. Metadata

- **Review ID:** REV-YYYY-NNN
- **Review Status:** In Progress / Closed
- **Review Level:** R0 / R1 / R2 / R3
- **Review Type:** Strategic / Domain Discovery / Bounded Context / Context Map / Tactical / System Architecture / Monorepo / Quality / Governance / Cross-layer
- **Ngày mở:** YYYY-MM-DD
- **Ngày đóng:** YYYY-MM-DD
- **Tác giả:**
- **Điều phối review:**
- **Reviewer:**
- **Người phê duyệt:**

## 2. Phạm vi

- **Vấn đề / Động cơ:**
- **Thay đổi đề xuất:**
- **Trong phạm vi:**
- **Ngoài phạm vi:**
- **Sản phẩm bị ảnh hưởng:**
- **Domain / Context bị ảnh hưởng:**
- **Hệ thống / Project bị ảnh hưởng:**

## 3. Tài liệu tham chiếu của review

- **Tài liệu được review:**
- **Decision Record:**
- **Pull Request / Commit / Version:**
- **Nguyên tắc kiến trúc:**
- **Checklist đã áp dụng:**

Review phải chỉ rõ phiên bản hoặc commit được đánh giá. Không chỉ liên kết đến một tài liệu có thể tiếp tục thay đổi mà không lưu lại mốc review.

## 4. Phân loại review

- **Level đã chọn:** R0 / R1 / R2 / R3
- **Lý do:**
- **Yêu cầu review cross-layer:** Yes / No
- **Yêu cầu phê duyệt:** Yes / No
- **Authority có thẩm quyền:**

## 5. Phân tích tác động

| Lĩnh vực                     | Tác động                   | Bằng chứng / Tham chiếu | Reviewer |
| ---------------------------- | -------------------------- | ----------------------- | -------- |
| Strategy / Product & Domain | None / Low / Medium / High |                         |          |
| Domain Ownership / Policy    | None / Low / Medium / High |                         |          |
| Bounded Context              | None / Low / Medium / High |                         |          |
| Context Map / Integration    | None / Low / Medium / High |                         |          |
| Tactical Design              | None / Low / Medium / High |                         |          |
| System Architecture          | None / Low / Medium / High |                         |          |
| Bảo mật / Dữ liệu            | None / Low / Medium / High |                         |          |
| Monorepo / Kỹ thuật          | None / Low / Medium / High |                         |          |
| Quality Attributes           | None / Low / Medium / High |                         |          |
| Vận hành / Migration         | None / Low / Medium / High |                         |          |

## 6. Findings

| ID    | Mức độ                               | Vị trí | Nội dung | Tác động | Hành động yêu cầu | Owner | Trạng thái |
| ----- | ------------------------------------ | ------ | -------- | -------- | ----------------- | ----- | ---------- |
| F-001 | Blocker / Major / Minor / Suggestion |        |          |          |                   |       | Open       |

### Chi tiết finding

#### F-001 — `<Short title>`

- **Mức độ:**
- **Reviewer:**
- **Vị trí:**
- **Vấn đề quan sát được:**
- **Tầm quan trọng:**
- **Kết quả xử lý kỳ vọng / Acceptance Criteria:**
- **Phản hồi của tác giả:**
- **Bằng chứng xử lý:**
- **Người xác minh:**
- **Trạng thái:** Open / Fixed / Clarified / Accepted Risk / Disputed / Deferred / Closed

## 7. Kết quả checklist

| Checklist   | Kết quả                     | Ghi chú |
| ----------- | --------------------------- | ------- |
| Common      | Pass / Partial / Fail / N/A |         |
| Specialized | Pass / Partial / Fail / N/A |         |

Các mục `N/A` phải có lý do khi mục đó có liên quan đến phạm vi review.

## 8. Thảo luận và bất đồng trong review

- **Các ý chính trong thảo luận:**
- **Bất đồng:**
- **Bằng chứng đã xem xét:**
- **Cách giải quyết:**
- **Tham chiếu escalation:**

## 9. Kết luận review

- **Outcome:** Approved / Approved with Conditions / Changes Requested / Rejected / Not Reviewed
- **Cơ sở lý luận:**
- **Blocker còn tồn tại:**
- **Rủi ro đã chấp nhận:**
- **Điều kiện:**

## 10. Phê duyệt

| Authority | Phạm vi phê duyệt | Quyết định                    | Ngày | Tham chiếu |
| --------- | ----------------- | ----------------------------- | ---- | ---------- |
|           |                   | Approved / Rejected / Pending |      |            |

- **Đã cập nhật trạng thái Decision Record:** Yes / No / N/A
- **Điều kiện phê duyệt:**

Review conclusion không tự động thay đổi trạng thái Decision Record. Việc chấp thuận quyết định phải được ghi theo `decision-process.md`.

## 11. Hành động follow-up

| ID    | Hành động | Owner | Hạn / Điều kiện kích hoạt | Bằng chứng hoàn thành | Trạng thái |
| ----- | --------- | ----- | ------------------------- | --------------------- | ---------- |
| A-001 |           |       |                           |                       | Open       |

## 12. Xuất bản và đóng review

- **Tài liệu nguồn đã cập nhật:** Yes / No
- **Decision Record đã cập nhật:** Yes / No / N/A
- **Review Record đã lưu trữ:** Yes / No
- **Phiên bản / Commit đã xuất bản:**
- **Người đóng:**
- **Ngày đóng:**

## 13. Lịch sử trạng thái

| Ngày       | Trạng thái trước | Trạng thái mới | Lý do         | Người cập nhật |
| ---------- | ---------------- | -------------- | ------------- | -------------- |
| YYYY-MM-DD | —                | In Progress    | Review opened |                |

Quy tắc:

- In Progress → Closed khi quy trình review kết thúc.
- Review Status biểu thị vòng đời của Review Record.
- Outcome biểu thị kết luận chuyên môn.
- Review có Outcome `Rejected` vẫn có thể có Review Status `Closed`.
- Không suy ra Review Status từ Outcome hoặc ngược lại.
