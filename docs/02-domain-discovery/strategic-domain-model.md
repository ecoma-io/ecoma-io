# Strategic Domain Model

Tài liệu này tổng hợp mô hình domain mức chiến lược (strategic domain model) của Ecoma ở cấp độ discovery, dựa trên các quyết định đã được ghi nhận. Nó mô tả các khái niệm nghiệp vụ, quyền sở hữu và ranh giới đã được quyết định; tài liệu này **không phải** Bounded Context Map, không định nghĩa service, không thiết kế tactical, database hay API.

## 1. Purpose and Scope

Phần này xác định mục đích, phạm vi và vị trí của tài liệu trong bộ tài liệu kiến trúc.

- Tài liệu mô tả **strategic domain model mức discovery** của Ecoma: các business subject, khái niệm nghiệp vụ, quyền sở hữu nghiệp vụ và ranh giới đã được xác lập.
- Phương pháp và điều kiện hoàn thành discovery theo [Discovery Charter](../00-governance/discovery-charter.md).
- Theo [SD-010](decisions/strategic-decisions.md), Strategic Domain Discovery và Business Capability Map phải hoàn thành **trước khi** xác định Bounded Context và Tactical Design. Do đó tài liệu này không đặt tên Bounded Context, không biến khái niệm thành Service hay Microservice, không định nghĩa Domain Event, và không ánh xạ Capability → Bounded Context → Microservice.
- Quan hệ giữa các tài liệu:
  - `decisions/*.md` — ghi nhận từng quyết định nghiệp vụ kèm trạng thái và nguồn; tài liệu này **tổng hợp** hệ quả của các quyết định thành một mô hình nhất quán, không thay thế và không sao chép nội dung quyết định.
  - [Bản đồ Business Capability](business-capability-map.md) — liệt kê năng lực nghiệp vụ; mô hình này cho biết các chủ thể và quyền sở hữu liên quan đến năng lực đó.
  - [Bảng thuật ngữ](domain-glossary.md) — định nghĩa chuẩn của từng thuật ngữ dùng trong tài liệu này.
  - Chiến lược tổng thể tại [Ecoma Strategy](../01-strategy/ecoma-strategy.md) và [AI Factory Marketplace](../01-strategy/ai-factory-marketplace.md).
- Những nội dung chưa có quyết định được ghi rõ là "chưa được quyết định" và được theo dõi trong [Discovery Backlog](discovery-backlog.md); tài liệu này không tự nâng giả định thành quyết định.
- Quy ước đọc lại theo [SD-059](decisions/strategic-decisions.md): các quyết định trước đây phát biểu theo cấp Product được đọc lại theo cấp domain; ở những phần trích lại nội dung quyết định, chữ "Product" được hiểu là domain tương ứng.

## 2. AI Factory Marketplace Overview

Phần này mô tả Ecoma ở cấp cao nhất: một Product duy nhất gồm hai domain cung ứng trên một lớp năng lực dùng chung, với tầm nhìn tích hợp và mô hình vận hành liên kết.

- Ecoma là một Product duy nhất — **AI Factory Marketplace** — hợp nhất từ định hướng LLM Marketplace và GPU Cloud Marketplace; không còn mô hình Product Portfolio nhiều sản phẩm ([SD-058](decisions/strategic-decisions.md)).
- Sản phẩm gồm hai domain cung ứng ngang hàng — **Domain LLM và Domain GPU** — trên một lớp năng lực dùng chung do Ecoma sở hữu (Ecoma Platform); ranh giới cung ứng giữa hai domain rời hoàn toàn, không có model niêm yết dùng chung ([SD-059](decisions/strategic-decisions.md)).
- Tầm nhìn dài hạn là một sản phẩm **tích hợp** trên hai phương diện ([SD-037](decisions/strategic-decisions.md), đọc theo cấp domain):
  - **Integrated Experience**: trải nghiệm xuyên suốt giữa hai domain.
  - **Integrated Business**: hai domain có thể kết hợp dịch vụ, chia sẻ nguồn lực và tạo ra Offering có giá trị tổng hợp.
- Việc tích hợp không làm mất tính độc lập nghiệp vụ của từng domain ([SD-037](decisions/strategic-decisions.md)).
- Liên kết cung ứng GPU → LLM không phải giá trị cốt lõi nhưng được phép xảy ra và Ecoma mong muốn; ranh giới hai domain không được chặn liên kết này, không thiết kế tích hợp trước khi có nhu cầu thực ([SD-060](decisions/strategic-decisions.md)).
- Vận hành theo mô hình **federated**: các năng lực vận hành dùng chung được tổ chức ở cấp Ecoma Platform, đồng thời quyền sở hữu và các hoạt động vận hành đặc thù được duy trì tại từng domain ([SD-040](decisions/strategic-decisions.md)).
- Sự mở rộng theo thời gian diễn ra bên trong từng domain (dạng cung ứng mới) và qua liên kết giữa hai domain khi nhu cầu phát sinh; chi tiết tại [AI Factory Marketplace](../01-strategy/ai-factory-marketplace.md).

## 3. Domain Ownership and Independence

Phần này xác lập quyền sở hữu nghiệp vụ của từng domain trong sản phẩm và cách Ecoma cân bằng giữa chia sẻ, độc lập và nhất quán.

- Mỗi domain có thể sở hữu **mô hình kinh doanh, Organization Model, chính sách và vòng đời riêng** ([SD-002](decisions/strategic-decisions.md)).
- Mỗi domain chịu trách nhiệm **sở hữu và phát triển Domain của mình** ([SD-006](decisions/strategic-decisions.md)).
- Các domain được phép có **Domain Model khác nhau**, kể cả khi sử dụng những khái niệm nghiệp vụ có tên gọi tương tự ([SD-007](decisions/strategic-decisions.md)). Hệ quả: một thuật ngữ chung (ví dụ Organization, Membership) không đảm bảo ý nghĩa giống nhau ở hai domain khác nhau, trừ khi khái niệm đó có căn cứ sở hữu cấp Ecoma Platform (xem phần 4).
- Chiến lược thiết kế cân bằng ba yếu tố: **tính độc lập của domain, khả năng chia sẻ, tính nhất quán toàn sản phẩm** ([SD-003](decisions/strategic-decisions.md)).
- Các năng lực thực sự dùng chung được cung cấp ở cấp Platform; **chia sẻ kỹ thuật không đồng nghĩa với hợp nhất quyền sở hữu nghiệp vụ** ([SD-004](decisions/strategic-decisions.md)).
- Áp dụng **selective consistency**: chỉ thống nhất những quy tắc và năng lực cần thiết trên toàn sản phẩm, không áp đặt nhất quán cho mọi nghiệp vụ ([SD-005](decisions/strategic-decisions.md)).
- Governance mang tính **lai**: Ecoma Platform quản trị các nguyên tắc và năng lực nền tảng bắt buộc; domain tự chủ quyết định mô hình kinh doanh, quan hệ thương mại, pricing, SLA và trách nhiệm dịch vụ trong phạm vi nguyên tắc chung ([SD-030](decisions/strategic-decisions.md)).
- Ecoma Platform quản trị các nguyên tắc chung của sản phẩm; domain vẫn tự chủ phát triển và vận hành nghiệp vụ trong phạm vi nguyên tắc đã xác lập ([SD-039](decisions/strategic-decisions.md), đọc theo SD-059).

## 4. Ecoma Platform-level Business Concepts

Phần này liệt kê những khái niệm có căn cứ được sở hữu và định nghĩa ở cấp Ecoma Platform, tức những điểm nhất quán được chọn lọc theo SD-005.

