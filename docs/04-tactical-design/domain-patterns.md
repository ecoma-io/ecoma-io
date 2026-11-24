# Domain Patterns

- **Trạng thái:** Scaffold — chỉ có định hướng cấu trúc; chưa chứa quyết định hay quy ước ràng buộc nào đã được review hoặc phê duyệt.
- **Phạm vi:** Định hướng ở mức pattern để thiết kế phần domain của một Bounded Context: entity và value object, aggregate và tính nhất quán, domain service, event, policy và specification, mô hình hóa lifecycle và invariant.

## 1. Mục đích và phạm vi áp dụng

- Tài liệu này sẽ chứa định hướng pattern cho domain layer bên trong một Bounded Context: cách chọn giữa Entity và Value Object, cách đặt biên aggregate, khi nào behavior trở thành Domain Service, những sự kiện nào trở thành Domain Event, và khi nào rule xứng đáng có object Policy hoặc Specification tường minh.
- Áp dụng trong phạm vi một context sau khi context đó được định nghĩa; biên context, hợp đồng giữa các context và hợp đồng event thuộc sở hữu của Domain Design ([Domain Design](../03-domain-design/README.md)) — các pattern ở đây không bao giờ vượt qua hoặc định nghĩa lại những biên đó.
- Đây là các mặc định kèm trade-off, không phải mệnh lệnh: một context có thể đi chệch với lý do được ghi nhận, chịu review theo [Review Workflow](../08-review-process/review-workflow.md). Không có aggregate, entity hay event cụ thể nào của Ecoma được quyết định ở đây; những thứ đó thuộc về thiết kế theo từng context (chưa được tạo).

## 2. Các pattern Entity và Value Object

- Định hướng cần bổ sung: chọn Entity hay Value Object dựa trên identity semantics thay vì thói quen; giữ value object bất biến và tự validate; tránh cả hai kiểu lệch pha "mọi thứ đều là entity" và "mọi thứ đều là value object".
- Trade-off cần ghi nhận: value object làm tăng chi phí mapping và khởi tạo nhưng tập trung hóa validation và equality; ưu tiên value object khi một concept được validate hoặc so sánh như một khối thống nhất trong nhiều hơn một flow; chấp nhận primitive khi concept không mang behavior nào.
- Định hướng cũng phải bao gồm việc phối hợp các pattern một cách an toàn: entity được cấu thành từ value object, value object tham chiếu identity của entity, và điểm mà composition ngừng là modeling và trở thành accidental complexity.
- Equality semantics cần xác định cho từng concept: entity so theo identity, value object so theo giá trị attribute; định hướng phải nêu rõ khi nào equality của một entity KHÔNG được phụ thuộc vào attribute có thể thay đổi, và cách so sánh identity hoạt động thế nào giữa các context (identity của concept thuộc context khác chỉ là dữ liệu ở đây).
- Vị trí khởi tạo và validation: định hướng phải xác định validation nằm ở đâu — tại thời điểm khởi tạo đối với value object, tại thời điểm mutate đối với entity — và hình thái failure là gì, để caller không thể nhận được một instance không hợp lệ và để reviewer kiểm tra được validation không bị nhân bản tại từng call site ([AP-008](../00-governance/architecture-principles.md)).

## 3. Thiết kế aggregate

- Định hướng phải bao gồm phương pháp thiết kế: chọn biên aggregate từ invariant và nhu cầu transaction ([AP-008](../00-governance/architecture-principles.md)), giữ aggregate nhỏ, và tham chiếu aggregate khác bằng identity thay vì điều hướng object.
- Định hướng phải cung cấp các câu hỏi đánh giá mà một context trả lời cho từng biên: invariant nào phải được đảm bảo atomic? một transaction đơn lẻ phải thay đổi những gì? điều gì xảy ra khi hai command cùng nhắm vào một aggregate một cách đồng thời? dữ liệu nào chỉ được đọc, không bao giờ thuộc sở hữu?
- Định hướng phải bao gồm rule tham chiếu và giới hạn của nó: aggregate khác được tham chiếu bằng identity, điều này giữ biên nhỏ và tiết kiệm chi phí; cái giá phải trả là thêm các lần load và việc xử lý consistency tường minh — mặc định ưu tiên tham chiếu bằng identity, chỉ embed dữ liệu thực sự thuộc sở hữu của invariant.
- Chưa quyết định ở đây: bất kỳ aggregate hay biên cụ thể nào của Ecoma. Ví dụ minh họa cụ thể cho phương pháp này sẽ nằm ở [Examples](examples/README.md) khi đã có context để minh họa.

## 4. Biên aggregate và tính nhất quán

