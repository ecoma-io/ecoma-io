# Account & Identity Decisions

Các quyết định về Ecoma Account và Identity. Quy ước chung được quy định tại [README](README.md).

> Ngày quyết định không được ghi nhận.

## ID-001 — Shared Ecoma Account

**Status:** Accepted  
**Liên quan:** [SD-012](strategic-decisions.md)

Một Account được sử dụng làm danh tính chung để xác thực xuyên hệ sinh thái; quyền truy cập và quyền hạn vẫn do từng sản phẩm quyết định.

## ID-002 — Standards-based Identity Integration

**Status:** Accepted

Tích hợp danh tính ưu tiên các chuẩn OIDC, OAuth2, JWKS, MFA và cơ chế quản lý token theo tiêu chuẩn.

## ID-003 — Delegated Application/Agent Access

**Status:** Accepted

Application hoặc Agent có thể được User ủy quyền truy cập thông qua OAuth2 với scope giới hạn; mô hình Machine/Agent Identity độc lập chưa được quyết định.

## ID-004 — Passwordless Authentication

**Status:** Accepted

Hệ thống sử dụng xác thực không mật khẩu và không lưu trữ mật khẩu người dùng.

## ID-005 — Email OTP Verification

**Status:** Accepted

Email OTP chỉ chứng minh người dùng kiểm soát địa chỉ email tại thời điểm xác minh, không chứng minh danh tính pháp lý hoặc danh tính con người.

## ID-006 — Unique Account Email

**Status:** Accepted

Một địa chỉ email chỉ được liên kết với tối đa một Account tại cùng một thời điểm.

## ID-007 — Verified Email Change

**Status:** Accepted

User có thể thay đổi email Account; email mới chỉ được xác minh sau khi hoàn thành OTP và không được đang thuộc Account khác.

## ID-008 — Invitation Email Binding

**Status:** Accepted

Invitation được cố định với email đích tại thời điểm tạo; việc Account thay đổi email không tự động thay đổi email nhận Invitation.

## ID-009 — Independent Account Lifecycle

**Status:** Accepted

Vòng đời Account độc lập với vòng đời Organization.

## ID-010 — Account Closure Preconditions

**Status:** Accepted
Một Account chỉ được xóa khi đầy đủ các điều kiện sau:

1. Không còn sở hữu bất kỳ Consumer Organization nào (điều kiện xóa Organization do từng Product quy định: LLM/GPU bất cứ lúc nào; Object Storage chỉ khi không còn dữ liệu).
2. Đã chấm dứt Individual Provider Identity nếu có.
3. Đã xử lý xong số dư tài chính theo chính sách hiện tại (usage balance không hoàn trả; earning balance phải được rút trước khi terminate).

Org mà Account chỉ là Member (không phải Owner) không chặn việc xóa Account; Membership của Account đó kết thúc tự động khi Account bị xóa ([MEM-013](membership-decisions.md)).

Việc xóa Account không tự động terminate các Org — user phải chủ động xóa từng Org trước. Tình trạng Terminated ≠ xóa dữ liệu ngay: dữ liệu được giữ theo chính sách retention của Product và nghĩa vụ còn tồn tại tiếp diễn ([ORG-012](consumer-organization-decisions.md), [ORG-014](consumer-organization-decisions.md)).

**Liên quan:** [ID-009](account-identity-decisions.md) (vòng đời Account độc lập với Organization; ID-010 là điều kiện thao tác do user chủ động thực hiện, không thay đổi bản chất độc lập vòng đời), [FIN-001–FIN-003](financial-decisions.md), [ORG-001–ORG-014](consumer-organization-decisions.md), [MEM-013](membership-decisions.md).

## ID-011 — Account Suspension

**Status:** Accepted  
**Liên quan:** [ID-009](account-identity-decisions.md) · [ID-010](account-identity-decisions.md) · [SD-048](strategic-decisions.md) · [SD-050](provider-decisions.md)

Account suspension là tạm ngưng có tính đảo ngược: authentication và mọi authorization của Account bị chấm dứt ngay (session, token, credential).