- **Account dùng chung xuyên sản phẩm**: một Ecoma Account được dùng làm danh tính xác thực xuyên suốt hai domain ([SD-012](decisions/strategic-decisions.md), [ID-001](decisions/account-identity-decisions.md)).
- **Profile cốt lõi và Personalization dùng chung**: Ecoma Platform sở hữu phần Profile cốt lõi và Personalization dùng chung; domain sở hữu các phần mở rộng Profile phục vụ nghiệp vụ riêng ([SD-013](decisions/strategic-decisions.md)).
- **Provider Identity đăng ký một lần**: Provider đăng ký danh tính với Ecoma một lần và có thể tham gia cung ứng trên cả hai domain mà không phải đăng ký lại danh tính ([SD-018](decisions/provider-decisions.md)).
- **Vai trò thương mại của Ecoma với Consumer**: Ecoma luôn là chủ thể có quan hệ thương mại trực tiếp với Consumer ([SD-035](decisions/strategic-decisions.md)); Consumer thanh toán thông qua Ecoma và Ecoma quản lý dòng tiền ([SD-015](decisions/provider-decisions.md)); phạm vi cam kết do từng domain quyết định ([SD-036](decisions/strategic-decisions.md)).
- **Thời hạn Invitation chung**: Ecoma định nghĩa một thời hạn hết hạn chung cho Invitation ([INV-005](decisions/invitation-decisions.md)); **giá trị thời hạn cụ thể chưa được quyết định**.
- **Nguyên tắc và năng lực nền tảng bắt buộc**: Ecoma Platform quản trị các nguyên tắc chung và năng lực nền tảng bắt buộc thống nhất ([SD-030](decisions/strategic-decisions.md)); các năng lực vận hành dùng chung được tổ chức ở cấp platform ([SD-040](decisions/strategic-decisions.md)); danh sách các quy tắc được thống nhất tuân theo nguyên tắc chọn lọc ([SD-005](decisions/strategic-decisions.md)).

Lưu ý quan trọng: danh sách trên là danh sách đóng theo căn cứ hiện có. **Chia sẻ kỹ thuật (năng lực nền tảng dùng chung) không đồng nghĩa với hợp nhất business ownership** ([SD-004](decisions/strategic-decisions.md)): một năng lực được cung ứng ở cấp Platform không biến policy của domain thành policy của Ecoma Platform.

## 5. Account and Identity

Phần này mô tả Account và các quyết định về danh tính xác thực, cùng ranh giới giữa xác thực và phân quyền.

- **Account là danh tính xác thực xuyên suốt sản phẩm**: một Ecoma Account duy nhất dùng để xác thực trên cả hai domain ([ID-001](decisions/account-identity-decisions.md), [SD-012](decisions/strategic-decisions.md)).
- **Quyền truy cập do từng domain quyết định**: xác thực thành công **không mặc nhiên cấp quyền truy cập** vào bất kỳ domain nào; quyền và quyền hạn do từng domain quyết định ([ID-001](decisions/account-identity-decisions.md); ranh giới Authentication ≠ Authorization, Domain Boundary 8).
- **Passwordless**: hệ thống sử dụng xác thực không mật khẩu và không lưu trữ mật khẩu người dùng ([ID-004](decisions/account-identity-decisions.md)).
- **Chuẩn tích hợp**: tích hợp danh tính ưu tiên các chuẩn OIDC, OAuth2, JWKS, MFA và cơ chế quản lý token theo tiêu chuẩn ([ID-002](decisions/account-identity-decisions.md)).
- **Email OTP**: Email OTP chỉ chứng minh người dùng **kiểm soát địa chỉ email** tại thời điểm xác minh; không chứng minh danh tính pháp lý hoặc danh tính con người ([ID-005](decisions/account-identity-decisions.md)).
- **Email duy nhất per Account**: một địa chỉ email chỉ được liên kết với tối đa một Account tại cùng một thời điểm ([ID-006](decisions/account-identity-decisions.md)).
- **Đổi email có xác minh**: User có thể thay đổi email Account; email mới chỉ được xác minh sau khi hoàn thành OTP và không được đang thuộc Account khác ([ID-007](decisions/account-identity-decisions.md)).
- **Application/Agent ủy quyền**: Application, Agent và workload máy không phải chủ thể nghiệp vụ độc lập; chúng hành động thay mặt một chủ thể hiện có (Account, Consumer Organization, Provider) qua ủy quyền OAuth2 với scope giới hạn hoặc API key scoped, trách nhiệm và quyền truy vết quy về chủ thể ủy quyền ([ID-003](decisions/account-identity-decisions.md), [ID-013](decisions/account-identity-decisions.md)).
- **Vòng đời Account độc lập với Organization**: vòng đời Account không phụ thuộc vòng đời bất kỳ Organization nào ([ID-009](decisions/account-identity-decisions.md)).
- **Xóa Account theo điều kiện tiên quyết**: Account chỉ được xóa khi không còn sở hữu Organization nào (điều kiện xóa Org do từng domain quy định), đã chấm dứt Individual Provider Identity, đã xử lý xong số dư tài chính và không giữ vai trò Owner trong Organization Provider nào ([ID-014](decisions/account-identity-decisions.md)); Org mà Account chỉ là Member không chặn việc xóa, và Membership của Account kết thúc tự động khi Account bị xóa ([ID-010](decisions/account-identity-decisions.md)).

## 6. Consumer Organization

Phần này mô tả Consumer Organization — chủ thể sử dụng sản phẩm và chịu nghĩa vụ thương mại phía tiêu dùng.

> **Phạm vi của phần này: chỉ áp dụng cho Consumer Organization.** Theo Domain Boundary 2, các quyết định ORG và mô hình Owner/Member ở đây **không áp dụng mặc định** cho Provider hoặc Organization Provider.

- **Domain-scoped**: mỗi domain tự sở hữu mô hình, chính sách và vòng đời Consumer Organization của mình; Consumer Organization ở các domain khác nhau **không mặc nhiên là cùng một entity** ([ORG-001](decisions/consumer-organization-decisions.md)).
- **Personal/Business dùng chung mô hình**: Personal Organization và Business Organization không bắt buộc là hai loại entity khác nhau; có thể dùng chung mô hình sở hữu nhưng có chính sách thành viên khác nhau ([ORG-002](decisions/consumer-organization-decisions.md)).
- **Chủ thể tài nguyên và nghĩa vụ thương mại**: Consumer Organization sở hữu tài nguyên và là chủ thể chịu các nghĩa vụ thương mại trong phạm vi sản phẩm ([ORG-003](decisions/consumer-organization-decisions.md)).
- **Tài chính thuộc Organization**: số dư tài chính và phương thức thanh toán thuộc Consumer Organization, không nhất thiết thuộc Account cá nhân ([ORG-004](decisions/consumer-organization-decisions.md)); quyền quản lý thanh toán và tài chính có thể được ủy quyền cho người khác, không bắt buộc thuộc Owner ([ORG-005](decisions/consumer-organization-decisions.md)).
- **Chính sách thương mại do domain sở hữu**: chính sách thương mại thuộc từng domain; một Consumer Organization có thể có nhiều Subscription độc lập trong cùng domain ([ORG-006](decisions/consumer-organization-decisions.md)); mô hình thương mại không bị khóa vào PAYG, Freemium hay Subscription ([ORG-007](decisions/consumer-organization-decisions.md)).
- **Không có giới hạn platform-wide**: Ecoma không đặt giới hạn chung về số Consumer Organization một Account có thể sở hữu hoặc tham gia ([ORG-008](decisions/consumer-organization-decisions.md)); giới hạn sở hữu và giới hạn tham gia là hai chính sách độc lập ([ORG-009](decisions/consumer-organization-decisions.md)); điều kiện tạo và giới hạn số lượng do từng domain quyết định theo chính sách thương mại của mình ([ORG-010](decisions/consumer-organization-decisions.md)).
- **Termination**: Owner có thể yêu cầu chấm dứt Consumer Organization bất cứ lúc nào; trạng thái Terminated có hiệu lực ngay lập tức, không phụ thuộc số Member, Invitation hay tài nguyên đang tồn tại ([ORG-011](decisions/consumer-organization-decisions.md)). Khi Terminated:
  - Toàn bộ Membership kết thúc, Pending Invitation bị vô hiệu và mọi quyền truy cập phát sinh từ Organization phải bị **thu hồi ngay** trên cả hai domain ([ORG-013](decisions/consumer-organization-decisions.md), [INV-014](decisions/invitation-decisions.md), [SD-064](decisions/strategic-decisions.md)).
  - Dữ liệu không bị xóa ngay; được lưu giữ theo **chính sách retention của domain** ([ORG-012](decisions/consumer-organization-decisions.md)).
  - **Nghĩa vụ còn tồn tại không bị xóa**: nghĩa vụ tài chính, hợp đồng hoặc pháp lý đã phát sinh trước đó vẫn tiếp diễn ([ORG-014](decisions/consumer-organization-decisions.md)).

