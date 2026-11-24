# Integration Contracts

**Trạng thái:** Scaffold — chỉ chứa định hướng cấu trúc; chưa có quyết định kiến trúc nào được review hay phê duyệt.

**Phạm vi:** Integration contract là gì trong kiến trúc của Ecoma, ai sở hữu nó, và một tài liệu contract phải nêu những gì. Scaffold này không định nghĩa bất kỳ contract, API hay message format cụ thể nào.

## 1. Mục đích

Thư mục này sẽ lưu giữ các integration contract của Ecoma: những thỏa thuận tường minh chi phối cách một context tương tác với context khác. README này đặt ra các quy tắc mà mọi tài liệu contract phải tuân theo. Nó không định nghĩa contract nào: theo [SD-010](../../02-domain-discovery/decisions/strategic-decisions.md), các context — và do đó các contract giữa chúng — ra đời sau giai đoạn discovery, và mọi tương tác xuyên context đều yêu cầu một contract tường minh, có chủ sở hữu thay vì coupling ngầm định ([AP-007](../../00-governance/architecture-principles.md)).

## 2. Định nghĩa Integration Contract

Integration contract là một thỏa thuận tường minh, có chủ sở hữu giữa các context, bao gồm những gì được trao đổi, ý nghĩa của chúng, cách chúng có thể tiến hóa, và cách mỗi bên ứng xử khi có sự cố. Nó tồn tại cho cả tương tác đồng bộ (một context yêu cầu một thứ từ context khác) lẫn trao đổi bất đồng bộ (một context phản ứng với facts của context khác) — tầng contract là như nhau; chỉ có ngữ nghĩa là khác.

Hãy ghi nhớ sự phân biệt chung này: một số trao đổi là **event-carried** (consumer subscribe vào các facts, theo [domain-events/README.md](../domain-events/README.md)), những trao đổi khác là **contract point-to-point tường minh** (một consumer được đặt tên phụ thuộc vào interface của một provider được đặt tên). Một trao đổi mang hình thức nào là quyết định về quan hệ, được ghi lại trong context map; tài liệu contract sau đó nêu ngữ nghĩa của hình thức đã chọn.

Contract ghi lại các nghĩa vụ và ý nghĩa, không ghi lại cách hiện thực: schema và payload format là một phần nội dung của contract, nhưng công nghệ hiện thực việc trao đổi là mối quan tâm của [05-system-architecture](../../05-system-architecture/README.md) (xem scaffold kiến trúc integration của nó — đã có cấu trúc, nhưng chưa có quyết định nào được chấp nhận).

## 3. Quyền sở hữu Contract

Mọi contract nêu rõ một chủ sở hữu — mặc định là context provider/producer — chịu trách nhiệm về ngữ nghĩa, sự tiến hóa và các cam kết tương thích của nó. Consumer là những bên tham gia được nêu tên với các nghĩa vụ riêng, không phải người nhận thụ động. Quyền sở hữu phải được ghi lại ngay cả khi provider và consumer nằm trong cùng một domain: điểm mấu chốt của contract là bất kỳ bên nào cũng có thể thay đổi với tác động được kiểm soát ([AP-007](../../00-governance/architecture-principles.md)).

Thay đổi đơn phương là vi phạm điển hình mà tầng này tồn tại để ngăn chặn: chủ sở hữu contract chỉ được tiến hóa contract trong phạm vi chính sách tương thích mà chính contract đó tuyên bố. Trade-off cần ghi lại: contract do producer sở hữu bảo vệ sự tự do của producer nhưng đẩy chi phí thích nghi sang consumer; consumer-driven contract đảo ngược điều này; quyền sở hữu được chọn và hệ quả của nó được nêu cho từng contract.

## 4. Các Context tham gia

Tài liệu contract phải liệt kê mọi context ở mỗi phía của việc trao đổi, vai trò của chúng (provider, consumer, hoặc cả hai), và quan hệ trong context map mà contract này hiện thực. Đây chính là điều khiến impact analysis khả thi: một thay đổi contract được đề xuất phải có thể kiểm tra được đối với một danh sách cụ thể về những ai sẽ bị ảnh hưởng.

