# Business Capability Map

## Mục đích

Tài liệu này ghi nhận các capability candidates ở mức Discovery ban đầu của Ecoma, làm đầu vào cho vòng Discovery tiếp theo. Nguồn: các quyết định Accepted đã được ghi nhận ([SD-041](decisions/strategic-decisions.md), [SD-042](decisions/provider-decisions.md)–[SD-045](decisions/provider-decisions.md), [ID-010](decisions/account-identity-decisions.md), [FIN-001](decisions/financial-decisions.md)–[FIN-005](decisions/financial-decisions.md)), và các quyết định cấp domain của Domain LLM ([LLM-001](decisions/llm-marketplace-decisions.md)–[LLM-033](decisions/llm-marketplace-decisions.md)) và Domain GPU ([GPU-001](decisions/gpu-cloud-marketplace-decisions.md)–[GPU-011](decisions/gpu-cloud-marketplace-decisions.md), theo [SD-059](decisions/strategic-decisions.md)). Ngoài ra, một số capability candidate mới được ghi nhận ở trạng thái **Proposal**; các entry này không trích quyết định nào làm căn cứ sở hữu và chưa có cấp sở hữu được xác lập.

Theo [SD-010](decisions/strategic-decisions.md), Strategic Domain Discovery và Business Capability Map cần hoàn thành trước khi xác định Bounded Context và Tactical Design.

## Nguyên tắc đọc tài liệu

- Đây **không phải** danh sách Bounded Context, module hay service. Business Capability, Bounded Context và Microservice là các khái niệm khác nhau (xem [Discovery Charter](../00-governance/discovery-charter.md), mục 7).
- Mỗi capability chỉ được ghi ở mức mục đích nghiệp vụ và phạm vi trách nhiệm sơ bộ; tài liệu này **không** thiết kế cách triển khai.
- Cấp sở hữu (Ecoma Platform / Domain) chỉ là mức **dự kiến**, và chỉ được ghi khi có căn cứ từ quyết định đã Accepted; khi chưa rõ thì ghi rõ là chưa xác định.
- Tất cả các capability sẽ được tinh chỉnh qua các vòng Discovery tiếp theo. Các điểm chưa rõ được theo dõi tại [Discovery Backlog](discovery-backlog.md).
- Trích dẫn quyết định theo mã (SD-xxx, ID-xxx, ORG-xxx, MEM-xxx, INV-xxx, FIN-xxx, LLM-xxx); SD-001–SD-040 đã được ghi nhận trong giai đoạn đầu của discovery, SD-041 trở đi có nguồn riêng tại [strategic decisions](decisions/strategic-decisions.md); LLM-xxx là quyết định cấp domain của Domain LLM tại [llm-marketplace decisions](decisions/llm-marketplace-decisions.md); GPU-xxx là quyết định cấp domain của Domain GPU tại [gpu-cloud-marketplace decisions](decisions/gpu-cloud-marketplace-decisions.md).
- Entry ở trạng thái Proposal (đánh dấu tường minh ở mục đích nghiệp vụ) không được trình bày như capability đã được xác nhận.

## Cách đọc các trường

Mỗi capability gồm bốn trường:

- **Mục đích nghiệp vụ:** capability này tồn tại để làm gì, diễn đạt bằng ngôn ngữ nghiệp vụ.
- **Phạm vi trách nhiệm sơ bộ:** những gì capability này bao quát, chưa phân cấp thành chức năng chi tiết.
- **Cấp sở hữu dự kiến:** Ecoma Platform hoặc Domain, kèm căn cứ quyết định; nếu chưa có căn cứ đơn nhất thì ghi "chưa xác định".
- **Điểm chưa rõ cần discovery tiếp:** các câu hỏi mở, không trả lời trong tài liệu này.

## Capability candidates

### 1. Account & Identity

- **Mục đích nghiệp vụ:** cung cấp danh tính dùng chung cho người dùng xuyên suốt sản phẩm — provisioning và xác thực Account.
- **Phạm vi trách nhiệm sơ bộ:** tạo và quản lý Account, email verification, chuẩn tích hợp identity (OIDC, OAuth2, JWKS, MFA), các quy tắc về email và vòng đời Account; closure Account theo điều kiện tiên quyết (không còn Org sở hữu, đã chấm dứt Individual Provider Identity, đã xử lý xong số dư — [ID-010](decisions/account-identity-decisions.md)).
- **Cấp sở hữu dự kiến:** Ecoma Platform-level. Căn cứ: [ID-001](decisions/account-identity-decisions.md) (một Account dùng làm danh tính chung), [SD-012](decisions/strategic-decisions.md) (Unified User Identity), [ID-010](decisions/account-identity-decisions.md) (Account closure là thao tác cấp Ecoma Platform với điều kiện từ từng domain).
- **Điểm chưa rõ cần discovery tiếp:** danh mục nguyên nhân Account suspension — [BL-33](discovery-backlog.md) (cơ chế suspension đã chốt theo [ID-011](decisions/account-identity-decisions.md)); Machine/Agent đã chốt theo [ID-013](decisions/account-identity-decisions.md): máy không phải chủ thể độc lập, chỉ hành động theo ủy quyền.

### 2. Shared Profile & Personalization

