# Consumer Organization Lifecycle

## Mục đích

Mô tả các giai đoạn nghiệp vụ của một Consumer Organization và các chuyển tiếp giữa chúng, từ khi được tạo đến khi bị chấm dứt và sau đó — không đi vào thiết kế tactical, API hay cơ sở dữ liệu.

## Các quyết định áp dụng

[ORG-001](../decisions/consumer-organization-decisions.md), [ORG-002](../decisions/consumer-organization-decisions.md), [ORG-003](../decisions/consumer-organization-decisions.md), [ORG-004](../decisions/consumer-organization-decisions.md), [ORG-005](../decisions/consumer-organization-decisions.md), [ORG-006](../decisions/consumer-organization-decisions.md), [ORG-010](../decisions/consumer-organization-decisions.md), [ORG-011](../decisions/consumer-organization-decisions.md), [ORG-012](../decisions/consumer-organization-decisions.md), [ORG-013](../decisions/consumer-organization-decisions.md), [ORG-014](../decisions/consumer-organization-decisions.md), cùng [MEM-001](../decisions/membership-decisions.md), [MEM-002](../decisions/membership-decisions.md), [MEM-016](../decisions/membership-decisions.md), [INV-014](../decisions/invitation-decisions.md), [ID-011](../decisions/account-identity-decisions.md).

## Phạm vi

Lifecycle này **chỉ áp dụng cho Consumer Organization**. Các quyết định về Consumer Organization không áp dụng mặc định cho Provider hoặc Organization Provider; Consumer Organization và Organization Provider là hai khái niệm nghiệp vụ độc lập với vòng đời riêng ([SD-017](../decisions/provider-decisions.md)). Lifecycle của Provider được mô tả riêng tại [Provider Lifecycle](provider-lifecycle.md).

## Quan hệ với các lifecycle khác

- [Account Lifecycle](account-lifecycle.md): vòng đời Organization độc lập với vòng đời Account ([ID-009](../decisions/account-identity-decisions.md)).
- [Membership Lifecycle](membership-lifecycle.md): mọi Membership kết thúc khi Organization bị Terminated ([ORG-013](../decisions/consumer-organization-decisions.md)).
- [Invitation Lifecycle](invitation-lifecycle.md): mọi Pending Invitation bị vô hiệu khi Organization bị Terminated ([INV-014](../decisions/invitation-decisions.md)).
- Process liên quan: [consumer-organization-creation](../business-processes/consumer-organization-creation.md), [consumer-membership-management](../business-processes/consumer-membership-management.md), [consumer-invitation](../business-processes/consumer-invitation.md).

## Các giai đoạn

### 1. Creation

Consumer Organization được tạo bởi một Account trong phạm vi một domain.

- Mỗi domain tự sở hữu mô hình, chính sách và vòng đời Consumer Organization của mình; Consumer Organization ở các domain khác nhau không mặc nhiên là cùng một entity ([ORG-001](../decisions/consumer-organization-decisions.md)).
- Điều kiện tạo và giới hạn số lượng do từng domain tự quyết định theo chính sách thương mại của mình ([ORG-010](../decisions/consumer-organization-decisions.md)).
- Personal Organization và Business Organization không bắt buộc là hai loại entity khác nhau; chúng có thể dùng chung mô hình sở hữu nhưng có chính sách thành viên khác nhau ([ORG-002](../decisions/consumer-organization-decisions.md)).
- Khi được tạo, người tạo trở thành Owner: Account tạo Consumer Organization là Owner đầu tiên ([MEM-016](../decisions/membership-decisions.md)); Organization đang hoạt động có đúng một Owner ([MEM-001](../decisions/membership-decisions.md)); sau chuyển giao quyền sở hữu, Owner cũ trở thành Member thường ([MEM-016](../decisions/membership-decisions.md)). Chi tiết luồng tạo xem [consumer-organization-creation](../business-processes/consumer-organization-creation.md).

### 2. Active operation

Consumer Organization đang hoạt động là chủ thể sử dụng sản phẩm.

