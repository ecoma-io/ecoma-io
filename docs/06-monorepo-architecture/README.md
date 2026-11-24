# Kiến trúc Monorepo

**Trạng thái:** Scaffold — chỉ mang tính định hướng cấu trúc; chưa chứa quyết định nào đã được review hay phê duyệt.

**Phạm vi:** Cách codebase của Ecoma được tổ chức thành một monorepo — cấu trúc repository, phân loại project, hướng phụ thuộc, thực thi ranh giới (boundary enforcement), cơ chế build/test, và phép ánh xạ phía repository của các deployment unit.

Tài liệu này định hướng cho cả nhóm: nó quản lý những gì, rõ ràng không quản lý những gì, quan hệ với các nhóm kiến trúc lân cận ra sao, và những nguyên tắc nào ràng buộc các quyết định tương lai của nó. Bảy tài liệu đồng hành chia nhỏ các mối quan tâm; không tài liệu nào trong số đó chứa một quyết định đã được chấp nhận.

Cách đọc nhóm tài liệu này trong bối cảnh trạng thái khám phá (discovery) của sản phẩm: ranh giới sản phẩm và domain vẫn đang được thiết lập (xem [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md)), và chưa có quyết định nào về deployment hay workspace tooling. Vì vậy mọi tài liệu ở đây được viết để sẵn sàng cho quyết định (decision-ready), chứ không mang quyết định: nó cố định các mục tiêu, các phân biệt và nghĩa vụ lưu trữ hồ sơ, và đánh dấu mọi thứ còn lại là đang mở.

## 1. Mục đích

Nhóm này quản lý cách codebase của Ecoma được tổ chức thành một monorepo sao cho cấu trúc repository, phân loại project, hướng phụ thuộc và cơ chế build/test phản ánh trung thực các quyền sở hữu (ownership) và ranh giới đã được chấp nhận.

- Khát vọng trung tâm là khả năng kiểm chứng cơ học (mechanical verifiability): một hành vi vi phạm quy tắc ownership hoặc ranh giới phải làm một bước kiểm tra tự động thất bại, chứ không dựa vào trí nhớ của người review hay một trang wiki (AP-016, AP-018).
- Cấu trúc repository là một lớp phản ánh (reflection layer). Nó mã hóa các quyết định được đưa ra ở nơi khác — quyền sở hữu domain từ domain design, hiện thực hóa deployment từ system architecture — thành các project, tag, target và pipeline.
- Lớp phản ánh phải đủ không mất mát thông tin để bảo vệ: khi số lượng domain, bounded context và cộng tác viên tăng lên, repository phải giữ các ranh giới nguyên vẹn trước sự trôi dạt (drift) thay vì bào mòn chúng vì sự tiện lợi.
- Sự bào mòn ranh giới âm thầm là mode thất bại mà nhóm này tồn tại để ngăn chặn: khi một ranh giới bị vi phạm, phải có người hoặc có thứ gì đó phát hiện ra mà không cần một con người tình cờ để ý.
- Một thước đo thứ hai: một contributor mới có thể xác định một đoạn code là gì, ai sở hữu nó, và nó được phép phụ thuộc vào gì — một cách cơ học, trong vài giây.

## 2. Phạm vi

Nhóm này sở hữu việc tổ chức phía repository của codebase:

- Cấu trúc repository — mỗi loại project nằm ở đâu và các khu vực (area) được sở hữu như thế nào (xem [repository-structure.md](repository-structure.md)).
- Phân loại project (taxonomy) — các chiều phân loại được gán cho mọi project (xem [project-taxonomy.md](project-taxonomy.md)).
- Quy tắc phụ thuộc — các quy tắc hướng giữa các lớp project, domain và context, cùng cách thực thi chúng (xem [dependency-rules.md](dependency-rules.md)).
- Thực thi ranh giới module — encapsulation, public surface, và bảo vệ ranh giới trong code (xem [module-boundaries.md](module-boundaries.md)).
- Kiến trúc build và test — build graph, target, caching, phân loại test và thực thi CI (xem [build-and-test-architecture.md](build-and-test-architecture.md)).
- Ánh xạ deployment unit — phản ánh phía repository của các quyết định deployment (xem [deployment-units.md](deployment-units.md)).
- Quy ước tooling — các quyết định về workspace, build, analysis và CI tooling cùng cách lưu hồ sơ của chúng (xem [tooling-and-conventions.md](tooling-and-conventions.md)).

