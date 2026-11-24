# Domain Design

**Trạng thái:** Scaffold — chỉ có định hướng cấu trúc; chưa chứa quyết định kiến trúc nào đã được review hoặc phê duyệt.

**Phạm vi:** Cách Ecoma định nghĩa Bounded Context, mối quan hệ giữa chúng, Domain Event, và integration contract — tầng thiết kế cấp domain nằm giữa Strategic Domain Discovery và thiết kế tactical/hệ thống.

## 1. Mục đích

Domain Design chuyển kết quả của Strategic Domain Discovery — business subject, business ownership, và các ranh giới nghiệp vụ đã được thiết lập trong [02-domain-discovery](../02-domain-discovery/strategic-domain-model.md) — thành các domain model với ranh giới rõ ràng, tường minh. Nó trả lời câu hỏi "model nào sở hữu khái niệm nào, và model này kết thúc, model khác bắt đầu ở đâu", với ranh giới được suy ra từ trách nhiệm nghiệp vụ thay vì từ code, team, hay cấu trúc database hiện có ([AP-004](../00-governance/architecture-principles.md)).

Ở tầng này, một "domain model" nghĩa là tập hợp các khái niệm mà một context sở hữu được mô tả lại, các invariant mà nó bảo vệ, các lifecycle mà nó chi phối, và ngôn ngữ mà nó sử dụng — được ghi nhận để có thể review và tranh luận, từ lâu trước khi có bất kỳ dòng code nào.

Cụ thể, mọi artifact trong nhóm này tồn tại để trả lời một trong ba câu hỏi: trách nhiệm của một model bắt đầu và kết thúc ở đâu, các model với ngôn ngữ khác nhau cộng tác với nhau ra sao, và một phía của giao dịch được phép dựa vào điều gì. Những artifact không trả lời được câu hỏi nào trong ba câu hỏi đó thì không thuộc nhóm này.

Nhóm này không phải là sự diễn đạt lại của discovery. Discovery thiết lập business sở hữu điều gì và những ranh giới nghiệp vụ nào có hiệu lực; Domain Design quyết định các kết luận đó kết tinh thành Bounded Context và mối quan hệ của chúng như thế nào, đây là một hoạt động thiết kế riêng biệt và đòi hỏi quy trình review riêng.

Một ranh giới có thể đúng về mặt nghiệp vụ ở tầng discovery mà vẫn bị vẽ sai khi là ranh giới model — việc thu hẹp khoảng cách đó chính là công việc được thực hiện tại đây.

Nó cũng đồng thời không phải là thiết kế tactical. Cách một model được cấu trúc bên trong một context — Aggregate, Entity, xử lý transaction — thuộc về [04-tactical-design](../04-tactical-design/README.md).

Việc làm đúng tầng strategic trước tầng tactical là quan trọng, bởi vì các quyết định tactical thì rẻ để sửa đổi bên trong một context được định giới tốt, và đắt để sửa đổi vượt ra ngoài một context bị định giới sai.

## 2. Phạm vi

Nhóm này sở hữu đúng bốn loại nội dung:

- **Bounded Context** ([bounded-contexts/](bounded-contexts/README.md)) — cho mỗi context: định nghĩa của nó, một owner chịu trách nhiệm duy nhất, trách nhiệm và tuyên bố tường minh về những gì ngoài phạm vi, Ubiquitous Language của nó, các invariant mà nó bảo vệ, và các lifecycle mà nó chi phối.
  - Câu hỏi mà một định nghĩa context phải trả lời: context này sở hữu điều gì, cố ý không sở hữu điều gì, và những quy tắc đúng đắn nào không bao giờ được phá vỡ bên trong nó.
- **Context Map** ([context-maps/](context-maps/README.md)) — các mối quan hệ logic giữa các context: ai ảnh hưởng đến ai, nghĩa vụ của mỗi phía, chỗ nào cần dịch model và ai sở hữu việc đó.
  - Câu hỏi mà một map phải trả lời: nếu context upstream thay đổi model của nó, ai bị ảnh hưởng và họ được quyền kỳ vọng điều gì.
