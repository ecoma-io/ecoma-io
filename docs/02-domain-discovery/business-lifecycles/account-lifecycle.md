# Account Lifecycle

## Mục đích

Mô tả các giai đoạn nghiệp vụ của một Ecoma Account và các chuyển tiếp giữa chúng, ở cấp lifecycle nghiệp vụ — không đi vào thiết kế tactical, API hay cơ sở dữ liệu.

## Các quyết định áp dụng

[ID-001](../decisions/account-identity-decisions.md), [ID-002](../decisions/account-identity-decisions.md), [ID-004](../decisions/account-identity-decisions.md), [ID-005](../decisions/account-identity-decisions.md), [ID-006](../decisions/account-identity-decisions.md), [ID-007](../decisions/account-identity-decisions.md), [ID-008](../decisions/account-identity-decisions.md), [ID-009](../decisions/account-identity-decisions.md), [ID-010](../decisions/account-identity-decisions.md), [ID-011](../decisions/account-identity-decisions.md), [ID-012](../decisions/account-identity-decisions.md), [ID-014](../decisions/account-identity-decisions.md), [FIN-001](../decisions/financial-decisions.md), [FIN-003](../decisions/financial-decisions.md).

## Quan hệ với các lifecycle khác

- [Consumer Organization Lifecycle](consumer-organization-lifecycle.md): vòng đời Account độc lập với vòng đời Organization ([ID-009](../decisions/account-identity-decisions.md)).
- [Invitation Lifecycle](invitation-lifecycle.md): Account có thể nhận Invitation qua email; việc thay đổi email Account không tự động thay đổi email nhận Invitation ([ID-008](../decisions/account-identity-decisions.md)).
- Process liên quan: [account-registration-and-verification](../business-processes/account-registration-and-verification.md), [account-email-change](../business-processes/account-email-change.md).

## Các giai đoạn

### 1. Registration

Account bắt đầu tồn tại khi một người dùng đăng ký bằng địa chỉ email.

- Account là danh tính chung dùng để xác thực xuyên suốt Ecoma Platform; quyền truy cập và quyền hạn vẫn do từng domain quyết định ([ID-001](../decisions/account-identity-decisions.md)).
- Địa chỉ email phải chưa thuộc bất kỳ Account nào khác; một email chỉ liên kết với tối đa một Account tại cùng thời điểm ([ID-006](../decisions/account-identity-decisions.md)).
- Không có mật khẩu: hệ thống sử dụng passwordless authentication và không lưu trữ mật khẩu người dùng ([ID-004](../decisions/account-identity-decisions.md)).
- Tích hợp danh tính ưu tiên các chuẩn OIDC, OAuth2, JWKS, MFA và cơ chế quản lý token theo tiêu chuẩn ([ID-002](../decisions/account-identity-decisions.md)).

### 2. Email verification

Sau khi đăng ký, người dùng chứng minh kiểm soát địa chỉ email thông qua OTP.

- Ý nghĩa và giới hạn của OTP: OTP chỉ chứng minh người dùng kiểm soát địa chỉ email **tại thời điểm xác minh**; nó không chứng minh danh tính pháp lý hoặc danh tính con người ([ID-005](../decisions/account-identity-decisions.md)). Đây là ranh giới ý nghĩa của toàn bộ cơ chế xác minh email trong lifecycle này.

### 3. Active use xuyên domain

Account đã xác minh bước vào giai đoạn sử dụng dài hạn.

- Một Account được sử dụng xuyên suốt Ecoma Platform ([SD-012](../decisions/strategic-decisions.md)); việc xác thực không mặc nhiên cấp quyền truy cập vào mọi domain ([ID-001](../decisions/account-identity-decisions.md); authentication ≠ authorization).
- Account tồn tại độc lập với bất kỳ Organization nào: nó có thể tham gia hoặc nhận Invitation từ nhiều Organization trong cả hai domain ([ORG-008](../decisions/consumer-organization-decisions.md), [INV-009](../decisions/invitation-decisions.md)); tính độc lập vòng đời được xác lập bởi [ID-009](../decisions/account-identity-decisions.md).

### 4. Email change

Trong giai đoạn Active, người dùng có thể thay đổi email của Account.

- Email mới chỉ được xác minh sau khi hoàn thành OTP cho chính email đó ([ID-007](../decisions/account-identity-decisions.md)).
- Email mới không được đang thuộc một Account khác ([ID-006](../decisions/account-identity-decisions.md), [ID-007](../decisions/account-identity-decisions.md)).

