# Module Boundaries

**Trạng thái:** Scaffold — chỉ chứa định hướng cấu trúc; chưa có quyết định nào đã được review hoặc phê duyệt.

**Phạm vi:** Cách các bounded context boundary và domain boundary được thể hiện, bao đóng (encapsulation) và bảo vệ dưới dạng module boundary trong repository, cách các module giao tiếp với nhau, và cách làm cho vi phạm boundary trở nên có thể phát hiện được.

Tài liệu này chỉ điều chỉnh ở cấp độ module. Domain boundary được quyết định trong domain design, deployment boundary trong system architecture; tài liệu này đảm bảo cả hai vẫn còn nguyên vẹn khi tiếp xúc với code.

## 1. Mục tiêu của Module Boundary

Module boundary là biểu hiện phía repository của quyền sở hữu (ownership): chúng cho thấy rõ trách nhiệm của một owner kết thúc ở đâu và trách nhiệm của owner khác bắt đầu từ đâu, đồng thời biến việc vượt qua ranh giới đó thành một sự kiện có thể phát hiện thay vì sự trôi dạt âm thầm (AP-016).

- Chúng phải cho phép các boundary đã được quyết định ở nơi khác tồn tại qua quá trình phát triển: bounded context boundary từ [Domain Design](../03-domain-design/README.md) và domain boundary (Domain LLM / Domain GPU) từ [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md) phải được giữ nguyên vẹn khi số lượng contributor và domain tăng lên.
- Chúng giữ ba khái niệm tách biệt (AP-006): một module boundary không phải là một domain boundary và cũng không phải là một deployment boundary; tài liệu này điều chỉnh cấp độ module và mức độ trung thực của nó với hai cấp còn lại.
- Chúng hướng đến tính kinh tế trong việc thực thi: một boundary được thiết kế tốt biến một vi phạm kiến trúc thành một bài toán phát hiện mang tính cơ khí — một import đáng lẽ không được tồn tại.

## 2. Định nghĩa Module

Phần này sẽ ghi lại những gì cấu thành một module trong repository.

- Phải trả lời việc một module là một project, một nhóm các project, hay một quy ước theo phạm vi thư mục, một khi tooling và taxonomy đã được quyết định — đây là một định nghĩa phụ thuộc vào tooling, không phải lựa chọn tùy ý.
- Phải trả lời phạm vi của một module bao gồm những gì (public surface, phần nội bộ, các test) và loại trừ những gì.
- Phải trả lời một module liên hệ với — nhưng không đồng nhất với — một bounded context hay một deployment unit như thế nào (AP-006).
- [Chưa định nghĩa] chờ các quyết định về tooling và taxonomy.

## 3. Quyền sở hữu Module

Mỗi module sẽ có một owner được ghi lại, chịu trách nhiệm về public contract của module, phần nội bộ, và việc phê duyệt các dependency từ bên ngoài vào nó.

- Quy tắc ownership phải trả lời: ai được tham khảo khi một module khác cần một capability mới từ module này, ai được phép thay đổi public surface, và ownership được chuyển giao như thế nào khi các domain hoặc context được tái tổ chức.
- Shared module còn đòi hỏi thêm một lý do để tồn tại và một phạm vi consumer, theo các tiêu chí về shared platform (AP-003).
- Module không có owner là một review finding; tình trạng thiếu ownership phải có thể phát hiện được, không được im lặng vắng mặt.
- Cơ chế mã hóa (project metadata, ownership files) là [Chưa định nghĩa].

## 4. Public API và Internal API

Phần này sẽ ghi lại cách mỗi module khai báo public surface của mình và giữ phần còn lại ở trạng thái nội bộ.

- Định hướng làm việc: consumer chỉ import public surface; deep import vào phần internals mặc định bị cấm; public surface là contract của module, và việc thay đổi nó tuân theo kỷ luật thay đổi contract (AP-020).
- Phải trả lời cách public surface được thể hiện trong tooling đã chọn (exports, entry points, generated declarations) và cách trạng thái "internal" được thực thi thay vì chỉ là quy ước.
- Phải trả lời cách tiến hóa của surface được version hóa — thay đổi additive so với breaking change — và ai review mỗi loại.
- [Chưa định nghĩa].

## 5. Quy tắc Encapsulation

Phần này sẽ ghi lại các loại quy tắc encapsulation sẽ được áp dụng.

