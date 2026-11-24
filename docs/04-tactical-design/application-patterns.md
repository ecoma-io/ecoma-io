# Application Patterns

- **Trạng thái:** Khung sườn — chỉ mang tính định hướng cấu trúc; chưa chứa quyết định hoặc quy ước ràng buộc nào đã được review hoặc phê duyệt.
- **Phạm vi:** Định hướng ở mức pattern cho application layer bên trong một Bounded Context: thiết kế use case, xử lý command và query, application service, ranh giới authorization, tương tác với hệ thống bên ngoài, idempotency và xử lý lỗi.

## 1. Mục đích và Phạm vi áp dụng

- Tài liệu này sẽ chứa định hướng cho layer chịu trách nhiệm điều phối use case: những gì thuộc về một application service, command và query được tách biệt ra sao, transaction và ranh giới authorization nằm ở đâu, và application layer tương tác với domain event, hệ thống bên ngoài và thất bại như thế nào.
- Tài liệu áp dụng trong phạm vi một Bounded Context; các hợp đồng tương tác liên-context thuộc về Domain Design ([Domain Design](../03-domain-design/README.md)) và công nghệ triển khai/runtime thuộc về System Architecture ([System Architecture](../05-system-architecture/README.md)) — application patterns không quyết định cả hai.
- Đây là các mặc định kèm trade-off. Triết lý được nêu của nhóm này: tách Command/Query ở mức logic theo mặc định, chỉ dùng CQRS đầy đủ khi có lý do được chứng minh ([AP-011](../00-governance/architecture-principles.md)); application service chỉ điều phối nhưng không bao giờ trở thành nơi chứa business rule.

## 2. Trách nhiệm của Application Layer

- Định hướng cần bổ sung: nhiệm vụ của application layer là điều phối use case — nhận input, kiểm tra precondition, load aggregate thông qua repository, gọi hành vi của domain, persist, publish event, trả về kết quả — và không gì khác ([AP-010](../00-governance/architecture-principles.md)).
- Định hướng phải xác định không gian phủ định: không chứa business rule thuộc về domain, không chứa chi tiết persistence, không quan tâm đến transport (không dùng kiểu HTTP/gRPC), không đụng trực tiếp vào nội bộ của context khác ([AP-007](../00-governance/architecture-principles.md)).
- Trade-off cần ghi lại: một orchestration layer mỏng tốn thêm một mức indirection; gộp nó vào domain hoặc transport tiết kiệm code nhưng buộc luồng use case vào các mối quan tâm sai. Bài kiểm tra của reviewer: use case đó có chạy được dưới một transport khác mà không cần viết lại logic không?

## 3. Thiết kế Use Case

- Định hướng cần bổ sung: mỗi use case là một operation có tên gọi, đơn mục đích, với input, output, precondition và failure mode được xác định rõ; độ hạt (granularity) của use case theo intent nghiệp vụ, không theo controller endpoint.
- Định hướng phải bao gồm cách một use case ghi nhận kỳ vọng nhất quán của nó (transactional, eventually consistent), yêu cầu authorization của nó, và hành vi idempotency của nó — đây là các thuộc tính reviewer kiểm tra ([Tactical Design Review Checklist](../08-review-process/review-checklists/tactical-design-review.md)).
- Chưa quyết định: catalog use case nào của Ecoma. Thiết kế theo từng context quyết định những use case nào tồn tại (chưa được tạo).

## 4. Xử lý Command

- Định hướng cần bổ sung: command thể hiện ý định thay đổi trạng thái, load aggregate chịu trách nhiệm, để nó thi hành invariant, và persist trong một transaction; một command handler chỉ sở hữu việc điều phối — validation business rule vẫn nằm trong domain ([AP-008](../00-governance/architecture-principles.md)).
- Định hướng phải bao gồm: validation input so với validation nghiệp vụ (mỗi loại diễn ra ở đâu), command trả về cái gì (định danh/xác nhận, không phải trạng thái đầy đủ), và cách báo cáo một command bị từ chối.
- Tư thế mặc định: một command, một aggregate, một transaction. Các luồng liên-aggregate được phối hợp tường minh (xem [Transaction Patterns](transaction-patterns.md)), không phải bằng cách xử lý nhiều aggregate như một transaction không chính thức.

## 5. Xử lý Query

- Định hướng cần bổ sung: query trả về dữ liệu không có side effect nghiệp vụ; được tách khỏi command ở mức logic theo mặc định ([AP-011](../00-governance/architecture-principles.md)). Định hướng phải xác định khi nào một query được phép bỏ qua domain model và đọc trực tiếp một projection hoặc store.
- CQRS đầy đủ (tách read model và write model) chỉ khi có lý do rõ ràng — các lý do điển hình: scale đọc và ghi độc lập, shape đọc thực sự không khớp với write model, read model hướng sự kiện (event-driven). Chi phí cần nêu kèm theo: eventual consistency bị lộ ra phía consumer, trùng lặp model và đồng bộ, nhiều hạ tầng và failure mode hơn.
- Định hướng cũng phải bao gồm quyền sở hữu read model: một read model có nguồn gốc và ngữ nghĩa cập nhật được nêu rõ; consumer được thông báo khi nó có thể bị stale. Chưa quyết định: bất kỳ read model nào của Ecoma.

