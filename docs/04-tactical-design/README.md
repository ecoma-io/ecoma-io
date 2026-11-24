# Tactical Design

- **Trạng thái:** Scaffold — chỉ có định hướng cấu trúc; chưa chứa quyết định hoặc quy ước ràng buộc nào đã được review hoặc phê duyệt.
- **Phạm vi:** Cách các model và application logic được thiết kế và cài đặt bên trong một Bounded Context: các quy ước ở cấp pattern dùng chung cho Ecoma, áp dụng theo từng context.

## 1. Mục đích

Nhóm tài liệu này định nghĩa BÊN TRONG một Bounded Context được thiết kế và cài đặt như thế nào: bộ từ vựng mô hình hóa, các pattern cho domain, application, persistence và transaction, cùng các ví dụ minh họa cụ thể. Đây là định hướng cấp pattern được chia sẻ trên tất cả các domain và context của Ecoma — nó không thiết kế bất kỳ context cụ thể nào và cũng không sở hữu bất kỳ context nào.

Theo [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md), các Bounded Context được chủ ý chưa định nghĩa — strategic discovery cố ý dừng lại trước khi gọi tên chúng. Do đó tactical design chỉ trở nên cụ thể bên trong một context, một khi context đó đã tồn tại và ranh giới của nó đã được chấp nhận. Trước thời điểm đó, các tài liệu này không ấn định bất cứ điều gì cụ thể: không có aggregate, entity hay event nào được đặt tên, không có công nghệ lưu trữ, không có framework. Điều chúng ấn định — và điều khiến chúng đáng có trước khi bất kỳ context nào tồn tại — là:

- Bộ từ vựng: team hiểu aggregate, entity, value object, domain event, application service, repository là gì, ở bất kỳ đâu trong Ecoma những từ này được dùng.
- Những câu hỏi mà một thiết kế context phải trả lời: identity semantics, consistency boundary, transaction scope, concurrency behavior, idempotency, failure modes.
- Lý lẽ về trade-off mặc định: pattern nào được ưu tiên khi có nhu cầu nào đã được chứng minh, và mỗi lần leo thang tốn kém bao nhiêu.

Một thiết kế context tuân theo các tài liệu này thừa hưởng bộ từ vựng sẵn sàng cho review và một checklist các câu hỏi đã được quyết định; một thiết kế context bỏ qua chúng sẽ phải phát minh lại cả hai, không nhất quán với mọi context khác của Ecoma. Cơ sở chung đó — chứ không phải bất kỳ quy tắc mô hình hóa cụ thể nào — chính là thứ nhóm tài liệu này đóng góp cho tính chọn lọc trong nhất quán của Ecoma: các quy ước khiến các context có thể so sánh được mà không khiến chúng giống hệt nhau ([AP-005](../00-governance/architecture-principles.md), [AP-003](../00-governance/architecture-principles.md)).

## 2. Phạm vi

Nhóm tài liệu này sở hữu:

- Quy ước mô hình hóa: bộ từ vựng dùng chung và các khu vực quy ước cho các building block (entity, value object, aggregate, aggregate root, domain service, domain event, repository, factory).
- Định hướng về domain pattern: thiết kế aggregate, thực thi invariant, mô hình hóa lifecycle và policy.
- Định hướng về application pattern: use case, command và query, application service, ranh giới authorization, tương tác với hệ thống bên ngoài, idempotency, xử lý lỗi.
- Định hướng về persistence pattern: ánh xạ aggregate vào storage ở cấp pattern, concurrency control, ràng buộc toàn vẹn, schema evolution, persistence của read model.
- Định hướng về transaction pattern: tính nhất quán trong và giữa các aggregate, và định hướng cho tính nhất quán giữa các context.
- Các ví dụ minh họa cụ thể các quy ước.

Nhóm tài liệu này không sở hữu:

