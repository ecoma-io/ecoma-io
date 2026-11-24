# Provider Decisions

**Phạm vi:** Nhóm quyết định về Provider và chuyển đổi Provider. SD-015 và SD-017 liên quan cả phía Marketplace/Consumer; trong những trường hợp phù hợp, liên kết được đặt sang [strategic-decisions](strategic-decisions.md). Quy ước chung được quy định tại [README](README.md).

> Ngày quyết định không được ghi nhận.

## SD-014 — Provider as Service-Supplying Subject

**Status:** Accepted

Provider là chủ thể cung ứng dịch vụ hoặc tài nguyên; Provider chịu trách nhiệm đối với phần cung ứng thuộc phạm vi của mình, còn Ecoma chịu trách nhiệm đối với những cam kết do Ecoma đưa ra.

## SD-015 — Ecosystem-managed Marketplace Payment

**Status:** Accepted  
**Liên quan:** [SD-029](strategic-decisions.md), [SD-035](strategic-decisions.md), [SD-036](strategic-decisions.md)

Consumer thanh toán thông qua Ecoma. Ecoma quản lý dòng tiền, nghĩa vụ tài chính và việc thanh toán cho Provider. Tư cách pháp lý Merchant of Record chưa được xác định.

## SD-016 — Progressive Provider Trust

**Status:** Accepted

Provider có thể tham gia hệ sinh thái với những quyền hạn ban đầu giới hạn và được mở rộng theo mức độ xác minh, năng lực và độ tin cậy.

## SD-017 — Independent Provider and Consumer Organization Models

**Status:** Accepted

Provider và Consumer Organization là hai khái niệm nghiệp vụ độc lập, có mục đích, chính sách, quyền hạn và vòng đời riêng.

## SD-018 — Ecosystem-wide Provider Identity

**Status:** Accepted

Provider đăng ký danh tính với Ecoma một lần và có thể tham gia cung ứng trên nhiều Marketplace Product mà không phải đăng ký lại danh tính.

## SD-019 — Multiple Provider Representation

**Status:** Accepted

Một Ecoma Account có thể sở hữu một Individual Provider Identity và đại diện hoặc quản lý nhiều Organization Provider độc lập.

## SD-020 — Provider as Business Subject

**Status:** Accepted

Provider là cá nhân hoặc tổ chức thực sự tham gia cung ứng, gắn với Offering, trách nhiệm cung ứng và quyền lợi, nghĩa vụ thương mại; không chỉ là tài khoản hoặc gian hàng.

## SD-021 — Provider Identity-preserving Transformation

**Status:** Accepted  
**Liên quan:** [SD-024](provider-decisions.md) · [SD-025](provider-decisions.md) · [SD-028](provider-decisions.md)

Khi một Individual Provider chuyển đổi thành Organization Provider, danh tính Provider được giữ nguyên thay vì tạo Provider mới.

## SD-022 — Founder Continuity of Management

**Status:** Accepted

Sau chuyển đổi, Account của người sáng lập tiếp tục là người quản lý mặc định và có thể ủy quyền quản lý cho người khác. Quyền quản lý này không đồng nghĩa với việc người sáng lập tiếp tục là chủ thể chịu trách nhiệm pháp lý hoặc thương mại.

## SD-023 — Immutable Historical Obligations

**Status:** Accepted

Lịch sử và nghĩa vụ đã phát sinh được bảo toàn, xử lý theo trạng thái và chính sách có hiệu lực tại thời điểm phát sinh.

## SD-024 — Bidirectional Provider Transformation

**Status:** Accepted

Provider hỗ trợ chuyển đổi hai chiều giữa Individual Provider và Organization Provider.

## SD-025 — Operational Continuity During Transformation

**Status:** Accepted

Quá trình chuyển đổi Provider không làm gián đoạn hoặc thay đổi hoạt động cung cấp dịch vụ hiện hữu.

## SD-026 — Transformation Requires Verification and Approval

**Status:** Accepted

Chuyển đổi chỉ có hiệu lực sau khi được xác minh và phê duyệt. Trong thời gian chờ, Provider tiếp tục hoạt động theo trạng thái và chính sách hiện hành.

## SD-027 — Status-bound Financial Balances

**Status:** Accepted

Mỗi khoản số dư và quyền lợi tài chính được phân loại theo trạng thái Provider tại thời điểm phát sinh và tiếp tục tuân theo chính sách tương ứng sau chuyển đổi.

## SD-028 — Offering and Service Continuity

**Status:** Accepted

Chuyển đổi trạng thái Provider không yêu cầu tạo lại, chuyển giao hoặc xác minh lại các Offering hiện hữu chỉ vì thay đổi trạng thái.

## SD-042 — Two-stage Provider Trust

**Status:** Accepted  
**Liên quan:** [SD-016](provider-decisions.md) · [SD-018](provider-decisions.md) · [FIN-002](financial-decisions.md)

Provider Trust gồm hai giai đoạn:

- **Activated:** Provider nộp giấy tờ theo nhóm đối tượng — cá nhân: giấy tờ tùy thân; hộ kinh doanh: giấy chứng nhận đăng ký hộ kinh doanh và giấy tờ của chủ hộ kinh doanh; doanh nghiệp: giấy chứng nhận đăng ký doanh nghiệp và giấy tờ của người đại diện pháp luật. Khi giấy tờ đầy đủ, Provider được kích hoạt ngay để cung cấp dịch vụ.
- **Verified:** điều kiện để được rút tiền từ Earning balance. Điều kiện và quy trình để đạt Verified chưa được quyết định — xem [Discovery Backlog](../discovery-backlog.md).

