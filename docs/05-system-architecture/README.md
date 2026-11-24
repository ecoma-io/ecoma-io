# System Architecture

**Trạng thái:** Scaffold — chỉ là định hướng cấu trúc; chưa chứa bất kỳ quyết định kiến trúc nào đã được review hoặc phê duyệt.

**Phạm vi:** Định hướng cho nhóm tài liệu này và xác định bảy viewpoint mà qua đó system-level architecture của Ecoma sẽ được ghi nhận, đánh giá và tiến hóa.

## 1. Mục đích

Nhóm này định nghĩa **system-level architecture** của Ecoma: cách các domain của sản phẩm và các platform capability dùng chung được hiện thực hóa thành hệ thống các container và deployment unit. Đây là tầng dịch các domain boundary đã được xác lập từ Domain Design và các kỳ vọng chất lượng từ nhóm Quality Attributes thành cấu trúc kỹ thuật cụ thể — boundary, unit, dependency và behavior.

Tầng này nằm dưới Strategy và Domain Design về độ cao quyết định. Strategy quyết định vì sao sản phẩm tồn tại và chứa những domain nào; Domain Design quyết định những responsibility nào tồn tại và ai sở hữu chúng; nhóm này quyết định cấu trúc kỹ thuật nào hiện thực hóa những responsibility đó. Các quyết định ở đây phải được biện minh dựa trên các tầng phía trên — không bao giờ ngược lại.

Chưa có cấu trúc kỹ thuật nào ở cấp system tồn tại. Chưa có decomposition container, deployment topology, runtime model, security mechanism, data store layout hay integration implementation nào được đề xuất, càng chưa được chấp nhận. Điều nhóm này cung cấp hiện nay là **cấu trúc ghi nhận**: bảy file viewpoint định nghĩa mọi quyết định kiến trúc phải tạo ra thông tin gì, để các quyết định có thể được đưa ra từng bước một mà không mất tính nhất quán.

Khi đã được điền nội dung, nhóm này trả lời các câu hỏi:

- Những responsibility nào nằm trong system boundary, và những actor và system nào nằm ngoài nó?
- Những technical unit nào tồn tại, mỗi unit sở hữu những responsibility và data gì, và chúng phụ thuộc vào nhau thế nào?
- Các unit chạy ở đâu, được deploy và phục hồi ra sao, và chúng vận hành thế nào lúc runtime — kể cả khi gặp failure?
- Identity, authorization, data và integration xuyên boundary được quản trị ở cấp system như thế nào?

Nhóm này không bao giờ giả định ánh xạ một-một giữa Bounded Contexts, container và deployment unit ([AP-006](../00-governance/architecture-principles.md)). Việc xác lập ánh xạ đó — ở nơi nó thực sự được biện minh — chính là công việc mà nhóm này tồn tại để ghi nhận, chứ không phải để giả định trước.

## 2. Phạm vi

**Nhóm này sở hữu:**

- System context — system boundary, các external actor và system, trust boundaries (C4 Level 1).
- Container architecture — các technical unit trong boundary, responsibility, ownership và dependency của chúng (C4 Level 2, chỉ dùng như một khái niệm viewpoint).
- Deployment architecture — environments, deployment units, topology, configuration, rollout, rollback và recovery.
- Runtime architecture — execution model, request processing, communication, background work, concurrency, failure handling và shutdown.
- Security architecture — identity, authentication, authorization, credential handling, threat model và controls.
- Data architecture — data ownership, classification, consistency, lifecycle, migration, backup và exchange.
- Integration architecture — integration styles, contract governance, versioning, failure handling và traceability xuyên các boundary.

**Rõ ràng không thuộc sở hữu của nhóm này:**

- Domain boundaries, Bounded Contexts, Context Maps và các integration contract với tư cách domain artifact — do Domain Design sở hữu. Nhóm này tiêu thụ những boundary đó; nó không bao giờ tạo, đổi tên hay hợp nhất chúng để làm cho một thiết kế kỹ thuật trở nên thuận tiện.
- Các design pattern in-context — aggregates, entities, application-layer patterns — do Tactical Design sở hữu.
- Repository, project taxonomy và tổ chức build — do Monorepo Architecture sở hữu.

