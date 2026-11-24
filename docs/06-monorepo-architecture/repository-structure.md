# Cấu trúc Repository

**Trạng thái:** Scaffold — chỉ chứa định hướng về cấu trúc; chưa có quyết định nào được review hoặc phê duyệt.

**Phạm vi:** Cách bố trí thư mục của monorepo sẽ tổ chức các applications, libraries, tài nguyên dùng chung, configuration và documentation, và những gì cần được ghi nhận cho từng khu vực trước khi bất kỳ bố trí nào được quyết định.

Tài liệu này định nghĩa các mục tiêu mà bố trí thư mục phải đáp ứng và thông tin sẽ được ghi nhận trong từng khu vực. Cho đến khi các quyết định về taxonomy và tooling tồn tại, các vị trí cụ thể là [chưa được định nghĩa]; không có nội dung nào ở đây cố định một cây thư mục.

## 1. Mục tiêu Tổ chức Repository

Bố trí thư mục phải làm cho ownership và boundaries dễ tìm thấy, không chỉ mang tính hợp lý về mặt hình thức:

- Người đọc phải có thể định vị được các applications của từng domain, mã domain mà chúng sử dụng, và tooling xây dựng chúng mà không cần "khảo cổ" hay kiến thức truyền miệng.
- Nó phải cho phép taxonomy của dự án (xem [project-taxonomy.md](project-taxonomy.md)) được thể hiện một cách máy móc, để các classification tags và dependency rules có một "ngôi nhà" cấu trúc — thiết kế layout và enforcement cùng nhau, không phải làm layout trước rồi gắn rules vào sau.
- Nó phải giữ các domain độc lập với nhau ở trạng thái tự trị (AP-001): bố trí thư mục không được làm các domain độc lập về mặt kinh doanh phụ thuộc lẫn nhau thông qua sự kề cận về vị trí, shared build files hay các import tình cờ.
- Nó phải mở rộng tốt về mặt cấu trúc khi sản phẩm tăng trưởng (xem [AI Factory Marketplace](../01-strategy/ai-factory-marketplace.md)): thêm một domain hoặc một capability dùng chung không được đòi hỏi phải tái tổ chức các khu vực hiện có.
- Nó phải luôn ở trạng thái có thể review được: một thay đổi cấu trúc phải hiểu được trong review mà không cần đọc từng file bị di chuyển.

## 2. Bố trí Thư mục Cấp cao nhất

Bố trí cấp cao nhất sẽ được ghi nhận khi các quyết định về workspace tooling và taxonomy tồn tại.

- Nó phải trả lời được: những khu vực cấp cao nhất nào tồn tại, mỗi khu vực chứa lớp dự án nào, và configuration toàn workspace nằm ở đâu.
- Mỗi khu vực cấp cao nhất đòi hỏi một mục đích được nêu rõ và một owner; một khu vực mà mục đích không thể nêu rõ là ứng viên để xóa bỏ, không phải để giữ lại.
- Bố trí thư mục không được tự thân hàm ý hướng phụ thuộc (dependency direction) — hướng đi đến từ các rules trong [dependency-rules.md](dependency-rules.md), không phải từ sự kề cận của thư mục. Folder proximity không phải là sự cho phép.
- Cấu trúc cụ thể: [chưa được định nghĩa] đang chờ quyết định về workspace tooling (xem [tooling-and-conventions.md](tooling-and-conventions.md)).

## 3. Vị trí của Applications

Phần này sẽ ghi nhận nơi các applications có thể chạy (runnable) sinh sống và cách chúng được nhóm lại.

- Trục nhóm (grouping axis) đang mở: theo domain, theo deployment unit, hoặc một trục khác khi System Architecture quyết định (xem [System Architecture](../05-system-architecture/README.md)); trục phải được lựa chọn một cách có chủ đích, vì nó định hình cách contributors nghĩ về ownership của domain.
- Nó phải trả lời được mỗi application project được đặt ở đâu, các applications của các domain khác nhau được giữ tách biệt về cấu trúc như thế nào, và ai sở hữu từng khu vực application.
- Applications khác với các deployment units mà chúng sẽ được đóng gói vào (AP-006); việc ánh xạ này được quản lý trong [deployment-units.md](deployment-units.md), không bao giờ được suy ra từ vị trí lưu trữ.
- Vị trí cụ thể: [chưa được định nghĩa].

## 4. Vị trí của Libraries

Phần này sẽ ghi nhận nơi các library project của mỗi loại sinh sống.