Khi phát hiện vấn đề trùng lặp thông tin trong quá trình xác minh, Ecoma có thể yêu cầu xác minh bổ sung (chụp ảnh hoặc quay video đang cầm giấy tờ). Ngay cả khi đã Verified, nếu phát hiện dấu hiệu abuse, Ecoma vẫn có thể yêu cầu xác minh thêm.

Quy trình Trust áp dụng ở cấp Ecosystem theo [SD-018](provider-decisions.md): một quy trình xác minh dùng chung cho mọi Product; Product không yêu cầu xác minh lại.

## SD-043 — Single Owner của Organization Provider

**Status:** Accepted  
**Liên quan:** [SD-019](provider-decisions.md) · [SD-022](provider-decisions.md)

Organization Provider — bất kể nhóm đối tượng (cá nhân, hộ kinh doanh hay doanh nghiệp) khi vận hành dưới dạng tổ chức — có **đúng một Owner** và được phép có nhiều **Member**; mỗi Membership đi kèm danh sách quyền.

Ghi chú: hình thức này chủ ý tương tự mô hình Owner/Member của Consumer Organization nhưng là quyết định riêng cho Provider, không phải sự kế thừa máy móc; các quy tắc chi tiết (Owner đầu tiên, chuyển quyền sở hữu, rời/bị loại, mời lại) chưa được quyết định — xem [Discovery Backlog](../discovery-backlog.md).

## SD-044 — Provider-controlled Offering Lifecycle

**Status:** Accepted  
**Liên quan:** [SD-028](provider-decisions.md) · [SD-034](strategic-decisions.md)

Offering được tạo cùng Provider; việc thay đổi, tạm dừng và xóa bỏ Offering do Provider quyết định. Khi Provider chuyển đổi loại hình tư cách pháp lý, Offering giữ nguyên (bổ sung cho [SD-028](provider-decisions.md)).

Phạm vi: quyết định này áp dụng cho Provider-owned Offering; vòng đời Product-owned Offering chưa được quyết định — xem [Discovery Backlog](../discovery-backlog.md).

## SD-045 — Provider Service Measurement Instead of End-to-end Guarantee

**Status:** Accepted  
**Liên quan:** [SD-014](provider-decisions.md) · [SD-029](strategic-decisions.md) · [SD-035](strategic-decisions.md) · [SD-036](strategic-decisions.md)

Ecoma không cam kết bảo đảm chất lượng dịch vụ đầu cuối đối với phần cung ứng của Provider. Vai trò của Ecoma là **đo lường và công khai**: healthcheck liên tục API endpoint và inference của Provider, benchmark các model từ Provider, đánh giá xem Provider có cung cấp chính xác model mà họ công bố hay không, và công khai các chỉ số này. Mọi cam kết dịch vụ vượt quá mặc định này (nếu có) vẫn là quyết định của từng Product theo [SD-036](strategic-decisions.md).

Ví dụ theo Product (đặc thù Product, không bắt buộc dùng chung): LLM Marketplace có tính năng Alias cho phép người dùng trỏ đến nhiều model của nhiều Provider và chọn thuật toán fallback; GPU Cloud Marketplace công khai các metrics về uptime và tốc độ mạng.

## SD-050 — Tạo, chuyển giao và membership của Organization Provider

**Status:** Accepted  
**Liên quan:** [SD-016](provider-decisions.md) · [SD-019](provider-decisions.md) · [SD-022](provider-decisions.md) · [SD-043](provider-decisions.md) · [SD-046](strategic-decisions.md) · [SD-047](strategic-decisions.md)

Organization Provider được tạo trực tiếp bởi một Account đã có Provider Identity; Account tạo trở thành Owner đầu tiên. Trust của Provider bắt đầu ở mức tối thiểu theo SD-016 và KYC thực hiện theo nhóm đối tượng doanh nghiệp theo SD-047, không kế thừa trust của Account.

Quyền sở hữu được chuyển giao cho một Member đang hoạt động; Owner không thể rời hoặc bị loại khi chưa chuyển giao xong; Owner cũ trở thành Member thường. Danh nghĩa thương mại và nghĩa vụ lịch sử của Provider không thay đổi khi chuyển giao, theo SD-023.

Nội dung danh sách quyền của Member do từng Product định nghĩa; SD-043 duy trì invariant cấu trúc (đúng một Owner, mỗi Membership mang danh sách quyền) còn nội dung là chính sách Product theo khung SD-046.

Member rời Organization Provider tự nguyện không cần phê duyệt. Việc loại Member thực hiện trong phạm vi quyền member-management được cấp. Mời lại được thực hiện ngay sau khi Member rời hoặc bị loại, với lifecycle Membership mới độc lập.

## SD-053 — Trách nhiệm cung ứng của Composite Offering

**Status:** Accepted  
**Liên quan:** [SD-014](provider-decisions.md) · [SD-020](provider-decisions.md) · [SD-033](provider-decisions.md) · [SD-034](strategic-decisions.md) · [SD-035](strategic-decisions.md) · [SD-045](provider-decisions.md)

Với Offering tổng hợp nhiều nguồn cung (Composite Offering), mỗi Provider chịu trách nhiệm đối với phần cung ứng thuộc phạm vi của mình, kể cả khi phần cung ứng đó được gộp vào một Offering tổng hợp. Việc gộp nhiều nguồn cung thành một Offering không chuyển trách nhiệm cung ứng sang bên thực hiện gộp (Ecoma hoặc Product). Ecoma vẫn chịu trách nhiệm đối với những cam kết do Ecoma tự đưa ra theo SD-014 và SD-036; mặc định Ecoma không bảo đảm dịch vụ đầu cuối theo SD-045.
