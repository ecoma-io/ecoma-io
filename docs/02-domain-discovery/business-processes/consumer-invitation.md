# Consumer Invitation

## Mục đích

Mô tả các luồng nghiệp vụ quản lý Invitation vào một Consumer Organization: tạo, chấp nhận, từ chối, thu hồi, hết hạn, mời lại và ngăn trùng lặp — không đi vào thiết kế tactical, API hay cơ sở dữ liệu.

## Các quyết định áp dụng

[INV-001](../decisions/invitation-decisions.md), [INV-002](../decisions/invitation-decisions.md), [INV-003](../decisions/invitation-decisions.md), [INV-004](../decisions/invitation-decisions.md), [INV-005](../decisions/invitation-decisions.md), [INV-006](../decisions/invitation-decisions.md), [INV-007](../decisions/invitation-decisions.md), [INV-008](../decisions/invitation-decisions.md), [INV-009](../decisions/invitation-decisions.md), [INV-010](../decisions/invitation-decisions.md), [INV-011](../decisions/invitation-decisions.md), [INV-012](../decisions/invitation-decisions.md), [INV-013](../decisions/invitation-decisions.md), [INV-014](../decisions/invitation-decisions.md), [INV-015](../decisions/invitation-decisions.md), cùng [MEM-015](../decisions/membership-decisions.md), [ORG-013](../decisions/consumer-organization-decisions.md), [ID-008](../decisions/account-identity-decisions.md).

## Lifecycle liên quan

[Invitation Lifecycle](../business-lifecycles/invitation-lifecycle.md) mô tả các trạng thái và chuyển tiếp của Invitation; process này chi tiết từng luồng nghiệp vụ.

## Luồng — Create invitation

1. Owner hoặc Member có quyền quản lý thành viên tạo Invitation, trong phạm vi quyền hạn được cấp ([INV-001](../decisions/invitation-decisions.md)).
2. Invitation được gắn cố định với email đích tại thời điểm tạo; không thể chuyển sang email khác hoặc thay đổi người nhận sau khi tạo ([INV-004](../decisions/invitation-decisions.md)).
3. Trước khi tạo, kiểm tra uniqueness trong Organization: một email chỉ được có tối đa một Pending Invitation và không thể đồng thời là Member và người nhận Pending Invitation ([INV-010](../decisions/invitation-decisions.md)).
4. Việc kiểm tra điều kiện và tạo Invitation phải bảo đảm tính nguyên tử để ngăn Invitation trùng lặp do thao tác đồng thời ([INV-011](../decisions/invitation-decisions.md)).
5. Không áp đặt hạn mức nghiệp vụ toàn cục cho số lượng Pending Invitation; cơ chế rate limiting và chống lạm dụng vẫn được áp dụng ([INV-008](../decisions/invitation-decisions.md)).
6. Độc lập giữa các Organization: cùng một email có thể nhận nhiều Invitation độc lập từ các Consumer Organization khác nhau ([INV-009](../decisions/invitation-decisions.md)).

## Luồng — Accept

1. Người nhận mở Invitation và chấp nhận một cách tường minh ([INV-002](../decisions/invitation-decisions.md)).
2. Người nhận chứng minh quyền kiểm soát chính xác email đích tại thời điểm chấp nhận; việc xác minh email Account khác hoặc từng liên kết email đó trước đây không thay thế yêu cầu này ([INV-015](../decisions/invitation-decisions.md)).
3. Nếu email đích chưa có Ecoma Account: người nhận đăng ký Account bằng email đó, xác minh OTP, rồi chấp nhận Invitation ([INV-003](../decisions/invitation-decisions.md)); luồng đăng ký xem [account-registration-and-verification](account-registration-and-verification.md).
4. Chấp nhận thành công tạo ra Membership trong Organization cho Account tương ứng ([MEM-015](../decisions/membership-decisions.md)); việc quản lý Membership tiếp theo xem [consumer-membership-management](consumer-membership-management.md).
5. Invitation chuyển sang trạng thái Accepted — trạng thái kết thúc ([INV-006](../decisions/invitation-decisions.md)).

## Luồng — Reject

