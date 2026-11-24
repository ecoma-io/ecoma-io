# Provider Lifecycle

## Mục đích

Mô tả các giai đoạn nghiệp vụ đã được quyết định của một Provider của Ecoma — từ đăng ký Provider Identity đến tham gia cung ứng trên các domain Marketplace — không đi vào thiết kế tactical, API hay cơ sở dữ liệu.

## Các quyết định áp dụng

[SD-014](../decisions/provider-decisions.md), [SD-015](../decisions/provider-decisions.md), [SD-016](../decisions/provider-decisions.md), [SD-017](../decisions/provider-decisions.md), [SD-018](../decisions/provider-decisions.md), [SD-019](../decisions/provider-decisions.md), [SD-020](../decisions/provider-decisions.md), [SD-042](../decisions/provider-decisions.md), [SD-043](../decisions/provider-decisions.md), [SD-044](../decisions/provider-decisions.md), [SD-045](../decisions/provider-decisions.md), [SD-047](../decisions/strategic-decisions.md), [SD-048](../decisions/strategic-decisions.md), [SD-050](../decisions/provider-decisions.md), [ID-011](../decisions/account-identity-decisions.md), [FIN-001](../decisions/financial-decisions.md), [FIN-002](../decisions/financial-decisions.md), [FIN-003](../decisions/financial-decisions.md), [FIN-007](../decisions/financial-decisions.md), [FIN-008](../decisions/financial-decisions.md), [SD-029](../decisions/strategic-decisions.md), [SD-033](../decisions/strategic-decisions.md), [SD-034](../decisions/strategic-decisions.md), [SD-035](../decisions/strategic-decisions.md), [SD-036](../decisions/strategic-decisions.md).

## Phạm vi và ranh giới

- Provider và Consumer Organization là hai khái niệm nghiệp vụ độc lập, có mục đích, chính sách, quyền hạn và vòng đời riêng ([SD-017](../decisions/provider-decisions.md)). Lifecycle này không áp dụng mô hình Owner/Member của Consumer Organization cho Provider.
- Provider Identity ≠ Provider Actor: Provider là chủ thể chịu trách nhiệm cung cấp dịch vụ; người hoặc Agent thực hiện thao tác là Actor tham gia vận hành.
- Tư cách Provider có thể thay đổi qua quá trình transformation; phần đó được mô tả riêng tại [Provider Transformation Lifecycle](provider-transformation-lifecycle.md). Lifecycle này mô tả trạng thái tư cách hiện hành và hoạt động cung ứng trong trạng thái đó.

## Quan hệ với các lifecycle khác

- [Account Lifecycle](account-lifecycle.md): Provider Identity đăng ký bằng một Ecoma Account ([SD-019](../decisions/provider-decisions.md)).
- Process liên quan: [provider-registration](../business-processes/provider-registration.md), [provider-transformation](../business-processes/provider-transformation.md).

## Các giai đoạn đã có quyết định

### 1. Provider Identity registration

- Provider đăng ký danh tính với Ecoma **một lần** và có thể tham gia cung ứng trên **cả hai domain Marketplace** mà không phải đăng ký lại danh tính ([SD-018](../decisions/provider-decisions.md)).
- Provider Identity không phải là chỉ một tài khoản hay gian hàng: Provider là cá nhân hoặc tổ chức thực sự tham gia cung ứng, gắn với Offering, trách nhiệm cung ứng và quyền lợi, nghĩa vụ thương mại ([SD-020](../decisions/provider-decisions.md)).

### 2. Tư cách: Individual hoặc Organization Provider