- **Domain Event** ([domain-events/](domain-events/README.md)) — các business fact mà một context công bố ra bên ngoài, ý nghĩa của chúng, ownership, định danh, correlation, và quy tắc tiến hóa.
  - Câu hỏi mà một định nghĩa event phải trả lời: business fact nào đã xảy ra, ai sở hữu ý nghĩa của nó, và consumer được và không được dựa vào điều gì.
- **Integration Contract** ([integration-contracts/](integration-contracts/README.md)) — các thỏa thuận tường minh chi phối tương tác giữa các context: semantics, tính tương thích, hành vi khi lỗi, kỳ vọng về authorization, và correlation.
  - Câu hỏi mà một contract phải trả lời: hai context được sở hữu độc lập làm thế nào để thay đổi mà không phá vỡ nhau.

Nhóm này **không** sở hữu:

- Các tactical design pattern được áp dụng bên trong một context (04-tactical-design) — pattern được chọn bên trong một ranh giới đã được chấp nhận, không phải như một phương tiện để vẽ ranh giới.
- Các quyết định về công nghệ, container, và deployment (05-system-architecture) — 05 tiêu thụ ranh giới; nó không bao giờ định nghĩa chúng.
- Ranh giới repository, module, và dependency (06-monorepo-architecture) — ranh giới module là một loại ranh giới thứ ba với cơ chế được tool thực thi riêng.
- Bản thân các business fact — được thiết lập ở thượng nguồn trong 02-domain-discovery, không được quyết định lại ở đây.

Một quy tắc một chiều được áp dụng cho tất cả những điều trên: khi công việc ở khu vực downstream có vẻ đòi hỏi một thay đổi ranh giới, thay đổi được đề xuất và chấp nhận tại đây trước, sau đó mới phản ánh xuống downstream — không bao giờ được âm thầm quyết định trong một tài liệu tactical, hệ thống, hay repository.

Chi phí của kỷ luật này là vòng phản hồi chậm hơn. Chi phí của việc bỏ qua nó là những ranh giới trôi dạt cho đến khi chúng không còn mô tả điều gì có thật.

## 3. Quan hệ với các khu vực kiến trúc khác

- **Đầu vào từ discovery (02-domain-discovery).** [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md) và [Business Capability Map](../02-domain-discovery/business-capability-map.md) là các đầu vào chính: chúng thiết lập business subject, ownership, và các ranh giới domain tường minh đã được chốt.
  - Ví dụ về các ranh giới đã chốt mà ranh giới context ứng viên phải tôn trọng: Account vs Consumer Organization vs Provider, Provider Identity vs Provider Qualification, Provider Transformation vs Operations Migration, Authentication vs Authorization.
  - Theo [SD-010](../02-domain-discovery/decisions/strategic-decisions.md), định nghĩa Bounded Context chỉ bắt đầu sau khi discovery hoàn tất.
  - README cấp nhóm cho discovery chưa tồn tại (`docs/02-domain-discovery/README.md` — chưa được tạo); cho đến khi có nó, [domain glossary](../02-domain-discovery/domain-glossary.md) và [Discovery Backlog](../02-domain-discovery/discovery-backlog.md) là các điểm vào thực tế của nhóm đó.
- **04-tactical-design** ([README](../04-tactical-design/README.md)) định nghĩa các pattern mô hình hóa và triển khai được áp dụng _bên trong_ một context; nhóm này định nghĩa chính các context và mối quan hệ của chúng. Một định nghĩa context không được quy định các tactical pattern, và các tài liệu tactical không được định nghĩa lại hoặc âm thầm mở rộng ranh giới.
  - Khi công việc tactical phát hiện một ranh giới là sai, việc sửa chữa được điều hướng quay lại qua nhóm này thay vì bị hấp thụ như một "điều chỉnh pattern".
- **05-system-architecture** ([README](../05-system-architecture/README.md)) ánh xạ các context lên container, deployment unit, và công nghệ. Nó tiêu thụ các ranh giới được định nghĩa tại đây và không bao giờ định nghĩa chúng.
  - Nếu kiến trúc hệ thống cần một ranh giới khác, thay đổi được đề xuất và chấp nhận tại đây trước, sau đó mới phản ánh vào 05. Dependency chạy một chiều theo thiết kế — nếu không, mọi tiện lợi về deployment đều trở thành một quyết định ranh giới được đưa ra dưới áp lực hạ tầng.
