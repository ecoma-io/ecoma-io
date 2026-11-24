# Kiến trúc dữ liệu (Data Architecture)

**Trạng thái:** Khung sườn — chỉ chứa định hướng cấu trúc; chưa có quyết định kiến trúc nào được xem xét hoặc phê duyệt.

**Phạm vi:** Cách quyền sở hữu dữ liệu, phân loại, tính nhất quán (consistency), vòng đời, migration, backup và trao đổi liên hệ thống được tổ chức ở cấp hệ thống. Không công nghệ lưu trữ hay schema nào được chọn trong khung sườn này.

## 1. Mục tiêu của Kiến trúc dữ liệu

- Bảo vệ quyền sở hữu đã thiết lập: mỗi tập dữ liệu có đúng một chủ sở hữu, và việc chia sẻ chỉ diễn ra thông qua các cơ chế đã được quyết định ([AP-015](../00-governance/architecture-principles.md)).
- Giữ nguồn sự thật (source of truth) không mơ hồ cho mọi tập dữ liệu, và làm cho mọi sự đánh đổi về tính nhất quán đều được thể hiện rõ ràng thay vì ngẫu nhiên.
- Tôn trọng các nghĩa vụ đã chấp nhận ở giai đoạn discovery — ví dụ retention sau khi tổ chức (Consumer Organization) chấm dứt hoạt động (ORG-012) và việc thu hồi quyền truy cập ngay lập tức — như các yêu cầu dữ liệu hạng nhất, theo [các kỳ vọng bảo mật](../07-quality-attributes/security.md).

## 2. Nguyên tắc sở hữu dữ liệu

- Định hướng: quyền sở hữu dữ liệu đi theo quyền sở hữu domain. Mỗi Bounded Context sở hữu dữ liệu của mình, và dữ liệu của một context không được các context khác ghi hoặc thay đổi.
- Không chia sẻ database giữa các context theo mặc định: việc chia sẻ storage qua ranh giới sở hữu đòi hỏi một quyết định đã được chấp nhận nêu rõ lý do coupling được kiểm soát ([AP-015](../00-governance/architecture-principles.md)). Đây là định hướng, không phải một triển khai đã quyết định.
- Chia sẻ về mặt kỹ thuật không bao giờ gộp quyền sở hữu nghiệp vụ: hai domain có thể dùng chung hạ tầng mà dữ liệu của chúng không trở thành dữ liệu của một domain nghiệp vụ (SD-004, [Constraints](../01-strategy/constraints.md)).
- Truy cập xuyên ranh giới là một hợp đồng, không phải một thói quen ([AP-007](../00-governance/architecture-principles.md)); việc đọc trực tiếp dữ liệu nội bộ của context khác không phải là hợp đồng mặc định.

## 3. Phân loại và phân lớp dữ liệu

- Sẽ định nghĩa các lớp dữ liệu (data class) mà hệ thống phân biệt — ví dụ dữ liệu định danh, dữ liệu cá nhân, dữ liệu tài chính và dữ liệu vận hành — cùng các yêu cầu xử lý mà mỗi lớp mang theo.
- Phân loại là đầu vào cho [bảo vệ dữ liệu](security-architecture.md): yêu cầu bảo vệ gắn theo từng lớp, không theo từng data store.
- Bản thân hệ thống phân loại chưa được quyết định — những lớp nào tồn tại, ai sở hữu hệ thống phân loại, và retention khác nhau ra sao theo từng lớp là các Open Question; không có gì được phân loại trong khung sườn này.

## 4. Danh mục data store

- Sẽ liệt kê các data store khi các quyết định về lưu trữ được đưa ra, mỗi mục nêu rõ nó chứa gì, đơn vị nào sở hữu nó, và quyết định nào đã đưa nó vào.
- Danh mục đang **trống**: không có công nghệ lưu trữ nào được nêu, so sánh hay chọn ở đây.
- Các nhóm trong danh mục tuân theo sự phân biệt của [AP-015](../00-governance/architecture-principles.md) giữa dữ liệu vận hành (system of record), projections và caches, và dữ liệu được replicate.

## 5. Ranh giới sở hữu dữ liệu