Trong phạm vi này, nhóm cũng sở hữu kỷ luật phân biệt giữ cho những điều trên đứng vững: không tài liệu nào ở đây được phép đồng nhất một repository project với một bounded context, một deployment unit, hay một package, và mọi phép ánh xạ giữa các khái niệm như vậy phải được ghi lại như một phép ánh xạ tường minh, đã được review — không bao giờ mặc định dựa vào cách đặt tên, bố cục hay giá trị mặc định của tooling.

Nhóm này KHÔNG sở hữu:

- Những ranh giới domain tồn tại — điều đó được quyết định bởi nhóm Domain Design (xem [Domain Design](../03-domain-design/README.md)); các bounded context chưa được định nghĩa.
- Cách các ranh giới được hiện thực hóa về mặt kỹ thuật lúc runtime — deployment unit, integration style và hạ tầng thuộc về System Architecture (xem [System Architecture](../05-system-architecture/README.md)).
- Các design pattern trong context (in-context) như aggregate, entity và repository — điều đó thuộc về Tactical Design (xem [Tactical Design](../04-tactical-design/README.md)).

Khi các tài liệu trong nhóm này nói về ranh giới domain hoặc deployment, chúng chỉ nói về phản ánh và thực thi phía repository của những ranh giới đó — không bao giờ nói về bản thân các ranh giới.

Nhóm này cũng không sở hữu repository này (repository docs mà bạn đang đọc). Các tài liệu này mô tả tổ chức monorepo của codebase sản phẩm trong tương lai; cấu trúc của chính repository tài liệu là một mối quan hệ riêng, tầm thường, không nằm trong phạm vi quản lý ở đây.

## 3. Quan hệ với System Architecture

System Architecture (05) quyết định các deployment unit và hiện thực hóa kỹ thuật; nhóm này (06) ánh xạ những quyết định đó lên các repository project, build target và pipeline.

- Một deployment unit là một runtime artifact được build, release và kiểm chứng như một khối. Một repository project là một đơn vị tổ chức mã nguồn, phân loại và kiểm soát phụ thuộc. Đây là hai khái niệm khác nhau và không được phép trộn lẫn (AP-006).
- Một deployment unit có thể được lắp ghép từ nhiều repository project; nhiều deployment unit có thể dùng chung các library project; nhiều bounded context có thể nằm trong một deployment unit nếu có một quyết định đã được chấp nhận.
- Hướng của quyền lực là một chiều: 06 không bao giờ phát minh ra một deployment boundary chỉ vì bố cục repository sẽ tiện lợi theo cách đó. Khi 05 chưa có quyết định nào được chấp nhận, 06 giữ tính chất cấu trúc — nó định nghĩa các phép ánh xạ sẽ được ghi ở đâu và sẽ được kiểm chứng như thế nào, mà không cố định bất kỳ phép ánh xạ nào.
- Bản thân các hồ sơ ánh xạ nằm trong [deployment-units.md](deployment-units.md); cơ chế kiểm chứng nằm trong [build-and-test-architecture.md](build-and-test-architecture.md).
- Kỷ luật tương tự cũng áp dụng theo chiều ngược lại: sự tồn tại, quy mô hay tên của một repository project không bao giờ được trích dẫn làm bằng chứng rằng một ranh giới domain hay deployment tồn tại. Nếu một tuyên bố như vậy được đưa ra, nó phải được chống lưng bởi một quyết định, không phải bởi cây thư mục.
- Khi 05 chấp nhận các quyết định deployment của mình, nghĩa vụ của 06 cũng chạy theo chiều ngược lại: các phép ánh xạ phải được ghi lại và thực thi kịp thời, để repository không bao giờ âm thầm lệch khỏi kiến trúc runtime đã được chấp nhận.

## 4. Nguyên tắc Kiến trúc Repository

