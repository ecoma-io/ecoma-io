# Transaction Patterns

- **Status:** Scaffold — chỉ có định hướng cấu trúc; không chứa quyết định hay quy ước ràng buộc nào đã được review hoặc phê duyệt.
- **Scope:** Định hướng ở mức pattern cho chiến lược consistency và transaction bên trong một Bounded Context: nguyên tắc transaction boundary, consistency liên aggregate và liên context, saga, outbox/inbox, idempotency, retry, compensation và failure recovery.

## 1. Purpose and Applicability

- Tài liệu này sẽ chứa playbook cho consistency: những pattern nào giữ cho state đúng khi một operation trải qua nhiều hơn một aggregate, nhiều hơn một persistence operation, hoặc về sau nhiều hơn một context — và mỗi pattern tốn kém điều gì.
- Áp dụng trong phạm vi một Bounded Context; biên giới context và hợp đồng liên context mà chiến lược cross-context phải tôn trọng thuộc quyền sở hữu của Domain Design ([Domain Design](../03-domain-design/README.md)) — tài liệu này chỉ nêu định hướng, không bao giờ là một mechanism đã quyết định ([AP-007](../00-governance/architecture-principles.md)).
- Các mặc định kèm trade-off: local transaction khi có thể, coordination tường minh khi không thể; không giả định distributed transaction ([AP-013](../00-governance/architecture-principles.md)). Mechanism cụ thể được chọn theo thiết kế từng context, với phần hạ tầng thuộc sở hữu của System Architecture ([System Architecture](../05-system-architecture/README.md)).

## 2. Transaction Boundary Principles

- Định hướng cần bổ sung: các nguyên tắc biên giới mà thiết kế một context phải nêu rõ — một transaction thay đổi những gì (lý tưởng là một aggregate), cái gì cố tình nằm ngoài nó (external call, một số việc publish event), và kỳ vọng consistency nào (strong, read-your-writes, eventual) mà mỗi hiệu ứng khả kiến mang theo.
- Định hướng phải ghi lại trade-off cốt lõi: transaction lớn hơn mua lại vẻ đơn giản giả tạo nhưng trả giá bằng contention, latency và blast radius khi lỗi; transaction nhỏ hơn đòi hỏi lập luận tường minh về compensation và idempotency. Ưu tiên biên giới nhỏ nhất mà vẫn giữ invariant ở mức atomic ([AP-008](../00-governance/architecture-principles.md)).
- Chưa quyết định: bất kỳ chính sách transaction nào của Ecoma — tài liệu này chỉ định nghĩa những gì một context phải làm rõ tường minh.

## 3. Local Transaction

- Định hướng cần bổ sung: pattern mặc định — một transaction bao phủ một operation trên một aggregate cùng với việc persist nó; định hướng bao gồm khi nào một local transaction có thể chính đáng bao phủ nhiều hơn (ghi nhiều aggregate được biện minh bởi một invariant duy nhất) và lời biện minh đó phải chứng minh điều gì.
- Định hướng phải bao gồm failure semantics của local transaction: persist theo kiểu all-or-nothing, state sau rollback, và cách lỗi được bề mặt hoá tới use case ([Application Patterns](application-patterns.md) — Error Handling).
- Trade-off cần ghi lại: một transaction được mở rộng để bao phủ nhiều aggregate chỉ an toàn khi nó không bị contention; định hướng pattern phải nêu rõ tín hiệu contention nào đáng lẽ phải kích hoạt việc đánh giá lại.

## 4. Cross-Aggregate Consistency

- Định hướng cần bổ sung: danh mục chiến lược cho các rule trải qua nhiều aggregate trong một context — cùng một transaction (kèm biện minh), domain event với eventual consistency, các bước process tuần tự với state tường minh — mỗi lựa chọn kèm cam kết consistency và failure mode của nó.
- Định hướng phải bao gồm các câu hỏi quyết định: rule có phải được thỏa mãn một cách atomic, hay eventual consistency là chấp nhận được với consumer? điều gì xảy ra khi bước tiếp theo thất bại? ai retry, và bước đó có idempotent không?
- Định hướng mặc định: ưu tiên eventual consistency với state tường minh, khả kiến khi consumer chấp nhận được; dành viết liên aggregate trong cùng transaction cho những invariant thực sự atomic. Chưa quyết định: bất kỳ chiến lược nào của Ecoma — do từng context tự chọn.

## 5. Cross-Context Consistency

