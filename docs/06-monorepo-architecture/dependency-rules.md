# Quy tắc dependency

**Trạng thái:** Scaffold — chỉ mang định hướng cấu trúc; chưa chứa quyết định nào đã được review hay phê duyệt.

**Phạm vi:** Các loại quy tắc hướng dependency sẽ được thực thi giữa các project class, domain và context, cách chúng được thực thi, và cách exception được quản trị — bộ quy tắc cụ thể không được quyết định tại đây.

Tài liệu này mô tả các nhóm quy tắc và mô hình thực thi của chúng. Không có quy tắc cụ thể nào được phê chuẩn tại đây; mọi quy tắc được nêu đều là định hướng cần được xác nhận hoặc điều chỉnh thông qua decision process.

## 1. Mục tiêu quản trị dependency

Các quy tắc dependency tồn tại để giữ hướng dependency đồng nhất với ownership: code nên phụ thuộc vào nơi sở hữu thứ mà nó cần, và những thứ ổn định không nên phụ thuộc vào những thứ dễ thay đổi (định hướng của AP-010).

- Mục tiêu là hướng dependency có thể kiểm chứng bằng máy (AP-016): mọi quy tắc nêu tại đây cuối cùng phải kiểm tra được trong CI, để drift trở thành một failed build thay vì một nhận xét trong review.
- Quản trị bảo vệ domain autonomy (AP-001): dependency giữa các domain phải được chủ đích như dependency giữa các bounded context.
- Quản trị bảo vệ contract (AP-007): một dependency không có contract là một integration chưa được khai báo và phải phát hiện được.
- File này định nghĩa các nhóm quy tắc và mô hình thực thi của chúng; nó không phê chuẩn bất kỳ quy tắc cụ thể nào.

## 2. Nguyên tắc hướng dependency

Các nguyên tắc định hướng sẽ được phê chuẩn thành quy tắc cụ thể:

- Dependency đi theo ownership: một project chỉ được phụ thuộc vào project khác khi tồn tại quan hệ ownership hoặc contract.
- Thứ ổn định hơn không được phụ thuộc vào thứ kém ổn định hơn; domain policy không được phụ thuộc vào chi tiết application, transport hay provider (AP-010).
- Code dành riêng cho một domain không được rò rỉ vào shared project chỉ để dễ tái sử dụng; khi hai domain cần logic tương tự, dependency sẽ được chuyển hoặc một shared capability sẽ được quyết định — code không tự động di chuyển (AP-003).
- Mọi dependency giữa các domain hoặc giữa các bounded context phải tương ứng với một contract tường minh có producer, consumer và owner rõ ràng (AP-007).
- Exception là khả thi: mỗi nguyên tắc nêu trên đều cho phép exception có tài liệu theo quy trình tại mục 12. Đây là các định hướng, không phải mệnh lệnh cứng áp dụng cho mọi trường hợp.

## 3. Dependency được phép

Mục này sẽ ghi lại bộ quy tắc cho phép.

- Các loại quy tắc mà nó sẽ chứa: những dependency từ project class này sang project class khác được phép (ví dụ, hình dạng của "application project được phụ thuộc vào domain project và infrastructure project"), những external registry nào được phê duyệt, và cách xác minh một dependency được phép.
- Nó phải trả lời mức granularity của "được phép" — cho phép theo class, theo tag, hay theo từng cặp project tường minh — vì granularity quyết định cả chi phí review lẫn khoảng trống để lách các vi phạm.
- Nó phải trả lời liệu quy tắc cho phép có khác nhau theo từng domain hay không (câu hỏi về domain autonomy, AP-001).
- Các quy tắc cho phép cụ thể là [To be defined] trong chờ các quyết định về taxonomy và tooling.

## 4. Dependency bị cấm

Mục này sẽ ghi lại bộ quy tắc cấm, mô tả các loại điều cấm thay vì một danh sách đã được phê chuẩn.

- Các loại ứng viên: dependency đi vòng qua contract; deep import vào internals của project khác; code của domain này với tới domain khác; shared project phụ thuộc vào consumer của nó; tooling phụ thuộc vào code đã ship.
- Mỗi quy tắc cấm sẽ cần một lý do, một cơ chế phát hiện, và một hậu quả được nêu rõ khi vi phạm — một điều cấm không thể thực thi là một mong muốn, không phải quy tắc (AP-018).
- Các quy tắc cấm cụ thể là [To be defined].

## 5. Quy tắc dependency của domain

Mục này sẽ ghi lại các quy tắc bảo vệ domain project.

