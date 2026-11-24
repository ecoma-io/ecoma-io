# Strategic Decisions

Các Strategic Decision cấp Ecoma — chiến lược sản phẩm và Ecoma Platform. Quy ước mã, trạng thái và quan hệ được quy định tại [README](README.md).

## SD-058 — Sản phẩm duy nhất AI Factory Marketplace

**Status:** Accepted  
**Liên quan:** SD-001 · SD-041 · SD-051 · SD-054 · SD-059

Ecoma là một Product duy nhất — **AI Factory Marketplace** — hợp nhất từ định hướng LLM Marketplace và GPU Cloud Marketplace. Không còn mô hình Product Portfolio gồm nhiều Product; Decentralized Cloud Object Storage bị loại khỏi định hướng chiến lược. Quyết định này thay thế SD-001, SD-041, SD-051 và SD-054; phần vai trò trung gian Marketplace của LLM và GPU theo SD-054 được giữ nguyên và đọc theo domain sau hợp nhất. Thứ tự delivery bên trong sản phẩm chưa quyết định — theo dõi tại Discovery Backlog.

## SD-059 — Hai domain cung ứng trên một lớp Ecoma Platform

**Status:** Accepted  
**Liên quan:** SD-058 · SD-002 · SD-006 · SD-007 · SD-018 · SD-034 · SD-040 · SD-046

AI Factory Marketplace gồm hai domain cung ứng ngang hàng — **Domain LLM** và **Domain GPU** — trên một lớp năng lực dùng chung do Ecoma sở hữu (**Ecoma Platform**): Account & Identity, Profile, Provider Identity & Trust, Financial Balance & Settlement, Workspace/API key. Mỗi domain tự nắm Offering, discovery, verify, vòng đời và vận hành cung ứng của mình; không có model niêm yết dùng chung giữa hai domain. Consumer duyệt Offering qua hai khu discovery riêng. Provider cấu hình cung ứng cả hai domain qua một ứng dụng — đây là sự thật về giao diện, không lập ranh giới nghiệp vụ. Các quyết định đã ghi nhận theo cấp Product được đọc lại theo cấp domain: quyền tự chủ và chính sách "cấp Product" của LLM Marketplace và GPU Cloud Marketplace thành quyền tự chủ và chính sách của Domain LLM và Domain GPU tương ứng.

## SD-060 — Liên kết cung ứng giữa hai domain

**Status:** Accepted  
**Liên quan:** SD-058 · SD-059 · SD-037 · SD-052

Việc tài nguyên GPU của một Provider trở thành hạ tầng chạy Offering LLM của Provider khác qua Ecoma không phải giá trị cốt lõi của AI Factory Marketplace, nhưng được phép xảy ra và Ecoma mong muốn. Ranh giới giữa hai domain phải không chặn liên kết này khi nhu cầu phát sinh; không thiết kế tích hợp trước khi có nhu cầu thực. Quyết định này thay thế SD-052.

## SD-061 — Credential tiêu dùng theo domain

**Status:** Accepted  
**Liên quan:** SD-059 · SD-060 · GPU-007 · GPU-012 · LLM-022

Mỗi domain dùng credential tiêu dùng riêng: **Domain LLM** dùng API key theo mô hình đã chốt (LLM-022, LLM-025, LLM-029); **Domain GPU** không dùng API key — Consumer truy cập instance GPU qua SSH, keypair được đưa vào instance tại thời điểm provision. Điều khoản của GPU-007 về kế thừa API key từ LLM Marketplace bị thay thế; chi tiết mô hình tiêu dùng của Domain GPU tại [GPU-012](gpu-cloud-marketplace-decisions.md). Domain GPU hiện chưa có API tự động hóa — theo dõi tại Discovery Backlog.

## SD-062 — Limit tiêu dùng theo domain trong Workspace

**Status:** Accepted  
**Liên quan:** SD-061 · GPU-007 · GPU-012 · LLM-029

