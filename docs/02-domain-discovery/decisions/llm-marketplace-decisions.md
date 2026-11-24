# LLM Marketplace Decisions

Các quyết định discovery cấp domain cho Domain LLM (LLM Marketplace) — domain discovery đầu tiên theo [SD-059](strategic-decisions.md). Quyết định trong file này thuộc phạm vi domain-level theo SD-030 (đọc theo SD-059) và cơ chế phân cấp SD-046: chúng điều tiết các mặc định Ecoma Platform đã chốt trong các register khác cho domain này, không thay thế các quyết định đó. Quy ước chung được quy định tại [README](README.md).

## LLM-001 — Gateway Serving Model

**Status:** Accepted
Mọi request inference của LLM Marketplace đi qua hạ tầng Ecoma: authentication, admission, routing, provider dispatch, usage metering và financial settlement đều do Ecoma thực hiện. Đây là khai báo phạm vi cam kết của Ecoma với Consumer theo SD-036 cho Product này, hiện thực vai trò trung gian Marketplace theo SD-054. Hệ quả: Ecoma giữ credential upstream do Provider cung cấp và tự đo usage từ response upstream, không phụ thuộc báo cáo của Provider.

**Liên quan:** [SD-035](strategic-decisions.md), [SD-036](strategic-decisions.md), [SD-054](strategic-decisions.md), [LLM-026](llm-marketplace-decisions.md).

## LLM-002 — Intermediary Only, No Foundation Model

**Status:** Accepted
Ecoma không tự huấn luyện và không sở hữu model nền tảng trong LLM Marketplace; mọi Offering do Provider cung ứng. Không tồn tại Product-owned Offering trong Product này (theo hướng sở hữu của SD-034 và vai trò của SD-054). First-Party Provider không làm Product sở hữu Offering — xem LLM-024.

**Liên quan:** [SD-029](strategic-decisions.md), [SD-034](strategic-decisions.md), [SD-054](strategic-decisions.md), [LLM-024](llm-marketplace-decisions.md).

## LLM-003 — OpenAI-Compatible Public API

**Status:** Accepted
API công khai của LLM Marketplace tương thích giao thức OpenAI cho các endpoint inference chính (model listing, chat completion, completion, embedding): một ứng dụng dùng OpenAI SDK chuyển sang Ecoma bằng đổi base URL và credential. Tương thích giao thức không đồng nghĩa cam kết hỗ trợ toàn bộ tính năng OpenAI. Contract chi tiết thuộc lớp design.

**Liên quan:** [LLM-022](llm-marketplace-decisions.md).

## LLM-004 — Offering Structure

**Status:** Accepted
Một Offering trong LLM Marketplace gồm model, capability, giá và trạng thái. Endpoint và credential là tài nguyên riêng, được Offering tham chiếu; một Offering tham chiếu được nhiều endpoint (LLM-007).

**Liên quan:** [SD-034](strategic-decisions.md), [LLM-006](llm-marketplace-decisions.md), [LLM-007](llm-marketplace-decisions.md), [LLM-013](llm-marketplace-decisions.md).

## LLM-005 — Offering Lifecycle

**Status:** Accepted
Vòng đời Offering gồm bốn trạng thái: `draft` → `active` → `inactive` → `retired`; Provider kiểm soát việc chuyển trạng thái. Đây là điều tiết SD-044 cho LLM Marketplace; Product này không có Product-owned Offering (LLM-002).

**Liên quan:** [SD-044](provider-decisions.md), [LLM-002](llm-marketplace-decisions.md).

## LLM-006 — No Cross-Provider Model Normalization

**Status:** Accepted
Không tồn tại lớp chuẩn hóa danh tính model xuyên provider. Consumer lựa chọn và so sánh theo từng Offering; routing làm việc trực tiếp trên Offering, không qua danh tính model chuẩn hóa.

**Liên quan:** [LLM-004](llm-marketplace-decisions.md), [LLM-008](llm-marketplace-decisions.md).

## LLM-007 — Endpoint Pool and Health