- Những Bounded Context nào tồn tại, ranh giới, trách nhiệm và mối quan hệ của chúng — đó là domain design, nằm trong [Domain Design](../03-domain-design/README.md).
- Công nghệ, năng lực của platform, lựa chọn data store và deployment — đó là system architecture, nằm trong [System Architecture](../05-system-architecture/README.md).
- Bố cục repository và package, phân loại project, công cụ thực thi ranh giới — đó là monorepo architecture, nằm trong [Monorepo Architecture](../06-monorepo-architecture/README.md).

Cũng nằm ngoài phạm vi của nhóm này, dù các tactical pattern có tương tác với chúng: quyền sở hữu nghiệp vụ, ngữ nghĩa policy và lifecycle (do các quyết định của domain discovery và domain design sở hữu — xem [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md)); các mục tiêu chất lượng và cách xác minh chúng ([Reliability](../07-quality-attributes/reliability.md), [Security](../07-quality-attributes/security.md), [Performance](../07-quality-attributes/performance.md) và các tài liệu cùng nhóm); và bản thân quy trình governance ([Decision Process](../00-governance/decision-process.md)). Ở những chỗ các tài liệu này đề cập đến những vấn đề đó, chúng nêu định hướng và trỏ đến tài liệu sở hữu; không bao giờ tự quyết định.

## 3. Quan hệ với Domain Design

Domain design (03) định nghĩa ranh giới và contract: những Bounded Context nào tồn tại, mỗi context sở hữu và không sở hữu gì, và các context tích hợp với nhau ra sao. Tactical design (04) định nghĩa điều gì xảy ra bên trong một ranh giới: một context mô hình hóa aggregate của mình ra sao, điều phối use case ra sao, persist trạng thái ra sao, và giữ tính nhất quán ra sao.

Kết nối này chỉ chạy một chiều. Một tài liệu context ở 03 tham chiếu các tài liệu pattern này như bộ từ vựng và các mặc định mà nó xây dựng trên đó; các tài liệu pattern không bao giờ định nghĩa lại, làm yếu đi, hoặc rò rỉ qua một ranh giới context. Một thiết kế aggregate chỉ áp dụng cho model của một context. Một outbox hay saga chỉ áp dụng cho chiến lược tính nhất quán của một context. Bất cứ điều gì bắt buộc phải đúng giữa hai context — một event contract, một delivery guarantee, một khái niệm dùng chung — là contract do 03 sở hữu, không phải tactical pattern, ngay cả khi cả hai bên đều cài đặt nó bằng các pattern của nhóm này.

Giữ ba ranh giới này tách biệt ([AP-006](../00-governance/architecture-principles.md)): ranh giới domain (do 03 sở hữu) không phải là ranh giới module (do 06 sở hữu), và cũng không phải là ranh giới deployment (do 05 sở hữu). Các tactical pattern được phát biểu sao cho có thể áp dụng ở bất kỳ cấp độ chi tiết nào trong số đó; chúng không quyết định bất kỳ ranh giới nào.

Một minh họa cụ thể cho quan hệ một chiều: nếu hai context trong tương lai phải thống nhất về thời điểm một order của họ trở nên hiển thị với context kia, sự thống nhất đó — event, ngữ nghĩa của nó, delivery guarantee của nó — là một contract của 03, dù context sinh ra event cài đặt việc xuất bản bằng outbox pattern của nhóm này và context tiêu thụ cài đặt handler của mình bằng định hướng inbox và idempotency của nhóm này. Nếu contract thay đổi, thay đổi đó là một quyết định của 03; các cài đặt tactical thích ứng mà không cần tranh luận lại các pattern của chúng.

## 4. Triết lý Tactical Design

Sáu lập trường dẫn dắt nhóm tài liệu này. Chúng là triết lý định hướng — lập trường mà các tài liệu của nhóm này lập luận dựa trên đó — chứ không phải giấy phép để ra lệnh các cài đặt cụ thể.

