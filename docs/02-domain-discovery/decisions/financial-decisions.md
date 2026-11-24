# Financial Decisions

Các quyết định về balance, settlement và thanh toán giữa Ecoma, Consumer và Provider. Quy ước chung được quy định tại [README](README.md).

## FIN-001 — Dual Financial Balance

**Status:** Accepted
Ecoma duy trì hai loại balance riêng biệt cho hai chủ thể:

- **Usage balance**: thuộc Consumer Organization; tiền nạp vào dùng để thanh toán dịch vụ của Ecoma; sau khi nạp **không được hoàn trả**.
- **Earning balance**: thuộc Provider (Individual hoặc Organization); mỗi lần Consumer sử dụng dịch vụ, số tiền tương ứng được cộng vào Earning balance ngay (realtime).

## FIN-002 — Earning Balance Settlement

**Status:** Accepted

- Số dư trong Earning balance được chốt vào ngày cuối cùng của tháng.
- Số tiền available = số dư của tháng trừ đi thuế và phí; available được rút sau 20 ngày từ ngày chốt.
- Earning balance có thể chuyển sang Usage balance bất cứ lúc nào (trừ đi các khoản phí, không chịu thuế); sau khi chuyển, tuân theo quy tắc của Usage balance (không hoàn lại, chỉ dùng cho dịch vụ của Ecoma).
- Việc rút tiền hoặc chuyển Earning sang Usage phải do Owner thực hiện hoặc do người được cấp quyền rút tiền.

## FIN-003 — Earning Balance Bị Mất Khi Terminate

**Status:** Accepted
Khi Provider Organization hoặc Individual Provider Identity bị terminate hoặc xóa, số dư trong Earning balance chưa được rút sẽ bị mất. Việc rút tiền đòi hỏi yêu cầu chủ động của user; khi terminate, Provider mất quyền truy cập vào Org/Provider Identity nên không thể yêu cầu rút tiền.

Quyết định này xác định phạm vi áp dụng của [SD-023](provider-decisions.md) (Immutable Historical Obligations) trong mối quan hệ Ecoma–Provider: nghĩa vụ đã phát sinh được bảo toàn cho đến khi terminate; khi terminate mà user chưa thực hiện yêu cầu rút tiền, số dư còn lại bị mất là hệ quả của việc user không rút trước khi terminate.

**Liên quan:** [SD-014](provider-decisions.md), [SD-015](provider-decisions.md), [SD-023](provider-decisions.md).

## FIN-004 — Ecosystem Financial Infrastructure

**Status:** Accepted
Hai loại balance ([FIN-001](financial-decisions.md)) và chu kỳ settlement ([FIN-002](financial-decisions.md)) là hạ tầng tài chính dùng chung cấp Ecosystem, áp dụng mặc định cho mọi Product. Product được phép thay thế bằng mô hình thương mại riêng nếu mô hình của nó không phù hợp. Việc thay thế phải kèm khai báo override theo [SD-046](strategic-decisions.md).

**Liên quan:** [SD-015](provider-decisions.md), [SD-030](strategic-decisions.md), [SD-040](strategic-decisions.md), [SD-046](strategic-decisions.md).

## FIN-005 — Ecosystem Commission Cash Flow

**Status:** Accepted
Ecoma thu tiền từ Consumer, trừ các khoản hoa hồng và thuế phí, rồi thanh toán cho Provider. Tư cách pháp lý Merchant of Record của Ecoma vẫn chưa được quyết định — xem [Discovery Backlog](../discovery-backlog.md).

**Liên quan:** [SD-015](provider-decisions.md), [FIN-002](financial-decisions.md).

## FIN-006 — Usage Balance dùng chung cấp Organization

**Status:** Accepted
Một Consumer Organization có một Usage balance dùng chung trong phạm vi Product; mọi Subscription của Organization đó rút từ pool chung. Đây là mặc định Ecosystem: Product được phủ sang mô hình cấp phát theo từng Subscription khi mô hình kinh doanh cần, kèm khai báo override theo SD-046. Giới hạn tiêu dùng theo Member thuộc chính sách của từng Product.

**Liên quan:** [FIN-001](financial-decisions.md), [FIN-004](financial-decisions.md), [ORG-006](consumer-organization-decisions.md), [SD-046](strategic-decisions.md).

## FIN-007 — Hành vi khi Usage không đủ

**Status:** Accepted
Khi Usage balance không còn đủ cho dịch vụ, mặc định của hệ sinh thái là từ chối khởi phát đơn vị tiêu dùng mới; công việc đã được bảo đảm nguồn (reservation) được hoàn tất. Reservation là giữ chỗ trên pool, không phải trừ tiền; việc trừ Usage và cộng Earning thực hiện theo tiêu thụ thực tế, nhất quán với FIN-001. Mặc định Ecosystem, Product được phủ kèm khai báo theo SD-046. Biên độ bảo đảm nguồn cho Provider đang bị đình chỉ hoặc thuộc hồ sơ rủi ro cần được giới hạn, theo dõi tại BL-31 của Discovery Backlog.

**Liên quan:** [FIN-001](financial-decisions.md), [FIN-006](financial-decisions.md).

## FIN-008 — Đóng băng rút Earning khi đình chỉ cấp hệ sinh thái

**Status:** Accepted
Khi Provider bị đình chỉ cấp hệ sinh thái, khả năng rút Earning balance bị đóng băng bắt buộc. Số dư đã tích lũy vẫn thuộc quyền sở hữu của Provider và được giải tỏa khi Provider hồi phục hoặc theo kết luận xử lý. Đình chỉ cục bộ theo Product không ảnh hưởng quyền rút Earning.

**Liên quan:** [FIN-002](financial-decisions.md), [FIN-003](financial-decisions.md), [SD-048](strategic-decisions.md).

## FIN-009 — Chargeback trên tiền nạp

**Status:** Accepted

Tiền nạp khả dụng cho tiêu dùng ngay khi giao dịch nạp thành công. Khi chargeback xảy ra trên rail thanh toán, Usage balance của Organization trở thành âm tạm; Organization bị chặn khởi phát tiêu dùng mới theo FIN-007 cho tới khi nạp bù về mức không âm. Công việc đã được bảo đảm nguồn trước thời điểm chargeback vẫn được hoàn tất theo FIN-007. Biên độ âm bị chặn tự nhiên bởi tổng tiền đã nạp qua rail thanh toán.

Tiền nạp không hoàn trả về rail thanh toán theo FIN-001; khi dịch vụ không cung cấp được, reservation được giải phóng về Usage balance. Ràng buộc này là bắt buộc toàn hệ sinh thái vì bảo vệ tính toàn vẹn của hạ tầng số dư dùng chung theo FIN-004.

**Liên quan:** [FIN-001](financial-decisions.md), [FIN-004](financial-decisions.md), [FIN-007](financial-decisions.md), [ORG-014](consumer-organization-decisions.md).
