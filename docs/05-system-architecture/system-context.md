# System Context

**Trạng thái:** Scaffold — chỉ là định hướng cấu trúc; chưa chứa quyết định kiến trúc nào đã được review hoặc phê duyệt.

**Phạm vi:** View system context ở C4 Level 1: những gì nằm bên trong và bên ngoài boundary của hệ thống Ecoma, và những trách nhiệm mà hệ thống đảm nhận đối với external actor và external system.

## 1. Tổng quan về hệ thống

- Sẽ nêu, ở mức trừu tượng cao nhất, hệ thống đang xét là gì: hiện thực kỹ thuật của một marketplace đơn sản phẩm với hai domain cung ứng mà khuôn khổ kinh doanh của nó đã được xác lập — hai domain vận hành tự chủ trên Ecoma Platform trong khi cùng tiến về một trải nghiệm tích hợp và một mô hình kinh doanh tích hợp ([Ecoma Strategy](../01-strategy/ecoma-strategy.md), [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md)).
- Phải trả lời: hệ thống phục vụ mục đích gì, những business fact đã xác lập nào giới hạn nó, và "hệ thống" được vẽ ở granularity nào — trên toàn Ecoma Platform, theo từng domain, hay theo nhiều tầng.
- Diagram context ở C4 Level 1 sẽ được ghi nhận tại đây một khi quyết định về boundary đã tồn tại; scaffold này không khẳng định điều gì.
- Phải phân biệt Ecoma Platform và các domain như đối tượng chiến lược với hệ thống kỹ thuật được mô tả tại đây: tên "Ecoma" bao hàm cả hai, và file này nêu rõ nó đang nói về đối tượng nào ([AP-002](../00-governance/architecture-principles.md)).
- File này chỉ bổ sung khung kỹ thuật của hệ thống như một tổng thể; nó không nhắc lại nội dung discovery.

## 2. System Boundary

- Sẽ xác định ranh giới giữa những gì hệ thống chịu trách nhiệm và những gì nó không — ranh giới mà mọi viewpoint khác trong nhóm này xây dựng bên trong nó.
- Phải trả lời: những trách nhiệm nào nằm bên trong, những gì được xác định là out of scope, và boundary dựa trên quyết định đã được chấp nhận nào.
- Bảo vệ: một business boundary đã xác lập không bị vẽ lại chỉ vì một cấu trúc kỹ thuật sẽ thuận tiện hơn ([AP-004](../00-governance/architecture-principles.md)).
- Phải trả lời những hoạt động lân cận nào được giữ bên ngoài boundary một cách có chủ đích — công việc kinh doanh do con người và tổ chức thực hiện chứ không phải do hệ thống — để trách nhiệm bên trong hệ thống không bị phình ra để bao phủ chúng.
- Lựa chọn boundary tự thân là một quyết định System Architecture và sẽ được tham chiếu tại đây một khi được chấp nhận; cho đến lúc đó mọi thứ bên trong boundary đều chưa được quyết định.

## 3. External Actors

- Sẽ lập danh mục các actor nằm ngoài boundary có tương tác với hệ thống; mỗi mục nêu mối quan hệ của nó với hệ thống và trích dẫn quyết định discovery đã xác lập nó.
- Discovery đã giới hạn những ai phải xuất hiện một khi danh mục được lập: những người được xác thực đằng sau một Ecoma Account dùng chung, consumers, providers — cùng những phân biệt đã xác lập giữa Provider Identity, Provider Actor và Provider Qualification ([Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md)). Không điều nào trong số này ấn định cách actor tiếp cận hệ thống về mặt kỹ thuật.
- Việc các actor dạng Application/Agent đã được chốt tại [ID-013](../02-domain-discovery/decisions/account-identity-decisions.md): máy không phải chủ thể độc lập, chỉ hành động theo ủy quyền (OAuth2 scope giới hạn hoặc API key scoped); các câu hỏi còn lại thuộc hiện thực hóa design.
- Danh mục actor cụ thể **còn phải được lập**; scaffold này không khẳng định danh sách actor nào.

## 4. External Systems