- Các loại cần được đặt chỗ: domain libraries thuộc sở hữu của một bounded context (các contexts chưa được định nghĩa — xem [Domain Design](../03-domain-design/README.md)), infrastructure libraries, shared platform libraries, và testing utilities.
- Nó phải trả lời được những loại library nào được cấp khu vực riêng, cách đặt chỗ của library truyền đạt thông tin ownership như thế nào, và làm cách nào người đọc có thể phân biệt một domain library với một shared utility mà không cần mở bất kỳ file nào.
- Shared platform libraries đòi hỏi một owner được xác định và một lý do để tồn tại dưới dạng dùng chung (AP-003); các placement rules sẽ làm những thuộc tính đó hiển thị thay vì bị chôn vùi trong metadata.
- Vị trí cụ thể: [chưa được định nghĩa].

## 5. Vị trí của Tài nguyên Dùng chung

Phần này sẽ ghi nhận nơi các tài nguyên phi mã (non-code) mang tính cross-cutting sinh sống.

- Các lớp tài nguyên cần được đặt chỗ: schemas, integration contracts, fixtures, seeds, environment templates, và các artifacts được sinh ra nhưng vẫn được commit.
- Nó phải trả lời được ai sở hữu từng lớp tài nguyên dùng chung, những domain nào được phép tiêu thụ nó, và một shared resource khác một shared library project như thế nào.
- Shared resources là con đường buôn lậu phổ biến cho các coupling chưa được khai báo — một schema "mượn tạm" xuyên qua một boundary tạo ra cùng loại coupling như một import, nhưng không kích hoạt các kiểm tra import. Các placement rules sẽ ghép mỗi khu vực dùng chung với phạm vi consumer của nó và với enforcement từ [module-boundaries.md](module-boundaries.md).
- Vị trí cụ thể: [chưa được định nghĩa].

## 6. Vị trí của Configuration

Phần này sẽ ghi nhận configuration sinh sống ở mỗi cấp độ ở đâu.

- Các cấp độ cần được đặt chỗ: tool configuration toàn workspace, configuration theo project, runtime configuration theo environment, và secret templates (các giá trị bí mật thật không bao giờ nằm trong repository).
- Nó phải trả lời được một thay đổi configuration làm sao quy kết được về một project, các giá trị theo environment được giữ khỏi mã như thế nào, và những thay đổi configuration nào được review như các thay đổi kiến trúc so với các thay đổi thường lệ.
- Configuration và secrets cho deployment units được bao phủ từ phía deployment trong [deployment-units.md](deployment-units.md); phần này chỉ bao phủ việc đặt chỗ trong repository.
- Vị trí cụ thể: [chưa được định nghĩa].

## 7. Vị trí của Documentation

Phần này sẽ ghi nhận documentation nằm gần mã (code-adjacent) sinh sống ở đâu.

- Các ứng viên cần được đặt chỗ: các guides ở cấp repository, documentation theo project, các architecture notes gắn với các project cụ thể, và cách mỗi loại liên quan đến cây docs trung tâm này.
- Nó phải trả lời được documentation nào nằm cạnh mã mà nó mô tả và documentation nào nằm ở nơi trung tâm, và documentation làm sao giữ được sự đồng bộ với cấu trúc mà nó mô tả — review checklist coi sự lệch pha giữa documentation và mã là một maintainability defect.
- Nó phải trả lời được ai sở hữu từng khu vực documentation và documentation lỗi thời (stale) được phát hiện như thế nào, chứ không chỉ được viết ra.
- Vị trí cụ thể: [chưa được định nghĩa].

## 8. Ownership và Trách nhiệm

Mỗi khu vực thư mục sẽ có một owner hoặc vai trò sở hữu được gọi tên, được ghi nhận khi bố trí tồn tại.

- Ownership trả lời ba câu hỏi: ai phê duyệt các thay đổi cấu trúc trong một khu vực, ai được tham vấn khi một domain khác muốn phụ thuộc vào nó, và ai bảo trì cấu hình tooling của nó.
- Các khu vực không có owner — đặc biệt là các khu vực dùng chung — là nơi business logic không ai sở hữu tích tụ (AP-003); các rule directions trong [module-boundaries.md](module-boundaries.md) sẽ làm ownership trở thành điều kiện tiên quyết cho shared code.
- Các mục ownership phải khả kiểm bằng máy (machine-checkable) khi khả thi (ví dụ qua các code ownership files), để sự trôi dạt của ownership (ownership drift) được phát hiện bởi chính cơ chế CI kiểm tra boundaries.
- Bản đồ ownership là [chưa được định nghĩa] cùng với bản thân bố trí thư mục.

## 9. Quy ước Đặt tên Thư mục

Các quy ước đặt tên sẽ được ghi nhận khi việc đặt tên dự án được quyết định.

