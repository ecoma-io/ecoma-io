# Ecoma Domain Glossary

Bảng thuật ngữ này định nghĩa chuẩn các khái niệm nghiệp vụ đã xuất hiện trong Strategic Domain Model và các Decision Record của Ecoma, nhằm bảo đảm các thuật ngữ được dùng nhất quán xuyên suốt bộ tài liệu.

## Quy ước

- **Thuật ngữ tiếng Anh là chuẩn** (tiếng Anh là định danh khái niệm); phần diễn giải tiếng Việt chỉ nhằm giúp đọc hiểu, không phải tên gọi thay thế. Không dịch thuật ngữ trong các tài liệu kiến trúc.
- Định nghĩa bám theo các quyết định đã được chấp thuận trong [decision register](decisions/README.md); mã quyết định được ghi làm căn cứ khi phù hợp. Phương pháp phân biệt Fact, Assumption, Proposal và Decision theo [Discovery Charter](../00-governance/discovery-charter.md).
- Trường **Phạm vi sử dụng** chỉ được ghi khi có căn cứ từ quyết định (Ecoma Platform-level, Domain-level, hoặc cả hai); nếu chưa có căn cứ, ghi rõ "chưa có căn cứ". Trong trích dẫn quyết định trước SD-058, nhãn "Ecosystem-level" được đọc là **Ecoma Platform-level** và "Product-level" là **Domain-level** (Domain LLM / Domain GPU); tên "LLM Marketplace" và "GPU Cloud Marketplace" trong trích dẫn quyết định được đọc là Domain LLM và Domain GPU.
- Các khái niệm chưa được thống nhất (ví dụ giá trị thời hạn cụ thể của Invitation) **không được định nghĩa ở đây**; khi cần nhắc, ghi rõ "chưa được quyết định" và theo dõi tại [Discovery Backlog](discovery-backlog.md).
- Bối cảnh mô hình chi tiết tại [Strategic Domain Model](strategic-domain-model.md); văn bản quyết định tại thư mục `decisions/` ([strategic](decisions/strategic-decisions.md), [provider](decisions/provider-decisions.md), [account & identity](decisions/account-identity-decisions.md), [consumer organization](decisions/consumer-organization-decisions.md), [membership](decisions/membership-decisions.md), [invitation](decisions/invitation-decisions.md), [financial](decisions/financial-decisions.md), [llm marketplace](decisions/llm-marketplace-decisions.md)).

---

## 1. Ecoma Platform

**Định nghĩa:** Lớp năng lực dùng chung do Ecoma sở hữu trong sản phẩm AI Factory Marketplace: Account & Identity, Profile, Provider Identity & Trust, Financial Balance & Settlement, Workspace/API key; cùng các nguyên tắc và năng lực nền tảng bắt buộc thống nhất (SD-030, SD-040, đọc theo SD-059). Khái niệm "Ecosystem" trong các quyết định trước SD-058 được đọc lại theo khái niệm này.

**Phạm vi sử dụng:** Ecoma Platform-level.

**Phân biệt với:**

- _Domain_: Ecoma Platform là lớp năng lực dùng chung; Domain LLM và Domain GPU là hai mảng cung ứng ngang hàng tự chủ nghiệp vụ (SD-059).
- _Platform (năng lực dùng chung)_: Platform là nơi cung cấp năng lực dùng chung; việc chia sẻ kỹ thuật qua Platform không đồng nghĩa với hợp nhất quyền sở hữu nghiệp vụ của domain (SD-004).

## 2. Domain

**Định nghĩa:** Một mảng cung ứng tự chủ nghiệp vụ trong sản phẩm AI Factory Marketplace: sở hữu mô hình kinh doanh, Organization Model, chính sách và vòng đời riêng của mình (SD-002, SD-006, đọc theo SD-059). Domain được phép có Domain Model khác nhau kể cả khi dùng các khái niệm có tên gọi tương tự (SD-007). Sản phẩm hiện có hai domain cung ứng ngang hàng — Domain LLM và Domain GPU — với ranh giới cung ứng rời hoàn toàn (SD-059). Cả hai domain đều đóng vai trò trung gian Marketplace theo SD-054 (đọc lại theo SD-058). Các quyết định trước đây phát biểu theo cấp Product được đọc lại theo cấp domain (SD-059).

**Phạm vi sử dụng:** Ecoma Platform định nghĩa nguyên tắc chung (SD-039); mỗi domain tự chủ nghiệp vụ trong phạm vi nguyên tắc đó.

**Phân biệt với:**

- _Ecoma Platform_: Domain là mảng cung ứng đặc thù; không phải mọi quy tắc domain đều đúng cho Ecoma Platform.
- _Offering_: Domain là mảng nghiệp vụ cung ứng; Offering là đối tượng được cung ứng.

## 3. Platform (năng lực dùng chung)

**Định nghĩa:** Cơ chế cung ứng các năng lực thực sự dùng chung của sản phẩm; việc chia sẻ năng lực kỹ thuật qua Platform không đồng nghĩa với hợp nhất quyền sở hữu nghiệp vụ của domain (SD-004). Khái niệm này mô tả cơ chế chia sẻ, tách bạch với "Ecoma Platform" là chủ thể sở hữu lớp năng lực dùng chung (mục 1).

**Phạm vi sử dụng:** Ecoma Platform-level (năng lực dùng chung được cung cấp ở cấp Platform theo SD-004).

**Phân biệt với:**

- _Ecoma Platform_: Platform là cơ chế cung ứng năng lực chung; Ecoma Platform là chủ thể quản trị và sở hữu lớp năng lực đó.
- _Domain_: năng lực Platform không sở hữu business policy của domain (SD-004).

## 4. Account

**Định nghĩa:** Danh tính dùng chung của một người dùng trong Ecoma, được sử dụng làm danh tính xác thực xuyên suốt sản phẩm; việc xác thực không mặc nhiên cấp quyền truy cập vào cả hai domain (SD-012, ID-001). Một địa chỉ email chỉ liên kết với tối đa một Account tại cùng thời điểm (ID-006). Vòng đời Account độc lập với vòng đời Organization (ID-009). Account kết thúc bằng thao tác xóa chỉ khi đủ điều kiện tiên quyết: không còn Org sở hữu, đã chấm dứt Individual Provider Identity, đã xử lý xong số dư (ID-010), và không giữ vai trò Owner trong Organization Provider nào (ID-014). Account có thể bị suspension — tạm ngưng có tính đảo ngược: authentication và mọi authorization bị chấm dứt ngay, và hiệu ứng lan theo quyền sở hữu đến mọi chủ thể do Account làm Owner (ID-011).

**Phạm vi sử dụng:** Ecoma Platform-level (một Account duy nhất dùng xuyên suốt sản phẩm — ID-001, SD-012).

**Phân biệt với:**

- _Consumer Organization_: Account là danh tính xác thực; Consumer Organization là chủ thể sử dụng sản phẩm (Domain Boundary 1) và là chủ thể chịu các nghĩa vụ thương mại trong phạm vi sản phẩm (ORG-003).
- _Provider_: Account có thể sở hữu hoặc đại diện Provider, nhưng Account không phải là Provider (Domain Boundary 1, SD-019).
- _Membership_: Account tham gia Consumer Organization thông qua Membership; một Account có tối đa một Membership trong mỗi Organization (MEM-009).

## 5. Identity