- Sẽ ánh xạ mỗi tập dữ liệu đến chủ sở hữu của nó — Bounded Context sở hữu nó; các định nghĩa dưới docs/03-domain-design/bounded-contexts/ (chưa được tạo) sẽ được trích dẫn rõ ràng cho từng mục — và đến container cũng như data store hiện thực hóa nó.
- Các mục phân biệt dữ liệu được sở hữu với dữ liệu được giữ dưới dạng projection, cache hoặc replica, và nêu hợp đồng giữ cho mỗi bản sao phái sinh luôn nhất quán ([AP-015](../00-governance/architecture-principles.md)).
- Bảo vệ: một đơn vị kỹ thuật không thể trở thành chủ sở hữu của một tập dữ liệu mà chủ sở hữu domain của nó là một bên khác.

## 6. Mẫu truy cập dữ liệu (Data Access Patterns)

- Sẽ ghi lại, theo từng tập dữ liệu, ai đọc và ghi nó và thông qua mẫu truy cập nào — truy cập sở hữu (owned access), truy cập theo hợp đồng, hoặc bản sao phái sinh.
- Phải trả lời cho mỗi truy cập xuyên ranh giới: hợp đồng nào điều chỉnh nó, ai sở hữu hợp đồng đó, và điều gì xảy ra khi hợp đồng bị vi phạm.
- Các mẫu truy cập vượt qua quyền sở hữu — shared schema, truy cập trực tiếp data store xuyên ranh giới — chỉ xuất hiện nếu một quyết định đã được chấp nhận biện minh cho chúng (Mục 2).

## 7. Mô hình tính nhất quán dữ liệu (Data Consistency Model)

- Sẽ ghi lại, theo từng quan hệ giữa các tập dữ liệu, kỳ vọng nhất quán: cái gì phải nhất quán mạnh (strongly consistent) và cái gì có thể nhất quán cuối cùng (eventually consistent), với hậu quả nhìn thấy được từ phía người dùng của các trường hợp eventual được nêu rõ ([AP-011](../00-governance/architecture-principles.md)).
- Các đầu vào đã cố định từ giai đoạn discovery: bảo vệ bất biến (invariant) đòi hỏi tính nhất quán tại ranh giới chịu trách nhiệm ([AP-008](../00-governance/architecture-principles.md)); kiểm tra điều kiện đủ của lời mời (invitation eligibility checks) phải atomic với các thao tác đồng thời (INV-011); tính duy nhất giữa email và Account phải được đảm bảo mọi lúc (ID-006). Cách các ràng buộc này được hiện thực hóa giữa các đơn vị chưa được quyết định.
- Định hướng kiểm chứng: kỳ vọng nhất quán phải kiểm thử được dưới điều kiện đồng thời ([Testability](../07-quality-attributes/testability.md)).

## 8. Vòng đời và retention của dữ liệu

- Sẽ ghi lại các giai đoạn vòng đời theo từng lớp dữ liệu — tạo, sử dụng tích cực, lưu trữ (archival), xóa — và các quy tắc retention điều chỉnh từng giai đoạn.
- Các nghĩa vụ đã được thiết lập: dữ liệu không bị xóa khi một Consumer Organization chấm dứt hoạt động; nó được giữ lại theo chính sách của domain sở hữu (ORG-012), quyền truy cập phát sinh từ Organization hoặc Membership bị thu hồi ngay (ORG-013, MEM-013); cơ chế deprovisioning cụ thể thuộc lớp thiết kế.
- Retention tương tác với [revocation](../07-quality-attributes/security.md): quyền truy cập kết thúc ngay lập tức trong khi dữ liệu vẫn tồn tại — cả hai thuộc tính phải đồng thời được đảm bảo trong thiết kế được hiện thực hóa.

## 9. Data migration

- Sẽ ghi lại cách các thay đổi schema và dữ liệu được triển khai: thứ tự migration so với các lần deploy, cửa sổ tương thích ngược (backward compatibility), và việc kiểm chứng rằng dữ liệu đã migrate vẫn giữ nguyên các bất biến ([AP-020](../00-governance/architecture-principles.md)).
- Các thay đổi gây lỗi tương thích (breaking changes) đòi hỏi một kế hoạch migration và deprecation theo [quy trình quyết định](../00-governance/decision-process.md); cơ chế migration là các quyết định, được ghi lại theo từng thay đổi.
- Không có công cụ migration nào được chọn ở đây.

## 10. Backup và recovery

