# Context Maps

**Trạng thái:** Scaffold — chỉ chứa định hướng cấu trúc; chưa có quyết định kiến trúc nào được review hay phê duyệt.

**Phạm vi:** Context Map là gì trong kiến trúc Ecoma, khi nào phải tạo một bản, và một relationship record phải ghi lại những gì. Scaffold này không định nghĩa relationship nào giữa các context của Ecoma.

## 1. Mục đích

Thư mục này sẽ chứa các context map của Ecoma: ghi chép về cách các Bounded Context liên hệ với nhau — ai ảnh hưởng ai, ai nợ gì cho ai, và ở đâu các model phải được dịch chuyển. README này đặt ra các quy tắc mà mọi context map phải tuân theo. Nó không định nghĩa relationship cụ thể nào: relationship chỉ có thể được ghi lại khi các context tham gia đã tồn tại ([SD-010](../../02-domain-discovery/decisions/strategic-decisions.md)), và một đường nối giữa hai context chưa được định nghĩa không phải là context map, mà chỉ là phỏng đoán.

## 2. Context Map là gì

Context map là bản ghi về các relationship mang tính logic giữa các Bounded Context đã được định nghĩa: với mỗi relationship, ghi rõ các bên tham gia và vai trò của họ, lý do relationship tồn tại, nghĩa vụ mỗi bên mang theo, và phần dịch chuyển model cần thiết giữa hai bên. Đây là một artifact mang tính ngữ nghĩa, không phải hệ thống diagram — không được nhầm nó với container diagram, network topology, hay data-flow diagram, vốn thuộc về [05-system-architecture](../../05-system-architecture/README.md).

Một phép thử hữu ích: nếu đọc xong một context map mà không học được gì về nghĩa vụ, hướng ảnh hưởng, hay phần dịch chuyển model, thì đó chỉ là một bản vẽ hình vuông và đường kẻ, không phải context map. [Review checklist](../../08-review-process/review-checklists/context-map-review.md) từ chối rõ ràng những relationship mang tính "một kết nối không có ngữ nghĩa".

## 3. Khi nào tạo Context Map

Tạo hoặc cập nhật context map khi hai hay nhiều context đã được định nghĩa tương tác theo cách tạo ra nghĩa vụ: bên này cần dữ kiện của bên kia, bên này tuân theo model của bên kia, hoặc một thay đổi ở bên này buộc bên kia phải phản ứng. Một context map được giới hạn theo mục đích của nó — một context map bao phủ một chủ đề integration là hợp lệ; không bắt buộc phải có một "map của mọi thứ" duy nhất, và thứ đó thường bị lỗi thời nhanh chóng.

Không tạo context map nào trước khi các context tham gia được định nghĩa, và một thay đổi trong định nghĩa của một context sẽ kích hoạt việc review mọi context map có chứa nó. Thay đổi relationship tuân theo kỷ luật quyết định giống như thay đổi boundary ([Decision Process](../../00-governance/decision-process.md)).

## 4. Mô hình hóa Relationship giữa các Context

Một relationship record phải ghi lại, với mỗi relationship:

- **Các bên tham gia và vai trò** — những context nào, và vai trò của từng context trong relationship cụ thể này (xem mục 5).
- **Lý do tồn tại** — nhu cầu nghiệp vụ biện minh cho sự coupling; một relationship không có lý do được nêu ra là một review finding.
- **Hướng ảnh hưởng và hướng phụ thuộc** — model của ai chiếm ưu thế, ai phải thích nghi theo ai.
- **Nghĩa vụ hai chiều** — mỗi bên bảo đảm điều gì và mỗi bên được phép dựa vào điều gì (xem mục 5).
- **Nhu cầu dịch chuyển model** — chỗ nào ý nghĩa khác nhau và ai thực hiện việc chuyển đổi (xem mục 6).

