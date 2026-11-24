# LLM Request Lifecycle

## Mục đích

Mô tả luồng nghiệp vụ xử lý một request inference của Consumer trong LLM Marketplace, theo trình tự auth → routing → admission → dispatch → settlement — ở cấp process nghiệp vụ, không đi vào thiết kế tactical, API hay cơ sở dữ liệu.

## Các quyết định áp dụng

[LLM-001](../decisions/llm-marketplace-decisions.md), [LLM-003](../decisions/llm-marketplace-decisions.md)–[LLM-016](../decisions/llm-marketplace-decisions.md), [LLM-018](../decisions/llm-marketplace-decisions.md)–[LLM-020](../decisions/llm-marketplace-decisions.md), [LLM-022](../decisions/llm-marketplace-decisions.md), [LLM-024](../decisions/llm-marketplace-decisions.md)–[LLM-027](../decisions/llm-marketplace-decisions.md), [LLM-029](../decisions/llm-marketplace-decisions.md), [LLM-031](../decisions/llm-marketplace-decisions.md), [ID-013](../decisions/account-identity-decisions.md), [FIN-001](../decisions/financial-decisions.md), [FIN-006](../decisions/financial-decisions.md)–[FIN-007](../decisions/financial-decisions.md), [FIN-009](../decisions/financial-decisions.md).

## Luồng nghiệp vụ

Các bước được đánh số liên tục qua sáu giai đoạn; mỗi giai đoạn là một list riêng nên đánh số lại từ 1, trình tự tổng hợp theo tiêu đề giai đoạn.

### 1. Authentication

1. Consumer gửi request inference qua API công khai tương thích giao thức OpenAI ([LLM-003](../decisions/llm-marketplace-decisions.md)), kèm API key.
2. Gateway xác thực API key ở dạng hash; key đã revoke bị chặn vĩnh viễn ([LLM-022](../decisions/llm-marketplace-decisions.md), [LLM-025](../decisions/llm-marketplace-decisions.md)).
3. Request được gắn với Consumer Organization, Workspace và API key tương ứng ([LLM-022](../decisions/llm-marketplace-decisions.md), [LLM-029](../decisions/llm-marketplace-decisions.md)); API key là credential scoped hành động thay mặt chủ thể ủy quyền theo [ID-013](../decisions/account-identity-decisions.md).

### 2. Routing

1. Gateway giải tên model theo Model Alias của Consumer: alias ánh xạ đến danh sách candidate Offering kèm routing policy ([LLM-008](../decisions/llm-marketplace-decisions.md)); không có lớp chuẩn hóa model xuyên provider ([LLM-006](../decisions/llm-marketplace-decisions.md)).
2. Gateway chọn một Offering theo routing strategy Consumer đã chọn — `priority`, `round_robin`, `weighted` hoặc `lowest customer price` ([LLM-009](../decisions/llm-marketplace-decisions.md)) — rồi chọn endpoint trong Offering theo trạng thái health (`healthy`/`degraded`/`down`) và thứ tự ưu tiên do Provider thiết lập ([LLM-007](../decisions/llm-marketplace-decisions.md)).

### 3. Admission control (trước khi gọi upstream)

1. Xác định giá áp dụng: snapshot bảng giá versioned gắn với request tại thời điểm tạo ([LLM-015](../decisions/llm-marketplace-decisions.md)), theo khung peak/off-peak của bảng giá ([LLM-014](../decisions/llm-marketplace-decisions.md)), giá đa thành phần ([LLM-013](../decisions/llm-marketplace-decisions.md)).
2. Gateway ước lượng giá của request — cận trên chi phí có thể phát sinh ([LLM-016](../decisions/llm-marketplace-decisions.md), [LLM-031](../decisions/llm-marketplace-decisions.md)).
3. Kiểm tra trên cùng khoản ước lượng: Usage balance còn đủ (ngăn âm balance) và limit còn lại ở cấp Workspace và cấp API key không bị vượt ([LLM-029](../decisions/llm-marketplace-decisions.md), [LLM-031](../decisions/llm-marketplace-decisions.md)). Đủ ở cả ba ràng buộc thì giữ trước khoản ước lượng; reservation là giữ chỗ trên pool, không phải trừ tiền ([FIN-007](../decisions/financial-decisions.md)).
4. Thiếu ở bất kỳ ràng buộc nào: từ chối khởi phát request; các reservation của công việc đang thực thi không bị ảnh hưởng ([FIN-007](../decisions/financial-decisions.md), [FIN-009](../decisions/financial-decisions.md)).

### 4. Dispatch