- Định hướng làm việc: domain project không được phụ thuộc vào implementation của application, transport hay infrastructure; một domain project không được phụ thuộc vào internals của domain khác — truy cập cross-domain đi qua các contract đã khai báo (AP-007); domain model mặc định không được chia sẻ giữa các context (AP-005).
- Vì bounded context chưa được định nghĩa (xem [Domain Design](../03-domain-design/README.md)), các quy tắc này mới chỉ có thể định hình tại đây, chưa thể viết ra.
- Nó phải trả lời việc vi phạm quy tắc domain ánh xạ thế nào lên cơ chế thực thi, và việc thay đổi domain boundary mở lại bộ quy tắc ra sao.
- [To be defined] khi các context đã tồn tại.

## 6. Quy tắc dependency của application

Mục này sẽ ghi lại các quy tắc về application project.

- Định hướng làm việc: application được kết hợp domain project, infrastructure project và shared platform project theo contract; application không được chứa business policy thuộc về một context; application của các domain khác nhau không phụ thuộc trực tiếp vào nhau mà tích hợp qua các cơ chế cấp hệ thống được quyết định trong [System Architecture](../05-system-architecture/README.md).
- Nó phải trả lời việc kiểm tra composition cấp application diễn ra thế nào, và shared code mà hai application cùng cần được lấy từ đâu (quyết định shared platform, không phải duplication và không phải reach-through).
- [To be defined].

## 7. Quy tắc dependency của infrastructure

Mục này sẽ ghi lại các quy tắc về infrastructure project.

- Định hướng làm việc: infrastructure phụ thuộc về phía abstraction và tránh xa internals của domain (AP-010); code dành riêng cho một provider được cách ly — adapter của provider này không được làm ô nhiễm adapter của provider khác hay của domain; infrastructure dùng chung giữa các domain đòi hỏi tiêu chí ownership của shared platform.
- Nó phải trả lời việc cách ly provider được xác minh thế nào, và versioning của infrastructure có đi theo versioning của contract hay không (AP-020).
- Việc xác minh sẽ dựa vào static analysis được chọn trong [tooling-and-conventions.md](tooling-and-conventions.md).
- [To be defined].

## 8. Dependency giữa các domain

Mục này sẽ ghi lại các quy tắc cho dependency vượt qua domain boundary.

- Định hướng làm việc, phản ánh domain autonomy (AP-001): dependency cross-domain mang tính ngoại lệ; luôn dựa trên contract (AP-007); không bao giờ với tới cấu trúc bên trong của domain khác; đòi hỏi một decision thay vì một import tùy tiện.
- Nó phải trả lời ai phê duyệt một dependency cross-domain, compatibility của nó được quản lý theo thời gian thế nào (AP-020), và nó hiển thị trong báo cáo dependency ra sao để coupling luôn được nhìn thấy.
- Nó còn phải phân biệt việc tiêu thụ hợp lệ các shared capability cấp Ecoma Platform với coupling domain-to-domain — một sự phân biệt mà shared platform class của taxonomy được thiết kế để mang.
- Các quy tắc cụ thể là [To be defined] trong chờ các quyết định kiến trúc domain.

## 9. Dependency của shared library

Mục này sẽ ghi lại các quy tắc về shared platform library và shared utility library.

- Định hướng làm việc: shared code phụ thuộc vào consumer, không bao giờ ngược lại; một shared library không được import domain policy của bất kỳ domain nào; consumer chỉ phụ thuộc vào published surface (xem [module-boundaries.md](module-boundaries.md), mục 4).
- Việc được xếp vào nhóm "shared" được điều chỉnh bởi các tiêu chí shared platform của taxonomy — ownership và lý do (AP-003). Một library được chia sẻ chỉ vì tiện lợi và không có owner là một vi phạm, không phải một shortcut.
- Nó phải trả lời danh sách consumer được giữ chính xác thế nào và điều gì xảy ra khi consumer cuối cùng rời đi (retire hoặc biện minh).
- Bộ quy tắc là [To be defined].

## 10. Ngăn ngừa circular dependency

Mục này sẽ ghi lại cách các cycle được ngăn ngừa.

- Định hướng: circular dependency bị cấm theo mặc định giữa các project và giữa các domain, với phát hiện trong CI và mọi cycle được chấp nhận đều phải được khai báo và theo dõi như một exception có giới hạn thời gian.
- Nó phải bao quát các loại cycle với mức độ nghiêm trọng khác nhau — cycle giữa các library ngang hàng so với cycle trải qua domain boundary — và việc semantics của graph trong build system có làm một số cycle bất khả thi về mặt cấu trúc hay không.
- Nó phải trả lời cách phát hiện near-cycle (reach-through lẫn nhau qua một project thứ ba), vì kiểm tra pairwise đơn giản sẽ bỏ sót chúng.
- Cơ chế là [To be defined] cùng với quyết định tooling.

