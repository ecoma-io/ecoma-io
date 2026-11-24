# GPU Cloud Marketplace Decisions

Các quyết định discovery cấp domain cho Domain GPU (GPU Cloud Marketplace) — domain cung ứng thứ hai theo [SD-059](strategic-decisions.md), đóng vai trò trung gian Marketplace (SD-054, đọc lại theo SD-058). Quyết định trong file này thuộc phạm vi domain-level theo SD-030 (đọc theo SD-059) và cơ chế phân cấp SD-046: chúng điều tiết các mặc định Ecoma Platform đã chốt trong các register khác cho domain này, không thay thế các quyết định đó. Quy ước chung được quy định tại [README](README.md).

## GPU-001 — Instance Supply Forms (Phase 1)

**Status:** Accepted
GPU Cloud Marketplace Phase 1 cung ứng compute GPU dạng instance persistent (VM/container) với hai mode: on-demand (không bị preempt) và interruptible (chịu preempt, giá thấp hơn). Serverless, reserved và container job là các dạng mở rộng sau khi có nhu cầu thực — theo dõi tại [BL-44](../discovery-backlog.md); không thiết kế trước khi có nhu cầu. Offering GPU do Provider sở hữu, đúng hướng Provider-owned là chủ đạo của Product này (SD-034, SD-054).

**Liên quan:** [SD-034](strategic-decisions.md), [SD-054](strategic-decisions.md), [GPU-002](gpu-cloud-marketplace-decisions.md), [BL-44](../discovery-backlog.md).

## GPU-002 — Provider-Set Pricing and Offer Verification

**Status:** Accepted
Provider tự đặt giá cho Offer của mình; Ecoma verify Offer trước khi Offer được active, theo đúng pattern LLM Marketplace (tiền lệ [LLM-028](llm-marketplace-decisions.md)): Ecoma tự đo và xác minh nội dung Offering thay vì phụ thuộc khai báo của Provider. Giá đa thành phần: compute theo giây, storage theo GB-giờ, bandwidth theo byte. Bảng giá versioned kèm snapshot tại thời điểm thuê — hợp đồng đang chạy giữ giá đến hạn kết thúc (tương tự [LLM-015](llm-marketplace-decisions.md)). Tiêu chí verify chi tiết theo [BL-22](../discovery-backlog.md).

**Liên quan:** [SD-034](strategic-decisions.md), [SD-045](provider-decisions.md), [LLM-015](llm-marketplace-decisions.md), [LLM-028](llm-marketplace-decisions.md), [BL-22](../discovery-backlog.md).

## GPU-003 — Balance Depletion Handling

**Status:** Accepted
Khi Usage balance của Consumer chạm $0 giữa chừng: dừng tính phí compute ngay, xóa instance và disk, không phát sinh nợ (mô hình TensorDock). Đây là điểm khác biệt có khai báo với quy tắc bảo toàn tiêu dùng của [FIN-007](financial-decisions.md) — GPU-M thực hiện override theo SD-046; quan hệ chính xác giữa GPU-003 và FIN-007 được đối chiếu và ghi khai báo tường minh trước khi hiện thực, theo dõi tại [BL-46](../discovery-backlog.md).

**Liên quan:** [FIN-001](financial-decisions.md), [FIN-007](financial-decisions.md), [FIN-009](financial-decisions.md), [BL-46](../discovery-backlog.md).

## GPU-004 — Platform-Side Metering

**Status:** Accepted
Ecoma đo lường usage qua platform-side agent chạy trên máy Provider; số liệu từ agent là căn cứ chốt tiền duy nhất, Provider không tự báo số (tiền lệ daemon Kaalia của Vast; nguyên tắc Ecoma đo lường theo [SD-045](provider-decisions.md)). Usage components: compute-time, storage-time, bandwidth. Trạng thái chất lượng dữ liệu usage theo tiền lệ [LLM-012](llm-marketplace-decisions.md): thiếu dữ liệu không được hiểu là 0.

