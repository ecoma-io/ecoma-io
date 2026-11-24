# Monorepo Architecture Review Checklist

## 1. Phạm vi

Áp dụng cho cấu trúc repository, Nx Project Taxonomy, library boundaries, dependency rules, build/test architecture, CI và deployment mapping.

## 2. Project Taxonomy

- [ ] Các loại project có semantics rõ: application, library, tooling, test hoặc loại khác.
- [ ] Project name và tag convention nhất quán.
- [ ] Project boundary phản ánh trách nhiệm source code.
- [ ] Không mặc định Nx Project tương ứng Bounded Context hoặc Deployment Unit.
- [ ] Project có owner hoặc khu vực chịu trách nhiệm khi cần.
- [ ] Không tạo project chỉ để chia nhỏ file hoặc tăng số lượng target.

## 3. Dependency Rules

- [ ] Hướng dependency được mô tả.
- [ ] Domain/application/infrastructure boundary được bảo vệ khi áp dụng.
- [ ] Dependency giữa Domain hoặc Context có chủ đích.
- [ ] Không có circular dependency không được chấp nhận.
- [ ] Deep import và truy cập internal implementation được kiểm soát.
- [ ] External dependency có owner và lý do.
- [ ] Exceptions có phạm vi và cách theo dõi.

## 4. Enforcement

- [ ] Các boundary quan trọng được enforce bằng Nx tags hoặc cơ chế tương đương.
- [ ] CI chạy boundary checks.
- [ ] Không dựa vào convention thủ công cho invariant quan trọng nếu có thể tự động hóa.
- [ ] Enforcement có thông báo lỗi đủ rõ.
- [ ] Không có auto-inference hoặc plugin behavior gây target ambiguity mà không được kiểm soát.
- [ ] Quy tắc enforcement được kiểm tra khi thay đổi project taxonomy.

## 5. Build và Test

- [ ] Build/test targets quan trọng được khai báo rõ.
- [ ] Project graph và task dependency phản ánh quan hệ thực tế.
- [ ] Cache strategy không làm sai kết quả.
- [ ] Test suites được phân loại và có mục tiêu rõ.
- [ ] CI/local execution có semantics nhất quán.
- [ ] Parallelism và resource constraints được xem xét.
- [ ] Test isolation và test data lifecycle rõ.

## 6. Deployment Mapping

- [ ] Runnable applications được xác định.
- [ ] Deployment unit được phân biệt với Nx Project.
- [ ] Build artifact và runtime ownership rõ.
- [ ] Deploy, readiness, verification và cleanup được xác định khi phù hợp.
- [ ] Configuration và secrets không bị hard-code.
- [ ] Release coupling giữa các project được đánh giá.
- [ ] Migration và rollback được xem xét.

## 7. Maintainability

- [ ] Cấu trúc thư mục dễ định vị ownership.
- [ ] Naming convention nhất quán.
- [ ] Shared library có consumer và contract rõ.
- [ ] Không tạo shared library làm nơi chứa business logic không có owner.
- [ ] Code generation và tooling có thể lặp lại.
- [ ] Tài liệu hướng dẫn phản ánh cấu hình thực tế.

## 8. Approval

- [ ] Engineering Owner xác nhận project taxonomy và workflow.
- [ ] Architecture Owner được tham vấn khi boundary ảnh hưởng Domain/System Architecture.
- [ ] CI enforcement được cập nhật cùng thay đổi.
- [ ] Monorepo documentation và code/config được đồng bộ.