Khi một phát hiện ở cấp system hàm ý một vấn đề thuộc domain — ví dụ, một responsibility không có context nào sở hữu — phát hiện đó được chuyển ngược lại cho Domain Design thay vì được giải quyết bằng cách bịa ra cấu trúc ở đây.

## 3. Quan hệ với Domain Design

Domain Design định nghĩa những responsibility **GÌ** tồn tại và responsibility nào sở hữu data; nhóm này quyết định những responsibility đó được hiện thực kỹ thuật **NHƯ THẾ NÀO**. Đầu vào của mọi quyết định cấu trúc ở đây là tập các Bounded Context boundary được định nghĩa trong docs/03-domain-design/ — chưa được định nghĩa; nhóm này tiêu thụ chúng, không bao giờ tạo ra chúng.

Ánh xạ giữa cấu trúc domain và cấu trúc kỹ thuật là một quyết định system architecture, được đánh giá dựa trên những boundary đó — không bao giờ là một giả định:

- một deployment unit có thể hiện thực **một phần của** một context, **toàn bộ một** context, hoặc **nhiều** contexts;
- mỗi ánh xạ như vậy phải được biện minh dựa trên ownership, consistency, scaling, failure isolation, security và chi phí vận hành ([AP-006](../00-governance/architecture-principles.md), [AP-012](../00-governance/architecture-principles.md));
- nơi một technical boundary lệch khỏi một domain boundary, sự lệch đó và lý do của nó được ghi nhận trong quyết định, chứ không được âm thầm nuốt trọn.

Điều này bảo vệ chuỗi trách nhiệm giải trình: một business responsibility có thể được truy vết từ strategic domain model, qua Bounded Context của nó, đến các technical unit hiện thực hóa nó — và ngược lại. Nếu một unit không có trace như vậy, unit đó là vô lý do.

Khi Domain Design thay đổi một boundary sau khi cấu trúc kỹ thuật đã tồn tại, mọi file viewpoint tham chiếu đến các responsibility bị ảnh hưởng đều được đánh giá lại; cấu trúc kỹ thuật không đóng băng một quyết định domain tại chỗ.

## 4. Các Architecture Viewpoint

Nhóm này giữ bảy viewpoint tách biệt, mỗi viewpoint một file:

| Viewpoint              | File                                                       | Câu hỏi nó trả lời                                                                                                |
| ---------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Context (C4 Level 1)   | [system-context.md](system-context.md)                     | Những gì nằm trong system boundary, những gì nằm ngoài, và system nợ gì các external actor và system?             |
| Container (C4 Level 2) | [container-architecture.md](container-architecture.md)     | Những technical unit nào tồn tại trong boundary, mỗi unit sở hữu gì, và chúng phụ thuộc nhau thế nào?             |
| Deployment             | [deployment-architecture.md](deployment-architecture.md)   | Các unit chạy ở đâu, trong những environment nào, và chúng thay đổi, rollback và phục hồi ra sao?                 |
| Runtime                | [runtime-architecture.md](runtime-architecture.md)         | Các unit vận hành thế nào khi thực thi: requests, communication, background work, concurrency, failure, shutdown? |
| Security               | [security-architecture.md](security-architecture.md)       | Trust, identity, authentication, authorization và data protection được quản trị xuyên suốt system thế nào?        |
| Data                   | [data-architecture.md](data-architecture.md)               | Ai sở hữu data nào, data phải consistent đến mức nào, và nó tồn tại, di chuyển và biến mất ra sao?                |
| Integration            | [integration-architecture.md](integration-architecture.md) | Các unit, domain và external system trao đổi thông tin dưới các contract tường minh như thế nào?                |