## 11. Thực thi quy tắc dependency

Thiết kế thực thi: các quy tắc trở thành constraint được biểu diễn ở dạng có thể kiểm chứng bằng máy.

- Constraint chạy trong CI với mọi thay đổi và làm build fail khi vi phạm, với error message nêu rõ quy tắc bị vi phạm và dependency path gây lỗi (AP-016, AP-018).
- Cơ chế — boundary tag, phân tích module graph, import linting hoặc một phương án tương đương — phụ thuộc vào quyết định workspace tooling và được ghi lại trong [tooling-and-conventions.md](tooling-and-conventions.md); không có tool nào được chọn tại đây.
- Việc thực thi phải được cập nhật trong cùng thay đổi làm thay đổi taxonomy, để độ phủ của quy tắc không bao giờ tụt lại so với cấu trúc.
- Việc thực thi cần một owner, một failure behavior, và một đường xử lý false-positive cho từng quy tắc (kỷ luật xác minh của AP-018).
- Tích hợp phía build của các kiểm tra thực thi được đề cập trong [build-and-test-architecture.md](build-and-test-architecture.md).

## 12. Exception và phê duyệt

Một exception của quy tắc dependency là một sự kiện được quản trị, không phải một quy tắc bị comment out.

- Mọi exception phải ghi rõ: quy tắc bị ảnh hưởng, vì sao nó không thể được tôn trọng, blast radius (những project, domain hay context nào), rủi ro được chấp nhận, mitigation, người phê duyệt, và ngày review nếu mang tính tạm thời — phản chiếu kỷ luật exception của [Architecture Principles](../00-governance/architecture-principles.md).
- Thẩm quyền phê duyệt theo [Review Policy](../08-review-process/review-policy.md).
- Exception làm thay đổi một architecture constraint được ghi lại như decision theo [Architecture Decision Process](../00-governance/decision-process.md).
- Exception có giới hạn thời gian phải được theo dõi đến khi hết hạn; một exception được gia hạn vĩnh viễn là một thay đổi quy tắc, không phải exception.

## 13. Câu hỏi mở

- Workspace tooling và boundary tooling nào sẽ biểu diễn và kiểm tra các quy tắc? (Chưa quyết định; review checklist nhắc đến Nx như một ứng viên, nhưng chưa có quyết định tooling nào.)
- Quy tắc sẽ được viết theo project class (cấp tag) hay theo từng cặp project (explicit allowlist), hay kết hợp cả hai?
- Dependency bên ngoài (third-party) được quản trị thế nào — danh sách registry được phê duyệt, ownership theo từng project, hay một cơ chế khác?
- Mức độ nghiêm trọng và failure behavior nào áp dụng cho từng loại quy tắc — build fail hẳn so với warning kèm thời hạn?
- Việc phát hiện dependency cross-domain nên phân biệt consumption của shared platform cấp Ecoma Platform với coupling domain-to-domain như thế nào?
- Near-cycle được phát hiện thế nào, và độ sâu phân tích graph nào đáng với chi phí CI của nó?

## 14. Tài liệu liên quan

- [Monorepo Architecture README](README.md) — mô hình thực thi của nhóm tài liệu này.
- [project-taxonomy.md](project-taxonomy.md) — các class mà các quy tắc này thao tác trên.
- [module-boundaries.md](module-boundaries.md) — các quy tắc encapsulation và public surface bổ trợ cho các quy tắc hướng.
- [build-and-test-architecture.md](build-and-test-architecture.md) — nơi thực thi chạy trong CI.
- [tooling-and-conventions.md](tooling-and-conventions.md) — tooling chưa quyết định sẽ biểu diễn các constraint.
- [deployment-units.md](deployment-units.md) — hệ quả release coupling của cấu trúc dependency.
- [Domain Design](../03-domain-design/README.md) — các bounded context (chưa được định nghĩa) mà quy tắc domain sẽ bảo vệ.
- [System Architecture](../05-system-architecture/README.md) — các cơ chế integration mà application sẽ dùng thay cho direct import (các quyết định đang chờ).
- [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md) — ownership đã được chấp nhận đằng sau các quy tắc domain và platform.
- [Architecture Principles](../00-governance/architecture-principles.md) — AP-001, AP-003, AP-005, AP-007, AP-010, AP-016, AP-018, AP-020.
- [Review Policy](../08-review-process/review-policy.md) — thẩm quyền phê duyệt exception.
- [Monorepo Architecture Review Checklist](../08-review-process/review-checklists/monorepo-architecture-review.md) — mục "Dependency Rules" là review contract cho file này.