Các pattern name trong tài liệu DDD — Shared Kernel, Customer–Supplier, Conformist, Anti-Corruption Layer, Open Host Service — chỉ được dùng như viết tắt khi semantics được ghi lại thực sự khớp với nghĩa vụ của pattern đó; review checklist cảnh báo rõ ràng đừng viết tên một pattern thay cho mô tả thực sự. Trade-off cần tôn trọng: gọi tên một pattern tiết kiệm chỗ nhưng che giấu chi tiết cụ thể; chính chi tiết cụ thể làm cho context map có thể được review, vì vậy nhãn pattern không bao giờ thay thế được bản ghi nghĩa vụ.

## 5. Trách nhiệm của Upstream và Downstream

Upstream và downstream được xác định theo hướng ảnh hưởng: các quyết định về model và contract của context phía upstream chảy về phía context downstream, vốn phụ thuộc vào chúng. Relationship record phải nêu rõ hướng này một cách tường minh, vì mọi nghĩa vụ khác đều bắt nguồn từ nó.

Nghĩa vụ điển hình của upstream: cung cấp contract ổn định, báo trước các breaking change, sở hữu sự tiến hóa của contract. Nghĩa vụ điển hình của downstream: thích nghi với model của upstream hoặc dịch chuyển nó, chấp nhận các failure mode đã thỏa thuận, không vòng qua contract. Trade-off mang tính cấu trúc: sự tuân thủ (conformity) của downstream rẻ để xây dựng nhưng buộc model downstream vào các quyết định của upstream; một translation layer tường minh bảo vệ model downstream nhưng tốn chi phí bảo trì liên tục. Việc chọn trade nào cho một relationship được ghi lại, không được mặc định.

## 6. Biên giới Integration và Dịch chuyển Model

Context map ghi lại việc phần dịch chuyển model phải xảy ra _ở đâu_ và _ai sở hữu_ nó: việc dịch chuyển diễn ra tại biên của context được bảo vệ, và quyền sở hữu nó bắt nguồn từ hướng ảnh hưởng của relationship. Context map còn phải nêu rõ những chỗ ý nghĩa giống hệt nhau và không cần dịch chuyển — ghi "không cần dịch chuyển, ý nghĩa khớp nhau theo quyết định" quan trọng ngang với ghi một phần dịch chuyển, vì đó là một tuyên bố mà reviewer có thể thách thức.

Context map ghi lại relationship mang tính logic và các nghĩa vụ dịch chuyển model, **không phải protocol hay cơ chế**. Các integration pattern cụ thể, transport, và lựa chọn công nghệ thuộc về [05-system-architecture](../../05-system-architecture/README.md) (xem scaffold kiến trúc integration của nó — đã có cấu trúc, nhưng chưa có quyết định nào được chấp nhận), nơi tiêu thụ relationship được định nghĩa tại đây. Nếu một context map bắt đầu gọi tên công nghệ hay message format, nó đã đi vượt qua phạm vi của 05.

## 7. Quyền sở hữu Dữ liệu và Tính nhất quán

Với mọi khái niệm được trao đổi trong một relationship, bản ghi phải nêu nguồn sự thật (source of truth) — context nào sở hữu dữ liệu — và kỳ vọng tính nhất quán giữa hai bên: tức thì, transactional trong một boundary, hay eventual ([AP-015](../../00-governance/architecture-principles.md)). Khi tính nhất quán là eventual, bản ghi phải nêu mức độ stale được chấp nhận và cách consumer hành xử khi dữ liệu còn stale.

Hai quy tắc không thể thương lượng trong review: không context nào ghi dữ liệu của context khác, và không relationship nào mặc định dùng truy cập trực tiếp vào internal storage của context khác làm cơ chế integration của nó ([AP-007](../../00-governance/architecture-principles.md)). Cả hai pattern này đều xóa bỏ ranh giới sở hữu mà context tồn tại để bảo vệ. Khi dùng trao đổi bất đồng bộ, các kỳ vọng về retry, duplicate, ordering, và idempotency được ghi lại theo checklist.

## 8. Quy ước đặt tên