**Định nghĩa:** Danh tính dùng trong xác thực của Ecoma. Với người dùng, Identity được hiện thực hóa qua Ecoma Account (ID-001). Với Provider, danh tính được đăng ký một lần với Ecoma và dùng xuyên suốt các domain Marketplace (Provider Identity — SD-018). Xác minh qua Email OTP chỉ chứng minh người dùng kiểm soát địa chỉ email, không chứng minh danh tính pháp lý hoặc danh tính con người (ID-005). Application, Agent và workload máy không phải chủ thể nghiệp vụ độc lập: chúng hành động thay mặt một chủ thể hiện có (Account, Consumer Organization, Provider) qua ủy quyền OAuth2 với scope giới hạn hoặc API key scoped, và trách nhiệm cùng quyền truy vết quy về chủ thể ủy quyền, không quy về credential (ID-013).

**Phạm vi sử dụng:** Ecoma Platform-level (Account dùng chung xuyên suốt sản phẩm; Provider Identity đăng ký một lần — SD-018).

**Phân biệt với:**

- _Authentication_: Identity là đối tượng được xác thực; Authentication là hành vi xác thực.
- _Authorization_: có Identity được xác thực không đồng nghĩa có quyền (Domain Boundary 8).
- _Provider Qualification_: danh tính được duy trì xuyên suốt; tư cách và chính sách có thể thay đổi (Domain Boundary 4).

## 6. Authentication

**Định nghĩa:** Hành vi xác minh danh tính Account. Ecoma sử dụng passwordless, không lưu trữ mật khẩu (ID-004); tích hợp ưu tiên các chuẩn OIDC, OAuth2, JWKS, MFA (ID-002). Xác thực xuyên suốt sản phẩm dựa trên một Account dùng chung (SD-012, ID-001).

**Phạm vi sử dụng:** Ecoma Platform-level (xác thực chung qua Account dùng chung; quyền truy cập sau đó do từng domain quyết định — ID-001).

**Phân biệt với:**

- _Authorization_: xác thực thành công không mặc nhiên cấp quyền sử dụng sản phẩm hoặc quản lý Provider (Domain Boundary 8).
- _Email OTP verification_: chỉ chứng minh kiểm soát email tại thời điểm xác minh, không chứng minh danh tính pháp lý (ID-005).

## 7. Authorization

**Định nghĩa:** Việc xác định và thực thi quyền truy cập và quyền hạn. Quyền truy cập vào domain và quyền hạn trong domain do từng domain quyết định (ID-001); tập Role được định nghĩa dùng chung cấp Ecoma Platform, Permission và chính sách phân quyền của Member do từng domain định nghĩa (MEM-005, MEM-010, SD-063); quyền quản lý được ủy quyền chỉ có hiệu lực trong phạm vi được cấp (MEM-006, MEM-007).

**Phạm vi sử dụng:** Domain-level (Authorization thuộc phạm vi từng domain — tập Role dùng chung cấp Ecoma Platform, Permission theo từng domain — SD-063, MEM-010); riêng quyền truy cập vào domain nói chung do domain quyết định (ID-001).

**Phân biệt với:**

- _Authentication_: hai khái niệm độc lập; xác thực không cấp quyền (Domain Boundary 8).
- _Delegated management_: ủy quyền thực hiện quyền không làm mất quyền kiểm soát tối cao của Owner (MEM-002), và thu hồi quyền quản lý không tự động thu hồi quyền đã cấp trước đó (MEM-008).

## 8. Consumer

**Định nghĩa:** Bên mua/sử dụng dịch vụ trong quan hệ thương mại của Ecoma. Ecoma luôn là chủ thể có quan hệ thương mại trực tiếp với Consumer, kể cả khi Offering thuộc sở hữu của Provider (SD-035). Consumer thanh toán thông qua Ecoma (SD-015).

**Phạm vi sử dụng:** cả hai — quan hệ thương mại được thiết lập bởi từng domain (SD-029, SD-036) nhưng vai trò thương mại trực tiếp của Ecoma với Consumer là quy tắc Ecoma Platform (SD-035).

**Phân biệt với:**

- _Consumer Organization_: Consumer là vai trò trong quan hệ thương mại; Consumer Organization là chủ thể sở hữu tài nguyên và chịu các nghĩa vụ thương mại trong phạm vi sản phẩm (ORG-003).
- _Provider_: Provider cung ứng, Consumer nhận và sử dụng — hai vai trò ngược chiều nhau trong quan hệ thương mại.

## 9. Consumer Organization

**Định nghĩa:** Chủ thể trong phạm vi một domain, sở hữu tài nguyên và chịu các nghĩa vụ thương mại trong phạm vi domain đó (ORG-003). Mỗi domain tự sở hữu mô hình, chính sách và vòng đời Consumer Organization; Consumer Organization ở các domain khác nhau không mặc nhiên là cùng một entity (ORG-001). Personal Organization và Business Organization có thể dùng chung mô hình sở hữu nhưng có chính sách thành viên khác nhau (ORG-002). Số dư tài chính và phương thức thanh toán thuộc Organization (ORG-004).

**Phạm vi sử dụng:** Domain-level (ORG-001).

**Phân biệt với:**

- _Account_: danh tính xác thực ≠ chủ thể sử dụng sản phẩm (Domain Boundary 1).
- _Organization Provider_: hai khái niệm có mục đích, trách nhiệm và vòng đời riêng; không áp dụng máy móc mô hình Owner/Member của Consumer Organization sang Provider (Domain Boundary 2, SD-017).
- _Provider_: Consumer Organization tiêu dùng; Provider cung ứng (Domain Boundary 1).

## 10. Organization Provider

**Định nghĩa:** Provider dưới tư cách tổ chức — một dạng tư cách (qualification) của Provider, hình thành qua chuyển đổi từ Individual Provider (danh tính Provider được giữ nguyên khi chuyển đổi tư cách — SD-021, SD-024) hoặc bằng tạo trực tiếp: một Account đã có Provider Identity tạo Organization Provider và Account tạo trở thành Owner đầu tiên (SD-050). Một Account có thể đại diện hoặc quản lý nhiều Organization Provider độc lập (SD-019). Organization Provider có đúng một Owner và có thể có nhiều Member, mỗi Membership đi kèm danh sách quyền (SD-043); quyền sở hữu được chuyển giao cho Member đang hoạt động (Owner cũ trở thành Member thường), Member rời tự nguyện không cần phê duyệt, việc loại Member thực hiện trong phạm vi quyền được cấp, và Member được mời lại ngay với Membership mới độc lập (SD-050).

**Phạm vi sử dụng:** Ecoma Platform-level (danh tính Provider đăng ký một lần dùng xuyên các domain Marketplace — SD-018); chính sách chi tiết theo từng domain.

**Phân biệt với:**

- _Consumer Organization_: mục đích, trách nhiệm và vòng đời khác nhau; mô hình Owner/Member không áp dụng máy móc (Domain Boundary 2).
- _Provider Identity_: Organization Provider là tư cách tại một thời điểm; Provider Identity là danh tính bền vững xuyên qua các chuyển đổi tư cách (Domain Boundary 4).
- _Individual Provider_: tư cách cá nhân, hai chiều chuyển đổi được (SD-024).

## 11. Provider

**Định nghĩa:** Cá nhân hoặc tổ chức thực sự tham gia cung ứng dịch vụ hoặc tài nguyên, gắn với Offering, trách nhiệm cung ứng và quyền lợi, nghĩa vụ thương mại; không chỉ là tài khoản hoặc gian hàng (SD-020). Provider chịu trách nhiệm đối với phần cung ứng thuộc phạm vi của mình; Ecoma chịu trách nhiệm đối với những cam kết do Ecoma đưa ra (SD-014). Provider có thể tham gia với quyền hạn ban đầu giới hạn và được mở rộng theo mức độ xác minh, năng lực và độ tin cậy (SD-016).