## 6. Application Service

- Định hướng cần bổ sung: điều gì phân biệt một Application Service với một Domain Service — điều phối so với tính toán thuộc domain ([Modeling Conventions](modeling-conventions.md)) — và khi nào một use case đủ đơn giản để bỏ qua một service object riêng.
- Ưu tiên application service khi một use case có precondition, phạm vi transaction, việc publish event hoặc xử lý thất bại mà nếu không sẽ rò rỉ vào code transport; chấp nhận hàm handler trực tiếp khi việc điều phối là tầm thường.
- Chống mặc định cần ghi nhận: application service tích tụ business rule (điều phối "tự ra quyết định"), điều mà review checklist coi là một khuyết tật.

## 7. Ranh giới Transaction

- Định hướng cần bổ sung: ranh giới transaction được application layer khai báo theo từng use case, thông thường bao trùm một operation trên một aggregate; ranh giới nằm ở đâu với các use case nhiều bước được quyết định tường minh, không bao giờ thừa hưởng từ transport hoặc mặc định của ORM.
- Định hướng phải xác định những gì nằm ngoài transaction (gọi hệ thống ngoài, publish event tùy chiến lược) và vì sao — tương tác giữa outbox và việc publish event nằm trong [Transaction Patterns](transaction-patterns.md).
- Trade-off cần ghi lại: use case một transaction đơn giản nhưng giới hạn khả năng kết hợp; use case nhiều transaction cần suy nghĩ về idempotency và compensation ngay từ đầu.

## 8. Authorization và Kiểm soát truy cập

- Định hướng: authorization được kiểm tra ở ranh giới phù hợp với mức rủi ro — application layer xác thực rằng caller được phép chạy use case; domain vẫn thi hành invariant của chính nó bất kể ai gọi ([AP-014](../00-governance/architecture-principles.md)). Authentication xác lập danh tính không bao giờ hàm ý permission; ngữ nghĩa permission thuộc sở hữu của domain/scope chịu trách nhiệm, không được suy lại riêng lẻ ở từng handler.
- Application layer không được viết lại authorization thuộc sở hữu nơi khác: nơi có một capability authorization ở mức platform, application layer tiêu thụ các quyết định của nó thay vì nhân bản policy.
- Đang mở: hợp đồng chính xác giữa application layer và ngữ nghĩa authorization của platform (định dạng quyết định, điểm enforcement, ngữ nghĩa delegation) chưa được quyết định; tài liệu này chỉ nêu định hướng trên và hoãn phần chi tiết. Truy cập liên-domain yêu cầu policy và delegation tường minh ([AP-014](../00-governance/architecture-principles.md)).

## 9. Xử lý Domain Event

- Định hướng cần bổ sung: các handler cho event phát sinh trong một use case được tổ chức ra sao — xử lý đồng bộ trong transaction so với giao bắt (delivery) bất đồng bộ — và kỳ vọng nhất quán mà mỗi lựa chọn mang lại.
- Định hướng phải bao gồm ngữ nghĩa thất bại của handler: điều gì xảy ra khi một handler thất bại, handler có idempotent hay không, và cách chấp nhận delivery trùng lặp. Delivery guarantee là câu hỏi pattern thuộc sở hữu chung với [Transaction Patterns](transaction-patterns.md).
- Bảo vệ ranh giới: một handler phản ứng với event của một context không được giả định có hiểu biết nội bộ về context sản xuất event vượt ra ngoài hợp đồng của event đó ([AP-007](../00-governance/architecture-principles.md)).

## 10. Tương tác với Hệ thống bên ngoài

- Định hướng cần bổ sung: các cuộc gọi ra bên ngoài được cô lập sau ports ([AP-010](../00-governance/architecture-principles.md)), không bao giờ thực hiện bên trong một domain model, và được phân loại theo tác động nhất quán: bên trong một transaction (nguy hiểm, phải biện luận) hoặc bên ngoài với xử lý compensation/thất bại tường minh.
- Định hướng phải bao gồm kỳ vọng về timeout, retry, circuit-breaking và fallback cho các cuộc gọi đi ra ngoài ([AP-013](../00-governance/architecture-principles.md)) — ở mức pattern; chính sách cụ thể thuộc về System Architecture và các quality attribute ([Reliability](../07-quality-attributes/reliability.md)).
- Đang mở: có tồn tại một capability platform dùng chung cho integration đi ra ngoài hay không và nó đảm bảo những gì. Chưa quyết định — thuộc sở hữu của System Architecture.