"Container" được dùng ở đây thuần túy như khái niệm viewpoint của C4 — một technical unit chạy độc lập trong system boundary. Nó không phải là cam kết với bất kỳ công nghệ packaging, hosting hay infrastructure nào, và nhóm này không liệt kê các container của Ecoma cho đến khi các quyết định về container được chấp nhận.

Các viewpoint được giữ tách biệt vì chúng trả lời những câu hỏi khác nhau, thay đổi vì những lý do khác nhau, và được đánh giá theo những mối quan tâm khác nhau. Một domain boundary, một module boundary và một deployment boundary là ba thứ khác biệt ([AP-006](../00-governance/architecture-principles.md)); việc gộp các viewpoint lại sẽ mời gọi một boundary bị suy ra âm thầm từ boundary khác. Chi phí của sự tách biệt là công đồng bộ giữa các file — các decision reference và cross-link trong mỗi file tồn tại để giữ cho điều đó khả kiểm.

Các viewpoint cũng trưởng thành theo một thứ tự tự nhiên: context phải được quyết trước decomposition container, decomposition container trước các bản ghi deployment và runtime, và viewpoint integration trước khi bất kỳ tương tác dựa trên contract nào được xây dựng; security và data xuyên cắt tất cả và được xem xét lại ở mỗi bước.

## 5. Các nguyên tắc System Architecture

Những nguyên tắc này mang tính định hướng. Chúng dẫn dắt cách các đề xuất được đánh giá và một quyết định phải biện minh điều gì; không nguyên tắc nào ép buộc một topology cụ thể, và mỗi nguyên tắc đều nêu một trade-off có thật.

1. **System boundary phản ánh các responsibility và ownership đã được xác lập.** System context và mọi container responsibility đều truy vết được về ownership đã được xác lập bởi strategic discovery và Domain Design ([Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md), [AP-004](../00-governance/architecture-principles.md)). Một technical unit không bao giờ bịa ra một business responsibility để biện minh cho sự tồn tại của chính nó.
2. **Một technical deployment boundary không mặc định là một domain boundary.** Việc tách hay gộp theo hướng deployment phải được biện minh cho từng trường hợp ([AP-006](../00-governance/architecture-principles.md), [AP-012](../00-governance/architecture-principles.md)); ánh xạ và lý do của nó là một phần của quyết định, không phải nhiễu nền.
3. **Independent deployability được đánh giá theo nhu cầu, không được giả định sẵn.** Nó mang lại autonomy, release independence và khả năng kiểm soát blast-radius; nó đánh đổi bằng operational complexity, quản lý environment và kỷ luật contract versioning ([AP-020](../00-governance/architecture-principles.md)). Lợi ích có outweigh chi phí hay không chính là điều mỗi quyết định về deployment boundary phải chỉ ra.
4. **Quality attributes được xem xét xuyên suốt, không dồn vào một chương.** [Reliability](../07-quality-attributes/reliability.md), [Security](../07-quality-attributes/security.md), [Observability](../07-quality-attributes/observability.md), [Performance](../07-quality-attributes/performance.md) và [Testability](../07-quality-attributes/testability.md) ràng buộc mọi viewpoint; mỗi viewpoint nêu rõ các quyết định của nó ảnh hưởng đến chúng thế nào ([AP-019](../00-governance/architecture-principles.md)).
5. **Không chọn công nghệ trước khi vấn đề và constraints được xác lập.** Một viewpoint có thể ghi nhận rằng một lựa chọn là cần thiết và những constraints nào áp dụng ([Constraints](../01-strategy/constraints.md)); lựa chọn cụ thể — storage, transport, infrastructure, framework — đòi hỏi một quyết định đã được chấp nhận.

## 6. Cấu trúc tài liệu