- **Rich Domain Model.** Behavior sống cùng với dữ liệu sở hữu nó, thay vì trong các cấu trúc dữ liệu anemic với toàn bộ logic tích tụ trong các service thủ tục. Áp dụng chọn lọc theo [AP-009](../00-governance/architecture-principles.md): DTO, projection và read model có thể giữ đơn giản; chỉ những khái niệm sở hữu các quy tắc đáng được bảo vệ mới được trang bị behavior.
- **Invariants được thực thi tại ranh giới chịu trách nhiệm.** Các business invariant được bảo vệ bởi phần model sở hữu chúng ([AP-008](../00-governance/architecture-principles.md)), không bao giờ chỉ bởi validation ở UI hay API — bất kỳ entry point nào khác (một background job, một integration, một client thứ hai) phải chạm vào cùng cơ chế thực thi đó. Application layer điều phối; nó không trở thành nơi business rules lặng lẽ sinh sống.
- **Clean Architecture.** Domain logic độc lập với framework, database và transport ([AP-010](../00-governance/architecture-principles.md)). Dependency hướng về policy ổn định; infrastructure hiện thực hóa các port mà các lớp trong định nghĩa. Các lớp tồn tại vì trách nhiệm thực sự, không phải để giữ hình thức.
- **Logical Command/Query separation.** Command thay đổi trạng thái và bảo vệ invariant; query trả về dữ liệu mà không có side effect nghiệp vụ ([AP-011](../00-governance/architecture-principles.md)). Việc tách trách nhiệm này là mặc định ở application layer — còn tách model và tách infrastructure thì không.
- **Full CQRS chỉ khi có lý do rõ ràng.** Tách read model và write model — cùng với eventing, synchronization và lượng storage phát sinh — chỉ khi một nhu cầu đã được chứng minh biện minh cho chi phí. Các lý do điển hình: read và write cần scale độc lập, hình dạng của read thực sự không khớp write model, hoặc read model được dẫn dắt bởi event từ các context khác. Chi phí là thực: eventual consistency lộ ra cho consumer, model trùng lặp và logic synchronization, nhiều infrastructure hơn và nhiều failure mode hơn. Không có lý do đó, một model với các handler được tách về mặt logic là mặc định.
- **Pattern là công cụ, không phải checklist.** Không pattern nào của nhóm này được áp dụng theo nghi thức. Cấu trúc đơn giản nhất bảo vệ được các invariant thực sự hiện diện là thắng; leo thang lên một pattern nặng hơn đòi hỏi nhu cầu đã được chứng minh và một chi phí đã được chấp nhận và ghi nhận; các lệch khỏi mặc định được ghi nhận kèm lý do để có thể review thay vì bị chôn vùi trong code.

Sáu lập trường này khớp vào nhau: một rich model chỉ hoạt động nếu invariant thực sự nằm ở ranh giới của model, điều này chỉ giữ được nếu application layer không hút các quy tắc vào việc điều phối, và điều này chỉ giữ được sự trong sạch nếu dependency hướng vào trong. Full CQRS là điểm gãy phổ biến của chuỗi này — khi model anemic, hình dạng read trôi dạt khỏi write model, và việc tách model trở thành workaround cho một vấn đề mô hình hóa. Vì vậy reviewer đọc các lập trường này cùng nhau, không phải như sáu công tắc độc lập.

## 5. Cấu trúc tài liệu