Sau termination, các quy tắc nghiệp vụ đã chốt: dữ liệu được lưu giữ theo chính sách retention của domain ([ORG-012](decisions/consumer-organization-decisions.md)) và mọi quyền truy cập phát sinh từ Organization hoặc Membership phải bị thu hồi ngay ([ORG-013](decisions/consumer-organization-decisions.md), [MEM-013](decisions/membership-decisions.md)); cơ chế deprovisioning cụ thể thuộc lớp design.

## 7. Membership and Invitation

Phần này mô tả Membership trong Consumer Organization (Owner, Member, phân quyền) và Invitation — cơ chế hình thành Membership. Cả hai đều thuộc phạm vi domain; phần này vẫn chỉ nói về Consumer Organization (xem cảnh báo ở phần 6).

### 7.1. Owner và quyền sở hữu

- Mỗi Consumer Organization đang hoạt động có **đúng một Owner** ([MEM-001](decisions/membership-decisions.md)).
- Owner giữ **quyền kiểm soát tối cao** bao gồm thành viên, quyền sở hữu, thanh toán, tài chính, cấu hình, tài nguyên và hoạt động; Owner có thể ủy quyền thực hiện một số quyền nhưng không mất quyền kiểm soát tối cao ([MEM-002](decisions/membership-decisions.md)).
- Owner có thể **chuyển quyền sở hữu** cho một Member đủ điều kiện ([MEM-003](decisions/membership-decisions.md)); Owner không thể tự rời hoặc bị loại khi chưa chuyển quyền sở hữu ([MEM-004](decisions/membership-decisions.md)).

### 7.2. Authorization của Member

- Mỗi domain tự định nghĩa Permission, chính sách phân quyền và giá trị mặc định cho Member ([MEM-005](decisions/membership-decisions.md)); Membership và Authorization thuộc phạm vi từng domain ([MEM-010](decisions/membership-decisions.md)).
- **Role dùng chung, Permission theo domain**: tập Role được định nghĩa một lần cấp Ecoma Platform và áp dụng thống nhất cho cả hai domain; Permission gắn theo từng domain — một Member có thể có quyền thao tác trên một domain mà không có trên domain kia ([SD-063](decisions/strategic-decisions.md), đọc lại MEM-005/MEM-010 theo cấp domain).
- Owner và Member được cấp quyền quản lý thành viên có thể quyết định quyền của Member khác **trong phạm vi được cấp** ([MEM-006](decisions/membership-decisions.md)); không thể cấp, thay đổi hoặc thu hồi quyền vượt quá phạm vi quản lý của mình ([MEM-007](decisions/membership-decisions.md)).
- Việc thu hồi quyền quản lý của một Member **không tự động thu hồi** các quyền mà người đó đã cấp trước đó; những quyền này tiếp tục tồn tại cho đến khi một chủ thể có thẩm quyền thay đổi ([MEM-008](decisions/membership-decisions.md)).
- Một Account chỉ có **tối đa một Membership** trong cùng một Consumer Organization; Membership có thể chứa nhiều Role hoặc Permission ([MEM-009](decisions/membership-decisions.md)).

### 7.3. Rời, bị loại và kết thúc Membership

- Member có thể **tự rời** Consumer Organization mà không cần Owner phê duyệt ([MEM-011](decisions/membership-decisions.md)).
- Member đã rời hoặc bị loại có thể được **mời lại ngay**, không có thời gian chờ; Membership mới có vòng đời độc lập ([MEM-012](decisions/membership-decisions.md)).
- Khi Membership kết thúc, **toàn bộ quyền truy cập** phát sinh trực tiếp hoặc gián tiếp từ Membership phải bị thu hồi, bao gồm quyền thông qua session, token hoặc credential phụ thuộc vào Membership ([MEM-013](decisions/membership-decisions.md)).
- Kết thúc Membership **không tự động xóa tài nguyên** do Member tạo; mỗi domain tự quyết định cách xử lý tài nguyên và phụ thuộc liên quan ([MEM-014](decisions/membership-decisions.md)).

### 7.4. Hình thành Membership

Membership hình thành thông qua việc chấp nhận Invitation hoặc các quy trình onboarding khác do domain định nghĩa ([MEM-015](decisions/membership-decisions.md)).

### 7.5. Invitation

- **Ai được tạo và thu hồi**: Owner hoặc Member có quyền quản lý thành viên được phép tạo và thu hồi Invitation trong phạm vi quyền hạn được cấp ([INV-001](decisions/invitation-decisions.md)); thu hồi chỉ áp dụng cho Pending Invitation ([INV-007](decisions/invitation-decisions.md)).
- **Chấp nhận tường minh**: người nhận phải chấp nhận Invitation trước khi trở thành Member ([INV-002](decisions/invitation-decisions.md)).
- **Email chưa đăng ký**: Invitation có thể gửi đến email chưa có Ecoma Account; người nhận có thể đăng ký Account bằng email đó, xác minh OTP rồi chấp nhận ([INV-003](decisions/invitation-decisions.md)).
- **Cố định người nhận**: Invitation gắn cố định với email đích khi tạo, không thể chuyển sang email khác hoặc thay đổi người nhận ([INV-004](decisions/invitation-decisions.md)); việc Account thay đổi email không tự động thay đổi email nhận Invitation ([ID-008](decisions/account-identity-decisions.md)).
- **Thời hạn chung**: Ecoma định nghĩa thời hạn hết hạn chung cho Invitation ([INV-005](decisions/invitation-decisions.md)); **giá trị thời hạn cụ thể chưa được quyết định**.
- **Trạng thái**: Pending, Accepted, Rejected, Expired, Revoked; trạng thái kết thúc không thể quay lại Pending, muốn mời lại phải tạo Invitation mới ([INV-006](decisions/invitation-decisions.md)).
- **Không quota toàn cục**: không áp đặt hạn mức nghiệp vụ toàn cục cho số lượng Pending Invitation; rate limiting và chống lạm dụng vẫn được áp dụng ([INV-008](decisions/invitation-decisions.md)).
- **Độc lập giữa các Organization**: một email có thể nhận nhiều Invitation độc lập từ các Consumer Organization khác nhau ([INV-009](decisions/invitation-decisions.md)); trạng thái kết thúc của một Invitation không ảnh hưởng đến các Invitation độc lập khác ([INV-013](decisions/invitation-decisions.md)).
- **Uniqueness trong Organization**: trong cùng một Consumer Organization, một email chỉ được có tối đa một Pending Invitation và không thể đồng thời là Member và người nhận Pending Invitation ([INV-010](decisions/invitation-decisions.md)).
- **Atomic eligibility**: việc kiểm tra điều kiện và tạo Invitation phải bảo đảm tính nguyên tử để ngăn Invitation trùng lặp do thao tác đồng thời ([INV-011](decisions/invitation-decisions.md)).
- **Re-invitation**: có thể gửi Invitation mới ngay sau khi Invitation trước đó Accepted, Rejected, Expired hoặc Revoked, miễn các điều kiện Membership và Pending Invitation được thỏa mãn ([INV-012](decisions/invitation-decisions.md)).
- **Termination vô hiệu hóa Pending Invitation**: khi Consumer Organization bị Terminated, toàn bộ Pending Invitation phải bị vô hiệu ngay ([INV-014](decisions/invitation-decisions.md)).
- **Chứng minh kiểm soát email khi chấp nhận**: người nhận phải chứng minh quyền kiểm soát chính xác email đích tại thời điểm chấp nhận; việc xác minh email của Account khác hoặc email đó từng được liên kết trước đây không thay thế yêu cầu này ([INV-015](decisions/invitation-decisions.md)).

