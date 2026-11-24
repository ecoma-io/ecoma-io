# Review Policy

## 1. Mục đích

Tài liệu này quy định chính sách review đối với các tài liệu, quyết định và thay đổi kiến trúc Ecoma.

Mục tiêu là áp dụng mức độ kiểm tra tương xứng với rủi ro, bảo đảm các thay đổi quan trọng được phản biện bởi người có chuyên môn và được chấp thuận bởi đúng thẩm quyền.

## 2. Đối tượng áp dụng

Chính sách áp dụng cho:

- Ecoma Strategy và cấu trúc sản phẩm (AI Factory Marketplace, hai domain).
- Strategic Domain và Business Capability.
- Business Subject, Business Policy, Lifecycle và Process.
- Bounded Context và Context Map.
- Domain Event và Integration Contract.
- Tactical Design và Domain Model.
- System, Security, Data, Runtime và Deployment Architecture.
- Monorepo Architecture, Nx Project Taxonomy và Dependency Rules.
- Quality Attributes và Architecture Principles.
- Decision Records và thay đổi Governance.
- Các implementation thay đổi hoặc hiện thực hóa quyết định kiến trúc.

Không phải mọi thay đổi code đều là Architecture Review. Code Review thông thường vẫn thực hiện theo quy trình Engineering của repository; Architecture Review được yêu cầu khi thay đổi có tác động đến một hoặc nhiều ranh giới, quyết định hoặc nguyên tắc kiến trúc.

## 3. Nguyên tắc review

### RP-001 — Review độc lập với Approval

Reviewer đánh giá nội dung và đưa ra kết luận chuyên môn. Approver quyết định có chấp thuận nội dung hoặc quyết định hay không theo authority được giao.

Một người có thể đảm nhiệm cả hai vai trò nếu được phép, nhưng phải thể hiện rõ hai trách nhiệm và không được tự cấp thẩm quyền cho chính mình.

### RP-002 — Review dựa trên phạm vi và rủi ro

Mức độ review được xác định bởi tác động, khả năng gây hậu quả và mức độ khó đảo ngược, không chỉ bởi số lượng file hoặc dòng code thay đổi.

### RP-003 — Review có bằng chứng

Mỗi finding và kết luận quan trọng phải có căn cứ: nội dung tài liệu, scenario, test, dữ liệu, constraint, contract hoặc quyết định liên quan.

### RP-004 — Review xuyên lớp khi có tác động

Thay đổi ở một lớp phải được đánh giá tác động đến các lớp liên quan. Không yêu cầu review toàn bộ kiến trúc nếu thay đổi không ảnh hưởng đến chúng.

### RP-005 — Không dùng im lặng làm chấp thuận

Không phản hồi, hết thời gian review hoặc merge implementation không đồng nghĩa với approval.

### RP-006 — Giữ lịch sử và trách nhiệm

Review Record phải thể hiện reviewer, approver, findings, kết luận và phiên bản được review. Không viết lại lịch sử để che khuất bất đồng hoặc finding.

### RP-007 — Tương xứng, không hình thức

Checklist là công cụ hỗ trợ tư duy và kiểm tra. Reviewer phải đánh giá nội dung thực tế, không chỉ đánh dấu checkbox.

## 4. Phân loại mức độ review

Mỗi thay đổi phải được phân loại theo mức cao nhất trong các tiêu chí mà nó chạm tới.

| Mức | Tên         | Tiêu chí điển hình                                                                                                                         | Yêu cầu                                                           |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| R0  | Editorial   | Sửa chính tả, định dạng, liên kết hoặc diễn đạt mà không đổi ý nghĩa                                                                       | Author self-check                                                 |
| R1  | Standard    | Bổ sung hoặc sửa nội dung trong ranh giới đã được quyết định, không đổi ownership hay contract quan trọng                                  | Peer review                                                       |
| R2  | Significant | Thay đổi domain policy, lifecycle, Context responsibility, integration behavior, tactical boundary hoặc module boundary                    | Chuyên môn phù hợp và cross-layer impact review                   |
| R3  | Critical    | Thay đổi chiến lược, commercial/legal responsibility, security boundary, data ownership cốt lõi, domain boundary hoặc nguyên tắc nền tảng | Cross-functional review và approval của authority cấp cao phù hợp |