Đặt tên file context map theo phạm vi và mục đích mà nó bao phủ, viết kebab-case — theo chủ đề hay tập hợp relationship được ghi lại, không theo tên các pattern nó dùng và không theo công nghệ liên quan. Mỗi context map nêu phạm vi và mục đích của mình ngay từ đầu, để người đọc biết nó tuyên bố quản lý những relationship nào; review checklist yêu cầu điều này. Cho đến khi những context map thực sự đầu tiên được viết, không có tên file nào được cố định ngoài các quy tắc này.

## 9. Kỳ vọng Review

Các context map được review dựa trên [Context Map Review Checklist](../../08-review-process/review-checklists/context-map-review.md). Hãy kỳ vọng reviewer sẽ kiểm tra, trong số những thứ khác:

- Mọi context tham gia đều đã được định nghĩa và có chủ sở hữu, và vai trò khớp với hướng phụ thuộc thực tế.
- Context map không trùng lặp toàn bộ định nghĩa của các context tham gia, và phạm vi cùng mục đích riêng của nó được nêu rõ.
- Mọi relationship đều có ngữ nghĩa, lý do, quyền sở hữu contract, và mô tả thích hợp — không dùng nhãn pattern thay cho mô tả.
- Circular dependency và strong coupling được nhận diện thay vì để ngầm định.
- Contract, kỳ vọng tính nhất quán, retry/duplicate/ordering/idempotency, hành vi khi lỗi, và đường phục hồi được bao phủ ở những chỗ liên quan; không mặc định đọc dữ liệu nội bộ của context khác.
- Tiến hóa và vận hành: phát hiện contract drift, kế hoạch migration/deprecation, tác động khi một context không khả dụng, trạng thái integration có thể quan sát được, và tác động vượt ranh giới domain/bảo mật.
- Phê duyệt: chủ sở hữu các context bị ảnh hưởng, Architecture Owner, và Domain Owner đã review; Decision Record và contract catalog đã được cập nhật.

## Câu hỏi mở

- Ecoma nên duy trì một context map cho mỗi chủ đề integration, một cho mỗi lần vượt ranh giới domain, hay cả hai — và mức độ chi tiết nào sống sót qua review tốt hơn khi số lượng context tăng lên?
- Một context map nên ghi lại relationship với các context đã được lên kế hoạch nhưng chưa được định nghĩa như thế nào — các placeholder entry có trạng thái tường minh, hay loại trừ cho đến khi context tồn tại?
- Ranh giới nằm ở đâu giữa "nghĩa vụ dịch chuyển model" (context map) và "cơ chế dịch chuyển model" (05-system-architecture) cho một relationship cụ thể đã được dự kiến — có cần một ví dụ cụ thể để chốt vấn đề này trước context map thực sự đầu tiên không?

## 10. Tài liệu liên quan

- [Bounded Contexts](../bounded-contexts/README.md) — context map chỉ liên hệ các context đã được định nghĩa tại đó.
- [Domain Events](../domain-events/README.md) — một cách phổ biến để diễn đạt nghĩa vụ giữa các context.
- [Integration Contracts](../integration-contracts/README.md) — các thỏa thuận tường minh đứng sau một relationship.
- [Domain Design](../README.md) — định hướng cấp nhóm và workflow.
- [Strategic Domain Model](../../02-domain-discovery/strategic-domain-model.md) — các quan hệ nghiệp vụ đã được thiết lập mà các context map ứng viên phải tôn trọng.
- [Business Capability Map](../../02-domain-discovery/business-capability-map.md) — các tương tác cấp capability gợi ý relationship giữa các context.
- [Architecture Principles](../../00-governance/architecture-principles.md) — AP-005, AP-007, AP-015 điều chỉnh quyền sở hữu và integration.
- [Decision Process](../../00-governance/decision-process.md) — thay đổi relationship là các quyết định.
- [Context Map Review Checklist](../../08-review-process/review-checklists/context-map-review.md) — chuẩn review thực tế.
- [05-system-architecture](../../05-system-architecture/README.md) — tiêu thụ relationship; sở hữu integration pattern và công nghệ.