- Định hướng cần bổ sung: phân biệt strong consistency bên trong một aggregate với eventual consistency giữa các aggregate, và nhận biết khi nào một rule liên tục vắt qua nhiều aggregate là dấu hiệu của một biên sai hoặc một câu hỏi về process/policy, thay vì một aggregate to hơn.
- Mặc định: một transaction cho mỗi aggregate; phối hợp giữa các aggregate bằng event và chiến lược consistency tường minh (xem [Transaction Patterns](transaction-patterns.md)) thay vì nới rộng biên để nuốt trọn rule.
- Trade-off cần ghi nhận: biên lớn hơn đơn giản hóa một số flow nhưng làm tăng contention, phạm vi transaction và coupling; biên nhỏ hơn đòi hỏi consistency xuyên aggregate tường minh, idempotency và suy luận về compensation.

## 5. Domain Service

- Định hướng pattern: dùng Domain Service khi một operation thực sự là domain behavior vắt qua nhiều aggregate hoặc concept và không có object nào tự nhiên sở hữu nó — đồng thời nêu rõ vì sao behavior đó không thể nằm trong một phần hiện có của model ([AP-009](../00-governance/architecture-principles.md)).
- Ưu tiên Domain Service thay vì đặt ở application layer cho các tính toán domain: application layer chỉ điều phối, không tính toán kết quả nghiệp vụ.
- Định hướng phải bao gồm rule dependency cho domain service: chúng được phép phụ thuộc vào các domain concept khác và các abstraction phía domain (như một repository interface), không bao giờ phụ thuộc vào transport, implementation persistence hay framework ([AP-010](../00-governance/architecture-principles.md)); statelessness là mặc định, mọi state mà service mang theo phải được biện minh tường minh.
- Anti-default cần ghi lại: các model nghiêng về service nơi entity chỉ giữ dữ liệu; checklist mà reviewer áp dụng coi đó là một khiếm khuyết ([Tactical Design Review Checklist](../08-review-process/review-checklists/tactical-design-review.md)).

## 6. Domain Event

- Định hướng cần bổ sung: chỉ model event cho những sự kiện nghiệp vụ mang ý nghĩa domain, không phải cho mọi lần thay đổi state; định nghĩa payload bằng ngôn ngữ nghiệp vụ; quyết định cho từng event xem nó chỉ có ý nghĩa bên trong context hay vắt qua các biên.
- Định hướng phải bao gồm các phép thử modeling cho một event ứng viên: một domain expert có nhận ra sự kiện này là có ý nghĩa không? một consumer có thể hành động dựa trên nó mà không cần biết internals của model sản xuất ra nó không? nó có còn đúng sau khi sự việc đã xảy ra không? Một event không qua được các phép thử này thường là một cơ chế (một lần save đã xảy ra, một setter đã chạy), không phải một sự thật nghiệp vụ.
- Publication semantics — raise trong transaction, delivery qua outbox, consumption theo kiểu eventual — là mối quan tâm của transaction và application ([Application Patterns](application-patterns.md), [Transaction Patterns](transaction-patterns.md)); mục này chỉ giữ câu hỏi modeling về việc event là gì.
- Còn mở: độ mịn của event (mutation mức mịn so với sự thật nghiệp vụ mức thô hơn) và có tồn tại quy ước envelope dùng chung hay không. Chưa quyết định.

## 7. Domain Policy và Specification

- Định hướng cần bổ sung: khi nào rule xứng đáng có object Policy hoặc Specification tường minh — predicate và bộ rule có thể compose và tái sử dụng — so với việc nhúng chúng thành method trên concept sở hữu.
- Mặc định: ưu tiên specification tường minh khi cùng một rule được đánh giá trong nhiều flow, được compose từ nhiều phần, hoặc được test độc lập; nhúng logic khi một rule chỉ có một nơi cư trú và một caller.
- Trade-off cần ghi nhận: specification tường minh thêm cấu trúc và indirection; specification chỉ dùng một lần là nghi thức thừa. Định hướng phải đưa ra tiêu chí "ưu tiên X khi nào; Y khi nào" mà không cố định rule nào của Ecoma.

## 8. Mô hình hóa domain lifecycle

- Định hướng cần bổ sung: model lifecycle một cách tường minh khi một concept có các state có ý nghĩa và các transition có guard — các hình dạng chung như các giai đoạn pending/active/ended — giữ rule transition cùng với aggregate sở hữu thay vì rải chúng khắp các caller.
- Định hướng phải bao gồm: transition nào là hợp lệ, ai được phép kích hoạt, side effect nào đi kèm, transition không hợp lệ fail ra sao, và state terminal có thực sự là terminal không.
- Định hướng cũng phải giải quyết câu hỏi lưu trữ state ở mức pattern: state là một field tường minh so với state được suy ra từ event đã ghi nhận, cùng các trade-off (khả năng truy vấn và tính đơn giản so với khả năng audit và truy vấn theo thời gian) — lựa chọn thuộc về thiết kế context, có tham khảo từ [Persistence Patterns](persistence-patterns.md).
- Chưa quyết định ở đây: bất kỳ lifecycle nào của Ecoma — discovery vẫn còn các câu hỏi lifecycle chưa có lời giải (xem [Discovery Backlog](../02-domain-discovery/discovery-backlog.md)); mục này chỉ cung cấp phương pháp modeling.