Một giới hạn đã biết phải được xử lý trung thực: với các trao đổi kiểu broadcast, toàn bộ tập consumer có thể không biết trước được. Những contract như vậy phải nói rõ điều đó và mang một chính sách tương thích nghiêm ngặt hơn tương ứng, thay vì giả vờ có một danh sách participant khép kín. Contract với consumer không biết trước là lập luận mạnh nhất cho sự tiến hóa bảo thủ ([AP-020](../../00-governance/architecture-principles.md)).

## 5. Ngữ nghĩa Tương tác

Tài liệu contract phải nêu, cho việc trao đổi mà nó chi phối: những operation hay facts nào được trao đổi và mỗi cái có ý nghĩa gì theo thuật ngữ nghiệp vụ; các pre-condition và post-condition mà mỗi bên có thể dựa vào; và, với trao đổi bất đồng bộ, delivery semantics, kỳ vọng về ordering, khả năng trùng lặp, và idempotency yêu cầu. Ý nghĩa được diễn đạt bằng ngôn ngữ nghiệp vụ — một consumer phải có thể hiện thực dựa trên contract mà không cần đọc model của provider.

Ngữ nghĩa cũng bao gồm những gì contract _không_ đảm bảo. Một giả định không được nêu ra ("chúng ta giả định call này là đồng bộ", "chúng ta giả định events đến đúng thứ tự") là nguyên nhân gốc điển hình của các lỗi integration, vì vậy mỗi cam kết được phát biểu như một cam kết, và mọi thứ còn lại là tường minh ngoài phạm vi cam kết.

## 6. Tiến hóa Contract và Tương thích

Mọi contract phải tuyên bố chính sách tương thích và chiến lược versioning trước khi consumer đầu tiên phụ thuộc vào nó ([AP-020](../../00-governance/architecture-principles.md)): những thay đổi nào là non-breaking, thay đổi breaking được đưa vào như thế nào, deprecation trông ra sao, và thứ tự rollout được xử lý ra sao khi provider và các consumer deploy độc lập — các domain của Ecoma không được giả định deploy đồng bộ ([AP-001](../../00-governance/architecture-principles.md)).

Chính sách có thể khác nhau theo từng loại contract — một broadcast event được đọc bởi những consumer không biết trước cần quy tắc nghiêm ngặt hơn một contract hai bên với consumer đã biết — nhưng chính sách phải luôn tồn tại trong chính contract đó, không nằm trong truyền miệng. Contract drift (ngữ nghĩa đã ghi chép lệch khỏi hành vi thực tế) phải phát hiện được; cơ chế là mối quan tâm của 05/implementation, nhưng contract phải nêu những artifact nào là có thẩm quyền để phát hiện nó.

## 7. Ngữ nghĩa Lỗi và Thất bại

Contract phải nêu mỗi error có ý nghĩa gì theo thuật ngữ nghiệp vụ, những failure nào là của consumer và những failure nào là của provider phải xử lý, và một tương tác thất bại có an toàn để retry hay không — điều này lại đòi hỏi phải phát biểu idempotency cho mọi operation có thể retry ([AP-007](../../00-governance/architecture-principles.md), [AP-013](../../00-governance/architecture-principles.md)).

Nó cũng phải nêu các nghĩa vụ của consumer khi provider không khả dụng hoặc chậm: consumer được làm gì, không được làm gì (ví dụ, âm thầm fallback sang nguồn dữ liệu khác vi phạm ownership), và trạng thái consistency nào mà nghiệp vụ nên mong đợi trong thời gian outage. Giả định về distributed transaction hoặc provider luôn khả dụng là bị cấm làm mặc định; nơi mà failure một phần khiến việc trao đổi bị bỏ dở, đường phục hồi là một phần của contract, không phải chi tiết hiện thực.

## 8. Bảo mật và Ủy quyền

Một contract xuyên context phải nêu kỳ vọng authorization của nó: identity nào liên quan, consumer được và không được phép làm gì thông qua contract này, và quyền truy cập delegated hoặc xuyên domain được diễn đạt như thế nào ([AP-014](../../00-governance/architecture-principles.md)). Authentication thiết lập identity; nó không bao giờ thay thế cho một quyết định authorization — một contract cấp quyền truy cập "vì caller là một Ecoma Platform account đã authenticated" là một review finding.