**Phạm vi sử dụng:** Ecoma Platform-level (Provider đăng ký danh tính một lần, cung ứng trên cả hai domain Marketplace — SD-018); chính sách và phạm vi cam kết theo từng domain (SD-029, SD-036).

**Phân biệt với:**

- _Account_: Provider là chủ thể cung ứng; Account là danh tính xác thực có thể sở hữu/đại diện Provider (Domain Boundary 1, SD-019).
- _Consumer Organization_: hai khái niệm độc lập về mục đích, chính sách, quyền hạn, vòng đời (SD-017, Domain Boundary 1, Domain Boundary 2).
- _Provider Actor_: Provider chịu trách nhiệm cung ứng; Actor chỉ thực hiện thao tác (Domain Boundary 3).

## 12. Provider Identity

**Định nghĩa:** Danh tính của Provider được đăng ký với Ecoma một lần và duy trì xuyên suốt, cho phép Provider tham gia cung ứng trên cả hai domain mà không phải đăng ký lại (SD-018). Khi Provider chuyển đổi tư cách (Individual ↔ Organization), Provider Identity được giữ nguyên thay vì tạo Provider mới (SD-021). Provider có thể bị đình chỉ lan truyền theo phân loại vi phạm: vi phạm cấp Ecoma Platform đình chỉ Provider trên toàn bộ Marketplace, vi phạm đặc thù dịch vụ chỉ đình chỉ trong phạm vi domain áp dụng (SD-048).

**Phạm vi sử dụng:** Ecoma Platform-level (SD-018).

**Phân biệt với:**

- _Provider Actor_: người hoặc Agent thực hiện thao tác vận hành, không đồng nhất với chủ thể chịu trách nhiệm cung ứng (Domain Boundary 3).
- _Provider Qualification_: danh tính bất biến xuyên suốt; tư cách cá nhân/tổ chức và chính sách có thể thay đổi (Domain Boundary 4).
- _Offering_: Offering là đối tượng cung ứng ở cấp vận hành; thay đổi tư cách Provider không làm gián đoạn Offering (Domain Boundary 7).

## 13. Provider Actor

**Định nghĩa:** Người hoặc Agent thực hiện các thao tác tham gia vận hành của một Provider — ví dụ Account của người sáng lập tiếp tục là người quản lý mặc định sau chuyển đổi và có thể ủy quyền quản lý cho người khác (SD-022). Actor tham gia vận hành nhưng không đồng nhất với chủ thể chịu trách nhiệm cung ứng dịch vụ (Domain Boundary 3).

**Phạm vi sử dụng:** cả hai — quyền quản lý và ủy quyền theo mô hình của từng domain; ranh giới giữa quyền quản lý và trách nhiệm là quy tắc chung cấp Ecoma Platform (Domain Boundary 3, SD-022).

**Phân biệt với:**

- _Provider / Provider Identity_: Provider chịu trách nhiệm phần cung ứng; Actor chỉ thực hiện thao tác (Domain Boundary 3). Quyền quản lý không đồng nghĩa với trách nhiệm pháp lý hoặc thương mại (SD-022).
- _Provider Qualification_: tư cách của chủ thể Provider, không phải vai trò của người thao tác.

## 14. Provider Qualification

**Định nghĩa:** Tư cách của Provider là cá nhân (Individual Provider) hay tổ chức (Organization Provider) cùng các chính sách tương ứng. Tư cách này có thể thay đổi qua quá trình Provider Transformation (hai chiều — SD-024) trong khi Provider Identity được duy trì xuyên suốt (Domain Boundary 4, SD-021). Trạng thái Provider tại thời điểm phát sinh quyết định chính sách áp dụng cho số dư và quyền lợi tài chính (SD-027).

**Phạm vi sử dụng:** cả hai — khái niệm chung cấp Ecoma Platform (SD-021, SD-024); số dư và nghĩa vụ được xử lý theo trạng thái Provider và chính sách có hiệu lực tại thời điểm phát sinh (SD-023, SD-027).

**Phân biệt với:**

- _Provider Identity_: danh tính được duy trì xuyên suốt; tư cách có thể thay đổi (Domain Boundary 4).
- _Provider Actor_: tư cách của chủ thể cung ứng, không phải vai trò người thao tác.
- _Mức độ xác minh/tin cậy theo SD-016_: progressive trust được hiện thực hóa qua hai giai đoạn Activated/Verified (SD-042); mapping nhóm đối tượng KYC (cá nhân/hộ kinh doanh/doanh nghiệp) sang Individual/Organization Provider đã được xác lập và "Verified" giữ nghĩa tương đồng trên cả hai domain, với tiêu chí chi tiết là mặc định Ecoma Platform mà domain được mở rộng hoặc phủ (SD-047); đường xử lý xác minh thất bại đã chốt: giữ nguyên mức trust hiện tại (SD-016, SD-042), gian lận danh tính là vi phạm cấp Ecoma Platform → đình chỉ (SD-048); quy trình chi tiết thuộc lớp design.

## 15. Offering

**Định nghĩa:** Đối tượng được cung ứng cho Consumer. Ecoma hỗ trợ cả Provider-owned Offering và Product-owned Offering; chủ thể sở hữu Offering phụ thuộc vào mô hình kinh doanh của từng domain (SD-034). Provider có thể cung cấp tài nguyên đầu vào hoặc dịch vụ thành phần tùy theo domain và Offering (SD-033). Chuyển đổi trạng thái Provider không yêu cầu tạo lại, chuyển giao hoặc xác minh lại Offering hiện hữu (SD-028). Offering do Provider sở hữu có vòng đời (tạo, chỉnh sửa, tạm dừng, xóa) do chính Provider kiểm soát, bất biến qua Provider Transformation (SD-044); vòng đời Product-owned Offering thuộc chính sách cấp 3 của domain theo [SD-046](decisions/strategic-decisions.md). Theo [SD-058](decisions/strategic-decisions.md) (giữ phần vai trò của [SD-054](decisions/strategic-decisions.md)), cả hai domain đều đóng vai trò trung gian Marketplace và dùng Provider-owned Offering; Product-owned Offering chưa phát sinh trong sản phẩm. Trong Domain LLM, Offering gồm model, capability, giá và trạng thái, tham chiếu tập endpoint và credential riêng; vòng đời `draft` → `active` → `inactive` → `retired` do Provider kiểm soát; Product này không có Product-owned Offering (LLM-002, LLM-004, LLM-005).

**Phạm vi sử dụng:** cả hai — khái niệm chung cấp Ecoma Platform; ownership cụ thể do từng domain quyết định (SD-034).

**Phân biệt với:**

- _Provider Identity_: Offering là đối tượng ở cấp vận hành; Provider Identity là chủ thể (Domain Boundary 7).
- _Service Supply_: Offering là đối tượng được cung ứng; Service Supply là hoạt động cung ứng.
- _Domain_: domain có thể sở hữu Offering (Product-owned) nhưng domain không phải là Offering.

## 16. Service Supply

**Định nghĩa:** Hoạt động cung ứng dịch vụ hoặc tài nguyên của Provider trong sản phẩm. Provider là chủ thể cung ứng, chịu trách nhiệm đối với phần cung ứng thuộc phạm vi của mình (SD-014, SD-020). Mô hình cung ứng linh hoạt: tài nguyên đầu vào hoặc dịch vụ thành phần, tùy domain và Offering (SD-033). Quá trình chuyển đổi tư cách Provider không làm gián đoạn hoạt động cung cấp dịch vụ hiện hữu (SD-025).