1. Người nhận từ chối Invitation một cách tường minh.
2. Invitation chuyển sang trạng thái Rejected — trạng thái kết thúc ([INV-006](../decisions/invitation-decisions.md)).

## Luồng — Revoke

1. Member có quyền quản lý thành viên thu hồi một Pending Invitation, trong phạm vi quyền hạn được cấp ([INV-007](../decisions/invitation-decisions.md)).
2. Invitation chuyển sang trạng thái Revoked — trạng thái kết thúc ([INV-006](../decisions/invitation-decisions.md)). Chỉ Pending Invitation có thể bị thu hồi.

## Luồng — Expiration

1. Pending Invitation hết hạn theo thời hạn chung mà Ecoma định nghĩa cho mọi Invitation ([INV-005](../decisions/invitation-decisions.md)).
   - **Giá trị thời hạn cụ thể chưa được quyết định** ([INV-005](../decisions/invitation-decisions.md)); được theo dõi tại [Discovery Backlog](../discovery-backlog.md). Process này không đặt giá trị.
2. Invitation chuyển sang trạng thái Expired — trạng thái kết thúc ([INV-006](../decisions/invitation-decisions.md)).

## Luồng — Re-invitation

1. Sau khi một Invitation ở trạng thái kết thúc (Accepted, Rejected, Expired hoặc Revoked), có thể gửi Invitation mới **ngay** cho cùng email, miễn là các điều kiện Membership và Pending Invitation được thỏa mãn ([INV-012](../decisions/invitation-decisions.md) — tức các ràng buộc uniqueness tại [INV-010](../decisions/invitation-decisions.md)).
2. Trạng thái kết thúc của Invitation trước không ảnh hưởng đến các Invitation độc lập khác, và không phải chờ bất kỳ khoảng thời gian nào ([INV-012](../decisions/invitation-decisions.md), [INV-013](../decisions/invitation-decisions.md)).
3. Invitation mới là một Invitation mới theo đúng nghĩa: trạng thái kết thúc không thể quay lại Pending ([INV-006](../decisions/invitation-decisions.md)).

## Luồng — Concurrent duplicate prevention

Ngăn hai Invitation trùng lặp phát sinh khi hai chủ thể có quyền tạo Invitation cùng lúc cho cùng email trong một Organization:

1. Kiểm tra điều kiện uniqueness ([INV-010](../decisions/invitation-decisions.md)) và hành động tạo Invitation được thực hiện như một thao tác nguyên tử ([INV-011](../decisions/invitation-decisions.md)).
2. Kết quả: tại mọi thời điểm, một email trong một Organization không bao giờ có nhiều hơn một Pending Invitation, và không vừa là Member vừa là người nhận Pending Invitation ([INV-010](../decisions/invitation-decisions.md)).

## Điều kiện và ngoại lệ

- **Email đang là Member trong Organization:** không thể tạo Invitation — không thể đồng thời là Member và người nhận Pending Invitation ([INV-010](../decisions/invitation-decisions.md)).
- **Email đã có Pending Invitation trong Organization:** không thể tạo Invitation mới trùng — tối đa một Pending Invitation per email per Organization ([INV-010](../decisions/invitation-decisions.md)).
- **Organization đã Terminated:** toàn bộ Pending Invitation phải bị vô hiệu ngay ([INV-014](../decisions/invitation-decisions.md), [ORG-013](../decisions/consumer-organization-decisions.md)); không thể tạo hoặc chấp nhận Invitation trong Organization đã Terminated.
- **Invitation gắn email cũ sau khi Account đổi email:** Invitation không tự đổi theo email mới của Account ([ID-008](../decisions/account-identity-decisions.md)); người nhận vẫn phải chứng minh kiểm soát email đích khi chấp nhận ([INV-015](../decisions/invitation-decisions.md)).
- **Rate limiting/anti-abuse:** có thể từ chối tạo Invitation vượt ngưỡng chống lạm dụng dù không có hạn mức nghiệp vụ toàn cục ([INV-008](../decisions/invitation-decisions.md)).

## Thuật ngữ

Các thuật ngữ dùng trong tài liệu này được định nghĩa tại [Domain Glossary](../domain-glossary.md); bối cảnh chiến lược tại [Strategic Domain Model](../strategic-domain-model.md).
