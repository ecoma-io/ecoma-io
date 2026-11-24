# Domain Discovery Review Checklist

## 1. Phạm vi

Áp dụng cho Strategic Domain Model, Business Capability Map, Business Subject, Business Process, Business Lifecycle, Business Policy và Domain Glossary.

## 2. Business Reality

- [ ] Mô hình xuất phát từ tình huống nghiệp vụ và nhu cầu thực tế.
- [ ] Actor, stakeholder và subject được xác định.
- [ ] Trách nhiệm, quyền hạn và nghĩa vụ được phân biệt.
- [ ] Các khái niệm tương tự nhưng khác nghĩa được tách rõ.
- [ ] Fact, Assumption, Proposal và Open Question được phân biệt.
- [ ] Có scenario bình thường, ngoại lệ và thất bại phù hợp.

## 3. Ownership

- [ ] Mỗi responsibility quan trọng có owner.
- [ ] Consumer, Provider, Account, Organization, Domain và Ecoma Platform không bị nhập nhằng nếu có liên quan.
- [ ] Resource ownership, commercial responsibility và operational responsibility được phân biệt.
- [ ] Shared responsibility có cơ chế phối hợp và authority rõ.
- [ ] Các ranh giới ownership chưa chốt được ghi thành Open Question.

## 4. Capability và Lifecycle

- [ ] Capability được mô tả theo kết quả nghiệp vụ, không chỉ theo chức năng phần mềm.
- [ ] Capability có phạm vi và owner.
- [ ] Capability không bị đồng nhất với Bounded Context hoặc Microservice.
- [ ] Lifecycle có trigger, precondition, state transition và terminal condition.
- [ ] Side effect, failure và compensation được xem xét khi cần.
- [ ] Quy tắc concurrency và idempotency được nhận diện khi nghiệp vụ yêu cầu.

## 5. Policy và Invariants

- [ ] Policy được diễn đạt rõ, không dùng từ mơ hồ.
- [ ] Phạm vi áp dụng và actor chịu trách nhiệm được xác định.
- [ ] Invariant có thể kiểm chứng hoặc có cách đánh giá rõ.
- [ ] Các policy xung đột được nhận diện.
- [ ] Không suy ra policy từ implementation hiện tại nếu chưa xác minh business intent.

## 6. Completeness và Traceability

- [ ] Domain Glossary thống nhất với các tài liệu liên quan.
- [ ] Các quyết định có liên kết đến Business Subject/Capability/Process.
- [ ] Các câu hỏi còn mở có owner hoặc bước xử lý tiếp.
- [ ] Tác động xuyên Product được đánh giá.
- [ ] Domain Decision được ghi nhận theo decision governance.

## 7. Approval

- [ ] Domain Owner xác nhận business correctness.
- [ ] Product Owner được tham vấn khi Product bị ảnh hưởng.
- [ ] Ecoma Platform authority tham gia nếu thay đổi responsibility hoặc policy xuyên domain.
- [ ] Các tài liệu nguồn được cập nhật.