- [Modeling Conventions](modeling-conventions.md) — bộ từ vựng dùng chung và các khu vực quy ước cho các tactical building block: entity, value object, aggregate, aggregate root, domain service, domain event, repository, factory; cùng các quy ước về đặt tên và thực thi invariant. Nó định nghĩa mỗi khu vực quy ước phải quyết được điều gì, chứ không phải các quy tắc đã quyết.
- [Domain Patterns](domain-patterns.md) — định hướng cho thiết kế phía domain của một context: lựa chọn entity/value object, ranh giới aggregate và tính nhất quán của chúng, domain service, domain event, policy và specification, mô hình hóa lifecycle, thực thi invariant.
- [Application Patterns](application-patterns.md) — định hướng cho application layer: thiết kế use case, xử lý command và query, application service, ranh giới authorization, xử lý domain event, tương tác với hệ thống bên ngoài, idempotency, xử lý lỗi.
- [Persistence Patterns](persistence-patterns.md) — định hướng cấp pattern cho việc ánh xạ aggregate vào storage: trách nhiệm của repository, tách domain model/persistence model, concurrency và locking, ràng buộc toàn vẹn, schema evolution, persistence của read model. Cố ý không phải một lựa chọn database — điều đó thuộc về System Architecture.
- [Transaction Patterns](transaction-patterns.md) — định hướng cho tính nhất quán: nguyên tắc transaction boundary, local transaction, tính nhất quán cross-aggregate và cross-context, các lưu ý về distributed transaction, saga, outbox/inbox, idempotency, retry và compensation, khôi phục sau lỗi.
- [Examples](examples/README.md) — các ví dụ minh họa cụ thể các quy ước. Chưa có ví dụ nào tồn tại; README của examples định nghĩa cấu trúc kỳ vọng và chuẩn chất lượng cho đóng góp đầu tiên.

Thứ tự đọc theo cấu trúc: README này để nắm triết lý và phạm vi, sau đó [Modeling Conventions](modeling-conventions.md) để nắm bộ từ vựng mà bốn tài liệu pattern kia dùng, rồi tài liệu pattern tương ứng với layer đang xem xét. Khi các tài liệu chồng lấn về một chủ đề — chẳng hạn idempotency xuất hiện trong ba tài liệu — phần sở hữu layer đang xem xét là phần chi phối (kỳ vọng của use case trong [Application Patterns](application-patterns.md), lưu trữ deduplication state trong [Persistence Patterns](persistence-patterns.md), lý lẽ tính nhất quán trong [Transaction Patterns](transaction-patterns.md)); các tài liệu khác nhường theo. Các điểm chồng lấn được cross-reference, không bao giờ được phát biểu lại thành quy tắc mới.

## 6. Định hướng áp dụng pattern

Các team tự quyết định pattern nào áp dụng cho một context cụ thể, với bộ tài liệu này là định hướng — chứ không phải thay thế quyết định của họ. Lập trường mặc định là: bắt đầu với cấu trúc đơn giản nhất bảo vệ được các invariant của context — plain entity và value object, một transaction cho mỗi command, query trực tiếp, optimistic concurrency — và chỉ leo thang khi nhu cầu được chứng minh. Thang leo thang, đại khái: phần model giàu behavior hơn khi invariant xuất hiện; một chiến lược nhất quán rộng hơn khi một quy tắc thực sự trải dài qua nhiều aggregate; một outbox khi mất event là chuyện đáng quan ngại; saga khi một quy trình trải qua các bước không thể dùng chung một transaction; read model tách riêng khi hình dạng read hoặc quy mô đòi hỏi. Mỗi bậc đều có chi phí; thiết kế nêu rõ chi phí nó chấp nhận.

Việc leo thang và hạ cấp đều được ghi nhận. Một thiết kế context nêu rõ nó áp dụng những pattern nào, lệch khỏi những mặc định nào, và tại sao — để lý lẽ có thể review thay vì bị chôn vùi trong code. Các lệch khỏi một quyết định ở trạng thái Accepted chịu review theo [Review Workflow](../08-review-process/review-workflow.md); các lệch khỏi các mặc định pattern này tuân theo cùng kỷ luật về lý lẽ được ghi nhận, dù bản thân các mặc định hiện mới chỉ là định hướng scaffold.

Hai kiểu áp dụng sai cần tránh, theo cả hai chiều: áp dụng một pattern nặng khi chưa có nhu cầu được chứng minh (vấn đề nghi thức của mục 8), và từ chối leo thang vì "chúng tôi vẫn luôn làm đơn giản" khi contention, quy mô hoặc một contract cross-context thực sự đòi hỏi. Thước đo luôn là bằng chứng — một tỉ lệ contention đã đo được, một sự lệch read-shape có thật, một contract yêu cầu delivery guarantee — chứ không phải sở thích, tiền lệ, hay mốt của pattern.