Các nguyên tắc này mang tính định hướng. Chúng ràng buộc các quyết định tương lai; không nguyên tắc nào là một bộ quy tắc chi tiết đã được chấp nhận, và mỗi nguyên tắc sẽ chỉ được triển khai chi tiết thông qua quy trình quyết định.

- **Cấu trúc phục vụ quyền sở hữu và ranh giới đã được thiết lập.** Bố cục repository và cách nhóm project tuân theo quyền sở hữu nghiệp vụ và ranh giới domain đã được chấp nhận (xem [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md)), chứ không theo sự tiện lợi kỹ thuật. Cấu trúc là hậu duệ của các quyết định domain (AP-004); nó không bao giờ trở thành bằng chứng định nghĩa chúng.
- **Phân loại project là tường minh.** Các project phải phân loại được thành application, domain, infrastructure, shared platform, testing hoặc tooling, để người tiêu dùng (consumer) có thể biết một project dùng để làm gì và cái gì được phép phụ thuộc vào nó mà không cần đọc mã nguồn. Sự mơ hồ trong phân loại là một defect, không phải một tính năng linh hoạt.
- **Hướng phụ thuộc được máy thực thi.** Các quy tắc phụ thuộc phải được tooling trong CI kiểm soát và kiểm chứng được — thực thi bằng máy, chứ không chỉ bằng quy ước (AP-016, AP-018). Một quy tắc chỉ tồn tại trong văn bản là một gợi ý, và các gợi ý không sống sót qua sự gia tăng của contributor.
- **Thư viện dùng chung có chủ sở hữu và lý do.** Code dùng chung không được trở thành bãi đổ (dumping ground) cho business logic mà không có quyền sở hữu rõ ràng (AP-003). Việc dùng chung là một quyết định của Ecoma Platform với một chủ sở hữu, một contract và một lý do được nêu ra — việc dùng chung kỹ thuật không gộp quyền sở hữu nghiệp vụ.
- **Build, test và deployment hỗ trợ kiểm chứng độc lập.** Mỗi application chạy được, mỗi deployable unit và mỗi test suite phải có ngữ nghĩa build, test và kiểm chứng được định nghĩa (AP-017), để các domain có thể được kiểm chứng — và khi đã quyết định, được deploy — độc lập thay vì trong tình trạng khoá chặt bắt buộc (AP-001, AP-012).
- **Tooling không bao giờ quyết định kiến trúc nghiệp vụ hay domain.** Tooling phục vụ các ranh giới, không bao giờ ngược lại. Không giá trị mặc định, auto-inference hay mức phân chia project của bất kỳ workspace hay build tool nào được phép trở thành định nghĩa trên thực tế (de facto) của một ranh giới domain hay Ecoma Platform.

Cách các nguyên tắc kết hợp với nhau: nguyên tắc đầu tiên cho hướng đi (cấu trúc tuân theo các quyết định), ba nguyên tắc tiếp theo làm cho hướng đi đó duy trì được ở quy mô lớn (phân loại, thực thi, kỷ luật code dùng chung), và hai nguyên tắc cuối giữ cho cơ chế đứng đắn (ngữ nghĩa kiểm chứng, sự phục tùng của tooling). Một quyết định repository được đề xuất mà thỏa mãn một nguyên tắc nhưng vi phạm nguyên tắc khác không phải là "tốt một nửa" — nó không thể được review cho đến khi xung đột được giải quyết một cách tường minh.

Hai ghi chú về trạng thái ràng buộc tất cả các nguyên tắc này:

- Các nguyên tắc ở đây mang tính định hướng. Chúng định hình và ràng buộc các quyết định tương lai; chúng không cho phép bất kỳ quy tắc, bố cục hay tool cụ thể nào chỉ bằng chính chúng.
- Không gì trong nhóm này là một quyết định đã được chấp nhận. Theo [Decision Process](../00-governance/decision-process.md), việc soạn thảo ở trạng thái Draft không có hiệu lực; chỉ trạng thái Accepted mới mang thẩm quyền. Mỗi tài liệu ở đây đều mang một dòng trạng thái Scaffold nói chính xác điều đó.

## 5. Cấu trúc Tài liệu

Bảy tài liệu đồng hành chia nhỏ các mối quan tâm của nhóm này:

