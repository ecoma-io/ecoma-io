# Modeling Conventions

- **Trạng thái:** Khung sườn — chỉ chứa định hướng cấu trúc; chưa có quyết định hay quy ước ràng buộc nào đã được review hoặc phê duyệt.
- **Phạm vi:** Từ vựng chung và các khu vực quy ước cho tactical domain modeling bên trong một Bounded Context; tài liệu này xác định những gì một convention phải giải quyết, chứ không phải các quy tắc đã chốt.

## 1. Mục đích và Phạm vi

- Tài liệu này thiết lập từ vựng modeling mà mọi thiết kế Bounded Context có thể dựa vào: Entity, Value Object, Aggregate, Aggregate Root, Domain Service, Domain Event, Repository và Domain Factory được kỳ hiểu nghĩa như thế nào trên toàn bộ Ecoma, và mỗi khu vực convention phải tự tuyên bố những gì về chính nó.
- Nó chuẩn hóa các câu hỏi mà một convention phải trả lời — identity, equality, mutability, responsibility, lifecycle — chứ không phải các câu trả lời: quy tắc cụ thể được chọn theo từng context trong tài liệu thiết kế của nó dưới mục Domain Design (../03-domain-design/README.md), vì các Bounded Context được chủ đích chưa định nghĩa ([Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md)).
- Ranh giới mà tài liệu này bảo vệ: các quy ước mô tả ở đây không bao giờ định nghĩa lại ranh giới của một context hay bịa ra semantics liên context; nơi nào một khu vực convention chưa được thống nhất thì được ghi là mở và nêu trong Open Questions thay vì mặc định ngầm.

## 2. Mục tiêu Modeling

- Mục tiêu mặc định: một rich domain model trong đó behavior đi cùng với data sở hữu nó ([AP-009](../00-governance/architecture-principles.md)) — áp dụng có chọn lọc; DTO, projection và read model có thể giữ là cấu trúc đơn giản.
- Mọi lựa chọn modeling đều phải nói được nó bảo vệ invariant nào ([AP-008](../00-governance/architecture-principles.md)) hay loại bỏ loại phức tạp nào; một abstraction tồn tại chỉ để đáp ứng một pattern là một khiếm khuyết modeling, không phải một convention ([AP-009](../00-governance/architecture-principles.md)).
- Trade-off cần ghi nhận mỗi khi một context đi chệch: model nặng hơn mua được việc bảo vệ invariant và độ chính xác của từ vựng với cái giá là công sức mapping và test; model nhẹ hơn mua được tốc độ và mất đi việc enforce tập trung. Ưu tiên cấu trúc đơn giản nhất bảo vệ được các invariant thực sự tồn tại.
- Mục tiêu cho các convention dùng chung: một contributor di chuyển giữa các context sẽ thấy cùng semantics của building block và cùng kỳ vọng naming, mà không ép các context vào một business model chung ([AP-005](../00-governance/architecture-principles.md)).

## 3. Entity

- Convention phải định nghĩa: điều gì khiến hai instance là một (identity semantics), identity bắt nguồn từ đâu, identity có ý nghĩa bên ngoài context sở hữu hay không, và những lifecycle transition nào một entity sở hữu so với những cái nó chỉ ghi nhận.
- Ưu tiên Entity khi một khái niệm có identity liên tục qua các thay đổi trạng thái; ưu tiên Value Object khi chỉ có giá trị thuộc tính là quan trọng. Convention phải ghi lại câu hỏi quyết định thay vì một danh sách cố định — chưa có entity Ecoma nào được thống nhất.
- Convention còn phải nêu kỳ vọng về cách biểu diễn identity trong code (bọc trong value object hay dùng primitive) như một mặc định kèm trade-off: bọc tốn công sức mapping và đổi lấy type safety tại các ranh giới. Chưa thống nhất cho Ecoma; xem Open Questions.

## 4. Value Object