## 8. Provider Identity and Provider Model

Phần này mô tả Provider — chủ thể cung ứng trong sản phẩm — cùng mô hình danh tính, niềm tin và quan hệ với Consumer. Phần này **không** kế thừa mô hình Owner/Member của Consumer Organization (Domain Boundary 2).

- **Provider là chủ thể cung ứng**: Provider là cá nhân hoặc tổ chức thực sự tham gia cung ứng, gắn với Offering, trách nhiệm cung ứng và quyền lợi, nghĩa vụ thương mại; không chỉ là tài khoản hay gian hàng ([SD-020](decisions/provider-decisions.md)). Provider chịu trách nhiệm đối với phần cung ứng thuộc phạm vi của mình; Ecoma chịu trách nhiệm đối với những cam kết do Ecoma đưa ra ([SD-014](decisions/provider-decisions.md)).
- **Danh tính đăng ký một lần**: Provider đăng ký danh tính với Ecoma một lần và có thể tham gia cung ứng trên cả hai domain mà không phải đăng ký lại ([SD-018](decisions/provider-decisions.md)).
- **Một Account, nhiều vai trò Provider**: một Ecoma Account có thể sở hữu một Individual Provider Identity và đại diện hoặc quản lý nhiều Organization Provider độc lập ([SD-019](decisions/provider-decisions.md)).
- **Ba khái niệm cần phân biệt** (Domain Boundary 3, Domain Boundary 4):
  - **Provider Identity**: danh tính Provider được đăng ký và duy trì xuyên suốt.
  - **Provider Actor**: người hoặc Agent thực hiện thao tác vận hành; Actor tham gia vận hành, không đồng nhất với chủ thể chịu trách nhiệm cung ứng.
  - **Provider Qualification**: tư cách cá nhân/tổ chức và các chính sách tương ứng; tư cách này **có thể thay đổi** qua quá trình Transformation trong khi danh tính được giữ nguyên.
- **Progressive trust**: Provider có thể tham gia với quyền hạn ban đầu giới hạn và được mở rộng theo mức độ xác minh, năng lực và độ tin cậy ([SD-016](decisions/provider-decisions.md)).
- **Cơ chế trust hai giai đoạn**: Provider được **Activated** khi nộp đủ giấy tờ theo nhóm đối tượng (cá nhân: giấy tờ tùy thân; hộ kinh doanh: giấy chứng nhận đăng ký hộ kinh doanh và giấy tờ chủ hộ; doanh nghiệp: giấy chứng nhận đăng ký doanh nghiệp và giấy tờ người đại diện pháp luật) và được cung ứng ngay; trạng thái **Verified** là điều kiện để rút tiền từ Earning balance; Ecoma có thể yêu cầu xác minh bổ sung (ảnh/video cầm giấy tờ) khi phát hiện trùng lặp thông tin hoặc dấu hiệu abuse, kể cả khi đã Verified ([SD-042](decisions/provider-decisions.md)). Quy trình Trust áp dụng cấp Ecoma Platform, dùng chung cho cả hai domain, domain không yêu cầu xác minh lại ([SD-042](decisions/provider-decisions.md), [SD-018](decisions/provider-decisions.md)).
- **Organization Provider có đúng một Owner** và được phép có nhiều Member, mỗi Membership đi kèm danh sách quyền ([SD-043](decisions/provider-decisions.md)).
- **Provider ≠ Consumer Organization**: hai khái niệm nghiệp vụ độc lập, có mục đích, chính sách, quyền hạn và vòng đời riêng ([SD-017](decisions/provider-decisions.md)); chi tiết ở phần 15.
- **Flexible supply**: Provider có thể cung cấp tài nguyên đầu vào hoặc dịch vụ thành phần, tùy theo domain và Offering ([SD-033](decisions/strategic-decisions.md)).
- **Dual offering ownership**: cả Provider-owned Offering và Product-owned Offering đều được hỗ trợ; chủ thể sở hữu Offering phụ thuộc mô hình kinh doanh của từng Product ([SD-034](decisions/strategic-decisions.md)).
- **Cam kết với Consumer**: Ecoma luôn là chủ thể có quan hệ thương mại trực tiếp với Consumer, kể cả khi Offering thuộc sở hữu của Provider ([SD-035](decisions/strategic-decisions.md)); phạm vi cam kết dịch vụ của Ecoma do domain quyết định ([SD-036](decisions/strategic-decisions.md)).

Các quy tắc membership bên trong Organization Provider (Owner đầu tiên, chuyển giao quyền sở hữu, rời/bị loại, mời lại) đã được quyết định tại [SD-050](decisions/provider-decisions.md). Nội dung governance mặc định và bộ tiêu chí Verified mặc định do Ecoma Platform sở hữu và bảo trì qua Decision Process (SD-040/SD-046); khung Verified đã chốt tại [SD-047](decisions/strategic-decisions.md) và phần discovery đã đóng (BL-25); quy trình chi tiết thuộc lớp design. Chi tiết khác tại [provider decisions](decisions/provider-decisions.md).

## 9. Provider Transformation

Phần này mô tả việc chuyển đổi tư cách Provider giữa Individual Provider và Organization Provider, và những gì được bảo toàn trong quá trình chuyển đổi.