- **Mục đích nghiệp vụ:** lưu giữ và cung cấp thông tin Profile cốt lõi cùng Personalization dùng chung cho toàn sản phẩm.
- **Phạm vi trách nhiệm sơ bộ:** phần Profile cốt lõi và Personalization dùng chung ở cấp Ecoma Platform — gồm Locale Preference và Timezone Preference của người dùng theo [SD-055](decisions/strategic-decisions.md), [SD-057](decisions/strategic-decisions.md); quản lý tập trung Language Registry — danh sách ngôn ngữ hỗ trợ cập nhật động ([SD-055](decisions/strategic-decisions.md)); cho phép từng domain có phần mở rộng Profile phục vụ nghiệp vụ riêng.
- **Cấp sở hữu dự kiến:** Ecoma Platform đối với phần cốt lõi và Personalization dùng chung; Domain đối với các phần mở rộng. Căn cứ: [SD-013](decisions/strategic-decisions.md) (Hybrid User Profile Ownership), [SD-055](decisions/strategic-decisions.md) (Đa ngôn ngữ cấp Ecoma Platform).
- **Điểm chưa rõ cần discovery tiếp:** phạm vi dữ liệu nào thuộc "Profile cốt lõi" và quy trình cài đặt Locale Preference — [BL-40](discovery-backlog.md); quy trình vận hành Language Registry và ngữ nghĩa trạng thái ngôn ngữ — [BL-41](discovery-backlog.md).

### 3. Sách lược cấp sản phẩm

- **Mục đích nghiệp vụ:** quản trị chiến lược và vòng đời của sản phẩm AI Factory Marketplace.
- **Phạm vi trách nhiệm sơ bộ:** phát triển, mở rộng, hợp nhất, thay thế và ngừng năng lực của sản phẩm; nguyên tắc quản trị cấp sản phẩm theo [SD-039](decisions/strategic-decisions.md), đọc lại theo [SD-059](decisions/strategic-decisions.md). Cấu trúc hai domain theo [SD-058](decisions/strategic-decisions.md), [SD-059](decisions/strategic-decisions.md). Xem thêm [AI Factory Marketplace](../01-strategy/ai-factory-marketplace.md).
- **Cấp sở hữu dự kiến:** Ecoma Platform. Căn cứ: [SD-039](decisions/strategic-decisions.md) (đọc theo SD-059).
- **Điểm chưa rõ cần discovery tiếp:** thứ tự và thời điểm triển khai của hai domain — [BL-48](discovery-backlog.md).

### 4. Provider Identity Management

- **Mục đích nghiệp vụ:** quản lý danh tính Provider ở cấp Ecoma Platform để danh tính được đăng ký một lần và tái sử dụng trên cả hai domain.
- **Phạm vi trách nhiệm sơ bộ:** đăng ký danh tính Provider một lần với Ecoma; hỗ trợ Individual Provider và Organization Provider; cho phép một Account sở hữu một Individual Provider Identity và đại diện hoặc quản lý nhiều Organization Provider độc lập; chuyển đổi hai chiều giữa hai tư cách mà vẫn giữ nguyên danh tính.
- **Cấp sở hữu dự kiến:** Ecoma Platform. Căn cứ: [SD-018](decisions/provider-decisions.md) (Ecosystem-wide Provider Identity), [SD-019](decisions/provider-decisions.md) (Multiple Provider Representation), [SD-021](decisions/provider-decisions.md) (Identity-preserving Transformation), [SD-024](decisions/provider-decisions.md) (Bidirectional Transformation).
- **Điểm chưa rõ cần discovery tiếp:** không còn — các quy tắc chi tiết bên trong Organization Provider (Owner đầu tiên, chuyển quyền sở hữu, rời/bị loại, mời lại) đã chốt tại [SD-050](decisions/provider-decisions.md), bổ sung mô hình 1 Owner + Member kèm quyền theo [SD-043](decisions/provider-decisions.md).

### 5. Provider Governance

- **Mục đích nghiệp vụ:** quản trị tư cách, mức tin cậy và nghĩa vụ của Provider trong suốt vòng đời tham gia cung ứng.
- **Phạm vi trách nhiệm sơ bộ:** progressive trust — quyền hạn ban đầu giới hạn và mở rộng theo mức xác minh, năng lực, độ tin cậy; verification và approval cho việc chuyển đổi tư cách; bảo toàn lịch sử và nghĩa vụ đã phát sinh; phân loại số dư và quyền lợi tài chính theo trạng thái Provider. Cơ chế trust hai giai đoạn: Activated (KYC theo 3 nhóm đối tượng: cá nhân, hộ kinh doanh, doanh nghiệp; đủ giấy tờ → cung ứng ngay) và Verified (điều kiện rút tiền Earning balance); xác minh bổ sung khi trùng lặp thông tin hoặc dấu hiệu abuse ([SD-042](decisions/provider-decisions.md)); Organization Provider có đúng 1 Owner và nhiều Member kèm quyền ([SD-043](decisions/provider-decisions.md)).
- **Cấp sở hữu dự kiến:** Ecoma Platform đối với các nguyên tắc và quy trình trust. Căn cứ: [SD-016](decisions/provider-decisions.md) (Progressive Provider Trust), [SD-026](decisions/provider-decisions.md) (Transformation Requires Verification and Approval), [SD-042](decisions/provider-decisions.md) (quy trình trust cấp Ecoma Platform dùng chung cả hai domain), [SD-043](decisions/provider-decisions.md).
- **Điểm chưa rõ cần discovery tiếp:** không còn ở mức discovery — ánh xạ nhóm đối tượng KYC đã chốt tại [SD-047](decisions/strategic-decisions.md); đường xử lý xác minh thất bại đã đóng (BL-25): giữ nguyên mức trust hiện tại theo [SD-016](decisions/provider-decisions.md)/[SD-042](decisions/provider-decisions.md), gian lận danh tính → đình chỉ theo [SD-048](decisions/strategic-decisions.md); quyền và nghĩa vụ thương mại của Provider đã đóng qua [BL-02](discovery-backlog.md), ranh giới theo từng mô hình domain chuyển phạm vi theo [BL-23](discovery-backlog.md)/[SD-054](decisions/strategic-decisions.md); nội dung tiêu chí Verified mặc định do Ecoma Platform bảo trì qua Decision Process (SD-040/SD-046) — phần authoring nội dung, không phải câu hỏi discovery mở.

