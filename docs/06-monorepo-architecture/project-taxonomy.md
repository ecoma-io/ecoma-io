# Project Taxonomy

**Trạng thái:** Bản khung — chỉ mang tính định hướng cấu trúc; chưa chứa quyết định nào đã được review hoặc phê duyệt.

**Phạm vi:** Các chiều phân loại mà mọi project trong repository sẽ được gán vào, các mục tiêu mà taxonomy phục vụ, và các quy tắc để phân loại cũng như sở hữu project — chưa có phép gán nào được quyết định.

Tài liệu này định nghĩa những gì việc phân loại phải đạt được và các chiều cần được điền vào. Các tag cụ thể, quy tắc gán và ví dụ thực tế chỉ xuất hiện sau khi các quyết định về taxonomy và tooling tồn tại.

## 1. Mục tiêu phân loại project

Taxonomy tồn tại để mọi project trong repository trả lời được ba câu hỏi mà không cần đọc source code của nó: nó dùng để làm gì, ai sở hữu nó, và cái gì được phép phụ thuộc vào nó.

- Phân loại là nền tảng cho việc machine enforcement: các dependency rules trong [dependency-rules.md](dependency-rules.md) và các boundary checks trong [module-boundaries.md](module-boundaries.md) hoạt động trên các project class, vì vậy các class phải phân biệt được với nhau và có thể gán một cách đầy đủ (AP-016).
- Nó bảo vệ tính vệ sinh khái niệm (AP-006): một repository project không phải là một bounded context, không phải là một deployment unit và không phải là một package, và taxonomy phải giữ các sự phân biệt đó luôn hiển thị thay vì gộp chúng lại.
- Nó hỗ trợ domain autonomy (AP-001): việc phân loại làm hiển thị project nào phục vụ một domain và project nào phục vụ Ecoma Platform, nhờ vậy các quyết định về autonomy có dấu vết trong repository.
- Nó hỗ trợ hiệu quả review: reviewer kiểm tra tính nhất quán của phân loại thay vì phải suy diễn ý định từ nội dung file.
- Review checklist yêu cầu ngữ nghĩa project rõ ràng và từ chối các project được tạo ra chỉ để nhân đôi số target — vì vậy việc phân loại phải chống lại xu hướng phân mảnh granularity chỉ vì bản thân nó.

## 2. Các loại project

Taxonomy định nghĩa sáu chiều phân loại, sẽ được điền với ngữ nghĩa cụ thể một khi đã được quyết định:

- **Application** — một project tạo ra một runnable artifact; ý nghĩa deployment-side của artifact đó được quy định trong [deployment-units.md](deployment-units.md), không phải ở đây.
- **Domain** — một project mang business logic thuộc sở hữu của một bounded context hoặc domain (các context chưa được định nghĩa — xem [Domain Design](../03-domain-design/README.md)).
- **Infrastructure** — một project triển khai technical capability (persistence, transport, external provider adapters) đằng sau các contract, không chứa business policy riêng của nó.
- **Shared platform** — một project cung cấp capability cấp Ecoma Platform với một owner được xác định và một phạm vi consumer được công bố (AP-003).
- **Testing** — một project mà sản phẩm bàn giao của nó là test code và test infrastructure thay vì hành vi được ship.
- **Tooling** — một project hỗ trợ phát triển, sinh code, phân tích hoặc cơ chế release, không bao giờ được ship cho consumer.

Một project chỉ được kết hợp các chiều khi một quy tắc đã được quyết định cho phép sự kết hợp đó; cho đến lúc đó, phân loại đơn là working default. Danh sách này định nghĩa các chiều cần được điền — nó không gán cho bất kỳ project Ecoma hiện có hay tương lai nào.

## 3. Application Projects

Phần này sẽ định nghĩa điều gì khiến một project đủ điều kiện là một application.

- Hướng xác định điều kiện: project build một runnable artifact, có một domain owner hoặc Ecoma Platform owner được xác định, và mapping deployment của nó được ghi nhận — trong [deployment-units.md](deployment-units.md), không phải ở đây.
- Nó phải trả lời một application mang những classification tag nào, liệu application có được import các domain và infrastructure project một cách tự do hay có ràng buộc, và các application project liên hệ thế nào với các domain mà chúng phục vụ dưới domain autonomy (AP-001).
- Nó phải trả lời liệu các application cấp Ecoma Platform (nếu có bao giờ được quyết định) có tạo thành một sub-class riêng biệt hay không.
- [Chưa định nghĩa] đang chờ các quyết định về taxonomy và tooling.