**Status:** Accepted
Một Offering tham chiếu nhiều upstream endpoint (chính, dự phòng, theo khu vực). Mỗi endpoint có trạng thái health: `healthy`, `degraded`, `down`. Thứ tự ưu tiên giữa các endpoint và cấu hình fallback do Provider thiết lập.

**Liên quan:** [LLM-004](llm-marketplace-decisions.md), [LLM-010](llm-marketplace-decisions.md).

## LLM-008 — Model Alias

**Status:** Accepted
Consumer định nghĩa Model Alias — tên logic của riêng mình — ánh xạ đến danh sách candidate Offering kèm routing policy. Consumer thay đổi alias hoặc policy mà không phụ thuộc Provider.

**Liên quan:** [LLM-004](llm-marketplace-decisions.md), [LLM-009](llm-marketplace-decisions.md).

## LLM-009 — Routing Strategies and SD-049 Reading

**Status:** Accepted
Consumer chọn routing strategy cho alias của mình: `priority`, `round_robin`, `weighted`, `lowest customer price`. Diễn giải SD-049 áp dụng tại LLM Marketplace: SD-049 cấm yếu tố thương mại phía Ecoma (hoa hồng, ưu đãi) điều routing; tiêu chí Consumer tự chọn cho routing của mình — kể cả giá — là quyền nghiệp vụ của Consumer, không vi phạm SD-049.

**Liên quan:** [SD-049](strategic-decisions.md), [LLM-008](llm-marketplace-decisions.md).

## LLM-010 — Fallback and Retry Safety

**Status:** Accepted
Fallback gồm hai cấp: endpoint khác trong cùng Offering, sau đó Offering khác trong danh sách candidate. Ba bất biến: (1) không retry khi chưa biết provider đã thực thi request hay chưa (không blind retry); (2) không chuyển provider khi dữ liệu đầu ra đã stream tới client; (3) usage ghi nhận theo attempt chỉ phục vụ kiểm toán và đối soát, không dùng để tính tiền Consumer.

**Liên quan:** [LLM-007](llm-marketplace-decisions.md), [LLM-018](llm-marketplace-decisions.md).

## LLM-011 — Usage Components

**Status:** Accepted
Usage được chuẩn hóa gồm năm thành phần: `input_tokens`, `output_tokens`, `cached_tokens`, `reasoning_tokens`, `request_count`. Cached tokens là tập con của input tokens; reasoning tokens là tập con của output tokens; các nhóm không được cộng trùng.

**Liên quan:** [LLM-012](llm-marketplace-decisions.md), [LLM-013](llm-marketplace-decisions.md).

## LLM-012 — Usage Data Quality States

**Status:** Accepted
Dữ liệu usage của một request thuộc một trong bốn trạng thái: `known`, `missing`, `malformed`, `partial`. Thiếu dữ liệu usage không được hiểu là 0 token; trạng thái thiếu được ghi nhận để xử lý và đối soát sau này.

**Liên quan:** [LLM-011](llm-marketplace-decisions.md).

## LLM-013 — Multi-Component Pricing

**Status:** Accepted
Giá của một Offering gồm hai nhóm: phí theo request và giá theo token cho input, output, cached, reasoning. Thành phần này đối chiếu 1-1 với usage components (LLM-011) và không cộng trùng nhóm con.

**Liên quan:** [LLM-011](llm-marketplace-decisions.md), [LLM-014](llm-marketplace-decisions.md), [LLM-015](llm-marketplace-decisions.md).

## LLM-014 — Peak/Off-Peak Pricing

**Status:** Accepted
Bảng giá được phân biệt theo khung giờ peak và off-peak; múi giờ, ngày áp dụng, giờ bắt đầu, giờ kết thúc là cấu hình của bảng giá, không mặc định UTC.

**Liên quan:** [LLM-013](llm-marketplace-decisions.md), [LLM-015](llm-marketplace-decisions.md).

## LLM-015 — Versioned Price and Request Snapshot