- **06-monorepo-architecture** ([README](../06-monorepo-architecture/README.md)) sở hữu ranh giới module và repository — code nằm ở đâu và dependency nào được tool thực thi.
  - Ranh giới module khác với cả ranh giới domain và ranh giới deployment: một context có thể trải qua nhiều module, và một module có thể chứa các phần của nhiều context.
  - Ranh giới module có thể được thực thi trong CI; ranh giới domain được thực thi bằng review và kỷ luật quyết định — đó là lý do chúng phải được ghi nhận tại đây thay vì được suy ra từ cây repository.
- **07-quality-attributes** — README của nhóm này chưa tồn tại (`docs/07-quality-attributes/README.md` — chưa được tạo), nhưng các tài liệu thuộc tính riêng lẻ là đầu vào khi một thiết kế chạm đến consistency, security, observability, hoặc testability.
  - Ví dụ tương tác: kỳ vọng consistency trong một [context map](context-maps/README.md) gặp các mục tiêu [reliability](../07-quality-attributes/reliability.md); kỳ vọng authorization của contract gặp [security](../07-quality-attributes/security.md); quy tắc correlation của event gặp [observability](../07-quality-attributes/observability.md).
- **08-review-process** cung cấp chuẩn review cho các artifact của nhóm này: các checklist [Bounded Context](../08-review-process/review-checklists/bounded-context-review.md) và [Context Map](../08-review-process/review-checklists/context-map-review.md), [Review Policy](../08-review-process/review-policy.md), và các quy tắc thẩm quyền trong [review-authority](../08-review-process/review-authority.md).
  - Mọi artifact được chấp nhận trong nhóm này đã vượt qua review tương ứng.
- **Phân biệt tường minh — ranh giới domain vs ranh giới deployment.** Ranh giới domain nói rằng model và ownership của nó kết thúc ở đâu. Ranh giới deployment nói rằng đoạn code nào chạy như một unit được deploy độc lập.
  - Một Bounded Context có thể bị tách qua nhiều deployment unit hoặc gộp với các context khác thành một; ánh xạ đó là một quyết định của 05, cân nhắc coupling, scaling, failure isolation, security, nhịp release, và chi phí vận hành ([AP-006](../00-governance/architecture-principles.md), [AP-012](../00-governance/architecture-principles.md)).
  - Nó không bao giờ được suy ngược lại làm định nghĩa của context: "nó được deploy như một service" không phải là bằng chứng cho sự tồn tại của một context.

## 4. Các nguyên tắc Domain Design

Các nguyên tắc sau chi phối toàn bộ công việc trong nhóm này. Chúng mang tính định hướng, không phải quy tắc blanket: mỗi nguyên tắc đều bao gồm một đánh đổi mà một thiết kế cụ thể phải nêu tường minh thay vì giả định cho qua.

