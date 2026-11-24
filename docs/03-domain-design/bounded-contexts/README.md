# Bounded Contexts

**Trạng thái:** Bản khung — chỉ mang tính định hướng cấu trúc; chưa chứa bất kỳ quyết định kiến trúc nào đã được review hoặc phê duyệt.

**Phạm vi:** Bounded Context là gì trong kiến trúc Ecoma, khi nào cần tạo một tài liệu context, và tài liệu đó phải chứa những gì. Bản khung này chưa định nghĩa Bounded Context nào của Ecoma.

## 1. Mục đích

Thư mục này sẽ lưu trữ định nghĩa của từng Ecoma Bounded Context: một thư mục cho mỗi context, chứa thông tin về ownership, trách nhiệm, ubiquitous language, invariants, và lifecycle. README này định nghĩa các quy tắc nền tảng mà mọi định nghĩa context phải tuân theo, để các định nghĩa riêng lẻ luôn có thể so sánh và review được. Nó cố ý không nêu tên context nào: theo [SD-010](../../02-domain-discovery/decisions/strategic-decisions.md), việc định nghĩa context chỉ bắt đầu sau khi giai đoạn discovery hoàn tất, và việc đặt tên một context trước thời điểm đó sẽ bỏ qua quy trình discovery và ra quyết định.

## 2. Bounded Context là gì

Bounded Context là ranh giới mà bên trong đó một domain model và Ubiquitous Language của nó luôn nhất quán, và bên trong đó một owner chịu trách nhiệm về model, policies, và lifecycle ([AP-005](../../00-governance/architecture-principles.md)). Bên trong ranh giới, một thuật ngữ chỉ có đúng một nghĩa; vượt qua ranh giới, cùng một từ có thể mang nghĩa khác, và chính việc translation — chứ không phải nghĩa dùng chung — kết nối hai bên.

Khi viết một định nghĩa context, cần nêu rõ ba sự phân biệt sau:

- **Domain boundary ≠ module boundary ≠ deployment boundary.** Một context cho biết model kết thúc ở đâu; một module boundary (thuộc quyền quản lý của [06-monorepo-architecture](../../06-monorepo-architecture/README.md)) cho biết code dependency được kiểm soát ở đâu; một deployment boundary cho biết cái gì được ship độc lập. Không ranh giới nào trong số này suy ra được các ranh giới còn lại.
- **Bounded Context ≠ Microservice** (xem mục 8).
- **Business Capability ≠ Bounded Context** (xem mục 7).

## 3. Khi nào tạo tài liệu Bounded Context

Tạo một định nghĩa context khi một quyết định về Bounded Context đang được đề xuất hoặc đã được đưa ra: một context mới, việc tách hoặc gộp một context hiện có, hoặc một thay đổi đáng kể đối với trách nhiệm hay ngôn ngữ của một context. Việc tạo, gộp, tách, hoặc ngừng hoạt động một context luôn yêu cầu một Decision Record theo [Decision Process](../../00-governance/decision-process.md) — tài liệu là design artifact, còn bản ghi là quyết định.

Không tạo tài liệu context cho một cấu trúc team, một thư mục code, một database, hay một "service" — đó là các cấu trúc kỹ thuật ([AP-004](../../00-governance/architecture-principles.md)). Nếu một tài liệu context được đề xuất vì một trong những lý do đó, đề xuất này mặc định là đáng nghi ngờ và phải tự chứng minh bằng thuật ngữ nghiệp vụ.

## 4. Ownership của Context

Mọi định nghĩa context nêu tên một owner chịu trách nhiệm về model, ngôn ngữ, lifecycle, và các published contracts của context, cùng với các stakeholder mà domain của họ có liên quan đến context đó. Ownership là một quyết định, không phải một sự ngẫu nhiên tổ chức: nếu owner chịu trách nhiệm thay đổi, đó là một quyết định cần được ghi nhận.