Contract ghi lại kỳ vọng và chính sách, không ghi lại cơ chế: token format, xử lý credential, và công nghệ enforcement là thuộc security architecture ([05-system-architecture](../../05-system-architecture/README.md)) và [security quality attributes](../../07-quality-attributes/security.md). Khi một contract vượt qua ranh giới domain hoặc ranh giới bảo mật, tài liệu contract phải nói rõ điều đó, vì điều đó nâng chuẩn review.

## 9. Observability

Mọi contract phải nêu cách các tương tác dưới nó được correlate và trace: thông tin correlation nào đi kèm một việc trao đổi, để một business transaction trải qua nhiều context có thể được tái dựng chỉ từ các artifact của contract. Điều này đi cặp với các quy tắc correlation của event trong [domain-events/README.md](../domain-events/README.md).

Contract cũng phải nêu những signal quan sát được nào mà consumer và provider có thể dựa vào để phát hiện việc trao đổi đang khỏe mạnh hay đang thất bại — [context map review expectations](../../08-review-process/review-checklists/context-map-review.md) yêu cầu trạng thái integration phải quan sát được. Cái gì được đo, được giữ lại, và được cảnh báo thuộc về [observability quality attributes](../../07-quality-attributes/observability.md) và 05; nghĩa vụ ở tầng contract là các kỳ vọng về correlation và traceability được định nghĩa và ổn định đủ để cả hai bên build dựa trên đó.

## 10. Quy ước đặt tên

Đặt tên tệp contract theo tương tác nghiệp vụ mà nó chi phối, ở dạng kebab-case — theo việc trao đổi, không theo công nghệ, protocol, hay pattern hiện thực nó, và không theo version (versioning nằm trong tài liệu theo chính sách tương thích của nó, để tên tệp ổn định giữa các version). Tên contract nên cho phép người đọc đoán được khu vực nghiệp vụ tham gia mà không cần mở tệp. Cho đến khi các contract đầu tiên xuất hiện, không có scheme cụ thể nào ngoài các quy tắc này được cố định.

## Câu hỏi mở

- Với các trao đổi có consumer không biết trước hoặc trong tương lai (broadcast events), Ecoma nên áp dụng chính sách tương thích mặc định nào — nghiêm ngặt nhất có thể theo mặc định, hay lựa chọn theo từng contract — và ai sở hữu quyết định mặc định đó?
- Mỗi tài liệu contract có nên tham chiếu một quan hệ context-map cụ thể, hay các contract có thể tồn tại cho những trao đổi mà bản ghi quan hệ của chúng vẫn đang ở trạng thái proposed — và một contract như vậy có trạng thái gì?
- Bộ từ vựng error-semantics tối thiểu nào (retryable, permanent, throttled, ...) mà mọi contract nên dùng chung để các consumer xử lý failure thống nhất — và bộ từ vựng đó được sở hữu ở đâu?
- Các yêu cầu correlation ở tầng contract được điều hòa với các scheme correlation theo từng context như thế nào — một quy tắc correlation toàn Ecoma Platform, hay dịch tại các ranh giới?

## 11. Tài liệu liên quan

- [Domain Events](../domain-events/README.md) — các trao đổi event-carried và quy tắc correlation của chúng.
- [Context Maps](../context-maps/README.md) — các quan hệ mà contract hiện thực.
- [Bounded Contexts](../bounded-contexts/README.md) — contract kết nối các context đã được định nghĩa và có chủ sở hữu.
- [Domain Design](../README.md) — định hướng cấp nhóm và workflow.
- [Architecture Principles](../../00-governance/architecture-principles.md) — AP-001, AP-007, AP-013, AP-014, AP-020 chi phối các contract.
- [Decision Process](../../00-governance/decision-process.md) — những thay đổi contract đáng kể là các quyết định.
- [Context Map Review Checklist](../../08-review-process/review-checklists/context-map-review.md) — các bước kiểm tra contract và consistency áp dụng khi review.
- [Security Quality Attributes](../../07-quality-attributes/security.md) và [Observability Quality Attributes](../../07-quality-attributes/observability.md) — nơi các yêu cầu security và observability được phát triển chi tiết.
- [05-system-architecture](../../05-system-architecture/README.md) — sở hữu công nghệ integration, cơ chế security, và hiện thực telemetry.
