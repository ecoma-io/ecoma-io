# Bounded Context Review Checklist

## 1. Phạm vi

Áp dụng khi tạo, thay đổi, hợp nhất, tách hoặc ngừng một Bounded Context.

## 2. Context Definition

- [ ] Mục đích và responsibility của Context được mô tả rõ.
- [ ] Phạm vi thuộc trách nhiệm được xác định.
- [ ] Phần không thuộc trách nhiệm được nêu rõ.
- [ ] Owner và stakeholder được xác định.
- [ ] Ubiquitous Language có định nghĩa đủ rõ.
- [ ] Các thuật ngữ trùng tên nhưng khác nghĩa được phân biệt.

## 3. Domain Boundary

- [ ] Context boundary được dẫn xuất từ business responsibility và model consistency.
- [ ] Có lý do rõ cho việc tạo hoặc thay đổi Context.
- [ ] Không chỉ tách Context vì cấu trúc team, thư mục hoặc database.
- [ ] Không gộp Context chỉ để giảm số service hoặc project.
- [ ] Các invariant và consistency boundary được nhận diện.
- [ ] Dependency với Context khác được xác định.

## 4. Model Ownership

- [ ] Context sở hữu mô hình và lifecycle thuộc phạm vi của nó.
- [ ] Không có shared Entity hoặc shared schema ngầm giữa Context.
- [ ] Các read model/projection được phân biệt với source of truth.
- [ ] Data ownership và quyền ghi được xác định.
- [ ] Domain Event và external interface có owner.

## 5. Evolution

- [ ] Tác động đến Context Map được đánh giá.
- [ ] Tác động đến integration consumer được đánh giá.
- [ ] Nếu tách/gộp, có migration và compatibility plan.
- [ ] Deployment mapping không bị mặc định là 1:1.
- [ ] Các tài liệu và Decision Records liên quan được cập nhật.

## 6. Approval

- [ ] Domain Owner xác nhận responsibility và semantics.
- [ ] Architecture Owner xác nhận tính nhất quán thiết kế.
- [ ] Các Context owner bị ảnh hưởng đã được tham vấn.
- [ ] Decision Record ghi rõ lý do và hệ quả của thay đổi.
