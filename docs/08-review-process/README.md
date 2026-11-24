# Ecoma Review Process

## 1. Mục đích

Thư mục này định nghĩa quy trình review áp dụng cho các tài liệu, mô hình, quyết định và thay đổi kiến trúc của Ecoma.

Review nhằm phát hiện vấn đề, kiểm tra tính đúng đắn, phản biện giả định, đánh giá hệ quả và cung cấp bằng chứng trước khi một thay đổi được chấp thuận.

Review không đồng nghĩa với Approval. Reviewer đưa ra đánh giá chuyên môn; Approver là người có thẩm quyền chấp thuận quyết định thuộc phạm vi được giao.

Quy trình này áp dụng lâu dài từ Strategic Discovery đến Domain Design, Tactical Design, System Architecture, Monorepo Architecture và các thay đổi kiến trúc trong quá trình vận hành.

## 2. Cấu trúc

```text
08-review-process/
├── README.md
├── review-policy.md
├── review-workflow.md
├── review-authority.md
├── review-record-template.md
├── review-checklists/
│   ├── common.md
│   ├── strategic-review.md
│   ├── domain-discovery-review.md
│   ├── bounded-context-review.md
│   ├── context-map-review.md
│   ├── tactical-design-review.md
│   ├── system-architecture-review.md
│   ├── monorepo-architecture-review.md
│   └── quality-attributes-review.md
└── review-records/
    └── README.md
```

## 3. Phạm vi tài liệu

| Tài liệu                      | Trách nhiệm                                                |
| ----------------------------- | ---------------------------------------------------------- |
| `review-policy.md`            | Quy định đối tượng, nguyên tắc, mức độ và yêu cầu review   |
| `review-workflow.md`          | Quy trình từ chuẩn bị đến kết thúc review                  |
| `review-authority.md`         | Vai trò, quyền review, quyền approve và ma trận thẩm quyền |
| `review-record-template.md`   | Mẫu ghi nhận kết quả review                                |
| `review-checklists/common.md` | Tiêu chí áp dụng cho mọi loại review                       |
| Các checklist chuyên biệt     | Tiêu chí theo từng lớp kiến trúc                           |
| `review-records/README.md`    | Quy tắc lưu trữ và tra cứu Review Record                   |

## 4. Quan hệ với Governance

Nhóm này vận hành cùng `00-governance`:

- `discovery-charter.md` xác định mục tiêu, phạm vi và điều kiện hoàn thành hoạt động Discovery/Design.
- `architecture-principles.md` cung cấp nguyên tắc để reviewer đối chiếu.
- `decision-process.md` quy định vòng đời và hiệu lực của Decision.
- `review-policy.md` và `review-workflow.md` quy định cách kiểm tra và đưa ra kết luận review.
- `review-authority.md` xác định ai có quyền review và approve.

Nếu có mâu thuẫn giữa một review result và Decision Record đã `Accepted`, reviewer phải chỉ ra mâu thuẫn và yêu cầu xử lý theo Decision Process. Review Record không tự thay thế hoặc sửa đổi Decision Record.

## 5. Cách sử dụng

1. Xác định thay đổi và phân loại mức độ review theo `review-policy.md`.
2. Chọn checklist phù hợp với nội dung thay đổi.
3. Thực hiện quy trình tại `review-workflow.md`.
4. Xác định reviewer và approver theo `review-authority.md`.
5. Ghi findings và kết luận vào Review Record.
6. Chỉ công bố hoặc triển khai thay đổi khi đã đáp ứng điều kiện tương ứng.

Một thay đổi có thể cần nhiều checklist nếu tác động đến nhiều lớp. Không cần tạo nhiều Review Record nếu một record có thể mô tả đầy đủ phạm vi và kết luận; tuy nhiên phải phân công reviewer đủ chuyên môn cho từng phần.

## 6. Review Record

Review Record là bằng chứng về nội dung đã được kiểm tra, findings, kết luận và approval.

Review Record không phải bản sao của tài liệu được review. Nó phải liên kết đến đúng phiên bản, PR, commit hoặc tài liệu tại thời điểm review.

Quy tắc lưu trữ được quy định tại `review-records/README.md`.

## 7. Nguyên tắc vận hành

- Không tự phê duyệt quyết định ngoài thẩm quyền.
- Không coi việc không có comment là approval.
- Không đóng review khi còn finding chặn chưa được xử lý hoặc chấp nhận rủi ro đúng thẩm quyền.
- Không biến checklist thành thủ tục hình thức; chỉ đánh dấu đạt khi có cơ sở.
- Không yêu cầu review đầy đủ cho thay đổi không có ảnh hưởng kiến trúc đáng kể.
- Không bỏ qua review bắt buộc chỉ vì thay đổi đã được triển khai.
- Findings phải mô tả vấn đề, hệ quả và điều kiện xử lý đủ rõ để tác giả hành động.

## 8. Điều kiện hoàn thành Review Process

Bộ quy trình đủ để vận hành khi:

- Có thể phân loại một thay đổi mà không cần tự đặt mức review.
- Có thể xác định reviewer và approver theo phạm vi quyết định.
- Có checklist phù hợp với lớp kiến trúc.
- Có quy tắc xử lý findings và bất đồng.
- Có tiêu chí kết thúc rõ ràng.
- Có Review Record truy vết được về phiên bản được review.
- Có thể phân biệt kết quả review với quyết định được approve.