### 6. Marketplace Governance

- **Mục đích nghiệp vụ:** quản trị vai trò trung gian Marketplace và dòng tiền giữa Consumer và Provider.
- **Phạm vi trách nhiệm sơ bộ:** Ecoma có thể đóng vai trò trung gian Marketplace hoặc nhà cung cấp dịch vụ tổng hợp tùy mô hình kinh doanh từng domain; Consumer thanh toán qua Ecoma; Ecoma thu tiền từ Consumer, trừ hoa hồng và thuế phí, thanh toán cho Provider ([FIN-005](decisions/financial-decisions.md)); quản lý dòng tiền, nghĩa vụ tài chính và việc thanh toán cho Provider; tư cách pháp lý Merchant of Record chưa được xác định.
- **Cấp sở hữu dự kiến:** Ecoma Platform đối với nguyên tắc quản trị; Domain đối với mô hình kinh doanh cụ thể. Căn cứ: [SD-029](decisions/strategic-decisions.md) (vai trò xác định theo từng domain), [SD-015](decisions/provider-decisions.md) (Ecosystem-managed Marketplace Payment), [SD-030](decisions/strategic-decisions.md) (domain tự chủ business model, pricing, SLA trong nguyên tắc chung), [FIN-004](decisions/financial-decisions.md) (hạ tầng tài chính dùng chung, domain có thể thay thế), [FIN-005](decisions/financial-decisions.md).
- **Điểm chưa rõ cần discovery tiếp:** chargeback đã chốt tại [FIN-009](decisions/financial-decisions.md) và refund đã đóng (BL-26 thu hẹp theo FIN-001); chỉ còn danh mục thuế phí và giá trị phí chuyển đổi Earning → Usage — xem [BL-26](discovery-backlog.md); tư cách Merchant of Record — [BL-03](discovery-backlog.md). Proposal về kết hợp quản trị chất lượng và thương mại trong Marketplace (dữ liệu đo lường công khai, điểm đánh giá và xếp hạng ảnh hưởng vị trí hiển thị và quyền tham gia; yếu tố thương mại có thể ảnh hưởng vị trí hiển thị nhưng không được mua điểm chất lượng hoặc chứng nhận; nội dung tài trợ phải minh bạch) đang ở trạng thái Proposal — xem [BL-21](discovery-backlog.md) và [BL-22](discovery-backlog.md).

### 7. Marketplace Operation _(Proposal)_

- **Mục đích nghiệp vụ:** _(Proposal — chưa có quyết định.)_ Ecoma cung cấp nền tảng và năng lực vận hành Marketplace Operator: vận hành Marketplace nơi Provider cung ứng Offering cho Consumer. Ecoma không mặc định là nhà cung cấp trực tiếp hoặc bên bảo đảm mọi dịch vụ của Provider. Lưu ý: quan hệ thương mại trực tiếp giữa Ecoma và Consumer vẫn được giữ theo [SD-035](decisions/strategic-decisions.md); "không mặc định bảo đảm" chỉ nói về phạm vi trách nhiệm dịch vụ, vốn do domain quyết định theo [SD-036](decisions/strategic-decisions.md). Đây là refinement của [SD-029](decisions/strategic-decisions.md), chưa thay thế quyết định đó.
- **Phạm vi trách nhiệm sơ bộ:** nền tảng và năng lực để vận hành Marketplace cho từng domain; phân biệt với Marketplace Governance (mục 6) vốn nắm dòng tiền và nguyên tắc quản trị.
- **Cấp sở hữu dự kiến:** chưa xác định — đang ở trạng thái Proposal.
- **Điểm chưa rõ cần discovery tiếp:** Ranh giới Discovery & Display vs Service Routing đã chốt tại [SD-049](decisions/strategic-decisions.md): yếu tố thương mại chỉ tác động hiển thị và xếp hạng, Service Routing chỉ theo tiêu chí nghiệp vụ và kỹ thuật; cơ chế minh bạch cụ thể cho Display thuộc lớp design. Phạm vi trách nhiệm dịch vụ đầu cuối đã chốt theo hướng Ecoma đo lường thay vì bảo đảm đầu cuối ([SD-045](decisions/provider-decisions.md)).

### 8. Provider Evaluation & Certification _(Proposal)_

