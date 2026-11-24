# Provider Transformation Lifecycle

## Mục đích

Mô tả các khía cạnh nghiệp vụ đã được quyết định của quá trình một Provider chuyển đổi tư cách giữa Individual Provider và Organization Provider, và các bất biến phải được bảo toàn xuyên suốt quá trình chuyển đổi.

## Các quyết định áp dụng

[SD-021](../decisions/provider-decisions.md), [SD-022](../decisions/provider-decisions.md), [SD-023](../decisions/provider-decisions.md), [SD-024](../decisions/provider-decisions.md), [SD-025](../decisions/provider-decisions.md), [SD-026](../decisions/provider-decisions.md), [SD-027](../decisions/provider-decisions.md), [SD-028](../decisions/provider-decisions.md).

## Quan hệ với các lifecycle và process khác

- [Provider Lifecycle](provider-lifecycle.md): transformation là chuyển tiếp giữa các tư cách của cùng một Provider Identity, không phải giữa hai Provider khác nhau.
- Process liên quan: [provider-transformation](../business-processes/provider-transformation.md).

## Ranh giới của lifecycle này

- **Business transformation ≠ technical migration.** Chuyển đổi tư cách Provider là quyết định thuộc cấp nghiệp vụ; lifecycle này không mô tả và không bao gồm bất kỳ migration kỹ thuật, dữ liệu hay hạ tầng nào.
- **Business transformation ≠ operations migration.** Chuyển đổi tư cách không đồng nghĩa chuyển đổi hoặc tạo lại các hoạt động cung cấp dịch vụ hiện hữu.
- Lifecycle này **không thiết kế quy trình pháp lý** cho việc chuyển đổi (ví dụ thủ tục thành lập hay giải thể pháp nhân); các quy định pháp lý cụ thể nằm ngoài phạm vi quyết định hiện có.

## Các khía cạnh của quá trình chuyển đổi

### 1. Phạm vi chuyển đổi: hai chiều

Provider hỗ trợ chuyển đổi **hai chiều** giữa Individual Provider và Organization Provider ([SD-024](../decisions/provider-decisions.md)): cả Individual → Organization lẫn Organization → Individual.

### 2. Provider Identity continuity

Khi một Individual Provider chuyển đổi thành Organization Provider, **danh tính Provider được giữ nguyên** thay vì tạo Provider mới ([SD-021](../decisions/provider-decisions.md)). Đây là bất biến trung tâm của quá trình chuyển đổi: chuyển đổi tư cách, không thay thế chủ thể.

### 3. Verification và approval

Chuyển đổi chỉ có hiệu lực **sau khi được xác minh và phê duyệt** ([SD-026](../decisions/provider-decisions.md)).

- Trong thời gian chờ, Provider **tiếp tục hoạt động theo trạng thái và chính sách hiện hành** ([SD-026](../decisions/provider-decisions.md)).
- Nguyên tắc xác minh và phê duyệt đã chốt ở mức này; các tiêu chí cụ thể **chưa được quyết định** — tài liệu này không tự đặt (theo dõi tại [BL-37](../discovery-backlog.md#bl-37--tiêu-chí-xác-minh-và-phê-duyệt-provider-transformation)).

### 4. Founder management continuity

Sau chuyển đổi:

- Account của người sáng lập tiếp tục là **người quản lý mặc định** và có thể ủy quyền quản lý cho người khác ([SD-022](../decisions/provider-decisions.md)).
- Quyền quản lý này **không đồng nghĩa** với việc người sáng lập tiếp tục là chủ thể chịu trách nhiệm pháp lý hoặc thương mại ([SD-022](../decisions/provider-decisions.md)). Hai khái niệm được giữ tách biệt trong suốt lifecycle.

### 5. Operational continuity

Quá trình chuyển đổi Provider **không làm gián đoạn hoặc thay đổi** hoạt động cung cấp dịch vụ hiện hữu ([SD-025](../decisions/provider-decisions.md)).

### 6. Historical obligations

Lịch sử và nghĩa vụ đã phát sinh được bảo toàn, xử lý **theo trạng thái và chính sách có hiệu lực tại thời điểm phát sinh** ([SD-023](../decisions/provider-decisions.md)). Nghĩa vụ đã phát sinh không bị thay đổi chỉ vì Provider chuyển sang tư cách mới.

### 7. Status-bound financial balances

Mỗi khoản số dư và quyền lợi tài chính được **phân loại theo trạng thái Provider tại thời điểm phát sinh** và tiếp tục tuân theo chính sách tương ứng sau chuyển đổi ([SD-027](../decisions/provider-decisions.md)). Khác với nghĩa vụ lịch sử ở chỗ đây là phân loại quyền lợi/số dư đang tồn tại: các khoản phát sinh trước chuyển đổi vẫn đi theo chính sách của trạng thái cũ, không bị chuyển sang chính sách của tư cách mới.

### 8. Offering continuity

Chuyển đổi trạng thái Provider **không yêu cầu tạo lại, chuyển giao hoặc xác minh lại** các Offering hiện hữu chỉ vì thay đổi trạng thái ([SD-028](../decisions/provider-decisions.md)). Offering là đối tượng ở cấp vận hành; việc thay đổi tư cách Provider không làm gián đoạn Offering.

## Tổng hợp bất biến

Qua toàn bộ quá trình chuyển đổi, các bất biến sau được bảo toàn ([SD-021](../decisions/provider-decisions.md), [SD-023](../decisions/provider-decisions.md), [SD-025](../decisions/provider-decisions.md), [SD-028](../decisions/provider-decisions.md)):

1. Provider Identity không đổi.
2. Hoạt động cung ứng không gián đoạn.
3. Lịch sử và nghĩa vụ đã phát sinh không đổi cách xử lý.
4. Offering hiện hữu không bị tạo lại, chuyển giao hay xác minh lại.

## Chưa thống nhất — thuộc Discovery Backlog

- Tiêu chí xác minh và phê duyệt cụ thể cho chuyển đổi ([SD-026](../decisions/provider-decisions.md) chỉ chốt nguyên tắc; [BL-37](../discovery-backlog.md)).
- Quy trình pháp lý đi kèm chuyển đổi tư cách — ngoài phạm vi đã quyết định.

Xem [Discovery Backlog](../discovery-backlog.md).

## Thuật ngữ

Các thuật ngữ dùng trong tài liệu này được định nghĩa tại [Domain Glossary](../domain-glossary.md); bối cảnh chiến lược tại [Strategic Domain Model](../strategic-domain-model.md).