**Status:** Accepted
Thay đổi bảng giá tạo version mới; không sửa bảng giá đã được sử dụng. Mỗi request gắn snapshot bảng giá tại thời điểm tạo; request đang thực thi không đổi giá khi Provider cập nhật. Mục đích: quyết toán và kiểm toán truy vết được số tiền của từng request.

**Liên quan:** [LLM-013](llm-marketplace-decisions.md), [LLM-016](llm-marketplace-decisions.md).

## LLM-016 — Admission Control Before Dispatch

**Status:** Accepted
Trước khi gọi upstream, gateway thực hiện theo thứ tự: kiểm tra quota còn lại, xác định giá của model, tính cận trên chi phí có thể phát sinh, kiểm tra số dư và giữ trước khoản tương ứng. Charge không được vượt quá phần đã giữ trước; phần giữ dư được giải phóng sau khi quyết toán theo chi phí thực tế. Đây là điều tiết FIN-007 cho LLM Marketplace.

**Liên quan:** [FIN-007](financial-decisions.md), [LLM-017](llm-marketplace-decisions.md), [LLM-018](llm-marketplace-decisions.md).

## LLM-017 — Dual Reservation Types

**Status:** Superseded
Hai cơ chế giữ hạn mức độc lập, có định danh riêng: Quota Reservation (giữ quyền tiêu dùng tài nguyên, kiểm soát giới hạn token/request) và Financial Reservation (giữ trước khoản tiền trên Usage balance, kiểm soát khả năng chi trả). Financial Reservation là hiện thực của Reservation theo FIN-007 tại Product này.

**Liên quan:** [FIN-007](financial-decisions.md), [LLM-016](llm-marketplace-decisions.md), [LLM-031](llm-marketplace-decisions.md).

## LLM-018 — Single Charge per Logical Request

**Status:** Accepted
Tiền thu của Consumer được quyết toán theo logical request, đúng một lần. Một logical request có thể gồm nhiều provider attempt (thử endpoint, fallback); attempt-level usage chỉ phục vụ kiểm toán, đối soát và phân tích (LLM-010), không nhân đôi charge.

**Liên quan:** [LLM-010](llm-marketplace-decisions.md), [LLM-016](llm-marketplace-decisions.md).

## LLM-019 — Double-Entry Ledger Derived Balance

**Status:** Accepted
Sổ ghi kép (double-entry ledger) là nguồn chân lý tài chính; số dư không được lưu thành con số độc lập mà suy ra từ lịch sử ledger. Wallet trong LLM Marketplace là hiện thực của Usage balance theo FIN-001 và FIN-006 tại Product này.

**Liên quan:** [FIN-001](financial-decisions.md), [FIN-006](financial-decisions.md), [LLM-020](llm-marketplace-decisions.md).

## LLM-020 — Refund as Ledger Adjustment

**Status:** Accepted
Refund/Adjustment trong LLM Marketplace chỉ là hiệu chỉnh kế toán: sửa sai số, đối soát, xử lý chargeback theo FIN-009. Không hoàn tiền về rail thanh toán cho Consumer — nhất quán FIN-001 (nạp không hoàn trả).

**Liên quan:** [FIN-001](financial-decisions.md), [FIN-009](financial-decisions.md), [LLM-019](llm-marketplace-decisions.md).

## LLM-021 — Workspace

**Status:** Accepted
Consumer Organization trong LLM Marketplace có thêm cấp Workspace bên dưới Organization: một Organization có nhiều Workspace, phân quyền của Member và quota có thể giới hạn theo Workspace. Workspace không thay đổi cấu trúc Owner/Membership đã chốt ở MEM-001–MEM-018.

**Liên quan:** [ORG-001](consumer-organization-decisions.md), [MEM-005](membership-decisions.md), [MEM-006](membership-decisions.md).

## LLM-022 — API Key Lifecycle

**Status:** Accepted
Consumer quản lý vòng đời API key: cấp cho ứng dụng, xác thực trên mỗi request, thu hồi. Mỗi request được gắn với Organization và API key tương ứng. API key là credential scoped hành động thay mặt chủ thể ủy quyền theo ID-013.

**Liên quan:** [ID-013](account-identity-decisions.md), [LLM-025](llm-marketplace-decisions.md).

