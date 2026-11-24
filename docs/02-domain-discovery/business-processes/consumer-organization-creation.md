# Consumer Organization Creation

## Mục đích

Mô tả luồng nghiệp vụ tạo một Consumer Organization trong một domain, từng bước, ở cấp process nghiệp vụ — không đi vào thiết kế tactical, API hay cơ sở dữ liệu.

## Các quyết định áp dụng

[ORG-001](../decisions/consumer-organization-decisions.md), [ORG-002](../decisions/consumer-organization-decisions.md), [ORG-008](../decisions/consumer-organization-decisions.md), [ORG-009](../decisions/consumer-organization-decisions.md), [ORG-010](../decisions/consumer-organization-decisions.md), cùng [MEM-001](../decisions/membership-decisions.md), [MEM-016](../decisions/membership-decisions.md), [ID-001](../decisions/account-identity-decisions.md).

## Lifecycle liên quan

[Consumer Organization Lifecycle](../business-lifecycles/consumer-organization-lifecycle.md) — giai đoạn Creation.

## Luồng nghiệp vụ

1. Account yêu cầu tạo Consumer Organization trong một domain.
   - Account là danh tính đã xác thực; việc xác thực thành công không mặc nhiên cấp quyền — authentication ≠ authorization ([ID-001](../decisions/account-identity-decisions.md)). Việc được phép tạo Organization là một quyết định authorization riêng.
2. Domain kiểm tra điều kiện tạo Consumer Organization và giới hạn số lượng theo chính sách thương mại của chính mình ([ORG-010](../decisions/consumer-organization-decisions.md)):
   - Giới hạn số Organization được **sở hữu** và giới hạn số Organization được **tham gia** là hai chính sách độc lập ([ORG-009](../decisions/consumer-organization-decisions.md)).
   - Ecoma không đặt giới hạn chung toàn Ecoma Platform về số lượng Consumer Organization mà một Account có thể sở hữu hoặc tham gia — mọi giới hạn đến từ chính sách của từng domain ([ORG-008](../decisions/consumer-organization-decisions.md)).
3. Domain tạo Consumer Organization trong phạm vi của mình.
   - Mỗi domain tự sở hữu mô hình, chính sách và vòng đời Consumer Organization; Consumer Organization ở các domain khác nhau không mặc nhiên là cùng một entity ([ORG-001](../decisions/consumer-organization-decisions.md)).
   - Personal Organization và Business Organization không bắt buộc là hai loại entity khác nhau: chúng có thể dùng chung mô hình sở hữu nhưng có chính sách thành viên khác nhau ([ORG-002](../decisions/consumer-organization-decisions.md)). Việc chọn chính sách thành viên thuộc quyết định của domain tại bước tạo.
4. Người tạo trở thành Owner của Organization ([MEM-016](../decisions/membership-decisions.md)); Organization đang hoạt động có đúng một Owner ([MEM-001](../decisions/membership-decisions.md)); Owner giữ quyền kiểm soát tối cao. Quan hệ thành viên tiếp theo thuộc [consumer-membership-management](consumer-membership-management.md).

**Ranh giới chính sách:** điều kiện tạo cụ thể, giới hạn số lượng, và sự khác biệt giữa Personal/Business Organization là chính sách do **từng domain sở hữu** ([ORG-010](../decisions/consumer-organization-decisions.md), [ORG-002](../decisions/consumer-organization-decisions.md)); process này không đặt giá trị cụ thể cho chúng.

## Điều kiện và ngoại lệ

- **Account không thỏa điều kiện tạo hoặc đã đạt giới hạn của domain:** yêu cầu bị từ chối theo chính sách của domain ([ORG-010](../decisions/consumer-organization-decisions.md), [ORG-009](../decisions/consumer-organization-decisions.md)). Chính sách cụ thể do domain định nghĩa, không nằm trong quyết định cấp Ecoma Platform.
- **Authentication ≠ authorization:** Account đã xác thực nhưng không được phép tạo Organization trong domain vẫn bị từ chối ở bước authorization ([ID-001](../decisions/account-identity-decisions.md)).

## Thuật ngữ

Các thuật ngữ dùng trong tài liệu này được định nghĩa tại [Domain Glossary](../domain-glossary.md); bối cảnh chiến lược tại [Strategic Domain Model](../strategic-domain-model.md).