- **Giữ nguyên Provider Identity**: khi một Individual Provider chuyển đổi thành Organization Provider, danh tính Provider được giữ nguyên thay vì tạo Provider mới ([SD-021](decisions/provider-decisions.md)).
- **Hai chiều**: Provider hỗ trợ chuyển đổi cả hai hướng giữa Individual Provider và Organization Provider ([SD-024](decisions/provider-decisions.md)).
- **Xác minh và phê duyệt**: chuyển đổi chỉ có hiệu lực sau khi được xác minh và phê duyệt; trong thời gian chờ, Provider tiếp tục hoạt động theo trạng thái và chính sách hiện hành ([SD-026](decisions/provider-decisions.md)).
- **Những gì được bảo toàn qua chuyển đổi**:
  - **Continuity vận hành**: quá trình chuyển đổi không làm gián đoạn hoặc thay đổi hoạt động cung cấp dịch vụ hiện hữu ([SD-025](decisions/provider-decisions.md)).
  - **Founder management continuity**: Account của người sáng lập tiếp tục là người quản lý mặc định và có thể ủy quyền quản lý cho người khác; quyền quản lý này **không đồng nghĩa** với việc người sáng lập tiếp tục là chủ thể chịu trách nhiệm pháp lý hoặc thương mại ([SD-022](decisions/provider-decisions.md)).
  - **Historical Obligations**: lịch sử và nghĩa vụ đã phát sinh được bảo toàn, xử lý theo trạng thái và chính sách có hiệu lực tại thời điểm phát sinh ([SD-023](decisions/provider-decisions.md)).
  - **Status-bound balances**: mỗi khoản số dư và quyền lợi tài chính được phân loại theo trạng thái Provider tại thời điểm phát sinh và tiếp tục tuân theo chính sách tương ứng sau chuyển đổi ([SD-027](decisions/provider-decisions.md)).
  - **Offering continuity**: chuyển đổi trạng thái Provider không yêu cầu tạo lại, chuyển giao hoặc xác minh lại các Offering hiện hữu chỉ vì thay đổi trạng thái ([SD-028](decisions/provider-decisions.md)).
- **Hai ranh giới kèm theo** (Domain Boundary 5, Domain Boundary 6):
  - **Provider Transformation ≠ Provider Operations Migration**: chuyển đổi tư cách Provider không đồng nghĩa chuyển đổi hoặc tạo lại các hoạt động cung cấp dịch vụ.
  - **Historical Obligations ≠ Current Provider Policy**: nghĩa vụ đã phát sinh không bị thay đổi chỉ vì Provider chuyển sang tư cách mới.

## 10. Offering and Service Supply

Phần này mô tả Offering — đối tượng được cung cấp — và quan hệ của nó với Provider và domain.

- **Offering là đối tượng cung ứng**: Offering là thứ được đưa vào cung ứng cho Consumer, do Provider (Provider-owned) hoặc Product (Product-owned) sở hữu tùy mô hình kinh doanh của Product ([SD-034](decisions/strategic-decisions.md)).
- **Đầu vào linh hoạt**: Provider có thể cung cấp tài nguyên đầu vào hoặc dịch vụ thành phần, tùy theo domain và Offering ([SD-033](decisions/strategic-decisions.md)).
- **Offering ≠ Provider Identity**: Offering là đối tượng ở cấp vận hành; thay đổi tư cách Provider không làm gián đoạn Offering (Domain Boundary 7).
- **Chuyển đổi Provider không yêu cầu tạo lại Offering**: Offering hiện hữu không cần tạo lại, chuyển giao hay xác minh lại chỉ vì Provider đổi trạng thái ([SD-028](decisions/provider-decisions.md)).
- **Provider điều khiển vòng đời Offering**: Offering được tạo cùng Provider; thay đổi, tạm dừng và xóa bỏ do Provider quyết định; vòng đời không đổi khi Provider chuyển đổi tư cách ([SD-044](decisions/provider-decisions.md)). Vòng đời Product-owned Offering thuộc chính sách cấp 3 của domain theo test SD-046; hiện cả hai domain đều đóng vai trò trung gian Marketplace với Offering thuộc sở hữu Provider theo [SD-058](decisions/strategic-decisions.md) (giữ phần vai trò của SD-054), nên vòng đời này chưa phát sinh trong sản phẩm. Bảo vệ Consumer khi Provider tự ý tạm dừng hoặc xóa Offering đã chốt: phần đã bảo đảm nguồn được hoàn tất theo [FIN-007](decisions/financial-decisions.md), reservation được giải phóng về Usage balance theo [FIN-009](decisions/financial-decisions.md), không hoàn tiền theo [FIN-001](decisions/financial-decisions.md), nghĩa vụ lịch sử bảo toàn theo [SD-023](decisions/provider-decisions.md), vi phạm cam kết xử lý theo [SD-014](decisions/provider-decisions.md) và [SD-048](decisions/strategic-decisions.md).

## 11. Marketplace and Commercial Relationships

Phần này mô tả vai trò thương mại của Ecoma trong việc kết nối Provider và Consumer, và các chủ thể nghĩa vụ thương mại.

- **Vai trò lai của Ecoma**: Ecoma có thể đóng vai trò trung gian Marketplace hoặc nhà cung cấp dịch vụ tổng hợp, tùy theo mô hình kinh doanh của từng domain; trách nhiệm và phạm vi cam kết được xác định theo từng domain ([SD-029](decisions/strategic-decisions.md)). Vai trò của hai domain hiện tại đã được gán tại [SD-054](decisions/strategic-decisions.md) (đọc lại theo SD-058/SD-059): cả Domain LLM và Domain GPU đều đóng vai trò trung gian Marketplace.
- **Thanh toán qua Ecoma**: Consumer thanh toán thông qua Ecoma; Ecoma quản lý dòng tiền, nghĩa vụ tài chính và việc thanh toán cho Provider ([SD-015](decisions/provider-decisions.md)). **Tư cách pháp lý Merchant of Record chưa được xác định** ([SD-015](decisions/provider-decisions.md)).
- **Hai loại balance và chu kỳ settlement**: Ecoma duy trì **Usage balance** của Consumer Organization (nạp vào dùng để thanh toán dịch vụ; sau khi nạp không hoàn trả) và **Earning balance** của Provider (cộng realtime theo mức sử dụng của Consumer, chốt cuối tháng, available = số dư trừ thuế và phí, rút được sau 20 ngày, có thể chuyển sang Usage balance kèm phí và không chịu thuế) ([FIN-001](decisions/financial-decisions.md), [FIN-002](decisions/financial-decisions.md)); việc rút hoặc chuyển phải do Owner hoặc người được cấp quyền rút tiền thực hiện ([FIN-002](decisions/financial-decisions.md)); Earning balance chưa rút bị mất khi Provider bị terminate ([FIN-003](decisions/financial-decisions.md)).
- **Dòng tiền hoa hồng**: Ecoma thu tiền từ Consumer, trừ các khoản hoa hồng và thuế phí, rồi thanh toán cho Provider ([FIN-005](decisions/financial-decisions.md)); cơ chế balance dùng chung cấp Ecoma Platform, domain được phép thay bằng mô hình riêng ([FIN-004](decisions/financial-decisions.md)).
- **Ecoma luôn là chủ thể thương mại trực tiếp với Consumer**: điều này giữ đúng kể cả khi Offering thuộc sở hữu của Provider ([SD-035](decisions/strategic-decisions.md)); phạm vi cam kết dịch vụ của Ecoma với Consumer do domain quyết định ([SD-036](decisions/strategic-decisions.md)).
- **Consumer Organization là chủ thể nghĩa vụ phía tiêu dùng**: Consumer Organization sở hữu tài nguyên và chịu các nghĩa vụ thương mại trong phạm vi sản phẩm ([ORG-003](decisions/consumer-organization-decisions.md)); số dư và phương thức thanh toán thuộc Consumer Organization ([ORG-004](decisions/consumer-organization-decisions.md)); chính sách thương mại (bao gồm Subscription) do domain sở hữu ([ORG-006](decisions/consumer-organization-decisions.md)).
- **Provider chịu trách nhiệm phần cung ứng của mình**: trách nhiệm được chia theo nguồn cam kết — Provider với phần cung ứng thuộc phạm vi của mình, Ecoma với những cam kết do Ecoma đưa ra ([SD-014](decisions/provider-decisions.md)).
- Chargeback trên tiền nạp đã được chốt tại [FIN-009](decisions/financial-decisions.md); tiền nạp không hoàn trả theo [FIN-001](decisions/financial-decisions.md); settlement đã được chốt tại [FIN-002](decisions/financial-decisions.md); còn danh mục thuế phí và giá trị phí chuyển đổi Earning → Usage — xem [Discovery Backlog](discovery-backlog.md).