Trade-off cần nêu rõ ràng: việc chia ownership cho nhiều bên làm tan rã trách nhiệm giải trình; việc tập trung vào một bên tạo ra điểm nghẽn và một điểm tập trung duy nhất của policy. Một định nghĩa phải nêu tên một owner và có thể liệt kê các trách nhiệm được ủy quyền dưới owner đó.

## 5. Thông tin mô hình hóa bắt buộc

Một định nghĩa context phải cho phép người review trả lời được: context này sở hữu cái gì, rõ ràng không sở hữu cái gì, thuật ngữ nào mang nghĩa gì ở đây, invariants nào phải luôn được thỏa mãn, và nó quản lý những lifecycle nào. Tối thiểu, nó phải ghi nhận:

- Mục đích và trách nhiệm, bao gồm một tuyên bố rõ ràng về những gì nằm ngoài phạm vi (out-of-scope).
- Ubiquitous Language của context, bao gồm cả những thuật ngữ trùng với thuật ngữ của context khác nhưng khác ý nghĩa.
- Invariants và consistency boundary mà context bảo vệ.
- Lifecycle của các khái niệm mà nó sở hữu, bao gồm những gì xảy ra tại các end state của chúng.
- Dependency lên các context khác, tham chiếu context map liên quan.

Bộ file cho mỗi context được hoạch định trong [docs/README.md](../../README.md) — `context-definition.md`, `responsibilities.md`, `domain-model.md`, `invariants.md`, `lifecycle.md` bên trong thư mục `bounded-contexts/<context-name>/` — là **cấu trúc dự kiến**; chưa có file nào trong số này tồn tại, và việc tách nhỏ thành các file có thể được điều chỉnh khi context thực tế đầu tiên được viết, miễn là các thông tin nêu trên được ghi nhận ở đâu đó review được.

## 6. Quy ước đặt tên

Đặt tên context theo một khái niệm nghiệp vụ trong ubiquitous language của owner, không đặt theo công nghệ, tên team, hay deployment artifact. Dùng tên thư mục dạng kebab-case, ổn định, có thể sống sót qua các đợt refactoring; tên context xuất hiện trong các map, contracts, và định nghĩa event, vì vậy việc đổi tên một context là một thay đổi cấp quyết định với nghĩa vụ traceability, chứ không đơn thuần là đổi tên một file. Tránh đánh số các context (chúng không phải là một chuỗi) và tránh dùng tên pattern làm tên context — "Anti-Corruption Layer Context" mô tả một chiến thuật quan hệ, không phải một domain. Cho đến khi các context thực tế đầu tiên được đặt tên, không có quy ước nào ngoài các quy tắc này được cố định.

## 7. Quan hệ với Business Capabilities

Business Capability là những gì doanh nghiệp làm; Bounded Context là nơi một model giữ vững tính nhất quán. Quan hệ ánh xạ giữa chúng là many-to-many: một capability có thể trải rộng trên nhiều context, và một context có thể hiện thực một phần của nhiều capability ([Business Capability Map](../../02-domain-discovery/business-capability-map.md)). Do đó, capability map là đầu vào để xác định các ranh giới ứng viên — không bao giờ thay thế được chính quyết định ranh giới. Một định nghĩa context nên nêu rõ nó đóng góp vào những capability nào, nhưng không được tự nhận là "context cho capability X" nếu không lập luận về việc sở hữu model.

## 8. Quan hệ với Microservices