- **Mục đích nghiệp vụ:** _(Proposal — chưa có quyết định.)_ Đo lường, đánh giá và chứng nhận Provider, gồm các khía cạnh: Continuous Service Monitoring; Supply Verification; Quality Assessment & Benchmarking; Provider Evaluation & Certification; Public Transparency; Service Discovery & Intelligent Routing. Phạm vi cụ thể cần khám phá theo từng domain; không mặc định các khía cạnh này dùng chung một mô hình. Liên quan đến [SD-016](decisions/provider-decisions.md) (Progressive Provider Trust) nhưng chưa có quyết định nào xác lập năng lực này. Phần nền tảng đo lường đã được xác lập ở mức nguyên tắc: Ecoma đo lường thay vì bảo đảm đầu cuối — healthcheck, benchmark, xác minh tính xác thực cung ứng, metric công khai ([SD-045](decisions/provider-decisions.md)); các khía cạnh đánh giá, chứng nhận và routing vẫn ở trạng thái Proposal.
- **Phạm vi trách nhiệm sơ bộ:** sáu khía cạnh nêu trên, ở mức đề xuất; ranh giới giữa Discovery & Display với Service Routing đã chốt tại [SD-049](decisions/strategic-decisions.md).
- **Cấp sở hữu dự kiến:** chưa xác định — đang ở trạng thái Proposal.
- **Điểm chưa rõ cần discovery tiếp:** Ranh giới Discovery & Display vs Service Routing đã chốt tại [SD-049](decisions/strategic-decisions.md) (cơ chế minh bạch Display thuộc lớp design); [BL-22](discovery-backlog.md) (tiêu chuẩn đánh giá/chứng nhận theo domain, điều kiện đình chỉ/khôi phục/thu hồi).

### 9. Offering Management

- **Mục đích nghiệp vụ:** quản lý Offering — đối tượng được cung ứng trên Marketplace — trong cả mô hình Provider-owned và Product-owned.
- **Phạm vi trách nhiệm sơ bộ:** hỗ trợ cả Provider-owned Offering và Product-owned Offering; cho phép Provider cung cấp tài nguyên đầu vào hoặc dịch vụ thành phần tùy domain và Offering; bảo đảm Offering hiện hữu không phải tạo lại, chuyển giao hoặc xác minh lại chỉ vì Provider thay đổi trạng thái. Vòng đời Offering do Provider sở hữu (tạo, chỉnh sửa, tạm dừng, xóa) do chính Provider kiểm soát và không thay đổi khi Provider chuyển đổi tư cách pháp lý ([SD-044](decisions/provider-decisions.md)).
- **Cấp sở hữu dự kiến:** chưa xác định đơn nhất — chủ thể sở hữu Offering phụ thuộc mô hình kinh doanh của từng domain. Căn cứ: [SD-034](decisions/strategic-decisions.md) (Dual Offering Ownership Model), [SD-033](decisions/strategic-decisions.md) (Flexible Provider Supply Model), [SD-028](decisions/provider-decisions.md) (Offering and Service Continuity), [SD-044](decisions/provider-decisions.md) (Provider-controlled Offering Lifecycle cho phần Provider-owned).
- **Điểm chưa rõ cần discovery tiếp:** vòng đời Product-owned Offering và tác động lên Consumer khi Offering bị tạm dừng hoặc xóa.

### 10. Commercial Relationship Management

- **Mục đích nghiệp vụ:** nắm quan hệ thương mại trực tiếp giữa Ecoma và Consumer.
- **Phạm vi trách nhiệm sơ bộ:** Ecoma luôn là chủ thể có quan hệ thương mại trực tiếp với Consumer, kể cả khi Offering thuộc sở hữu của Provider; phạm vi cam kết dịch vụ của Ecoma với Consumer do từng domain quyết định; Ecoma chịu trách nhiệm đối với những cam kết do mình đưa ra.
- **Cấp sở hữu dự kiến:** Domain định nghĩa phạm vi cam kết; Ecoma là bên đứng trong quan hệ thương mại. Căn cứ: [SD-035](decisions/strategic-decisions.md) (Ecoma as Customer-facing Commercial Party), [SD-036](decisions/strategic-decisions.md) (Product-defined Service Commitments), [SD-015](decisions/provider-decisions.md).
- **Điểm chưa rõ cần discovery tiếp:** trách nhiệm Composite Offering đã chốt tại [SD-053](decisions/provider-decisions.md). Cơ chế Settlement giữa Ecoma và Provider đã chốt tại [FIN-002](decisions/financial-decisions.md) và [FIN-005](decisions/financial-decisions.md); chi tiết thuế phí còn mở — xem [BL-26](discovery-backlog.md).

### 11. Consumer Organization Management

- **Mục đích nghiệp vụ:** quản lý vòng đời của Consumer Organization — chủ thể sử dụng sản phẩm, sở hữu tài nguyên và chịu nghĩa vụ thương mại trong phạm vi sản phẩm.
- **Phạm vi trách nhiệm sơ bộ:** chính sách tạo Consumer Organization; quản lý tài chính và thanh toán của Organization; termination và các hệ quả ngay lập tức của nó (kết thúc Membership, vô hiệu Invitation, thu hồi truy cập); retention dữ liệu sau termination; nghĩa vụ đã phát sinh không bị xóa bỏ.
- **Cấp sở hữu dự kiến:** Domain. Căn cứ: [ORG-001](decisions/consumer-organization-decisions.md) (mỗi sản phẩm tự sở hữu mô hình, chính sách và vòng đời Consumer Organization), [ORG-006](decisions/consumer-organization-decisions.md) (Product-owned Commercial Policy), [ORG-010](decisions/consumer-organization-decisions.md) (Product-owned Creation Policy).
- **Điểm chưa rõ cần discovery tiếp:** không còn — deprovisioning sau termination đã đóng (BL-06): quy tắc nghiệp vụ chốt (retention theo [ORG-012](decisions/consumer-organization-decisions.md), thu hồi truy cập theo [ORG-013](decisions/consumer-organization-decisions.md)/[MEM-013](decisions/membership-decisions.md)), cơ chế cụ thể thuộc lớp design.

### 12. Membership Management