Mô hình domain riêng của Domain LLM — domain cung ứng trung gian Marketplace đầu tiên được discovery — được tổng hợp tại phần 12.

## 12. Domain LLM

Phần này tổng hợp mô hình domain của Domain LLM — domain cung ứng đầu tiên được discovery. Các quyết định LLM-001–LLM-033 là quyết định cấp domain theo SD-059 (đọc lại từ cấp Product theo SD-030 và cơ chế phân cấp SD-046): chúng điều tiết các mặc định Ecoma Platform đã chốt trong các register khác cho domain này, không thay thế các quyết định đó.

### 12.1. Vai trò và phạm vi cam kết

- **Trung gian Marketplace thuần túy**: Ecoma không tự huấn luyện và không sở hữu model nền tảng; mọi Offering do Provider cung ứng; không tồn tại Product-owned Offering trong domain này ([LLM-002](decisions/llm-marketplace-decisions.md), theo hướng sở hữu của [SD-034](decisions/strategic-decisions.md) và vai trò trung gian của [SD-054](decisions/strategic-decisions.md), đọc lại theo SD-058).
- **Gateway serving**: mọi request inference đi qua hạ tầng Ecoma — authentication, admission, routing, provider dispatch, usage metering và financial settlement đều do Ecoma thực hiện; đây là khai báo phạm vi cam kết của Ecoma với Consumer theo [SD-036](decisions/strategic-decisions.md) ([LLM-001](decisions/llm-marketplace-decisions.md)). Hệ quả: Ecoma giữ credential upstream do Provider cung cấp và tự đo usage từ response upstream, không phụ thuộc báo cáo của Provider.
- **API công khai tương thích OpenAI**: một ứng dụng dùng OpenAI SDK chuyển sang Ecoma bằng đổi base URL và credential; tương thích giao thức không đồng nghĩa cam kết hỗ trợ toàn bộ tính năng OpenAI ([LLM-003](decisions/llm-marketplace-decisions.md)).

### 12.2. Offering và routing

- **Cấu trúc Offering**: model, capability, giá và trạng thái; endpoint và credential là tài nguyên riêng được Offering tham chiếu ([LLM-004](decisions/llm-marketplace-decisions.md)); vòng đời `draft` → `active` → `inactive` → `retired` do Provider điều khiển ([LLM-005](decisions/llm-marketplace-decisions.md), điều tiết [SD-044](decisions/provider-decisions.md)); Ecoma verify endpoint trước khi Offering áp dụng và verify lại sau mỗi lần Provider cập nhật ([LLM-028](decisions/llm-marketplace-decisions.md)).
- **Không chuẩn hóa model xuyên provider**: Consumer lựa chọn và so sánh theo từng Offering; routing làm việc trực tiếp trên Offering, không qua danh tính model chuẩn hóa ([LLM-006](decisions/llm-marketplace-decisions.md)).
- **Endpoint pool và health**: một Offering tham chiếu nhiều upstream endpoint (chính, dự phòng, theo khu vực), mỗi endpoint có trạng thái `healthy`/`degraded`/`down`; thứ tự ưu tiên và cấu hình fallback do Provider thiết lập ([LLM-007](decisions/llm-marketplace-decisions.md)).
- **Model Alias thuộc Consumer**: tên logic của riêng Consumer, ánh xạ đến danh sách candidate Offering kèm routing policy; Consumer thay đổi alias hoặc policy mà không phụ thuộc Provider ([LLM-008](decisions/llm-marketplace-decisions.md)).
- **Routing strategy Consumer chọn**: `priority`, `round_robin`, `weighted`, `lowest customer price`; diễn giải [SD-049](decisions/strategic-decisions.md) áp dụng tại domain này: SD-049 cấm yếu tố thương mại phía Ecoma điều routing, còn tiêu chí Consumer tự chọn — kể cả giá — là quyền nghiệp vụ của Consumer ([LLM-009](decisions/llm-marketplace-decisions.md)).
- **Fallback và retry an toàn**: hai cấp (endpoint khác trong cùng Offering, sau đó Offering khác trong danh sách candidate) với ba bất biến — không blind retry, không chuyển provider khi dữ liệu đầu ra đã stream tới client, usage theo attempt chỉ phục vụ kiểm toán và đối soát ([LLM-010](decisions/llm-marketplace-decisions.md)).

### 12.3. Usage, giá và kiểm soát tiêu dùng

- **Usage chuẩn hóa**: năm thành phần `input_tokens`, `output_tokens`, `cached_tokens`, `reasoning_tokens`, `request_count`; cached tokens là tập con của input, reasoning tokens là tập con của output, không cộng trùng ([LLM-011](decisions/llm-marketplace-decisions.md)). Dữ liệu usage của một request thuộc một trong bốn trạng thái `known`/`missing`/`malformed`/`partial`; thiếu dữ liệu không được hiểu là 0 token ([LLM-012](decisions/llm-marketplace-decisions.md)).
- **Giá đa thành phần**: phí theo request và giá theo token cho input, output, cached, reasoning — đối chiếu 1-1 với usage components ([LLM-013](decisions/llm-marketplace-decisions.md)); bảng giá phân biệt peak/off-peak ([LLM-014](decisions/llm-marketplace-decisions.md)); bảng giá versioned, mỗi request gắn snapshot bảng giá tại thời điểm tạo ([LLM-015](decisions/llm-marketplace-decisions.md)).
- **Admission control trước dispatch**: kiểm tra quota, xác định giá, tính cận trên chi phí có thể phát sinh, kiểm tra số dư và giữ trước khoản tương ứng; charge không được vượt phần đã giữ trước, phần giữ dư được giải phóng sau khi quyết toán theo chi phí thực tế ([LLM-016](decisions/llm-marketplace-decisions.md) — hiện thực [FIN-007](decisions/financial-decisions.md)).
- **Reservation duy nhất**: ước lượng giá (cận trên chi phí) của request trước khi dispatch; khoản ước lượng được kiểm tra đồng thời với Usage balance (ngăn âm balance) và limit còn lại ở cấp Workspace và API key ([LLM-029](decisions/llm-marketplace-decisions.md)); thiếu ở bất kỳ ràng buộc nào thì từ chối khởi phát ([LLM-031](decisions/llm-marketplace-decisions.md), thay thế LLM-017).
- **Quyết toán tài chính**: một logical request bị charge đúng một lần, bất kể số provider attempt ([LLM-018](decisions/llm-marketplace-decisions.md)); sổ ghi kép là nguồn chân lý tài chính, số dư suy ra từ lịch sử ledger ([LLM-019](decisions/llm-marketplace-decisions.md)); refund chỉ là hiệu chỉnh kế toán — sửa sai số, đối soát, xử lý chargeback — không hoàn tiền về rail thanh toán ([LLM-020](decisions/llm-marketplace-decisions.md), nhất quán [FIN-001](decisions/financial-decisions.md)). Wallet trong domain này là hiện thực của Usage balance theo [FIN-001](decisions/financial-decisions.md) và [FIN-006](decisions/financial-decisions.md) ([LLM-019](decisions/llm-marketplace-decisions.md)). Ecoma không duy trì dữ liệu chi phí upstream; doanh thu lấy từ hoa hồng trên giá bán ([LLM-030](decisions/llm-marketplace-decisions.md)).