- Convention phải định nghĩa: kỳ vọng về immutability, equality theo giá trị, validation tại thời điểm construction (một value object không hợp lệ không được phép được tạo ra), và khi nào Value Object được ưu tiên hơn primitive hay Entity.
- Ưu tiên Value Object cho các khái niệm được validate, so sánh hoặc truyền đi như một khối nguyên vẹn trong nhiều hơn một flow; chỉ chấp nhận primitive ở những chỗ khái niệm không mang behavior nào đáng bảo vệ. Mỗi context vẽ ranh giới đó ở đâu chưa được thống nhất cho Ecoma.
- Convention phải nêu cách Value Object tương tác với persistence mapping mà không để các vấn đề mapping rò rỉ ngược vào model — cách xử lý ở mức pattern nằm trong [Persistence Patterns](persistence-patterns.md).

## 5. Aggregate

- Convention phải định nghĩa: một Aggregate là một consistency boundary bảo vệ một hoặc nhiều invariant một cách transactional ([AP-008](../00-governance/architecture-principles.md)), với Aggregate Root là điểm vào duy nhất cho mọi thay đổi trạng thái.
- Convention phải ghi lại định dạng biện minh: mỗi ranh giới aggregate được biện minh bằng invariant và nhu cầu transaction, không bao giờ bằng hình dáng object graph, bảng database hay màn hình. Một context tài liệu hóa lời biện minh đó thế nào là câu hỏi convention mà tài liệu này nắm giữ; còn các ranh giới là quyết định của từng context.
- Convention còn phải chốt các kỳ vọng mặc định cho tham chiếu liên aggregate (theo identity) và cách suy luận về các command đồng thời tác động vào một aggregate. Chưa quyết định: bất kỳ aggregate Ecoma cụ thể nào — tất cả điều đó thuộc về thiết kế theo từng context (chưa được tạo).

## 6. Aggregate Root

- Convention phải định nghĩa: root enforce các invariant của aggregate trong mọi thay đổi trạng thái, kiểm soát truy cập vào các thành phần nội bộ, và là đơn vị truy xuất và lưu transactional.
- Mặc định kèm trade-off: giữ aggregate nhỏ; chỉ mở rộng ranh giới khi một invariant thực sự không thể enforce theo cách khác. Các quy tắc vắt qua nhiều aggregate được xử lý bằng các consistency strategy tường minh (xem [Transaction Patterns](transaction-patterns.md)), không phải bằng cách nới rộng ranh giới.
- Bảo vệ ranh giới: root là public contract của aggregate; code bên ngoài aggregate không được chạm tay vào các thành phần nội bộ. Quy tắc đó được enforce cơ học thế nào (compile-time hay công cụ kiểm tra ranh giới) là việc của Monorepo Architecture ([AP-016](../00-governance/architecture-principles.md)); tài liệu này chỉ nêu quy tắc logic.

## 7. Domain Service

- Convention phải định nghĩa khi nào behavior thuộc về một Domain Service: domain behavior không có nơi tự nhiên trong một Entity, Value Object hay Aggregate duy nhất — dùng một cách tiết chế ([AP-009](../00-governance/architecture-principles.md)).
- Convention phải yêu cầu một Domain Service nêu lý do vì sao behavior của nó không thuộc về một model object hiện có; một service layer tích lũy business rules sẽ làm model trở nên anemic và đánh bại mục tiêu rich model.
- Convention phải tách biệt semantics của Domain Service và Application Service: domain services tính toán kết quả thuộc domain; application services orchestrate use case (xem [Application Patterns](application-patterns.md)). Quy ước naming và placement giữa các context chưa được thống nhất; xem Open Questions.

## 8. Domain Event