- **Mục đích nghiệp vụ:** quản lý Membership — quan hệ giữa một Account và một Consumer Organization — cùng quyền hạn phát sinh từ đó.
- **Phạm vi trách nhiệm sơ bộ:** Owner duy nhất với quyền kiểm soát tối cao; ownership transfer; Role, Permission và chính sách phân quyền; rời Organization tự nguyện; thu hồi toàn bộ quyền truy cập khi Membership kết thúc (trực tiếp hoặc qua session, token, credential phụ thuộc); Membership mới có vòng đời độc lập.
- **Cấp sở hữu dự kiến:** Domain. Căn cứ: [MEM-005](decisions/membership-decisions.md) (Product-owned Membership Authorization), [MEM-010](decisions/membership-decisions.md) (Product-scoped Membership & Authorization).
- **Điểm chưa rõ cần discovery tiếp:** tài nguyên do Member tạo ra sau khi Membership kết thúc — theo [MEM-014](decisions/membership-decisions.md) nguyên tắc đã chốt là không tự động xóa và mỗi sản phẩm tự quyết định cách xử lý, nhưng cách làm cụ thể cho từng domain vẫn cần discovery riêng.

### 13. Invitation Management

- **Mục đích nghiệp vụ:** quản lý Invitation — cơ chế hình thành Membership thông qua lời mời.
- **Phạm vi trách nhiệm sơ bộ:** tạo, chấp nhận, từ chối, thu hồi và hết hạn Invitation; ràng buộc email đích bất biến; uniqueness trong phạm vi một Consumer Organization; tính nguyên tử giữa kiểm tra điều kiện và tạo Invitation; vòng đời độc lập giữa các Invitation; vô hiệu Invitation khi Organization bị Terminated.
- **Cấp sở hữu dự kiến:** Domain đối với vận hành Invitation trong Consumer Organization; Ecoma Platform định nghĩa thời hạn hết hạn chung. Căn cứ: [INV-005](decisions/invitation-decisions.md) (Common Invitation Expiry — Ecoma định nghĩa thời hạn chung, giá trị cụ thể chưa quyết định); việc vận hành Invitation gắn với Membership thuộc phạm vi từng sản phẩm theo [MEM-010](decisions/membership-decisions.md).
- **Điểm chưa rõ cần discovery tiếp:** giá trị cụ thể của thời hạn hết hạn (theo [INV-005](decisions/invitation-decisions.md) chưa quyết định); cơ chế rate limiting và chống lạm dụng (theo [INV-008](decisions/invitation-decisions.md) mới chỉ chốt nguyên tắc áp dụng, chưa có cơ chế cụ thể).

### 14. Domain-specific Service Delivery

- **Mục đích nghiệp vụ:** cung cấp dịch vụ đặc thù của từng domain cho Consumer.
- **Phạm vi trách nhiệm sơ bộ:** đây là phạm vi riêng của từng domain — Domain LLM và Domain GPU (xem [AI Factory Marketplace](../01-strategy/ai-factory-marketplace.md)). Liên kết cung ứng giữa hai domain được phép xảy ra khi nhu cầu phát sinh nhưng không được thiết kế trước ([SD-060](decisions/strategic-decisions.md)). Nằm ngoài phạm vi của các quyết định còn lại đã ghi nhận; tài liệu này chỉ ghi nhận nguyên tắc rằng delivery thuộc domain, không mô tả chi tiết.
- **Cấp sở hữu dự kiến:** Domain. Căn cứ: [SD-006](decisions/strategic-decisions.md) (Independent Domain Ownership), [SD-030](decisions/strategic-decisions.md) (domain tự chủ nghiệp vụ trong phạm vi nguyên tắc chung), [SD-059](decisions/strategic-decisions.md).
- **Điểm chưa rõ cần discovery tiếp:** delivery của Domain LLM đã được discovery — các capability 16–21 bên dưới; delivery của Domain GPU đã được discovery — các capability 22–27 bên dưới; điều kiện phát sinh tích hợp liên kết GPU → LLM — [BL-49](discovery-backlog.md).

### 15. Financial Balance & Settlement

- **Mục đích nghiệp vụ:** nắm số dư tài chính của Consumer và Provider cùng dòng thanh toán giữa Ecoma, Consumer và Provider trong sản phẩm.
- **Phạm vi trách nhiệm sơ bộ:** hệ thống số dư kép — Usage balance (Consumer nạp trước, không hoàn trả) và Earning balance (Provider tích lũy theo thời gian thực) ([FIN-001](decisions/financial-decisions.md)); settlement cuối tháng với số khả dụng = tổng thu − thuế − phí, rút tiền sau 20 ngày, chuyển đổi Earning → Usage kèm phí và không chịu thuế ([FIN-002](decisions/financial-decisions.md)); xử lý số dư khi Provider chấm dứt ([FIN-003](decisions/financial-decisions.md)); dòng tiền Ecoma thu từ Consumer, trừ hoa hồng và thuế phí, thanh toán cho Provider ([FIN-005](decisions/financial-decisions.md)).
- **Cấp sở hữu dự kiến:** Ecoma Platform — hạ tầng tài chính dùng chung mặc định, domain có thể thay thế bằng hạ tầng riêng ([FIN-004](decisions/financial-decisions.md)). Căn cứ: [SD-015](decisions/provider-decisions.md) (Ecosystem-managed Marketplace Payment), [SD-040](decisions/strategic-decisions.md) (Federated Operations), [FIN-001](decisions/financial-decisions.md)–[FIN-005](decisions/financial-decisions.md).
- **Điểm chưa rõ cần discovery tiếp:** chi tiết thuế phí và tư cách Merchant of Record — xem [BL-03](discovery-backlog.md), [BL-26](discovery-backlog.md) (chargeback đã chốt tại [FIN-009](decisions/financial-decisions.md); refund đã đóng theo FIN-001).

