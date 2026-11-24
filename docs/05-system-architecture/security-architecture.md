# Kiến trúc Bảo mật (Security Architecture)

**Trạng thái:** Scaffold — chỉ là định hướng cấu trúc; chưa chứa bất kỳ quyết định kiến trúc nào đã được review hoặc phê duyệt.

**Phạm vi:** Cách trust, identity, authentication, authorization, credentials và bảo vệ dữ liệu được quản trị ở cấp hệ thống. Scaffold này không chọn bất kỳ security mechanism, protocol stack hay sản phẩm nào.

## 1. Mục tiêu Bảo mật (Security Objectives)

- Các mục tiêu được kế thừa từ security expectations đã được thiết lập ở giai đoạn discovery: [deterministic enforcement](../07-quality-attributes/security.md), sự tách biệt giữa authentication và authorization, revocation quyền truy cập hoàn chỉnh và tức thời, bảo vệ identity boundary, và auditability.
- Nhiệm vụ của viewpoint này là hiện thực hóa các mục tiêu đó về mặt kỹ thuật — thông qua các decision, chứ không phải ở đây.
- Mục tiêu trở nên cụ thể và verifiable theo từng decision ([AP-019](../00-governance/architecture-principles.md)); scaffold này không khẳng định bất kỳ mechanism nào.

## 2. Nguyên tắc Bảo mật (Security Principles)

- Enforcement diễn ra tại boundary chịu trách nhiệm cho invariant, không bao giờ chỉ ở một entry point hoặc client duy nhất ([AP-008](../00-governance/architecture-principles.md), [AP-014](../00-governance/architecture-principles.md)).
- Authentication không bao giờ đồng nghĩa với authorization: một identity đã được xác thực không tự nó cấp bất cứ quyền gì ([Security expectations](../07-quality-attributes/security.md)).
- Mỗi lần vượt qua trust boundary đều yêu cầu verification tường minh; việc nằm ở nội bộ không tự nó là bằng chứng về độ tin cậy.
- Các nguyên tắc này định hướng việc đánh giá; mỗi nguyên tắc mang trade-off riêng — ví dụ, enforcement tập trung versus latency và availability — mà các decision tương ứng phải nêu rõ.

## 3. Kiến trúc Identity (Identity Architecture)

- Sẽ ghi lại identity model cấp hệ thống: cách các fact đã thiết lập — một Account dùng chung trên toàn Ecoma Platform cho cả hai domain, Provider Identity được giữ tách biệt với Provider Actor và Provider Qualification, các organization theo phạm vi domain — được hiện thực hóa về mặt kỹ thuật (facts: [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md)).
- Phải bảo toàn các sự phân biệt đã thiết lập bên trong technical model: Account, Consumer Organization và Provider là các concept khác nhau, và identity ở một nơi không bao giờ trở thành quyền hay bằng chứng ở nơi khác ([Identity boundary protection](../07-quality-attributes/security.md)).
- Cách hiện thực hóa — identity stores, federation giữa các domain, identity lifecycle — chưa được quyết định; không chọn mechanism nào ở đây.

## 4. Kiến trúc Authentication (Authentication Architecture)

- Sẽ ghi lại cách identity được chứng minh và cách authenticated session được biểu diễn và truyền tải: proofing flow, session và token semantics, và cách xử lý multi-factor khi cần thiết.
- Bị ràng buộc bởi định hướng cấp discovery đã được chấp nhận: passwordless authentication không lưu trữ user password (ID-004) và ưu tiên tích hợp identity dựa trên standard (ID-002), được tóm tắt trong [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md); cách các định hướng này chuyển thành một protocol stack cụ thể vẫn chưa được quyết định.
- Phải giữ rõ ràng rằng output của authentication chỉ là identity evidence — không bao giờ là một access decision ([Authentication vs Authorization](../07-quality-attributes/security.md)).

## 5. Kiến trúc Authorization (Authorization Architecture)

- Sẽ ghi lại cách access decision được đưa ra và thực thi: policy nằm ở đâu, ai evaluate nó, và cách decision đến được các enforcement point ([AP-014](../00-governance/architecture-principles.md)).
- Bị ràng buộc bởi quyền sở hữu đã thiết lập: tập Role được định nghĩa dùng chung cấp Ecoma Platform, permissions và authorization policy thuộc sở hữu của từng domain (MEM-005, MEM-010, SD-063), delegation chỉ nằm trong phạm vi của grantor (MEM-006, MEM-007), và chi tiết policy không được giả định chia sẻ giữa các domain ([Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md)).
- Cách hiện thực hóa chưa được quyết định; các mục phải trace được về những membership decision đó và thỏa mãn [complete revocation](../07-quality-attributes/security.md) — quyền kết thúc khi một membership hoặc organization kết thúc, bao gồm cả qua sessions, tokens và dependent credentials (MEM-013, ORG-013).

## 6. Trust Boundaries

- Tiếp nhận catalogue trust boundary từ [system context](system-context.md) và ghi lại, cho từng boundary, những gì được verify tại điểm vượt qua và bởi control nào do decision chỉ định.
- Các boundary được dự đoán từ các fact đã thiết lập bao gồm: actor-to-system, các điểm vượt qua giữa các domain, và các điểm vượt qua tới hệ thống bên ngoài; catalogue chính thức còn chờ boundary decision.
- Không thiết kế enforcement mechanism nào ở đây; mỗi mục nêu tên requirement và link tới control thỏa mãn nó sau khi được quyết định.

## 7. Bảo mật Service-to-Service (Service-to-Service Security)