- Các loại ứng viên: internals không thể bị truy cập từ bên kia ranh giới module; các type và schema mà consumer cần được export thông qua contract; các artifact sinh tự động hoặc phụ thuộc vendor không bao giờ bị rò rỉ qua boundary.
- Các quy tắc có tính định hướng cho đến khi được phê duyệt; intent thiết kế là mọi quy tắc đều kiểm tra được một cách cơ khí (AP-016), vì vậy cách diễn đạt ưu tiên "import not permitted" hơn là "discouraged".
- Encapsulation là thứ khiến việc thực thi boundary trở nên rẻ — nó biến các vi phạm kiến trúc thành các static analysis finding.
- [Chưa định nghĩa].

## 6. Giao tiếp xuyên module

Phần này sẽ ghi lại các hình thức tương tác xuyên module được cho phép.

- Các hình thức ứng viên: gọi in-process thông qua một contract; import shared types từ contract; event hoặc message theo quyết định ở cấp hệ thống; tiêu thụ các capability của shared platform thông qua các contract đã công bố của chúng (AP-007).
- Phải trả lời hình thức nào khả dụng theo mặc định so với hình thức nào cần một quyết định, và cách giữ cho một consumer module không biết gì về internals của producer ngay cả khi giao tiếp thường xuyên.
- Ngữ nghĩa tích hợp runtime xuyên qua các deployment boundary thuộc về [System Architecture](../05-system-architecture/README.md); phần này chỉ đề cập các hình thức phía repository.
- [Chưa định nghĩa].

## 7. Bảo vệ Domain Boundary

Module boundary tồn tại một phần để mang theo domain boundary: mỗi bounded context được chấp nhận (các context chưa được định nghĩa — xem [Domain Design](../03-domain-design/README.md)) phải có khả năng được biểu diễn trong code dưới dạng một hoặc nhiều module mà các dependency edge của chúng làm cho boundary của context hiển thị rõ ràng.

- Yêu cầu bảo vệ: một vi phạm domain phải phát hiện được dưới dạng một vi phạm dependency — nếu code từ context A chạm vào internals của context B, boundary tooling sẽ báo cáo nó, thay vì vi phạm chỉ được phát hiện khi đọc code (AP-016, nguyên tắc model-ownership của AP-005).
- Điều này đòi hỏi mọi domain boundary phải có ít nhất một biểu hiện ở cấp module; một context không có module edge nào là một context không được bảo vệ ngay từ đầu.
- Các quy tắc ánh xạ — một context ánh xạ tới các module như thế nào, và điều gì xảy ra khi ánh xạ là many-to-many — là [Chưa định nghĩa] một khi các context đã tồn tại.
- Tranh chấp về domain ownership nổi lên dưới dạng các boundary finding, điều này giữ cho chúng luôn hiển thị thay vì bị hòa tan vào code.

## 8. Bảo vệ Domain Boundary

Domain boundary tuân theo cùng logic đó ở quy mô lớn hơn.

- Code của một domain phải có khả năng tách biệt về cấu trúc; các domain module của nó không được importable bởi domain khác trừ khi thông qua các contract đã khai báo; domain autonomy (AP-001) phải hiển thị trong module graph — không domain nào bị ghim vào domain khác bởi một sự trùng hợp thư mục.
- Phần này sẽ ghi lại các quy tắc biến việc truy cập module xuyên domain thành một sự kiện tường minh, đã được phê duyệt, và cách các capability chia sẻ ở cấp Ecoma Platform được tiêu thụ mà không biến technical sharing thành business-ownership coupling (nguyên tắc SD-004 được ghi lại trong strategic model).
- Phải trả lời việc một domain rời đi hay hợp nhất được phản ánh vào cấu trúc module như thế nào mà không làm hỏng các domain còn lại.
- [Chưa định nghĩa] chờ các quyết định về domain architecture.

## 9. Ràng buộc cho Shared Module

Phần này sẽ ghi lại các ràng buộc dành riêng cho shared module.

- Các ràng buộc ứng viên: shared module chỉ phụ thuộc vào các shared module hoặc infrastructure module khác, không bao giờ phụ thuộc vào một domain hay context consumer; chúng không chứa business policy đặc thù của domain nào (AP-003); danh sách consumer của chúng được ghi lại và giữ chính xác; việc được admitted đòi hỏi các tiêu chí ownership và lý do từ taxonomy.
- Shared module là điểm xói mòn boundary rủi ro cao nhất — failure mode kiểu "dumping ground" — vì vậy các ràng buộc ở đây sẽ chặt chẽ hơn so với các module theo phạm vi domain.
- Phải trả lời con đường retirement: điều gì xảy ra với một shared module khi consumer cuối cùng của nó rời đi, và ai là người quyết định.
- [Chưa định nghĩa].

