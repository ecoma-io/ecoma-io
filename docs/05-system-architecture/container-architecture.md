# Kiến trúc Container

**Trạng thái:** Scaffold — chỉ mang tính định hướng cấu trúc; chưa chứa quyết định kiến trúc nào đã được review hoặc phê duyệt.

**Phạm vi:** Góc nhìn container ở C4 Level 2 như một cấu trúc ghi nhận: các đơn vị kỹ thuật bên trong ranh giới hệ thống cùng trách nhiệm, quyền sở hữu và dependencies của chúng. Danh mục được cố ý để trống cho đến khi các quyết định về container được chấp nhận.

## 1. Tổng quan Kiến trúc

- "Container" được dùng ở đây theo nghĩa khái niệm trong góc nhìn C4: một đơn vị kỹ thuật có thể chạy độc lập bên trong ranh giới hệ thống. Nó không hàm ý công nghệ packaging, hosting hay infrastructure nào, và không container nào của Ecoma được liệt kê trong scaffold này.
- Sẽ tóm tắt sự phân rã container khi các quyết định về container tồn tại; hiện tại file này chỉ định nghĩa những gì mọi mục nhập trong tương lai phải ghi nhận.
- Bảo vệ: container được định hình bởi trách nhiệm và quyền sở hữu đã được xác lập, không bởi sở thích công nghệ ([AP-004](../00-governance/architecture-principles.md)); số lượng container là kết quả của các quyết định có căn cứ, không phải một mục tiêu.

## 2. Danh mục Container

- Sẽ chứa danh sách chính thức các container khi được chấp nhận: mỗi container một mục với identifier ổn định, tóm tắt trách nhiệm, và liên kết đến quyết định đã tạo ra hoặc thay đổi gần nhất nó.
- Danh mục được **để trống có chủ đích**: việc liệt kê các ứng viên ở đây sẽ quyết định trước một sự phân rã mà không quyết định nào hỗ trợ.
- Mục nhập chỉ được thêm hoặc thay đổi thông qua các quyết định được chấp nhận theo [decision process](../00-governance/decision-process.md).
- Một mục container mà trách nhiệm được chấp nhận gần nhất của nó bị xóa sẽ được retire thông qua một quyết định; không để lại các mục trống.

## 3. Trách nhiệm của Container

- Định nghĩa mẫu ghi nhận trách nhiệm chuẩn cho mỗi container: các trách nhiệm nghiệp vụ đã được xác lập mà nó thực hiện, mỗi trách nhiệm được truy vết đến nguồn của nó — một định nghĩa Bounded Context dưới docs/03-domain-design/bounded-contexts/ (chưa được tạo) hoặc [Business Capability Map](../02-domain-discovery/business-capability-map.md).
- Mỗi mục phải trả lời: đơn vị này thực hiện những trách nhiệm nào, nó rõ ràng **không** chịu trách nhiệm về những gì, và — nếu một đơn vị chỉ thực hiện một phần của context — chính xác phần nào và vì sao.
- Chống trôi dạt trách nhiệm: hai đơn vị cùng tuyên bố một trách nhiệm, hoặc một đơn vị âm thầm chiếm lấy một trách nhiệm, là các lỗi kiến trúc bị phát hiện khi review.

## 4. Ranh giới Container

- Sẽ ghi nhận, cho mỗi container, ranh giới đó chứa những gì, cái gì đi qua nó, và vì sao nó nằm ở vị trí đó.
- Một ranh giới tách một domain boundary hoặc gộp nhiều ranh giới phải mang lý do được ghi nhận ([AP-006](../00-governance/architecture-principles.md), [AP-012](../00-governance/architecture-principles.md)); không có ánh xạ nào như vậy tồn tại cho đến khi được biện luận.
- Giữ ba loại ranh giới tách biệt: domain boundaries (thuộc Domain Design), module boundaries (thuộc Monorepo Architecture) và các ranh giới container và deployment (thuộc file này). Một phát biểu về loại này không bao giờ được thay thế cho loại khác.

## 5. Giao tiếp Nội bộ

- Sẽ ghi nhận cách các container giao tiếp với nhau: với mỗi cặp có tương tác, kiểu tương tác, tham chiếu contract, và kỳ vọng về failure.
- Kiểu tương tác được ghi nhận cho mỗi relationship như một kết quả quyết định — file này không quy định kiểu nào; các tiêu chí đánh giá nằm ở [integration viewpoint](integration-architecture.md), mà file này tuân theo để tránh phân kỳ.
- Bản thân các contract là artifacts thuộc domain do Domain Design sở hữu; file này chỉ ghi nhận các sự kiện giao tiếp ở cấp hệ thống.

## 6. Giao tiếp Bên ngoài

- Cùng cấu trúc ghi nhận như giao tiếp nội bộ, cho các cạnh đi qua ranh giới hệ thống đến các actor và hệ thống được liệt kê trong [system context](system-context.md).
- Mỗi mục nêu rõ ai khởi tạo, ranh giới trust nào bị đi qua, và kỳ vọng availability và consistency nào được áp dụng.
- Các cạnh bên ngoài thừa nhận sự tồn tại của chúng từ context catalogue; file này không thể đưa vào một communicator bên ngoài mà context không liệt kê.

## 7. Quyền Sở hữu Dữ liệu

