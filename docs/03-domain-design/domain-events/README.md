# Domain Events

**Trạng thái:** Bản khung — chỉ chứa hướng dẫn về cấu trúc; chưa có quyết định kiến trúc nào được review hoặc phê duyệt.

**Phạm vi:** Domain event là gì trong kiến trúc Ecoma, ai sở hữu nó, và một định nghĩa event cần nắm bắt những gì. Bản khung này không định nghĩa event cụ thể nào và không có nội dung event catalog.

## 1. Mục đích

Thư mục này sẽ chứa định nghĩa các domain event của Ecoma và một catalog của chúng. README này đặt ra các quy tắc mà mọi định nghĩa event phải tuân theo. Nó không định nghĩa event nào: các event nêu ra business fact của những context chưa tồn tại ([SD-010](../../02-domain-discovery/decisions/strategic-decisions.md)), và việc bịa tên event ở đây sẽ tạo ra các contract không có chủ sở hữu.

## 2. Định nghĩa Domain Event

Một domain event nêu ra một business fact đã xảy ra trong context sở hữu nó: điều mà doanh nghiệp quan tâm và đã xảy ra, được diễn đạt bằng ubiquitous language của chính context đó và ở thì quá khứ.

Một event là một fact, không phải một lệnh hay một yêu cầu — nếu tên của nó mô tả điều mà ai đó muốn xảy ra, đó là một intent, không phải event.

Một định nghĩa event phải nêu rõ fact, ý nghĩa của nó trong model của chủ sở hữu, và thông tin mà nó mang theo. Nó phải có ý nghĩa đối với doanh nghiệp, chứ không chỉ là một thông báo thay đổi dữ liệu: "một dòng đã được cập nhật" là vấn đề của database, không phải domain event ([AP-005](../../00-governance/architecture-principles.md)).

Sự đánh đổi về granularity là có thật và phải được quyết định cho từng event, không phải theo thói quen: event fine-grained cho consumer độ chính xác nhưng làm nhân lên bề mặt mà chủ sở hữu phải giữ tương thích; event coarse-grained rẻ hơn để bảo trì nhưng buộc consumer phải tự suy ra những fact lẽ ra họ phải được thông báo. Một định nghĩa event mà không thể nói rõ vì sao nó được publish ở granularity đã chọn thì chưa hoàn chỉnh.

## 3. Sở hữu Domain Event

Mọi domain event được sở hữu bởi context nơi fact xảy ra — chỉ riêng context đó định nghĩa ý nghĩa của event, payload semantics, và sự tiến hóa của nó. Consumer thích ứng với event; event không thích ứng với consumer. Nếu hai context đều cần "cùng một" fact, mỗi context vẫn diễn đạt nó bằng ngôn ngữ của riêng mình và việc dịch giữa các dạng xảy ra tại các boundary, theo [context map](../context-maps/README.md).

Sở hữu bao gồm nghĩa vụ tiến hóa event một cách tương thích hoặc di chuyển consumer một cách có chủ đích — chủ sở hữu không thể thay đổi ý nghĩa của event một cách âm thầm ([AP-007](../../00-governance/architecture-principles.md), [AP-020](../../00-governance/architecture-principles.md)). Đánh đổi cần ghi lại: việc publish một event rộng rãi làm tăng giá trị của nó nhưng làm nó cứng nhắc trước thay đổi; giữ event riêng tư trong context của nó cho đến khi có một consumer bên ngoài với lý do đã được review để tồn tại.

## 4. Ý nghĩa nghiệp vụ và Điều kiện kích hoạt

Mỗi định nghĩa event phải trả lời: business fact nào đã xảy ra, điều gì trong context của chủ sở hữu đã kích hoạt nó (thay đổi state nào hay process đã hoàn thành nào), và sự kiện đó bảo đảm — và không bảo đảm — điều gì về state của chủ sở hữu tại thời điểm đó. Đây là thứ cho phép consumer suy luận về event mà không cần đọc internals của producer.

