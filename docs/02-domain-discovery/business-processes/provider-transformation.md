# Provider Transformation

## Mục đích

Mô tả luồng nghiệp vụ chuyển đổi tư cách Provider giữa Individual Provider và Organization Provider, ở mức nghiệp vụ đã được quyết định — không đi vào thiết kế tactical, API, cơ sở dữ liệu hay quy trình pháp lý.

## Các quyết định áp dụng

[SD-021](../decisions/provider-decisions.md), [SD-022](../decisions/provider-decisions.md), [SD-023](../decisions/provider-decisions.md), [SD-024](../decisions/provider-decisions.md), [SD-025](../decisions/provider-decisions.md), [SD-026](../decisions/provider-decisions.md), [SD-027](../decisions/provider-decisions.md), [SD-028](../decisions/provider-decisions.md).

## Lifecycle liên quan

[Provider Transformation Lifecycle](../business-lifecycles/provider-transformation-lifecycle.md) mô tả các khía cạnh và bất biến của quá trình chuyển đổi; process này chi tiết luồng từng bước.

## Luồng nghiệp vụ

1. Provider yêu cầu chuyển đổi tư cách: **Individual → Organization** hoặc **Organization → Individual** — chuyển đổi hỗ trợ hai chiều ([SD-024](../decisions/provider-decisions.md)).
2. Trong thời gian chờ xử lý yêu cầu, Provider **tiếp tục hoạt động bình thường theo trạng thái và chính sách hiện hành** — hoạt động cung cấp dịch vụ hiện hữu không bị gián đoạn hay thay đổi trong suốt quá trình chuyển đổi ([SD-025](../decisions/provider-decisions.md), [SD-026](../decisions/provider-decisions.md)).
3. Yêu cầu chuyển đổi đi qua **verification và approval** — chuyển đổi chỉ có hiệu lực sau khi được xác minh và phê duyệt ([SD-026](../decisions/provider-decisions.md)).
   - **Không tự đặt tiêu chí:** các tiêu chí xác minh và phê duyệt cụ thể chưa được quyết định — theo dõi tại [BL-37](../discovery-backlog.md#bl-37--tiêu-chí-xác-minh-và-phê-duyệt-provider-transformation).
4. Khi được phê duyệt, chuyển đổi có hiệu lực, với các kết quả sau:
   - **Provider Identity giữ nguyên:** danh tính Provider được bảo toàn thay vì tạo Provider mới ([SD-021](../decisions/provider-decisions.md)).
   - **Founder management continuity:** Account của người sáng lập tiếp tục là người quản lý mặc định và có thể ủy quyền quản lý cho người khác; quyền quản lý này không đồng nghĩa với việc người sáng lập tiếp tục là chủ thể chịu trách nhiệm pháp lý hoặc thương mại ([SD-022](../decisions/provider-decisions.md)).
   - **Historical obligations:** lịch sử và nghĩa vụ đã phát sinh được bảo toàn, xử lý theo trạng thái và chính sách có hiệu lực tại thời điểm phát sinh ([SD-023](../decisions/provider-decisions.md)).
   - **Status-bound financial balances:** mỗi khoản số dư và quyền lợi tài chính được phân loại theo trạng thái Provider tại thời điểm phát sinh và tiếp tục tuân theo chính sách tương ứng sau chuyển đổi ([SD-027](../decisions/provider-decisions.md)).
   - **Offering continuity:** các Offering hiện hữu không bị tạo lại, chuyển giao hoặc xác minh lại chỉ vì thay đổi trạng thái ([SD-028](../decisions/provider-decisions.md)).
5. Provider hoạt động tiếp dưới tư cách mới với cùng Provider Identity.

## Business transformation vs technical migration

Quyết định chuyển đổi thuộc **cấp nghiệp vụ tư cách Provider**:

- Đây là **business transformation** — thay đổi tư cách (Individual ↔ Organization) của cùng một Provider Identity, kèm các bất biến về nghĩa vụ lịch sử, số dư và Offering ([SD-021](../decisions/provider-decisions.md), [SD-023](../decisions/provider-decisions.md), [SD-027](../decisions/provider-decisions.md), [SD-028](../decisions/provider-decisions.md)).
- Process này **không bao gồm và không loại trừ** bất kỳ migration kỹ thuật, dữ liệu hay hạ tầng nào: technical migration và operations migration không thuộc phạm vi quyết định hiện có; việc đó thuộc lớp design sau.
- Process này cũng **không thiết kế quy trình pháp lý** cho việc chuyển đổi (ví dụ thủ tục pháp nhân); quy định pháp lý cụ thể nằm ngoài phạm vi quyết định hiện có.

## Điều kiện và ngoại lệ

- **Chưa được phê duyệt:** chuyển đổi chưa có hiệu lực; Provider vẫn hoạt động theo trạng thái và chính sách hiện hành ([SD-026](../decisions/provider-decisions.md)).
- **Chuyển đổi hai chiều:** cả Individual → Organization lẫn Organization → Individual đều được hỗ trợ ([SD-024](../decisions/provider-decisions.md)); các bất biến tại bước 4 áp dụng cho cả hai chiều.
- **Nghĩa vụ phát sinh trước chuyển đổi:** không bị thay đổi chỉ vì Provider chuyển sang tư cách mới — xử lý theo chính sách tại thời điểm phát sinh ([SD-023](../decisions/provider-decisions.md)); số dư và quyền lợi đi theo chính sách của trạng thái đã phát sinh ([SD-027](../decisions/provider-decisions.md)).
- **Tiêu chí verification chưa được quyết định:** bước 3 hiện chỉ có nguyên tắc ([SD-026](../decisions/provider-decisions.md)); theo dõi tại [BL-37](../discovery-backlog.md#bl-37--tiêu-chí-xác-minh-và-phê-duyệt-provider-transformation).

## Thuật ngữ

Các thuật ngữ dùng trong tài liệu này được định nghĩa tại [Domain Glossary](../domain-glossary.md); bối cảnh chiến lược tại [Strategic Domain Model](../strategic-domain-model.md).