1. **Ownership domain rõ ràng.** Mỗi Bounded Context có một owner xác định được, chịu trách nhiệm về model, policy, lifecycle, và các contract đã công bố của nó. Ownership mà không có owner được nêu tên là nguyên nhân gốc phổ biến nhất của sự xói mòn ranh giới ([AP-004](../00-governance/architecture-principles.md)).
2. **Mỗi Bounded Context có Ubiquitous Language riêng.** Một thuật ngữ được chia sẻ giữa hai context không đảm bảo một ý nghĩa chung; mỗi context định nghĩa các thuật ngữ của nó mang ý nghĩa gì bên trong ranh giới của nó ([AP-005](../00-governance/architecture-principles.md)). Chi phí là phải dịch ở mọi điểm giao — được chấp nhận một cách có chủ đích, vì phương án thay thế là một model bị kéo giãn mà không còn nghĩa chính xác điều gì cả.
3. **Domain model được sở hữu bởi domain của nó, không được chia sẻ theo mặc định.** Không entity, schema, hay mảnh model nào được chia sẻ giữa các context, trừ khi một quyết định đã review thiết lập ownership chia sẻ với các contract tường minh ([AP-005](../00-governance/architecture-principles.md), [AP-015](../00-governance/architecture-principles.md)). Đánh đổi là có thật: chia sẻ giảm trùng lặp trong ngắn hạn nhưng ghép chặt các lifecycle và làm mờ trách nhiệm; mặc định chia sẻ chính là failure mode mà quy tắc này tồn tại để ngăn chặn.
4. **Một Business Capability không phải là một Bounded Context.** [Business Capability Map](../02-domain-discovery/business-capability-map.md) liệt kê business làm gì; một capability có thể trải qua nhiều context, và một context có thể hiện thực các phần của nhiều capability. Ánh xạ capability sang context là một kết quả thiết kế, không bao giờ là một đẳng thức — việc suy ra context bằng cách chép danh sách capability một-một là một anti-pattern được biết đến mà nhóm này tường minh bác bỏ.
5. **Một Bounded Context không phải là một Microservice.** Việc một context có ánh xạ lên các deployable unit hay không, và như thế nào, là một quyết định kiến trúc hệ thống cân nhắc coupling, scaling, failure isolation, và chi phí vận hành — không phải là một hệ quả tự nhiên của việc context tồn tại ([AP-006](../00-governance/architecture-principles.md), [AP-012](../00-governance/architecture-principles.md)). Việc tách deployment unit theo từng context chỉ "vì ranh giới tồn tại" là trả chi phí distributed system mà không có lợi ích nào được chứng minh.
6. **Các domain không được chia sẻ domain model chỉ vì thuật ngữ giống nhau.** Domain LLM và Domain GPU sở hữu các domain model khác nhau theo quyết định ([SD-007](../02-domain-discovery/decisions/strategic-decisions.md), đọc theo SD-059); một thuật ngữ được tái sử dụng giữa hai domain (Organization, Membership, Offering) không tự động là một khái niệm, trừ khi ownership cấp Ecoma Platform đã được quyết định tường minh ([AP-001](../00-governance/architecture-principles.md), [AP-003](../00-governance/architecture-principles.md)). Việc thống nhất model vì sự tiện lợi của từ vựng chính là cách mà tính tự chủ của domain bị xói mòn.
7. **Integration phải tôn trọng các ranh giới ownership và consistency.** Tương tác giữa các context diễn ra qua các contract tường minh, có owner; không context nào được với tay vào dữ liệu nội bộ của context khác hay ghi dữ liệu của domain khác, và kỳ vọng consistency được phát biểu ra, không được giả định ([AP-007](../00-governance/architecture-principles.md), [AP-015](../00-governance/architecture-principles.md)). Truy cập database trực tiếp hay schema chia sẻ giữa các context không phải là contract — đó là coupling né qua review.

## 5. Cấu trúc tài liệu

Bốn thư mục con tồn tại dưới nhóm này, mỗi thư mục có README định hướng riêng:

- [bounded-contexts/](bounded-contexts/README.md) — định nghĩa theo từng context: ownership, trách nhiệm, Ubiquitous Language, invariant, lifecycle; cùng với các quy tắc nền mà mọi định nghĩa context phải thỏa mãn.
- [context-maps/](context-maps/README.md) — ghi nhận về mối quan hệ giữa các context: vai trò, nghĩa vụ, translation, ownership dữ liệu và consistency theo từng quan hệ.
- [domain-events/](domain-events/README.md) — Domain Event là gì, ownership của event, định danh và correlation, versioning, và kỳ vọng consistency.
- [integration-contracts/](integration-contracts/README.md) — một tài liệu contract phải nêu những gì: semantics, tiến hóa và tính tương thích, xử lý lỗi, authorization, observability.

Hiện tại chỉ có bốn README này tồn tại; các file `.gitkeep` trong mỗi thư mục là placeholder, không phải nội dung.

Cấu trúc được hoạch định trong [docs/README.md](../README.md) — một thư mục `bounded-contexts/<context-name>/` cho mỗi context chứa `context-definition.md`, `responsibilities.md`, `domain-model.md`, `invariants.md`, và `lifecycle.md`, một `domain-events/event-catalog.md`, và các file map và contract được đặt tên — là **cấu trúc tương lai theo kế hoạch**; không file nào trong số đó tồn tại, và việc tạo ra chúng tuân theo quy trình bên dưới một khi discovery hoàn tất.