- [system-context.md](system-context.md) — tầm nhìn ngoài cùng: system boundary, external actor và system, trust boundaries, các kịch bản tương tác chính. Mọi thứ khác trong nhóm này được vẽ bên trong boundary mà file này định nghĩa.
- [container-architecture.md](container-architecture.md) — decomposition thành các technical unit: responsibilities, data sở hữu, dependency graph, deployment independence. Kho dữ liệu này giữ trống cho đến khi các quyết định container được chấp nhận.
- [deployment-architecture.md](deployment-architecture.md) — placement và vận hành: environments, deployment units, topology, configuration và secrets, rollout, rollback, isolation.
- [runtime-architecture.md](runtime-architecture.md) — hành vi thực thi: request processing, communication styles, background work, concurrency, failure handling, graceful shutdown.
- [security-architecture.md](security-architecture.md) — quản trị trust: identity, authentication, authorization, secrets, auditing, threat model, controls, xử lý incident.
- [data-architecture.md](data-architecture.md) — quản trị data: ownership, classification, consistency, lifecycle và retention, migration, backup, trao đổi giữa các hệ thống.
- [integration-architecture.md](integration-architecture.md) — quản trị tương tác: integration styles, contract governance, versioning, failure handling, security và traceability xuyên các boundary.

Thứ tự đọc cho một quyết định mới: bắt đầu tại system-context.md để định vị boundary, rồi mở viewpoint mà quyết định thuộc về, sau đó đến các viewpoint mà nó ràng buộc. Vì các file tiêu thụ bản ghi của nhau — container nuôi deployment units và dependency graphs, ownership nuôi data stores, boundary nuôi integration edges — một quyết định trong một file thường nêu tên các file upstream và downstream của nó; những tham chiếu đó là một phần của bản ghi, không phải trang trí.

## 7. Tham chiếu Architecture Decision

Các quyết định system architecture được ghi nhận dưới dạng Architecture Decision Records, dùng [ADR template](../00-governance/architecture-decision-records/template.md) và tuân theo [decision process](../00-governance/decision-process.md), vốn phân loại chúng dưới category "System Architecture": system boundary, integration, runtime, deployment, security, data.

Các quy tắc nhóm này áp dụng:

- Mỗi file viewpoint tham chiếu các ADR hiện thực hóa nội dung của nó. Một tuyên bố về cấu trúc kỹ thuật mà không có decision reference là một Open Question, không phải một sự thật.
- Từ vựng trạng thái tuân theo decision process: **Draft** khi đang soạn, **Proposed** khi đang được review, **Accepted** khi đã được phê duyệt — và chỉ nội dung Accepted mới có hiệu lực. Hiện không có quyết định system architecture nào giữ bất kỳ trạng thái nào trong số này.
- Nơi một quyết định hệ thống có thể thay đổi ngữ nghĩa domain — responsibility, ownership, ý nghĩa contract — nó được phối hợp với Domain Design thay vì được quyết một phía; ADR và quyết định domain mỗi bên giữ trách nhiệm riêng, theo decision process.
- Các khu vực chưa quyết định được giữ hiển thị dưới dạng Open Questions trong các file viewpoint bị ảnh hưởng thay vì được lấp đầy âm thầm bằng các giả định.
- Decision index (ID, title, category, status, owner) được duy trì theo decision process; các file viewpoint link đến từng ADR thay vì sao chép rationale của chúng.

## 8. Tiến hóa kiến trúc

Tiến hóa dự kiến từ trạng thái hiện tại, hoàn toàn chưa quyết định:

- Các quyết định được đưa vào **từng bước dưới dạng ADRs**, mỗi lần một vấn đề; không có khoảnh khắc "grand design" duy nhất nào để chờ đợi. Mỗi ADR được chấp nhận sẽ được phản ánh trong file viewpoint mà nó ảnh hưởng.
- Các file viewpoint tiến qua các mức **Scaffold → Draft → Proposed → Accepted** khi nội dung của chúng được soạn, review và phê duyệt; dòng trạng thái của một file luôn cho thấy nó đã đi được bao xa, và chỉ nội dung Accepted mới có hiệu lực.
- Tiến hóa **không được âm thầm vi phạm các domain boundary đã được chấp nhận**: bất kỳ lựa chọn cấu trúc nào lệch khỏi một boundary được xác lập trong Domain Design đều là một quyết định tường minh, đã được review, với rationale được ghi nhận ([AP-004](../00-governance/architecture-principles.md)).
- Các quyết định luôn có thể được xem lại: khi context hoặc bằng chứng thay đổi, một quyết định mới supersede quyết định cũ với các link tường minh, và lịch sử được bảo toàn ([AP-021](../00-governance/architecture-principles.md)).
- Khi các quyết định tích lũy, những phần hiện chỉ định nghĩa nghĩa vụ ghi nhận sẽ lớn dần thành các kho dữ liệu và mô hình về những gì thực sự đang có hiệu lực.