## 4. Domain Projects

Phần này sẽ định nghĩa điều gì khiến một project đủ điều kiện là một domain project.

- Hướng xác định điều kiện: project mang business policy và invariants thuộc sở hữu của đúng một bounded context, với quyền sở hữu có thể truy vết đến các quyết định của nhóm domain-design.
- Nó phải trả lời liệu một domain project có được phép trải dài trên hai context hay không (hướng làm việc là không, đang chờ các định nghĩa context), các domain project giữ tính độc lập với mọi application hoặc transport cụ thể như thế nào, và các tranh chấp về domain ownership được phát hiện ra sao.
- Bản thân các domain boundary đến từ [Domain Design](../03-domain-design/README.md); phần này chỉ quy định cách biểu diễn của chúng trong repository.
- [Chưa định nghĩa] — bounded contexts chưa tồn tại.

## 5. Infrastructure Projects

Phần này sẽ định nghĩa điều gì khiến một project đủ điều kiện là infrastructure.

- Hướng xác định điều kiện: project hiện thực hóa technical capability đằng sau các port hoặc contract và không chứa business policy riêng của nó (hướng của AP-010: infrastructure phụ thuộc về phía abstractions).
- Nó phải trả lời infrastructure project được phép phụ thuộc theo hướng nào, liệu infrastructure project có thể được dùng chung giữa các domain hay không, và provider-specific code được cô lập ra sao để việc thay thế một provider không làm méo mó domain code.
- Nó phải trả lời infrastructure tương tác thế nào với deployment mapping — các infrastructure project là buildable unit, không phải quyết định deployment.
- [Chưa định nghĩa].

## 6. Shared Platform Projects

Phần này sẽ định nghĩa điều gì khiến một project đủ điều kiện là shared platform.

- Hướng xác định điều kiện: project cung cấp một capability được sở hữu ở cấp Ecoma Platform, được nhiều domain tiêu thụ, với một contract và một owner rõ ràng.
- Nó phải trả lời các tiêu chí admission — tại sao capability này được dùng chung thay vì bị nhân bản hoặc thuộc về một domain — và hướng cấm đoán: shared platform không được tích lũy các business rule riêng của domain (AP-003; nguyên tắc chiến lược rằng chia sẻ kỹ thuật không phải là hợp nhất quyền sở hữu business).
- Mọi shared platform project sẽ cần một owner được ghi nhận, một danh sách consumer và một vị trí contract, được giữ chính xác khi các consumer thay đổi.
- [Chưa định nghĩa].

## 7. Testing Projects

Phần này sẽ định nghĩa điều gì khiến một project đủ điều kiện là một testing project.

- Hướng xác định điều kiện: sản phẩm bàn giao của nó là các test, test utility hoặc test environment, phù hợp với việc phân loại test trong [build-and-test-architecture.md](build-and-test-architecture.md) (unit, integration, system).
- Nó phải trả lời các test utility được dùng chung giữa các product có thể đặt ở đâu, các testing project được ngăn khỏi việc trở thành production dependency như thế nào, và những tag nào phân biệt các test class.
- Các kỳ vọng về testability được đặt bởi [Testability](../07-quality-attributes/testability.md); phần này chỉ quy định việc phân loại trong repository.
- [Chưa định nghĩa].

## 8. Tooling Projects

Phần này sẽ định nghĩa điều gì khiến một project đủ điều kiện là tooling.

- Hướng xác định điều kiện: project phục vụ các quy trình phát triển, code generation, static analysis hoặc release, và không bao giờ là một phần của artifact được deploy.
- Nó phải trả lời liệu các tooling project có chia sẻ dependency rules của các class khác hay một tập rút gọn, cấu hình tooling được version cùng với các tool mà nó cấu hình ra sao, và generated code được quy về tool sinh ra nó như thế nào.
- [Chưa định nghĩa].

## 9. Sở hữu project

Mọi project sẽ mang một owner — một cá nhân, team hoặc vai trò domain — được ghi nhận một khi taxonomy được quyết định.