**Phạm vi sử dụng:** cả hai — nguyên tắc trách nhiệm cung ứng cấp Ecoma Platform (SD-014); phạm vi và hình thức cung ứng theo từng domain (SD-029, SD-033).

**Phân biệt với:**

- _Offering_: hoạt động cung ứng ≠ đối tượng được cung ứng.
- _Provider Operations Migration_: chuyển đổi tư cách Provider không đồng nghĩa chuyển đổi hoặc tạo lại các hoạt động cung cấp dịch vụ (Domain Boundary 5).

## 17. Membership

**Định nghĩa:** Quan hệ của một Account với một Consumer Organization. Một Account có tối đa một Membership trong cùng một Consumer Organization; Membership có thể chứa nhiều Role hoặc Permission (MEM-009). Membership và Authorization thuộc phạm vi từng domain (MEM-010). Membership hình thành qua chấp nhận Invitation hoặc các quy trình onboarding khác do domain định nghĩa (MEM-015). Khi Membership kết thúc, toàn bộ quyền truy cập phát sinh trực tiếp hoặc gián tiếp từ Membership phải bị thu hồi (MEM-013); kết thúc Membership không tự động xóa tài nguyên do Member tạo (MEM-014). Account tạo Consumer Organization trở thành Owner đầu tiên, và sau chuyển giao quyền sở hữu Owner cũ trở thành Member thường (MEM-016). Quyền được cấp thông qua ủy quyền là tài sản của Organization, không phải của người cấp: người cấp quyền rời Organization không làm cascade-thu hồi các quyền đã cấp (MEM-008, MEM-017).

**Phạm vi sử dụng:** Domain-level (MEM-010, ORG-001). **Lưu ý:** khái niệm Membership được định nghĩa cho Consumer Organization; không áp dụng mặc định cho Organization Provider (Domain Boundary 2). Organization Provider có mô hình riêng: đúng một Owner và nhiều Member kèm danh sách quyền, với các quy tắc tạo trực tiếp, Owner đầu tiên, chuyển giao và rời/bị loại/mời lại đã được quyết định (SD-043, SD-050).

**Phân biệt với:**

- _Account_: Account là danh tính; Membership là quan hệ tham gia của Account vào một Organization.
- _Invitation_: Invitation là cơ chế hình thành Membership (MEM-015, INV-002).
- _Owner/Member_: Owner và Member là các vai trò trong một Membership; Owner có quyền kiểm soát tối cao (MEM-001, MEM-002).

## 18. Owner

**Định nghĩa:** Vai trò duy nhất giữ quyền kiểm soát tối cao đối với một Consumer Organization đang hoạt động, bao gồm thành viên, quyền sở hữu, thanh toán, tài chính, cấu hình, tài nguyên và hoạt động; Owner có thể ủy quyền thực hiện một số quyền nhưng không mất quyền kiểm soát tối cao (MEM-001, MEM-002). Owner có thể chuyển quyền sở hữu cho một Member đủ điều kiện (MEM-003) và không thể tự rời hoặc bị loại khi chưa chuyển quyền sở hữu (MEM-004). Owner có thể yêu cầu chấm dứt Consumer Organization bất cứ lúc nào (ORG-011).

**Phạm vi sử dụng:** Domain-level — thuộc mô hình Consumer Organization do từng domain sở hữu (ORG-001, MEM-005).

**Phân biệt với:**

- _Member_: mỗi Organization có đúng một Owner; Member không có quyền kiểm soát tối cao (MEM-001, MEM-002).
- _Delegated manager_: người được Owner ủy quyền thực hiện một số quyền; ủy quyền không chuyển quyền kiểm soát tối cao (MEM-002) và không bắt buộc là Owner (quyền quản lý thanh toán/tài chính có thể ủy quyền cho người khác — ORG-005).
- _Provider_: mô hình Owner/Member của Consumer Organization không áp dụng máy móc sang Provider (Domain Boundary 2); Organization Provider có mô hình riêng đúng một Owner + Member kèm quyền (SD-043); "người quản lý mặc định" sau Provider Transformation là Provider Actor, không phải Owner của Consumer Organization (SD-022).

## 19. Member

**Định nghĩa:** Vai trò của một Account tham gia một Consumer Organization thông qua Membership, với quyền hạn do domain định nghĩa (MEM-005, SD-063). Member được cấp quyền quản lý có thể quyết định quyền của Member khác trong phạm vi được cấp, không vượt quá phạm vi quản lý của mình (MEM-006, MEM-007). Member có thể tự rời Organization mà không cần Owner phê duyệt (MEM-011); Member đã rời hoặc bị loại có thể được mời lại ngay với Membership mới có vòng đời độc lập (MEM-012).

**Phạm vi sử dụng:** Domain-level (MEM-005, MEM-010, ORG-001).

**Phân biệt với:**

- _Owner_: đúng một Owner per Organization; Member nhiều người và không có quyền tối cao (MEM-001, MEM-002).
- _Delegated manager_: Member được cấp quyền quản lý thành viên/tài chính — quyền trong phạm vi được cấp, có thể bị thu hồi mà không tự động thu hồi quyền đã cấp trước đó (MEM-006, MEM-008, ORG-005).
- _Người nhận Pending Invitation_: một email không thể đồng thời là Member và người nhận Pending Invitation trong cùng Organization (INV-010).

## 20. Invitation

**Định nghĩa:** Lời mời tham gia một Consumer Organization, gắn cố định với email đích tại thời điểm tạo và không thể chuyển sang email khác hoặc thay đổi người nhận (INV-004, ID-008). Người nhận phải chấp nhận tường minh trước khi trở thành Member (INV-002) và phải chứng minh quyền kiểm soát chính xác email đích tại thời điểm chấp nhận (INV-015). Có các trạng thái Pending, Accepted, Rejected, Expired, Revoked; trạng thái kết thúc không thể quay lại Pending (INV-006). Ecoma định nghĩa thời hạn hết hạn chung cho Invitation; giá trị cụ thể chưa được quyết định (INV-005); TTL là mặc định Ecoma Platform, domain được phủ theo SD-046. Khi Account đổi email và email cũ được giải phóng, các Pending Invitation gửi tới email cũ giữ nguyên trạng thái và vẫn được chấp nhận bởi chủ thể kiểm soát email đó tại thời điểm chấp nhận (ID-012).

**Phạm vi sử dụng:** Domain-level — Invitation thuộc mô hình Consumer Organization do domain sở hữu (ORG-001); riêng thời hạn hết hạn được định nghĩa chung cấp Ecoma Platform (INV-005).

**Phân biệt với:**

- _Membership_: Invitation mời; chấp nhận Invitation (hoặc onboarding khác) tạo Membership (INV-002, MEM-015).
- _Account_: Invitation gửi đến email, có thể là email chưa có Account (INV-003); việc Account đổi email không đổi email nhận Invitation (ID-008).

## 21. Commercial Relationship

**Định nghĩa:** Quan hệ thương mại giữa các chủ thể trong sản phẩm. Ecoma luôn là chủ thể có quan hệ thương mại trực tiếp với Consumer (SD-035); Consumer thanh toán thông qua Ecoma và Ecoma quản lý dòng tiền, nghĩa vụ tài chính và việc thanh toán cho Provider (SD-015); dòng tiền cụ thể: Ecoma thu từ Consumer, trừ hoa hồng và thuế phí, thanh toán cho Provider (FIN-005); Provider chịu trách nhiệm đối với phần cung ứng của mình, Ecoma chịu trách nhiệm đối với những cam kết do Ecoma đưa ra (SD-014). Phạm vi cam kết và chính sách thương mại do từng domain quyết định (SD-036, ORG-006).