### 4.1. Quy tắc phân loại

- Nếu không chắc giữa hai mức, chọn mức cao hơn cho đến khi xác định được phạm vi.
- Thay đổi có thể tác động nhiều domain hoặc cấp Ecoma Platform thường cần ít nhất R2.
- Thay đổi một Invariant trong `architecture-principles.md` phải được xử lý ở mức R3.
- Thay đổi quyền quyết định, review authority hoặc decision process phải được xem xét ở mức R3.
- Thay đổi có rủi ro pháp lý, tài chính, bảo mật hoặc mất dữ liệu phải được nâng mức tương ứng.
- Mức review có thể được điều chỉnh khi có thêm thông tin, nhưng lý do điều chỉnh phải được ghi nhận.

## 5. Yêu cầu reviewer

Reviewer phải:

- Có hiểu biết phù hợp với phạm vi được giao.
- Không có xung đột lợi ích không được công bố.
- Đọc tài liệu và bối cảnh liên quan trước khi kết luận.
- Đối chiếu các quyết định đang có hiệu lực.
- Phân biệt lỗi thực tế, rủi ro, sở thích cá nhân và phương án thay thế.
- Nêu rõ mức độ nghiêm trọng và căn cứ của finding.
- Không tự mở rộng phạm vi review ngoài mục tiêu mà không giải thích lý do.

Đối với R2/R3, nên có hơn một góc nhìn chuyên môn khi phạm vi thay đổi chạm nhiều domain hoặc discipline. Số lượng reviewer cụ thể được xác định theo authority matrix và mức độ rủi ro, không mặc định một con số áp dụng cho mọi trường hợp.

## 6. Phân loại Findings

| Severity   | Ý nghĩa                                                                                | Ảnh hưởng đến kết luận                                                   |
| ---------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Blocker    | Sai sót hoặc rủi ro nghiêm trọng khiến không thể chấp thuận thay đổi                   | Phải xử lý hoặc có quyết định ngoại lệ đúng thẩm quyền trước khi approve |
| Major      | Thiếu sót đáng kể ảnh hưởng tính đúng đắn, an toàn, nhất quán hoặc khả năng triển khai | Thông thường phải xử lý trước approval                                   |
| Minor      | Vấn đề có phạm vi hạn chế, không làm sai quyết định cốt lõi                            | Có thể chấp thuận kèm điều kiện hoặc follow-up có owner                  |
| Suggestion | Cải tiến tùy chọn, không phải lỗi hoặc điều kiện chấp thuận                            | Không chặn approval                                                      |

### 6.1. Yêu cầu mô tả finding

Mỗi finding phải có:

- ID.
- Severity.
- Vị trí hoặc phạm vi bị ảnh hưởng.
- Vấn đề quan sát được.
- Vì sao đây là vấn đề.
- Hệ quả hoặc rủi ro.
- Khuyến nghị hoặc điều kiện cần đáp ứng.

Không dùng finding chỉ để áp đặt sở thích cá nhân. Nếu có nhiều phương án hợp lệ, phải nêu tiêu chí khiến phương án hiện tại không đáp ứng.

## 7. Kết quả review

Sử dụng các kết quả sau:

| Kết quả                    | Ý nghĩa                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `Approved`                 | Không còn finding chặn; nội dung đủ điều kiện được chấp thuận         |
| `Approved with Conditions` | Có thể chấp thuận với điều kiện rõ ràng, owner và hạn xử lý phù hợp   |
| `Changes Requested`        | Cần sửa đổi hoặc bổ sung trước khi chấp thuận                         |
| `Rejected`                 | Phương án không được chấp thuận; cần phương án khác hoặc dừng đề xuất |
| `Not Reviewed`             | Chưa thực hiện review hoặc chưa đủ dữ liệu để kết luận                |

`Approved` và `Approved with Conditions` là kết luận review, không tự động là trạng thái `Accepted` của Decision Record. Việc chuyển Decision sang `Accepted` phải do Approver có authority thực hiện theo `decision-process.md`.

### 7.1. Điều kiện cho Approved with Conditions

