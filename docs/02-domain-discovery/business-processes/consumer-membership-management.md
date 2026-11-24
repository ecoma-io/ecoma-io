# Consumer Membership Management

## Mục đích

Mô tả các luồng nghiệp vụ quản lý Membership trong một Consumer Organization: quản lý quyền Member, ủy quyền, chuyển quyền sở hữu, rời Organization và loại Member — không đi vào thiết kế tactical, API hay cơ sở dữ liệu.

## Các quyết định áp dụng

[MEM-001](../decisions/membership-decisions.md), [MEM-002](../decisions/membership-decisions.md), [MEM-003](../decisions/membership-decisions.md), [MEM-004](../decisions/membership-decisions.md), [MEM-005](../decisions/membership-decisions.md), [MEM-006](../decisions/membership-decisions.md), [MEM-007](../decisions/membership-decisions.md), [MEM-008](../decisions/membership-decisions.md), [MEM-009](../decisions/membership-decisions.md), [MEM-011](../decisions/membership-decisions.md), [MEM-012](../decisions/membership-decisions.md), [MEM-013](../decisions/membership-decisions.md), [MEM-014](../decisions/membership-decisions.md), [MEM-016](../decisions/membership-decisions.md).

## Lifecycle liên quan

[Membership Lifecycle](../business-lifecycles/membership-lifecycle.md) mô tả các giai đoạn của Membership; process này chi tiết các luồng quản lý trong giai đoạn Active.

## Luồng (a) — Member management

Quản lý quyền của Member trong Organization:

1. Owner hoặc Member được cấp quyền quản lý thành viên xác định quyền của một Member khác, trong phạm vi được cấp ([MEM-006](../decisions/membership-decisions.md)).
2. Thay đổi quyền không được vượt quá phạm vi quản lý của chủ thể thực hiện: Member có quyền quản lý không thể cấp, thay đổi hoặc thu hồi quyền vượt quá phạm vi quản lý của mình ([MEM-007](../decisions/membership-decisions.md)).
3. Role dùng chung cấp Ecoma Platform ([SD-063](../decisions/strategic-decisions.md)); Permission cụ thể và giá trị mặc định cho Member do từng domain tự định nghĩa ([MEM-005](../decisions/membership-decisions.md)); một Account chỉ có tối đa một Membership trong Organization, Membership chứa nhiều Role/Permission ([MEM-009](../decisions/membership-decisions.md)).
4. Khi thu hồi quyền quản lý của một Member: các quyền mà người quản lý đó đã cấp trước đó **không tự động bị thu hồi**; chúng tiếp tục tồn tại cho đến khi một chủ thể có thẩm quyền thay đổi ([MEM-008](../decisions/membership-decisions.md)).

## Luồng (b) — Permission delegation

1. Owner ủy quyền thực hiện một số quyền cho người khác (ví dụ quyền quản lý thanh toán, tài chính, thành viên) ([MEM-002](../decisions/membership-decisions.md)).
2. Owner không mất quyền kiểm soát tối cao khi ủy quyền: Owner giữ quyền kiểm soát tối cao đối với Organization, bao gồm thành viên, quyền sở hữu, thanh toán, tài chính, cấu hình, tài nguyên và hoạt động ([MEM-002](../decisions/membership-decisions.md)).
3. Quyền được ủy quyền tiếp theo được quản lý trong phạm vi được cấp, theo các ràng buộc tại [MEM-006](../decisions/membership-decisions.md) và [MEM-007](../decisions/membership-decisions.md).

## Luồng (c) — Ownership transfer

1. Owner lựa chọn chuyển quyền sở hữu Organization cho một Member đủ điều kiện ([MEM-003](../decisions/membership-decisions.md)); tiêu chí "đủ điều kiện" thuộc chính sách phân quyền do domain định nghĩa ([MEM-005](../decisions/membership-decisions.md)).
2. Member nhận quyền trở thành Owner.
3. Owner cũ không còn là Owner; Organization vẫn có đúng một Owner ([MEM-001](../decisions/membership-decisions.md)).
4. Owner cũ tiếp tục là Member thông thường của Organization, với danh sách quyền như các Member khác và không giữ quyền đặc biệt, trừ khi tự rời theo Luồng (d) ([MEM-016](../decisions/membership-decisions.md)).

## Luồng (d) — Voluntary leave

1. Member yêu cầu tự rời Organization; không cần Owner phê duyệt ([MEM-011](../decisions/membership-decisions.md)).
2. Nếu người rời là Owner: yêu cầu bị chặn khi chưa chuyển quyền sở hữu cho người khác ([MEM-004](../decisions/membership-decisions.md)). Owner phải hoàn tất Luồng (c) trước khi có thể rời.
3. Membership kết thúc; quyền truy cập phát sinh từ Membership bị thu hồi triệt để theo [MEM-013](../decisions/membership-decisions.md) (xem Luồng (e), bước thu hồi quyền truy cập).

## Luồng (e) — Membership revocation

1. Chủ thể có thẩm quyền quản lý thành viên loại một Member khỏi Organization, trong phạm vi quyền hạn được cấp; quyền loại Member chưa được phát biểu tường minh trong [MEM-006](../decisions/membership-decisions.md) — theo dõi tại [BL-36](../discovery-backlog.md).
2. Nếu người bị loại là Owner: bị chặn khi chưa chuyển quyền sở hữu ([MEM-004](../decisions/membership-decisions.md)).
3. Thu hồi quyền truy cập triệt để: toàn bộ quyền truy cập phát sinh trực tiếp hoặc gián tiếp từ Membership phải bị thu hồi, bao gồm quyền thông qua session, token hoặc credential phụ thuộc vào Membership ([MEM-013](../decisions/membership-decisions.md)).
4. Tài nguyên do Member tạo **không bị xóa tự động**; mỗi domain tự quyết định cách xử lý tài nguyên và các phụ thuộc liên quan ([MEM-014](../decisions/membership-decisions.md)).
5. Mời lại: Member đã rời hoặc bị loại có thể được mời lại **ngay**, không có thời gian chờ; Membership mới có vòng đời độc lập với Membership cũ ([MEM-012](../decisions/membership-decisions.md)). Luồng mời lại xem [consumer-invitation](consumer-invitation.md).

## Điều kiện và ngoại lệ

- **Owner chưa transfer ownership:** không thể tự rời và không thể bị loại ([MEM-004](../decisions/membership-decisions.md)).
- **Delegation vượt phạm vi:** mọi thao tác phân quyền vượt phạm vi quản lý của chủ thể thực hiện bị từ chối ([MEM-007](../decisions/membership-decisions.md)).
- **Thu hồi quyền quản lý:** không tự thu hồi quyền đã cấp bởi người quản lý bị thu hồi quyền ([MEM-008](../decisions/membership-decisions.md)).
- **Thao tác đồng thời khi transfer ownership:** yêu cầu bảo đảm vẫn có đúng một Owner tại mọi thời điểm ([MEM-001](../decisions/membership-decisions.md)); cơ chế xử lý kỹ thuật thuộc thiết kế sau.
- **Quyền hạn cụ thể của từng Role:** tập Role dùng chung cấp Ecoma Platform, quyền hạn cụ thể thuộc từng domain ([MEM-005](../decisions/membership-decisions.md), [SD-063](../decisions/strategic-decisions.md)); process này không định nghĩa.

## Thuật ngữ

Các thuật ngữ dùng trong tài liệu này được định nghĩa tại [Domain Glossary](../domain-glossary.md); bối cảnh chiến lược tại [Strategic Domain Model](../strategic-domain-model.md).