**Liên quan:** [SD-045](provider-decisions.md), [LLM-012](llm-marketplace-decisions.md), [GPU-006](gpu-cloud-marketplace-decisions.md), [GPU-010](gpu-cloud-marketplace-decisions.md).

## GPU-005 — Hardware Verification and Display

**Status:** Accepted
Ecoma xác minh phần cứng của Offer tự động và liên tục (GPU model, VRAM, health check). Kết quả xác minh chỉ tác động Discovery & Display — nhãn và thứ tự hiển thị — không tác động Service Routing (SD-049); độ tin cậy được đo và công bố theo [SD-045](provider-decisions.md). Xác minh phần cứng máy là khái niệm của máy, tách bạch với trạng thái Verified của tài khoản theo [SD-042](provider-decisions.md). Quyết định này đóng phần xác minh hardware của [BL-22](../discovery-backlog.md) cho GPU Cloud Marketplace.

**Liên quan:** [SD-042](provider-decisions.md), [SD-045](provider-decisions.md), [SD-049](strategic-decisions.md), [BL-22](../discovery-backlog.md).

## GPU-006 — Provider-Funded Failure Compensation

**Status:** Accepted
Khi tài nguyên không khả dụng: dừng tính phí phần không khả dụng, giữ dữ liệu Consumer, và cấp credit bồi thường tự động theo mức phạt của chính sách Product (mô hình TensorDock). Credit được tài trợ bằng cách trừ vào Earning balance của Provider gây sự cố — Provider chịu đúng hậu quả chất lượng máy mình; platform không lời từ cơ chế bồi thường. Mức multiplier, danh mục sự cố được tính, cơ chế xác nhận sự cố và cap là chính sách vận hành của Product theo [SD-036](strategic-decisions.md); việc trừ thu nhập hiện thực qua settlement theo [FIN-002](financial-decisions.md).

**Liên quan:** [SD-036](strategic-decisions.md), [SD-045](provider-decisions.md), [FIN-002](financial-decisions.md), [FIN-005](financial-decisions.md), [GPU-004](gpu-cloud-marketplace-decisions.md), [BL-26](../discovery-backlog.md).

## GPU-007 — Workspace and API Key Inheritance