## LLM-023 — Provider Governance Operations

**Status:** Accepted
Vận hành governance phía Provider tại LLM Marketplace gồm: hồ sơ pháp lý, hồ sơ thuế, xác minh tài liệu, quản lý trạng thái đủ điều kiện kinh doanh (eligibility), restriction và khiếu nại (appeal). Vận hành theo khung trust hai giai đoạn (SD-042, SD-047) và đình chỉ lan truyền theo phân loại vi phạm (SD-048); tiêu chí chứng nhận và điều kiện đình chỉ cụ thể còn mở tại BL-22.

**Liên quan:** [SD-042](provider-decisions.md), [SD-047](strategic-decisions.md), [SD-048](strategic-decisions.md), [BL-22](../discovery-backlog.md).

## LLM-024 — First-Party Provider Class

**Status:** Accepted
First-Party Provider — Provider do Ecoma vận hành — là hạng Provider riêng vĩnh viễn trong LLM Marketplace, với ba quy tắc: (1) không trải progressive trust: danh tính của Ecoma đã được biết sẵn, là ngoại lệ có cơ sở của SD-016/SD-047 trong phạm vi Product này; (2) không tích lũy payable và không có payout, vì cùng thực thể với Ecoma trong quan hệ tài chính; (3) vị trí đặc biệt (nếu có) chỉ nằm ở Discovery & Display, không có ưu đãi routing, theo SD-049. First-Party Provider vẫn được đo và công khai metric như Provider khác (SD-045). Câu hỏi nâng khái niệm này lên cấp Ecosystem theo dõi tại BL-39.

**Liên quan:** [SD-016](provider-decisions.md), [SD-045](provider-decisions.md), [SD-047](strategic-decisions.md), [SD-049](strategic-decisions.md), [FIN-005](financial-decisions.md), [BL-39](../discovery-backlog.md).

## LLM-025 — API Key Security

**Status:** Accepted
Plaintext của API key chỉ xuất hiện đúng một lần khi bootstrap; lưu trữ duy nhất dạng hash. Không phát lại plaintext khi chạy bootstrap lần nữa; key đã bị revoke bị chặn vĩnh viễn; không ghi plaintext vào log.

**Liên quan:** [LLM-022](llm-marketplace-decisions.md).

## LLM-026 — Provider Credential Security

**Status:** Accepted
Credential upstream được phân biệt theo Provider và upstream provider; database chỉ lưu hash, plaintext nằm trong cấu hình triển khai/secret. Rotation phải thu hồi credential cũ; không khôi phục một credential đã bị revoke bằng cách đưa lại cấu hình cũ.

**Liên quan:** [LLM-001](llm-marketplace-decisions.md).

## LLM-027 — No Prompt and Response Body Logging

**Status:** Accepted
Journal không ghi prompt và response body của request inference; chỉ ghi metadata, trạng thái thực thi, usage và kết quả xử lý.

**Liên quan:** [LLM-011](llm-marketplace-decisions.md).

## LLM-028 — Offering Verification Before Active

**Status:** Accepted
Ecoma phải verify endpoint của Offering trước khi Offering chuyển sang `active`; khi Provider cập nhật Offering, Ecoma verify lại mới áp dụng thay đổi. Hệ quả: Ecoma tự đo và xác nhận kết nối upstream thay vì phụ thuộc báo cáo của Provider, nhất quán nguyên tắc Ecoma đo lường thay vì bảo đảm đầu cuối ([SD-045](provider-decisions.md)).

**Liên quan:** [SD-045](provider-decisions.md), [LLM-005](llm-marketplace-decisions.md), [LLM-007](llm-marketplace-decisions.md), [LLM-010](llm-marketplace-decisions.md).

## LLM-029 — API Key Scope: Workspace and Optional Limits

**Status:** Accepted
API key gắn với Workspace của Consumer Organization. Giới hạn tiêu dùng chia thành hai cấp: cấp Workspace và cấp API key (optional limits, tuỳ chọn). Key không thay đổi cấu trúc Owner/Membership (MEM-001–MEM-018).