- Chúng phải trả lời được: tên thư mục liên hệ với tên dự án và taxonomy tags như thế nào, kiểu chữ hoa/thường và ký tự phân tách nào được dùng, và phạm vi domain và context hiện diện trong tên như thế nào.
- Tên không được hard-code một ánh xạ một-một giữa bounded contexts, deployment units và packages (AP-006) — một tên thư mục có thể mã hóa phạm vi ownership, nhưng không bao giờ tuyên bố một sự tương đương về runtime hay domain.
- Tên ở đây là load-bearing vì cả boundary tooling lẫn điều hướng của con người đều đọc chúng; tên không nhất quán làm yếu enforcement và review cùng một lúc.
- Các quy ước cũng phải bao phủ việc đổi tên: một lần rename tốn kém những gì (history, references, tooling), và ai phê duyệt nó.
- Quy ước cụ thể: [chưa được định nghĩa].

## 10. Các Ràng buộc Cấu trúc

Phần này sẽ ghi nhận các ràng buộc mà bản thân bố trí thư mục phải duy trì một khi đã quyết định.

- Các loại ràng buộc ứng viên: khu vực của một domain không được chứa về mặt cấu trúc mã domain của domain khác; các khu vực dùng chung không được chứa business logic dành riêng cho một domain; các generated artifacts phải tách biệt được với mã viết tay.
- Các ràng buộc mang tính định hướng cho đến khi được phê chuẩn (ratified): chúng mô tả loại bảo đảm (guarantee) mà bố trí phải cung cấp, không phải một bộ rules đã được phê chuẩn.
- Bất kỳ ràng buộc cấu trúc nào cũng phải có thể được thực thi bằng tooling (AP-016) — một ràng buộc mà chỉ reviewer mới kiểm tra được nên thuộc về [dependency-rules.md](dependency-rules.md) với tư cách một rule ứng viên, không phải ở đây với tư cách một thuộc tính cấu trúc.
- Danh sách ràng buộc cụ thể: [chưa được định nghĩa].

## 11. Các Câu hỏi Mở

- Workspace và build tooling nào mà monorepo sẽ sử dụng? (Chưa quyết định — xem [tooling-and-conventions.md](tooling-and-conventions.md); review checklist nhắc đến Nx như một ứng viên, nhưng chưa có quyết định tooling nào tồn tại.)
- Applications sẽ được nhóm chủ yếu theo domain, theo deployment unit, hay theo một trục khác một khi kiến trúc deployment được quyết định?
- Mức độ chi tiết (granularity) nào của các khu vực library là hợp lý ngay từ đầu: một khu vực cho mỗi domain cộng với khu vực dùng chung, hay các khu vực hướng context ngay từ ngày đầu?
- Ownership của thư mục sẽ được mã hóa và kiểm tra bằng máy như thế nào — ownership files, các review routing rules, hay một cơ chế khác?
- Configuration nên được đặt cạnh (colocated) theo project hay tập trung theo environment, xét đến nhu cầu của CI và xử lý secret?
- Chính sách đổi tên (renaming policy) là gì: mức ma sát đổi tên bao nhiêu được chấp nhận để giữ cho các tên trung thực khi các boundaries tiến hóa?

## 12. Các Tài liệu Liên quan

- [Monorepo Architecture README](README.md) — mục đích, các principles và enforcement model của nhóm tài liệu này.
- [project-taxonomy.md](project-taxonomy.md) — các chiều phân loại mà các khu vực thư mục sẽ chứa.
- [dependency-rules.md](dependency-rules.md) — các rule về hướng đi, độc lập với bố trí thư mục.
- [module-boundaries.md](module-boundaries.md) — các rule về encapsulation mà cấu trúc phải làm cho khả kiểm được.
- [deployment-units.md](deployment-units.md) — cách các application project ánh xạ tới các deployment units.
- [tooling-and-conventions.md](tooling-and-conventions.md) — workspace tooling còn chưa quyết định, thứ định hình bố trí thư mục.
- [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md) — các ownership đã được chấp nhận mà cấu trúc phải phản ánh.
- [Architecture Principles](../00-governance/architecture-principles.md) — AP-001, AP-003, AP-006, AP-016.
- [Monorepo Architecture Review Checklist](../08-review-process/review-checklists/monorepo-architecture-review.md) — phần Maintainability là một review contract trực tiếp cho tài liệu này.
- [System Architecture](../05-system-architecture/README.md) — quyết định việc hiện thực hóa deployment mà cấu trúc này phải đáp ứng (các quyết định đang chờ).
- [AI Factory Marketplace](../01-strategy/ai-factory-marketplace.md) — sản phẩm và các domain của nó mà cấu trúc phải mở rộng theo.