- Organization sở hữu tài nguyên và là chủ thể chịu các nghĩa vụ thương mại trong phạm vi từng domain ([ORG-003](../decisions/consumer-organization-decisions.md)).
- Số dư tài chính và phương thức thanh toán thuộc Organization, không nhất thiết thuộc Account cá nhân ([ORG-004](../decisions/consumer-organization-decisions.md)).
- Quyền quản lý thanh toán và tài chính có thể được ủy quyền cho người khác, không bắt buộc thuộc Owner ([ORG-005](../decisions/consumer-organization-decisions.md)).
- Chính sách thương mại do từng domain sở hữu; một Organization có thể có nhiều Subscription độc lập trong cùng domain ([ORG-006](../decisions/consumer-organization-decisions.md)).

### 3. Owner và membership relationships

Trong suốt giai đoạn Active, Organization duy trì quan hệ thành viên:

- Đúng một Owner giữ quyền kiểm soát tối cao ([MEM-001](../decisions/membership-decisions.md), [MEM-002](../decisions/membership-decisions.md)).
- Các Member tham gia thông qua Membership; các chuyển tiếp của Membership (thêm, đổi quyền, chuyển sở hữu, rời, bị loại) thuộc [Membership Lifecycle](membership-lifecycle.md) và không kết thúc lifecycle của Organization.

### 4. Đóng băng theo Owner Account

Khi Account Owner của Organization bị suspension, Organization dừng hoạt động (đóng băng) theo hiệu ứng lan theo quyền sở hữu ([ID-011](../decisions/account-identity-decisions.md)). Trạng thái đóng băng này **đảo ngược** khi Account hồi phục, hoặc khi quyền sở hữu được chuyển giao sang Member đủ điều kiện trong trường hợp suspension vì lý do an toàn, pháp lý hoặc kỹ thuật; với suspension vì vi phạm, đóng băng là tuyệt đối tới khi Account hồi phục hoặc bị closure. Đây là trạng thái tạm thời và khác với termination: termination là chấm dứt vĩnh viễn theo yêu cầu Owner hoặc quyết định của domain (mục 5–9).

### 5. Termination request

Owner có thể yêu cầu chấm dứt Consumer Organization **bất cứ lúc nào** ([ORG-011](../decisions/consumer-organization-decisions.md)). Không có điều kiện trước khi yêu cầu: số lượng Member, Invitation đang chờ hay tài nguyên đang tồn tại không cản trở yêu cầu này.

### 6. Immediate termination

Trạng thái Terminated có **hiệu lực ngay** khi yêu cầu được thực hiện, không phụ thuộc số lượng Member, Invitation hoặc tài nguyên đang tồn tại ([ORG-011](../decisions/consumer-organization-decisions.md)).

### 7. Access revocation

Ngay khi Organization bị Terminated ([ORG-013](../decisions/consumer-organization-decisions.md)):

- Toàn bộ Membership kết thúc (chi tiết thu hồi quyền truy cập kèm theo xem [MEM-013](../decisions/membership-decisions.md) tại [Membership Lifecycle](membership-lifecycle.md)).
- Toàn bộ Pending Invitation bị vô hiệu ngay ([INV-014](../decisions/invitation-decisions.md), [ORG-013](../decisions/consumer-organization-decisions.md)).
- Mọi quyền truy cập phát sinh từ Organization phải bị thu hồi ngay.

### 8. Retention

Termination không đồng nghĩa xóa dữ liệu ngay; dữ liệu được lưu giữ theo chính sách retention của từng domain ([ORG-012](../decisions/consumer-organization-decisions.md)). Chính sách retention cụ thể thuộc sở hữu của từng domain.

### 9. Outstanding obligations

Termination không xóa bỏ nghĩa vụ tài chính, hợp đồng hoặc pháp lý đã phát sinh trước đó ([ORG-014](../decisions/consumer-organization-decisions.md)). Các nghĩa vụ này tiếp tục tồn tại sau khi Organization đã Terminated; cách xử lý cụ thể chưa được quyết định (nguyên tắc "xử lý theo chính sách tại thời điểm phát sinh" mới chỉ được xác lập phía Provider — SD-023) — theo dõi tại [BL-35](../discovery-backlog.md).

## Thuật ngữ

Các thuật ngữ dùng trong tài liệu này được định nghĩa tại [Domain Glossary](../domain-glossary.md); bối cảnh chiến lược tại [Strategic Domain Model](../strategic-domain-model.md).
