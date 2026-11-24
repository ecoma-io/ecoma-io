# Account Email Change

## Mục đích

Mô tả luồng nghiệp vụ thay đổi địa chỉ email của một Ecoma Account, từng bước, ở cấp process nghiệp vụ — không đi vào thiết kế tactical, API hay cơ sở dữ liệu.

## Các quyết định áp dụng

[ID-006](../decisions/account-identity-decisions.md), [ID-007](../decisions/account-identity-decisions.md), [ID-008](../decisions/account-identity-decisions.md), [ID-012](../decisions/account-identity-decisions.md).

## Lifecycle liên quan

[Account Lifecycle](../business-lifecycles/account-lifecycle.md) — giai đoạn Email change và Account identity continuity.

## Luồng nghiệp vụ

1. Người dùng yêu cầu thay đổi email của Account sang một email mới.
2. Hệ thống xác minh email mới bằng OTP gửi đến chính email đó; email mới chỉ được xác minh sau khi hoàn thành OTP ([ID-007](../decisions/account-identity-decisions.md)).
3. Hệ thống kiểm tra email mới chưa thuộc một Account khác ([ID-006](../decisions/account-identity-decisions.md), [ID-007](../decisions/account-identity-decisions.md)).
4. Hoàn tất thay đổi: email mới thay thế email cũ trên Account.
5. Tính liên tục của danh tính Account được giữ nguyên: vẫn là cùng một Account, các quyền và quan hệ đã thiết lập không thay đổi vì việc đổi email (bảo toàn được phát biểu tường minh tại [ID-012](../decisions/account-identity-decisions.md): đổi email bảo toàn danh tính, Membership, quyền sở hữu và lịch sử hoạt động; audit tham chiếu Account, không phụ thuộc email).
6. Email nhận Invitation **không tự đổi**: Invitation được cố định với email đích tại thời điểm tạo; việc Account thay đổi email không tự động thay đổi email nhận Invitation ([ID-008](../decisions/account-identity-decisions.md)). Invitation đã gửi đến email cũ vẫn gắn với email cũ; xem [consumer-invitation](consumer-invitation.md).

## Điều kiện và ngoại lệ

- **Email mới đã thuộc Account khác:** thay đổi bị từ chối, vì một địa chỉ email chỉ được liên kết với tối đa một Account tại cùng thời điểm ([ID-006](../decisions/account-identity-decisions.md), [ID-007](../decisions/account-identity-decisions.md)).
- **OTP cho email mới chưa hoàn thành:** email mới chưa được coi là xác minh ([ID-007](../decisions/account-identity-decisions.md)); thay đổi chưa thể hoàn tất.
- Trường hợp người nhận Invitation bằng email cũ dùng Account có email mới: Invitation không tự động theo email mới ([ID-008](../decisions/account-identity-decisions.md)); người nhận vẫn phải chứng minh kiểm soát email đích khi chấp nhận ([INV-015](../decisions/invitation-decisions.md)).

## Thuật ngữ

Các thuật ngữ dùng trong tài liệu này được định nghĩa tại [Domain Glossary](../domain-glossary.md); bối cảnh chiến lược tại [Strategic Domain Model](../strategic-domain-model.md).