Một định nghĩa còn phải ghi lại những gì event _không phải_: những fact mà consumer có thể suy đoán sai. Các event là fact tại một thời điểm; consumer cần state hiện tại được bảo đảm thì không được coi event là câu trả lời cho một query. Việc ghi lại các anti-guarantee này ngay từ đầu ngăn ngừa lỗi sử dụng phổ biến nhất của consumer.

## 5. Domain Event vs Integration Event

Giữ hai lớp này tách biệt. Một **domain event** là business fact như được định nghĩa bằng ngôn ngữ của chủ sở hữu, nằm nội bộ trong boundary của chủ sở hữu. Một **integration event** là những gì các context khác thực sự subscribe — một contract với quyền sở hữu, tính tương thích và quy tắc lỗi riêng. Hai thứ này liên quan nhưng không giống nhau: việc dịch từ domain event sang integration event xảy ra tại boundary của producer, và kết quả được điều chỉnh bởi các nghĩa vụ dịch của context map và bởi [integration contract](../integration-contracts/README.md) cho trao đổi đó.

Không phải mọi domain event đều trở thành integration event: việc publish một event cho các context khác là một quyết định về quan hệ với chi phí bảo trì, được đưa ra theo context map — không phải mặc định. Ngược lại, một integration event mà chỉ làm lộ internal model của producer sẽ buộc consumer phải conform theo nó; đánh đổi giữa việc phơi sáng rẻ tiền và model được bảo vệ được ghi lại cho từng trao đổi, không quyết định một lần cho tất cả các event.

## 6. Định danh và Correlation của Event

Mỗi định nghĩa event phải chỉ định định danh ổn định và thông tin correlation: một identifier duy nhất xác định occurrence của event, identifier của các business concept mà nó liên quan, và các tham chiếu correlation liên kết nó với business process hoặc các event đứng trước mà nó thuộc về. Correlation là thứ cho phép consumer tái dựng một câu chuyện nghiệp vụ xuyên qua các context; thiếu một quy tắc correlation được ghi lại, mỗi consumer tự bịa một — và chúng sẽ rời rạc nhau.

Bản khung này không cố định định dạng identifier; định dạng là một phần của thiết kế contract cụ thể và có thể phụ thuộc vào các quyết định chưa được đưa ra. Điều được cố định ở đây: một định nghĩa event là chưa hoàn chỉnh nếu consumer không thể trả lời "occurrence nào, về business thing nào, thuộc flow nào". Thông tin correlation cũng là join key cho review: khi reviewer truy vết một business flow xuyên qua các context, các event không có correlation buộc việc truy vết phải được tái dựng bằng đoán mò — chính là điều mà [context map checklist](../../08-review-process/review-checklists/context-map-review.md) coi là một finding.

## 7. Versioning và Tiến hóa của Event

Mọi event family phải nêu chính sách compatibility của nó trước khi consumer đầu tiên xuất hiện ([AP-020](../../00-governance/architecture-principles.md)): những thay đổi nào là additive và an toàn, những thay đổi nào là breaking, một thay đổi breaking được triển khai thế nào khi producer và consumer deploy độc lập, và một phiên bản deprecated được hỗ trợ trong bao lâu. Việc tiến hóa tuân theo các quy tắc contract chung trong [integration-contracts/README.md](../integration-contracts/README.md).

Đánh đổi cần ghi rõ: compatibility nghiêm ngặt giữ mọi consumer an toàn nhưng tích lũy gánh nặng phiên bản; tiến hóa mạnh tay giữ event sạch sẽ nhưng buộc thay đổi đồng bộ giữa các context được sở hữu độc lập. Chính sách cho từng event family — không phải một phán quyết toàn cục — giải quyết điều này, và sự trôi dạt giữa hình dạng event được tài liệu hóa và thực tế phải phát hiện được theo [context map review expectations](../context-maps/README.md).

## 8. Kỳ vọng về Consistency

Việc publish một event tự nó không bảo đảm delivery, thứ tự, hay xử lý exactly-once — đó là các thuộc tính của trao đổi, và mỗi định nghĩa event (hoặc integration contract của nó) phải nêu rõ consumer có thể dựa vào điều gì: delivery semantics, bảo đảm thứ tự hoặc sự vắng mặt của nó, khả năng trùng lặp, và idempotency mà consumer do đó phải duy trì ([AP-007](../../00-governance/architecture-principles.md)).