### 16. LLM Inference Serving

- **Mục đích nghiệp vụ:** phục vụ mọi request inference của Domain LLM qua hạ tầng Ecoma — đây là phạm vi cam kết dịch vụ của domain này với Consumer.
- **Phạm vi trách nhiệm sơ bộ:** authentication bằng API key, admission, routing, provider dispatch, usage metering và financial settlement đều do Ecoma thực hiện ([LLM-001](decisions/llm-marketplace-decisions.md)); API công khai tương thích giao thức OpenAI cho các endpoint inference chính ([LLM-003](decisions/llm-marketplace-decisions.md)); giữ và bảo quản credential upstream theo quy tắc bảo mật ([LLM-026](decisions/llm-marketplace-decisions.md)).
- **Cấp sở hữu dự kiến:** Domain. Căn cứ: [LLM-001](decisions/llm-marketplace-decisions.md) (khai báo phạm vi cam kết theo [SD-036](decisions/strategic-decisions.md)), [SD-054](decisions/strategic-decisions.md) (vai trò trung gian Marketplace, đọc lại theo [SD-058](decisions/strategic-decisions.md)).
- **Điểm chưa rõ cần discovery tiếp:** contract API chi tiết thuộc lớp design ([LLM-003](decisions/llm-marketplace-decisions.md)).

### 17. LLM Offering & Routing Management

- **Mục đích nghiệp vụ:** quản lý Offering inference (model, capability, giá, trạng thái) và điều phối request đến Offering và endpoint phù hợp.
- **Phạm vi trách nhiệm sơ bộ:** cấu trúc Offering với endpoint/credential là tài nguyên riêng ([LLM-004](decisions/llm-marketplace-decisions.md)); nội dung hiển thị do Provider soạn — optional, không điều routing, đa ngữ theo chính sách domain ([LLM-032](decisions/llm-marketplace-decisions.md)); vòng đời `draft` → `active` → `inactive` → `retired` do Provider điều khiển ([LLM-005](decisions/llm-marketplace-decisions.md)); endpoint pool với trạng thái health ([LLM-007](decisions/llm-marketplace-decisions.md)); Model Alias thuộc Consumer ([LLM-008](decisions/llm-marketplace-decisions.md)); routing strategy do Consumer chọn ([LLM-009](decisions/llm-marketplace-decisions.md)); fallback hai cấp với ba bất biến an toàn ([LLM-010](decisions/llm-marketplace-decisions.md)); không chuẩn hóa model xuyên provider ([LLM-006](decisions/llm-marketplace-decisions.md)).
- **Cấp sở hữu dự kiến:** Domain. Căn cứ: LLM-004–LLM-010, LLM-032 — điều tiết [SD-034](decisions/strategic-decisions.md) (Dual Offering Ownership) và [SD-044](decisions/provider-decisions.md) (Provider-controlled Offering Lifecycle).
- **Điểm chưa rõ cần discovery tiếp:** không còn — verify trước khi Offering active đã chốt tại [LLM-028](decisions/llm-marketplace-decisions.md).

### 18. LLM Usage Metering & Pricing

- **Mục đích nghiệp vụ:** đo lường mức sử dụng và định giá từng request inference một cách minh bạch, truy vết được.
- **Phạm vi trách nhiệm sơ bộ:** usage chuẩn hóa năm thành phần không cộng trùng ([LLM-011](decisions/llm-marketplace-decisions.md)); trạng thái chất lượng dữ liệu usage ([LLM-012](decisions/llm-marketplace-decisions.md)); giá đa thành phần đối chiếu 1-1 với usage components ([LLM-013](decisions/llm-marketplace-decisions.md)); giá peak/off-peak ([LLM-014](decisions/llm-marketplace-decisions.md)); bảng giá versioned và snapshot giá theo request ([LLM-015](decisions/llm-marketplace-decisions.md)).
- **Cấp sở hữu dự kiến:** Domain. Căn cứ: LLM-011–LLM-015.
- **Điểm chưa rõ cần discovery tiếp:** không còn — Ecoma không duy trì provider cost; doanh thu từ hoa hồng [% trên giá bán] theo [LLM-030](decisions/llm-marketplace-decisions.md) và [FIN-005](decisions/financial-decisions.md).

### 19. LLM Admission & Financial Control

- **Mục đích nghiệp vụ:** kiểm soát khả năng tiêu dùng trước khi phát sinh chi phí và quyết toán đúng theo tiêu thụ thực tế.
- **Phạm vi trách nhiệm sơ bộ:** admission control trước dispatch ([LLM-016](decisions/llm-marketplace-decisions.md)); reservation duy nhất theo ước lượng giá của request — kiểm tra đồng thời Usage balance và limit cấp Workspace/API key ([LLM-031](decisions/llm-marketplace-decisions.md), thay thế LLM-017); charge đúng một lần theo logical request ([LLM-018](decisions/llm-marketplace-decisions.md)); sổ ghi kép là nguồn chân lý tài chính, số dư suy ra từ ledger ([LLM-019](decisions/llm-marketplace-decisions.md)); refund chỉ là hiệu chỉnh kế toán ([LLM-020](decisions/llm-marketplace-decisions.md)); wallet hiện thực Usage balance cấp Organization ([LLM-019](decisions/llm-marketplace-decisions.md), [FIN-001](decisions/financial-decisions.md), [FIN-006](decisions/financial-decisions.md)).
- **Cấp sở hữu dự kiến:** Domain — hiện thực hạ tầng tài chính Ecoma Platform; domain được thay thế bằng mô hình riêng kèm khai báo override theo [FIN-004](decisions/financial-decisions.md). Căn cứ: LLM-016–LLM-020, LLM-031 (LLM-016 hiện thực [FIN-007](decisions/financial-decisions.md)).
- **Điểm chưa rõ cần discovery tiếp:** quy tắc đối soát khi usage ở trạng thái `missing`/`malformed`/`partial` chưa có quyết định nghiệp vụ. Còn lại đã chốt: reservation duy nhất ([LLM-031](decisions/llm-marketplace-decisions.md)); limit do Owner và Member được cấp quyền quản lý ([LLM-033](decisions/llm-marketplace-decisions.md)).

