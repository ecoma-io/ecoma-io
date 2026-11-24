# Discovery Backlog

## Mục đích

Kho các câu hỏi mở chưa đủ thông tin để kết luận, thu thập trong quá trình Strategic Domain Discovery. Phương pháp và phân biệt Fact / Assumption / Proposal / Open Question / Decision quy chiếu tại [Discovery Charter](../00-governance/discovery-charter.md) (mục 6.2).

Open Question **không phải** Decision. Một câu hỏi trong backlog chỉ được giải quyết khi có quyết định được chấp thuận theo [Decision Process](../00-governance/decision-process.md); khi đó câu hỏi được đánh dấu đã xử lý, nhưng không bao giờ được chuyển thành quyết định ngay trong tài liệu này.

## Quy ước trạng thái

- **Open:** câu hỏi chưa có câu trả lời hoặc chưa đủ dữ kiện.
- **Resolved:** câu hỏi đã được trả lời bằng một quyết định Accepted mới hoặc bằng dữ kiện đã xác minh; cần ghi liên kết đến nguồn.

Không sử dụng các trạng thái quyết định (`Proposed`, `Accepted`, ...) cho item trong backlog.

---

<!-- ## BL-01 — Cơ chế Progressive Provider Trust

- **Câu hỏi cần trả lời:** Cơ chế mở rộng quyền của Provider theo mức xác minh, năng lực và độ tin cậy cụ thể hoạt động ra sao ở từng mức?
- **Vì sao cần discovery:** [SD-016](decisions/provider-decisions.md) chỉ chốt nguyên tắc progressive trust; các mức cụ thể, tiêu chí và hệ quả quyền hạn chưa được xác định, ảnh hưởng trực tiếp đến Provider Governance.
- **Liên quan:** [SD-016](decisions/provider-decisions.md), [SD-026](decisions/provider-decisions.md), [SD-042](decisions/provider-decisions.md).
- **Trạng thái:** Resolved — cơ chế hai giai đoạn Activated/Verified đã chốt tại [SD-042](decisions/provider-decisions.md). Chi tiết còn thiếu được tách sang [BL-25](#bl-25--kycverified-chi-tiết-và-mapping-nhóm-đối-tượng). -->

<!-- ## BL-02 — Provider commercial rights và responsibilities

- **Câu hỏi cần trả lời:** Ranh giới trách nhiệm giữa Provider và Ecoma trong từng mô hình Product được xác định như thế nào? Provider có những quyền và nghĩa vụ thương mại gì?
- **Vì sao cần discovery:** Các quyết định hiện có xác lập Provider là chủ thể cung ứng và Ecoma chịu trách nhiệm với cam kết của mình, nhưng cách phân định ranh giới cho từng mô hình kinh doanh chưa có. Khía cạnh trách nhiệm của Ecoma đối với chất lượng dịch vụ Provider (đo lường, đánh giá, chứng nhận, vận hành Marketplace, bảo đảm đầu cuối) đã được quyết định tại [SD-045](decisions/provider-decisions.md); item này tập trung quyền và nghĩa vụ phía Provider.
- **Liên quan:** [SD-014](decisions/provider-decisions.md), [SD-020](decisions/provider-decisions.md), [SD-029](decisions/strategic-decisions.md), [SD-036](decisions/strategic-decisions.md), [SD-045](decisions/provider-decisions.md).
- **Trạng thái:** Resolved — đóng bằng suy ra, không cần quyết định mới: quyền thương mại của Provider đã phủ bởi [SD-034](decisions/strategic-decisions.md), [SD-044](decisions/provider-decisions.md), [FIN-001](decisions/financial-decisions.md), [FIN-002](decisions/financial-decisions.md), [FIN-008](decisions/financial-decisions.md); nghĩa vụ cung ứng phủ bởi [SD-014](decisions/provider-decisions.md), [SD-023](decisions/provider-decisions.md), [SD-045](decisions/provider-decisions.md), [FIN-007](decisions/financial-decisions.md), [SD-048](decisions/strategic-decisions.md), [FIN-003](decisions/financial-decisions.md); ranh giới trách nhiệm theo từng mô hình Product là nội dung của [BL-23](#bl-23--product-specific-business-model). -->

## BL-03 — Legal Merchant of Record của Ecoma

- **Câu hỏi cần trả lời:** Tư cách pháp lý Merchant of Record của Ecoma khi nắm dòng tiền là gì?
- **Vì sao cần discovery:** [SD-015](decisions/provider-decisions.md) ghi rõ Ecoma quản lý dòng tiền và nghĩa vụ tài chính; dòng tiền cụ thể (Ecoma thu từ Consumer, trừ hoa hồng và thuế phí, thanh toán cho Provider) đã chốt tại [FIN-005](decisions/financial-decisions.md), nhưng tư cách Merchant of Record chưa được xác định; điều này quyết định nghĩa vụ pháp lý và thuế của Ecoma với Consumer và Provider.
- **Liên quan:** [SD-015](decisions/provider-decisions.md), [FIN-005](decisions/financial-decisions.md), [BL-26](#bl-26--refund-chargeback-và-chi-tiết-thuế-phí).
- **Trạng thái:** Open (đã thu hẹp: chỉ còn tư cách pháp lý Merchant of Record).

<!-- ## BL-04 — Refund, Chargeback, Settlement và financial lifecycle

- **Câu hỏi cần trả lời:** Refund, Chargeback, Settlement và vòng đời tài chính của giao dịch giữa Consumer, Ecoma và Provider được xử lý như thế nào?
- **Vì sao cần discovery:** Chưa có quyết định nào về các chủ đề này; chỉ có nguyên tắc Ecoma quản lý dòng tiền và số dư gắn trạng thái Provider. Đây là khoảng trống lớn trong Commercial Relationship Management và Marketplace Governance.
- **Liên quan:** [SD-015](decisions/provider-decisions.md), [SD-027](decisions/provider-decisions.md), [FIN-001](decisions/financial-decisions.md)–[FIN-005](decisions/financial-decisions.md).
- **Trạng thái:** Resolved — số dư kép, settlement cuối tháng, rút tiền, xử lý số dư khi chấm dứt và dòng tiền hoa hồng đã chốt tại [FIN-001](decisions/financial-decisions.md)–[FIN-005](decisions/financial-decisions.md). Refund, Chargeback và chi tiết thuế được tách sang [BL-26](#bl-26--refund-chargeback-và-chi-tiết-thuế-phí). -->

<!-- ## BL-05 — Account closure và suspension

- **Câu hỏi cần trả lời:** Account suspension (tạm ngưng Account) diễn ra như thế nào và tác động của nó lên các Organization, Membership, Provider đang tham gia?
- **Vì sao cần discovery:** [ID-010](decisions/account-identity-decisions.md) đã chốt closure Account theo điều kiện tiên quyết (không còn Org sở hữu, đã chấm dứt Individual Provider Identity, đã xử lý xong số dư); suspension vẫn chưa có quyết định nào.
- **Liên quan:** [ID-009](decisions/account-identity-decisions.md), [ID-010](decisions/account-identity-decisions.md), [FIN-003](decisions/financial-decisions.md), [ID-011](decisions/account-identity-decisions.md).
- **Trạng thái:** Resolved — suspension lan theo quyền sở hữu với đóng băng đảo ngược và đường cứu theo nguyên nhân đã chốt tại [ID-011](decisions/account-identity-decisions.md); danh mục nguyên nhân theo dõi tại BL-33. -->

<!-- ## BL-06 — Consumer Organization termination và resource deprovisioning

- **Câu hỏi cần trả lời:** Sau khi Consumer Organization bị Terminated, tài nguyên của Organization được xử lý (deprovisioning) cụ thể như thế nào?
- **Vì sao cần discovery:** [ORG-012](decisions/consumer-organization-decisions.md) và [MEM-014](decisions/membership-decisions.md) chốt nguyên tắc retention và không tự động xóa tài nguyên, nhưng cách xử lý tài nguyên cụ thể sau termination chưa được xác định.
- **Liên quan:** [ORG-012](decisions/consumer-organization-decisions.md), [ORG-013](decisions/consumer-organization-decisions.md), [ORG-014](decisions/consumer-organization-decisions.md), [MEM-014](decisions/membership-decisions.md), [MEM-013](decisions/membership-decisions.md).
- **Trạng thái:** Resolved — đóng bằng suy ra, không cần quyết định mới: dữ liệu lưu giữ theo retention của Product ([ORG-012](decisions/consumer-organization-decisions.md)); toàn bộ Membership kết thúc và mọi truy cập bị thu hồi ngay ([ORG-013](decisions/consumer-organization-decisions.md), [MEM-013](decisions/membership-decisions.md)); nghĩa vụ đã phát sinh được bảo toàn ([ORG-014](decisions/consumer-organization-decisions.md)); tài nguyên do Member tạo không tự động xóa ([MEM-014](decisions/membership-decisions.md)); sau termination không còn chủ thể hoạt động nên không phát sinh tiêu dùng mới. Cơ chế deprovisioning cụ thể (archival, xóa theo schedule, export) thuộc lớp design/vận hành, ngoài phạm vi discovery. -->

<!-- ## BL-07 — Machine/Agent Identity

- **Câu hỏi cần trả lời:** Mô hình Machine/Agent Identity độc lập cho application và agent được thiết kế như thế nào?
- **Vì sao cần discovery:** [ID-003](decisions/account-identity-decisions.md) chỉ chốt cơ chế ủy quyền OAuth2 với scope giới hạn; mô hình danh tính độc lập cho máy và agent được ghi rõ là chưa quyết định. Ghi chú: user nghiêng về mô hình OAuth + API key nhưng chưa chắc chắn — đây là ghi chú xu hướng, không phải quyết định.
- **Liên quan:** [ID-003](decisions/account-identity-decisions.md), [ID-013](decisions/account-identity-decisions.md).
- **Trạng thái:** Resolved — Machine/Agent hành động theo ủy quyền OAuth2 hoặc API key scoped, không tồn tại chủ thể máy độc lập, đã chốt tại [ID-013](decisions/account-identity-decisions.md). -->

<!-- ## BL-08 — Provider Organization membership và management

- **Câu hỏi cần trả lời:** Mô hình thành viên và quản lý bên trong Organization Provider là gì? Ai có thể đại diện, quản lý và chịu trách nhiệm vận hành một Organization Provider?
- **Vì sao cần discovery:** [SD-019](decisions/provider-decisions.md) và [SD-022](decisions/provider-decisions.md) cho phép một Account quản lý nhiều Organization Provider và ủy quyền quản lý, nhưng mô hình membership/management chi tiết chưa có quyết định. Lưu ý ranh giới đã xác lập: không được áp dụng máy móc mô hình Owner/Member của Consumer Organization sang Provider (Domain Boundary 2).
- **Liên quan:** [SD-019](decisions/provider-decisions.md), [SD-022](decisions/provider-decisions.md), [SD-017](decisions/provider-decisions.md), [SD-043](decisions/provider-decisions.md).
- **Trạng thái:** Resolved — mô hình Organization Provider có đúng một Owner và nhiều Member kèm danh sách quyền đã chốt tại [SD-043](decisions/provider-decisions.md), theo ranh giới không kế thừa máy móc mô hình Consumer Organization. Quy tắc chi tiết (Owner đầu tiên, chuyển quyền, rời/bị loại, mời lại) được tách sang [BL-27](#bl-27--quy-tắc-membership-chi-tiết-của-organization-provider). -->

<!-- ## BL-09 — Offering lifecycle và retirement

- **Câu hỏi cần trả lời:** Offering được tạo, thay đổi và ngừng (retirement) theo vòng đời nào? Điều gì xảy ra với Offering khi Provider hoặc Product thay đổi?
- **Vì sao cần discovery:** [SD-028](decisions/provider-decisions.md) và [SD-034](decisions/strategic-decisions.md) chốt tính liên tục và mô hình sở hữu kép, nhưng vòng đời đầy đủ của Offering chưa được xác định.
- **Liên quan:** [SD-028](decisions/provider-decisions.md), [SD-034](decisions/strategic-decisions.md), [SD-044](decisions/provider-decisions.md).
- **Trạng thái:** Resolved — vòng đời Offering do Provider kiểm soát (tạo, chỉnh sửa, tạm dừng, xóa; không thay đổi qua transformation) đã chốt tại [SD-044](decisions/provider-decisions.md). Phần Product-owned Offering được tách sang [BL-28](#bl-28--vòng-đời-product-owned-offering). -->

<!-- ## BL-10 — Cross-product integration

- **Câu hỏi cần trả lời:** Các Product kết hợp dịch vụ và chia sẻ nguồn lực với nhau theo cơ chế nào để tạo ra giá trị tổng hợp?
- **Vì sao cần discovery:** [SD-037](decisions/strategic-decisions.md) xác lập tầm nhìn Integrated Business nhưng chưa có thiết kế tích hợp nào. Lưu ý: thiết kế tích hợp cụ thể thuộc lớp design sau Discovery; câu hỏi ở đây là xác định yêu cầu và phạm vi tích hợp ở mức nghiệp vụ.
- **Liên quan:** [SD-037](decisions/strategic-decisions.md), [SD-052](decisions/strategic-decisions.md).
- **Trạng thái:** Resolved — thời điểm hiện tại không có yêu cầu tích hợp xuyên Product nào, chốt tại [SD-052](decisions/strategic-decisions.md); khi có yêu cầu tích hợp thực tế, mở lại qua Discovery Backlog theo Decision Process. -->

<!-- ## BL-11 — Composite Offering và trách nhiệm cung cấp dịch vụ

- **Câu hỏi cần trả lời:** Khi một Offering tổng hợp nhiều nguồn cung (Composite Offering), ai chịu trách nhiệm cho phần cung ứng nào?
- **Vì sao cần discovery:** [SD-037](decisions/strategic-decisions.md) cho phép tạo Offering có giá trị tổng hợp; [SD-014](decisions/provider-decisions.md) và [SD-036](decisions/strategic-decisions.md) xác lập nguyên tắc trách nhiệm theo cam kết, nhưng cách phân định trách nhiệm cho Offering tổng hợp nhiều nguồn chưa được làm rõ.
- **Liên quan:** [SD-037](decisions/strategic-decisions.md), [SD-014](decisions/provider-decisions.md), [SD-036](decisions/strategic-decisions.md), [SD-053](decisions/provider-decisions.md).
- **Trạng thái:** Resolved — trách nhiệm phân theo từng nguồn cung: mỗi Provider chịu phần cung ứng của mình kể cả khi gộp vào Composite Offering, việc gộp không chuyển trách nhiệm sang bên gộp; chốt tại [SD-053](decisions/provider-decisions.md). -->

<!-- ## BL-12 — Portfolio prioritization

- **Câu hỏi cần trả lời:** Thứ tự ưu tiên và thời điểm phát triển giữa các Product trong Portfolio hiện tại là gì?
- **Vì sao cần discovery:** [SD-038](decisions/strategic-decisions.md) và [SD-039](decisions/strategic-decisions.md) xác lập hướng mở rộng và cách quản trị, nhưng chưa quyết định ưu tiên hay thời điểm. Xem [Product Portfolio](../01-strategy/ai-factory-marketplace.md), mục "Chưa xác định".
- **Liên quan:** [SD-038](decisions/strategic-decisions.md), [SD-039](decisions/strategic-decisions.md), [Product Portfolio](../01-strategy/ai-factory-marketplace.md), [SD-051](decisions/strategic-decisions.md).
- **Trạng thái:** Resolved — thứ tự ưu tiên đã chốt tại [SD-051](decisions/strategic-decisions.md); thời điểm triển khai chi tiết vẫn thuộc quản trị delivery, ngoài phạm vi discovery. -->

<!-- ## BL-13 — Xác minh khoảng mã quyết định SD-031–SD-032

- **Câu hỏi cần trả lời:** Vì sao các mã SD-031 và SD-032 không xuất hiện trong các quyết định đã được ghi nhận?
- **Vì sao cần discovery:** Dải mã SD-030 và SD-033 liên tiếp nhưng SD-031, SD-032 không có trong các quyết định đã ghi nhận. Cần xác minh lý do (quyết định bị loại, lỗi đánh mã, hay nội dung chưa được chuyển vào các quyết định) để bảo đảm tính truy vết. Câu hỏi này chỉ yêu cầu xác minh; không được tự lấp số hoặc suy diễn nội dung.
- **Liên quan:** [strategic-decisions.md](decisions/strategic-decisions.md).
- **Trạng thái:** Resolved — đã xác minh với người giữ quyền quyết định: khoảng mã SD-031–SD-032 không tương ứng với quyết định nào bị loại hoặc nội dung nào bị mất; nguyên nhân là sai sót trong quá trình đánh số. Quy ước giữ nguyên: không được lấp khoảng bằng cách đánh số lại cho quyết định mới. -->

<!-- ## BL-14 — Quyền sở hữu ban đầu và hậu chuyển giao Owner

- **Câu hỏi cần trả lời:** Ai là Owner đầu tiên khi một Consumer Organization được tạo, và trạng thái Membership của Owner cũ sau khi chuyển quyền sở hữu là gì?
- **Vì sao cần discovery:** MEM-001 và MEM-003 chỉ chốt "đúng một Owner" và điều kiện chuyển quyền cho Member đủ điều kiện, không quyết định tường minh Owner đầu tiên khi tạo Organization hay số phận Membership của Owner cũ sau chuyển giao. Một số tài liệu lifecycle/process hiện dùng giả định vận hành ("người tạo trở thành Owner", "Owner cũ tiếp tục là Member thông thường") và đã đánh dấu là giả định.
- **Liên quan:** [MEM-001](decisions/membership-decisions.md), [MEM-003](decisions/membership-decisions.md), [consumer-organization-creation](business-processes/consumer-organization-creation.md), [consumer-membership-management](business-processes/consumer-membership-management.md), [MEM-016](decisions/membership-decisions.md).
- **Trạng thái:** Resolved — chốt tại [MEM-016](decisions/membership-decisions.md): Account tạo là Owner đầu tiên, Owner cũ trở thành Member thường. -->

<!-- ## BL-15 — Delegated Permission Provenance

- **Domain:** Authorization / Membership.
- **Priority:** P1 (đề xuất).
- **Câu hỏi cần trả lời:** Nguồn gốc (provenance) của quyền được cấp thông qua nhiều cấp quản lý được ghi nhận như thế nào? Ai là "chủ thể có thẩm quyền" có thể thay đổi hoặc thu hồi quyền được cấp gián tiếp theo mệnh đề của MEM-008, và thu hồi đó giới hạn trong phạm vi nào theo MEM-006 và MEM-007? Quyền đã cấp bị ảnh hưởng ra sao khi người cấp quyền rời Organization? Trách nhiệm đối với hành động được thực hiện bằng quyền ủy quyền được xác định như thế nào?
- **Vì sao cần discovery:** MEM-005 đến MEM-007 chốt mô hình cấp quyền và giới hạn phạm vi quản lý; MEM-008 chốt quyền đã cấp vẫn tồn tại khi quyền quản lý của người cấp bị thu hồi, nhưng hệ quả của mệnh đề "cho đến khi có chủ thể có thẩm quyền thay đổi" chưa được làm rõ. Đồng thời MEM-013 yêu cầu thu hồi mọi quyền truy cập phát sinh trực tiếp hoặc gián tiếp từ một Membership bị chấm dứt, cần đối chiếu với nguyên tắc persistence của MEM-008 cho trường hợp người cấp quyền rời Organization. Không thay đổi quyết định MEM-008; chủ đề này nhằm làm rõ các hệ quả và cơ chế quản trị xung quanh quyết định đó.
- **Kết quả discovery cần đạt:** Quy tắc về nguồn gốc, phạm vi, khả năng thu hồi và vòng đời của quyền được ủy quyền.
- **Liên quan:** [MEM-005](decisions/membership-decisions.md), [MEM-006](decisions/membership-decisions.md), [MEM-007](decisions/membership-decisions.md), [MEM-008](decisions/membership-decisions.md), [MEM-013](decisions/membership-decisions.md), [MEM-017](decisions/membership-decisions.md).
- **Trạng thái:** Resolved — quyền được cấp tồn tại theo Organization, phép đọc chính tắc MEM-013 và thẩm quyền thu hồi theo chuỗi quản lý đã chốt tại [MEM-017](decisions/membership-decisions.md); yêu cầu ghi provenance chuỗi cấp quyền thuộc lớp design/observability. -->

<!-- ## BL-16 — Membership Acquisition Consistency

- **Domain:** Membership.
- **Priority:** P1 (đề xuất).
- **Câu hỏi cần trả lời:** Khi một Account có thể trở thành Member qua nhiều phương thức onboarding (chấp nhận Invitation hoặc quy trình khác do domain định nghĩa theo MEM-015), các luồng gia nhập hội tụ về đúng một Membership như thế nào? Khi nhiều luồng onboarding diễn ra đồng thời cho cùng Account và Organization, xung đột được xử lý ra sao? Điều gì xảy ra khi chấp nhận Invitation và một phương thức gia nhập khác cạnh tranh nhau? Khóa duy nhất theo email của INV-010 và khóa duy nhất theo Account của MEM-009 được đối chiếu ra sao tại thời điểm hình thành Membership?
- **Vì sao cần discovery:** MEM-009 chốt invariant tối đa một Membership trên một Account trong một Organization và INV-011 chốt tính nguyên tử ở bước tạo Invitation, nhưng chưa có quyết định nào về tính nhất quán giữa các phương thức gia nhập và về bước hình thành Membership ngoài luồng Invitation. MEM-009 và INV-011 là invariant cố định, không mở lại. Khía cạnh tính nguyên tử tại thời điểm chấp nhận Invitation liên quan trực tiếp đến BL-17 và được phối hợp khám phá.
- **Kết quả discovery cần đạt:** Xác định các invariant nghiệp vụ về việc hình thành Membership, tính duy nhất và xử lý các luồng gia nhập cạnh tranh.
- **Liên quan:** [MEM-009](decisions/membership-decisions.md), [MEM-015](decisions/membership-decisions.md), [INV-002](decisions/invitation-decisions.md), [INV-010](decisions/invitation-decisions.md), [INV-011](decisions/invitation-decisions.md), [MEM-018](decisions/membership-decisions.md).
- **Trạng thái:** Resolved — bộ quy tắc hội tụ luồng gia nhập chốt tại [MEM-018](decisions/membership-decisions.md). -->

<!-- ## BL-17 — Invitation State Transition Consistency

- **Domain:** Invitation.
- **Priority:** P1 (đề xuất).
- **Câu hỏi cần trả lời:** Khi Accept, Reject, Revoke và Expire xảy ra đồng thời, quy tắc trọng tài nào bảo đảm Invitation chỉ có đúng một kết quả chuyển trạng thái hợp lệ? Khi Organization bị terminate trong lúc một Invitation đang được chấp nhận, các thao tác đang thực hiện (in-flight) được xử lý ra sao mà không làm suy yếu yêu cầu vô hiệu hóa ngay lập tức của INV-014? Việc kiểm tra lại điều kiện chấp nhận (INV-010, INV-015) tại thời điểm accept được bảo đảm nguyên tử và tuần tự như thế nào, khi INV-011 chỉ bao phủ bước tạo Invitation? Việc tạo Membership và chuyển Invitation sang Accepted được bảo đảm nhất quán nghiệp vụ qua hai phạm vi Invitation và Membership như thế nào?
- **Vì sao cần discovery:** INV-006 chốt tập trạng thái và quy tắc trạng thái kết thúc không quay lại Pending; INV-010, INV-011, INV-014 và INV-015 chốt điều kiện duy nhất, tính nguyên tử lúc tạo, vô hiệu hóa khi terminate và xác minh quyền sở hữu email lúc chấp nhận. Không có quyết định nào về xung đột giữa các chuyển trạng thái và về tính nguyên tử tại thời điểm chấp nhận. Không thay đổi các trạng thái đã chốt tại INV-006 hoặc các điều kiện đã chốt tại INV-010, INV-011, INV-014 và INV-015, và không đề xuất trạng thái trung gian mới. Khía cạnh cạnh tranh giữa chấp nhận Invitation và phương thức gia nhập khác được theo dõi tại BL-16.
- **Kết quả discovery cần đạt:** Làm rõ các chuyển trạng thái hợp lệ, điều kiện chuyển trạng thái và invariant giữa Invitation với Membership.
- **Liên quan:** [INV-006](decisions/invitation-decisions.md), [INV-010](decisions/invitation-decisions.md), [INV-011](decisions/invitation-decisions.md), [INV-014](decisions/invitation-decisions.md), [INV-015](decisions/invitation-decisions.md), [MEM-018](decisions/membership-decisions.md).
- **Trạng thái:** Resolved — tính nguyên tử lúc chấp nhận, trọng tài terminate và tập trạng thái giữ nguyên chốt tại [MEM-018](decisions/membership-decisions.md). -->

<!-- ## BL-18 — Account Email Change Continuity

- **Domain:** Account / Identity.
- **Priority:** P1 (đề xuất).
- **Câu hỏi cần trả lời:** Việc thay đổi email Account ảnh hưởng thế nào đến các Membership hiện có và đến quyền sở hữu, quản lý Consumer Organization? Quan hệ giữa email mới của Account và các Invitation do Account đó tạo ra được xử lý ra sao (phần Invitation nhận được đã được ID-008 và INV-015 trả lời)? Lịch sử hoạt động, audit và thông báo được duy trì tính liên tục sau khi đổi email như thế nào? Các quy trình đang diễn ra khác ngoài xác minh OTP được xử lý ra sao tại thời điểm email thay đổi?
- **Vì sao cần discovery:** ID-006 đến ID-009 chốt tính duy nhất của email, quy trình xác minh đổi email, tính bất biến của email người nhận Invitation và tính độc lập của vòng đời Account; [account-email-change](business-processes/account-email-change.md) đang vận hành trên giả định rằng danh tính và các quan hệ đã thiết lập không thay đổi khi đổi email (bước 5, đã đánh dấu là giả định). Cần chính quy hóa giả định này và làm rõ các quan hệ nghiệp vụ phụ thuộc vào Account Identity và email thành quy tắc tường minh. Tôn trọng ID-007 về quy trình xác minh email mới và ID-008 về tính bất biến của email người nhận Invitation; không mở lại hoặc thay đổi các quyết định đã chốt.
- **Kết quả discovery cần đạt:** Làm rõ các quan hệ nghiệp vụ phụ thuộc vào Account Identity và email, đảm bảo thay đổi email không làm mất tính liên tục của danh tính và lịch sử.
- **Liên quan:** [ID-006](decisions/account-identity-decisions.md), [ID-007](decisions/account-identity-decisions.md), [ID-008](decisions/account-identity-decisions.md), [ID-009](decisions/account-identity-decisions.md), [INV-015](decisions/invitation-decisions.md), [account-email-change](business-processes/account-email-change.md), [ID-012](decisions/account-identity-decisions.md).
- **Trạng thái:** Resolved — invitation gửi tới email cũ giữ nguyên theo [ID-012](decisions/account-identity-decisions.md) với rủi ro được chấp nhận có chủ đích; tính liên tục danh tính, lịch sử và audit tham chiếu Account đã được chính quy hóa. -->

<!-- ## BL-19 — Provider Actor Authorization

- **Domain:** Provider.
- **Priority:** P1 (đề xuất).
- **Câu hỏi cần trả lời:** Phạm vi authorization của Actor ở cấp Provider và ở cấp Offering được xác định như thế nào? Machine/Agent Actor có thể đại diện hoặc hành động thay mặt Provider ra sao và quan hệ với Account Actor như thế nào (không quyết định mô hình danh tính độc lập — xem BL-07)? Trách nhiệm đối với từng hành động do Actor thực hiện thay mặt Provider được quy kết và truy vết như thế nào, trên nguyên tắc đã chốt rằng quyền quản lý không đồng nhất với trách nhiệm pháp lý/thương mại?
- **Vì sao cần discovery:** Domain Boundary số 3 (Provider Identity ≠ Provider Actor) trong [strategic-domain-model](strategic-domain-model.md) cùng SD-014, SD-018, SD-019, SD-020 và SD-022 đã chốt ranh giới danh tính, đại diện nhiều Organization Provider và nguyên tắc trách nhiệm, nhưng chưa có quyết định nào về mô hình Actor ở cấp Provider, phạm vi authorization đến Offering và quy kết trách nhiệm theo từng hành động. Các câu hỏi về ai có thể đại diện, quản lý, ủy quyền và chịu trách nhiệm vận hành một Organization Provider đang được theo dõi tại BL-08; đại diện Individual Provider đã được SD-019 trả lời. Không đồng nhất Provider Identity với Actor hoặc Provider Qualification; không áp dụng máy móc mô hình Owner/Member của Consumer Organization sang Provider (Domain Boundary 2).
- **Kết quả discovery cần đạt:** Làm rõ mô hình Actor, quan hệ ủy quyền, phạm vi authorization và trách nhiệm trong hoạt động Provider.
- **Liên quan:** [SD-014](decisions/provider-decisions.md), [SD-018](decisions/provider-decisions.md), [SD-019](decisions/provider-decisions.md), [SD-020](decisions/provider-decisions.md), [SD-022](decisions/provider-decisions.md), [strategic-domain-model](strategic-domain-model.md).
- **Trạng thái:** Resolved — đóng bằng suy ra: Actor cấp Provider là Account Member với permission list theo Product ([SD-043](decisions/provider-decisions.md), [SD-050](decisions/provider-decisions.md)); Machine/Agent Actor hành động qua ủy quyền scoped theo [ID-013](decisions/account-identity-decisions.md); hành động được ủy quyền ràng buộc Provider về mặt thương mại theo [SD-020](decisions/provider-decisions.md) trên nền tách bạch quyền quản lý khỏi trách nhiệm pháp lý theo [SD-022](decisions/provider-decisions.md), truy vết đến Actor cho audit; phạm vi ủy quyền chi tiết đến Offering là chính sách Product theo SD-046. -->

<!-- ## BL-20 — Ecosystem/Product Decision Authority

- **Domain:** Ecosystem Governance.
- **Priority:** P0 (đề xuất).
- **Câu hỏi cần trả lời:** Những loại quyết định nào thuộc quyền tự chủ của Product và những quyết định nào bắt buộc tuân theo chính sách hoặc tiêu chuẩn Ecosystem, trong khuôn khổ tự chủ mà SD-030 và SD-039 đã cấp? Quyết định có ảnh hưởng đồng thời đến nhiều Product được phối hợp ra sao? Xung đột giữa chính sách Ecosystem và nhu cầu vận hành của Product được giải quyết theo nguyên tắc nào? Thẩm quyền phê duyệt ngoại lệ và trách nhiệm đối với ngoại lệ được xác định như thế nào ở lớp business và chiến lược?
- **Vì sao cần discovery:** SD-003, SD-004 và SD-005 chốt nguyên tắc thiết kế cân bằng và tính chọn lọc của nhất quán toàn hệ sinh thái; SD-030 và SD-039 chốt phân cấp thô hai cấp (Ecosystem: nguyên tắc chung, platform capability, chiến lược portfolio; Product: tự chủ kinh doanh trong nguyên tắc chung), nhưng chưa có phân định chi tiết theo loại quyết định ở lớp business. Ở lớp kiến trúc và review, [review-authority](../08-review-process/review-authority.md) đã có ma trận thẩm quyền mặc định (chưa được xác nhận, các vai trò chưa được chỉ định) và [decision-process](../00-governance/decision-process.md) quy chiếu sang đó; việc khám phá cần phân biệt hai lớp này và không ghi trùng. Xử lý theo ràng buộc SD-005: mặc định không chuẩn hóa trừ khi thực sự cần thiết cho toàn hệ sinh thái.
- **Kết quả discovery cần đạt:** Xác định ranh giới thẩm quyền, cơ chế phối hợp và nguyên tắc giải quyết xung đột giữa Ecosystem Governance và Product Governance.
- **Liên quan:** [SD-003](decisions/strategic-decisions.md), [SD-004](decisions/strategic-decisions.md), [SD-005](decisions/strategic-decisions.md), [SD-030](decisions/strategic-decisions.md), [SD-039](decisions/strategic-decisions.md), [SD-046](decisions/strategic-decisions.md), [review-authority](../08-review-process/review-authority.md), [decision-process](../00-governance/decision-process.md).
- **Trạng thái:** Resolved — khung ba cấp quan hệ (bắt buộc / mặc định kèm phủ / tự chủ), test cam kết dùng chung, cơ chế override tự quyết kèm khai báo và nguyên tắc giải quyết xung đột không ngoại lệ thường trực đã chốt tại [SD-046](decisions/strategic-decisions.md). Phối hợp xuyên Product theo ma trận thẩm quyền tại [review-authority](../08-review-process/review-authority.md). -->

<!-- ## BL-21 — Service Routing và Commercial Influence

- **Domain:** Marketplace / Provider Evaluation.
- **Priority:** P1 (đề xuất).
- **Câu hỏi cần trả lời:** Yếu tố thương mại có được phép tác động đến Service Routing hay không? Nếu có, phạm vi, điều kiện minh bạch và quyền kiểm soát của Consumer là gì? Ranh giới giữa Discovery & Display và Service Routing được xác định như thế nào?
- **Vì sao cần discovery:** Proposal về Provider Evaluation & Certification (Business Capability Map, mục 8) gồm khía cạnh Service Discovery & Intelligent Routing, và Proposal về kết hợp quản trị chất lượng với thương mại cho phép yếu tố thương mại ảnh hưởng vị trí hiển thị — nhưng chưa có quyết định nào phân định Discovery & Display với Service Routing hay chốt điều kiện cho tác động thương mại. Khả năng hiển thị trong Discovery & Display và cơ chế routing sang dịch vụ cụ thể là hai chủ đề cần tách bạch trước khi thiết kế.
- **Kết quả discovery cần đạt:** Ranh giới giữa Discovery & Display và Service Routing; quy tắc (nếu có) cho phép yếu tố thương mại tác động đến routing, kèm điều kiện minh bạch và quyền kiểm soát Consumer.
- **Liên quan:** [strategic-domain-model](strategic-domain-model.md), [business-capability-map](business-capability-map.md) (mục 6, 8), [BL-20](#bl-20--ecosystemproduct-decision-authority), [SD-049](decisions/strategic-decisions.md).
- **Trạng thái:** Resolved — ranh giới Discovery & Display và Service Routing cùng quy tắc yếu tố thương mại đã chốt tại [SD-049](decisions/strategic-decisions.md); cơ chế minh bạch cụ thể cho Display thuộc lớp design. -->

## BL-22 — Provider Evaluation & Certification Standards theo domain

- **Domain:** Provider / Marketplace.
- **Priority:** P1 (đề xuất).
- **Câu hỏi cần trả lời:** Tiêu chuẩn đánh giá và chứng nhận Provider khác nhau như thế nào giữa Domain LLM và Domain GPU? Điều kiện đình chỉ, khôi phục và thu hồi chứng nhận là gì?
- **Vì sao cần discovery:** Proposal về Provider Evaluation & Certification xác lập định hướng đo lường, đánh giá và chứng nhận Provider (Continuous Service Monitoring, Supply Verification, Quality Assessment & Benchmarking, Provider Evaluation & Certification, Public Transparency), nhưng phạm vi theo từng Product và các điều kiện chuyển trạng thái chứng nhận chưa được xác định. [SD-016](decisions/provider-decisions.md) đã chốt progressive trust ở mức nguyên tắc và BL-01 đang khám phá cơ chế mở rộng quyền; chủ đề này gắn với và cần phân biệt với BL-01. Kết quả đánh giá có thể ảnh hưởng vị trí hiển thị và quyền tham gia Marketplace theo Proposal quản trị chất lượng-thương mại, nhưng Proposal này chưa là chính sách vận hành được phê duyệt.
- **Kết quả discovery cần đạt:** Tiêu chuẩn đánh giá/chứng nhận theo từng domain; điều kiện đình chỉ, khôi phục, thu hồi chứng nhận.
- **Liên quan:** [SD-016](decisions/provider-decisions.md), BL-01, [business-capability-map](business-capability-map.md) (mục 5, 8), BL-20, [SD-047](decisions/strategic-decisions.md), [SD-048](decisions/strategic-decisions.md).
- **Trạng thái:** Open (đã thu hẹp: khung phân cấp tiêu chí đã chốt tại [SD-047](decisions/strategic-decisions.md), đình chỉ lan truyền theo phân loại vi phạm đã chốt tại [SD-048](decisions/strategic-decisions.md); vận hành governance phía Provider của LLM Marketplace đã chốt tại [LLM-023](decisions/llm-marketplace-decisions.md); xác minh phần cứng máy Provider trong GPU Cloud Marketplace đã chốt tại [GPU-005](decisions/gpu-cloud-marketplace-decisions.md); còn điều kiện đình chỉ cụ thể theo danh mục vi phạm, điều kiện hồi phục và thu hồi chứng nhận).

<!-- ## BL-23 — Product-specific Business Model

- **Domain:** Product Portfolio / Commercial.
- **Priority:** P1 (đề xuất).
- **Câu hỏi cần trả lời:** Mô hình thương mại, quyền sở hữu Offering và trách nhiệm cung cấp dịch vụ của từng Product là gì? Các Product có dùng chung một mô hình Provider, Offering, Pricing hoặc Settlement hay mỗi Product một mô hình?
- **Vì sao cần discovery:** [SD-041](decisions/strategic-decisions.md) xác lập GPU Cloud Marketplace và Decentralized Cloud Object Storage là năng lực kinh doanh độc lập, nhưng mô hình thương mại cụ thể của từng Product chưa được discovery. [SD-034](decisions/strategic-decisions.md) cho phép cả hai mô hình sở hữu Offering nhưng không quyết định cho Product cụ thể; nền tảng Settlement dùng chung đã chốt tại [FIN-001](decisions/financial-decisions.md)–[FIN-005](decisions/financial-decisions.md) (Refund/Chargeback còn mở tại [BL-26](#bl-26--refund-chargeback-và-chi-tiết-thuế-phí)), quyền thương mại của Provider tại [BL-02](#bl-02--provider-commercial-rights-và-responsibilities). Không mặc định các Product dùng chung một mô hình.
- **Kết quả discovery cần đạt:** Mô hình Provider/Offering/Pricing/Settlement và trách nhiệm cung cấp dịch vụ cho từng Product.
- **Liên quan:** [SD-041](decisions/strategic-decisions.md), [SD-034](decisions/strategic-decisions.md), [Product Portfolio](../01-strategy/ai-factory-marketplace.md), [BL-02](#bl-02--provider-commercial-rights-và-responsibilities), [BL-04](#bl-04--refund-chargeback-settlement-và-financial-lifecycle).
- **Trạng thái:** Resolved — đóng bằng suy ra, không cần quyết định mới: khung mô hình thương mại đã đủ — mỗi Product tự chủ mô hình kinh doanh, pricing, SLA trong phạm vi nguyên tắc chung ([SD-002](decisions/strategic-decisions.md), [SD-030](decisions/strategic-decisions.md), [SD-046](decisions/strategic-decisions.md)); vai trò Ecoma và phạm vi cam kết theo từng Product ([SD-029](decisions/strategic-decisions.md), [SD-036](decisions/strategic-decisions.md)); sở hữu Offering dual model do Product chọn ([SD-034](decisions/strategic-decisions.md)); trách nhiệm cung ứng theo [SD-014](decisions/provider-decisions.md), [SD-035](decisions/strategic-decisions.md), [SD-045](decisions/provider-decisions.md), [SD-053](decisions/provider-decisions.md); hạ tầng tài chính dùng chung mặc định, Product được thay thế kèm khai báo override ([FIN-004](decisions/financial-decisions.md), [FIN-006](decisions/financial-decisions.md)); mô hình không bị khóa vào PAYG/Freemium/Subscription ([ORG-007](decisions/consumer-organization-decisions.md)). Lựa chọn mô hình cụ thể của từng Product là quyết định của chính Product theo thẩm quyền SD-030/SD-039, phát sinh khi Product được triển khai và ghi theo Decision Process — ngoài phạm vi ecosystem discovery. -->
<!--
## BL-24 — Service Guarantee và Phạm vi Trách nhiệm của Ecoma

- **Domain:** Marketplace / Commercial.
- **Priority:** P1 (đề xuất).
- **Câu hỏi cần trả lời:** Ecoma chịu trách nhiệm đến đâu đối với chất lượng dịch vụ của Provider? Trách nhiệm đo lường, đánh giá, chứng nhận, vận hành Marketplace và bảo đảm dịch vụ đầu cuối được phân định như thế nào?
- **Vì sao cần discovery:** [SD-014](decisions/provider-decisions.md) chia trách nhiệm theo nguồn cam kết (Provider với phần cung ứng của mình, Ecoma với cam kết của Ecoma) và [SD-036](decisions/strategic-decisions.md) giao Product quyết định phạm vi cam kết, nhưng chưa có quyết định nào phân biệt các vai trò đo lường, đánh giá, chứng nhận, vận hành Marketplace với bảo đảm dịch vụ đầu cuối. Proposal về Marketplace Operator ghi rõ Ecoma không mặc định là bên bảo đảm mọi dịch vụ của Provider, nhưng đây mới là Proposal. Tránh trùng lặp: tư cách pháp lý Merchant of Record đang theo dõi tại [BL-03](#bl-03--legal-merchant-of-record-của-ecoma), trách nhiệm với Composite Offering tại [BL-11](#bl-11--composite-offering-và-trách-nhiệm-cung-cấp-dịch-vụ).
- **Kết quả discovery cần đạt:** Ranh giới trách nhiệm giữa vai trò đo lường/đánh giá/chứng nhận, vận hành Marketplace và bảo đảm dịch vụ đầu cuối của Ecoma.
- **Liên quan:** [SD-014](decisions/provider-decisions.md), [SD-035](decisions/strategic-decisions.md), [SD-036](decisions/strategic-decisions.md), [SD-045](decisions/provider-decisions.md), [business-capability-map](business-capability-map.md) (mục 7), [BL-03](#bl-03--legal-merchant-of-record-của-ecoma), [BL-11](#bl-11--composite-offering-và-trách-nhiệm-cung-cấp-dịch-vụ).
- **Trạng thái:** Resolved — đã chốt tại [SD-045](decisions/provider-decisions.md): Ecoma đo lường và minh bạch hóa (healthcheck, benchmark, xác minh tính xác thực cung ứng, metric công khai) thay vì bảo đảm đầu cuối; cam kết vượt mức mặc định do từng Product quyết định theo [SD-036](decisions/strategic-decisions.md). -->

<!-- ## BL-25 — KYC/Verified chi tiết và mapping nhóm đối tượng

- **Domain:** Provider.
- **Priority:** P1 (đề xuất).
- **Câu hỏi cần trả lời:** Điều kiện và quy trình để đạt trạng thái Verified là gì? Ba nhóm đối tượng KYC (cá nhân / hộ kinh doanh / doanh nghiệp) ánh xạ sang Individual/Organization Provider như thế nào? Đường xử lý khi xác minh thất bại hoặc Provider từ chối cung cấp xác minh bổ sung là gì?
- **Vì sao cần discovery:** [SD-042](decisions/provider-decisions.md) chốt cơ chế hai giai đoạn và giấy tờ theo từng nhóm, nhưng tiêu chí đạt Verified, mapping nhóm đối tượng sang tư cách Provider và đường xử lý thất bại chưa được quyết định.
- **Kết quả discovery cần đạt:** Tiêu chí và quy trình Verified; mapping nhóm KYC ↔ Individual/Organization Provider; đường xử lý xác minh thất bại.
- **Liên quan:** [SD-042](decisions/provider-decisions.md), [BL-22](#bl-22--provider-evaluation--certification-standards-theo-domain), [FIN-002](decisions/financial-decisions.md), [SD-047](decisions/strategic-decisions.md), [SD-016](decisions/provider-decisions.md), [SD-048](decisions/strategic-decisions.md), [SD-040](decisions/strategic-decisions.md).
- **Trạng thái:** Resolved — đóng bằng suy ra kết hợp chuyển phạm vi: đường xử lý xác minh thất bại hoặc Provider từ chối bổ sung — Provider giữ nguyên mức trust hiện tại với quyền hạn tương ứng theo nguyên tắc progressive trust ([SD-016](decisions/provider-decisions.md), [SD-042](decisions/provider-decisions.md)); chưa Verified thì không rút được Earning balance ([FIN-002](decisions/financial-decisions.md)); phát hiện gian lận danh tính là vi phạm cấp hệ sinh thái, đình chỉ theo [SD-048](decisions/strategic-decisions.md). Nội dung tiêu chí Verified mặc định là bộ nội dung mặc định Ecosystem, Ecosystem sở hữu và bảo trì qua Decision Process theo SD-040/SD-046 (cách giải quyết như BL-32); quy trình xác minh chi tiết thuộc lớp design/vận hành. -->

## BL-26 — Refund, Chargeback và chi tiết thuế phí

- **Domain:** Financial / Marketplace.
- **Priority:** P1 (đề xuất).
- **Câu hỏi cần trả lời:** Refund và Chargeback được xử lý như thế nào trong quan hệ Consumer–Ecoma–Provider, khi Usage balance không hoàn trả theo [FIN-001](decisions/financial-decisions.md)? Các loại thuế và phí trong settlement được xác định và tính như thế nào? Giá trị cụ thể của phí chuyển đổi Earning → Usage là gì?
- **Vì sao cần discovery:** [FIN-001](decisions/financial-decisions.md)–[FIN-003](decisions/financial-decisions.md) và [FIN-005](decisions/financial-decisions.md) chốt số dư, settlement, rút tiền và dòng tiền hoa hồng, nhưng Refund, Chargeback và chi tiết thuế phí chưa có quyết định; đây là phần còn lại của financial lifecycle sau khi BL-04 được giải quyết.
- **Kết quả discovery cần đạt:** Quy tắc Refund/Chargeback; danh mục và cách tính thuế phí; giá trị phí chuyển đổi.
- **Liên quan:** [FIN-001](decisions/financial-decisions.md), [FIN-002](decisions/financial-decisions.md), [FIN-005](decisions/financial-decisions.md), [BL-03](#bl-03--legal-merchant-of-record-của-ecoma), BL-23, [FIN-009](decisions/financial-decisions.md).
- **Trạng thái:** Open (đã thu hẹp: chargeback chốt tại [FIN-009](decisions/financial-decisions.md); refund suy ra từ FIN-001 và việc giải phóng reservation theo FIN-007, trong LLM Marketplace refund đã chốt là hiệu chỉnh kế toán, không hoàn tiền — [LLM-020](decisions/llm-marketplace-decisions.md); còn danh mục thuế phí và giá trị phí chuyển đổi Earning → Usage).

<!-- ## BL-27 — Quy tắc membership chi tiết của Organization Provider

- **Domain:** Provider.
- **Priority:** P1 (đề xuất).
- **Câu hỏi cần trả lời:** Ai là Owner đầu tiên khi tạo Organization Provider? Quy trình chuyển quyền sở hữu, Member rời hoặc bị loại, và mời lại sau khi đã rời/bị loại diễn ra như thế nào? Danh sách quyền cụ thể cho Member của Organization Provider gồm những gì?
- **Vì sao cần discovery:** [SD-043](decisions/provider-decisions.md) chốt mô hình đúng một Owner + nhiều Member kèm danh sách quyền, nhưng các quy tắc chi tiết chưa được quyết định. Ranh giới giữ nguyên: không áp dụng máy móc mô hình Owner/Member của Consumer Organization (Domain Boundary 2).
- **Kết quả discovery cần đạt:** Quy tắc membership chi tiết cho Organization Provider: Owner đầu tiên, chuyển quyền, rời/bị loại, mời lại, danh sách quyền.
- **Liên quan:** [SD-043](decisions/provider-decisions.md), [BL-19](#bl-19--provider-actor-authorization), [BL-02](#bl-02--provider-commercial-rights-và-responsibilities), [SD-050](decisions/provider-decisions.md).
- **Trạng thái:** Resolved — đường tạo trực tiếp với Account tạo là Owner đầu tiên, chuyển giao cho Member đang hoạt động (Owner cũ thành Member thường), nội dung quyền Member theo Product và quy tắc rời/bị loại/mời lại đã chốt tại [SD-050](decisions/provider-decisions.md). -->

<!-- ## BL-28 — Vòng đời Product-owned Offering

- **Domain:** Offering / Product.
- **Priority:** P1 (đề xuất).
- **Câu hỏi cần trả lời:** Vòng đời Product-owned Offering (ai tạo, chỉnh sửa, tạm dừng, xóa) là gì? Điều gì xảy ra với Consumer đang sử dụng khi một Offering (Provider-owned hoặc Product-owned) bị tạm dừng hoặc xóa? Ecoma có quyền can thiệp khẩn cấp đối với Offering do Provider sở hữu trong tình huống sự cố hay abuse không?
- **Vì sao cần discovery:** [SD-044](decisions/provider-decisions.md) chốt phần Provider-owned Offering do Provider kiểm soát; phần Product-owned Offering và tác động lên Consumer khi Offering thay đổi trạng thái chưa được quyết định. Đây là phần còn lại của [BL-09](#bl-09--offering-lifecycle-và-retirement) sau khi được giải quyết.
- **Kết quả discovery cần đạt:** Vòng đời Product-owned Offering; quy tắc bảo vệ Consumer khi Offering tạm dừng/xóa; quyền can thiệp khẩn cấp (nếu có).
- **Liên quan:** [SD-044](decisions/provider-decisions.md), [SD-034](decisions/strategic-decisions.md), [SD-036](decisions/strategic-decisions.md), [BL-11](#bl-11--composite-offering-và-trách-nhiệm-cung-cấp-dịch-vụ), [SD-046](decisions/strategic-decisions.md), [SD-048](decisions/strategic-decisions.md), [FIN-007](decisions/financial-decisions.md), [FIN-009](decisions/financial-decisions.md), [SD-054](decisions/strategic-decisions.md).
- **Trạng thái:** Resolved — đóng bằng suy ra, không cần quyết định mới: quy tắc bảo vệ Consumer khi Provider tự ý tạm dừng hoặc xóa Offering — phần đã bảo đảm nguồn được hoàn tất theo [FIN-007](decisions/financial-decisions.md); nếu dịch vụ không cung cấp được, reservation được giải phóng về Usage balance theo [FIN-009](decisions/financial-decisions.md); không hoàn tiền theo [FIN-001](decisions/financial-decisions.md); nghĩa vụ lịch sử được bảo toàn theo [SD-023](decisions/provider-decisions.md); vi phạm cam kết xử lý theo [SD-014](decisions/provider-decisions.md) và [SD-048](decisions/strategic-decisions.md) (gồm can thiệp khẩn cấp khi đủ mức đình chỉ). Vòng đời Product-owned Offering là chính sách cấp 3 của Product theo test SD-046; với Decentralized Cloud Object Storage là Product sở hữu Offering duy nhất hiện tại theo SD-054, vòng đời cụ thể do Product tự quyết khi triển khai. -->

<!-- ## BL-29 — Phân cấp các capability chưa xác định theo test cam kết dùng chung

- **Câu hỏi cần trả lời:** Marketplace Operation, Provider Evaluation & Certification và Offering Management trong Business Capability Map được xếp vào cấp quan hệ nào theo test cam kết dùng chung? Các chính sách hiện có (ví dụ invitation expiry chung tại INV-005) có cần được phân cấp lại sau khi áp test không?
- **Vì sao cần discovery:** SD-046 chốt khung ba cấp và quy tắc xếp cấp, nhưng chưa áp dụng cho các capability đang ở trạng thái ownership undecided (mục 7, 8, 9) và chưa rà soát các chính sách hiện có dưới ánh sáng của test.
- **Liên quan:** [SD-046](decisions/strategic-decisions.md), [business-capability-map](business-capability-map.md) (mục 7, 8, 9), [INV-005](decisions/invitation-decisions.md), [BL-21](#bl-21--service-routing-và-commercial-influence), [BL-22](#bl-22--provider-evaluation--certification-standards-theo-domain), [BL-28](#bl-28--vòng-đời-product-owned-offering).
- **Trạng thái:** Resolved — các capability đã được phân cấp: Marketplace Operation là vận hành thuộc Product (SD-040) ràng buộc bởi invariant cấp hệ sinh thái ([SD-045](decisions/provider-decisions.md), [SD-049](decisions/strategic-decisions.md)); Provider Evaluation & Certification chốt tại [SD-047](decisions/strategic-decisions.md); Offering Management theo [SD-034](decisions/strategic-decisions.md) với invariant vòng đời Provider-owned tại [SD-044](decisions/provider-decisions.md). [INV-005](decisions/invitation-decisions.md) được xác nhận đọc theo tầng 2: TTL mặc định Ecosystem, Product được phủ. -->

<!-- ## BL-30 — Registry override công khai của Product

- **Câu hỏi cần trả lời:** Registry ghi nhận việc Product phủ chính sách cấp 2 cần nội dung tối thiểu nào, ai sở hữu và được lưu trữ ở đâu ở lớp business?
- **Vì sao cần discovery:** SD-046 yêu cầu override phải được khai báo công khai và truy vết được nhưng chưa định nghĩa cơ chế, chủ sở hữu và vị trí lưu trữ của registry.
- **Liên quan:** [SD-046](decisions/strategic-decisions.md), [FIN-004](decisions/financial-decisions.md), [observability](../07-quality-attributes/observability.md).
- **Trạng thái:** Resolved — đóng bằng suy ra, không cần quyết định mới: nội dung tối thiểu của khai báo override (Product, chính sách bị phủ, giá trị phủ, lý do; công khai và truy vết được) đã được chốt trong chính văn bản [SD-046](decisions/strategic-decisions.md); chủ thể khai báo là chính Product theo SD-046; cơ chế phản đối và thu hồi override thuộc Ecosystem theo SD-046. Vị trí lưu trữ và hình thức hiện thực registry thuộc lớp design. -->

## BL-31 — Giới hạn biên độ bảo đảm nguồn cho Provider đình chỉ hoặc rủi ro

- **Câu hỏi cần trả lời:** Biên độ bảo đảm nguồn (reservation horizon) được giới hạn thế nào cho Offering của Provider đang bị đình chỉ hoặc thuộc hồ sơ rủi ro, để nghĩa vụ hoàn tất phần đã cam kết không kéo dài không kiểm soát?
- **Vì sao cần discovery:** FIN-007 yêu cầu hoàn tất phần đã cam kết khi từ chối khởi phát mới, và SD-048 yêu cầu hoàn tất phần đã cam kết khi Provider bị đình chỉ cấp Ecoma Platform; cả hai đều cần biên độ giới hạn để nghĩa vụ không mở rộng vô hạn theo reservation.
- **Liên quan:** [FIN-007](decisions/financial-decisions.md), [SD-048](decisions/strategic-decisions.md), [SD-023](decisions/provider-decisions.md).
- **Trạng thái:** Open.

<!-- ## BL-32 — Ownership nội dung mặc định Ecosystem

- **Câu hỏi cần trả lời:** Ai soạn, phê duyệt và cập nhật các bộ nội dung mặc định cấp Ecosystem (danh mục vi phạm hệ sinh thái, tiêu chí chứng nhận mặc định, tiêu chí KYC theo nhóm đối tượng)? Quan hệ giữa việc duy trì nội dung mặc định này và registry override tại BL-30 vận hành ra sao?
- **Vì sao cần discovery:** SD-047 và SD-048 đều dựa trên khái niệm "mặc định Ecosystem" cho nội dung nghiệp vụ nhưng chưa xác định chủ sở hữu và quy trình duy trì của các bộ nội dung đó.
- **Liên quan:** [SD-046](decisions/strategic-decisions.md), [SD-047](decisions/strategic-decisions.md), [SD-048](decisions/strategic-decisions.md), [BL-30](#bl-30--registry-override-công-khai-của-product).
- **Trạng thái:** Resolved — đóng bằng suy ra, không cần quyết định mới: bộ nội dung mặc định cấp Ecosystem là năng lực dùng chung thuộc sở hữu Ecosystem theo [SD-040](decisions/strategic-decisions.md); mọi thay đổi nội dung mặc định đi qua Decision Process theo [SD-046](decisions/strategic-decisions.md). Phân công vai trò cụ thể để soạn/phê duyệt là chỉ định governance theo review-authority (hiện trạng Chưa chỉ định), ngoài phạm vi domain discovery. -->

## BL-33 — Danh mục nguyên nhân Account suspension

- **Câu hỏi cần trả lời:** Danh mục nguyên nhân Account suspension gồm những nhóm nào và nhóm nào thuộc loại vi phạm (đóng băng tuyệt đối) hay loại an toàn/pháp lý/kỹ thuật (cho phép chuyển giao cứu chủ thể) theo ID-011?
- **Vì sao cần discovery:** ID-011 chốt cơ chế lan theo quyền sở hữu và việc phân xử theo nguyên nhân nhưng chưa xác định nội dung danh mục nguyên nhân.
- **Liên quan:** [ID-011](decisions/account-identity-decisions.md), [SD-048](decisions/strategic-decisions.md), [BL-22](#bl-22--provider-evaluation--certification-standards-theo-domain).
- **Trạng thái:** Open.

## BL-34 — Hình thành ban đầu Individual Provider ngoài chuyển đổi

- **Câu hỏi cần trả lời:** Individual Provider được hình thành ban đầu như thế nào ngoài đường chuyển đổi theo SD-024 — ai đăng ký, điều kiện gì, có tương đương đường tạo trực tiếp của Organization Provider theo SD-050 không?
- **Vì sao cần discovery:** provider-lifecycle.md ghi việc hình thành ban đầu của Individual Provider chưa được quyết định nhưng trước giờ không có item backlog nào theo dõi chủ đề này; SD-042 chốt quy trình trust theo nhóm giấy tờ nhưng không phát biểu tường minh đường hình thành ban đầu.
- **Liên quan:** [SD-019](decisions/provider-decisions.md), [SD-024](decisions/provider-decisions.md), [SD-042](decisions/provider-decisions.md), [SD-050](decisions/provider-decisions.md).
- **Trạng thái:** Open.

## BL-35 — Xử lý nghĩa vụ đã phát sinh của Consumer Organization sau termination

- **Câu hỏi cần trả lời:** Nghĩa vụ tài chính, hợp đồng đã phát sinh của Consumer Organization bị terminate được xử lý cụ thể ra sao — ai thanh toán, theo kênh nào, trong thời hạn bao lâu?
- **Vì sao cần discovery:** [ORG-014](decisions/consumer-organization-decisions.md) chốt nghĩa vụ tồn tại sau termination và [FIN-009](decisions/financial-decisions.md) chốt chargeback làm balance âm tạm kèm khóa tiêu dùng, nhưng chưa có quyết định nào về cơ chế thu hồi/thanh toán nghĩa vụ của Organization đã terminate; consumer-organization-lifecycle ghi chủ đề này chưa quyết định.
- **Liên quan:** [ORG-014](decisions/consumer-organization-decisions.md), [FIN-009](decisions/financial-decisions.md), [SD-023](decisions/provider-decisions.md).
- **Trạng thái:** Open.

## BL-36 — Thẩm quyền loại Member khỏi Consumer Organization

- **Câu hỏi cần trả lời:** Chủ thể nào có quyền loại một Member khỏi Consumer Organization — Owner, Member được cấp quyền quản lý thành viên, hay cả hai theo phạm vi?
- **Vì sao cần discovery:** MEM-006 chốt Member được cấp quyền quản lý có thể quyết định quyền của Member khác trong phạm vi được cấp nhưng không phát biểu tường minh quyền loại Member; membership-lifecycle đánh dấu đây là giả định cần xác nhận trong khi consumer-membership-management trình bày như đã chốt.
- **Liên quan:** [MEM-006](decisions/membership-decisions.md), [MEM-011](decisions/membership-decisions.md), [MEM-013](decisions/membership-decisions.md).
- **Trạng thái:** Open.

## BL-37 — Tiêu chí xác minh và phê duyệt Provider Transformation

- **Câu hỏi cần trả lời:** Tiêu chí và quy trình xác minh, phê duyệt chuyển đổi tư cách Provider (Individual ↔ Organization) gồm những gì?
- **Vì sao cần discovery:** [SD-026](decisions/provider-decisions.md) chốt chuyển đổi có hiệu lực sau khi được xác minh và phê duyệt nhưng tiêu chí cụ thể chưa được quyết định; các tài liệu quy trình transformation đang trỏ "theo dõi tại Discovery Backlog" mà chưa có item tương ứng.
- **Liên quan:** [SD-024](decisions/provider-decisions.md), [SD-026](decisions/provider-decisions.md), [SD-042](decisions/provider-decisions.md), [SD-050](decisions/provider-decisions.md).
- **Trạng thái:** Open.

<!-- ## BL-38 — Provider cost trong LLM Marketplace

- **Câu hỏi cần trả lời:** Chi phí upstream mà Ecoma trả cho nguồn cung (provider cost, khác với giá Provider bán cho Consumer theo LLM-013) có nguồn dữ liệu nào, ai sở hữu và cập nhật theo cơ chế nào?
- **Vì sao cần discovery:** [LLM-001](decisions/llm-marketplace-decisions.md) chốt mọi request đi qua Ecoma nhưng chưa chốt provider cost được lấy từ đâu (Provider khai báo, dữ liệu thực tế, hay không tồn tại); chưa có provider cost thì chưa kết luận được mô hình lợi nhuận markup của Ecoma trong Product này, ảnh hưởng [FIN-005](decisions/financial-decisions.md) khi vận hành.
- **Liên quan:** [LLM-001](decisions/llm-marketplace-decisions.md), [LLM-013](decisions/llm-marketplace-decisions.md), [FIN-005](decisions/financial-decisions.md), [SD-015](decisions/provider-decisions.md), BL-03.
- **Trạng thái:** Resolved. Chốt: không cần dữ liệu provider cost — Ecoma không có khái niệm chi phí vốn trong Product này; mô hình lợi nhuận là hoa hồng % trên giá bán theo FIN-005. -->

## BL-39 — Phạm vi khái niệm First-Party Provider

- **Câu hỏi cần trả lời:** First-Party Provider (do Ecoma vận hành) là khái niệm riêng của Domain LLM hay khái niệm cấp Ecoma Platform áp dụng cho cả hai domain? Khi Ecoma chủ sàn mà đồng thời góp máy cạnh tranh (first-party supply trong Domain GPU), chính sách công bằng giá/ưu tiên giữa first-party và Provider bên thứ ba là gì?
- **Vì sao cần discovery:** [LLM-024](decisions/llm-marketplace-decisions.md) chốt hạng riêng cho First-Party Provider trong phạm vi Domain LLM (không progressive trust, không payable/payout, vị trí đặc biệt chỉ ở Display); [GPU-011](decisions/gpu-cloud-marketplace-decisions.md) chốt Ecoma có first-party GPU supply trong Domain GPU, chịu đúng quy tắc Provider thường nhưng chưa có chính sách chống xung đột lợi ích (giá, ưu tiên tài nguyên, hiển thị) giữa Ecoma và Provider bên thứ ba.
- **Liên quan:** [LLM-024](decisions/llm-marketplace-decisions.md), [GPU-011](decisions/gpu-cloud-marketplace-decisions.md), [SD-029](decisions/strategic-decisions.md), [SD-045](decisions/provider-decisions.md), [SD-049](decisions/strategic-decisions.md).
- **Trạng thái:** Open (mở rộng: cần quyết định cấp Ecoma Platform cho first-party supply và chính sách cạnh tranh công bằng sau khi [GPU-011](decisions/gpu-cloud-marketplace-decisions.md) chốt có first-party GPU).

## BL-40 — Phạm vi dữ liệu Profile cốt lõi và quy trình cài đặt Preference

- **Câu hỏi cần trả lời:** Phạm vi dữ liệu nào thuộc "Profile cốt lõi" theo SD-013, và Locale Preference cùng Timezone Preference được thiết lập/cập nhật theo quy trình nào — thời điểm nào, ai được quyền thay đổi, xử lý ra sao trên các luồng mà người nhận chưa có preference (ví dụ email OTP khi đăng ký, hiển thị timestamp khi chưa có timezone)?
- **Vì sao cần discovery:** [SD-055](decisions/strategic-decisions.md) xếp Locale Preference vào Profile cốt lõi sở hữu Ecoma Platform, [SD-057](decisions/strategic-decisions.md) bổ sung Timezone Preference là thuộc tính riêng cùng nằm trong Profile cốt lõi, nhưng phạm vi dữ liệu Profile cốt lõi vẫn chưa được xác định cụ thể và quy tắc mặc định khi chưa thiết lập chưa được quyết định; các chủ đề cần kết luận cùng nhau để không tách rời sở hữu dữ liệu Profile.
- **Kết quả discovery cần đạt:** Danh mục dữ liệu Profile cốt lõi; quy trình thiết lập và thay đổi Locale Preference, Timezone Preference; quy tắc mặc định hiển thị khi chưa có preference.
- **Liên quan:** [SD-013](decisions/strategic-decisions.md), [SD-055](decisions/strategic-decisions.md).
- **Trạng thái:** Open.

## BL-41 — Vận hành Language Registry

- **Câu hỏi cần trả lời:** Quy trình thêm/đình chỉ một ngôn ngữ trong Language Registry là gì, một ngôn ngữ trong registry có những trạng thái nào (enabled, beta, disabled…), và quan hệ giữa trạng thái registry với English fallback khi Product chưa kịp dịch?
- **Vì sao cần discovery:** [SD-055](decisions/strategic-decisions.md) chốt registry tập trung cấp Ecoma Platform cập nhật động nhưng cơ chế vận hành và ngữ nghĩa trạng thái của ngôn ngữ trong registry chưa được quyết định.
- **Kết quả discovery cần đạt:** Quy trình cập nhật registry; ngữ nghĩa trạng thái ngôn ngữ; quy tắc fallback khi ngôn ngữ rời registry.
- **Liên quan:** [SD-055](decisions/strategic-decisions.md), [SD-040](decisions/strategic-decisions.md), [SD-046](decisions/strategic-decisions.md).
- **Trạng thái:** Open.

## BL-42 — Bản ngôn ngữ binding của tài liệu pháp lý theo từng thị trường

- **Câu hỏi cần trả lời:** Với mỗi thị trường Ecoma phục vụ, bản ngôn ngữ nào của Terms of Service/chính sách/điều khoản có giá trị ràng buộc, và xử lý ra sao khi người dùng giao dịch xuyên thị trường hoặc thị trường yêu cầu ngôn ngữ địa phương binding?
- **Vì sao cần discovery:** [SD-056](decisions/strategic-decisions.md) chốt nguyên tắc binding theo pháp luật khu vực với English là mặc định khi luật im lặng, nhưng kết luận theo từng thị trường phụ thuộc tư cách Merchant of Record ([BL-03](#bl-03--legal-merchant-of-record-của-ecoma)) và danh sách thị trường mục tiêu chưa được xác định.
- **Kết quả discovery cần đạt:** Bảng ánh xạ thị trường → bản ngôn ngữ binding; quy tắc cho giao dịch xuyên thị trường.
- **Liên quan:** [SD-055](decisions/strategic-decisions.md), [SD-056](decisions/strategic-decisions.md), [BL-03](#bl-03--legal-merchant-of-record-của-ecoma).
- **Trạng thái:** Open.

## BL-43 — Tiền tệ niêm yết Offering và tiền tệ của balance/settlement

- **Câu hỏi cần trả lời:** Offering được niêm yết bằng một tiền tệ duy nhất cấp Ecoma Platform hay theo chính sách từng domain; tiền tệ của Usage balance, Earning balance và settlement (FIN-001, FIN-002) xử lý quan hệ với tiền tệ niêm yết ra sao, có tự làm quy đổi FX nội bộ không?
- **Vì sao cần discovery:** Không có quyết định tài chính nào xác định tiền tệ (FIN-001–FIN-009, LLM-013, LLM-030); [SD-057](decisions/strategic-decisions.md) chỉ chốt phần trình bày theo locale và tách riêng tiền tệ sang vòng tài chính; kết luận ảnh hưởng trực tiếp BL-26 (thuế phí, chargeback) và LLM-016 (admission kiểm tra số dư).
- **Kết quả discovery cần đạt:** Quyết định tiền tệ niêm yết; tiền tệ balance/settlement; chính sách FX (nếu có).
- **Liên quan:** [SD-057](decisions/strategic-decisions.md), [BL-26](#bl-26--refund-chargeback-và-chi-tiết-thuế-phí), [FIN-001](decisions/financial-decisions.md), [FIN-002](decisions/financial-decisions.md), [LLM-013](decisions/llm-marketplace-decisions.md), [LLM-016](decisions/llm-marketplace-decisions.md).
- **Trạng thái:** Open.

## BL-44 — Mở rộng dạng cung ứng GPU Cloud Marketplace

- **Câu hỏi cần trả lời:** Khi nào và theo trình tự nào GPU Cloud Marketplace mở rộng dạng cung ứng ngoài instance (serverless, reserved, container job)?
- **Vì sao cần discovery:** [GPU-001](decisions/gpu-cloud-marketplace-decisions.md) chốt Phase 1 chỉ có on-demand và interruptible, với định hướng mở rộng serverless/reserved/container job sau khi có nhu cầu thực; cần theo dõi để không lẫn vào phạm vi Phase 1 và không thiết kế trước khi có nhu cầu.
- **Liên quan:** [GPU-001](decisions/gpu-cloud-marketplace-decisions.md), [SD-034](decisions/strategic-decisions.md), [SD-054](decisions/strategic-decisions.md).
- **Trạng thái:** Open.

## BL-45 — Hành vi instance interruptible khi bị preempt

- **Câu hỏi cần trả lời:** Khi instance interruptible bị outbid/thu hồi: quy tắc dừng tính phí, bảo toàn dữ liệu, và hành vi khi máy trống lại (instance tự resume hay Consumer tự start) là gì?
- **Vì sao cần discovery:** [GPU-001](decisions/gpu-cloud-marketplace-decisions.md) chốt có mode interruptible nhưng hành vi tại thời điểm preempt chưa được quyết định; các đối thủ chia hai trường phái auto-resume (Vast) và consumer tự start (Runpod spot), mỗi hướng có hệ quả khác nhau về chi phí bất ngờ và tính liên tục workload.
- **Liên quan:** [GPU-001](decisions/gpu-cloud-marketplace-decisions.md), [GPU-003](decisions/gpu-cloud-marketplace-decisions.md), [GPU-006](decisions/gpu-cloud-marketplace-decisions.md), [BL-31](#bl-31--giới-hạn-biên-độ-bảo-đảm-nguồn-cho-provider-đình-chỉ-hoặc-rủi-ro).
- **Trạng thái:** Open.

## BL-46 — Quan hệ giữa xóa instance tại $0 (GPU-003) và FIN-007

- **Câu hỏi cần trả lời:** GPU-003 chốt xóa instance và disk khi Usage balance chạm $0 — điều này mâu thuẫn thế nào với quy tắc từ chối-khởi-phát-mới/hoàn-thành-cam-đợi của [FIN-007](decisions/financial-decisions.md), và khai báo override theo SD-046 cần ghi nội dung gì để hai quyết định nhất quán?
- **Vì sao cần discovery:** [GPU-003](decisions/gpu-cloud-marketplace-decisions.md) là quyết định Product-level khác hành vi bảo toàn tiêu dùng ngầm của FIN-007; override cần được đối chiếu và khai báo tường minh theo [SD-046](decisions/strategic-decisions.md) (và [FIN-004](decisions/financial-decisions.md)) trước khi hiện thực, vì tác động tài chính xuyên domain.
- **Liên quan:** [GPU-003](decisions/gpu-cloud-marketplace-decisions.md), [FIN-004](decisions/financial-decisions.md), [FIN-007](decisions/financial-decisions.md), [SD-046](decisions/strategic-decisions.md).
- **Trạng thái:** Open.

## BL-47 — Tham số cơ chế bồi thường GPU Cloud Marketplace

- **Câu hỏi cần trả lời:** Tham số cụ thể của cơ chế bồi thường tự động theo [GPU-006](decisions/gpu-cloud-marketplace-decisions.md): mức multiplier theo loại sự cố, danh mục sự cố được tính, cơ chế xác nhận sự cố (quorum/có chủ đích), cap tối đa, và quan hệ với mức phí platform (BL-26) là gì?
- **Vì sao cần discovery:** [GPU-006](decisions/gpu-cloud-marketplace-decisions.md) chỉ chốt khung (credit tự động, tài trợ từ Earning của Provider gây sự cố); tham số định lượng và quy tắc xác định sự cố ảnh hưởng trực tiếp kinh tế supply và cần giá trị cụ thể để vận hành.
- **Liên quan:** [GPU-006](decisions/gpu-cloud-marketplace-decisions.md), [FIN-002](decisions/financial-decisions.md), [FIN-005](decisions/financial-decisions.md), [SD-036](decisions/strategic-decisions.md), [BL-26](#bl-26--refund-chargeback-và-chi-tiết-thuế-phí).
- **Trạng thái:** Open.

## BL-48 — Thứ tự và thời điểm triển khai của hai domain

- **Câu hỏi cần trả lời:** Thứ tự ưu tiên và thời điểm triển khai Domain LLM và Domain GPU trong sản phẩm AI Factory Marketplace là gì — song song hay theo giai đoạn?
- **Vì sao cần discovery:** [SD-058](decisions/strategic-decisions.md) thay thế mô hình Product Portfolio và thứ tự ưu tiên cũ tại [SD-051](decisions/strategic-decisions.md); [SD-059](decisions/strategic-decisions.md) chốt cấu trúc hai domain ngang hàng nhưng không quyết định thứ tự hoặc thời điểm triển khai.
- **Liên quan:** [SD-058](decisions/strategic-decisions.md), [SD-059](decisions/strategic-decisions.md), [SD-051](decisions/strategic-decisions.md).
- **Trạng thái:** Open.

## BL-49 — Điều kiện phát sinh tích hợp liên kết cung ứng GPU → LLM

- **Câu hỏi cần trả lời:** Khi nhu cầu thực nào xuất hiện thì tích hợp liên kết cung ứng giữa Domain GPU và Domain LLM (tài nguyên GPU của một Provider trở thành hạ tầng chạy Offering LLM) được khởi động discovery và thiết kế, ở mức nghiệp vụ là gì?
- **Vì sao cần discovery:** [SD-060](decisions/strategic-decisions.md) chốt liên kết được phép xảy ra, Ecoma mong muốn, ranh giới hai domain không được chặn liên kết, nhưng không thiết kế tích hợp trước khi có nhu cầu thực; cần ghi nhận điều kiện/trigger để mở lại chủ đề theo đúng quy trình.
- **Liên quan:** [SD-060](decisions/strategic-decisions.md), [SD-059](decisions/strategic-decisions.md), [SD-037](decisions/strategic-decisions.md).
- **Trạng thái:** Open.

## BL-50 — API tự động hóa cho Domain GPU

- **Câu hỏi cần trả lời:** Domain GPU cần API tự động hóa (khởi tạo/dừng/xóa instance bằng chương trình) ở dạng nào và khi nào — hiện Consumer truy cập qua SSH và console, không có API tiêu dùng?
- **Vì sao cần discovery:** [SD-061](decisions/strategic-decisions.md) chốt Domain GPU không dùng API key và chưa có API tự động hóa; khi nhu cầu automation thực sự phát sinh, cần quyết định hình thức credential và phạm vi API thay vì thiết kế trước.
- **Liên quan:** [SD-061](decisions/strategic-decisions.md), [GPU-012](decisions/gpu-cloud-marketplace-decisions.md), [LLM-022](decisions/llm-marketplace-decisions.md).
- **Trạng thái:** Open.

## Tài liệu liên quan

- [Business Capability Map](business-capability-map.md)
- [Discovery Charter](../00-governance/discovery-charter.md)
- [Decision Process](../00-governance/decision-process.md)