**Phạm vi sử dụng:** cả hai — vai trò thương mại trực tiếp Ecoma–Consumer là quy tắc Ecoma Platform (SD-035, SD-015); phạm vi cam kết và chính sách do domain quyết định (SD-036, SD-029, ORG-006).

**Phân biệt với:**

- _Membership_: quan hệ thương mại ≠ quan hệ thành viên trong Organization.
- _Quan hệ cung ứng Provider–Ecoma_: Provider chịu trách nhiệm phần cung ứng; đây là một phần của Commercial Relationship tổng thể, không đồng nhất với quan hệ Ecoma–Consumer (SD-014).

## 22. Marketplace

**Định nghĩa:** Vai trò trung gian thương mại mà Ecoma đảm nhận trên từng domain, nơi Offering được cung ứng cho Consumer. Ecoma đóng vai trò trung gian Marketplace trên từng domain (SD-029, đọc theo SD-058). Provider đăng ký danh tính một lần và có thể tham gia cung ứng trên cả hai domain (SD-018). Theo [SD-054](decisions/strategic-decisions.md) (đọc lại theo [SD-058](decisions/strategic-decisions.md)), cả Domain LLM và Domain GPU đều đóng vai trò trung gian Marketplace.

**Phạm vi sử dụng:** cả hai — vai trò Marketplace được xác định theo từng domain (SD-029); khả năng tham gia cung ứng trên cả hai domain là quy tắc Ecoma Platform (SD-018).

**Phân biệt với:**

- _Domain_: Marketplace là vai trò của một domain (hoặc của Ecoma trong domain), không phải mọi domain đều là Marketplace (SD-029).
- _Provider_: Provider tham gia cung ứng qua Marketplace; Marketplace không phải là Provider (SD-014).
- _Merchant of Record_: tư cách pháp lý Merchant of Record của Ecoma chưa được xác định (SD-015); không đồng nhất vai trò Marketplace với tư cách pháp lý này.

## 23. Provider Transformation

**Định nghĩa:** Quá trình chuyển đổi tư cách Provider giữa Individual Provider và Organization Provider, hỗ trợ hai chiều (SD-024). Danh tính Provider được giữ nguyên trong quá trình chuyển đổi (SD-021). Chuyển đổi chỉ có hiệu lực sau khi được xác minh và phê duyệt; trong thời gian chờ, Provider tiếp tục hoạt động theo trạng thái và chính sách hiện hành (SD-026). Sau chuyển đổi: hoạt động cung cấp dịch vụ không bị gián đoạn (SD-025); Account của người sáng lập tiếp tục là người quản lý mặc định (SD-022); lịch sử và nghĩa vụ đã phát sinh được bảo toàn (SD-023); Offering hiện hữu không phải tạo lại hoặc xác minh lại (SD-028).

**Phạm vi sử dụng:** cả hai — khái niệm và nguyên tắc bảo toàn cấp Ecoma Platform (SD-021, SD-023–SD-028); quy trình xác minh, phê duyệt cụ thể theo domain/cơ chế chưa được chi tiết hóa (SD-026).

**Phân biệt với:**

- _Provider Operations Migration_: chuyển đổi tư cách ≠ chuyển đổi hoặc tạo lại hoạt động cung cấp dịch vụ (Domain Boundary 5).
- _Ownership transfer của Consumer Organization (MEM-003)_: hai cơ chế khác nhau ở hai mô hình khác nhau; không áp dụng chéo (Domain Boundary 2).

## 24. Historical Obligation

**Định nghĩa:** Nghĩa vụ (tài chính, hợp đồng, pháp lý) đã phát sinh trước một thời điểm, được bảo toàn và xử lý theo trạng thái và chính sách có hiệu lực tại thời điểm phát sinh (SD-023). Với số dư và quyền lợi tài chính: mỗi khoản được phân loại theo trạng thái Provider tại thời điểm phát sinh và tiếp tục tuân theo chính sách tương ứng sau chuyển đổi (SD-027). Nghĩa vụ đã phát sinh trước termination của Consumer Organization cũng không bị xóa (ORG-014).

**Phạm vi sử dụng:** cả hai — nguyên tắc bảo toàn áp dụng cho Provider qua Transformation (SD-023, SD-027) và cho Consumer Organization qua termination (ORG-014); chính sách xử lý chi tiết theo domain.

**Phân biệt với:**

- _Current Provider Policy_: nghĩa vụ đã phát sinh không bị thay đổi chỉ vì Provider chuyển sang tư cách mới (Domain Boundary 6).
- _Outstanding obligations của Consumer Organization sau termination (ORG-014)_: cùng nguyên tắc bảo toàn, khác chủ thể áp dụng.

## 25. Usage Balance

**Định nghĩa:** Số dư tiêu dùng phía Consumer: Consumer nạp tiền trước để sử dụng dịch vụ; số dư này không hoàn trả (FIN-001). Nhận từ chuyển đổi Earning balance kèm phí và không chịu thuế (FIN-002). Account closure yêu cầu đã xử lý xong số dư trước khi xóa Org/Provider Identity (ID-010, FIN-003). Trong LLM Marketplace, Usage balance được hiện thực qua wallet trên double-entry ledger: số dư suy ra từ lịch sử ledger thay vì lưu thành con số độc lập (LLM-019).

**Phạm vi sử dụng:** Ecoma Platform-level — hạ tầng tài chính dùng chung mặc định, domain có thể thay thế bằng hạ tầng riêng (FIN-004).

**Phân biệt với:**

- _Earning Balance_: usage balance thuộc phía Consumer để tiêu dùng; earning balance thuộc phía Provider tích lũy từ cung ứng.
- _Refund/Chargeback_: usage balance không hoàn trả về rail thanh toán theo FIN-001; khi chargeback xảy ra trên rail thanh toán, balance trở thành âm tạm và Organization bị chặn khởi phát tiêu dùng mới cho tới khi nạp bù về mức không âm, trong khi công việc đã bảo đảm nguồn trước đó vẫn hoàn tất (FIN-009).

## 26. Earning Balance

**Định nghĩa:** Số dư thu nhập phía Provider, tích lũy theo thời gian thực từ hoạt động cung ứng (FIN-001). Cuối tháng Ecoma chốt kỳ settlement: số khả dụng = tổng thu − thuế − phí; sau 20 ngày kể từ thời điểm chốt, số khả dụng trở thành rút được (FIN-002). Việc rút tiền theo yêu cầu chủ động của user — Owner hoặc người được ủy quyền — và yêu cầu Provider đạt Verified (FIN-002, SD-042). Earning balance chưa rút bị mất khi Provider bị terminate (FIN-003). Khi Provider bị đình chỉ cấp Ecoma Platform, khả năng rút Earning balance bị đóng băng bắt buộc; số dư đã tích lũy vẫn thuộc quyền sở hữu của Provider và được giải tỏa khi Provider hồi phục hoặc theo kết luận xử lý (FIN-008).

**Phạm vi sử dụng:** Ecoma Platform-level — hạ tầng tài chính dùng chung mặc định, domain có thể thay thế (FIN-004).

**Phân biệt với:**

- _Usage Balance_: earning balance nhận vào từ cung ứng; usage balance chi ra để tiêu dùng.
- _Settlement_: earning balance là số dư; settlement là quy trình đối soát và thanh toán số dư đó.

## 27. Activated