## 11. Idempotency và Retry

- Định hướng cần bổ sung: những operation nào phải idempotent (bất cứ thứ gì được retry, redelivered hoặc người dùng lặp lại), và các cơ chế ở mức pattern — idempotency key, cửa sổ deduplication, idempotent tự nhiên nhờ thiết kế — cùng trade-off của từng cách.
- Mặc định: không retry một operation không idempotent nếu không có cơ chế bảo vệ ([AP-013](../00-governance/architecture-principles.md)).
- Định hướng phải nêu cách idempotency tương tác với ranh giới transaction (key được lưu nguyên tử cùng với hiệu ứng, hoặc được hoãn tường minh) — lĩnh vực chung với [Transaction Patterns](transaction-patterns.md); phần này sở hữu kỳ vọng ở mức use case.

## 12. Xử lý Lỗi

- Định hướng cần bổ sung: hệ phân loại lỗi (error taxonomy) tại ranh giới application — lỗi validation, lỗi authorization, từ chối do business rule, xung đột concurrency, lỗi hạ tầng — mỗi loại có một hình dạng riêng, đọc được bằng máy, để các transport layer ánh xạ.
- Định hướng phải xác định ngữ nghĩa thất bại theo từng lớp: loại nào an toàn để retry, loại nào trả về ngay, loại nào cần compensation; và quy tắc rằng các lượt từ chối từ domain bề nổi lên dưới dạng lỗi có ý nghĩa theo domain, không phải các lỗi 500 chung chung.
- Kỳ vọng kiểm chứng: các đường thất bại được test, không chỉ đường thành công ([Tactical Design Review Checklist](../08-review-process/review-checklists/tactical-design-review.md)).

## 13. Hướng dẫn chọn Pattern

- Trình tự quyết định cần bổ sung, mỗi bước với tiêu chí ưu tiên-X-khi-/Y-khi-: (1) đây là command hay query, và việc tách là logic hay vật lý? (2) use case có cần một application service riêng không? (3) ranh giới transaction là gì? (4) operation có phải idempotent không? (5) các cuộc gọi ngoài và việc publish event được xếp trình tự ra sao so với transaction? (6) mỗi thất bại ánh xạ sang lớp lỗi nào?
- Bài kiểm tra nâng cấp lên CQRS đầy đủ: nêu lý do (scaling, shape đọc không khớp, đọc hướng sự kiện), nêu chi phí được chấp nhận, và ghi lại trong context design; không có lý do được nêu nghĩa là chỉ tách ở mức logic.
- Các sai lệch được ghi lại và có thể review theo [Review Workflow](../08-review-process/review-workflow.md).

## 14. Anti-patterns

- Application service sở hữu business rule; điều phối tự ra quyết định.
- Application layer mang hình dạng transport: ngữ nghĩa HTTP, DTO của wire format, hoặc kiểu của framework bên trong logic use case.
- Query có side effect nghiệp vụ; command trả về trạng thái đầy đủ.
- CQRS ở khắp mọi nơi: tách read model mà không có lý do hoặc chi phí được chấp nhận.
- Authorization bị viết lại ở từng handler thay vì tiêu thụ từ nơi sở hữu nó.
- Retry mù quáng các operation không idempotent; các cuộc gọi ngoài bị giấu bên trong transaction.

## 15. Câu hỏi đang mở

- Hợp đồng giữa application layer và ngữ nghĩa authorization của platform: định dạng quyết định, điểm enforcement, khả năng thấy được delegation và revocation.
- Xử lý command/query có dùng một dispatcher pattern chung xuyên các context hay các handler thuần túy theo từng context.
- Hình dạng error taxonomy chuẩn để nhất quán hóa hành vi client xuyên context.
- Có tồn tại một capability platform cho integration đi ra ngoài (timeout/retry/circuit-breaking) hay không; quyền sở hữu nằm ở System Architecture.

## 16. Tài liệu liên quan

- [Modeling Conventions](modeling-conventions.md), [Domain Patterns](domain-patterns.md), [Persistence Patterns](persistence-patterns.md), [Transaction Patterns](transaction-patterns.md) — định hướng tactical liền kề.
- [Tactical Design README](README.md) — tổng quan và triết lý của nhóm tài liệu.
- [Architecture Principles](../00-governance/architecture-principles.md) — AP-007, AP-008, AP-010, AP-011, AP-013, AP-014.
- [Domain Design](../03-domain-design/README.md) — ranh giới context và hợp đồng integration.
- [System Architecture](../05-system-architecture/README.md) — các capability platform và hạ tầng.
- [Reliability](../07-quality-attributes/reliability.md) — kỳ vọng xử lý thất bại.
- [Tactical Design Review Checklist](../08-review-process/review-checklists/tactical-design-review.md).