- Định hướng cần bổ sung: cross-context consistency phải tôn trọng biên giới context do Domain Design định nghĩa — coordination diễn ra qua contract và event ([AP-007](../00-governance/architecture-principles.md)), không bao giờ bằng cách với tay vào storage hay transaction của context khác; consistency giữa các context là eventual theo mặc định, và bất kỳ cam kết mạnh hơn nào cũng phải là một contract được thiết kế, không phải một tai nạn triển khai.
- Định hướng phải bao gồm những gì một context phát biểu về các hiệu ứng mà nó phơi ra cho context khác: nó publish những event nào, consumer có thể giả định ordering/delivery semantics nào, và consumer báo hiệu staleness bằng cách nào.
- Chưa quyết định và cố tình trì hoãn: liệu có luồng cross-context nào của Ecoma cần cam kết mạnh hơn eventual hay không, và thông qua mechanism nào — đây là các quyết định contract thuộc quyền sở hữu của Domain Design, được định hướng bởi tài liệu này.

## 6. Distributed Transaction Considerations

- Định hướng cần bổ sung: cảnh báo thường trực — distributed transaction kiểu two-phase commit không được giả định là khả dụng hay đáng mong muốn ([AP-013](../00-governance/architecture-principles.md)); định hướng bao gồm khi nào một distributed transaction thậm chí được cân nhắc (cùng deployment unit, cùng nền storage, yêu cầu atomic cứng) và thứ thay thế nó trong các trường hợp khác: saga, compensation, retry idempotent.
- Định hướng phải nêu rõ các chi phí đang được tránh: coupling với coordinator, thời gian giữ lock trải dài giữa các context, failure mode kéo dài quá tuổi thọ transaction, và gánh nặng vận hành.
- Chưa quyết định: Ecoma chưa có lập trường nào về distributed transaction — thực tế về storage và deployment là dữ kiện thuộc System Architecture; tài liệu này chỉ ngăn việc giả định khả năng đó.

## 7. Saga and Process Manager

- Định hướng cần bổ sung: các hình dạng của pattern — choreography (mỗi bước phản ứng với event) so với orchestration (một process manager điều phối các bước) — kèm trade-off: choreography liên kết lỏng nhưng khó nhìn như một tổng thể; orchestration tập trung khả năng quan sát và kiểm soát nhưng cũng dồn logic và state của coordinator về một chỗ.
- Định hướng phải bao gồm những gì thiết kế một saga phải nêu: danh sách bước, xử lý thất bại cho từng bước, các bước compensation, idempotency của mọi bước, chính sách timeout, và state tiến trình nằm ở đâu.
- Chưa quyết định: Ecoma dùng một capability process-manager dùng chung hay các implementation theo từng context — câu hỏi sở hữu nền tảng, được theo dõi trong Open Questions.

## 8. Outbox and Inbox

- Định hướng cần bổ sung: outbox pattern (thay đổi state và bản ghi event được commit một cách atomic; relay publish về sau) là câu trả lời mặc định khi một context không được phép mất event qua biên giới persistence; inbox pattern (deduplication khi tiêu thụ) là đối tác của nó cho delivery at-least-once.
- Định hướng phải bao gồm các nghĩa vụ ở mức pattern: bản ghi outbox phải idempotent đối với relay, delivery là at-least-once, consumer chịu được duplicate và reorder ở mức contract cho phép ([AP-007](../00-governance/architecture-principles.md), [AP-020](../00-governance/architecture-principles.md)).
- Chưa quyết định: bất kỳ mechanism relay/broker cụ thể nào cho Ecoma — lựa chọn hạ tầng thuộc về System Architecture; tài liệu này chỉ cố định các nghĩa vụ pattern.

## 9. Idempotency

- Định hướng cần bổ sung: quy tắc rằng mọi operation có thể chạm tới bằng retry, redelivery hoặc lặp lại bởi user phải idempotent hoặc được bảo vệ tường minh ([AP-013](../00-governance/architecture-principles.md)); danh mục mechanism — idempotency key được lưu cùng lúc với hiệu ứng, idempotence tự nhiên nhờ thiết kế, cửa sổ deduplication — kèm trade-off chi phí.
- Định hướng phải bao gồm các câu hỏi phạm vi mà một context trả lời: operation nào mang key, state deduplication tồn tại bao lâu, một request bị replay trả về điều gì.
- Lãnh thổ chung: kỳ vọng ở mức use case nằm trong [Application Patterns](application-patterns.md); persistence của state deduplication chạm tới [Persistence Patterns](persistence-patterns.md). Phần này sở hữu lập luận về consistency.

## 10. Retry and Compensation

- Định hướng cần bổ sung: các lớp chính sách retry — loại thất bại nào retryable, với backoff và budget thế nào — và compensation pattern cho các bước không thể retry tới thành công: một bước đảo ngược được định nghĩa, khôi phục một state nhất quán, với cơ chế xử lý thất bại riêng của nó ([AP-013](../00-governance/architecture-principles.md)).
- Định hướng phải bao gồm các câu hỏi quyết định: hiệu ứng có idempotent không (retry an toàn)? có compensating action không (thất bại một phần có thể phục hồi)? không có cả hai (bước đó phải được thiết kế loại bỏ hoặc chuyển thành vấn đề con người giải quyết)?
- Chưa quyết định: bất kỳ giá trị chính sách retry/compensation nào của Ecoma — chỉ có tiêu chí pattern; budget cụ thể là công việc reliability engineering ([Reliability](../07-quality-attributes/reliability.md)).