Hiệu ứng lan theo quyền sở hữu: mọi chủ thể do Account làm Owner dừng hoạt động, gồm Consumer Organization, Organization Provider và Individual Provider. Membership bình thường của Account (không phải Owner) chỉ mất truy cập của riêng Account đó; Organization đó vẫn vận hành.

Việc chủ thể bị đóng băng theo Owner được xử lý theo nguyên nhân suspension:

- Suspension vì vi phạm (ví dụ gian lận, lạm dụng): đóng băng tuyệt đối, không thao tác nào trên chủ thể (kể cả chuyển giao quyền sở hữu) tới khi Account hồi phục hoặc bị closure.
- Suspension vì lý do an toàn, pháp lý hoặc kỹ thuật: cho phép chuyển giao quyền sở hữu sang Member đủ điều kiện để chủ thể hoạt động lại; Account bị đình chỉ vẫn chịu kỷ luật riêng.

Danh mục nguyên nhân Account suspension là nội dung mặc định Ecosystem, theo dõi tại BL-33 của Discovery Backlog. Việc hồi phục Account kích hoạt chủ thể bị đóng băng chạy lại.

## ID-012 — Invitation Pending khi email cũ được giải phóng

**Status:** Accepted  
**Liên quan:** [ID-006](account-identity-decisions.md) · [ID-007](account-identity-decisions.md) · [ID-008](account-identity-decisions.md) · [INV-004](invitation-decisions.md) · [INV-015](invitation-decisions.md)

Khi Account đổi email, email cũ được giải phóng theo ID-007; các Pending Invitation gửi tới email cũ giữ nguyên trạng thái và vẫn được chấp nhận bởi chủ thể kiểm soát email đó tại thời điểm chấp nhận theo INV-015, kể cả khi đó là một Account khác đăng ký bằng email cũ. Email là địa chỉ đích của Invitation trong suốt vòng đời của nó.

Hệ quả rủi ro — người kiểm soát email cũ sau này có thể nhận Invitation không còn dành cho họ — được chấp nhận có chủ đích; Organization có thể chủ động thu hồi Invitation theo INV-007 khi biết email người nhận đã không còn thuộc về người được mời.

Việc đổi email bảo toàn danh tính, Membership, quyền sở hữu và lịch sử hoạt động của Account; audit tham chiếu Account, không phụ thuộc email. Các quy trình đang diễn ra verify email người nhận theo INV-015 tại thời điểm hoàn tất.

## ID-013 — Machine/Agent hành động theo ủy quyền

**Status:** Accepted  
**Liên quan:** [ID-003](account-identity-decisions.md) · [MEM-005](membership-decisions.md)

Application, Agent và workload máy không phải chủ thể nghiệp vụ độc lập trong hệ sinh thái. Chúng luôn hành động thay mặt một chủ thể hiện có (Account, Consumer Organization, Provider) theo một trong hai cơ chế: ủy quyền OAuth2 với scope giới hạn theo ID-003, hoặc API key scoped trong phạm vi quyền của chủ thể ủy quyền. Trách nhiệm và quyền truy vết của mọi hành động quy về chủ thể ủy quyền, không quy về credential. Máy móc không có lifecycle, quyền hoặc nghĩa vụ riêng ở cấp hệ sinh thái; nhu cầu workload tự trị không có chủ người có thể xuất hiện sau này qua chính sách Product nhưng không tạo chủ thể hạng nhất.

## ID-014 — Account closure yêu cầu chấm dứt vai trò Owner trong Organization Provider

**Status:** Accepted  
**Liên quan:** [ID-010](account-identity-decisions.md) · [SD-043](provider-decisions.md) · [SD-050](provider-decisions.md)

Điều kiện tiên quyết để xóa Account theo ID-010 được bổ sung điều kiện thứ tư: Account không được giữ vai trò Owner trong bất kỳ Organization Provider nào. Vai trò Owner của Organization Provider chỉ được rời sau khi hoàn tất chuyển giao theo quy tắc SD-050; do đó Account đang là Owner của Organization Provider phải chuyển giao vai trò này trước khi yêu cầu xóa Account. Ba điều kiện gốc của ID-010 (không còn Consumer Organization sở hữu, đã chấm dứt Individual Provider Identity, đã xử lý xong số dư) giữ nguyên.