- [repository-structure.md](repository-structure.md) — những loại thư mục và project nào mà monorepo phải có khả năng định vị (applications, libraries, shared resources, configuration, documentation) và những gì phải được ghi lại về từng loại trước khi bất kỳ bố cục nào được quyết định.
- [project-taxonomy.md](project-taxonomy.md) — sáu chiều phân loại mà mọi project sẽ được gắn tag, các mục tiêu mà việc phân loại phục vụ, yêu cầu về ownership và các quy tắc phân loại. Các ví dụ rõ ràng chỉ mang tính minh họa.
- [dependency-rules.md](dependency-rules.md) — các loại quy tắc hướng phụ thuộc sẽ được thực thi giữa các lớp project, sản phẩm và domain; ngăn chặn phụ thuộc vòng; thiết kế thực thi; và quy trình ngoại lệ và phê duyệt.
- [module-boundaries.md](module-boundaries.md) — cách các ranh giới domain và sản phẩm từ nhóm domain-design được biểu diễn, encapsulate và bảo vệ trong code; giao tiếp cross-module được cho phép; và các anti-pattern bào mòn ranh giới.
- [build-and-test-architecture.md](build-and-test-architecture.md) — build graph, target, caching, phân loại test (unit/integration/system), quản lý môi trường và dữ liệu test, chiến lược thực thi CI và quality gates, đồng bộ với các quality attribute về testability.
- [deployment-units.md](deployment-units.md) — cách các deployment unit (do System Architecture định nghĩa, vẫn đang chờ) được ánh xạ lên các repository project, và ai sở hữu build artifact, cấu hình, versioning, lifecycle và kiểm chứng.
- [tooling-and-conventions.md](tooling-and-conventions.md) — các lựa chọn workspace tooling vẫn chưa được quyết định: các tiêu chí mà mỗi quyết định phải phục vụ, và những gì sẽ được ghi lại một khi mỗi quyết định được đưa ra.

Các tài liệu tạo thành ba lớp. Định hướng: README này. Cấu trúc: [project-taxonomy.md](project-taxonomy.md) và [repository-structure.md](repository-structure.md) định nghĩa project là gì và nằm ở đâu. Cơ chế: [dependency-rules.md](dependency-rules.md), [module-boundaries.md](module-boundaries.md), [build-and-test-architecture.md](build-and-test-architecture.md), [deployment-units.md](deployment-units.md) và [tooling-and-conventions.md](tooling-and-conventions.md) định nghĩa cách cấu trúc bị ràng buộc, kiểm chứng và hiện thực hóa.

Thứ tự đọc cho một contributor mới: README này, sau đó đến lớp cấu trúc, rồi đến các tài liệu cơ chế khi cần.

Các tài liệu này được cố ý giữ ở dạng scaffold: mỗi tài liệu nêu ra các câu hỏi mà phần của nó phải trả lời, các ranh giới nó bảo vệ, và các câu hỏi đang mở — thay vì lấp đầy những câu trả lời đó bằng các quyết định bịa ra. Chúng được thiết kế để được hoàn thiện thông qua quy trình quyết định khi các nhóm domain design và system architecture tạo ra các quyết định mà nhóm này phản ánh.

## 6. Thực thi Kiến trúc

Các quy tắc repository chỉ trở nên thực sự khi chúng có thể được thực thi.