## 11. Failure Recovery

- Định hướng cần bổ sung: những gì một context phải phát biểu để phục hồi — state của process đang chạy sau crash (saga resume hay thất bại một cách khả kiến), hành vi restart của outbox relay, deduplication sau recovery, và cách process bị kẹt trở nên quan sát được và giải quyết được.
- Định hướng phải bao gồm kỳ vọng rằng các đường recovery được kiểm thử: kịch bản crash ở giữa chừng, duplicate delivery sau restart, thất bại của compensation ([Tactical Design Review Checklist](../08-review-process/review-checklists/tactical-design-review.md)).
- Tín hiệu vận hành (metrics, alerting trên saga kẹt hoặc bản ghi outbox chưa giao) thuộc sở hữu của phần observability trong System Architecture và quality attributes ([Observability](../07-quality-attributes/observability.md)); tài liệu này chỉ phát biểu nghĩa vụ pattern rằng các state bị kẹt phải khả kiến.

## 12. Pattern Selection Guidelines

- Chuỗi quyết định cần bổ sung với tiêu chí prefer-X-when/Y-when: (1) operation có thể giữ là local transaction trên một aggregate không? (2) nếu trải qua nhiều aggregate, rule có phải atomic không, hay eventual consistency là chấp nhận được? (3) nếu vượt qua context, contract có dựa trên event và eventually consistent không? (4) các bước có phải saga không, và choreographed hay orchestrated? (5) việc publish có cần outbox, và việc giao nhận có cần inbox không? (6) mọi bước có idempotent, retryable, hoặc compensable không?
- Escalation test: mọi mechanism coordination ngoài local transaction phải nêu rõ nhu cầu liên aggregate hoặc liên context, cam kết consistency nó cung cấp, và chi phí được chấp nhận — được ghi lại trong thiết kế context và có thể review.
- Bất cứ điều gì sẽ ghép chặt internals của hai context với nhau bị từ chối theo mặc định; cách sửa là một cuộc trò chuyện về contract trong Domain Design, không phải một transaction rộng hơn.

## 13. Anti-patterns

- Distributed transaction do giả định: các thiết kế âm thầm đòi hỏi two-phase commit giữa các context hoặc storage ([AP-013](../00-governance/architecture-principles.md)).
- Transaction mở rộng để nuốt trọn một process: transaction dài giữ state làm con tin thay vì saga với các bước tường minh.
- Event kiểu fire-and-forget: những lần publish bắt buộc phải tới được nhưng không có outbox, cam kết delivery, hay lời giải thích về idempotency phía consumer.
- Hiệu ứng không idempotent nhưng bị retry; compensation không có xử lý thất bại; saga có state kẹt nhưng không thể quan sát và không thể giải quyết.
- Coupling liên context: giải quyết consistency bằng cách với tay vào dữ liệu của context khác thay vì qua contract ([AP-007](../00-governance/architecture-principles.md), [AP-015](../00-governance/architecture-principles.md)).

## 14. Open Questions

- Ecoma chuẩn hoá một mechanism outbox/inbox ở cấp nền tảng hay để các implementation theo từng context.
- Có tồn tại một capability saga/process-manager dùng chung hay không, và ai sở hữu nó (câu hỏi capability nền tảng, theo [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md)).
- Delivery semantics mặc định (ordering, duplication) mà các contract của Ecoma có thể giả định — câu hỏi về vốn từ contract liên context, được xử lý cùng Domain Design.
- Những context nào (một khi được định nghĩa) thực sự cần cam kết liên context mạnh hơn eventual.

## 15. Related Documents

- [Application Patterns](application-patterns.md) — khai báo transaction boundary, idempotency và error handling ở mức use case.
- [Persistence Patterns](persistence-patterns.md) — persistence có tính transactional và concurrency control.
- [Modeling Conventions](modeling-conventions.md), [Domain Patterns](domain-patterns.md) — vốn từ và thiết kế aggregate nuôi các quyết định consistency.
- [Tactical Design README](README.md) — tổng quan và triết lý của nhóm.
- [Architecture Principles](../00-governance/architecture-principles.md) — AP-007, AP-008, AP-013, AP-015, AP-020.
- [Domain Design](../03-domain-design/README.md) — biên giới context và hợp đồng tích hợp.
- [System Architecture](../05-system-architecture/README.md) — các mechanism hạ tầng (broker, relay, nền storage).
- [Reliability](../07-quality-attributes/reliability.md), [Observability](../07-quality-attributes/observability.md) — kỳ vọng về xử lý thất bại và khả năng quan sát.
- [Tactical Design Review Checklist](../08-review-process/review-checklists/tactical-design-review.md).
