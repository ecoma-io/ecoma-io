# Các Persistence Pattern

- **Trạng thái:** Scaffold — mới chỉ có định hướng cấu trúc; chưa chứa quyết định nào đã được review hoặc phê duyệt, cũng chưa có quy ước ràng buộc nào.
- **Phạm vi:** Hướng dẫn cấp pattern cho việc ánh xạ aggregate và model vào storage bên trong một Bounded Context: trách nhiệm của repository, sự tách biệt giữa domain model và persistence model, kiểm soát concurrency, ràng buộc toàn vẹn dữ liệu, tiến hóa schema và lưu trữ read model. Không phải là một lựa chọn cơ sở dữ liệu hay công cụ.

## 1. Mục đích và phạm vi áp dụng

- Tài liệu này sẽ chứa hướng dẫn cấp pattern về việc lưu trữ các model của một context: aggregate ánh xạ vào storage như thế nào, repository hứa hẹn điều gì, concurrency được kiểm soát ra sao, và schema tiến hóa theo cách nào — tất cả ở cấp pattern.
- Ranh giới rõ ràng: lựa chọn data store cụ thể, công nghệ lưu trữ và các quyết định quyền sở hữu dữ liệu thuộc về System Architecture (các tài liệu data-architecture của nhóm đó; xem [System Architecture](../05-system-architecture/README.md) cho nhóm đó). Không có gì ở đây gọi tên hay giả định một cơ sở dữ liệu, ORM, storage engine hay quy ước schema nào cho Ecoma (quyền sở hữu theo [AP-015](../00-governance/architecture-principles.md) vẫn thuộc về các quyết định sở hữu của nó).
- Áp dụng trong một Bounded Context sau khi đã được định nghĩa; đây là các mặc định kèm trade-offs, có thể đi lệch nếu ghi lại lý do theo [Review Workflow](../08-review-process/review-workflow.md).

## 2. Quyền sở hữu persistence

- Hướng dẫn cần bổ sung: persistence thuộc về context sở hữu nó — không context nào khác đọc hay ghi trực tiếp vào storage của nó; mọi truy cập từ bên ngoài đều đi qua các contract ([AP-015](../00-governance/architecture-principles.md), [AP-007](../00-governance/architecture-principles.md)).
- Hướng dẫn phải bao gồm các phân biệt mà quy tắc sở hữu đòi hỏi: dữ liệu vận hành (operational data), projection và dữ liệu nhân bản (replicated data), mỗi loại có source of truth và ngữ nghĩa cập nhật được nêu rõ.
- Ranh giới mà nó bảo vệ: việc chia sẻ schema tạo ra coupling không được quản lý bị loại bỏ ở cấp pattern; còn ranh giới sở hữu dữ liệu thực tế của Ecoma nằm ở đâu do System Architecture và Domain Design quyết định, không phải ở đây.

## 3. Trách nhiệm của repository

- Hướng dẫn cần bổ sung: một repository hứa hẹn việc truy xuất và lưu trữ một Aggregate Root theo thuật ngữ domain; nó che giấu cách storage hoạt động, trả về các aggregate đã được dựng hoàn chỉnh, và không bao giờ để lộ kiểu dữ liệu của storage qua giao diện của nó ([AP-010](../00-governance/architecture-principles.md)).
- Hướng dẫn phải xác lập tập kỳ vọng: những gì repository bảo đảm (tính nhất quán khi lưu, tra cứu dựa trên identity), những gì nó không bảo đảm (truy vấn chéo qua nhiều aggregate, quyết định nghiệp vụ), và đánh đổi giữa giao diện kiểu collection với giao diện truy vấn được thiết kế cho mục đích cụ thể.
- Chưa quyết định: phía đọc có được bỏ qua repository khi truy vấn hay không (xem phần Query Handling trong [Application Patterns](application-patterns.md)); đang được theo dõi trong Open Questions.

## 4. Lưu trữ aggregate

- Hướng dẫn cần bổ sung: một aggregate được lưu trữ nguyên vẹn trong một transaction — lần lưu phản ánh một trạng thái nhất quán của ranh giới, dù bằng cách ghi toàn bộ entity, chiến lược delta/diff, hay trạng thái suy ra từ event; hướng dẫn so sánh các cách này với trade-offs của chúng mà không chọn cách nào.
- Hướng dẫn phải bao gồm việc ánh xạ cấu trúc aggregate (root, entity bên trong, value object) sang cấu trúc lưu trữ một cách tổng quát — one-to-one, embedded, normalized — như các lựa chọn với trade-off về coupling và chi phí truy vấn, chứ không phải một quy tắc cố định.
- Chưa quyết định: bất kỳ mapping persistence nào của Ecoma. Thiết kế từng context quyết định, với System Architecture sở hữu nền tảng lưu trữ (storage substrate).

## 5. Ánh xạ giữa domain model và persistence model