Bounded Context không phải là một Microservice ([AP-006](../../00-governance/architecture-principles.md), [AP-012](../../00-governance/architecture-principles.md)). Việc một context trở thành một service deployable riêng, chia sẻ một đơn vị deployment với các context khác, hay bị tách trên nhiều đơn vị là một quyết định system-architecture cân nhắc giữa coupling, scaling, failure isolation, security, nhịp release, và chi phí vận hành — được quyết định trong [05-system-architecture](../../05-system-architecture/README.md) (xem các bản khung integration architecture và deployment architecture của nó — có cấu trúc, nhưng chưa có quyết định nào được chấp nhận), tiêu thụ ranh giới được định nghĩa tại đây. Vì vậy, một định nghĩa context không được khẳng định hình thái deployment; tối đa nó chỉ ghi nhận các ràng buộc liên quan đến deployment (ví dụ: nhu cầu về consistency hay isolation) làm đầu vào cho quyết định sau đó.

## 9. Kỳ vọng khi Review

Các định nghĩa context được review theo [Bounded Context Review Checklist](../../08-review-process/review-checklists/bounded-context-review.md). Hãy kỳ vọng reviewer sẽ kiểm tra, trong số những điểm khác:

- Mục đích, các trách nhiệm trong phạm vi (in-scope), và tuyên bố rõ ràng về out-of-scope hiện diện và cụ thể.
- Ubiquitous language được định nghĩa, và các xung đột trùng tên khác nghĩa với các context khác được phân biệt.
- Ranh giới được suy ra từ trách nhiệm nghiệp vụ và tính nhất quán của model — không phải từ cấu trúc team, thư mục, hay database; việc gộp context chỉ để giảm số lượng service cũng bị chất vấn.
- Invariants và consistency boundary được xác định, ownership của model/data được nêu rõ, với projections được phân biệt với source of truth.
- Tác động tiến hóa được đánh giá: ảnh hưởng đến các context map, integration consumers, migration/compatibility khi tách hay gộp, và không giả định ánh xạ deployment 1:1.
- Phê duyệt: Domain Owner xác nhận trách nhiệm và ngữ nghĩa; Architecture Owner xác nhận tính nhất quán thiết kế; các context owner bị ảnh hưởng được tham vấn; một Decision Record ghi nhận thay đổi.

## Open Questions

- Mức độ chi tiết nào nên áp dụng cho tài liệu ubiquitous language của một context — một glossary đầy đủ cho mỗi context, hay chỉ những thuật ngữ trùng lặp hoặc khác biệt với [glossary cấp Ecoma Platform](../../02-domain-discovery/domain-glossary.md)?
- Những context chỉ tồn tại trong một domain duy nhất có cần một định nghĩa hiển thị ở cấp Ecoma Platform hay không, hay chỉ những context trải rộng trên nhiều domain mới cần?
- Một định nghĩa context nên ghi nhận các ràng buộc liên quan đến quyết định deployment sau này (mục 8) như thế nào mà không quyết định trước về deployment?

## 10. Tài liệu liên quan

- [Domain Design](../README.md) — định hướng và workflow cấp nhóm.
- [Context Maps](../context-maps/README.md) — ghi nhận context này liên quan đến các context khác như thế nào.
- [Domain Events](../domain-events/README.md) — các event do một context phát ra thuộc quyền sở hữu của context đó.
- [Integration Contracts](../integration-contracts/README.md) — một context expose và consume như thế nào.
- [Strategic Domain Model](../../02-domain-discovery/strategic-domain-model.md) — đầu vào discovery cho việc xác định ranh giới.
- [Business Capability Map](../../02-domain-discovery/business-capability-map.md) — các capability ứng viên; khác biệt với các context.
- [Architecture Principles](../../00-governance/architecture-principles.md) — AP-004, AP-005, AP-006 chi phối khu vực này.
- [Decision Process](../../00-governance/decision-process.md) — mọi việc tạo mới hoặc thay đổi context đều cần một bản ghi.
- [Bounded Context Review Checklist](../../08-review-process/review-checklists/bounded-context-review.md) — chuẩn review thực tế.
- [05-system-architecture](../../05-system-architecture/README.md) — nơi ánh xạ deployment được quyết định.
- [06-monorepo-architecture](../../06-monorepo-architecture/README.md) — nơi module boundary được quyết định.
