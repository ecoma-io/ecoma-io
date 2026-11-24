# Invitation Lifecycle

## Mục đích

Mô tả các trạng thái nghiệp vụ của một Invitation trong Consumer Organization và các chuyển tiếp giữa chúng — không đi vào thiết kế tactical, API hay cơ sở dữ liệu.

## Các quyết định áp dụng

[INV-001](../decisions/invitation-decisions.md), [INV-002](../decisions/invitation-decisions.md), [INV-003](../decisions/invitation-decisions.md), [INV-004](../decisions/invitation-decisions.md), [INV-005](../decisions/invitation-decisions.md), [INV-006](../decisions/invitation-decisions.md), [INV-007](../decisions/invitation-decisions.md), [INV-008](../decisions/invitation-decisions.md), [INV-009](../decisions/invitation-decisions.md), [INV-010](../decisions/invitation-decisions.md), [INV-011](../decisions/invitation-decisions.md), [INV-012](../decisions/invitation-decisions.md), [INV-013](../decisions/invitation-decisions.md), [INV-014](../decisions/invitation-decisions.md), [INV-015](../decisions/invitation-decisions.md), cùng [ID-008](../decisions/account-identity-decisions.md), [MEM-015](../decisions/membership-decisions.md), [ORG-013](../decisions/consumer-organization-decisions.md).

## Quan hệ với các lifecycle khác

- [Consumer Organization Lifecycle](consumer-organization-lifecycle.md): khi Organization bị Terminated, mọi Pending Invitation bị vô hiệu ngay ([INV-014](../decisions/invitation-decisions.md), [ORG-013](../decisions/consumer-organization-decisions.md)).
- [Membership Lifecycle](membership-lifecycle.md): Accepted là con đường hình thành Membership ([MEM-015](../decisions/membership-decisions.md)).
- [Account Lifecycle](account-lifecycle.md): Invitation gắn với email đích, không tự đổi khi Account đổi email ([ID-008](../decisions/account-identity-decisions.md)).
- Process liên quan: [consumer-invitation](../business-processes/consumer-invitation.md).

## Các trạng thái

Theo [INV-006](../decisions/invitation-decisions.md), Invitation có các trạng thái:

- **Pending** — Invitation đã được tạo, đang chờ người nhận phản hồi.
- **Accepted** — trạng thái kết thúc.
- **Rejected** — trạng thái kết thúc.
- **Expired** — trạng thái kết thúc.
- **Revoked** — trạng thái kết thúc.

## Các chuyển tiếp

### Tạo Invitation (→ Pending)

- Owner hoặc Member có quyền quản lý thành viên được tạo và thu hồi Invitation trong phạm vi quyền hạn được cấp ([INV-001](../decisions/invitation-decisions.md)).
- Invitation được gắn cố định với email đích tại thời điểm tạo; không thể chuyển sang email khác hoặc thay đổi người nhận ([INV-004](../decisions/invitation-decisions.md)).
- Điều kiện uniqueness: trong cùng một Consumer Organization, một email chỉ được có tối đa một Pending Invitation và không thể đồng thời là Member và người nhận Pending Invitation ([INV-010](../decisions/invitation-decisions.md)). Việc kiểm tra điều kiện và tạo Invitation phải bảo đảm tính nguyên tử để ngăn Invitation trùng lặp do thao tác đồng thời ([INV-011](../decisions/invitation-decisions.md)).
- Không áp đặt hạn mức nghiệp vụ toàn cục cho số lượng Pending Invitation; cơ chế rate limiting và chống lạm dụng vẫn được áp dụng ([INV-008](../decisions/invitation-decisions.md)).
- Độc lập giữa các Organization: một email có thể nhận nhiều Invitation độc lập từ các Consumer Organization khác nhau ([INV-009](../decisions/invitation-decisions.md)).

### Pending → Accepted

Hai điều kiện phải thỏa mãn cùng lúc:

- Người nhận chấp nhận Invitation một cách tường minh ([INV-002](../decisions/invitation-decisions.md)).
- Người nhận chứng minh quyền kiểm soát chính xác email đích tại thời điểm chấp nhận; việc xác minh email Account khác hoặc từng liên kết email đó trước đây không thay thế yêu cầu này ([INV-015](../decisions/invitation-decisions.md)).

Invitation có thể được gửi đến email chưa có Ecoma Account; người nhận có thể đăng ký Account bằng email đó, xác minh OTP rồi chấp nhận Invitation ([INV-003](../decisions/invitation-decisions.md)).

Hệ quả: việc chấp nhận tạo ra Membership cho Account tương ứng ([MEM-015](../decisions/membership-decisions.md)); xem [Membership Lifecycle](membership-lifecycle.md).

### Pending → Revoked

Member có quyền quản lý thành viên được thu hồi Pending Invitation trong phạm vi quyền hạn được cấp ([INV-007](../decisions/invitation-decisions.md)).

### Pending → Expired

Invitation hết hạn theo thời hạn chung mà Ecoma định nghĩa cho mọi Invitation ([INV-005](../decisions/invitation-decisions.md)); TTL là mặc định Ecoma Platform, domain được phủ theo [SD-046](../decisions/strategic-decisions.md).

> **Lưu ý:** giá trị thời hạn cụ thể **chưa được quyết định** ([INV-005](../decisions/invitation-decisions.md)). Tài liệu này không đặt giá trị; chủ đề được theo dõi tại [Discovery Backlog](../discovery-backlog.md).

### Pending → Rejected

Người nhận từ chối Invitation một cách tường minh — trạng thái Rejected thuộc bộ trạng thái đã chốt của Invitation lifecycle ([INV-006](../decisions/invitation-decisions.md)).

### Trạng thái kết thúc

Các trạng thái Accepted, Rejected, Expired, Revoked là kết thúc: **không thể quay lại Pending**. Muốn mời lại phải tạo Invitation mới ([INV-006](../decisions/invitation-decisions.md)).

### Re-invitation

- Có thể gửi Invitation mới ngay sau khi Invitation trước đó Accepted, Rejected, Expired hoặc Revoked, miễn là các điều kiện Membership và Pending Invitation được thỏa mãn (tức các ràng buộc tại [INV-010](../decisions/invitation-decisions.md)) ([INV-012](../decisions/invitation-decisions.md)).
- Trạng thái kết thúc của một Invitation không ảnh hưởng đến các Invitation độc lập khác ([INV-013](../decisions/invitation-decisions.md)).

### Vô hiệu hóa khi Organization Terminated

Khi Consumer Organization bị Terminated, toàn bộ Pending Invitation phải bị vô hiệu ngay ([INV-014](../decisions/invitation-decisions.md), [ORG-013](../decisions/consumer-organization-decisions.md)).

## Bất biến theo suốt vòng đời

- Email đích không đổi: cố định tại thời điểm tạo ([INV-004](../decisions/invitation-decisions.md)); việc Account thay đổi email không tự động thay đổi email nhận Invitation ([ID-008](../decisions/account-identity-decisions.md)).
- Độc lập giữa các Organization ([INV-009](../decisions/invitation-decisions.md), [INV-013](../decisions/invitation-decisions.md)).

## Thuật ngữ

Các thuật ngữ dùng trong tài liệu này được định nghĩa tại [Domain Glossary](../domain-glossary.md); bối cảnh chiến lược tại [Strategic Domain Model](../strategic-domain-model.md).