- Hướng dẫn cần bổ sung: hướng mặc định — domain model định hình cách ánh xạ vào storage, không phải ngược lại ([AP-010](../00-governance/architecture-principles.md)); persistence model, DTO và read model có thể giữ ở dạng cấu trúc đơn giản ở những nơi không có invariant nào tồn tại ([AP-009](../00-governance/architecture-principles.md)).
- Hướng dẫn phải bao gồm trade-off giữa việc dùng một model duy nhất cho cả domain và persistence (ít code hơn, rủi ro schema rò rỉ vào model) và các model tách biệt với mapping tường minh (cách ly tốt, tốn thêm chi phí mapping) — ưu tiên tách biệt khi hình dạng storage làm méo mó domain model; chấp nhận model dùng chung khi hình dạng thực sự trùng khớp.
- Điểm kiểm tra: reviewer kiểm tra rằng các mối quan tâm về persistence không rò rỉ vào chính sách domain ([Tactical Design Review Checklist](../08-review-process/review-checklists/tactical-design-review.md)).

## 6. Lưu trữ theo transaction

- Hướng dẫn cần bổ sung: phía persistence của ranh giới transaction mà application layer khai báo ([Application Patterns](application-patterns.md)) — việc "lưu một aggregate" nghĩa là gì một cách nguyên tử (atomic), các thao tác repository tham gia vào transaction bao quanh như thế nào, và điều gì xảy ra với trạng thái đã được tải khi rollback.
- Hướng dẫn phải nêu các lựa chọn pattern cho việc xuất bản event tương đối với persistence (cùng transaction, outbox, post-commit) và trì hoãn tiêu chí chọn lựa cho [Transaction Patterns](transaction-patterns.md).
- Chưa quyết định: bất kỳ cơ chế transaction cụ thể hay cấu hình isolation nào cho Ecoma — phụ thuộc vào storage, thuộc về các quyết định của System Architecture.

## 7. Kiểm soát concurrency

- Hướng dẫn cần bổ sung: mọi aggregate có thể nhận các lệnh chạy đồng thời (concurrent commands) đều có một chiến lược concurrency được nêu rõ; câu hỏi ở cấp pattern là detect-and-reject hay serialize, và một xung đột trông như thế nào đối với caller ([AP-008](../00-governance/architecture-principles.md)).
- Hướng dẫn phải bao gồm các công cụ chung — versioning, conditional writes, serialization ở tầng storage — như các lựa chọn với trade-off về contention và độ trễ, mà không gọi tên công nghệ cụ thể.
- Kỳ vọng kiểm tra: hành vi concurrency được test khi có invariant nào có thể bị ảnh hưởng bởi sự cạnh tranh ([Tactical Design Review Checklist](../08-review-process/review-checklists/tactical-design-review.md)).

## 8. Optimistic và pessimistic locking

- Hướng dẫn cần bổ sung: ưu tiên optimistic concurrency (kiểm tra version, retry hoặc từ chối khi xung đột) khi contention thấp và retry rẻ; ưu tiên pessimistic locking khi contention cao, các thao tác kéo dài, hoặc chi phí compensation chiếm ưu thế — các tiêu chí này, cùng trade-offs (độ cũ dữ liệu so với việc chặn (staleness versus blocking)), được nêu ở cấp pattern.
- Hướng dẫn phải bao gồm cách lựa chọn locking được ghi lại cho từng aggregate trong thiết kế context, để reviewer có thể kiểm tra rằng các aggregate nóng không vô tình dùng optimistic và các aggregate lạnh không dùng pessimistic một cách máy móc.
- Chưa quyết định: bất kỳ chính sách locking nào của Ecoma — lựa chọn theo từng context dựa trên contention được đo đạc, không phải một quy tắc áp dụng chung.

## 9. Toàn vẹn dữ liệu và ràng buộc

- Hướng dẫn cần bổ sung: sự phân công thực thi invariant giữa domain model và các constraint ở tầng storage — model thực thi invariant trong transaction ([AP-008](../00-governance/architecture-principles.md)); các constraint ở tầng storage (uniqueness, quy tắc tham chiếu) là một lớp defense-in-depth hỗ trợ phía sau model, không bao giờ là điểm thực thi duy nhất, và không bao giờ thay thế được model.
- Hướng dẫn phải bao gồm những loại constraint nào thuộc về storage bất chấp (uniqueness mà các write chạy đồng thời có thể vượt qua trong race), và cách vi phạm được chuyển hóa ngược thành các lỗi có ý nghĩa domain thay vì lỗi storage thô.
- Chưa quyết định: bất kỳ constraint nào của Ecoma. Các constraint schema cụ thể là quyết định của context/System Architecture.

## 10. Tiến hóa schema

