# Provider Registration

## Mục đích

Mô tả luồng nghiệp vụ đăng ký Provider Identity và tham gia cung ứng trên domain Marketplace, ở mức nghiệp vụ đã được quyết định — không đi vào thiết kế tactical, API hay cơ sở dữ liệu.

## Các quyết định áp dụng

[SD-014](../decisions/provider-decisions.md), [SD-015](../decisions/provider-decisions.md), [SD-016](../decisions/provider-decisions.md), [SD-018](../decisions/provider-decisions.md), [SD-019](../decisions/provider-decisions.md), [SD-020](../decisions/provider-decisions.md), [SD-042](../decisions/provider-decisions.md), [SD-050](../decisions/provider-decisions.md), [SD-029](../decisions/strategic-decisions.md), [SD-033](../decisions/strategic-decisions.md), [SD-034](../decisions/strategic-decisions.md), [SD-035](../decisions/strategic-decisions.md), [SD-036](../decisions/strategic-decisions.md), [SD-047](../decisions/strategic-decisions.md), [SD-048](../decisions/strategic-decisions.md).

## Lifecycle liên quan

[Provider Lifecycle](../business-lifecycles/provider-lifecycle.md) mô tả các giai đoạn của Provider; process này chi tiết luồng đăng ký và tham gia cung ứng.

## Luồng nghiệp vụ

1. Account đăng ký Provider Identity với Ecoma **một lần** ([SD-018](../decisions/provider-decisions.md)). Danh tính này sau đó dùng cho cả hai domain Marketplace mà không phải đăng ký lại ([SD-018](../decisions/provider-decisions.md)).
2. Tư cách Provider được thể hiện qua quan hệ giữa Account và Provider:
   - **Individual Provider:** Account sở hữu một Individual Provider Identity ([SD-019](../decisions/provider-decisions.md), [SD-020](../decisions/provider-decisions.md)).
   - **Organization Provider:** Account đại diện hoặc quản lý một Organization Provider độc lập ([SD-019](../decisions/provider-decisions.md)). Một Account có thể sở hữu một Individual Provider Identity và đồng thời đại diện/quản lý nhiều Organization Provider độc lập ([SD-019](../decisions/provider-decisions.md)).
   - **Lưu ý:** việc đăng ký trực tiếp với tư cách Organization Provider (không qua chuyển đổi) đã được quyết định: Account đã có Provider Identity tạo trực tiếp Organization Provider ([SD-050](../decisions/provider-decisions.md)). Đường hình thành ban đầu của Individual Provider ngoài chuyển đổi chưa được quyết định — theo dõi tại [BL-34](../discovery-backlog.md#bl-34--hình-thành-ban-đầu-individual-provider-ngoài-chuyển-đổi); xem thêm [Domain Glossary](../domain-glossary.md).
   - Provider là cá nhân hoặc tổ chức thực sự tham gia cung ứng, gắn với Offering, trách nhiệm cung ứng và quyền lợi, nghĩa vụ thương mại — không chỉ là tài khoản hay gian hàng ([SD-020](../decisions/provider-decisions.md)).
3. Bắt đầu tham gia với **quyền hạn ban đầu giới hạn** theo nguyên tắc progressive trust ([SD-016](../decisions/provider-decisions.md)).
4. Mở rộng quyền theo mức độ xác minh, năng lực và độ tin cậy ([SD-016](../decisions/provider-decisions.md)).
   - **Lưu ý:** cơ chế trust hai giai đoạn đã chốt ([SD-042](../decisions/provider-decisions.md)): Activated khi nộp đủ giấy tờ theo nhóm đối tượng và được cung ứng ngay; Verified là điều kiện rút Earning balance — mức mặc định Ecoma Platform (nội dung tiêu chí mặc định do Ecoma Platform bảo trì qua Decision Process theo SD-040/SD-046), process này không tự đặt tiêu chí bổ sung.
5. Tham gia cung ứng trên domain Marketplace:
   - Chọn mô hình cung ứng linh hoạt: cung cấp tài nguyên đầu vào hoặc dịch vụ thành phần tùy theo domain và Offering ([SD-033](../decisions/strategic-decisions.md)).
   - Offering thuộc sở hữu Provider trên cả hai domain ([SD-034](../decisions/strategic-decisions.md), đọc theo [SD-058](../decisions/strategic-decisions.md)); Product-owned Offering chưa phát sinh sau khi hợp nhất sản phẩm.
6. Quan hệ thương mại diễn ra qua Ecoma:
   - Provider chịu trách nhiệm đối với phần cung ứng thuộc phạm vi của mình; Ecoma chịu trách nhiệm đối với những cam kết do Ecoma đưa ra ([SD-014](../decisions/provider-decisions.md)).
   - Consumer thanh toán thông qua Ecoma; Ecoma quản lý dòng tiền, nghĩa vụ tài chính và việc thanh toán cho Provider ([SD-015](../decisions/provider-decisions.md)). Tư cách pháp lý Merchant of Record của Ecoma chưa được xác định.
   - Ecoma luôn là chủ thể có quan hệ thương mại trực tiếp với Consumer, kể cả khi Offering thuộc sở hữu của Provider ([SD-035](../decisions/strategic-decisions.md)); Domain quyết định phạm vi cam kết dịch vụ của Ecoma với Consumer ([SD-036](../decisions/strategic-decisions.md)); vai trò trung gian Marketplace theo [SD-058](../decisions/strategic-decisions.md) trên từng domain ([SD-029](../decisions/strategic-decisions.md)).

## Điều kiện và ngoại lệ

- **Một lần đăng ký danh tính, tái sử dụng:** Provider không đăng ký lại Provider Identity khi tham gia thêm domain Marketplace khác ([SD-018](../decisions/provider-decisions.md)); việc tham gia từng domain vẫn tuân theo progressive trust và chính sách riêng của domain đó ([SD-016](../decisions/provider-decisions.md), [SD-029](../decisions/strategic-decisions.md)).
- **Tiêu chí verification:** cơ chế hai giai đoạn Activated/Verified đã chốt ([SD-042](../decisions/provider-decisions.md)) trên nền progressive trust ([SD-016](../decisions/provider-decisions.md)); trước khi xác minh mở rộng quyền, chỉ nguyên tắc quyền hạn ban đầu giới hạn có hiệu lực.
- **Chuyển đổi tư cách Individual ↔ Organization:** không phải đăng ký Provider mới; xem [provider-transformation](provider-transformation.md).
- **Authentication ≠ authorization:** đăng ký Provider Identity bằng Account đã xác thực không tự cấp quyền cung ứng; quyền đến từ progressive trust và chính sách từng domain ([SD-016](../decisions/provider-decisions.md), [SD-029](../decisions/strategic-decisions.md)).

## Thuật ngữ

Các thuật ngữ dùng trong tài liệu này được định nghĩa tại [Domain Glossary](../domain-glossary.md); bối cảnh chiến lược tại [Strategic Domain Model](../strategic-domain-model.md).