- Một Ecoma Account có thể sở hữu một Individual Provider Identity và đồng thời đại diện hoặc quản lý nhiều Organization Provider độc lập ([SD-019](../decisions/provider-decisions.md)).
- Organization Provider có **đúng một Owner** và được phép có nhiều Member; mỗi Membership đi kèm danh sách quyền ([SD-043](../decisions/provider-decisions.md)). Các quy tắc chi tiết đã được quyết định tại [SD-050](../decisions/provider-decisions.md): Account tạo trực tiếp Organization Provider là Owner đầu tiên, quyền sở hữu chuyển giao cho Member đang hoạt động (Owner cũ thành Member thường), rời/bị loại và mời lại theo SD-050.
- Hình thành Organization Provider bằng tạo trực tiếp đã được quyết định ([SD-050](../decisions/provider-decisions.md)); việc hình thành ban đầu của Individual Provider ngoài chuyển đổi chưa được quyết định; các quyết định hiện có xác lập chuyển đổi hai chiều giữa hai tư cách ([SD-021](../decisions/provider-decisions.md), [SD-024](../decisions/provider-decisions.md)) — xem [BL-34](../discovery-backlog.md#bl-34--hình-thành-ban-đầu-individual-provider-ngoài-chuyển-đổi).

### 3. Tham gia với progressive trust

- Provider có thể tham gia Ecoma với những **quyền hạn ban đầu giới hạn**, được mở rộng theo mức độ xác minh, năng lực và độ tin cậy ([SD-016](../decisions/provider-decisions.md)).
- Cơ chế hai giai đoạn ([SD-042](../decisions/provider-decisions.md)): **Activated** khi nộp đủ giấy tờ theo nhóm đối tượng (cá nhân: giấy tờ tùy thân; hộ kinh doanh: giấy chứng nhận đăng ký hộ kinh doanh và giấy tờ chủ hộ; doanh nghiệp: giấy chứng nhận đăng ký doanh nghiệp và giấy tờ người đại diện pháp luật) — được cung ứng dịch vụ ngay; **Verified** là điều kiện để rút tiền từ Earning balance ([FIN-002](../decisions/financial-decisions.md)).
- Ecoma có thể yêu cầu xác minh bổ sung (chụp ảnh hoặc quay video đang cầm giấy tờ) khi phát hiện trùng lặp thông tin, và có thể yêu cầu xác minh thêm khi phát hiện dấu hiệu abuse ngay cả khi đã Verified ([SD-042](../decisions/provider-decisions.md)).
- Quy trình Trust áp dụng cấp Ecoma Platform: một quy trình dùng chung cho mọi domain, domain không yêu cầu xác minh lại ([SD-042](../decisions/provider-decisions.md), [SD-018](../decisions/provider-decisions.md)).
- Ánh xạ nhóm đối tượng KYC sang Individual/Organization Provider đã được xác lập và "Verified" giữ nghĩa tương đồng trên mọi Marketplace ([SD-047](../decisions/strategic-decisions.md)); đường xử lý khi xác minh thất bại đã chốt: giữ nguyên mức trust hiện tại theo [SD-016](../decisions/provider-decisions.md), gian lận danh tính là vi phạm cấp Ecoma Platform → đình chỉ theo [SD-048](../decisions/strategic-decisions.md); nội dung tiêu chí Verified mặc định do Ecoma Platform sở hữu và bảo trì qua Decision Process (SD-040/SD-046); quy trình xác minh chi tiết thuộc lớp design — xem mục "Chưa thống nhất".

### 4. Tham gia cung ứng trên domain Marketplace

Sau khi có Provider Identity và trong phạm vi quyền hiện hành:

- Mô hình cung ứng linh hoạt: Provider có thể cung cấp tài nguyên đầu vào hoặc dịch vụ thành phần tùy theo domain và Offering ([SD-033](../decisions/strategic-decisions.md)).
- Mô hình sở hữu Offering: cả hai domain đều đóng vai trò trung gian Marketplace với Offering thuộc sở hữu Provider ([SD-034](../decisions/strategic-decisions.md), đọc theo [SD-058](../decisions/strategic-decisions.md)); Product-owned Offering chưa phát sinh sau khi hợp nhất sản phẩm.
- Vai trò thương mại: Provider là chủ thể cung ứng dịch vụ hoặc tài nguyên, chịu trách nhiệm đối với phần cung ứng thuộc phạm vi của mình; Ecoma chịu trách nhiệm đối với những cam kết do Ecoma đưa ra ([SD-014](../decisions/provider-decisions.md)).
- Consumer thanh toán thông qua Ecoma; Ecoma quản lý dòng tiền, nghĩa vụ tài chính và việc thanh toán cho Provider ([SD-015](../decisions/provider-decisions.md)). Tư cách pháp lý Merchant of Record của Ecoma **chưa được xác định**.
- Ecoma đóng vai trò trung gian Marketplace trên cả hai domain; trách nhiệm và phạm vi cam kết được xác định theo từng domain ([SD-029](../decisions/strategic-decisions.md), đọc theo [SD-059](../decisions/strategic-decisions.md)).
- Ecoma luôn là chủ thể có quan hệ thương mại trực tiếp với Consumer, kể cả khi Offering thuộc sở hữu của Provider ([SD-035](../decisions/strategic-decisions.md)); Domain quyết định phạm vi cam kết dịch vụ của Ecoma với Consumer ([SD-036](../decisions/strategic-decisions.md)).

### 5. Tái sử dụng xuyên domain Marketplace

Provider Identity được đăng ký một lần và tái sử dụng trên cả hai domain Marketplace mà không phải đăng ký lại danh tính ([SD-018](../decisions/provider-decisions.md)). Việc tham gia cung ứng trên từng domain vẫn tuân theo chính sách của domain đó (progressive trust, [SD-016](../decisions/provider-decisions.md); hybrid governance, [SD-030](../decisions/strategic-decisions.md)).

### 6. Đình chỉ Provider

- Provider có thể bị đình chỉ theo hai phạm vi ([SD-048](../decisions/strategic-decisions.md)):
  - **Đình chỉ cấp Ecoma Platform:** vi phạm cấp Ecoma Platform (ví dụ gian lận danh tính, gian lận thanh toán, lạm dụng nghiêm trọng) đình chỉ Provider trên toàn bộ các domain Marketplace; danh mục vi phạm cấp Ecoma Platform là mặc định Ecoma Platform mà domain được mở rộng.
  - **Đình chỉ cục bộ theo domain:** vi phạm đặc thù dịch vụ chỉ đình chỉ trong phạm vi domain áp dụng.
- Khi bị đình chỉ, Offering của Provider bị gỡ khỏi Discovery theo phạm vi đình chỉ (không nhận Consumer mới); phần cung ứng đã cam kết với Consumer được hoàn tất theo biên độ đã bảo đảm nguồn, sau đó dừng ([SD-048](../decisions/strategic-decisions.md), [FIN-007](../decisions/financial-decisions.md)).
- Đình chỉ cấp Ecoma Platform đóng băng bắt buộc khả năng rút Earning balance; số dư đã tích lũy vẫn thuộc quyền sở hữu của Provider và được giải tỏa khi Provider hồi phục hoặc theo kết luận xử lý. Đình chỉ cục bộ theo domain không ảnh hưởng quyền rút Earning ([FIN-008](../decisions/financial-decisions.md)).
- Điều kiện hồi phục và chấm dứt sau đình chỉ **chưa được quyết định** — xem [Discovery Backlog](../discovery-backlog.md): [BL-22](../discovery-backlog.md#bl-22--provider-evaluation--certification-standards-theo-domain), [BL-31](../discovery-backlog.md#bl-31--giới-hạn-biên-độ-bảo-đảm-nguồn-cho-provider-đình-chỉ-hoặc-rủi-ro).
- Phân biệt với đóng băng theo Owner: Organization Provider và Individual Provider do một Account làm Owner sẽ dừng hoạt động khi Account đó bị suspension ([ID-011](../decisions/account-identity-decisions.md)); đây là hiệu ứng đóng băng theo quyền sở hữu, không phải đình chỉ Provider theo vi phạm ở mục 6.

## Chưa thống nhất — thuộc Discovery Backlog

Các chủ đề sau **chưa có quyết định** và được theo dõi tại [Discovery Backlog](../discovery-backlog.md). Tài liệu này không tự định nghĩa:

- Nội dung tiêu chí Verified mặc định do Ecoma Platform sở hữu và bảo trì qua Decision Process (SD-040/SD-046); đường xử lý xác minh thất bại đã chốt theo [SD-016](../decisions/provider-decisions.md) (giữ nguyên mức trust hiện tại) và [SD-048](../decisions/strategic-decisions.md) (gian lận danh tính → đình chỉ); quy trình xác minh chi tiết thuộc lớp design.
- Điều kiện hồi phục và chấm dứt của Provider sau đình chỉ ([SD-048](../decisions/strategic-decisions.md)): [BL-22](../discovery-backlog.md#bl-22--provider-evaluation--certification-standards-theo-domain), [BL-31](../discovery-backlog.md#bl-31--giới-hạn-biên-độ-bảo-đảm-nguồn-cho-provider-đình-chỉ-hoặc-rủi-ro).

Do đó lifecycle này **không** mô tả các trạng thái registration cụ thể khác ngoài Activated/Verified và đình chỉ (mục 6) — các trạng thái registration khác chưa có trong quyết định.

## Thuật ngữ

Các thuật ngữ dùng trong tài liệu này được định nghĩa tại [Domain Glossary](../domain-glossary.md); bối cảnh chiến lược tại [Strategic Domain Model](../strategic-domain-model.md).