- Hướng dẫn cần bổ sung: các thay đổi schema được lập kế hoạch với lý luận về tính tương thích ([AP-020](../00-governance/architecture-principles.md)) — các pattern expand/contract, tính tương thích ngược cho các deployment đang chạy, kỳ vọng về migration và rollback — dưới dạng hướng dẫn cấp pattern; việc chọn công cụ migration là vùng của System Architecture.
- Hướng dẫn phải bao gồm các câu hỏi review: thay đổi này có làm hỏng các reader/writer đang chạy không? có thể triển khai mà không cần deployment phối hợp không? dữ liệu cũ được migration hay được diễn giải khi đọc?
- Kỳ vọng kiểm tra: migration và tính tương thích ngược được xem xét trong review ([Tactical Design Review Checklist](../08-review-process/review-checklists/tactical-design-review.md)).

## 11. Lưu trữ read model

- Hướng dẫn cần bổ sung: một read model là một projection có source được nêu rõ, một cơ chế cập nhật (đồng bộ, event-driven, theo lịch), và một hợp đồng về độ cũ dữ liệu (staleness contract) dành cho consumer; các pattern lưu trữ projection khác với persistence vận hành và phải được xử lý riêng.
- Hướng dẫn phải bao gồm các trade-offs: projection đồng bộ (đơn giản, nhất quán, dính chặt) với projection event-driven (mở rộng tốt, eventually consistent, cần cập nhật idempotent và cơ chế bắt kịp).
- Việc tách biệt CQRS/read model đầy đủ vẫn đòi hỏi các lý do đã được chứng minh từ [Application Patterns](application-patterns.md); phần này chỉ điều chỉnh persistence sau khi read model đã tồn tại.

## 12. Nguyên tắc chọn pattern

- Chuỗi quyết định cần bổ sung với các tiêu chí prefer-X-when/Y-when: (1) model dùng chung hay tách domain model/persistence model? (2) ghi toàn bộ aggregate hay chiến lược delta? (3) optimistic hay pessimistic concurrency cho từng aggregate? (4) constraint nào nằm ở storage làm lớp hậu thuẫn? (5) read model có được chấp nhận không, và nếu có thì đồng bộ hay event-driven?
- Ngưỡng leo thang (escalation test): mọi lựa chọn vượt ra ngoài phương án đơn giản nhất (model dùng chung, ghi toàn bộ aggregate, optimistic locking, không read model) đều nêu lý do cần thiết — contention, không khớp hình dạng, quy mô — và chi phí được chấp nhận, ghi lại trong thiết kế context.
- Các quyết định về công nghệ lưu trữ, công cụ migration và quyền sở hữu dữ liệu được tham chiếu, không được đưa ra, ở đây — chúng nằm ở System Architecture.

## 13. Anti-patterns

- Domain model mang hình dạng storage: các aggregate được thiết kế xung quanh bảng hoặc document thay vì xung quanh invariant.
- Repository để lộ kiểu dữ liệu storage hay ngôn ngữ truy vấn vào code domain/application.
- Dùng schema chung làm phương thức tích hợp: một context khác đọc hay ghi các bảng của context này ([AP-015](../00-governance/architecture-principles.md)).
- Ràng buộc như một suy nghĩ sau (afterthought): invariant chỉ được thực thi trong storage, hoặc chỉ trong code, không có câu chuyện defense-in-depth nào cho các race.
- Read model không có chủ: projection với source, cơ chế cập nhật hay staleness contract không được nêu rõ.
- Thay đổi schema một cách mù quáng: breaking change mà không có lý luận về tính tương thích hay con đường rollback ([AP-020](../00-governance/architecture-principles.md)).

## 14. Open Questions

- Repository có được bắt buộc chỉ cho phía ghi hay không, và phía truy vấn có thể bỏ qua chúng đến mức nào.
- Ecoma có chuẩn hóa một phong cách persistence-mapping duy nhất cho mỗi domain, hay để từng context tự quyết.
- Các định nghĩa constraint ở tầng storage được phối hợp với thiết kế context như thế nào (ai review các schema constraint).
- Có tồn tại chính sách migration/tương thích chung ở cấp System Architecture mà file này nên tham chiếu một khi được tạo ra hay không.

## 15. Tài liệu liên quan

- [Modeling Conventions](modeling-conventions.md), [Domain Patterns](domain-patterns.md), [Application Patterns](application-patterns.md), [Transaction Patterns](transaction-patterns.md) — hướng dẫn tactical liền kề.
- [Tactical Design README](README.md) — tổng quan về nhóm và triết lý chung.
- [Architecture Principles](../00-governance/architecture-principles.md) — AP-007, AP-008, AP-009, AP-010, AP-015, AP-020.
- [System Architecture](../05-system-architecture/README.md) — sở hữu các quyết định về data store, công cụ và data-architecture.
- [Domain Design](../03-domain-design/README.md) — ranh giới context xác định quyền sở hữu persistence.
- [Tactical Design Review Checklist](../08-review-process/review-checklists/tactical-design-review.md).