### 12.4. Consumer side: Workspace và API Key

- **Workspace**: Consumer Organization có thêm cấp Workspace bên dưới Organization; một Organization có nhiều Workspace; phân quyền của Member và quota có thể giới hạn theo Workspace; cấu trúc Owner/Membership không đổi ([LLM-021](decisions/llm-marketplace-decisions.md)). Một Workspace áp limit tiêu dùng riêng cho từng domain — limit Domain LLM và limit Domain GPU độc lập ([SD-062](decisions/strategic-decisions.md)); limit Domain GPU chỉ áp dụng ở cấp Workspace vì Domain GPU không dùng API key.
- **API Key**: API key là credential riêng của Domain LLM; Domain GPU không dùng API key — Consumer truy cập instance GPU qua SSH với keypair đưa vào tại thời điểm provision ([SD-061](decisions/strategic-decisions.md)). Consumer quản lý vòng đời (cấp cho ứng dụng, xác thực trên mỗi request, thu hồi); mỗi request được gắn với Organization và API key tương ứng; API key là credential scoped hành động thay mặt chủ thể ủy quyền theo [ID-013](decisions/account-identity-decisions.md) ([LLM-022](decisions/llm-marketplace-decisions.md)). API key gắn với một Workspace; giới hạn tiêu dùng áp dụng ở hai cấp Workspace và API key, do Owner và Member được cấp quyền đặt và quản lý ([LLM-029](decisions/llm-marketplace-decisions.md), [LLM-033](decisions/llm-marketplace-decisions.md)). Plaintext của API key chỉ xuất hiện đúng một lần khi bootstrap; lưu trữ duy nhất dạng hash; key đã revoke bị chặn vĩnh viễn ([LLM-025](decisions/llm-marketplace-decisions.md)).

### 12.5. Provider side: governance và First-Party Provider

- **Governance operations**: hồ sơ pháp lý, hồ sơ thuế, xác minh tài liệu, quản lý trạng thái đủ điều kiện kinh doanh, restriction và khiếu nại — vận hành theo khung trust hai giai đoạn ([LLM-023](decisions/llm-marketplace-decisions.md), [SD-042](decisions/provider-decisions.md), [SD-047](decisions/strategic-decisions.md)) và đình chỉ lan truyền theo phân loại vi phạm ([SD-048](decisions/strategic-decisions.md)).
- **First-Party Provider**: Provider do Ecoma vận hành là hạng riêng vĩnh viễn trong domain này — không trải progressive trust (ngoại lệ có cơ sở của [SD-016](decisions/provider-decisions.md)/[SD-047](decisions/strategic-decisions.md) trong phạm vi domain), không tích lũy payable và không có payout, vị trí đặc biệt (nếu có) chỉ nằm ở Discovery & Display theo [SD-049](decisions/strategic-decisions.md); vẫn được đo và công khai metric như Provider khác theo [SD-045](decisions/provider-decisions.md) ([LLM-024](decisions/llm-marketplace-decisions.md)).

### 12.6. Bảo mật dữ liệu

- **Credential upstream**: phân biệt theo Provider và upstream provider; database chỉ lưu hash, plaintext nằm trong cấu hình triển khai/secret; rotation phải thu hồi credential cũ ([LLM-026](decisions/llm-marketplace-decisions.md)).
- **Không ghi prompt và response body**: journal chỉ ghi metadata, trạng thái thực thi, usage và kết quả xử lý ([LLM-027](decisions/llm-marketplace-decisions.md)).

Vòng đời request inference (auth → routing → admission → dispatch → settlement) được mô tả tại [LLM Request Lifecycle](business-processes/llm-request-lifecycle.md).

## 13. Ecoma Platform Governance and Operations

Phần này tổng hợp cách Ecoma quản trị nền tảng dùng chung và tổ chức năng lực chung.

- **Hybrid governance**: Ecoma Platform quản trị các nguyên tắc và năng lực nền tảng bắt buộc thống nhất; domain tự chủ quyết định mô hình kinh doanh, quan hệ thương mại, pricing, SLA và trách nhiệm dịch vụ trong phạm vi nguyên tắc chung ([SD-030](decisions/strategic-decisions.md)).
- **Sách lược cấp sản phẩm**: Ecoma Platform quản trị chiến lược và vòng đời toàn sản phẩm — phát triển, mở rộng, hợp nhất, thay thế và ngừng năng lực; domain tự chủ phát triển và vận hành trong phạm vi chiến lược đã xác lập ([SD-039](decisions/strategic-decisions.md), đọc theo SD-059).
- **Federated operations**: năng lực vận hành dùng chung được tổ chức ở cấp Ecoma Platform; quyền sở hữu và hoạt động vận hành đặc thù duy trì tại từng domain ([SD-040](decisions/strategic-decisions.md)).
- **Selective consistency**: chỉ thống nhất quy tắc và năng lực cần thiết toàn sản phẩm; không áp đặt nhất quán cho mọi nghiệp vụ ([SD-005](decisions/strategic-decisions.md)).
- **Shared capabilities không sở hữu business policy của domain**: năng lực dùng chung được cung cấp ở cấp Platform, nhưng việc chia sẻ kỹ thuật không hợp nhất quyền sở hữu nghiệp vụ ([SD-004](decisions/strategic-decisions.md)).

## 14. Cross-domain Relationships

Phần này liệt kê các quan hệ nghiệp vụ chính giữa các khái niệm, mỗi quan hệ có căn cứ từ quyết định hoặc ranh giới đã xác lập.