- Mô hình dự kiến: các quy tắc phụ thuộc và ranh giới được biểu diễn thành các ràng buộc máy kiểm tra được (machine-checkable), chạy trong CI trên mọi thay đổi, và các vi phạm làm build thất bại — với thông báo lỗi nêu tên quy tắc bị vi phạm và đường dẫn phụ thuộc vi phạm — thay vì chỉ tạo review comment (AP-016, AP-018).
- Thiết kế thực thi nằm trong [dependency-rules.md](dependency-rules.md) (những quy tắc nào, hành vi thất bại ra sao, cách theo dõi ngoại lệ) và [build-and-test-architecture.md](build-and-test-architecture.md) (các bước kiểm tra chạy ở đâu trong pipeline, quality gates).
- Bản thân công cụ thực thi chưa được quyết định — việc dùng tag-based boundary linting, module graph analysis, import rules hay một cơ chế khác sẽ được ghi lại như một quyết định một khi đã chọn. Không cơ chế nào được nêu là đã được chọn ở bất kỳ đâu trong nhóm này.
- Thực thi phải được cập nhật trong cùng thay đổi làm thay đổi taxonomy của project, để các lớp project mới kế thừa đúng quy tắc ngay từ ngày đầu và độ phủ quy tắc không bao giờ tụt lại sau cấu trúc.
- Những gì KHÔNG phải thực thi: quy tắc chỉ tồn tại trong tài liệu mà không có bước kiểm tra, cảnh báo không ai sở hữu, hoặc kiểm tra tồn tại trong pipeline nhưng không thể chặn. Nếu một quy tắc quan trọng, nó phải chặn được; nếu chưa thể chặn, nó được ghi lại như một proposal, chứ không giả vờ là có hiệu lực.
- Thực thi có giới hạn: một kiểm tra tự động chứng minh một quy tắc không bị vi phạm trong các đường dẫn được kiểm tra; nó không chứng minh một thuộc tính kiến trúc. Các tuyên bố về chất lượng vẫn phải chịu đo lường, theo sự phân biệt của AP-018 giữa thực thi và quality attribute.
- False positive là một phần của thiết kế thực thi: mọi kiểm tra đều cần một đường xử lý, nếu không contributor sẽ tìm cách lách qua nó — và một kiểm tra bị lách qua còn tệ hơn không có kiểm tra, vì nó dạy rằng các quy tắc là có thể thương lượng.

## 7. Tiến hóa Repository

Cấu trúc repository tuân theo các quyết định đã được chấp nhận, chứ không ngược lại.

- Một sản phẩm, domain hay capability mới chỉ vào được repository sau khi quyết định ownership tương ứng tồn tại. "Tiện lợi trước, quyết định sau" chính xác là sự trôi dạt mà nhóm này tồn tại để ngăn chặn.
- Đối xứng lại, một thay đổi ownership đã được quyết định sẽ kích hoạt một thay đổi cấu trúc: khi quyền sở hữu chuyển đi, repository chuyển theo, trong cùng một thay đổi đã được review nếu khả thi.
- Tái cấu trúc (restructuring) là một thay đổi được review, không phải một refactor ngẫu hứng: di chuyển code vượt qua một ranh giới là một sự kiện kiến trúc ngay cả khi không một dòng logic nào thay đổi.
- Các thay đổi taxonomy — một lớp project mới, một quy tắc phụ thuộc thay đổi, một phân loại lại — là các quyết định có rationale được ghi lại theo [Architecture Decision Process](../00-governance/decision-process.md), không phải sự trôi dạt tích tụ trong cấu hình. Chỉ các quyết định Accepted mới có hiệu lực.
- Khi sản phẩm lớn dần (xem [AI Factory Marketplace](../01-strategy/ai-factory-marketplace.md)), cấu trúc phải giữ cho tính tự chủ của từng domain luôn hiển thị trong repository: các domain không được bị ràng buộc với nhau bởi bố cục thư mục, build target hay cơ chế release nếu không có một quyết định tường minh (AP-001).
- Việc ngừng hoạt động (retire) sản phẩm và context cũng phải để lại một dấu vết repository có thể truy vết — cái gì bị loại bỏ, cái gì được giữ lại cho các contract, và ai quyết định — tuân theo vòng đời portfolio: develop, expand, merge, replace, retire.
- Tiến hóa có một hướng "ít gây bất ngờ nhất" (least surprise): các thay đổi cấu trúc tuân theo một quyết định đã chấp nhận được chuẩn bị như các proposal, được review theo các chuẩn mực của [Review Workflow](../08-review-process/review-workflow.md), và được đưa vào cùng với các cập nhật thực thi của chúng trong cùng một thay đổi, để repository không bao giờ tụt lại hay chạy trước các quyết định của nó.

## 8. Kỳ vọng khi Review

Các thay đổi trong nhóm này được review theo [Monorepo Architecture Review Checklist](../08-review-process/review-checklists/monorepo-architecture-review.md).