- Sẽ ghi lại cách các unit xác thực lẫn nhau và cách identity context di chuyển qua các unit boundary, để một unit downstream có thể enforce authorization dựa trên bằng chứng đáng tin cậy.
- Phải trả lời: internal traffic có vượt qua một trust boundary hay không, và nếu không thì vì sao điều đó chấp nhận được — giả định rằng network được tin tưởng theo mặc định chính là điều phần này không bao giờ được âm thầm chấp nhận.
- Mechanism chưa được quyết định; các requirement suy ra từ các bản ghi identity và authorization ở trên.

## 8. Quản lý Credential và Secret (Credential and Secret Management)

- Sẽ ghi lại cách credentials và secrets — cho units, cho integrations, cho operators — được lưu trữ, phân phối, rotate và revoke.
- Revocation semantics phải thỏa mãn expectation về complete revocation: một credential bị revoke không thể sử dụng được ở bất cứ nơi nào nó từng được chấp nhận, kể cả qua các dạng derived hoặc cached ([Access revocation](../07-quality-attributes/security.md)).
- Cơ chế storage và distribution chưa được quyết định; [deployment viewpoint](deployment-architecture.md) chỉ ghi lại rằng injection phải tường minh và nằm ngoài các file trong repository.

## 9. Bảo vệ Dữ liệu (Data Protection)

- Sẽ ghi lại các protection requirement theo từng data classification, một khi [data viewpoint](data-architecture.md) định nghĩa các class: confidentiality, integrity, masking, và nghĩa vụ xử lý đối với dữ liệu cá nhân và tài chính.
- Protection đi theo classification — requirement của một class ràng buộc mọi unit chạm vào nó, độc lập với việc dữ liệu vật lý nằm ở đâu.
- Các biện pháp protection cụ thể, chẳng hạn encryption at rest hay key management, là các decision; không chọn gì ở đây.

## 10. Kiểm toán Bảo mật (Security Auditing)

- Sẽ ghi lại những security event nào phải audit được: grants, inheritances, revocations và denials quyền truy cập, nhất quán với nguyên tắc rằng quyền có semantics grant, inherit, revoke và audit được định nghĩa rõ ([AP-014](../00-governance/architecture-principles.md)).
- Căn chỉnh với auditability ở cấp nghiệp vụ ([auditability](../07-quality-attributes/observability.md)) — cùng các event phục vụ điều tra vận hành; phần chồng lấn phạm vi được giải quyết ở đó, không trùng lặp.
- Các quy tắc retention, protection và access đối với audit data là các decision cần được ghi lại; không cố định gì ở đây.

## 11. Threat Model

- Sẽ ghi lại các threat cho từng trust boundary, mỗi threat có một owner và một mitigation decision hoặc một accepted risk.
- Các threat đã được discovery ngầm chỉ ra: coi việc kiểm soát email là identity (bị ID-005 từ chối), chấp nhận một invitation mà không kiểm soát email đích (bị INV-015 từ chối), privilege escalation vượt quá phạm vi được cấp (bị MEM-007 từ chối) — xem [security expectations](../07-quality-attributes/security.md).
- Phương pháp và nhịp thực hiện threat modeling chưa được quyết định; model phát triển khi các boundary và unit được quyết định.

## 12. Security Controls

- Sẽ catalogue các control và map từng control tới threat hoặc objective mà nó giải quyết, enforcement point của nó, và phương pháp verification của nó.
- Expectation về verification đi theo [testability](../07-quality-attributes/testability.md): control bảo vệ invariant cần bằng chứng tự động — đồng thời nhớ rằng một check đạt không tự nó là bằng chứng rằng một property luôn đúng ([AP-018](../00-governance/architecture-principles.md)).
- Catalogue hiện đang trống; các control xuất hiện khi các decision tạo ra chúng.

## 13. Xử lý Incident và Compromise (Incident and Compromise Handling)

- Sẽ ghi lại trách nhiệm và các đường đi cho detection, containment và recovery khi có security incident, bao gồm cả việc một unit, một tập credential hay một identity bị compromise.
- Phải trả lời: những đường revocation nào vẫn dùng được trong lúc compromise, và containment tôn trọng các [failure-isolation expectations](../07-quality-attributes/reliability.md) như thế nào ([AP-013](../00-governance/architecture-principles.md)).
- Thay đổi khẩn cấp đi theo emergency route trong [decision process](../00-governance/decision-process.md): thay đổi tối thiểu, có ghi lại, được review hồi tố.

## 14. Câu hỏi Mở (Open Questions)

- Complete revocation tức thời (MEM-013, ORG-013) được hiện thực hóa như thế nào giữa các unit deploy độc lập và các session, token đã được cấp phát?
- Authorization được enforce ở đâu khi một unit hiện thực hóa nhiều context — policy theo context hay theo unit, và ai sở hữu decision đó?
- Các unit xác thực lẫn nhau như thế nào, và identity context vượt qua unit boundary mà không trở thành một trust grant ngầm bằng cách nào?
- Những audit event nào là nghĩa vụ cấp Ecoma Platform versus cấp domain, xét theo authorization policy thuộc sở hữu domain (MEM-005, SD-063)?

## 15. Tài liệu Liên quan (Related Documents)

- [Security expectations](../07-quality-attributes/security.md) — các objective cấp discovery mà viewpoint này hiện thực hóa.
- [System Context](system-context.md) — nguồn catalogue trust boundary.
- [Data Architecture](data-architecture.md) — data classification mà protection requirement đi theo.
- [Integration Architecture](integration-architecture.md) — bảo mật cross-boundary cho integrations.
- [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md) — các identity và membership decision ràng buộc viewpoint này.
- [Architecture Principles](../00-governance/architecture-principles.md) (đặc biệt AP-008, AP-014), [Decision Process](../00-governance/decision-process.md).
- [System Architecture Review Checklist](../08-review-process/review-checklists/system-architecture-review.md).