### 20. LLM Workspace & API Key Management

- **Mục đích nghiệp vụ:** cho phép Consumer tổ chức tiêu dùng theo nhóm và cấp credential cho ứng dụng một cách an toàn.
- **Phạm vi trách nhiệm sơ bộ:** Workspace dưới Consumer Organization — phân quyền của Member và quota có thể giới hạn theo Workspace ([LLM-021](decisions/llm-marketplace-decisions.md)); vòng đời API key — cấp cho ứng dụng, xác thực trên mỗi request, thu hồi ([LLM-022](decisions/llm-marketplace-decisions.md)); bảo mật API key — plaintext chỉ xuất hiện đúng một lần khi bootstrap, lưu trữ hash-only ([LLM-025](decisions/llm-marketplace-decisions.md)). API key là credential riêng của Domain LLM; limit tiêu dùng theo từng domain trong Workspace ([SD-061](decisions/strategic-decisions.md), [SD-062](decisions/strategic-decisions.md)).
- **Cấp sở hữu dự kiến:** Domain. Căn cứ: LLM-021, LLM-022, LLM-025 — điều tiết [ORG-001](decisions/consumer-organization-decisions.md), [MEM-005](decisions/membership-decisions.md) và [ID-013](decisions/account-identity-decisions.md) (API key là credential scoped).
- **Điểm chưa rõ cần discovery tiếp:** không còn — phạm vi API key chốt tại [LLM-029](decisions/llm-marketplace-decisions.md): gắn Workspace, giới hạn tiêu dùng hai cấp Workspace và API key.

### 21. LLM Provider Governance Operations

- **Mục đích nghiệp vụ:** vận hành governance Provider trong phạm vi Domain LLM: hồ sơ, xác minh, eligibility, restriction và appeal.
- **Phạm vi trách nhiệm sơ bộ:** hồ sơ pháp lý, hồ sơ thuế, xác minh tài liệu, trạng thái đủ điều kiện kinh doanh, restriction, appeal ([LLM-023](decisions/llm-marketplace-decisions.md)); hạng First-Party Provider — không trải progressive trust, không tích lũy payable, vị trí đặc biệt chỉ ở Discovery & Display ([LLM-024](decisions/llm-marketplace-decisions.md)).
- **Cấp sở hữu dự kiến:** Domain (vận hành theo khung trust cấp Ecoma Platform — [SD-042](decisions/provider-decisions.md), [SD-047](decisions/strategic-decisions.md); đình chỉ lan truyền theo [SD-048](decisions/strategic-decisions.md)). Căn cứ: LLM-023, LLM-024.
- **Điểm chưa rõ cần discovery tiếp:** tiêu chí chứng nhận và điều kiện đình chỉ cụ thể — [BL-22](discovery-backlog.md); việc nâng First-Party Provider thành khái niệm cấp Ecoma Platform — [BL-39](discovery-backlog.md).

Các capability 16–21 là các capability candidates của Domain LLM; capability 22–27 là các capability candidates của Domain GPU; các capability 1–15 ở trên là cấp Ecoma Platform.

### 22. GPU Instance Serving

- **Mục đích nghiệp vụ:** cung cấp compute GPU cho Consumer dưới dạng instance persistent trên hạ tầng do Provider góp vào marketplace.
- **Phạm vi trách nhiệm sơ bộ:** hai mode on-demand và interruptible trong Phase 1; serverless/reserved/container job là mở rộng sau ([BL-44](discovery-backlog.md)); Offering do Provider sở hữu ([SD-034](decisions/strategic-decisions.md), [SD-054](decisions/strategic-decisions.md), [GPU-001](decisions/gpu-cloud-marketplace-decisions.md)).
- **Cấp sở hữu dự kiến:** Domain. Căn cứ: [GPU-001](decisions/gpu-cloud-marketplace-decisions.md) (khai báo phạm vi cung ứng theo [SD-036](decisions/strategic-decisions.md)).
- **Điểm chưa rõ cần discovery tiếp:** hành vi resume instance interruptible sau preempt — [BL-45](discovery-backlog.md).

### 23. GPU Offering & Pricing Management

- **Mục đích nghiệp vụ:** quản lý Offering GPU (cấu hình phần cứng, giá, trạng thái) do Provider niêm yết, kèm xác minh của Ecoma trước khi active.
- **Phạm vi trách nhiệm sơ bộ:** provider-set pricing với ba thành phần compute/storage/bandwidth; bảng giá versioned + snapshot tại thời điểm thuê; Ecoma verify Offer trước khi active theo tiền lệ [LLM-028](decisions/llm-marketplace-decisions.md) ([GPU-002](decisions/gpu-cloud-marketplace-decisions.md)).
- **Cấp sở hữu dự kiến:** Product — điều tiết [SD-034](decisions/strategic-decisions.md), [SD-044](decisions/provider-decisions.md). Căn cứ: [GPU-002](decisions/gpu-cloud-marketplace-decisions.md).
- **Điểm chưa rõ cần discovery tiếp:** tiêu chí verify Offer chi tiết — [BL-22](discovery-backlog.md).