- Convention phải định nghĩa: một Domain Event diễn đạt một sự kiện nghiệp vụ có ý nghĩa với domain, được viết ở thì quá khứ và bằng ngôn ngữ nghiệp vụ; convention phải chốt một event phải chứa gì và không được tham chiếu tới gì.
- Convention phải phân biệt các event chỉ có ý nghĩa bên trong một context với các event vượt qua ranh giới context: các event liên context và contract của chúng thuộc quyền sở hữu của Domain Design ([AP-007](../00-governance/architecture-principles.md)); tài liệu này chỉ nắm convention modeling nội bộ.
- Publication semantics — khi nào một event được raise so với transaction, và delivery được đảm bảo thế nào — là câu hỏi pattern cho [Application Patterns](application-patterns.md) và [Transaction Patterns](transaction-patterns.md), không phải modeling convention.
- Mở: liệu Ecoma có yêu cầu một event envelope dùng chung cho các event nội bộ, hay để hình dạng event theo từng context. Chưa quyết định; xem Open Questions.

## 9. Repository

- Convention phải định nghĩa: một Repository là một abstraction ở mức domain trên persistence cho một Aggregate Root, diễn đạt bằng từ vựng domain, với interface do phía domain sở hữu và implementation do infrastructure sở hữu ([AP-010](../00-governance/architecture-principles.md)).
- Convention phải nêu một repository interface được và không được expose gì — không có kiểu của persistence framework trong signature, các query method được đặt tên theo thuật ngữ domain — mà không chốt bất kỳ công nghệ lưu trữ nào; lựa chọn storage thuộc về System Architecture.
- Mở: liệu truy cập phía đọc có phải đi qua repository hay được phép đi vòng cho các query theo hướng dẫn CQS trong [Application Patterns](application-patterns.md). Chưa quyết định; xem Open Questions.

## 10. Domain Factory

- Convention phải định nghĩa khi nào creation logic được chuyển ra khỏi constructor vào một Domain Factory: việc tạo lập lắp ráp nhiều khái niệm, enforce các invariant liên thành phần, hay sinh identity — so với việc tạo đơn giản ở mức constructor kèm validation.
- Ưu tiên constructor cho việc tạo đơn giản, tự validate; ưu tiên Factory khi việc tạo có invariant thực sự mà nếu không sẽ bị rải rác khắp các caller. Convention ghi lại câu hỏi quyết định, chứ không ra lệnh xây factory ở khắp nơi.
- Mở: liệu factory có đảm nhiệm luôn reconstitution từ persistence, hay reconstitution là trách nhiệm của repository/mapping (xem [Persistence Patterns](persistence-patterns.md)). Chưa quyết định.

## 11. Module và Package Boundaries

- Phần này chỉ định nghĩa kỳ vọng về layering logic: domain layer không phụ thuộc vào framework, transport hay infrastructure; application layer orchestrate domain và phụ thuộc vào abstraction; infrastructure implement các port mà các lớp bên trong định nghĩa ([AP-010](../00-governance/architecture-principles.md)).
- Bố cục vật lý — các layer ánh xạ vào package, project hay library như thế nào, và công cụ nào enforce điều đó — thuộc quyền Monorepo Architecture; xem [Monorepo Architecture](../06-monorepo-architecture/README.md). Tài liệu này chỉ yêu cầu layering phải kiểm tra được một cách cơ học ở mức khả thi ([AP-016](../00-governance/architecture-principles.md), [AP-018](../00-governance/architecture-principles.md)).
- Bảo vệ ranh giới: module của một context không được import internals của context khác; integration tuân theo các contract được định nghĩa ở mức context ([AP-005](../00-governance/architecture-principles.md), [AP-007](../00-governance/architecture-principles.md)). Domain boundary, module boundary và deployment boundary vẫn là các khái niệm riêng biệt ([AP-006](../00-governance/architecture-principles.md)).

## 12. Naming Conventions

