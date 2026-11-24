# Testability

## Mục đích

Tài liệu này ghi nhận thuộc tính chất lượng thuộc nhóm Testability của Ecoma ở mức định hướng discovery: thiết kế phải cho phép kiểm chứng tự động các business invariant và enforcement rules. Tài liệu không chọn test framework hay thiết kế hạ tầng test.

## Nguồn

- [Architecture Principles](../00-governance/architecture-principles.md) — đặc biệt AP-008 (Domain Model bảo vệ Business Invariants), AP-016 (Module Boundaries phải được kiểm soát), AP-018 (Automation phải phản ánh Architecture Contract).

## Ghi chú về mục tiêu định lượng

Tài liệu này không đặt bất kỳ mục tiêu định lượng nào (coverage targets hay số liệu tương tự). Các mục tiêu định lượng sẽ được xác lập qua quy trình quality requirements sau, không thuộc tài liệu này.

## 1. Testability

**Ý nghĩa:** Thiết kế cho phép kiểm chứng tự động các business invariant và enforcement rules — một invariant không thể kiểm chứng tự động không thể được bảo vệ lâu dài.

**Căn cứ và ý nghĩa:**

- SD-009 (Verifiable Architecture): kiến trúc phải có khả năng kiểm chứng thông qua các quy tắc và bằng chứng phù hợp. Testability là khía cạnh kiểm chứng bằng automated test.
- AP-008 yêu cầu có test ở cấp phù hợp chứng minh invariant được giữ trong các tình huống thành công, cạnh tranh và thất bại. AP-016 yêu cầu ranh giới module quan trọng kiểm tra được bằng công cụ. AP-018 định hướng chuyển quy tắc có thể kiểm chứng tự động thành lint, test, static analysis hoặc CI enforcement — đồng thời cảnh báo không tuyên bố một thuộc tính được bảo đảm chỉ vì có một CI check liên quan.

## 2. Reliable and deterministic tests

**Ý nghĩa:** Test phải tin cậy và tất định: cùng input và trạng thái cho cùng kết quả. Test không tất định không thể làm bằng chứng cho invariant.

**Căn cứ và ý nghĩa:**

- Thuộc tính này phù hợp trực tiếp với deterministic enforcement ở [security.md](security.md): nếu enforcement tất định thì test cũng có thể tất định; một test cho kết quả khác nhau giữa các lần chạy là dấu hiệu enforcement không tất định hoặc test phụ thuộc vào trạng thái không kiểm soát được.
- AP-017 yêu cầu build, test và deployment có semantics rõ để pipeline có thể lặp lại — cùng nguyên tắc tính lặp lại ở cấp test suite.

## 3. Verification of concurrent versioning

**Ý nghĩa:** Các invariant phải kiểm chứng được trong điều kiện có thao tác đồng thời — tức là kiểm chứng được cả khi nhiều thao tác cạnh tranh trên cùng đối tượng.

**Căn cứ và ý nghĩa:** Một số quyết định đã yêu cầu tường minh tính nguyên tử hoặc uniqueness, tạo ra các tình huống concurrency cần kiểm chứng:

- INV-011 (Atomic Invitation Eligibility): việc kiểm tra điều kiện và tạo Invitation phải bảo đảm tính nguyên tử để ngăn các Invitation trùng lặp do thao tác đồng thời.
- MEM-009 (One Membership per Account): một Account chỉ có tối đa một Membership trong cùng một Consumer Organization — hai thao tác tham gia đồng thời không được tạo hai Membership.
- MEM-001 (Exactly One Owner): mỗi Consumer Organization đang hoạt động có đúng một Owner — hai thao tác chuyển quyền sở hữu (transfer, MEM-003) đồng thời không được tạo hai Owner.
- ID-006 (Unique Account Email): một địa chỉ email chỉ được liên kết với tối đa một Account tại cùng một thời điểm — hai thao tác đăng ký gắn cùng email đồng thời không được tạo hai Account.

**Hướng xác minh ở mức nguyên tắc:** theo AP-008, các tình huống cạnh tranh là một trong ba nhóm tình huống bắt buộc phải có test (cùng với thành công và thất bại).

## 4. Verification of business invariants và enforcement rules

**Ý nghĩa:** Các invariant đã có từ quyết định cần kiểm chứng được tự động, cả nhánh hợp lệ và nhánh bị từ chối. Ví dụ (không đóng danh sách):

- MEM-004: Owner không thể tự rời hoặc bị loại khỏi Consumer Organization khi chưa chuyển quyền sở hữu cho người khác.
- MEM-007 (Management Scope Enforcement): Member có quyền quản lý không thể cấp, thay đổi hoặc thu hồi quyền vượt quá phạm vi quản lý của mình.
- INV-010 (Invitation Uniqueness within Organization): một email không thể vừa là Member vừa là người nhận Pending Invitation của cùng Organization, và chỉ có tối đa một Pending Invitation.
- ORG-011 (Immediate Consumer Organization Termination): trạng thái Terminated có hiệu lực ngay, không phụ thuộc số lượng Member, Invitation hoặc tài nguyên đang tồn tại.
- ORG-013 và MEM-013: revocation triệt để — kết thúc Membership và termination Organization thu hồi mọi quyền phát sinh, bao gồm quyền qua session, token, credential phụ thuộc (chi tiết xem [security.md](security.md), mục Access revocation).

**Hướng xác minh ở mức nguyên tắc:** mỗi invariant được gắn với test chứng minh cả tình huống được chấp nhận và tình huống bị từ chối; enforcement rules xuyên domain (như revocation) cần test ở cấp phù hợp để chứng minh tính triệt để. Cụ thể hóa qua quy trình quality requirements sau.