Một Workspace áp limit tiêu dùng riêng cho từng domain: limit Domain LLM và limit Domain GPU độc lập với nhau. Limit Domain LLM áp dụng ở hai cấp Workspace và API key như đã chốt (LLM-029); limit Domain GPU chỉ áp dụng ở cấp Workspace vì Domain GPU không dùng API key. Chủ thể đặt và quản lý limit mỗi domain là Owner và Member được cấp quyền quản lý, trong phạm vi quyền của mình theo [SD-063](#sd-063--membership-role-dùng-chung-permission-theo-domain).

## SD-063 — Membership role dùng chung, Permission theo domain

**Status:** Accepted  
**Liên quan:** SD-059 · SD-062 · MEM-005 · MEM-010

Mô hình Membership của Consumer Organization được dùng chung trên cả hai domain: tập Role được định nghĩa một lần cấp Ecoma Platform và áp dụng thống nhất cho cả Domain LLM và Domain GPU; Permission gắn theo từng domain — một Member có thể có quyền thao tác trên một domain mà không có trên domain kia. Đọc lại [MEM-005](membership-decisions.md) và [MEM-010](membership-decisions.md) theo cấp domain và theo quyết định này: Role không phải tự định nghĩa riêng từng domain; Permission vẫn là chính sách cấp domain.

## SD-064 — Termination của Consumer Organization thu hồi quyền trên cả hai domain

**Status:** Accepted  
**Liên quan:** SD-059 · ORG-013 · SD-063

Khi Consumer Organization bị Terminated, việc thu hồi ngay toàn bộ quyền truy cập phát sinh từ Organization ([ORG-013](consumer-organization-decisions.md)) áp dụng trên cả hai domain: mọi Membership, quyền thao tác, API key (Domain LLM) và khả năng truy cập instance (Domain GPU) phát sinh từ Organization phải bị thu hồi ngay lập tức. Đây là hệ quả tường minh hóa của cấu trúc hai domain trong một sản phẩm theo SD-059.

## SD-001 — Product Ecosystem

**Status:** Superseded — thay thế bởi [SD-058](#sd-058--sản-phẩm-duy-nhất-ai-factory-marketplace)

Ecoma là một hệ sinh thái gồm nhiều Product có khả năng hoạt động như những nền tảng kinh doanh độc lập.

## SD-002 — Hybrid Product Strategy

**Status:** Accepted

Mỗi Product có thể sở hữu mô hình kinh doanh, Organization Model, chính sách và vòng đời riêng.

## SD-003 — Balanced Strategic Design

**Status:** Accepted

Chiến lược thiết kế Domain của Ecoma cân bằng giữa tính độc lập của Product, khả năng chia sẻ và tính nhất quán toàn hệ sinh thái.

## SD-004 — Shared Platform Capabilities

**Status:** Accepted

Các năng lực thực sự dùng chung được cung cấp ở cấp Platform; việc chia sẻ kỹ thuật không đồng nghĩa với việc hợp nhất quyền sở hữu nghiệp vụ.

## SD-005 — Selective Cross-service Consistency

**Status:** Accepted

Chỉ thống nhất những quy tắc và năng lực cần thiết trên toàn hệ sinh thái; không áp đặt tính nhất quán cho mọi nghiệp vụ.

## SD-006 — Independent Domain Ownership

**Status:** Accepted

Mỗi Product chịu trách nhiệm sở hữu và phát triển Domain của mình.

## SD-007 — Independent Domain Models

**Status:** Accepted

Các Product được phép có Domain Model khác nhau, kể cả khi sử dụng những khái niệm nghiệp vụ có tên gọi tương tự.

## SD-008 — DDD Architectural Direction

**Status:** Accepted

Ecoma định hướng DDD, Rich Domain Model và Clean Architecture; áp dụng CQRS khi có lý do nghiệp vụ và kỹ thuật phù hợp.

## SD-009 — Verifiable Architecture

**Status:** Accepted

Kiến trúc phải có khả năng kiểm chứng thông qua các quy tắc và bằng chứng phù hợp.

## SD-010 — Discovery Before Bounded Context Design

**Status:** Accepted

Hoàn thành Strategic Domain Discovery và Business Capability Map trước khi xác định Bounded Context và Tactical Design.

## SD-011 — Unified Ecosystem Experience

**Status:** Accepted

Ecoma sử dụng thương hiệu và định hướng trải nghiệm thống nhất xuyên suốt các Product.

## SD-012 — Unified User Identity

**Status:** Accepted

Một Ecoma Account được sử dụng xuyên suốt hệ sinh thái; việc xác thực không mặc nhiên cấp quyền truy cập vào mọi Product.

## SD-013 — Hybrid User Profile Ownership

**Status:** Accepted

Ecosystem sở hữu thông tin Profile cốt lõi và Personalization dùng chung; Product có thể sở hữu các phần mở rộng Profile phục vụ nghiệp vụ riêng.

## SD-029 — Hybrid Marketplace and Service Platform

**Status:** Accepted  
**Liên quan:** [SD-015](provider-decisions.md)

Ecoma có thể đóng vai trò trung gian Marketplace hoặc nhà cung cấp dịch vụ tổng hợp tùy theo mô hình kinh doanh của từng Product. Trách nhiệm và phạm vi cam kết được xác định theo từng Product.

## SD-030 — Hybrid Ecosystem Governance

**Status:** Accepted

Ecosystem quản trị các nguyên tắc và năng lực nền tảng bắt buộc thống nhất; Product tự chủ quyết định mô hình kinh doanh, quan hệ thương mại, pricing, SLA và trách nhiệm dịch vụ trong phạm vi các nguyên tắc chung.

## SD-033 — Flexible Provider Supply Model

**Status:** Accepted

Provider có thể cung cấp tài nguyên đầu vào hoặc dịch vụ thành phần tùy theo Product và Offering.

## SD-034 — Dual Offering Ownership Model

**Status:** Accepted

Ecoma hỗ trợ cả Provider-owned Offering và Product-owned Offering. Chủ thể sở hữu Offering phụ thuộc vào mô hình kinh doanh của từng Product.

## SD-035 — Ecoma as Customer-facing Commercial Party

**Status:** Accepted  
**Liên quan:** [SD-015](provider-decisions.md)

Ecoma luôn là chủ thể có quan hệ thương mại trực tiếp với Consumer, kể cả khi Offering thuộc sở hữu của Provider.

## SD-036 — Product-defined Service Commitments

**Status:** Accepted  
**Liên quan:** [SD-015](provider-decisions.md)

Product quyết định phạm vi cam kết dịch vụ của Ecoma với Consumer. Ecoma chịu trách nhiệm đối với những cam kết mà mình đưa ra.

## SD-037 — Integrated Ecosystem Vision

**Status:** Accepted

Tầm nhìn dài hạn của Ecoma là một hệ sinh thái tích hợp trên cả hai phương diện:

- Integrated Experience: Trải nghiệm xuyên suốt giữa các Product.
- Integrated Business: Các Product có thể kết hợp dịch vụ, chia sẻ nguồn lực và tạo ra Offering có giá trị tổng hợp.

Việc tích hợp không làm mất tính độc lập về nghiệp vụ của từng Product.

## SD-038 — Dual Product Portfolio Expansion

**Status:** Accepted

Ecoma phát triển Product Portfolio theo cả hai hướng: mở rộng bằng Product có thị trường độc lập và phát triển Product nhằm bổ trợ, gia tăng giá trị tổng hợp cho hệ sinh thái.

## SD-039 — Hybrid Product Portfolio Governance

**Status:** Accepted

Ecosystem quản trị chiến lược và vòng đời toàn bộ Product Portfolio, bao gồm phát triển, mở rộng, hợp nhất, thay thế và ngừng Product. Product vẫn tự chủ phát triển và vận hành nghiệp vụ trong phạm vi chiến lược đã xác lập.

## SD-040 — Federated Ecosystem Operations

**Status:** Accepted

Ecoma tổ chức các năng lực vận hành dùng chung ở cấp Ecosystem, đồng thời duy trì quyền sở hữu và thực hiện các hoạt động vận hành đặc thù tại từng Product.

## SD-041 — Independent Business Capabilities of GPU Cloud Marketplace and Decentralized Cloud Object Storage

**Status:** Superseded — thay thế bởi [SD-058](#sd-058--sản-phẩm-duy-nhất-ai-factory-marketplace)  
**Liên quan:** [SD-001](#sd-001--product-ecosystem) · [SD-037](#sd-037--integrated-ecosystem-vision) · [SD-038](#sd-038--dual-product-portfolio-expansion)

GPU Cloud Marketplace và Decentralized Cloud Object Storage là những năng lực kinh doanh độc lập của hệ sinh thái:

- Mỗi năng lực có giá trị kinh doanh độc lập và có thể phục vụ khách hàng trực tiếp, không phụ thuộc vào việc khách hàng sử dụng Product khác trong Ecoma.
- Việc các năng lực này cung cấp tài nguyên cho LLM Marketplace hoặc các Product khác là quan hệ tiêu thụ dịch vụ phát sinh từ hệ sinh thái, không phải lý do tồn tại chính của chúng.

## SD-046 — Ba cấp quan hệ chính sách Ecosystem–Product

**Status:** Accepted  
**Liên quan:** [SD-003](#sd-003--balanced-strategic-design) · [SD-005](#sd-005--selective-cross-service-consistency) · [SD-030](#sd-030--hybrid-ecosystem-governance) · [SD-039](#sd-039--hybrid-product-portfolio-governance) · [SD-040](#sd-040--federated-ecosystem-operations) · [FIN-004](financial-decisions.md)

Mỗi quyết định nghiệp vụ trong hệ sinh thái được xếp vào đúng một trong ba cấp quan hệ giữa Ecosystem và Product:

1. **Bắt buộc hệ sinh thái:** sự khác biệt giữa các Product sẽ phá vỡ một cam kết dùng chung đã được quyết định. Chính sách phải thống nhất toàn hệ sinh thái; nhu cầu riêng của Product không được giải bằng ngoại lệ thường trực mà chỉ bằng đề xuất thay đổi hoặc chuyển cấp chính sách theo Decision Process.
2. **Mặc định Ecosystem, Product được phủ:** Ecosystem định nghĩa giá trị mặc định dùng chung; Product được phủ bằng quyết định riêng. Việc phủ là tự quyết của Product nhưng phải được khai báo công khai và truy vết được, tối thiểu gồm: Product, chính sách bị phủ, giá trị phủ, lý do. Override bị phản đối được đánh giá lại theo test cam kết dùng chung; nếu override phá vỡ cam kết dùng chung, override bị thu hồi và Product phải tuân thủ hoặc đề xuất thay đổi chính sách.
3. **Tự chủ Product:** khác biệt giữa các Product là khác biệt hóa nghiệp vụ thông thường; Product quyết định hoàn toàn trong phạm vi này.

Quy tắc xếp cấp (test cam kết dùng chung): với mỗi quyết định nghiệp vụ, đặt câu hỏi "nếu các Product đi khác nhau, điều đó có phá vỡ một cam kết dùng chung đã được quyết định không?". Phá vỡ cam kết dùng chung (ví dụ [SD-012](#sd-012--unified-user-identity), [SD-013](#sd-013--hybrid-user-profile-ownership), [SD-015](provider-decisions.md), [SD-018](provider-decisions.md), [SD-035](#sd-035--ecoma-as-customer-facing-commercial-party)) → cấp 1. Chỉ gây tốn kém hoặc kém hiệu quả vận hành → cấp 2. Khác biệt hóa nghiệp vụ thông thường → cấp 3.

Giải quyết xung đột: không tồn tại ngoại lệ thường trực cho cấp 1. Tình huống khẩn cấp vận hành được xử lý theo đường emergency có thời hạn tương tự quy định khẩn cấp trong [Decision Process](../../00-governance/decision-process.md), kèm retrospective review. Phối hợp quyết định xuyên Product tuân theo ma trận thẩm quyền tại [review-authority](../../08-review-process/review-authority.md): tham vấn các Product bị ảnh hưởng, thẩm quyền Ecosystem quyết phần chiến lược. Khung ba cấp này thuộc lớp business và không thay thế ma trận thẩm quyền kiến trúc.

## SD-047 — Phân cấp Provider Trust & Certification

**Status:** Accepted  
**Liên quan:** [SD-016](provider-decisions.md) · [SD-018](provider-decisions.md) · [SD-042](provider-decisions.md) · [SD-046](#sd-046--ba-cấp-quan-hệ-chính-sách-ecosystemproduct)

Khung trust hai tầng Activated/Verified và mapping nhóm đối tượng KYC (cá nhân / hộ kinh doanh / doanh nghiệp ↔ Individual/Organization Provider) là cam kết dùng chung cấp hệ sinh thái: "Verified" giữ nghĩa tương đồng trên mọi Marketplace, bảo vệ ý nghĩa đăng ký một lần và cung ứng xuyên Marketplace của Provider Identity theo SD-018. Tiêu chí đánh giá chi tiết để đạt từng trạng thái là mặc định Ecosystem mà Product được mở rộng hoặc phủ theo cơ chế khai báo override của SD-046.

## SD-048 — Đình chỉ Provider theo phân loại vi phạm

**Status:** Accepted  
**Liên quan:** [SD-016](provider-decisions.md) · [SD-018](provider-decisions.md) · [SD-023](provider-decisions.md) · [SD-044](provider-decisions.md) · [SD-046](#sd-046--ba-cấp-quan-hệ-chính-sách-ecosystemproduct) · [FIN-008](financial-decisions.md)

Đình chỉ Provider lan truyền theo mức vi phạm:

- Vi phạm cấp hệ sinh thái (ví dụ gian lận danh tính, gian lận thanh toán, lạm dụng nghiêm trọng) đình chỉ Provider trên toàn bộ Marketplace. Danh mục vi phạm cấp hệ sinh thái là mặc định Ecosystem mà Product được mở rộng.
- Vi phạm đặc thù dịch vụ chỉ đình chỉ trong phạm vi Product áp dụng.

Khi Provider bị đình chỉ cấp hệ sinh thái, Offering của Provider bị gỡ khỏi Discovery (không nhận Consumer mới); phần cung ứng đã cam kết với Consumer được hoàn tất theo biên độ đã bảo đảm nguồn, sau đó dừng. Nghĩa vụ lịch sử được bảo toàn theo SD-023. Điều kiện hồi phục và chấm dứt sau đình chỉ chưa quyết định, theo dõi tại BL-22 và BL-31 của Discovery Backlog.

## SD-049 — Phân tách Discovery & Display với Service Routing

**Status:** Accepted  
**Liên quan:** [SD-045](provider-decisions.md) · [SD-046](#sd-046--ba-cấp-quan-hệ-chính-sách-ecosystemproduct)

Yếu tố thương mại chỉ được phép tác động đến hiển thị và xếp hạng trong Discovery & Display, kèm điều kiện minh bạch. Service Routing — việc điều một yêu cầu cụ thể tới Provider — chỉ được quyết định theo tiêu chí nghiệp vụ và kỹ thuật: khả năng đáp ứng, chất lượng đo được theo SD-045, tải và proximity. Ràng buộc này là bắt buộc toàn hệ sinh thái: nếu một Product cho phép yếu tố thương mại chi phối routing trong khi hệ sinh thái công khai metric chất lượng, niềm tin vào chính bộ đo lường đó bị phá. Cơ chế minh bạch cụ thể cho Display thuộc lớp design.

## SD-051 — Thứ tự ưu tiên phát triển Product Portfolio

**Status:** Superseded — thay thế bởi [SD-058](#sd-058--sản-phẩm-duy-nhất-ai-factory-marketplace)  
**Liên quan:** [SD-038](#sd-038--dual-product-portfolio-expansion) · [SD-039](#sd-039--hybrid-product-portfolio-governance) · [SD-041](#sd-041--independent-business-capabilities-of-gpu-cloud-marketplace-and-decentralized-cloud-object-storage)

Thứ tự ưu tiên phát triển: LLM Marketplace đi trước; GPU Cloud Marketplace phát triển sau; Decentralized Cloud Object Storage giữ trong kế hoạch như năng lực có khả năng triển khai, chưa cam kết phát triển.

Thứ tự này là quyết định portfolio strategy theo SD-039, không thay đổi tính độc lập nghiệp vụ của từng năng lực theo SD-041 và không tạo quan hệ phụ thuộc cung ứng bắt buộc giữa các Product. Thứ tự và trạng thái cam kết có thể được xem lại theo quy trình Decision Process khi có dữ kiện thị trường mới.

## SD-052 — Không có yêu cầu tích hợp xuyên Product hiện tại

**Status:** Superseded — thay thế bởi [SD-060](#sd-060--liên-kết-cung-ứng-giữa-hai-domain)  
**Liên quan:** [SD-037](#sd-037--integrated-ecosystem-vision) · [SD-041](#sd-041--independent-business-capabilities-of-gpu-cloud-marketplace-and-decentralized-cloud-object-storage) · [SD-051](#sd-051--thứ-tự-ưu-tiên-phát-triển-product-portfolio)

Thời điểm hiện tại, Product Portfolio không có yêu cầu tích hợp nghiệp vụ nào giữa các Product. Mỗi Product vận hành theo năng lực kinh doanh độc lập theo SD-041; việc tích hợp chia sẻ dịch vụ và nguồn lực theo tầm nhìn dài hạn SD-037 chưa có nhu cầu kinh doanh cụ thể nào phát sinh và không được giả định trước. Khi một yêu cầu tích hợp thực tế xuất hiện, yêu cầu đó được đưa vào Discovery Backlog và xử lý theo Decision Process.

Quyết định này ghi nhận trạng thái hiện tại của Portfolio, không phủ nhận tầm nhìn tích hợp dài hạn theo SD-037.

## SD-054 — Vai trò thương mại của từng Product

**Status:** Superseded — thay thế bởi [SD-058](#sd-058--sản-phẩm-duy-nhất-ai-factory-marketplace)  
**Liên quan:** [SD-029](#sd-029--hybrid-marketplace-and-service-platform) · [SD-033](provider-decisions.md) · [SD-034](#sd-034--dual-offering-ownership-model) · [SD-035](#sd-035--ecoma-as-customer-facing-commercial-party) · [SD-036](#sd-036--product-defined-service-commitments) · [SD-045](provider-decisions.md) · [SD-051](#sd-051--thứ-tự-ưu-tiên-phát-triển-product-portfolio)

Theo hai vai trò định nghĩa tại SD-029:

- LLM Marketplace và GPU Cloud Marketplace đóng vai trò trung gian Marketplace: Ecoma ghép nối cung ứng của Provider với nhu cầu của Consumer; Offering thuộc sở hữu Provider là hình thức chủ đạo theo SD-034.
- Decentralized Cloud Object Storage đóng vai trò nhà cung cấp dịch vụ tổng hợp: Ecoma trực tiếp cung cấp dịch vụ lưu trữ cho Consumer; Offering thuộc sở hữu Product theo SD-034, với năng lực lưu trữ do Provider đóng góp dạng tài nguyên đầu vào theo SD-033.

Với vai trò trung gian Marketplace, Ecoma chịu trách nhiệm đối với những cam kết do Ecoma tự đưa ra theo SD-014 và mặc định không bảo đảm dịch vụ đầu cuối theo SD-045. Với vai trò nhà cung cấp dịch vụ tổng hợp, Ecoma chịu trách nhiệm cung ứng theo phạm vi cam kết do Product quyết định theo SD-036. Ecoma luôn là chủ thể có quan hệ thương mại trực tiếp với Consumer trên cả ba Product theo SD-035.

Quyết định này chốt trước trục vai trò thương mại (SD-029) cho từng Product; các trục còn lại của mô hình thương mại (pricing, cấu trúc Offering chi tiết) vẫn thuộc thẩm quyền từng Product theo SD-030/SD-039.

## SD-055 — Đa ngôn ngữ cấp Ecosystem

**Status:** Accepted  
**Liên quan:** [SD-011](#sd-011--unified-ecosystem-experience) · [SD-013](#sd-013--hybrid-user-profile-ownership) · [SD-046](#sd-046--ba-cấp-quan-hệ-chính-sách-ecosystemproduct) · [SD-040](#sd-040--federated-ecosystem-operations)

Nhu cầu đa ngôn ngữ cho end-user là nhu cầu thực tế đã xác lập của hệ sinh thái. Quyết định này chốt khung sở hữu và các ràng buộc nền tảng ở mức discovery:

- **English là ngôn ngữ gốc và fallback:** mọi nội dung hiển thị cho end-user — giao diện, thông điệp hệ thống (email OTP, Invitation, notification), tài liệu xác minh — phải tồn tại bản English. Khi bản theo locale của người dùng không tồn tại, hiển thị bản English. Không có surface nào được hiển thị khóa nội dung hoặc nội dung trống.
- **Locale Preference thuộc Profile cốt lõi:** preference ngôn ngữ là dữ liệu Profile cốt lõi sở hữu Ecosystem theo SD-013, dùng chung xuyên hệ sinh thái. Trước khi preference được thiết lập (ví dụ Account mới đăng ký), thông điệp hệ thống dùng English fallback. Product được có phần mở rộng preference riêng theo cơ chế SD-013.
- **Chuẩn mã locale:** mã locale dùng một chuẩn thống nhất xuyên hệ sinh thái (BCP 47) để Profile, catalog và dữ liệu tương thích chéo Product.
- **Locale-readiness:** việc bổ sung một ngôn ngữ mới không được đòi hỏi thay đổi cấu trúc dữ liệu, contract tích hợp hay migration phá vỡ của các Product khác.
- **Language Registry tập trung:** danh sách ngôn ngữ hỗ trợ của hệ sinh thái được quản lý tập trung ở cấp Ecosystem theo SD-040, cập nhật động như dữ liệu quản trị, không phải hằng số cài sẵn trong từng Product. Registry sở hữu danh sách ngôn ngữ, không sở hữu bản dịch; nội dung bản dịch thuộc chính sách của từng nơi sử dụng.

Phân cấp theo SD-046: các điểm trên là cam kết dùng chung cấp hệ sinh thái. Product tự quyết định: danh sách ngôn ngữ bổ sung ngoài English mà Product phân bổ nguồn lực dịch; nội dung đa ngữ cho nội dung do Provider tạo (optional — Ecoma không cam kết dịch nội dung Provider, thiếu bản locale thì hiển thị bản gốc); và ngôn ngữ bổ trợ trong phạm vi nghiệp vụ riêng. Ngôn ngữ binding của tài liệu pháp lý và xác minh được chốt theo nguyên tắc tại [SD-056](#sd-056--ngôn-ngữ-của-tài-liệu-pháp-lý-và-xác-minh); kết luận cụ thể theo từng thị trường phụ thuộc tư cách Merchant of Record chưa được xác định — theo dõi tại [BL-03](../discovery-backlog.md).

Các câu hỏi vận hành còn mở theo dõi tại [BL-40](../discovery-backlog.md) và [BL-41](../discovery-backlog.md).

## SD-056 — Ngôn ngữ của tài liệu pháp lý và xác minh

**Status:** Accepted  
**Liên quan:** [SD-055](#sd-055--đa-ngôn-ngữ-cấp-ecosystem) · [SD-042](provider-decisions.md) · [SD-046](#sd-046--ba-cấp-quan-hệ-chính-sách-ecosystemproduct) · [SD-047](#sd-047--phân-cấp-provider-trust--certification) · [SD-029](#sd-029--hybrid-marketplace-and-service-platform)

Tài liệu pháp lý (Terms of Service, chính sách, điều khoản):

- Hiển thị đa ngữ theo SD-055: khi có bản theo locale của người xem thì hiển thị bản đó, thiếu thì English. Bản dịch mang giá trị tham chiếu cho người đọc.
- Bản ngôn ngữ có giá trị ràng buộc pháp lý (binding) được xác định theo pháp luật của khu vực/thị trường áp dụng. Với thị trường mà pháp luật im lặng hoặc chưa xác định được luật áp dụng, bản English là bản binding. Kết luận binding cụ thể theo từng thị trường phụ thuộc tư cách Merchant of Record chưa được xác định ([BL-03](../discovery-backlog.md)) và danh sách thị trường mục tiêu — theo dõi tại [BL-42](../discovery-backlog.md).

Giấy tờ KYC do Provider nộp:

- Ecoma chấp nhận giấy tờ xác minh bằng mọi ngôn ngữ; gánh nặng xử lý ngôn ngữ không quen thuộc thuộc khâu xác minh của Ecoma, không chuyển thành điều kiện bắt buộc cho Provider nộp hồ sơ.
- Yêu cầu cụ thể về dịch thuật hoặc công chứng (nếu có) là tiêu chí xác minh chi tiết — thuộc bộ tiêu chí mặc định Ecosystem, Product được phủ theo SD-047/SD-046; không phát sinh ràng buộc ngôn ngữ cấp hệ sinh thái ngoài nguyên tắc chấp nhận mọi ngôn ngữ.

## SD-057 — Định dạng hiển thị theo Locale và Timezone Preference

**Status:** Accepted  
**Liên quan:** [SD-055](#sd-055--đa-ngôn-ngữ-cấp-ecosystem) · [SD-013](#sd-013--hybrid-user-profile-ownership) · [LLM-014](llm-marketplace-decisions.md) · [LLM-015](llm-marketplace-decisions.md) · [FIN-002](financial-decisions.md)

- Giá trị nghiệp vụ (giá, số dư, usage, timestamp giao dịch) được lưu trữ và snapshot độc lập với phần trình bày; định dạng hiển thị không thay đổi giá trị — Price Snapshot theo LLM-015 giữ nguyên ý nghĩa bất kể cách hiển thị.
- Số và ngày giờ hiển thị theo Locale Preference của người xem theo SD-055; khi chưa có preference, hiển thị theo chuẩn English.
- Timezone Preference là thuộc tính riêng trong Profile cốt lõi theo SD-013, tách khỏi Locale Preference: người dùng chọn ngôn ngữ và múi giờ hiển thị độc lập. Timezone Preference chỉ tác động phần trình bày thời điểm; múi giờ nghiệp vụ — khung giờ peak/off-peak của bảng giá (LLM-014) và mốc tính settlement cuối tháng (FIN-002) — do cấu hình nghiệp vụ quyết định, không bị thay đổi bởi preference hiển thị.
- Tiền tệ niêm yết Offering và tiền tệ của balance/settlement chưa được quyết định; đây là câu hỏi của vòng discovery tài chính có khía cạnh hiển thị — theo dõi tại [BL-43](../discovery-backlog.md), liên hệ [BL-26](../discovery-backlog.md).
- Quy tắc mặc định hiển thị (định dạng số/ngày giờ, múi giờ) khi người xem chưa có preference tương ứng chưa được quyết định — theo dõi cùng [BL-40](../discovery-backlog.md).

## Khoảng mã cần xác minh

SD-031 và SD-032 không có nội dung được ghi nhận. Nguyên nhân đã được xác minh: hai mã này là sai sót của quá trình đánh số, không tương ứng với quyết định nào bị loại hoặc nội dung nào bị mất. Khoảng trống này được giữ nguyên như một phần của lịch sử; không được lấp bằng cách đánh lại số cho quyết định mới.