**Định nghĩa:** Giai đoạn trust thứ nhất của Provider: nộp đủ giấy tờ theo nhóm đối tượng (cá nhân: giấy tờ tùy thân; hộ kinh doanh: giấy chứng nhận đăng ký hộ kinh doanh và giấy tờ chủ hộ; doanh nghiệp: giấy chứng nhận đăng ký doanh nghiệp và giấy tờ người đại diện pháp luật) và được cung ứng dịch vụ ngay (SD-042). Quy trình trust áp dụng cấp Ecoma Platform, dùng chung cho mọi domain, không xác minh lại theo domain (SD-042, SD-018).

**Phạm vi sử dụng:** Ecoma Platform-level (SD-042).

**Phân biệt với:**

- _Verified_: giai đoạn thứ hai, điều kiện rút Earning balance; Activated chưa đủ để rút tiền.
- _KYC nhóm đối tượng_: Activated gắn với nhóm giấy tờ đã nộp; ánh xạ nhóm đối tượng (cá nhân/hộ kinh doanh/doanh nghiệp) sang Individual/Organization Provider đã được xác lập (SD-047).

## 28. Verified

**Định nghĩa:** Giai đoạn trust thứ hai của Provider — điều kiện để rút tiền từ Earning balance (SD-042, FIN-002). Mapping nhóm đối tượng KYC sang Individual/Organization Provider đã được xác lập và "Verified" giữ nghĩa tương đồng trên cả hai domain; tiêu chí đánh giá chi tiết là mặc định Ecoma Platform mà domain được mở rộng hoặc phủ theo cơ chế SD-046 (SD-047). Đường xử lý xác minh thất bại hoặc Provider từ chối bổ sung đã được chốt: Provider giữ nguyên mức trust hiện tại với quyền hạn tương ứng theo progressive trust (SD-016, SD-042); chưa Verified thì không rút được Earning balance (FIN-002); phát hiện gian lận danh tính là vi phạm cấp Ecoma Platform, đình chỉ theo SD-048. Nội dung tiêu chí mặc định do Ecoma Platform sở hữu và bảo trì qua Decision Process (SD-040/SD-046); quy trình xác minh chi tiết thuộc lớp design. Ecoma có thể yêu cầu xác minh bổ sung (chụp ảnh hoặc quay video đang cầm giấy tờ) khi phát hiện trùng lặp thông tin, và yêu cầu xác minh thêm khi có dấu hiệu abuse kể cả khi đã Verified (SD-042).

**Phạm vi sử dụng:** Ecoma Platform-level (SD-042).

**Phân biệt với:**

- _Activated_: Verified là mức cao hơn nhưng không thay thế Activated; cả hai thuộc cùng quy trình trust cấp Ecoma Platform.
- _Provider Qualification_: Verified là mức trust trong tiến trình xác minh; Qualification là tư cách Individual/Organization.

## 29. Settlement

**Định nghĩa:** Quy trình đối soát và thanh toán giữa Ecoma và Provider: cuối tháng Ecoma chốt kỳ, số khả dụng = tổng thu − thuế − phí; sau 20 ngày số khả dụng rút được; rút theo yêu cầu chủ động của user với quyền của Owner hoặc người được ủy quyền; chuyển đổi Earning → Usage kèm phí và không chịu thuế (FIN-002). Dòng tiền tổng thể: Ecoma thu từ Consumer, trừ hoa hồng và thuế phí, thanh toán cho Provider (FIN-005).

**Phạm vi sử dụng:** Ecoma Platform-level — hạ tầng tài chính dùng chung mặc định, domain có thể thay thế (FIN-004).

**Phân biệt với:**

- _Usage Balance / Earning Balance_: settlement là quy trình xử lý số dư, không phải bản thân số dư.
- _Merchant of Record_: tư cách pháp lý của Ecoma khi nắm dòng tiền chưa được xác định (SD-015); settlement là quy trình nghiệp vụ, không đương nhiên xác lập tư cách pháp lý.

## 30. Subscription

**Định nghĩa:** Quan hệ đăng ký sử dụng dịch vụ giữa Consumer Organization và một domain. Một Consumer Organization có thể có nhiều Subscription độc lập trong cùng một domain (ORG-006); Ecoma Platform không khóa mô hình thương mại của domain vào PAYG, Freemium hoặc Subscription (ORG-007). Trong mô hình Usage balance dùng chung mặc định, mọi Subscription của Organization rút từ pool chung (FIN-006).

**Phạm vi sử dụng:** Domain-level (ORG-006, ORG-007); cơ chế pool dùng chung là mặc định Ecoma Platform theo FIN-006.

**Phân biệt với:**

- _Consumer Organization_: Organization là chủ thể sở hữu Subscription và chịu nghĩa vụ; Subscription là quan hệ sử dụng cụ thể trong một domain.
- _Usage Balance_: Subscription rút tiêu dùng từ Usage balance theo pool mặc định (FIN-006); hai mức khái niệm khác nhau.
- _PAYG/Freemium_: các mô hình thương mại mà domain được chọn (ORG-007); Subscription là một trong các lựa chọn đó, không phải mô hình bắt buộc.

## 31. Reservation

**Định nghĩa:** Việc bảo đảm nguồn cho một đơn vị tiêu dùng: giữ chỗ trên Usage pool, không trừ tiền; trừ Usage và cộng Earning thực hiện theo tiêu thụ thực tế (FIN-007). Khi Usage không đủ, mặc định Ecoma Platform từ chối khởi phát đơn vị tiêu dùng mới nhưng hoàn tất các công việc đã bảo đảm nguồn (FIN-007). Khi chargeback xảy ra, công việc đã bảo đảm nguồn trước thời điểm chargeback vẫn được hoàn tất (FIN-009); khi dịch vụ không cung cấp được, reservation được giải phóng về Usage balance (FIN-009). Reservation tồn tại trong phạm vi pool của Organization theo FIN-006. Trong LLM Marketplace, Reservation là một cơ chế duy nhất theo ước lượng giá của request, kiểm tra đồng thời Usage balance và limit cấp Workspace/API key (LLM-031).

**Phạm vi sử dụng:** Ecoma Platform-level — hành vi mặc định dùng chung theo FIN-007; domain được phủ kèm khai báo theo SD-046.

**Phân biệt với:**

- _Usage Balance_: reservation là giữ chỗ trên pool, không phải trừ tiền; Usage chỉ bị trừ theo tiêu thụ thực tế (FIN-007).
- _Chargeback_: chargeback làm balance âm tạm và chặn tiêu dùng mới (FIN-009), nhưng không thu hồi reservation đã bảo đảm trước đó.

## 32. Composite Offering

**Định nghĩa:** Offering tổng hợp nhiều nguồn cung (có thể của nhiều Provider) thành một dịch vụ duy nhất cung cấp cho Consumer. Mỗi Provider chịu trách nhiệm đối với phần cung ứng của mình kể cả khi gộp vào Offering tổng hợp; việc gộp không chuyển trách nhiệm cung ứng sang bên thực hiện gộp ([SD-053](decisions/provider-decisions.md)). Ecoma chịu trách nhiệm đối với những cam kết do Ecoma tự đưa ra ([SD-014](decisions/provider-decisions.md), [SD-036](decisions/strategic-decisions.md)). Composite Offering thuộc mô hình sở hữu Offering theo [SD-034](decisions/strategic-decisions.md).

**Phạm vi sử dụng:** Ecoma Platform-level — quy tắc trách nhiệm là cam kết dùng chung theo SD-053; việc một domain có Composite Offering và cấu trúc của nó thuộc chính sách domain.

**Phân biệt với:**

- _Offering_: Composite Offering là dạng Offering gộp nhiều nguồn cung, không phải loại chủ thể mới.
- _Provider_: trách nhiệm vẫn phân theo từng nguồn cung (SD-014, SD-053), không quy gộp toàn bộ trách nhiệm cho một bên.