Chỉ sử dụng khi:

- Không còn Blocker.
- Các Major còn lại đã được xử lý hoặc rủi ro đã được authority phù hợp chấp nhận rõ ràng.
- Mỗi điều kiện có owner và thời hạn hoặc trigger.
- Điều kiện không làm mất an toàn của thay đổi trong giai đoạn chờ xử lý.
- Có cơ chế theo dõi và đóng điều kiện.

Mỗi condition phải xác định thời điểm bắt buộc hoàn thành và được phân biệt theo loại: hoàn thành trước approval, trước publish, trước implementation/deployment hoặc được phép hoàn thành sau rollout. Không mặc định mọi condition đều cho phép trì hoãn đến sau deployment.

Approved with Conditions không tự động cấp quyền publish, implement hoặc deploy. Hoạt động tương ứng chỉ được thực hiện khi tất cả condition bắt buộc trước hoạt động đó đã hoàn thành hoặc một ngoại lệ rõ ràng đã được authority có thẩm quyền chấp thuận.

Review Record phải ghi nhận owner, deadline hoặc trigger và trạng thái của từng condition.

Không dùng kết quả này để hợp thức hóa một thay đổi chưa đủ thông tin hoặc có rủi ro không thể chấp nhận.

## 8. Xung đột và bất đồng

- Reviewer phải nêu bất đồng bằng finding hoặc nhận xét có căn cứ.
- Author có quyền phản hồi và cung cấp bằng chứng.
- Nếu không đạt đồng thuận, chuyển vấn đề đến authority có trách nhiệm theo `review-authority.md`.
- Không lấy đa số ý kiến để thay thế authority nếu quyết định thuộc một owner cụ thể.
- Bất đồng có ảnh hưởng đến lựa chọn kiến trúc nên được ghi lại trong Review Record và Decision Record khi cần.
- Người giải quyết bất đồng phải nêu rationale và phạm vi quyết định.

## 9. Ngoại lệ và khẩn cấp

Review có thể được rút gọn trong tình huống khẩn cấp để xử lý incident hoặc rủi ro đang diễn ra. Việc rút gọn phải:

- Giới hạn vào thay đổi tối thiểu cần thiết.
- Có người chịu trách nhiệm và authority phù hợp.
- Ghi nhận lý do không thể thực hiện quy trình đầy đủ.
- Có retrospective review sau khi tình huống được kiểm soát.
- Xác định workaround, rủi ro còn lại và thời điểm xem xét lại.

Không được dùng ngoại lệ khẩn cấp để bỏ qua review cho thay đổi lâu dài sau khi sự cố đã kết thúc.

## 10. Liên hệ với Code Review và CI

- Code Review kiểm tra chất lượng implementation, correctness, maintainability và coding conventions.
- Architecture Review kiểm tra sự phù hợp với domain ownership, architecture decisions, boundaries, contracts và quality attributes.
- Automated checks xác minh các quy tắc có thể kiểm tra bằng công cụ.
- Kết quả CI không thay thế review chuyên môn hoặc approval.
- Architecture Review không thay thế test, security scanning hoặc operational verification.

Một Pull Request có thể cần cả Code Review và Architecture Review. Chúng có thể dùng chung PR nhưng phải thể hiện rõ các kết luận khác nhau.

## 11. Lưu trữ và hiệu lực

Review Record phải được lưu theo quy tắc tại `review-records/README.md`, liên kết tới tài liệu hoặc commit được review.

Nếu tài liệu thay đổi đáng kể sau review, kết quả cũ không tự động áp dụng cho nội dung mới. Author phải xác định phần thay đổi có cần review lại hay không; thay đổi làm ảnh hưởng rationale, finding hoặc decision phải được reviewer liên quan xem xét lại.

## 12. Điều kiện tuân thủ

Một thay đổi được xem là tuân thủ Review Policy khi:

- Được phân loại đúng mức.
- Có reviewer phù hợp.
- Dùng checklist phù hợp.
- Findings được xử lý hoặc chấp nhận đúng thẩm quyền.
- Có kết luận review rõ ràng.
- Có approval khi quyết định yêu cầu approval.
- Review Record trỏ đúng phiên bản đã review.