- Sẽ ghi nhận, cho mỗi container, dữ liệu nào nó nắm giữ với tư cách source of truth và dữ liệu nào nó chỉ nắm giữ như projection, cache hay replica ([AP-015](../00-governance/architecture-principles.md)).
- Các mục quyền sở hữu phải truy vết được đến quyền sở hữu ở domain: một container chỉ có thể sở hữu dữ liệu nơi Bounded Context sở hữu đã được xác lập — các định nghĩa dưới docs/03-domain-design/bounded-contexts/ (chưa được tạo) sẽ được trích dẫn rõ ràng.
- Không công nghệ lưu trữ nào được chọn ở đây; các quyết định lưu trữ thuộc về [data viewpoint](data-architecture.md).

## 8. Quan hệ Dependency

- Sẽ ghi nhận dependency graph giữa các container: ai phụ thuộc vào ai, cho capability nào, và với mức độ criticality nào.
- Với mỗi cạnh, phải trả lời: dependency có bắt buộc cho vận hành cốt lõi không, mức degradation nào chấp nhận được khi đích không khả dụng, và cạnh có cắt qua một ranh giới sở hữu mà một contract nên điều phối không ([AP-007](../00-governance/architecture-principles.md))?
- Graph là đầu vào chính cho phân tích failure isolation đối chiếu với [reliability expectations](../07-quality-attributes/reliability.md).

## 9. Dependency lúc Runtime

- Sẽ ghi nhận những gì mỗi container cần có mặt lúc runtime để khởi động và để phục vụ: configuration, secrets, identity, peer discovery, backing services — được ghi nhận như yêu cầu, không phải cơ chế.
- Mỗi mục trả lời: hành vi của đơn vị lúc startup và trong vận hành ra sao nếu dependency này bị thiếu — những câu hỏi mà [runtime viewpoint](runtime-architecture.md) giải quyết khi đã được quyết định.

## 10. Độc lập khi Deploy

- Sẽ ghi nhận, cho mỗi container hoặc nhóm container, nó có được deploy độc lập không và vì sao trade-off đó được chấp nhận ([AP-012](../00-governance/architecture-principles.md)).
- Phần đánh giá cân nhắc lợi ích — release autonomy, failure isolation, blast radius — với chi phí: operational complexity, quản lý environment, và kỷ luật versioning contract ([AP-020](../00-governance/architecture-principles.md)).
- Các container luôn được deploy cùng nhau được ghi nhận là một deployment group, để [deployment viewpoint](deployment-architecture.md) không tách chúng ra một cách vô tình.

## 11. Ràng buộc Kiến trúc

- Sẽ liệt kê các ràng buộc mà mọi quyết định về container phải thỏa mãn, mỗi ràng buộc được liên kết đến nguồn của nó: các invariant và guideline từ [Architecture Principles](../00-governance/architecture-principles.md) (nổi bật là AP-004, AP-006, AP-007, AP-012, AP-015), kỳ vọng chất lượng từ [quality attribute records](../07-quality-attributes/reliability.md), và các ràng buộc chiến lược ([Constraints](../01-strategy/constraints.md)).
- Các ràng buộc chiến lược có ảnh hưởng trực tiếp đến container: shared platform capabilities không được hấp thụ chính sách nghiệp vụ domain (SD-004), và không capability nào được xây trước khi nhu cầu được chứng minh (không over-engineering).
- Mỗi mục nêu rõ ràng buộc là invariant (phải được tuân giữ) hay guideline (mọi lệch chuẩn phải được biện luận), theo cách phân loại của principles.

## 12. Câu hỏi Mở

- Quyết định nào phải đến trước: phân rã hệ thống thành các container, hay ánh xạ các Bounded Context chưa được định nghĩa vào các đơn vị ứng viên?
- Trong điều kiện nào nhiều context có thể chia sẻ một container, và bằng chứng nào — nhu cầu consistency, scale, team topology — biện luận cho điều đó?
- Shared platform capabilities (SD-030, SD-040) được hiện thực thành các container như thế nào mà không hấp thụ chính sách nghiệp vụ domain (SD-004)?
- Bản ghi tối thiểu mà một mục container phải mang trước khi có thể vượt qua [system architecture review checklist](../08-review-process/review-checklists/system-architecture-review.md) là gì?
- Các mục container được đối chiếu lại như thế nào khi một thay đổi domain boundary phía upstream khiến một phát biểu trách nhiệm hiện có trở nên lỗi thời?

## 13. Tài liệu Liên quan

- [System Context](system-context.md) — ranh giới mà trong đó mọi container tồn tại.
- [Deployment Architecture](deployment-architecture.md) — tiêu thụ các deployment group và quyết định độc lập từ file này.
- [Runtime Architecture](runtime-architecture.md) — tiêu thụ các bản ghi dependency lúc runtime từ file này.
- [Data Architecture](data-architecture.md) — sở hữu các quyết định lưu trữ cho quyền sở hữu dữ liệu được ghi ở đây.
- [Integration Architecture](integration-architecture.md) — điều phối ngữ nghĩa giao tiếp giữa các container.
- [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md) — các sự kiện sở hữu mà trách nhiệm container truy vết đến.
- [Architecture Principles](../00-governance/architecture-principles.md), [Decision Process](../00-governance/decision-process.md), [ADR Template](../00-governance/architecture-decision-records/template.md).
- [System Architecture Review Checklist](../08-review-process/review-checklists/system-architecture-review.md).