## 33. Model Alias

**Định nghĩa:** Tên logic do Consumer sở hữu trong LLM Marketplace, ánh xạ đến danh sách candidate Offering kèm routing policy; Consumer thay đổi alias hoặc policy mà không phụ thuộc Provider (LLM-008). Request inference gọi theo alias, hệ thống giải thành candidate Offering rồi endpoint cụ thể.

**Phạm vi sử dụng:** Domain-level (LLM Marketplace — LLM-008).

**Phân biệt với:**

- _Offering_: alias là tên gọi Consumer đặt cho chiến lược lựa chọn; Offering là đối tượng cung ứng thực tế.
- _Model_: không tồn tại danh tính model chuẩn hóa xuyên provider trong LLM Marketplace (LLM-006); alias trỏ thẳng đến Offering.

## 34. Endpoint

**Định nghĩa:** Địa chỉ API upstream thực sự phục vụ model, do Provider cung cấp, được Offering tham chiếu (LLM-004). Mỗi endpoint có trạng thái health: `healthy`, `degraded`, `down`; thứ tự ưu tiên và fallback giữa các endpoint do Provider cấu hình (LLM-007). Credential truy cập upstream gắn với endpoint (LLM-026).

**Phạm vi sử dụng:** Domain-level (LLM Marketplace — LLM-004, LLM-007).

**Phân biệt với:**

- _Offering_: endpoint là tài nguyên được tham chiếu; Offering là đơn vị được bán và định giá.
- _API Key_: API key là credential phía Consumer gọi Ecoma; credential của endpoint là phía Ecoma gọi upstream (LLM-022, LLM-026).

## 35. Logical Request

**Định nghĩa:** Đơn vị request inference mà Consumer khởi phát qua API của LLM Marketplace; quyết toán tài chính tính theo logical request, đúng một lần, dù phải thử nhiều endpoint hoặc Offering (LLM-018). Provider attempt là một lần thử thực thi của logical request trên một endpoint; usage cấp attempt chỉ phục vụ kiểm toán và đối soát (LLM-010).

**Phạm vi sử dụng:** Domain-level (LLM Marketplace — LLM-010, LLM-018).

**Phân biệt với:**

- _Provider attempt_: attempt là lần thử kỹ thuật; logical request là đơn vị nghiệp vụ tính tiền.

## 36. Reservation (LLM Marketplace)

**Định nghĩa:** Cơ chế duy nhất trước khi dispatch request trong LLM Marketplace: ước lượng giá (cận trên chi phí) của request, kiểm tra trên cùng khoản ước lượng rằng Usage balance còn đủ (ngăn âm balance) và limit còn lại ở cấp Workspace và cấp API key không bị vượt; thiếu ở bất kỳ ràng buộc nào thì từ chối khởi phát request. Reservation là giữ chỗ, không trừ tiền; charge thực tế không vượt phần đã ước lượng, phần dư giải phóng sau quyết toán (LLM-031, LLM-016, LLM-029). Là hiện thực của Reservation theo FIN-007 tại domain này.

**Phạm vi sử dụng:** Domain-level (LLM Marketplace — LLM-016, LLM-029, LLM-031), trên nền Ecoma Platform-level của Reservation (FIN-007).

**Phân biệt với:**

- _Charge_: reservation là giữ chỗ theo ước lượng, không trừ tiền; trừ Usage theo tiêu thụ thực tế (FIN-007).
- _Limit (Workspace/API key)_: limit là ngưỡng giới hạn tiêu dùng hai cấp theo LLM-029; reservation là lần kiểm tra và giữ chỗ chống vượt ngưỡng (LLM-031).

## 37. Price Snapshot

**Định nghĩa:** Bản chụp bảng giá mà một request được gắn tại thời điểm tạo; request đang thực thi không đổi giá khi Provider cập nhật bảng giá mới (version mới) (LLM-015). Mục đích: kiểm toán truy vết được số tiền của từng request.

**Phạm vi sử dụng:** Domain-level (LLM Marketplace — LLM-015).

**Phân biệt với:**

- _Bảng giá (price version)_: bảng giá là cấu hình của Offering có nhiều version; snapshot là bản mà request cụ thể dùng.

## 38. Workspace

**Định nghĩa:** Cấp tổ chức bên dưới Consumer Organization, dùng chung cho cả hai domain: một Organization có nhiều Workspace; phân quyền của Member và quota có thể giới hạn theo Workspace (LLM-021, SD-062). Workspace không thay đổi cấu trúc Owner/Membership (MEM-001–MEM-018).

**Phạm vi sử dụng:** Domain-level (LLM Marketplace — LLM-021).

**Phân biệt với:**

- _Consumer Organization_: Workspace là phân vùng bên trong Organization; chủ thể nghĩa vụ thương mại và sở hữu tài nguyên vẫn là Organization (ORG-003, ORG-004).

## 39. API Key

**Định nghĩa:** Credential scoped do Consumer trong Domain LLM quản lý vòng đời (cấp, xác thực, thu hồi); mỗi request gắn với Organization và API key tương ứng (LLM-022); API key gắn với một Workspace, giới hạn tiêu dùng áp dụng ở hai cấp Workspace và API key (LLM-029). API key là credential riêng của Domain LLM — Domain GPU không dùng API key, truy cập instance qua SSH với keypair cấp khi provision (SD-061); giới hạn tiêu dùng đặt riêng theo từng domain trong Workspace (SD-062). API key hành động thay mặt chủ thể ủy quyền theo ID-013: trách nhiệm quy về chủ thể, không quy về credential. Bảo mật: plaintext xuất hiện đúng một lần khi bootstrap, lưu hash, revoke chặn vĩnh viễn (LLM-025).

**Phạm vi sử dụng:** Domain-level (LLM Marketplace — LLM-022, LLM-025), trên nền quy tắc Ecoma Platform của credential ủy quyền (ID-013).

**Phân biệt với:**

- _Account_: API key không phải danh tính; Account là chủ thể ủy quyền (ID-013).
- _Credential của Endpoint_: API key phía Consumer→Ecoma; endpoint credential phía Ecoma→upstream (LLM-026).

## 40. First-Party Provider

**Định nghĩa:** Provider do Ecoma vận hành trong LLM Marketplace, là hạng Provider riêng vĩnh viễn: không trải progressive trust (danh tính Ecoma đã biết sẵn), không tích lũy payable và không có payout (cùng thực thể với Ecoma), vị trí đặc biệt (nếu có) chỉ nằm ở Discovery & Display, không ưu đãi routing (LLM-024). Vẫn được đo và công khai metric như Provider khác (SD-045).

**Phạm vi sử dụng:** Domain-level (Domain LLM — LLM-024); câu hỏi nâng lên cấp Ecoma Platform theo dõi tại Discovery Backlog (BL-39).

**Phân biệt với:**

- _Provider_: First-Party Provider là hạng của Provider, không phải loại chủ thể mới (SD-020).
- _First-party GPU supply (GPU-011)_: Ecoma góp máy cạnh tranh trong Domain GPU và chịu quy tắc Provider thường — quan hệ giữa dạng cung ứng này với hạng First-Party Provider của Domain LLM chưa được xác lập đồng nhất (BL-39).

## 41. Double-Entry Ledger

**Định nghĩa:** Sổ ghi kép là nguồn chân lý tài chính trong LLM Marketplace: mọi biến động số dư được ghi thành bút toán kép; số dư không lưu thành con số độc lập mà suy ra từ lịch sử ledger (LLM-019). Hỗ trợ chống ghi trùng, kiểm toán, đối soát và khôi phục sau sự cố.