**Status:** Superseded — thay thế bởi [GPU-012](#gpu-012--consumption-model-của-domain-gpu)
GPU Cloud Marketplace kế thừa mô hình tổ chức tiêu dùng của LLM Marketplace: Workspace bên dưới Consumer Organization ([LLM-021](llm-marketplace-decisions.md)), API key scoped ([LLM-022](llm-marketplace-decisions.md), [LLM-025](llm-marketplace-decisions.md), [LLM-029](llm-marketplace-decisions.md)), quyền thao tác theo mô hình Membership ([MEM-005](membership-decisions.md)). Không thiết kế mô hình workspace/key riêng cho Product này. Ví tiêu dùng dùng chung cấp Organization theo [FIN-006](financial-decisions.md).

**Liên quan:** [LLM-021](llm-marketplace-decisions.md), [LLM-022](llm-marketplace-decisions.md), [LLM-025](llm-marketplace-decisions.md), [LLM-029](llm-marketplace-decisions.md), [MEM-005](membership-decisions.md), [FIN-006](financial-decisions.md).

## GPU-008 — Financial Model Inheritance

**Status:** Accepted
GPU Cloud Marketplace kế thừa hạ tầng tài chính Ecosystem nguyên trạng, không thay thế theo [FIN-004](financial-decisions.md): usage balance nạp trước không hoàn ([FIN-001](financial-decisions.md)), earning ghi real-time và settlement theo [FIN-002](financial-decisions.md), từ chối khởi phát tiêu thụ mới khi thiếu (FIN-007, trừ điểm điều tiết tại GPU-003), chargeback làm âm balance ([FIN-009](financial-decisions.md)), dòng tiền hoa hồng theo [FIN-005](financial-decisions.md). Một ví dùng chung cho cả Ecosystem — Consumer dùng nhiều Product không phải nạp riêng từng Product.

**Liên quan:** [FIN-001](financial-decisions.md), [FIN-002](financial-decisions.md), [FIN-004](financial-decisions.md), [FIN-005](financial-decisions.md), [FIN-009](financial-decisions.md), [GPU-003](gpu-cloud-marketplace-decisions.md).

## GPU-009 — Payout and KYC

**Status:** Accepted
Provider nhận thanh toán theo chu kỳ [FIN-002](financial-decisions.md): settlement hàng tháng, số khả dụng rút được sau 20 ngày, earning ghi real-time. KYC/AML giữ nguyên ở cấp Ecosystem theo [SD-042](provider-decisions.md) — Ecoma tự xác minh danh tính, không ủy quyền quy trình trust cho payout provider; điều kiện rút gắn trạng thái Verified (SD-042, FIN-002).

**Liên quan:** [SD-042](provider-decisions.md), [FIN-002](financial-decisions.md).

## GPU-010 — Consumer Data Protection on Provider Host

**Status:** Accepted
Terms of Service cấm Provider truy cập dữ liệu workload của Consumer nằm trên máy host của mình; platform-side agent ([GPU-004](gpu-cloud-marketplace-decisions.md)) giám sát chủ động tín hiệu vi phạm; vi phạm được xử lý theo phân loại và đình chỉ lan truyền ([SD-048](strategic-decisions.md)). Cam kết bảo vệ là best-effort: Ecoma không bảo đảm tuyệt đối — nhất quán nguyên tắc đo lường thay vì bảo đảm đầu cuối ([SD-045](provider-decisions.md)).

**Liên quan:** [SD-045](provider-decisions.md), [SD-048](strategic-decisions.md), [GPU-004](gpu-cloud-marketplace-decisions.md).

## GPU-011 — First-Party GPU Supply

**Status:** Accepted
Ecoma cung cấp GPU first-party trong GPU Cloud Marketplace — cạnh tranh trực tiếp với Provider bên thứ ba trên cùng marketplace. Máy first-party chịu đúng quy tắc của Provider thường: metering qua agent ([GPU-004](gpu-cloud-marketplace-decisions.md)), hardware verification ([GPU-005](gpu-cloud-marketplace-decisions.md)), bồi thường trừ thu nhập ([GPU-006](gpu-cloud-marketplace-decisions.md)); không có ưu đãi hiển thị ngoài quy tắc Discovery & Display chung ([SD-049](strategic-decisions.md)). Việc Ecoma vừa chủ sàn vừa là người cạnh tranh cần chính sách công bằng giá/ưu tiên cấp Ecosystem — theo dõi cùng [BL-39](../discovery-backlog.md).

**Liên quan:** [SD-045](provider-decisions.md), [SD-049](strategic-decisions.md), [GPU-004](gpu-cloud-marketplace-decisions.md), [GPU-005](gpu-cloud-marketplace-decisions.md), [GPU-006](gpu-cloud-marketplace-decisions.md), [BL-39](../discovery-backlog.md).

## GPU-012 — Consumption Model của Domain GPU

**Status:** Accepted  
**Liên quan:** SD-059 · SD-061 · SD-062 · SD-063 · SD-064 · LLM-021 · FIN-006

Domain GPU kế thừa cấu trúc tổ chức tiêu dùng dùng chung: Workspace bên dưới Consumer Organization ([LLM-021](llm-marketplace-decisions.md)), ví tiêu dùng dùng chung cấp Organization theo [FIN-006](financial-decisions.md), Membership role dùng chung với Permission gắn theo domain ([SD-063](strategic-decisions.md)). Khác với Domain LLM: Domain GPU không dùng API key — Consumer truy cập instance qua SSH với keypair đưa vào tại thời điểm provision ([SD-061](strategic-decisions.md)); limit tiêu dùng áp dụng ở cấp Workspace cho từng domain ([SD-062](strategic-decisions.md)). Khi Consumer Organization bị Terminated, truy cập instance bị thu hồi ngay theo [SD-064](strategic-decisions.md). Quyết định này thay thế GPU-007.