## 7. Trách nhiệm mô hình hóa và cài đặt

Sự phân chia trách nhiệm ra quyết định:

- Các tài liệu pattern này ấn định bộ từ vựng dùng chung và các mặc định cùng trade-off của chúng. Không gì ở đây quyết định bất cứ điều gì cụ thể cho Ecoma; một tài liệu pattern mà bắt đầu gọi tên các aggregate của Ecoma hay chọn storage là đã vượt phạm vi.
- Thiết kế theo từng context — các tài liệu bounded-context dưới Domain Design, một khi được tạo ra — đưa ra các lựa chọn cụ thể: tên của các aggregate, entity và event, ranh giới được chọn, pattern được áp dụng, các lệch được khai báo và lý do của chúng. Chưa có tài liệu thiết kế theo context nào tồn tại.
- Cài đặt phải nhất quán với thiết kế đã được chấp nhận của context. Ở nơi cài đặt cho thấy thiết kế sai, thay đổi quay lại qua thiết kế và review thay vì trôi lặng đi — code lệch khỏi thiết kế của nó là một discrepancy cần xử lý, không phải một sự kiện viết lại quyết định ([Decision Process](../00-governance/decision-process.md)).
- Các checkpoint review cho các artifact tactical design theo [Review Workflow](../08-review-process/review-workflow.md); trạng thái quyết định theo [Decision Process](../00-governance/decision-process.md) — Draft là đang viết, chỉ Accepted mới có hiệu lực.

Trong thực tế, điều này có nghĩa là lộ trình của một contributor là: đọc các tài liệu pattern để có từ vựng và các mặc định → đọc (hoặc viết, nếu chưa có) thiết kế của context ở 03 cho các lựa chọn cụ thể → cài đặt trong khuôn khổ đó → mở một review có thể trỏ đến cả hai. Một thay đổi chỉ chạm vào chi tiết cài đặt bên trong một thiết kế đã được chấp nhận không cần decision record mới; một thay đổi làm thay đổi một consistency boundary, một ranh giới aggregate, hoặc một contract của context thì có ([Decision Process](../00-governance/decision-process.md), mục về khi nào cần decision record).

## 8. Anti-patterns

Các anti-pattern cấp nhóm mà reviewer để mắt tới, cùng tín hiệu quan sát được của chúng:

- **Anemic domain model.** Entity và aggregate chỉ giữ dữ liệu trong khi logic tích tụ trong service; tín hiệu là các quy tắc domain mà người đọc phải dựng lại từ code service vì model không thể hiện quy tắc nào.
- **Edge-only invariants.** Quy tắc chỉ được thực thi ở rìa UI hoặc API; tín hiệu là một entry point thứ hai — job, integration, script — có thể vi phạm điều entry point thứ nhất chặn.
- **Ritual patterns.** CQRS ở khắp nơi, tách micro-aggregate, một event cho mỗi setter, thêm các lớp cho có hình thức ([AP-009](../00-governance/architecture-principles.md): không abstraction chỉ tồn tại để đáp ứng một pattern); tín hiệu là một pattern mà người sở hữu nó không thể nêu invariant nó bảo vệ hay chi phí nó chấp nhận.
- **Shared kernel creep.** Quy ước mô hình hóa hoặc thư viện dùng chung lặng lẽ tích tụ business rules thuộc về một context; tín hiệu là một component dùng chung mà thay đổi nó buộc hai context phải deploy cùng nhau.
- **Persistence rò rỉ vào domain model.** Kiểu dữ liệu của persistence framework, quan tâm đến schema, hoặc cấu trúc hình dạng storage trong các domain object; tín hiệu là một thay đổi storage buộc phải sửa domain model ([AP-010](../00-governance/architecture-principles.md)).

## 9. Kỳ vọng khi review

Reviewer của các tài liệu tactical design và pull request kiểm tra, theo [Tactical Design Review Checklist](../08-review-process/review-checklists/tactical-design-review.md):