- **Account — Membership — Consumer Organization**: một Account tham gia Consumer Organization thông qua tối đa một Membership trong từng Organization ([MEM-009](decisions/membership-decisions.md)); Membership hình thành qua Invitation hoặc onboarding do domain định nghĩa ([MEM-015](decisions/membership-decisions.md)); Membership và Authorization thuộc phạm vi từng domain ([MEM-010](decisions/membership-decisions.md), [ORG-001](decisions/consumer-organization-decisions.md)).
- **Account — Provider Identity**: một Account có thể sở hữu một Individual Provider Identity và đại diện hoặc quản lý nhiều Organization Provider độc lập ([SD-019](decisions/provider-decisions.md)); quan hệ này khác về bản chất với quan hệ Account—Consumer Organization (Domain Boundary 2).
- **Invitation — Membership — Account**: Invitation gắn cố định với email đích và không đổi khi Account đổi email ([ID-008](decisions/account-identity-decisions.md), [INV-004](decisions/invitation-decisions.md)); email đích có thể chưa có Account ([INV-003](decisions/invitation-decisions.md)); người nhận phải chứng minh kiểm soát email đích tại thời điểm chấp nhận ([INV-015](decisions/invitation-decisions.md)); chấp nhận Invitation tạo Membership ([INV-002](decisions/invitation-decisions.md), [MEM-015](decisions/membership-decisions.md)).
- **Provider — Offering — Marketplace — Consumer**: Provider cung ứng Offering (tài nguyên đầu vào hoặc dịch vụ thành phần) ([SD-033](decisions/strategic-decisions.md)); Offering do Provider sở hữu trên cả hai domain ([SD-034](decisions/strategic-decisions.md), đọc theo [SD-058](decisions/strategic-decisions.md)); qua marketplace của từng domain, Consumer được Ecoma phục vụ với tư cách chủ thể thương mại trực tiếp ([SD-035](decisions/strategic-decisions.md)), thanh toán qua Ecoma ([SD-015](decisions/provider-decisions.md)), trong khi Consumer Organization là chủ thể nghĩa vụ phía tiêu dùng ([ORG-003](decisions/consumer-organization-decisions.md)).
- **Provider Transformation với Offering và balances**: chuyển đổi tư cách giữ nguyên Offering và hoạt động cung ứng ([SD-025](decisions/provider-decisions.md), [SD-028](decisions/provider-decisions.md)), bảo toàn historical obligations và phân loại số dư theo trạng thái tại thời điểm phát sinh ([SD-023](decisions/provider-decisions.md), [SD-027](decisions/provider-decisions.md)).
- **Account lifecycle độc lập với Organization lifecycle**: vòng đời Account không phụ thuộc vòng đời Organization ([ID-009](decisions/account-identity-decisions.md)); ngược lại, termination của Consumer Organization làm kết thúc Membership, vô hiệu Invitation và thu hồi truy cập nhưng không xóa Account và không xóa nghĩa vụ đã phát sinh ([ORG-013](decisions/consumer-organization-decisions.md), [ORG-014](decisions/consumer-organization-decisions.md)).
- **Account closure chốt chuỗi Org deletion — balances**: Account chỉ bị xóa sau khi các Org sở hữu bị xóa theo điều kiện của từng domain, Individual Provider Identity chấm dứt và số dư xử lý xong (dùng hết usage, rút hết earning), không giữ vai trò Owner trong Organization Provider nào ([ID-010](decisions/account-identity-decisions.md), [ID-014](decisions/account-identity-decisions.md), [FIN-003](decisions/financial-decisions.md)); Membership trong các Org user là Member kết thúc tự động khi Account bị xóa ([MEM-013](decisions/membership-decisions.md)).
- **Provider Trust điều kiện rút tiền**: trạng thái Verified của Provider là điều kiện để rút Earning balance; trust tính theo Provider Identity cấp Ecoma Platform, không theo từng domain ([SD-042](decisions/provider-decisions.md), [FIN-002](decisions/financial-decisions.md)).
- **Authentication — Authorization**: một Account được xác thực xuyên suốt sản phẩm nhưng quyền truy cập và quyền hạn do từng domain quyết định ([ID-001](decisions/account-identity-decisions.md), [SD-012](decisions/strategic-decisions.md)).

## 15. Explicit Domain Boundaries

Phần này ghi lại tám ranh giới nghiệp vụ đã được xác lập, được tham chiếu ở các tài liệu khác dưới dạng Domain Boundary 1–8. Đây là những hệ quả bắt buộc phải giữ nhất quán khi sử dụng các quyết định đã ghi nhận.

1. **Account ≠ Consumer Organization ≠ Provider.** Account đại diện cho danh tính xác thực; Consumer Organization là chủ thể sử dụng sản phẩm; Provider là chủ thể cung cấp dịch vụ. Ba vai trò có thể cùng tồn tại trên một Account ([SD-019](decisions/provider-decisions.md), [ORG-008](decisions/consumer-organization-decisions.md), [MEM-009](decisions/membership-decisions.md)) nhưng không hợp nhất thành một khái niệm.
2. **Consumer Organization ≠ Organization Provider.** Hai khái niệm có mục đích, trách nhiệm và vòng đời riêng ([SD-017](decisions/provider-decisions.md)). **Cảnh báo**: không được áp dụng máy móc mô hình Owner/Member của Consumer Organization sang Provider.
3. **Provider Identity ≠ Provider Actor.** Provider là chủ thể chịu trách nhiệm cung cấp dịch vụ; người hoặc Agent thực hiện thao tác là Actor tham gia vận hành. Quyền quản lý cũng không đồng nhất với trách nhiệm pháp lý/thương mại ([SD-022](decisions/provider-decisions.md)).
4. **Provider Identity ≠ Provider Qualification.** Danh tính Provider được duy trì xuyên suốt; tư cách cá nhân/tổ chức và chính sách tương ứng có thể thay đổi qua Transformation ([SD-021](decisions/provider-decisions.md), [SD-024](decisions/provider-decisions.md)).
5. **Provider Transformation ≠ Provider Operations Migration.** Chuyển đổi tư cách Provider không đồng nghĩa chuyển đổi hoặc tạo lại các hoạt động cung cấp dịch vụ ([SD-025](decisions/provider-decisions.md)).
6. **Historical Obligations ≠ Current Provider Policy.** Nghĩa vụ đã phát sinh không bị thay đổi chỉ vì Provider chuyển sang tư cách mới; xử lý theo trạng thái và chính sách có hiệu lực tại thời điểm phát sinh ([SD-023](decisions/provider-decisions.md), [SD-027](decisions/provider-decisions.md)).
7. **Offering ≠ Provider Identity.** Offering là đối tượng ở cấp vận hành; thay đổi tư cách Provider không làm gián đoạn Offering ([SD-028](decisions/provider-decisions.md)).
8. **Authentication ≠ Authorization.** Xác thực Account thành công không mặc nhiên cấp quyền sử dụng sản phẩm hoặc quản lý Provider ([ID-001](decisions/account-identity-decisions.md), [SD-012](decisions/strategic-decisions.md)).

## 16. Unresolved Domain Questions

Phần này liệt kê các chủ đề domain chưa có kết luận. Danh sách đây chỉ ghi nhận trạng thái; **không câu hỏi nào được trả lời ở đây** và không câu hỏi nào được coi là đã quyết định. Theo dõi chi tiết tại [Discovery Backlog](discovery-backlog.md).

- Tư cách pháp lý Merchant of Record ([SD-015](decisions/provider-decisions.md)).
- Danh mục thuế phí và giá trị phí chuyển đổi Earning → Usage trong settlement (settlement đã chốt theo [FIN-002](decisions/financial-decisions.md); refund và chargeback đã chốt theo [FIN-001](decisions/financial-decisions.md), [FIN-009](decisions/financial-decisions.md)).
- Danh mục nguyên nhân Account suspension (cơ chế suspension lan theo quyền sở hữu đã chốt theo [ID-011](decisions/account-identity-decisions.md); closure đã chốt theo [ID-010](decisions/account-identity-decisions.md)).
- Tiêu chuẩn Provider Evaluation & Certification theo từng domain và điều kiện đình chỉ, khôi phục, thu hồi chứng nhận (khung phân cấp tiêu chí đã chốt theo [SD-047](decisions/strategic-decisions.md), đình chỉ lan truyền theo phân loại vi phạm đã chốt theo [SD-048](decisions/strategic-decisions.md); [BL-22](discovery-backlog.md)).
- Giới hạn biên độ bảo đảm nguồn cho Provider đang bị đình chỉ hoặc thuộc hồ sơ rủi ro ([FIN-007](decisions/financial-decisions.md); [BL-31](discovery-backlog.md)).
- Đường hình thành ban đầu của Individual Provider ngoài chuyển đổi ([BL-34](discovery-backlog.md)).
- Cơ chế xử lý nghĩa vụ đã phát sinh của Consumer Organization sau termination ([BL-35](discovery-backlog.md)).
- Việc nâng hạng First-Party Provider thành khái niệm cấp Ecoma Platform ([BL-39](discovery-backlog.md)).
- Thứ tự và thời điểm triển khai của hai domain ([BL-48](discovery-backlog.md)); điều kiện phát sinh tích hợp liên kết cung ứng GPU → LLM ([BL-49](discovery-backlog.md)).
- Hình thức và thời điểm API tự động hóa của Domain GPU — hiện chỉ có SSH và console ([SD-061](decisions/strategic-decisions.md); [BL-50](discovery-backlog.md)).
