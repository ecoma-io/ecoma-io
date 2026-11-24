# Membership Decisions

**Phạm vi:** Membership của Consumer Organization. Quy ước chung được quy định tại [README](README.md).

> Ngày quyết định không được ghi nhận.

## MEM-001 — Exactly One Owner

**Status:** Accepted  

Mỗi Consumer Organization đang hoạt động có đúng một Owner.

## MEM-002 — Owner Ultimate Control

**Status:** Accepted  

Owner giữ quyền kiểm soát tối cao đối với Consumer Organization, bao gồm thành viên, quyền sở hữu, thanh toán, tài chính, cấu hình, tài nguyên và hoạt động; Owner có thể ủy quyền thực hiện một số quyền nhưng không mất quyền kiểm soát tối cao.

## MEM-003 — Ownership Transfer

**Status:** Accepted  

Owner có thể chuyển quyền sở hữu Consumer Organization cho một Member đủ điều kiện.

## MEM-004 — Owner Cannot Leave Without Transfer

**Status:** Accepted  
**Liên quan:** [MEM-003](membership-decisions.md)

Owner không thể tự rời hoặc bị loại khỏi Consumer Organization khi chưa chuyển quyền sở hữu cho người khác.

## MEM-005 — Product-owned Membership Authorization

**Status:** Accepted  

Mỗi sản phẩm tự định nghĩa Role, Permission, chính sách phân quyền và giá trị mặc định cho Member.

## MEM-006 — Scoped Member Management

**Status:** Accepted  

Owner và Member được cấp quyền quản lý thành viên có thể quyết định quyền của Member khác trong phạm vi được cấp.

## MEM-007 — Management Scope Enforcement

**Status:** Accepted  

Member có quyền quản lý không thể cấp, thay đổi hoặc thu hồi quyền vượt quá phạm vi quản lý của mình.

## MEM-008 — Persistent Delegated Permissions

**Status:** Accepted  

Việc thu hồi quyền quản lý Member không tự động thu hồi các quyền mà người quản lý đó đã cấp trước đó; những quyền này tiếp tục tồn tại cho đến khi một chủ thể có thẩm quyền thay đổi.

## MEM-009 — One Membership per Account

**Status:** Accepted  

Một Account chỉ có tối đa một Membership trong cùng một Consumer Organization; Membership có thể chứa nhiều Role hoặc Permission.

## MEM-010 — Product-scoped Membership & Authorization

**Status:** Accepted  

Membership và Authorization thuộc phạm vi từng sản phẩm; không bắt buộc phải chia sẻ chung Role hoặc Permission giữa các sản phẩm.

## MEM-011 — Voluntary Member Departure

**Status:** Accepted  

Member có thể tự rời Consumer Organization mà không cần Owner phê duyệt.

## MEM-012 — Immediate Re-membership Eligibility

**Status:** Accepted  

Member đã rời hoặc bị loại có thể được mời lại ngay, không có thời gian chờ; Membership mới có vòng đời độc lập.

## MEM-013 — Complete Membership Access Revocation

**Status:** Accepted  

Khi Membership kết thúc, toàn bộ quyền truy cập phát sinh trực tiếp hoặc gián tiếp từ Membership phải bị thu hồi, bao gồm quyền thông qua session, token hoặc credential phụ thuộc vào Membership.

## MEM-014 — Membership Termination Does Not Delete Resources

**Status:** Accepted  

Việc kết thúc Membership không tự động xóa tài nguyên do Member tạo; mỗi sản phẩm tự quyết định cách xử lý tài nguyên và các phụ thuộc liên quan.

## MEM-015 — Product-defined Membership Acquisition

**Status:** Accepted  

Membership có thể hình thành thông qua việc chấp nhận Invitation hoặc các quy trình onboarding khác do sản phẩm định nghĩa.

## MEM-016 — Owner đầu tiên và hậu chuyển giao của Consumer Organization

**Status:** Accepted  
**Liên quan:** [MEM-001](membership-decisions.md) · [MEM-003](membership-decisions.md) · [ORG-001](consumer-organization-decisions.md) · [SD-050](provider-decisions.md)

Account tạo Consumer Organization trở thành Owner đầu tiên. Sau khi chuyển giao quyền sở hữu, Owner cũ trở thành Member thường với danh sách quyền như các Member khác, không giữ quyền đặc biệt. Quy tắc này đồng nhất pattern với Organization Provider theo SD-050.

## MEM-017 — Quyền được cấp tồn tại theo Organization

**Status:** Accepted  
**Liên quan:** [MEM-002](membership-decisions.md) · [MEM-006](membership-decisions.md) · [MEM-008](membership-decisions.md) · [MEM-013](membership-decisions.md) · [MEM-014](membership-decisions.md) · [ORG-003](consumer-organization-decisions.md)

Quyền được cấp thông qua ủy quyền là tài sản của Organization, không phải của người cấp: người cấp quyền rời Organization không làm cascade-thu hồi các quyền đã cấp, theo nguyên tắc persistence của MEM-008. Phép đọc chính tắc của MEM-013: truy cập "phát sinh gián tiếp" từ một Membership bị kết thúc là truy cập của chính Account đó, kể cả quyền Account đó nhận được bằng ủy quyền, và không đe dọa quyền mà Account khác đã nhận từ người cấp trước đó. Thẩm quyền thay đổi hoặc thu hồi quyền được cấp gián tiếp xác định theo chuỗi quản lý của MEM-006 và MEM-007, với Owner giữ quyền tối cao theo MEM-002. Hành động thực hiện bằng quyền ủy quyền truy vết đến Account thực hiện; hậu quả tài nguyên thuộc Organization theo ORG-003 và MEM-014.

## MEM-018 — Hội tụ luồng gia nhập và trọng tài cạnh tranh

**Status:** Accepted  
**Liên quan:** [MEM-009](membership-decisions.md) · [MEM-015](membership-decisions.md) · [INV-006](invitation-decisions.md) · [INV-010](invitation-decisions.md) · [INV-011](invitation-decisions.md) · [INV-014](invitation-decisions.md) · [INV-015](invitation-decisions.md)

Mọi luồng gia nhập Membership, gồm chấp nhận Invitation và các quy trình onboarding do Product định nghĩa, hội tụ về đúng một Membership theo MEM-009. Luồng hoàn tất đầu tiên thắng; các luồng cạnh tranh còn lại được vô hiệu hóa. Bước kiểm tra điều kiện chấp nhận theo INV-010 và INV-015, chuyển Invitation sang Accepted và tạo Membership là một thao tác nghiệp vụ nguyên tử. Organization bị terminate thắng mọi thao tác đang thực hiện theo INV-014. Không giới thiệu trạng thái trung gian mới cho Invitation; tập trạng thái của INV-006 giữ nguyên.