- Sẽ lập danh mục các hệ thống nằm ngoài boundary mà hệ thống phụ thuộc vào hoặc bị hệ thống khác phụ thuộc; mỗi mục ghi nhận mục đích, hướng phụ thuộc, chủ sở hữu của hệ thống kia, và quyết định đã đưa nó vào.
- Các mục phân biệt những hệ thống mà hệ thống này phụ thuộc vào với những hệ thống phụ thuộc vào hệ thống này; hai hướng này mang các cách xử lý rủi ro, review và failure khác nhau.
- Có thể dự đoán trước một số nhóm ứng viên từ các dòng chảy thương mại đã xác lập — payment handling, email verification and delivery, identity proofing — nhưng không có external system cụ thể nào được nêu tên, lựa chọn hay thiết kế tại đây; tập hợp này **còn phải được lập**.
- Những gì thuộc về danh mục này thay đổi theo các quyết định thương mại chưa được quyết định, chẳng hạn trạng thái Merchant of Record và settlement flow ([Discovery Backlog](../02-domain-discovery/discovery-backlog.md)); danh mục sẽ được xem xét lại khi những quyết định đó chốt.

## 5. Domain và Ecoma Platform Relationships

- Sẽ ghi nhận system context dung nạp hai domain cung ứng trên một Ecoma Platform — mỗi domain vận hành tự chủ trong khi dùng chung các năng lực nền tảng — như thế nào ([Ecoma Strategy](../01-strategy/ecoma-strategy.md), [AI Factory Marketplace](../01-strategy/ai-factory-marketplace.md)).
- Việc điều này được vẽ như một context trên toàn Ecoma Platform, một context cho mỗi domain, hay kết hợp cả hai là một câu hỏi cấu trúc còn mở (Mục 10); lựa chọn này ràng buộc các viewpoint [container](container-architecture.md) và [integration](integration-architecture.md).
- Phải giữ cho thấy domain autonomy là một invariant đã xác lập ([AP-001](../00-governance/architecture-principles.md)) và tích hợp kỹ thuật không bao giờ làm gộp business ownership (SD-004).
- Federated operations (SD-040) định hình bản ghi này: các operational capability dùng chung có thể nằm ở cấp Ecoma Platform trong khi các operation riêng của domain vẫn ở cấp domain — context phải cho thấy mỗi relationship thuộc về phía nào ([Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md)).

## 6. System Responsibilities

- Sẽ liệt kê những gì hệ thống chịu trách nhiệm và — một cách tường minh — những gì nó không, ở mức trừu tượng mà boundary xác định.
- Mọi phát biểu về trách nhiệm đều phải truy vết được về business ownership đã xác lập: [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md), [Business Capability Map](../02-domain-discovery/business-capability-map.md) và về sau là các định nghĩa Bounded Context. Một trách nhiệm không có business owner là một khoảng trống discovery cần đưa trở lại, không phải một sáng chế kỹ thuật.
- Sẽ phân biệt những trách nhiệm được sở hữu ở cấp Ecoma Platform — một cách chọn lọc, theo selective consistency ([Constraints](../01-strategy/constraints.md)) — với những trách nhiệm được sở hữu theo từng domain; Account identity dùng chung là ví dụ cấp Ecoma Platform đã xác lập ([Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md)).
- Các phát biểu về trách nhiệm được diễn đạt để có thể kiểm chứng khi review: với mỗi trách nhiệm, người reviewer có thể hỏi quyết định nào xác lập nó và bằng chứng nào sẽ cho thấy nó được tuân thủ.

## 7. External Dependencies

- Sẽ ghi nhận mọi dependency của hệ thống vào những gì nằm ngoài boundary của nó, kèm criticality và kỳ vọng về failure cho từng mục.
- Mỗi mục phải trả lời: điều gì ngừng hoạt động nếu dependency này không khả dụng, và điều đó có thể chấp nhận được hay không xét theo các [reliability expectation](../07-quality-attributes/reliability.md) ([AP-013](../00-governance/architecture-principles.md))?
- Danh mục trống cho đến khi external system được lập danh (Mục 4); các dependency phát sinh từ những câu hỏi thương mại hoặc identity chưa được quyết định được liệt kê là Open Question, không phải là mục của danh mục.

## 8. Trust Boundaries