## 9. Thực thi domain invariant

- Định hướng cần bổ sung: mọi invariant đều có một owner được đặt tên; việc thực thi diễn ra tại biên chịu trách nhiệm ([AP-008](../00-governance/architecture-principles.md)); invariant được phân loại là luôn đúng trong phạm vi một biên hay eventual consistent vắt qua các biên, và chiến lược được nêu rõ trong cả hai trường hợp.
- Định hướng phải bao gồm concurrency semantics cho từng invariant: command được phép giả định điều gì, phải verify điều gì, và contention được giải quyết hoặc từ chối ra sao.
- Định hướng cũng phải bao gồm nguồn gốc của invariant: mỗi invariant truy nguồn được về một business rule hoặc quyết định (ở mức discovery, các quyết định như trong mục 14 của [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md) thiết lập biên nghiệp vụ), không phải về một tiện lợi khi hiện thực — một invariant không có nguồn gốc nghiệp vụ là một design smell cần bị chất vấn, không phải cần bị thực thi gắt hơn.
- Kỳ vọng verification: test chứng minh behavior của invariant trong các tình huống thành công, contention và failure — reviewer kiểm tra điều này một cách tường minh ([Tactical Design Review Checklist](../08-review-process/review-checklists/tactical-design-review.md)).

## 10. Định hướng lựa chọn pattern

- Bắt đầu từ cấu trúc đơn giản nhất bảo vệ được các invariant thực sự tồn tại; chỉ leo lên pattern nặng hơn khi nhu cầu về invariant, consistency hay scale được chứng minh.
- Chuỗi quyết định cần bổ sung, kèm tiêu chí prefer-X-when/Y-when cho từng bước: (1) Entity hay Value Object? (2) biên consistency là gì, và nó có tối thiểu không? (3) behavior có cần một Domain Service không, và vì sao không có object sở hữu? (4) những sự kiện nào là Domain Event có ý nghĩa? (5) rule có xứng đáng với một Specification hoặc Policy tường minh không? (6) lifecycle là modeling tường minh hay state ngẫu nhiên?
- Mọi lệch khỏi các mặc định này được ghi nhận cùng lý do trong thiết kế context và có thể bị review; bản thân các mặc định chỉ thay đổi thông qua quy trình quyết định ([Decision Process](../00-governance/decision-process.md)).

## 11. Anti-patterns

- Anemic domain model: entity chỉ chứa dữ liệu với toàn bộ logic nằm trong service.
- Pattern ritual: aggregate, event hay specification được tạo ra vì bản thân pattern, không phải vì một invariant hay rule.
- Aggregate như tấm gương object graph: biên được chép từ association hoặc database schema thay vì từ invariant.
- God aggregate: một biên hấp thụ mọi rule liên quan, gây contention và coupling.
- Event noise: một event cho mỗi setter; event mô tả cơ chế thay vì ý nghĩa nghiệp vụ.
- One-use specification: object rule tường minh với duy nhất một caller và không có composition.

## 12. Câu hỏi còn mở

- Phần nào của định hướng này trở thành ràng buộc cho từng context, và thông qua công cụ quyết định nào (context ADR so với cập nhật quy ước).
- Độ mịn của Domain Event và quy ước envelope bên trong một context.
- Quy ước đặt tên và vị trí đặt cho object Policy và Specification.
- Lifecycle modeling có được một helper dùng chung giữa các context hay không — và liệu đó có thực sự là một platform capability hay không; sở hữu chưa được quyết định (phân chia platform/business theo [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md)).

## 13. Tài liệu liên quan

- [Modeling Conventions](modeling-conventions.md) — vốn từ vựng làm nền cho các pattern này.
- [Application Patterns](application-patterns.md), [Persistence Patterns](persistence-patterns.md), [Transaction Patterns](transaction-patterns.md) — các tầng liền kề của định hướng tactical.
- [Examples](examples/README.md) — các ví dụ minh họa; chưa có ví dụ nào.
- [Architecture Principles](../00-governance/architecture-principles.md) — AP-008, AP-009, AP-010.
- [Domain Design](../03-domain-design/README.md) — sở hữu biên context và hợp đồng giữa các context.
- [Tactical Design Review Checklist](../08-review-process/review-checklists/tactical-design-review.md).
- [Discovery Backlog](../02-domain-discovery/discovery-backlog.md) — các câu hỏi domain còn mở ràng buộc việc mô hình hóa lifecycle.