- Ownership quyết định ai phê duyệt các thay đổi đối với public surface của một project, ai được tham vấn cho các cross-boundary dependency, và ai chịu trách nhiệm về các dependency và tình trạng sức khỏe của nó.
- Ownership cũng là cửa cho các câu hỏi về quyền truy cập: team nào được cấp cho một domain hoặc context khác một dependency vào project này (hướng ownership của AP-014 áp dụng cho code, không chỉ data).
- Phân loại mà thiếu ownership là chưa hoàn chỉnh: một project chưa được phân loại và một project không có owner đều là review finding.
- Việc ownership được mã hóa trong project metadata, các directory ownership file, hay cả hai, là [chưa định nghĩa].

## 10. Quy tắc phân loại project

Phần này sẽ ghi nhận các quy tắc vận hành để gán phân loại.

- Hướng giải quyết tranh chấp: khi một project dường như phù hợp với hai chiều, hướng giải quyết mặc định là tách theo ranh giới ownership thay vì phát minh một class lai.
- Nó phải ghi nhận khi nào một project phải được tách, khi nào cần phân loại lại, và các tag ánh xạ lên cơ chế enforcement như thế nào một khi tooling được quyết định.
- Các thay đổi đối với quy tắc phân loại là các quyết định theo [Architecture Decision Process](../00-governance/decision-process.md), không phải các chỉnh sửa cấu hình — taxonomy drift được xử lý như dependency drift.
- [Chưa định nghĩa] đang chờ quyết định về taxonomy.

## 11. Ví dụ

Các ví dụ sau đây **chỉ mang tính minh họa** — chúng thể hiện cách các chiều phân loại sẽ được áp dụng cho các project giả định, và không phải là các quyết định, cam kết của Ecoma hay tên project thật:

- Application project minh họa: một "web storefront application" giả định cho một domain giả định — được phân loại là application, thuộc sở hữu của domain đó.
- Domain project minh họa: một "invitation management library" giả định mang business policy của một context — được phân loại là domain, thuộc sở hữu của owner context đó (bản thân context là giả định).
- Infrastructure project minh họa: một "payment provider adapter" giả định hiện thực hóa một port đằng sau một contract — được phân loại là infrastructure, cô lập theo provider.
- Shared platform project minh họa: một "platform account access library" giả định hiện thực hóa capability shared account cấp Ecoma Platform — được phân loại là shared platform với một danh sách consumer được ghi nhận.
- Testing project minh họa: một "integration test harness" giả định cung cấp contract test infrastructure — được phân loại là testing.
- Tooling project minh họa: một "contract schema generator" giả định được dùng trong CI — được phân loại là tooling.

Chưa có ví dụ thực tế nào; các phân loại thực tế chỉ xuất hiện sau các quyết định về taxonomy và tooling.

## 12. Câu hỏi mở

- Scheme tag và metadata cụ thể cho việc phân loại là gì, một khi workspace tooling được quyết định?
- Một project có được phép hợp pháp kết hợp các chiều hay không (ví dụ, application cộng với tooling), và dưới quy tắc đã quyết định nào?
- Các domain project nên có granularity đến mức nào so với các bounded context, một khi các context được định nghĩa trong domain design?
- Cơ chế nào ghi nhận và xác minh project ownership — metadata tag, ownership file, hay routing review?
- Việc phân loại có nên bắt buộc tại thời điểm tạo project hay không, và điều gì enforce điều đó?
- Ecoma Platform có cần một chiều thứ bảy (ví dụ, các project chỉ chứa contract/schema) hay không, hay điều đó đã được shared platform bao phủ?

## 13. Tài liệu liên quan

- [Monorepo Architecture README](README.md) — mục đích và các nguyên tắc của nhóm.
- [repository-structure.md](repository-structure.md) — nơi mỗi loại project được phân loại sẽ tồn tại.
- [dependency-rules.md](dependency-rules.md) — các quy tắc hoạt động trên các chiều phân loại này.
- [module-boundaries.md](module-boundaries.md) — cách phân loại hỗ trợ encapsulation và bảo vệ boundary.
- [deployment-units.md](deployment-units.md) — sự phân biệt giữa repository project và deployment unit.
- [build-and-test-architecture.md](build-and-test-architecture.md) — kỳ vọng build và test theo từng class.
- [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md) — các quyết định ownership đã được chấp nhận mà taxonomy phải phản ánh.
- [Testability](../07-quality-attributes/testability.md) — các kỳ vọng đầu vào cho testing project class.
- [Architecture Principles](../00-governance/architecture-principles.md) — AP-001, AP-003, AP-006, AP-016.
- [Monorepo Architecture Review Checklist](../08-review-process/review-checklists/monorepo-architecture-review.md) — phần "Project Taxonomy" là review contract cho file này.