Các event mô tả fact sau khi fact đã xảy ra; consumer phải coi state liên context tạo ra là eventually consistent trừ khi một contract bảo đảm rõ ràng nhiều hơn.

Một định nghĩa hứa hẹn "consumer sẽ thấy điều này ngay lập tức và đúng một lần" mà không có contract được chấp nhận chống lưng cho lời hứa đó là một review finding. Công nghệ hiện thực hóa các bảo đảm này — broker, transport, storage — nằm ngoài phạm vi ở đây và thuộc về [05-system-architecture](../../05-system-architecture/README.md) (xem integration architecture scaffold của nó — đã có cấu trúc, nhưng chưa có quyết định nào được chấp nhận).

## 9. Quy ước đặt tên

Đặt tên event là các business fact ở thì quá khứ bằng ubiquitous language của chủ sở hữu — sự kiện nghiệp vụ, không phải cơ chế mang nó.

Tên phải giữ ổn định xuyên suốt quá trình tiến hóa của payload, vì consumer coupling vào nó; đổi tên một event đã publish là một thay đổi breaking được xử lý theo chính sách versioning, không phải một việc dọn dẹp. Tránh prefix hoặc suffix bắt nguồn từ công nghệ trong tên; transport là vô hình ở lớp này. Cho đến khi các event đầu tiên được định nghĩa, không có sơ đồ đặt tên cụ thể nào ngoài các quy tắc này được cố định, và catalog dự kiến (`domain-events/event-catalog.md`, theo [docs/README.md](../../README.md) — đã lên kế hoạch, chưa được tạo) sẽ index các event theo chủ sở hữu và lĩnh vực nghiệp vụ.

## Open Questions

- Nơi nào là index có thẩm quyền của các event đã định nghĩa — `event-catalog.md` dự kiến, hay tài liệu riêng của context sở hữu — và review sẽ coi cái nào là nguồn chân lý?
- Catalog có nên liệt kê chỉ các integration event (những gì các context khác có thể consume) hay cả các domain event nội bộ, xét đến sự phân biệt ở mục 5?
- Thông tin correlation tối thiểu nào mà mọi event phải mang trên toàn Ecoma Platform (nếu có), so với correlation riêng của từng chủ sở hữu — việc sở hữu concept ở cấp Ecoma Platform được thiết lập trong discovery có đủ để biện minh cho một quy tắc dùng chung không?
- Một định nghĩa event nên tham chiếu điều kiện kích hoạt của nó (một business process, một lifecycle transition) như thế nào khi các tài liệu process và lifecycle mà nó phụ thuộc chưa tồn tại — forward reference, hay trì hoãn cho đến khi các artifact đó được chấp nhận?

## 10. Tài liệu liên quan

- [Integration Contracts](../integration-contracts/README.md) — điều chỉnh các trao đổi mà event di chuyển trong đó.
- [Context Maps](../context-maps/README.md) — quyết định event nào vượt qua boundary nào và ai dịch.
- [Bounded Contexts](../bounded-contexts/README.md) — event được sở hữu bởi một context đã định nghĩa.
- [Domain Design](../README.md) — định hướng và workflow ở cấp nhóm.
- [Strategic Domain Model](../../02-domain-discovery/strategic-domain-model.md) — các business fact được thiết lập bởi discovery.
- [Discovery Backlog](../../02-domain-discovery/discovery-backlog.md) — các câu hỏi nghiệp vụ còn mở có thể buộc tạo event mới sau này.
- [Architecture Principles](../../00-governance/architecture-principles.md) — AP-005, AP-007, AP-020 điều chỉnh các event và sự tiến hóa của chúng.
- [Decision Process](../../00-governance/decision-process.md) — việc publish một event xuyên context là một quyết định.
- [Context Map Review Checklist](../../08-review-process/review-checklists/context-map-review.md) — bao gồm các kiểm tra contract và consistency cho các quan hệ dựa trên event.
- [05-system-architecture](../../05-system-architecture/README.md) — sở hữu công nghệ transport và delivery.
