# Review Authority

## 1. Mục đích

Tài liệu này xác định vai trò, trách nhiệm và thẩm quyền trong hoạt động review và approval kiến trúc Ecoma.

Thẩm quyền được xác định theo loại quyết định và phạm vi ownership, không chỉ theo chức danh hoặc thâm niên.

Tài liệu này sử dụng role-based authority. Danh sách cá nhân đảm nhiệm từng vai trò phải được quản lý riêng và cập nhật khi tổ chức thay đổi.

## 2. Phân biệt vai trò

### 2.1. Author

Người đề xuất hoặc chịu trách nhiệm chuẩn bị thay đổi.

Trách nhiệm:

- Mô tả vấn đề, phạm vi và rationale.
- Cung cấp facts, assumptions và evidence.
- Chuẩn bị impact analysis.
- Chọn checklist và tự review.
- Phản hồi findings.
- Cập nhật tài liệu và Decision Record.

Author không mặc nhiên có quyền approve.

### 2.2. Reviewer

Người đánh giá nội dung trong phạm vi chuyên môn được giao.

Trách nhiệm:

- Kiểm tra tính đúng đắn và nhất quán.
- Phản biện assumptions và alternatives.
- Phát hiện rủi ro và mâu thuẫn.
- Ghi findings có căn cứ.
- Xác nhận việc xử lý findings.
- Đưa ra review conclusion.

Reviewer không mặc nhiên có quyền chấp thuận business hoặc architecture decision.

### 2.3. Domain Owner

Người chịu trách nhiệm về business semantics, policy, lifecycle và ownership trong domain được giao.

Trách nhiệm:

- Xác nhận tính đúng đắn của business model.
- Chấp thuận thay đổi thuộc phạm vi domain authority.
- Làm rõ các business trade-off và trách nhiệm.
- Phối hợp khi thay đổi ảnh hưởng domain khác.

Domain Owner không mặc nhiên có quyền quyết định thay đổi System hoặc Engineering Architecture ngoài phạm vi được giao.

### 2.4. Product Owner

Người chịu trách nhiệm về định hướng và kết quả của sản phẩm trong phạm vi được giao.

Trách nhiệm:

- Xác nhận tác động đến sản phẩm.
- Chấp thuận thay đổi thuộc authority cấp sản phẩm.
- Làm rõ trade-off về lifecycle, capability và delivery của sản phẩm.
- Phối hợp với authority cấp Ecoma Platform khi có tác động xuyên domain.

### 2.5. Architecture Owner

Người chịu trách nhiệm về tính nhất quán kiến trúc trong phạm vi được giao.

Trách nhiệm:

- Review các lựa chọn kiến trúc và ranh giới kỹ thuật.
- Kiểm tra alignment với Architecture Principles.
- Đánh giá integration, deployment, security và quality implications.
- Chấp thuận các quyết định kiến trúc thuộc authority được giao.
- Yêu cầu đánh giá tác động xuyên lớp.

Vai trò này không tự động có quyền thay đổi business ownership hoặc strategic direction.

### 2.6. Engineering Owner

Người chịu trách nhiệm về engineering practices, repository structure, build/test/deployment conventions và implementation constraints trong phạm vi được giao.

Trách nhiệm:

- Review Monorepo và Engineering Architecture.
- Xác nhận tính khả thi của implementation.
- Chấp thuận engineering decision thuộc phạm vi authority.
- Bảo đảm các quy tắc quan trọng có thể được kiểm chứng.

### 2.7. Ecoma Platform Strategic Authority

Vai trò hoặc cơ chế có thẩm quyền quyết định định hướng và các vấn đề xuyên domain ở cấp Ecoma Platform.

Trách nhiệm:

- Chấp thuận Strategic Decision.
- Giải quyết trade-off giữa các domain khi cần.
- Chấp thuận thay đổi các nguyên tắc nền tảng hoặc mô hình trách nhiệm cấp Ecoma Platform.
- Xác định phạm vi ủy quyền cho các owner khác.

Tên tổ chức hoặc cá nhân đảm nhiệm vai trò này cần được Ecoma chỉ định; tài liệu này không giả định sẵn một chức danh pháp lý.

### 2.8. Review Coordinator

Người điều phối quy trình review, không nhất thiết là người quyết định nội dung.

Trách nhiệm:

- Xác định mức review.
- Tìm reviewer phù hợp.
- Theo dõi findings và thời hạn.
- Bảo đảm Review Record đầy đủ.
- Đưa vấn đề chưa thống nhất đến authority phù hợp.

Review Coordinator không có quyền approve chỉ vì đang điều phối review.