- Checklist bao gồm ngữ nghĩa phân loại project, quy tắc phụ thuộc, thực thi, hành vi build/test, ánh xạ deployment và khả năng bảo trì; mỗi tài liệu đồng hành nêu tên các phần của checklist tạo thành hợp đồng review của nó.
- Checklist tham chiếu đến một "Nx Project Taxonomy": Nx được quy trình review nêu tên như một cơ chế ứng viên, nhưng chưa có quyết định nào về workspace tooling. Tham chiếu này nên được đọc là "taxonomy của project, bất kể được hiện thực như thế nào" — không bao giờ là một cam kết về tooling.
- Checklist cũng kỳ vọng các deployment unit được giữ tách biệt với repository project, không có auto-inference target không kiểm soát, và các thư viện dùng chung phải có consumer và contract tường minh — mỗi điều này tương ứng với một phần trong các tài liệu đồng hành.
- Người review nên xác minh rằng các tài liệu phân biệt facts, proposals, open questions và decisions theo [Decision Process](../00-governance/decision-process.md), và rằng thẩm quyền cho các thay đổi ảnh hưởng đến ranh giới tuân theo [Review Policy](../08-review-process/review-policy.md).
- Kỳ vọng phê duyệt: engineering ownership xác nhận taxonomy và workflow; architecture ownership được tham vấn khi một thay đổi ranh giới ảnh hưởng đến Domain hoặc System Architecture.
- Những gì người review nên phản biện: các tài liệu thăng hạng một phát biểu scaffold thành một quy tắc cụ thể mà không có bản ghi quyết định; tooling được nêu là đã chọn; các lớp taxonomy được gán cho project không tồn tại; các quy tắc phụ thuộc được phát biểu như đã phê chuẩn (ratified) khi chúng mang tính định hướng.

## 9. Tài liệu Liên quan

Các tài liệu được liên kết:

- [Domain Design](../03-domain-design/README.md) — định nghĩa các bounded context và ranh giới domain mà cấu trúc repository phải phản ánh (các context chưa được định nghĩa).
- [Tactical Design](../04-tactical-design/README.md) — các design pattern in-context mà nhóm này không sở hữu.
- [System Architecture](../05-system-architecture/README.md) — định nghĩa các deployment unit và hiện thực hóa kỹ thuật mà nhóm này ánh xạ lên repository (các quyết định đang chờ).
- [Architecture Principles](../00-governance/architecture-principles.md) — AP-001 (một sản phẩm, hai domain tự chủ trên Ecoma Platform), AP-003 (domain autonomy), AP-006 (không mặc định ánh xạ một-một), AP-016 (ranh giới module được kiểm soát), AP-017 (ngữ nghĩa build/test/deploy), AP-018 (automation phản ánh kiến trúc contract).
- [Architecture Decision Process](../00-governance/decision-process.md) — bộ từ vựng trạng thái (Draft, Proposed, Accepted; chỉ Accepted có hiệu lực) và cách một proposal trong các scaffold này trở thành một quyết định có hiệu lực.
- [Monorepo Architecture Review Checklist](../08-review-process/review-checklists/monorepo-architecture-review.md) — kỳ vọng review cho mọi tài liệu trong nhóm này.
- [Review Authority](../08-review-process/review-authority.md) — ai phê duyệt các quyết định nhóm Engineering, thứ mà đa số quyết định trong nhóm này sẽ thuộc về.
- [AI Factory Marketplace](../01-strategy/ai-factory-marketplace.md) — các domain mà tính tự chủ của chúng cấu trúc repository phải bảo toàn.
- [Ecoma Strategy](../01-strategy/ecoma-strategy.md) — tầm nhìn tích hợp ở cấp sản phẩm mà các shared platform project sẽ phục vụ.

Tham chiếu dạng văn bản (chưa được tạo):

- docs/02-domain-discovery/README.md (chưa được tạo) — index của nhóm discovery, khi được viết, sẽ liệt kê strategic domain model, capability map và glossary mà cấu trúc repository dựa vào.
- docs/07-quality-attributes/README.md (chưa được tạo) — index của quality attributes; hiện tại nhóm này liên kết trực tiếp đến từng tài liệu attribute riêng lẻ.
