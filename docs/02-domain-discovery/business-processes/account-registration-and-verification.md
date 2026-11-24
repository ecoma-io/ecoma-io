# Account Registration and Verification

## Mục đích

Mô tả luồng nghiệp vụ đăng ký và xác minh một Ecoma Account, từng bước, ở cấp process nghiệp vụ — không đi vào thiết kế tactical, API hay cơ sở dữ liệu.

## Các quyết định áp dụng

[ID-001](../decisions/account-identity-decisions.md), [ID-002](../decisions/account-identity-decisions.md), [ID-004](../decisions/account-identity-decisions.md), [ID-005](../decisions/account-identity-decisions.md), [ID-006](../decisions/account-identity-decisions.md).

## Lifecycle liên quan

[Account Lifecycle](../business-lifecycles/account-lifecycle.md) mô tả toàn bộ các giai đoạn của Account; process này chi tiết giai đoạn Registration và Email verification.

## Luồng nghiệp vụ

1. Người dùng submit yêu cầu đăng ký Account với một địa chỉ email.
2. Hệ thống kiểm tra email chưa thuộc Account nào khác — một địa chỉ email chỉ được liên kết với tối đa một Account tại cùng thời điểm ([ID-006](../decisions/account-identity-decisions.md)).
3. Hệ thống gửi verification OTP qua email để người dùng chứng minh kiểm soát địa chỉ email.
   - Ý nghĩa của OTP: chỉ chứng minh người dùng kiểm soát địa chỉ email **tại thời điểm xác minh** ([ID-005](../decisions/account-identity-decisions.md)).
   - Giới hạn của OTP: không chứng minh danh tính pháp lý hoặc danh tính con người ([ID-005](../decisions/account-identity-decisions.md)).
4. Người dùng xác minh OTP thành công; Account hoạt động.
5. Account được sử dụng xuyên suốt Ecoma Platform: một Account là danh tính chung dùng để xác thực xuyên suốt Ecoma Platform ([ID-001](../decisions/account-identity-decisions.md)); quyền truy cập và quyền hạn vẫn do từng domain quyết định ([ID-001](../decisions/account-identity-decisions.md)) — authentication ≠ authorization.
6. Đặc điểm của Account sau đăng ký:
   - Passwordless authentication: không dùng và không lưu trữ mật khẩu người dùng ([ID-004](../decisions/account-identity-decisions.md)).
   - Tích hợp danh tính ưu tiên các chuẩn OIDC, OAuth2, JWKS, MFA và cơ chế quản lý token theo tiêu chuẩn ([ID-002](../decisions/account-identity-decisions.md)).

## Điều kiện và ngoại lệ

- **Email đã tồn tại:** nếu email đã liên kết với một Account khác, việc đăng ký bằng email đó không được thực hiện vì vi phạm uniqueness ([ID-006](../decisions/account-identity-decisions.md)); luồng xử lý trải nghiệm người dùng trong trường hợp này thuộc lớp design.
- **OTP xác minh thất bại hoặc hết hiệu lực:** ý nghĩa nghiệp vụ chỉ là người dùng chưa chứng minh kiểm soát email tại thời điểm đó ([ID-005](../decisions/account-identity-decisions.md)); có thể xác minh lại. Cơ chế phát lại OTP thuộc thiết kế sau, không thuộc process nghiệp vụ này.
- Trường hợp đăng ký bằng email đã có Invitation đang chờ: xem [consumer-invitation](consumer-invitation.md) ([INV-003](../decisions/invitation-decisions.md)).

## Thuật ngữ

Các thuật ngữ dùng trong tài liệu này được định nghĩa tại [Domain Glossary](../domain-glossary.md); bối cảnh chiến lược tại [Strategic Domain Model](../strategic-domain-model.md).