- Convention phải chuẩn hóa naming cho các building block — entity, value object, aggregate và root, domain service, domain event, repository, factory — để một reviewer có thể suy ra vai trò từ tên, với tên được lấy từ ubiquitous language của context (glossary ở mức discovery: [Domain Glossary](../02-domain-discovery/domain-glossary.md)).
- Convention phải chốt: ngôn ngữ của identifier (tiếng Anh, theo policy của repository), naming ở số ít cho khái niệm, tên event ở thì quá khứ, và có bắt buộc suffix theo layer hay không. Các quy ước suffix cụ thể chưa được thống nhất — sẽ là quá sớm trước khi có context đầu tiên.
- Mở: liệu việc kiểm tra naming có được tự động hóa (lint rule) theo [AP-018](../00-governance/architecture-principles.md) và ai sở hữu chúng — thuộc phạm trù Monorepo Architecture; nêu trong Open Questions để phối hợp.

## 13. Invariant Enforcement

- Convention phải định nghĩa: mọi invariant đều có một owner được đặt tên — một aggregate, value object, hay domain service — và được enforce tại ranh giới chịu trách nhiệm về nó ([AP-008](../00-governance/architecture-principles.md)); không bao giờ chỉ dựa vào validation ở UI hay API.
- Convention phải cung cấp các câu hỏi phân loại mà một context trả lời cho từng invariant: nó có luôn đúng trong ranh giới không (enforce trong model), hay là eventually consistent qua các ranh giới (nêu rõ strategy)? Behavior dưới các command đồng thời là gì?
- Kỳ vọng xác minh: behavior của invariant — các case thành công, contention và thất bại — được chứng minh bằng test ở các mức phù hợp; reviewer kiểm tra điều này theo [Tactical Design Review Checklist](../08-review-process/review-checklists/tactical-design-review.md).

## 14. Modeling Anti-patterns

- Các mục anti-pattern cần ghi nhận, mỗi mục kèm một tín hiệu quan sát được và phương án thay thế ưu tiên: model anemic với logic nằm trong service; invariant chỉ được enforce ở mép hệ thống; aggregate bị chia nhỏ đến mức một invariant vắt qua nhiều transactional unit; god aggregate phản chiếu database; pattern ritual (object được tạo ra chỉ vì một pattern tồn tại); khái niệm persistence rò rỉ vào domain model; event được phát ra cho những mutation vô nghĩa.
- Các mục giữ tính tổng quát — không nêu bất kỳ case riêng của Ecoma nào, vì chưa có case nào; ví dụ minh họa cụ thể sẽ nằm trong [Examples](examples/README.md) một khi các convention đã ổn định.

## 15. Open Questions

- Biểu diễn identity: identity bọc trong value object so với primitive; phạm vi duy nhất theo từng context so với toàn Ecoma Platform.
- Liệu có cần một event envelope dùng chung cho domain event nội bộ, hay hình dạng event giữ theo từng context.
- Liệu truy cập phía đọc có được đi vòng repository cho các query hay không.
- Liệu Domain Factory có sở hữu việc reconstitution từ persistence hay không.
- Quy ước suffix naming cụ thể theo từng layer, và liệu chúng có được enforce bằng lint hay không.
- Liệu bất kỳ convention nào ở đây trở thành ràng buộc cho từng context thông qua một quyết định Accepted, hay giữ là mặc định mang tính tham khảo — từ vựng trạng thái theo [Decision Process](../00-governance/decision-process.md): chỉ Accepted mới có hiệu lực.

## 16. Tài liệu liên quan

- [Tactical Design README](README.md) — tổng quan nhóm và triết lý tactical design.
- [Domain Patterns](domain-patterns.md), [Application Patterns](application-patterns.md), [Persistence Patterns](persistence-patterns.md), [Transaction Patterns](transaction-patterns.md) — hướng dẫn pattern xây dựng trên từ vựng này.
- [Examples](examples/README.md) — ví dụ minh họa; chưa có ví dụ nào.
- [Architecture Principles](../00-governance/architecture-principles.md) — AP-005 đến AP-010, AP-016, AP-018.
- [Monorepo Architecture](../06-monorepo-architecture/README.md) — bố cục module vật lý và enforcement ranh giới.
- [Tactical Design Review Checklist](../08-review-process/review-checklists/tactical-design-review.md) — những gì reviewer kiểm tra dựa trên các quy ước này.