Khi băn khoăn về việc một phần nội dung thuộc về đâu, phép thử là câu hỏi nó trả lời: các câu hỏi ranh giới và ownership thuộc về đây; cấu trúc bên trong model thuộc về 04; công nghệ thuộc về 05; bố cục code thuộc về 06.

## 6. Quy trình thiết kế

Công việc trong nhóm này diễn ra theo thứ tự sau; mỗi bước tiêu thụ bước trước đó và có kỳ vọng review riêng.

1. **Discovery hoàn tất** (02-domain-discovery). Theo [SD-010](../02-domain-discovery/decisions/strategic-decisions.md), định nghĩa Bounded Context đến sau discovery; các câu hỏi nghiệp vụ còn mở được theo dõi trong [Discovery Backlog](../02-domain-discovery/discovery-backlog.md) và không được âm thầm xử lý bên trong một tài liệu thiết kế.
2. **Xác định ranh giới ứng viên.** Suy ra các ranh giới ứng viên từ strategic domain model, capability map, và business lifecycle; ghi nhận chúng như các ứng viên kèm lý do, không phải như các cam kết — một ứng viên sống sót sau khi tiếp xúc với một mô tả lifecycle thật đáng giá hơn nhiều so với một ứng viên chỉ sống sót trên bảng trắng.
3. **Định nghĩa Bounded Context.** Với mỗi ứng viên được chấp nhận, lập một định nghĩa context theo [bounded-contexts/README.md](bounded-contexts/README.md) — ownership, trách nhiệm, ngôn ngữ, invariant.
4. **Định nghĩa quan hệ.** Ghi nhận các context liên hệ với nhau ra sao — vai trò, nghĩa vụ, translation — theo [context-maps/README.md](context-maps/README.md).
5. **Định nghĩa Domain Event và Integration Contract.** Với mỗi quan hệ đòi hỏi trao đổi dữ liệu, định nghĩa các event và contract theo [domain-events/README.md](domain-events/README.md) và [integration-contracts/README.md](integration-contracts/README.md).
6. **Review và kiểm chứng.** Mỗi artifact đi qua quy trình review (các checklist bounded-context và context-map); các phát hiện review hoặc làm thay đổi thiết kế hoặc trở thành các câu hỏi mở được ghi nhận.

Các bước 2–5 lặp lại: việc định nghĩa một context thường buộc phải tinh chỉnh các context lân cận, và một thay đổi ranh giới sẽ mở lại các map, event, và contract bị ảnh hưởng.

Một thay đổi ranh giới luôn đi qua [Decision Process](../00-governance/decision-process.md) — việc tạo, gộp, tách, hoặc ngừng hoạt động một context không bao giờ chỉ là một lần chỉnh sửa tài liệu.

Các artifact đi qua cùng các trạng thái như bất kỳ quyết định nào: được soạn như Draft, được review như Proposed, và chỉ có hiệu lực khi là Accepted.

## 7. Trạng thái thiết kế

Từ vựng trạng thái quyết định tuân theo [Decision Process](../00-governance/decision-process.md): **Draft** là trạng thái soạn thảo và không phải một trạng thái quyết định chính thức; **Proposed** nghĩa là quyết định đang được review và chưa có hiệu lực; **Accepted** nghĩa là nó được phê duyệt bởi đúng thẩm quyền và có tính ràng buộc.

Chỉ các quyết định Accepted mới có hiệu lực. Một tài liệu trong nhóm này mà chưa hoàn tất review vì thế **không phải kiến trúc đã chốt**, bất kể nó đã được merge hay được các tài liệu khác tham chiếu — trạng thái merge không mang lại trạng thái quyết định.

Điều này có ý nghĩa thực tiễn: một định nghĩa context ở trạng thái Draft mà các tài liệu khác đã trích dẫn tạo ra ấn tượng về một ranh giới đã được quyết định. Tài liệu trích dẫn nên đánh dấu dependency là pending, không được coi nội dung được trích dẫn là có hiệu lực.

Các mục chưa được giải quyết phải luôn hiển thị dưới dạng Open Question trong tài liệu bị ảnh hưởng hoặc như các mục trong [Discovery Backlog](../02-domain-discovery/discovery-backlog.md); chúng không bao giờ được giải quyết âm thầm trong văn xuôi.