## 3. Ma trận trách nhiệm

Ký hiệu:

- **A:** Có trách nhiệm approve cuối cùng trong phạm vi được giao.
- **R:** Thực hiện review chuyên môn.
- **C:** Cần được tham vấn.
- **I:** Cần được thông báo.
- **—:** Không bắt buộc tham gia theo vai trò mặc định.

| Loại quyết định                              |            Strategic Authority |         Product Owner |                      Domain Owner |                 Architecture Owner | Engineering Owner |
| -------------------------------------------- | -----------------------------: | --------------------: | --------------------------------: | ---------------------------------: | ----------------: |
| Ecoma Strategy / cấu trúc domain               |                              A |                     C |                                 C |                                  C |                 I |
| Product Strategy trong phạm vi được ủy quyền |                            C/I |                     A |                                 C |                                  C |                 I |
| Business ownership / policy trong một domain |      C nếu ảnh hưởng Ecoma Platform |                     C |                                 A |                                  C |                 I |
| Business policy xuyên domain                | A hoặc authority được ủy quyền |                     C |                               R/C |                                  C |                 I |
| Bounded Context trong một domain             |                            I/C |                     C |                    A về semantics |           A/R về architecture fit* |                 I |
| Context Map xuyên nhiều domain               |     C nếu ảnh hưởng chiến lược |                     C | A/R cho Context thuộc domain mình | A/R cho architecture relationship* |                 I |
| Tactical Design                              |                              I |                   I/C |           A về domain correctness |         A/R về design constraints* |               R/C |
| System / Deployment Architecture             |                            I/C |                     C |                                 C |                                  A |               R/C |
| Monorepo / Engineering Architecture          |                              I |                   I/C |          C khi ảnh hưởng boundary |                  C/A nếu được giao |                 A |
| Quality Attribute target                     | A nếu là cam kết cấp Ecoma Platform | A trong domain scope |                                 C |         A/R về architecture design | R về verification |
| Governance / Review Policy                   |                              A |                     C |                                 C |                                  R |                 R |

`*` Với quyết định liên quan nhiều domain hoặc nhiều Context, approval phải bao gồm owner của các phạm vi bị ảnh hưởng. Architecture Owner không thể đơn phương thay đổi business semantics của Domain Owner.

Ma trận này là mô hình authority mặc định cần được Ecoma xác nhận. Nó không tự chỉ định người cụ thể và không thay thế việc xác định delegation.

Quy tắc diễn giải authority:

- Approval (ký hiệu `A`) chỉ có hiệu lực trong phạm vi trách nhiệm được giao cho authority tương ứng.
- Một quyết định có thể cần nhiều approval độc lập nếu tác động đến nhiều phạm vi trách nhiệm.
- Domain Owner xác nhận business semantics và ownership.
- Architecture Owner xác nhận architecture fit và architectural constraints.
- Approval của một authority không thay thế approval của authority khác.
- Quyết định chỉ hoàn tất khi tất cả approval bắt buộc đã được ghi nhận.
- Nếu các authority không thống nhất, sử dụng quy trình xử lý bất đồng tại mục 7.

## 4. Quy tắc phối hợp authority

### 4.1. Quyết định trong một phạm vi

Authority sở hữu phạm vi chịu trách nhiệm approve quyết định thuộc phạm vi đó sau khi các reviewer liên quan hoàn tất đánh giá.

### 4.2. Quyết định xuyên phạm vi

Khi quyết định ảnh hưởng nhiều domain, Ecoma Platform hoặc Context:

- Mỗi owner xác nhận phần ownership của mình.
- Architecture Owner đánh giá tính nhất quán tổng thể.
- Authority cấp cao hơn chỉ quyết định phần trade-off hoặc trách nhiệm được giao ở cấp cao hơn.
- Không dùng approval của một owner để mặc nhiên thay thế approval của owner khác.
- Approval của mỗi owner chỉ xác nhận phần trách nhiệm thuộc phạm vi owner đó; không thay thế approval của các authority khác có trách nhiệm độc lập.

### 4.3. Quyết định có tác động pháp lý, tài chính hoặc bảo mật

Phải tham vấn người hoặc chức năng có chuyên môn và authority phù hợp với rủi ro. Không mặc định Architecture Owner hoặc Product Owner có đủ thẩm quyền pháp lý, tài chính hoặc compliance.

### 4.4. Thay đổi Architecture Principles

- Guideline có thể được điều chỉnh theo authority của nhóm nguyên tắc liên quan.
- Invariant chỉ được thay đổi bằng Decision Record riêng.
- Thay đổi Invariant cần Ecoma Platform Strategic Authority hoặc authority được ủy quyền rõ ràng, cùng review chuyên môn liên quan.
- Không được phê duyệt ngoại lệ để né việc thay đổi nguyên tắc.

