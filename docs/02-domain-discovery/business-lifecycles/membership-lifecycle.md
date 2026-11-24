# Membership Lifecycle

## Mục đích

Mô tả các giai đoạn nghiệp vụ của một Membership trong Consumer Organization và các chuyển tiếp giữa chúng — không đi vào thiết kế tactical, API hay cơ sở dữ liệu.

## Các quyết định áp dụng

[MEM-001](../decisions/membership-decisions.md), [MEM-002](../decisions/membership-decisions.md), [MEM-003](../decisions/membership-decisions.md), [MEM-004](../decisions/membership-decisions.md), [MEM-005](../decisions/membership-decisions.md), [MEM-006](../decisions/membership-decisions.md), [MEM-007](../decisions/membership-decisions.md), [MEM-008](../decisions/membership-decisions.md), [MEM-009](../decisions/membership-decisions.md), [MEM-010](../decisions/membership-decisions.md), [MEM-011](../decisions/membership-decisions.md), [MEM-012](../decisions/membership-decisions.md), [MEM-013](../decisions/membership-decisions.md), [MEM-014](../decisions/membership-decisions.md), [MEM-015](../decisions/membership-decisions.md), cùng [INV-002](../decisions/invitation-decisions.md), [ORG-013](../decisions/consumer-organization-decisions.md).

## Quan hệ với các lifecycle khác

- [Consumer Organization Lifecycle](consumer-organization-lifecycle.md): khi Organization bị Terminated, toàn bộ Membership kết thúc ([ORG-013](../decisions/consumer-organization-decisions.md)).
- [Invitation Lifecycle](invitation-lifecycle.md): chấp nhận Invitation là một con đường hình thành Membership ([INV-002](../decisions/invitation-decisions.md), [MEM-015](../decisions/membership-decisions.md)).
- [Account Lifecycle](account-lifecycle.md): Membership gắn một Account với một Organization; vòng đời Account độc lập với vòng đời Organization ([ID-009](../decisions/account-identity-decisions.md)).
- Process liên quan: [consumer-membership-management](../business-processes/consumer-membership-management.md), [consumer-invitation](../business-processes/consumer-invitation.md).

## Các giai đoạn

### 1. Membership acquisition

Membership hình thành khi một Account trở thành Member của một Consumer Organization.

- Membership có thể hình thành thông qua việc chấp nhận Invitation hoặc các quy trình onboarding khác do domain định nghĩa ([MEM-015](../decisions/membership-decisions.md)). Đường qua Invitation được mô tả tại [Invitation Lifecycle](invitation-lifecycle.md).
- Trong cùng một Consumer Organization, một Account chỉ có tối đa một Membership ([MEM-009](../decisions/membership-decisions.md)).

### 2. Active membership

Membership đang hoạt động gắn quyền hạn của Account trong Organization.

- Một Membership có thể chứa nhiều Role hoặc Permission ([MEM-009](../decisions/membership-decisions.md)).
- Tập Role được định nghĩa một lần cấp Ecoma Platform, dùng chung cho cả hai domain ([SD-063](../decisions/strategic-decisions.md)); Permission, chính sách phân quyền và giá trị mặc định cho Member do từng domain tự định nghĩa ([MEM-005](../decisions/membership-decisions.md)). Membership và Authorization thuộc phạm vi từng domain — không bắt buộc chia sẻ Permission giữa các domain ([MEM-010](../decisions/membership-decisions.md)).
- Owner là trường hợp đặc biệt của Membership đang hoạt động: mỗi Organization đang hoạt động có đúng một Owner giữ quyền kiểm soát tối cao ([MEM-001](../decisions/membership-decisions.md), [MEM-002](../decisions/membership-decisions.md)).

### 3. Role/permission management

Trong khi Membership hoạt động, quyền của Member có thể thay đổi:

- Owner và Member được cấp quyền quản lý thành viên có thể quyết định quyền của Member khác trong phạm vi được cấp ([MEM-006](../decisions/membership-decisions.md)).
- Member có quyền quản lý không thể cấp, thay đổi hoặc thu hồi quyền vượt quá phạm vi quản lý của mình ([MEM-007](../decisions/membership-decisions.md)).
- Việc thu hồi quyền quản lý của một Member không tự động thu hồi các quyền mà người quản lý đó đã cấp trước đó; những quyền này tiếp tục tồn tại cho đến khi một chủ thể có thẩm quyền thay đổi ([MEM-008](../decisions/membership-decisions.md)).

### 4. Ownership transfer

Owner có thể chuyển quyền sở hữu Organization cho một Member đủ điều kiện ([MEM-003](../decisions/membership-decisions.md)).

- Sau chuyển, Organization vẫn có đúng một Owner ([MEM-001](../decisions/membership-decisions.md)): Member nhận quyền trở thành Owner, Owner cũ không còn là Owner.
- Owner giữ quyền kiểm soát tối cao trong suốt thời gian còn là Owner và có thể ủy quyền mà không mất quyền kiểm soát tối cao ([MEM-002](../decisions/membership-decisions.md)).
- Điều kiện "đủ điều kiện" của Member nhận chuyển quyền cụ thể nằm trong chính sách phân quyền do domain định nghĩa ([MEM-005](../decisions/membership-decisions.md)).

### 5. Voluntary leave

Member có thể tự rời Consumer Organization mà không cần Owner phê duyệt ([MEM-011](../decisions/membership-decisions.md)).

- Ngoại lệ: Owner không thể tự rời hoặc bị loại khỏi Organization khi chưa chuyển quyền sở hữu cho người khác ([MEM-004](../decisions/membership-decisions.md)).

### 6. Removal / revocation

Member có thể bị loại khỏi Organization — trường hợp này đã được xác nhận ([MEM-012](../decisions/membership-decisions.md), [MEM-004](../decisions/membership-decisions.md)); chủ thể nào được loại Member chưa được phát biểu tường minh, giả định "chủ thể có thẩm quyền quản lý thành viên, trong phạm vi quyền hạn được cấp" bám theo [MEM-006](../decisions/membership-decisions.md) chưa được phát biểu tường minh trong MEM-006 — theo dõi tại [BL-36](../discovery-backlog.md). Owner không thể bị loại khi chưa chuyển quyền sở hữu ([MEM-004](../decisions/membership-decisions.md)).

### 7. Access revocation

Khi Membership kết thúc (do rời, bị loại, hoặc Organization bị Terminated), việc thu hồi quyền truy cập là triệt để:

- Toàn bộ quyền truy cập phát sinh trực tiếp hoặc gián tiếp từ Membership phải bị thu hồi, bao gồm quyền thông qua session, token hoặc credential phụ thuộc vào Membership ([MEM-013](../decisions/membership-decisions.md)).
- Việc kết thúc Membership không tự động xóa tài nguyên do Member tạo; mỗi domain tự quyết định cách xử lý tài nguyên và các phụ thuộc liên quan ([MEM-014](../decisions/membership-decisions.md)).

### 8. Re-membership

Member đã rời hoặc bị loại có thể được mời lại **ngay**, không có thời gian chờ ([MEM-012](../decisions/membership-decisions.md)).

- Membership mới có vòng đời độc lập với Membership cũ; trạng thái kết thúc của Membership trước không áp đặt điều kiện nào lên Membership mới ngoài các điều kiện hình thành thông thường (ví dụ uniqueness của Membership per Account, [MEM-009](../decisions/membership-decisions.md)).

## Thuật ngữ

Các thuật ngữ dùng trong tài liệu này được định nghĩa tại [Domain Glossary](../domain-glossary.md); bối cảnh chiến lược tại [Strategic Domain Model](../strategic-domain-model.md).