- Ngữ nghĩa domain: thiết kế phản ánh ubiquitous language của context; identity và equality là tường minh; quy tắc nằm ở nơi quyền sở hữu đúng; không có quan ngại framework hay persistence bên trong domain policy; không có abstraction chỉ tồn tại vì pattern.
- Aggregate và invariant: mỗi aggregate có một consistency boundary biện minh được, bảo vệ các invariant của chính nó; ranh giới được biện minh bởi invariant, không phải bởi quan hệ giữa các object hay các bảng; các quy tắc cross-aggregate có một chiến lược nhất quán tường minh; hành vi của các command chạy đồng thời được định nghĩa.
- Application và service: application service điều phối chứ không sở hữu business rules; domain service chỉ xuất hiện khi có lý do; authorization và precondition được kiểm tra ở ranh giới đúng; event thể hiện các diễn biến nghiệp vụ có ý nghĩa.
- Persistence và transaction: abstraction repository phản ánh nhu cầu của domain/application; transaction boundary được khai báo; concurrency control và locking được cân nhắc; idempotency bao phủ các operation được retry hoặc redeliver; migration và compatibility được cân nhắc; không có distributed transaction được giả định sẵn.
- CQRS và xác minh: trách nhiệm command/query rõ ràng; full CQRS chỉ xuất hiện khi có lý do được khai báo; read model có nguồn và ngữ nghĩa cập nhật; eventual consistency hiển thị cho consumer; invariant, concurrency và failure path được chứng minh bằng test.

Một reviewer cũng phải có thể truy vết từng lựa chọn mô hình hóa về lý lẽ của nó — một aggregate bảo vệ invariant nào, một read model phục vụ nhu cầu nào, một saga chấp nhận chi phí nào. [Tactical Design Review Checklist](../08-review-process/review-checklists/tactical-design-review.md) được phát biểu như các phép kiểm tra đối chiếu với thiết kế, không phải đối chiếu với các tài liệu pattern này; một thiết kế thỏa mãn các quyết định đã được chấp nhận của context là tuân thủ, kể cả khi nó lệch khỏi một mặc định pattern, miễn là sự lệch đó được ghi nhận. Quy trình và thẩm quyền review theo [Review Policy](../08-review-process/review-policy.md). Hai phép kiểm tra ranh giới khung tất cả những điều trên: không artifact tactical nào được phép quyết một câu hỏi do nhóm khác sở hữu (ranh giới context, công nghệ storage, bố cục module), và không artifact tactical nào được phép trình bày một câu hỏi đang mở như thể đã quyết — ở chỗ các tài liệu của nhóm này nói "chưa quyết định", một review coi thiết kế tự quyết câu hỏi đó là vượt thẩm quyền, trừ khi nó đi qua quy trình quyết định.

## 10. Tài liệu liên quan

- Domain Design (ranh giới context và contract): [Domain Design](../03-domain-design/README.md)
- System Architecture (công nghệ, dữ liệu, deployment): [System Architecture](../05-system-architecture/README.md)
- Monorepo Architecture (bố cục module, thực thi ranh giới): [Monorepo Architecture](../06-monorepo-architecture/README.md)
- [Architecture Principles](../00-governance/architecture-principles.md) — đặc biệt là AP-008 (invariant tại ranh giới chịu trách nhiệm), AP-009 (rich domain model, chọn lọc), AP-010 (clean architecture), AP-011 (CQRS theo nhu cầu)
- [Tactical Design Review Checklist](../08-review-process/review-checklists/tactical-design-review.md)
- [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md) — kết quả discovery mà tactical design xây dựng trên đó; các Bounded Context được chủ ý chưa định nghĩa
- Domain Discovery overview: ../02-domain-discovery/README.md (chưa được tạo)
- [Decision Process](../00-governance/decision-process.md) — bộ từ vựng trạng thái chi phối điều gì trong các tài liệu này có hiệu lực
