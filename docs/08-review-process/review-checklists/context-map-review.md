# Context Map Review Checklist

## 1. Phạm vi

Áp dụng cho việc tạo hoặc thay đổi Context Map và quan hệ giữa các Bounded Context.

## 2. Context Participants

- [ ] Mỗi Context tham gia đã có định nghĩa và owner.
- [ ] Vai trò của từng Context trong quan hệ được mô tả.
- [ ] Upstream và Downstream được xác định đúng theo chiều phụ thuộc.
- [ ] Context Map không sao chép lại định nghĩa đầy đủ của Context.
- [ ] Phạm vi và mục đích của bản đồ được nêu rõ.

## 3. Relationship

- [ ] Mỗi quan hệ có ý nghĩa và lý do tồn tại.
- [ ] Ownership của contract được xác định.
- [ ] Integration pattern được mô tả phù hợp.
- [ ] Quan hệ không chỉ là đường nối không có semantics.
- [ ] Các dependency vòng hoặc coupling mạnh được nhận diện.
- [ ] Shared Kernel, Customer-Supplier, Conformist, Anti-Corruption Layer hoặc Open Host Service chỉ được dùng khi đúng ngữ nghĩa; không chọn tên pattern thay cho mô tả thực tế.

## 4. Contract và Consistency

- [ ] API, event, message hoặc data contract được xác định.
- [ ] Producer và consumer có trách nhiệm rõ.
- [ ] Versioning và compatibility được xem xét.
- [ ] Consistency expectation được mô tả: immediate, transactional trong một boundary hay eventual.
- [ ] Retry, duplicate, ordering và idempotency được xem xét khi cần.
- [ ] Failure behavior và recovery path được mô tả.
- [ ] Không truy cập trực tiếp dữ liệu nội bộ của Context khác như một integration contract mặc định.

## 5. Evolution và Operations

- [ ] Có cách phát hiện contract drift.
- [ ] Thay đổi có migration hoặc deprecation plan khi cần.
- [ ] Có đánh giá tác động khi một Context unavailable.
- [ ] Có quan sát được trạng thái integration.
- [ ] Tác động xuyên domain và security boundary được đánh giá.

## 6. Approval

- [ ] Owner của các Context liên quan đã review.
- [ ] Architecture Owner xác nhận integration architecture.
- [ ] Domain Owner xác nhận semantics nghiệp vụ.
- [ ] Decision Record và contract catalog được cập nhật.