## 9. Kỳ vọng khi review

Các buổi review system architecture tuân theo [system architecture review checklist](../08-review-process/review-checklists/system-architecture-review.md) dưới [review policy](../08-review-process/review-policy.md). Những chủ đề reviewer sẽ đòi hỏi ở nhóm này:

- Business boundary và deployment boundary được phân biệt, và không giả định một Bounded Context bằng một service hay deployment unit.
- Ownership của data và quyền ghi là tường minh; trust boundaries được thể hiện.
- Ngữ nghĩa integration được định nghĩa: timeouts, retries, idempotency, compatibility, failure isolation.
- Security phân biệt authentication với authorization và bao phủ secrets, auditing và threat models.
- Runtime và deployment bao phủ readiness, configuration, rollout, rollback và recovery — và không có deployment unit nào được tạo ra mà chi phí vận hành của nó không được một lợi ích đã nêu trả tiền.
- Observability và operations được quan tâm: logs, metrics và traces đủ để điều tra một failure, và mỗi alert mang một signal và một hành động.

Thẩm quyền phê duyệt cho các quyết định system architecture được định nghĩa trong [review authority](../08-review-process/review-authority.md); phê duyệt bao gồm cả việc cập nhật decision record và các file viewpoint bị ảnh hưởng.

## 10. Tài liệu liên quan

**Nhóm tài liệu:**

- [Domain Design](../03-domain-design/README.md) — nguồn của các Bounded Context boundary mà nhóm này tiêu thụ.
- [Tactical Design](../04-tactical-design/README.md) — các design pattern in-context, nằm downstream của nhóm này.
- [Monorepo Architecture](../06-monorepo-architecture/README.md) — tổ chức repository và build hiện thực hóa các module boundary.
- Tổng quan của nhóm Domain Discovery (docs/02-domain-discovery/README.md, chưa được tạo).
- Tổng quan của nhóm Quality Attributes (docs/07-quality-attributes/README.md, chưa được tạo).
- [Tổng quan tài liệu](../README.md).

**Đầu vào từ discovery và strategy:**

- [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md) — business ownership, actor và boundary đã được xác lập.
- [Business Capability Map](../02-domain-discovery/business-capability-map.md) và [Discovery Backlog](../02-domain-discovery/discovery-backlog.md) — những gì đã và chưa được quyết định.
- [Ecoma Strategy](../01-strategy/ecoma-strategy.md), [AI Factory Marketplace](../01-strategy/ai-factory-marketplace.md) và [Constraints](../01-strategy/constraints.md) — khung chiến lược mà mọi quyết định cấu trúc phải phù hợp.

**Quality attributes:**

- [Reliability](../07-quality-attributes/reliability.md), [Security](../07-quality-attributes/security.md), [Observability](../07-quality-attributes/observability.md), [Performance](../07-quality-attributes/performance.md), [Testability](../07-quality-attributes/testability.md).

**Governance:**

- [Architecture Principles](../00-governance/architecture-principles.md), [Decision Process](../00-governance/decision-process.md), [ADR Template](../00-governance/architecture-decision-records/template.md), [Governance README](../00-governance/README.md).
- [Review Process](../08-review-process/README.md), [review workflow](../08-review-process/review-workflow.md) và [system architecture review checklist](../08-review-process/review-checklists/system-architecture-review.md).