## 5. Độc lập và xung đột lợi ích

- Reviewer nên độc lập với Author đối với R2/R3.
- Author không được tự approve thay đổi của chính mình, trừ quy trình khẩn cấp có quy định riêng và phải có retrospective review.
- Người có lợi ích trực tiếp trong lựa chọn phải công bố xung đột lợi ích.
- Khi không có reviewer độc lập nội bộ, có thể sử dụng reviewer bên ngoài hoặc authority cấp cao hơn.
- Không được hạ mức review chỉ vì thiếu người review.

## 6. Delegation

Authority có thể được ủy quyền nếu:

- Phạm vi ủy quyền được mô tả rõ.
- Người nhận ủy quyền có năng lực phù hợp.
- Có giới hạn về loại quyết định và thời hạn nếu cần.
- Có thể truy vết người ủy quyền và người thực hiện approval.
- Không ủy quyền vượt quá authority của người ủy quyền.

Delegation không tự động mở rộng sang các loại quyết định khác.

## 7. Xử lý bất đồng

Khi reviewer hoặc owner không thống nhất:

1. Ghi rõ vấn đề và bằng chứng của từng bên.
2. Xác định đây là bất đồng về fact, business policy, technical trade-off hay authority.
3. Yêu cầu bổ sung evidence hoặc phương án nếu cần.
4. Chuyển đến authority có trách nhiệm đối với đúng loại vấn đề.
5. Ghi rationale và phạm vi kết luận.
6. Nếu chưa có authority được chỉ định, không tuyên bố quyết định đã Accepted; đưa vấn đề vào danh sách Governance cần giải quyết.

Không giải quyết bất đồng bằng cách mặc định ý kiến của người có chức danh kỹ thuật cao hơn luôn thắng.

## 8. RACI cho các bước review

| Hoạt động             | Author | Reviewer   | Review Coordinator | Approver |
| --------------------- | ------ | ---------- | ------------------ | -------- |
| Xác định phạm vi      | R      | C          | C                  | I        |
| Phân loại mức review  | R      | C          | A/R điều phối      | I        |
| Chuẩn bị tài liệu     | A/R    | I          | C                  | I        |
| Thực hiện review      | C      | A/R        | C                  | I        |
| Xử lý findings        | A/R    | C/xác nhận | C/theo dõi         | I        |
| Kết luận review       | C      | A/R        | R/tổng hợp         | I        |
| Approve quyết định    | I      | C          | I                  | A/R      |
| Publish và lưu record | A/R    | C          | R/theo dõi         | I        |

Ma trận RACI này mô tả trách nhiệm quy trình; quyền approve nội dung vẫn phải tuân theo bảng authority theo loại quyết định.

## 9. Các thông tin Ecoma cần chỉ định

Trước khi áp dụng chính thức, Ecoma cần điền và duy trì:

| Vai trò                       | Người/nhóm đảm nhiệm | Phạm vi                              | Người thay thế |
| ----------------------------- | -------------------- | ------------------------------------ | -------------- |
| Ecoma Platform Strategic Authority | Chưa chỉ định        | Ecoma Platform-wide                       | Chưa chỉ định  |
| Architecture Owner            | Chưa chỉ định        | Toàn Ecoma hoặc phạm vi được giao    | Chưa chỉ định  |
| Engineering Owner             | Chưa chỉ định        | Monorepo / Engineering               | Chưa chỉ định  |
| Product Owner                 | Chưa chỉ định        | Sản phẩm AI Factory Marketplace      | Chưa chỉ định  |
| Domain Owner                  | Chưa chỉ định        | Theo từng Domain                     | Chưa chỉ định  |
| Review Coordinator            | Chưa chỉ định        | Theo từng review hoặc nhóm kiến trúc | Chưa chỉ định  |

Không để trạng thái “Chưa chỉ định” bị hiểu là mọi người đều có quyền approve. Khi thiếu authority, quyết định phải chờ xác định người có thẩm quyền hoặc được chuyển lên authority cấp cao hơn đã được xác nhận.

## 10. Điều kiện hoàn thành Authority Assignment

Authority được xem là đủ để vận hành khi:

- Mỗi loại quyết định có authority cuối cùng.
- Các phạm vi giao nhau có quy tắc phối hợp.
- Vai trò reviewer và approver được phân biệt.
- Có cơ chế delegation và thay thế.
- Có cách giải quyết bất đồng.
- Danh sách người/nhóm đảm nhiệm được cập nhật.