## 10. Thực thi Boundary

Thiết kế thực thi: các boundary trở thành các ràng buộc được kiểm tra một cách cơ khí.

- Các kiểm tra dạng tag-based hoặc graph-based chạy trong CI, làm build thất bại khi có vi phạm, với các message chỉ rõ boundary đã bị vượt qua và quy tắc đã bị vi phạm (AP-016).
- Việc thực thi boundary và việc thực thi hướng dependency (xem [dependency-rules.md](dependency-rules.md)) dùng chung một cơ chế; cả hai đều [Chưa định nghĩa] chờ quyết định tooling được ghi lại trong [tooling-and-conventions.md](tooling-and-conventions.md).
- Các quy tắc thực thi được kiểm tra lại mỗi khi taxonomy thay đổi, để phạm vi bao phủ đi theo cấu trúc.
- Thiết kế thực thi được review đối chiếu với các phần về enforcement trong [Monorepo Architecture Review Checklist](../08-review-process/review-checklists/monorepo-architecture-review.md), bao gồm cả chất lượng error message và việc auto-inference có kiểm soát.

## 11. Anti-patterns

Các pattern làm xói mòn boundary, sẽ được đặt tên và cấm một khi các quy tắc được phê duyệt:

- **Shared dumping ground** — business logic được đặt vào một shared library một cách "tạm thời" vì hai domain cùng cần nó, mà không có owner hay contract (AP-003).
- **Deep import reach-through** — consumer import internals của một module vì public surface thiếu thứ gì đó, thay vì mở rộng contract.
- **Boundary-by-folder** — coi việc lồng thư mục là encapsulation mà không có kiểm tra cơ khí nào đứng sau.
- **Contract bypass** — một đường tích hợp thứ hai, không chính thức, né tránh contract đã khai báo giữa hai boundary (AP-007).
- **Taxonomy drift** — các project tích lũy thêm trách nhiệm cho đến khi phân loại của chúng không còn mô tả đúng, và enforcement âm thầm bao phủ các edge sai.
- **Convenience refactoring across boundaries** — chuyển code qua ranh giới module để đơn giản hóa một thay đổi, được review như một refactor trong khi thực chất là một thay đổi boundary.

## 12. Câu hỏi mở

- Một module là một project, hay một module có thể trải rộng trên nhiều project, một khi tooling đã được quyết định?
- Một bounded context được ánh xạ tới các module như thế nào — one-to-one khi khả thi, hay các bản ghi ánh xạ many-to-many tường minh — và các ánh xạ được ghi lại ở đâu?
- Điều gì làm cho một public surface trở nên "declared" trong tooling đã chọn — exports manifest, quy ước entry-point, generated API surface?
- Các hình thức giao tiếp xuyên module được ràng buộc như thế nào mà không quyết định trước tích hợp runtime (thuộc về system architecture)?
- Anti-pattern nào cần quy tắc phát hiện riêng so với được bao phủ bởi các kiểm tra boundary tổng quát?
- Danh sách consumer của một shared module được giữ chính xác như thế nào — review thủ công, trích xuất từ dependency graph, hay cả hai?

## 13. Tài liệu liên quan

- [Monorepo Architecture README](README.md) — các nguyên tắc và mô hình thực thi.
- [project-taxonomy.md](project-taxonomy.md) — phân loại mà các boundary tag dựa trên.
- [dependency-rules.md](dependency-rules.md) — quy tắc hướng bổ sung cho các quy tắc encapsulation.
- [repository-structure.md](repository-structure.md) — vị trí của các module trong layout.
- [tooling-and-conventions.md](tooling-and-conventions.md) — cơ chế chưa quyết định sẽ biểu diễn các boundary check.
- [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md) — các business boundary đã được chấp nhận mà module boundary bảo vệ.
- [Domain Design](../03-domain-design/README.md) — các bounded context (chưa định nghĩa) mà tài liệu này biểu diễn boundary của chúng trong code.
- [System Architecture](../05-system-architecture/README.md) — tích hợp runtime và hiện thực hóa deployment (các quyết định còn chờ).
- [Architecture Principles](../00-governance/architecture-principles.md) — AP-001, AP-003, AP-005, AP-006, AP-007, AP-016.
- [Monorepo Architecture Review Checklist](../08-review-process/review-checklists/monorepo-architecture-review.md) — các phần "Dependency Rules" và "Enforcement" là review contract của tài liệu này.