**Phạm vi sử dụng:** Domain-level (LLM Marketplace — LLM-019), hiện thực Usage balance theo FIN-001/FIN-006.

**Phân biệt với:**

- _Usage Balance_: balance là giá trị nghiệp vụ; ledger là sổ gốc suy ra giá trị đó.

## 43. Locale Preference

**Định nghĩa:** thuộc tính Profile cốt lõi ghi nhận ngôn ngữ ưu tiên của người dùng, dùng chung xuyên suốt sản phẩm (SD-055, SD-013). Thông điệp hệ thống (email OTP, Invitation, notification) được gửi theo preference của người nhận; khi preference chưa được thiết lập, hệ thống dùng English fallback (SD-055). domain được có phần mở rộng preference riêng theo cơ chế SD-013.

**Phạm vi sử dụng:** Ecoma Platform-level (SD-055); phạm vi dữ liệu Profile cốt lõi và quy trình cài đặt chưa kết luận — [BL-40](discovery-backlog.md).

**Phân biệt với:**

- _Language Registry_: preference là lựa chọn của một người dùng cụ thể; registry là danh sách ngôn ngữ toàn sản phẩm hỗ trợ.

## 45. Timezone Preference

**Định nghĩa:** thuộc tính riêng trong Profile cốt lõi ghi nhận múi giờ hiển thị của người dùng, tách khỏi Locale Preference — ngôn ngữ và múi giờ được chọn độc lập (SD-057, SD-013). Timezone Preference chỉ tác động phần trình bày thời điểm; múi giờ nghiệp vụ (khung giờ peak/off-peak theo LLM-014, mốc settlement theo FIN-002) do cấu hình nghiệp vụ quyết định.

**Phạm vi sử dụng:** Ecoma Platform-level (SD-057); quy trình cài đặt và quy tắc mặc định khi chưa thiết lập — [BL-40](discovery-backlog.md).

**Phân biệt với:**

- _Locale Preference_: ngôn ngữ ưu tiên; Timezone Preference là múi giờ hiển thị — hai thuộc tính độc lập của Profile cốt lõi.
- _Múi giờ nghiệp vụ của bảng giá_: múi giờ áp dụng peak/off-peak là cấu hình nghiệp vụ của bảng giá (LLM-014), không bị thay đổi bởi preference hiển thị của người xem.

## 44. Language Registry

**Định nghĩa:** danh sách ngôn ngữ hỗ trợ của sản phẩm, quản lý tập trung ở cấp Ecoma Platform và cập nhật động như dữ liệu quản trị, không phải hằng số cài sẵn trong từng domain (SD-055, SD-040). Registry sở hữu danh sách ngôn ngữ, không sở hữu nội dung bản dịch của domain — bản dịch thuộc chính sách nơi sử dụng theo SD-046.

**Phạm vi sử dụng:** Ecoma Platform-level (SD-055); quy trình cập nhật và ngữ nghĩa trạng thái ngôn ngữ chưa kết luận — [BL-41](discovery-backlog.md).

**Phân biệt với:**

- _Locale Preference_: registry liệt kê ngôn ngữ sản phẩm hỗ trợ; preference là giá trị locale của một Account trong Profile cốt lõi.
- _Bản dịch của domain_: nội dung đa ngữ của từng domain (kể cả nội dung do Provider tạo) là chính sách của domain; registry không chứa nội dung này.

## 46. GPU Offering

**Định nghĩa:** Offering trong GPU Cloud Marketplace: cấu hình phần cứng + giá + trạng thái, do Provider sở hữu và tự đặt giá (SD-034, SD-054, GPU-001, GPU-002). Giá gồm ba thành phần: compute theo giây, storage theo GB-giờ, bandwidth theo byte; bảng giá versioned kèm snapshot tại thời điểm thuê — hợp đồng đang chạy giữ giá đến hạn kết thúc (GPU-002, tương tự LLM-015). Ecoma verify Offer trước khi Offer được active (GPU-002, tiền lệ LLM-028).

**Phạm vi sử dụng:** Domain-level (GPU Cloud Marketplace — GPU-001, GPU-002).

**Phân biệt với:**

- _Offering_: khái niệm chung cấp Ecoma Platform; GPU Offering là hiện thực cấu trúc cho domain này.
- _LLM Offering (model, capability, giá, trạng thái)_: hai domain dùng cấu trúc Offering khác nhau theo mô hình kinh doanh riêng (SD-034).

## 47. GPU Instance

**Định nghĩa:** Đơn vị cung ứng compute GPU trong GPU Cloud Marketplace — VM/container persistent mà Consumer thuê trên máy của Provider, với hai mode: on-demand (không bị preempt) và interruptible (chịu preempt, giá thấp hơn) (GPU-001). Hành vi khi instance interruptible bị preempt chưa được quyết định — [BL-45](discovery-backlog.md); khi Usage balance chạm $0, instance và disk bị xóa (GPU-003).

**Phạm vi sử dụng:** Domain-level (GPU Cloud Marketplace — GPU-001, GPU-003); serverless/reserved/container job là dạng mở rộng sau — [BL-44](discovery-backlog.md).

**Phân biệt với:**

- _Offering_: Offering là đơn vị niêm yết (cấu hình + giá + trạng thái); instance là tài nguyên Consumer thuê đã tạo từ Offering.
- _Workspace_: instance thuộc sở hữu của Consumer Organization qua Workspace (GPU-007).

## 48. Metering Agent

**Định nghĩa:** Platform-side agent của Ecoma chạy trên máy Provider trong GPU Cloud Marketplace, đo usage (compute-time, storage-time, bandwidth); số liệu agent là căn cứ chốt tiền duy nhất, Provider không tự báo số (GPU-004, nguyên tắc Ecoma đo lường theo SD-045). Dữ liệu thiếu không được hiểu là 0 — trạng thái chất lượng dữ liệu theo tiền lệ LLM-012 (GPU-004).

**Phạm vi sử dụng:** Domain-level (GPU Cloud Marketplace — GPU-004); agent cũng giám sát tín hiệu vi phạm dữ liệu host theo GPU-010.

**Phân biệt với:**

- _Usage metering của LLM Marketplace_: LLM đo từ response upstream; GPU đo qua agent trên máy Provider — hai cơ chế đo khác nhau theo đặc thù cung ứng.
- _Kaalia (Vast)_: tên daemon tương tự của đối thủ, chỉ là nguồn tham chiếu mô hình, không phải khái niệm Ecoma.

## 49. Hardware Verification

**Định nghĩa:** Xác minh phần cứng của máy/Offer Provider trong GPU Cloud Marketplace — tự động và liên tục (GPU model, VRAM, health check), do Ecoma thực hiện (GPU-005). Kết quả chỉ tác động Discovery & Display (nhãn, thứ tự hiển thị), không tác động Service Routing (GPU-005, SD-049); độ tin cậy đo và công bố theo SD-045.

**Phạm vi sử dụng:** Domain-level (GPU Cloud Marketplace — GPU-005); đóng phần xác minh hardware của [BL-22](discovery-backlog.md) cho domain này.

**Phân biệt với:**

- _Verified (tài khoản, SD-042)_: trạng thái trust của Account/Provider theo khung hai giai đoạn Ecoma Platform; Hardware Verification là thuộc tính của máy — hai khái niệm tách bạch, không gộp tên.
- _Secure Cloud tier (Vast)_: tier bảo mật tham chiếu của đối thủ; Ecoma không tạo tier riêng, tín hiệu trust chỉ tác động Display.