- Sẽ đánh dấu mọi đường mà dữ liệu hoặc request vượt qua giữa các mức trust khác nhau: actor đến hệ thống, hệ thống đến external system, và — nếu quyết định cấu trúc đòi hỏi — giữa các zone bên trong portfolio.
- Mỗi mục boundary sẽ nêu những gì phải được kiểm chứng tại điểm vượt qua; cơ chế enforcement thuộc về [viewpoint bảo mật](security-architecture.md), không phải file này.
- Phải giữ nhất quán với các identity boundary đã xác lập ở bước discovery: authentication không phải authorization, và việc kiểm soát một email không phải identity ([Security expectations](../07-quality-attributes/security.md)).
- Khi data classification tồn tại (xem [viewpoint dữ liệu](data-architecture.md)), mỗi mục boundary sẽ ghi nhận những class thông tin nào vượt qua nó.

## 9. Key Interaction Scenarios

- Sẽ đi qua các tương tác end-to-end định hình context — registration và email verification, chấp nhận lời mời, provider onboarding, giao dịch thương mại — như đã xác lập ở bước discovery, mỗi scenario trích dẫn những quyết định làm nền cho nó.
- Với mỗi scenario, ghi nhận những actor nào tham gia, những boundary nào bị vượt qua, và những kỳ vọng availability và consistency nào mà nó tạo ra — đó là input mà các viewpoint [container](container-architecture.md) và [runtime](runtime-architecture.md) tiêu thụ.
- Các scenario chỉ được mô tả ở mức context: không có flow, message format hay hành vi component nào được thiết kế tại đây.
- Tập hợp scenario chỉ lớn lên từ các process được Discovery và Domain Design xác lập; scenario không bao giờ bịa ra business flow để biện minh cho cấu trúc kỹ thuật.

## 10. Open Questions

- System context nên được vẽ một lần cho toàn bộ Ecoma Platform, một lần cho mỗi domain, hay dưới dạng các context phân tầng — và thẩm quyền nào quyết định lựa chọn đó?
- External actor được lập danh mục ở granularity nào: natural person, tổ chức, Provider Actor, hay cách biểu diễn identity dạng Application/Agent? (cơ chế đã chốt tại [ID-013](../02-domain-discovery/decisions/account-identity-decisions.md): không chủ thể máy độc lập, chỉ hành động theo ủy quyền; việc lập danh mục cụ thể là hiện thực hóa design)
- Những external system nào trở thành dependency cấp context một khi các flow liên quan đến settlement (refund, chargeback, trạng thái Merchant of Record) được quyết định?
- Các trust boundary cấp Ecoma Platform có thay đổi khi delegation dạng Application/Agent (cơ chế đã chốt tại [ID-013](../02-domain-discovery/decisions/account-identity-decisions.md)) được đưa vào identity model hay không? — hiện thực hóa design.
- Những key interaction scenario nào trở thành bản ghi context first-class trước tiên, và chúng được xác nhận theo thứ tự review nào?

## 11. Related Documents

- [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md) — actor, ownership và boundary đã xác lập.
- [Business Capability Map](../02-domain-discovery/business-capability-map.md) và [Discovery Backlog](../02-domain-discovery/discovery-backlog.md) — độ bao phủ capability và các chủ đề chưa quyết định.
- [Ecoma Strategy](../01-strategy/ecoma-strategy.md) và [AI Factory Marketplace](../01-strategy/ai-factory-marketplace.md) — cấu trúc domain mà context này phải dung nạp.
- [Security expectations](../07-quality-attributes/security.md) — các fact về identity và trust boundary đã xác lập ở bước discovery.
- [Architecture Principles](../00-governance/architecture-principles.md) và [Decision Process](../00-governance/decision-process.md) — quy tắc đánh giá và ghi nhận quyết định.
- [System Architecture Review Checklist](../08-review-process/review-checklists/system-architecture-review.md) — việc review file này sẽ kiểm tra những gì.
- Các viewpoint cùng cấp: [container](container-architecture.md), [deployment](deployment-architecture.md), [runtime](runtime-architecture.md), [security](security-architecture.md), [data](data-architecture.md), [integration](integration-architecture.md).