### 24. GPU Usage Metering & Billing

- **Mục đích nghiệp vụ:** đo usage và quyết toán chi phí instance một cách độc lập với Provider.
- **Phạm vi trách nhiệm sơ bộ:** platform-side agent là căn cứ chốt tiền duy nhất; components compute-time, storage-time, bandwidth; chất lượng dữ liệu usage theo tiền lệ [LLM-012](decisions/llm-marketplace-decisions.md) ([GPU-004](decisions/gpu-cloud-marketplace-decisions.md)); balance chạm $0 → dừng tính, xóa instance/disk, không phát sinh nợ ([GPU-003](decisions/gpu-cloud-marketplace-decisions.md)); hạ tầng tài chính kế thừa nguyên trạng ([GPU-008](decisions/gpu-cloud-marketplace-decisions.md)).
- **Cấp sở hữu dự kiến:** Domain — hiện thực hạ tầng tài chính Ecoma Platform. Căn cứ: [GPU-003](decisions/gpu-cloud-marketplace-decisions.md), [GPU-004](decisions/gpu-cloud-marketplace-decisions.md), [GPU-008](decisions/gpu-cloud-marketplace-decisions.md).
- **Điểm chưa rõ cần discovery tiếp:** quan hệ GPU-003 (xóa tại $0) với [FIN-007](decisions/financial-decisions.md) — [BL-46](discovery-backlog.md).

### 25. GPU Reliability & Compensation

- **Mục đích nghiệp vụ:** đo độ tin cậy tài nguyên và bồi thường Consumer khi tài nguyên không khả dụng.
- **Phạm vi trách nhiệm sơ bộ:** dừng tính phí phần không khả dụng; credit bồi thường tự động, trừ vào Earning balance của Provider gây sự cố; độ tin cậy đo và công bố theo [SD-045](decisions/provider-decisions.md) ([GPU-006](decisions/gpu-cloud-marketplace-decisions.md)).
- **Cấp sở hữu dự kiến:** Domain. Căn cứ: [GPU-006](decisions/gpu-cloud-marketplace-decisions.md) (cam kết theo từng domain theo [SD-036](decisions/strategic-decisions.md)).
- **Điểm chưa rõ cần discovery tiếp:** tham số bồi thường (multiplier, danh mục sự cố, cap, cơ chế xác nhận) — [BL-47](discovery-backlog.md).

### 26. GPU Hardware Verification & Host Data Protection

- **Mục đích nghiệp vụ:** xác minh phần cứng máy Provider và bảo vệ dữ liệu Consumer nằm trên host.
- **Phạm vi trách nhiệm sơ bộ:** xác minh phần cứng tự động và liên tục, kết quả chỉ tác động Discovery & Display ([GPU-005](decisions/gpu-cloud-marketplace-decisions.md)); cấm Provider truy cập dữ liệu Consumer trên host + giám sát chủ động qua agent, xử lý vi phạm theo [SD-048](decisions/strategic-decisions.md), cam kết best-effort ([GPU-010](decisions/gpu-cloud-marketplace-decisions.md)).
- **Cấp sở hữu dự kiến:** Domain — vận hành theo khung trust Ecoma Platform ([SD-042](decisions/provider-decisions.md), [SD-048](decisions/strategic-decisions.md)). Căn cứ: [GPU-005](decisions/gpu-cloud-marketplace-decisions.md), [GPU-010](decisions/gpu-cloud-marketplace-decisions.md).
- **Điểm chưa rõ cần discovery tiếp:** điều kiện đình chỉ cụ thể theo danh mục vi phạm — [BL-22](discovery-backlog.md).

### 27. GPU Provider Governance Operations

- **Mục đích nghiệp vụ:** vận hành governance Provider trong Domain GPU: hồ sơ, payout, first-party.
- **Phạm vi trách nhiệm sơ bộ:** payout theo chu kỳ [FIN-002](decisions/financial-decisions.md), KYC giữ cấp Ecoma Platform theo [SD-042](decisions/provider-decisions.md), không ủy cho payout provider ([GPU-009](decisions/gpu-cloud-marketplace-decisions.md)); Ecoma góp máy first-party chịu đúng quy tắc Provider thường ([GPU-011](decisions/gpu-cloud-marketplace-decisions.md)); cấu trúc tiêu dùng theo mô hình dùng chung — Workspace, ví Organization, Membership theo [GPU-012](decisions/gpu-cloud-marketplace-decisions.md); truy cập instance qua SSH theo [SD-061](decisions/strategic-decisions.md).
- **Cấp sở hữu dự kiến:** Domain. Căn cứ: [GPU-009](decisions/gpu-cloud-marketplace-decisions.md), [GPU-011](decisions/gpu-cloud-marketplace-decisions.md), [GPU-012](decisions/gpu-cloud-marketplace-decisions.md).
- **Điểm chưa rõ cần discovery tiếp:** chính sách cạnh tranh công bằng giữa first-party và Provider thứ ba — [BL-39](discovery-backlog.md).

## Tài liệu liên quan

- [Strategic Domain Model](strategic-domain-model.md)
- [Domain Glossary](domain-glossary.md)
- [Discovery Backlog](discovery-backlog.md)
- [Discovery Charter](../00-governance/discovery-charter.md)
- [AI Factory Marketplace](../01-strategy/ai-factory-marketplace.md)