Các quyết định Domain Design cũng tuân theo các quy tắc decision record của Decision Process, bao gồm sự phân tách loại Domain-vs-Domain Design và các yêu cầu thẩm quyền trong [review-authority](../08-review-process/review-authority.md) — các quyết định Domain Design cần các owner của context bị ảnh hưởng và Architecture Owner cho phạm vi đó, không phải một người duyệt duy nhất.

## Open Questions

- Những tiêu chí hoàn tất discovery nào (theo [Discovery Charter](../00-governance/discovery-charter.md) và SD-010) phải được thỏa mãn trước khi ứng viên Bounded Context đầu tiên được soạn thảo, và ai xác nhận ngưỡng đó đã đạt?
- Các ranh giới ứng viên được suy ra từ capability map nên được ghi nhận ở đâu trong khi discovery vẫn đang mở — như các đề xuất trong nhóm này, hay chỉ như các mục discovery-backlog cho đến khi điều kiện tiên quyết của SD-010 được thỏa mãn?
- Một định nghĩa Bounded Context có nên mang Decision Record riêng của nó trong `00-governance/architecture-decision-records/`, tham chiếu một Domain Decision trong `02-domain-discovery/decisions/`, hay cả hai — và bản ghi chính được chọn ra sao theo các quy tắc phân loại của Decision Process?
- Các xung đột thuật ngữ giữa hai domain (cùng một từ, ứng viên mang ý nghĩa khác nhau theo từng domain) nên được xử lý trong định nghĩa context như thế nào — glossary theo từng context, hay một từ vựng cấp Ecoma Platform được sở hữu ở nơi khác?
- Bộ file theo từng context theo kế hoạch (năm file mỗi context) có tương xứng với mức chi tiết mà reviewer thực tế có thể đánh giá không, hay các context nhỏ hơn nên gộp thành một tài liệu duy nhất?
- Các artifact trong nhóm này nên trích dẫn các artifact anh em chưa được Accepted như thế nào (vấn đề pending-dependency ở mục 7) — một quy ước đánh dấu cho các trích dẫn đang pending, hay một quy tắc rằng chỉ nội dung Accepted mới được trích dẫn như có hiệu lực?

## 8. Tài liệu liên quan

- [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md) — đầu vào chính: business subject, ownership, các ranh giới đã chốt.
- [Business Capability Map](../02-domain-discovery/business-capability-map.md) — các capability ứng viên mà ranh giới ứng viên được suy ra từ đó.
- [Discovery Backlog](../02-domain-discovery/discovery-backlog.md) — các câu hỏi nghiệp vụ còn mở giới hạn những gì thiết kế được phép giả định.
- [Architecture Principles](../00-governance/architecture-principles.md) — các nguyên tắc chi phối được trích dẫn khắp nơi (AP-004 đến AP-007, AP-012, AP-015).
- [Decision Process](../00-governance/decision-process.md) — từ vựng trạng thái, decision record, và quy tắc thẩm quyền.
- [Discovery Charter](../00-governance/discovery-charter.md) — phương pháp và điều kiện hoàn tất của discovery.
- [Bounded Contexts](bounded-contexts/README.md), [Context Maps](context-maps/README.md), [Domain Events](domain-events/README.md), [Integration Contracts](integration-contracts/README.md) — bốn khu vực con của nhóm này:
  - [Bounded Contexts](bounded-contexts/README.md) — các định nghĩa context.
  - [Context Maps](context-maps/README.md) — mối quan hệ giữa các context.
  - [Domain Events](domain-events/README.md) — các business fact vượt qua ranh giới.
  - [Integration Contracts](integration-contracts/README.md) — các thỏa thuận chi phối trao đổi dữ liệu.
- [04-tactical-design](../04-tactical-design/README.md) — các pattern được áp dụng bên trong một context.
- [05-system-architecture](../05-system-architecture/README.md) — tiêu thụ ranh giới; ánh xạ chúng lên container và công nghệ.
- [Bounded Context Review Checklist](../08-review-process/review-checklists/bounded-context-review.md) và [Context Map Review Checklist](../08-review-process/review-checklists/context-map-review.md) — những gì reviewer sẽ kiểm tra trong các artifact của nhóm này.

Được nhắc đến nhưng chưa được tạo: `docs/02-domain-discovery/README.md` (README nhóm cho discovery).