### 5. Account identity continuity

Đổi email không làm mất tính liên tục của danh tính Account: vẫn là cùng một Account, với các quyền và quan hệ đã thiết lập (việc bảo toàn được phát biểu tường minh tại [ID-012](../decisions/account-identity-decisions.md): đổi email bảo toàn danh tính, Membership, quyền sở hữu và lịch sử hoạt động; audit tham chiếu Account, không phụ thuộc email).

- Ngoại lệ tường minh: email dùng để nhận Invitation không tự động đổi theo. Invitation được cố định với email đích tại thời điểm tạo; việc Account thay đổi email không tự động thay đổi email nhận Invitation ([ID-008](../decisions/account-identity-decisions.md)).

### 6. Suspension

Account có thể bị tạm ngưng có tính đảo ngược (suspension): authentication và mọi authorization của Account bị chấm dứt ngay (session, token, credential), và hiệu ứng lan theo quyền sở hữu — mọi chủ thể do Account làm Owner dừng hoạt động ([ID-011](../decisions/account-identity-decisions.md)). Việc hồi phục Account đưa Account trở lại và kích hoạt các chủ thể bị đóng băng chạy lại. Danh mục nguyên nhân suspension (loại vi phạm — đóng băng tuyệt đối — hay loại an toàn/pháp lý/kỹ thuật — cho phép chuyển giao cứu chủ thể) chưa được quyết định — xem [Discovery Backlog](../discovery-backlog.md): [BL-33](../discovery-backlog.md#bl-33--danh-mục-nguyên-nhân-account-suspension).

### 7. Closure

Account kết thúc bằng thao tác xóa Account, chỉ được thực hiện khi đủ các điều kiện tiên quyết ([ID-010](../decisions/account-identity-decisions.md), [ID-014](../decisions/account-identity-decisions.md)):

1. Không còn sở hữu Consumer Organization hoặc Provider Organization nào — user phải chủ động xóa từng Org trước, theo điều kiện xóa Org do từng domain quy định (Domain LLM và Domain GPU: bất cứ lúc nào); với Organization Provider, Account phải chuyển giao vai trò Owner trước ([ID-014](../decisions/account-identity-decisions.md)).
2. Đã chấm dứt Individual Provider Identity nếu có.
3. Đã xử lý xong số dư tài chính: usage balance không hoàn trả, earning balance phải được rút trước khi Org/Provider Identity bị terminate ([FIN-001](../decisions/financial-decisions.md), [FIN-003](../decisions/financial-decisions.md)).

Các Org mà Account chỉ là Member không chặn việc xóa; Membership của Account kết thúc tự động khi Account bị xóa ([MEM-013](../decisions/membership-decisions.md)). Việc xóa Account không tự động terminate các Org. Tình trạng Terminated của Org không đồng nghĩa xóa dữ liệu ngay: dữ liệu được lưu giữ theo chính sách retention của domain phục vụ audit và nghĩa vụ pháp lý ([ORG-012](../decisions/consumer-organization-decisions.md), [ORG-014](../decisions/consumer-organization-decisions.md)).

## Quan hệ với Organization lifecycle

Theo [ID-009](../decisions/account-identity-decisions.md), vòng đời Account độc lập với vòng đời Organization: Organization có thể được tạo, chấm dứt hoặc Member có thể rời đi mà lifecycle của Account không kết thúc theo; ngược lại, Account tồn tại không đòi hỏi phải thuộc Organization nào. Ngoại lệ được phát biểu tường minh tại [ID-010](../decisions/account-identity-decisions.md): thao tác xóa Account có điều kiện tiên quyết liên quan đến việc xóa các Org sở hữu, Individual Provider Identity và số dư — đây là điều kiện nghiệp vụ do user chủ động xử lý, không phải ràng buộc trạng thái tự động giữa hai vòng đời.

## Chưa được quyết định

Hiện tại không còn chủ đề nào đang chờ trong tài liệu này; các câu hỏi liên quan được ghi nhận trong [Discovery Backlog](../discovery-backlog.md).

## Thuật ngữ

Các thuật ngữ dùng trong tài liệu này được định nghĩa tại [Domain Glossary](../domain-glossary.md); bối cảnh chiến lược tại [Strategic Domain Model](../strategic-domain-model.md).