**Liên quan:** [LLM-021](llm-marketplace-decisions.md), [LLM-022](llm-marketplace-decisions.md), [LLM-017](llm-marketplace-decisions.md), [MEM-001](membership-decisions.md).

## LLM-030 — No Provider Cost Data; Commission-Only Model

**Status:** Accepted
Ecoma không duy trì dữ liệu chi phí upstream (provider cost) trong LLM Marketplace; Product không có khái niệm chi phí vốn theo Offering. Doanh thu của Ecoma lấy từ hoa hồng trên giá bán ([FIN-005](financial-decisions.md)); mức hoa hồng cụ thể thuộc cấu hình thương mại, không thuộc discovery.

**Liên quan:** [FIN-005](financial-decisions.md), [LLM-013](llm-marketplace-decisions.md), [LLM-014](llm-marketplace-decisions.md).

## LLM-031 — Single Reservation: Unified Price Estimate

**Status:** Accepted
Reservation trong LLM Marketplace là một cơ chế duy nhất: ước lượng giá (cận trên chi phí) của một request trước khi dispatch. Khoản ước lượng được kiểm tra đồng thời với ba ràng buộc: Usage balance còn đủ (ngăn âm balance) và limit còn lại ở cấp Workspace và cấp API key ([LLM-029](llm-marketplace-decisions.md)) không bị vượt; thiếu ở bất kỳ ràng buộc nào thì từ chối khởi phát request. Reservation là giữ chỗ, không trừ tiền; charge thực tế không vượt phần đã ước lượng, phần dư giải phóng sau quyết toán ([LLM-016](llm-marketplace-decisions.md)). Quyết định này thay thế LLM-017; là hiện thực của Reservation theo FIN-007 tại Product này.

**Liên quan:** [LLM-016](llm-marketplace-decisions.md), [LLM-029](llm-marketplace-decisions.md), [FIN-007](financial-decisions.md).

## LLM-032 — Offering Display Content

**Status:** Accepted
Offering có nội dung hiển thị do Provider soạn (mô tả, giới thiệu) phục vụ Discovery & Display — đây là nội dung mang tính content marketing, tách rời dữ liệu nghiệp vụ của Offering (model, capability, giá, trạng thái theo LLM-004). Nguyên tắc ở mức discovery:

- Nội dung hiển thị là **optional**: Offering không có nội dung hiển thị vẫn hoạt động đầy đủ về nghiệp vụ — routing, admission, serving không phụ thuộc nội dung này.
- Nội dung hiển thị **không điều routing** và không phải tiêu chí Service Routing — nhất quán SD-049.
- Đa ngữ cho nội dung hiển thị là chính sách của Product theo [SD-055](strategic-decisions.md): Ecoma không cam kết dịch nội dung Provider; khi người xem không có bản theo locale của mình, hiển thị theo phương thức hiển thị mặc định của Product (bản gốc hoặc bản English tùy chính sách Product).
- Cấu trúc dữ liệu của nội dung hiển thị (gồm quan hệ giữa các bản ngôn ngữ, ngôn ngữ gốc) thuộc bước domain design — không quyết định ở mức discovery.

**Liên quan:** [LLM-004](llm-marketplace-decisions.md), [SD-049](strategic-decisions.md), [SD-055](strategic-decisions.md), [SD-054](strategic-decisions.md).

## LLM-033 — Consumption Limit Administration

**Status:** Accepted
Limit tiêu dùng ở cấp Workspace và cấp API key được đặt và quản lý bởi Owner và các Member được cấp quyền tương ứng ([LLM-029](llm-marketplace-decisions.md)); phạm vi thao tác theo quyền hạn đã được cấp trong mô hình Membership ([MEM-002](membership-decisions.md)–[MEM-007](membership-decisions.md)). Limit là cấu hình phía Consumer Organization.

**Liên quan:** [LLM-029](llm-marketplace-decisions.md), [LLM-031](llm-marketplace-decisions.md), [MEM-002](membership-decisions.md), [MEM-005](membership-decisions.md).