- Sẽ ghi lại, theo từng data store, những gì được backup, cách khôi phục được kiểm chứng, và các kỳ vọng recovery mà nó phải đáp ứng.
- Các mục tiêu recovery sẽ được cụ thể hóa khi quy trình quality attributes đặt các mục tiêu — [bản ghi reliability](../07-quality-attributes/reliability.md) cố ý chưa định nghĩa mục tiêu nào.
- Định hướng: backup và khôi phục phải tôn trọng cùng các ranh giới sở hữu như dữ liệu trực tiếp — khôi phục dữ liệu của một context không được ghi đè lên dữ liệu của context khác.

## 11. Bảo mật dữ liệu

- Sẽ ghi lại các biện pháp bảo mật theo từng phân loại: kiểm soát truy cập trên các data store và bản xuất (export), bảo vệ khi truyền và khi lưu trữ (at rest) theo như đã quyết định, và audit các truy cập nhạy cảm ([AP-014](../00-governance/architecture-principles.md)).
- [Góc nhìn bảo mật](security-architecture.md) định nghĩa các lớp yêu cầu; mục này ghi lại việc hiện thực hóa theo từng data store khi đã quyết định.
- Các yêu cầu phụ thuộc phân loại đang chờ Mục 3; không có biện pháp nào được chọn trong khung sườn này.

## 12. Trao đổi dữ liệu liên hệ thống (Cross-System Data Exchange)

- Sẽ ghi lại cách dữ liệu vượt qua ranh giới hệ thống hoặc di chuyển giữa các domain: nghĩa vụ xuất dữ liệu, replication đến các domain khác, và trao đổi với các hệ thống bên ngoài — mỗi cái đều thông qua một hợp đồng rõ ràng ([AP-007](../00-governance/architecture-principles.md)).
- Định hướng: trao đổi giữa các domain diễn ra thông qua các hợp đồng, không thông qua storage dùng chung; bản thân các hợp đồng là các artifact thuộc domain do Domain Design sở hữu (xem danh mục hợp đồng tích hợp tại docs/03-domain-design/integration-contracts/, đã được hoạch định), còn mục này ghi lại cơ chế trao đổi.
- Cái gì phải xuất được, cho ai, và dưới dạng nào chưa được quyết định và một phần phụ thuộc vào các câu hỏi thương mại chưa được giải quyết ([Discovery Backlog](../02-domain-discovery/discovery-backlog.md)).

## 13. Open Questions

- Hệ thống phân loại dữ liệu nào được áp dụng, ai sở hữu nó, và các quy tắc retention khác nhau ra sao theo từng lớp?
- Các đảm bảo tính nhất quán nào mà các ràng buộc discovery đã chấp nhận — atomicity của INV-011, tính duy nhất của ID-006 — buộc phải có ở cấp hệ thống, xét đến việc ánh xạ các context sang các đơn vị chưa được quyết định?
- Các projections và replicas được giữ nhất quán với dữ liệu được sở hữu xuyên qua các ranh giới deploy như thế nào, và điều gì xảy ra khi chúng tụt lại phía sau?
- Những tập dữ liệu nào sẽ vượt qua ranh giới domain cho tầm nhìn tích hợp trải nghiệm và tích hợp nghiệp vụ (SD-037), và dưới những hợp đồng nào?
- Cơ chế retention và deprovisioning nào sẽ theo sau khi các chính sách retention của domain (ORG-012) được định nghĩa?

## 14. Tài liệu liên quan

- [Container Architecture](container-architecture.md) — các đơn vị hiện thực hóa quyền sở hữu dữ liệu.
- [Integration Architecture](integration-architecture.md) — các hợp đồng và styles mà trao đổi dữ liệu sử dụng.
- [Security Architecture](security-architecture.md) — các yêu cầu bảo vệ theo từng phân loại.
- [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md) — các sự thật về quyền sở hữu và các chủ đề retention chưa quyết định.
- [Reliability](../07-quality-attributes/reliability.md) và [Testability](../07-quality-attributes/testability.md) — các kỳ vọng về recovery và tính nhất quán kiểm chứng được.
- [Architecture Principles](../00-governance/architecture-principles.md) (đặc biệt AP-007, AP-008, AP-011, AP-015, AP-020), [Decision Process](../00-governance/decision-process.md).
- [System Architecture Review Checklist](../08-review-process/review-checklists/system-architecture-review.md).