1. Gateway gọi upstream endpoint bằng credential upstream do Ecoma giữ ([LLM-001](../decisions/llm-marketplace-decisions.md), [LLM-026](../decisions/llm-marketplace-decisions.md)).
2. Khi thất bại, fallback theo hai cấp: endpoint khác trong cùng Offering, sau đó Offering khác trong danh sách candidate ([LLM-010](../decisions/llm-marketplace-decisions.md)) — giữ ba bất biến: không retry khi chưa biết provider đã thực thi request hay chưa; không chuyển provider khi dữ liệu đầu ra đã stream tới client; usage ghi nhận theo attempt chỉ phục vụ kiểm toán và đối soát, không dùng để tính tiền Consumer ([LLM-010](../decisions/llm-marketplace-decisions.md), [LLM-018](../decisions/llm-marketplace-decisions.md)).

### 5. Usage metering

1. Ecoma tự đo usage từ response upstream, không phụ thuộc báo cáo của Provider ([LLM-001](../decisions/llm-marketplace-decisions.md)).
2. Usage được chuẩn hóa theo năm thành phần: `input_tokens`, `output_tokens`, `cached_tokens`, `reasoning_tokens`, `request_count`; cached tokens là tập con của input tokens, reasoning tokens là tập con của output tokens, không cộng trùng ([LLM-011](../decisions/llm-marketplace-decisions.md)).
3. Dữ liệu usage của request ở trạng thái `known`, `missing`, `malformed` hoặc `partial`; trạng thái thiếu được ghi nhận để xử lý và đối soát sau này, không được hiểu là 0 token ([LLM-012](../decisions/llm-marketplace-decisions.md)).
4. Journal ghi metadata, trạng thái thực thi, usage và kết quả xử lý; không ghi prompt và response body ([LLM-027](../decisions/llm-marketplace-decisions.md)).

### 6. Settlement

1. Quyết toán theo logical request, đúng một lần, bất kể số provider attempt đã xảy ra ([LLM-018](../decisions/llm-marketplace-decisions.md)).
2. Charge không vượt quá phần đã giữ trước; phần giữ dư được giải phóng sau khi quyết toán theo chi phí thực tế ([LLM-016](../decisions/llm-marketplace-decisions.md)).
3. Charge được ghi vào sổ kế toán kép; số dư Wallet suy ra từ lịch sử ledger, không lưu thành con số độc lập ([LLM-019](../decisions/llm-marketplace-decisions.md)). Khoản của Provider được cộng vào Earning balance realtime theo [FIN-001](../decisions/financial-decisions.md) — trừ First-Party Provider, hạng không tích lũy payable và không có payout ([LLM-024](../decisions/llm-marketplace-decisions.md)).
4. Hiệu chỉnh sau quyết toán (nếu có) chỉ là bút toán kế toán: sửa sai số, đối soát, xử lý chargeback theo [FIN-009](../decisions/financial-decisions.md); không hoàn tiền về rail thanh toán cho Consumer ([LLM-020](../decisions/llm-marketplace-decisions.md), [FIN-001](../decisions/financial-decisions.md)).

## Điều kiện và ngoại lệ

- **API key đã revoke:** bị chặn vĩnh viễn; plaintext không được phát lại lần nào nữa ([LLM-025](../decisions/llm-marketplace-decisions.md)).
- **Thiếu balance hoặc limit (Workspace/API key):** từ chối khởi phát request mới theo [FIN-007](../decisions/financial-decisions.md) và [LLM-031](../decisions/llm-marketplace-decisions.md); Usage balance âm tạm do chargeback chặn khởi phát tiêu dùng mới tới khi nạp bù ([FIN-009](../decisions/financial-decisions.md)).
- **Hết candidate Offering:** request thất bại về Consumer; quyết toán theo chi phí thực tế phát sinh ([LLM-016](../decisions/llm-marketplace-decisions.md), [LLM-018](../decisions/llm-marketplace-decisions.md)).
- **Provider cập nhật giá giữa chừng:** request đang thực thi tiếp tục dùng snapshot giá đã gắn; request mới dùng version bảng giá mới ([LLM-015](../decisions/llm-marketplace-decisions.md)).
- **Usage thiếu hoặc sai định dạng:** ghi nhận trạng thái để xử lý và đối soát sau; không quy về 0 token ([LLM-012](../decisions/llm-marketplace-decisions.md)).

## Thuật ngữ

Các thuật ngữ dùng trong tài liệu này được định nghĩa tại [Domain Glossary](../domain-glossary.md); bối cảnh chiến lược tại [Strategic Domain Model](../strategic-domain-model.md).
