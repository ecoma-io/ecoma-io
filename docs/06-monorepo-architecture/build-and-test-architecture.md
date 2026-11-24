# Kiến trúc Build và Test

**Trạng thái:** Khung sườn — chỉ chứa định hướng cấu trúc; chưa có quyết định nào được review hay phê duyệt.

**Phạm vi:** Build graph, targets, caching, phân loại test và chiến lược thực thi CI mà monorepo phải hỗ trợ, gắn với các kỳ vọng về testability — không chọn build system hay CI tool tại đây.

Tài liệu này nêu rõ mỗi quyết định build và test phải đạt được điều gì, và những gì sẽ được ghi lại khi quyết định được đưa ra. Các công cụ chưa được quyết định; mọi cơ chế được nêu tên là một yêu cầu, không phải một lựa chọn.

## 1. Mục tiêu Build và Test

Bộ máy build và test phải mang lại cho mỗi project các semantics được định nghĩa và lặp lại được: cách nó build, cách nó được test, và cách kết quả của nó có thể được tin tưởng (AP-017).

- Bộ máy phục vụ các boundary: orchestrator cần có khả năng build và test đúng phần bị ảnh hưởng bởi một thay đổi, điều này đòi hỏi một project graph trung thực — graph là bề mặt thực thi, không phải chi tiết tối ưu hóa.
- Phải hỗ trợ việc xác minh độc lập các domain và deployment units khi cần (AP-001, AP-012), thay vì ép xác minh toàn repo cho mọi thay đổi.
- Phải làm cho các tuyên bố về chất lượng đo lường được: một gate chỉ tồn tại nếu có thứ gì đó kiểm tra được chặn lại nó (AP-018, AP-019).
- Không có gì ở đây chọn một công cụ; các phần dưới đây nêu yêu cầu và nghĩa vụ ghi chép.

## 2. Kiến trúc Build

Phần này sẽ ghi lại kiến trúc build được chọn.

- Những gì sẽ được ghi lại: build/workspace orchestrator nào được sử dụng, cách định nghĩa build được phân bố (theo từng project so với pipeline tập trung), và cách build semantics khác nhau giữa các project class theo [project-taxonomy.md](project-taxonomy.md).
- Lựa chọn này phải phục vụ việc thực thi boundary, xác minh độc lập và khả năng review — không phải sự tiện lợi hay sự quen thuộc của đội ngũ.
- Quyết định workspace tooling chưa được đưa ra; Nx được review checklist nhắc đến như một ứng viên, nhưng chưa có quyết định tooling nào tồn tại.
- [Chưa được định nghĩa] cùng với quyết định tooling được ghi lại trong [tooling-and-conventions.md](tooling-and-conventions.md).

## 3. Build Dependency Graph

Phần này sẽ ghi lại cách project graph và các task dependency được khai báo và giữ trung thực.

- Graph phải phản ánh đúng các quan hệ dependency thực tế (AP-017); auto-inference chỉ được chấp nhận ở những nơi semantics của nó được kiểm soát và review — review checklist coi auto-inference không kiểm soát là một finding.
- Graph là nguồn sự thật cho việc tính toán affected-project, nên một edge lỗi thời hoặc thiếu sót sẽ âm thầm phá vỡ cả tính đúng đắn lẫn khả năng thực thi.
- Nó phải trả lời được ai xác thực các thay đổi trên graph, cách kiểm tra graph (một visualization hoặc report có thể review), và cách phát hiện lỗi graph — tốt nhất là bằng các check so sánh các edge được khai báo với các import thực tế.
- [Chưa được định nghĩa].

## 4. Build Targets và Conventions

Phần này sẽ ghi lại convention về target cho từng project class.

- Định hướng: các target quan trọng được khai báo tường minh thay vì dựa vào inference (AP-017); tên target và ý nghĩa của chúng trở thành một phần của public contract của repository dành cho contributors.
- Phải trả lời được những target nào mọi application khai báo (build, test, lint và scope của chúng), target nào là tùy chọn, và semantics nào được chuẩn hóa để CI và con người có thể gọi chúng một cách thống nhất.
- Phải trả lời được cách các khác biệt theo từng class (applications so với domain libraries so với tooling) luôn dễ tìm hiểu thay vì chỉ truyền miệng.
- [Chưa được định nghĩa] cùng với quyết định tooling.

## 5. Build Caching

Phần này sẽ ghi lại chiến lược caching.

- Những gì sẽ được ghi lại: cái gì được cache (build outputs, test results, static analysis), cách cache key được suy ra, và cách chiến lược đảm bảo một kết quả cache không thể che giấu một thay đổi thực — một cache lỗi thời làm nhiễm độc việc xác minh, điều mà review checklist chỉ đích danh.
- Phải trả lời được sự đánh đổi giữa hit rate và tính đúng đắn, remote so với local caching, và cách tính đúng đắn của cache được xác minh khi cấu hình project thay đổi.
- Phải trả lời được ai sở hữu hạ tầng cache và các sự cố cache poisoning được chẩn đoán như thế nào.
- [Chưa được định nghĩa].

## 6. Phân loại Test

Các test sẽ được phân loại thành các cấp unit, integration và system, gắn với các kỳ vọng testability trong [Testability](../07-quality-attributes/testability.md).

- Mỗi class sẽ có mục đích, scope, chi phí thực thi mục tiêu và kỳ vọng về owner được định nghĩa — chính phân loại làm cho chiến lược CI ở phần 13 khả thi: các class rẻ chạy ở khắp mọi nơi, các class đắt chạy có chọn lọc.
- Phải ghi lại các class, định nghĩa của chúng, và các quy tắc quyết định class của một test mới, để phân loại không trôi dạt thành một tiện lợi về chi phí ("nó chậm, gọi nó là system").
- Phải trả lời được test của mỗi class nằm ở đâu (theo project, theo testing project) theo taxonomy.
- Các định nghĩa là [Chưa được định nghĩa] cho đến khi được phê chuẩn dựa trên tài liệu testability.

## 7. Unit Testing

Phần này sẽ ghi lại các kỳ vọng cho unit test.

- Định hướng: unit test xác minh logic của một project duy nhất trong isolation, chạy trên mọi thay đổi bị ảnh hưởng, tránh shared mutable state, và không bao giờ yêu cầu external services.
- Phải trả lời được "unit" nghĩa là gì theo từng project class — unit của một domain library khác với unit của một application — và cách unit test đóng góp vào việc bảo vệ invariant (yêu cầu xác minh của AP-008).
- Phải trả lời được kỳ vọng coverage nếu có được áp dụng, và cách giữ cho chúng mang ý nghĩa thực sự thay vì chỉ hình thức.
- [Chưa được định nghĩa].

## 8. Integration Testing

Phần này sẽ ghi lại các kỳ vọng cho integration test.

- Định hướng: integration test xác minh các contract và tương tác giữa các module, service hoặc real dependencies, gắn với nhu cầu xác minh contract (AP-007, AP-020).
- Phải trả lời được những integration surface nào xứng đáng có integration test — context contracts, shared platform contracts, persistence — và scope của integration test ánh xạ lên dependency graph như thế nào.
- Phải trả lời được trigger thực thi của chúng trong CI và mối quan hệ với các contract compatibility check trong [deployment-units.md](deployment-units.md).
- [Chưa được định nghĩa].

## 9. System Testing

Phần này sẽ ghi lại các kỳ vọng cho system test.

- Định hướng: system test xác minh các application đã được hợp thành theo kiểu end to end trong các điều kiện giống môi trường thật, bao gồm hỗ trợ xác minh deployment cho các deployment units (xem [deployment-units.md](deployment-units.md)).
- Phải trả lời được những domain hoặc flows nào yêu cầu system test, cách system test giữ được tính dễ bảo trì khi sản phẩm mở rộng, và nhịp thực thi của chúng — chúng quá đắt để chạy trên mỗi commit.
- Phải trả lời được các system test failure được triage như thế nào giữa các domain và projects liên quan.
- [Chưa được định nghĩa].

## 10. Môi trường Test và Dependencies

Phần này sẽ ghi lại cách môi trường test và external dependencies được cung cấp.

- Phải trả lời được mô hình provisioning theo từng test class — real services, service containers, test doubles hay fakes — và yêu cầu rằng lựa chọn được ghi lại để test semantics trung thực: một test tuyên bố là integration phải thực sự integrate.
- Phải trả lời được các environment dependency được version và provision như thế nào một cách lặp lại được trong cả thực thi local lẫn CI (yêu cầu nhất quán của AP-017).
- Phải trả lời được cách phát hiện sự trôi dạt giữa môi trường test và các điều kiện giống production.
- [Chưa được định nghĩa].

## 11. Quản lý Test Data

Phần này sẽ ghi lại cách test data được tạo, seed, chia sẻ và dọn dẹp.

- Phải trả lời được generation tất định so với committed fixtures, quyền sở hữu các shared fixtures (một shared fixture là một shared module và thừa hưởng các ràng buộc của nó — xem [module-boundaries.md](module-boundaries.md), phần 9), và các quy tắc vòng đời để test data lỗi thời không âm thầm thay đổi ý nghĩa của test.
- Phải trả lời được cách ngăn test data của một domain rò rỉ vào test của domain khác.
- Test fixtures có thể chứa nội dung mẫu giống người dùng; các quy tắc quản lý của chúng vẫn [Chưa được định nghĩa].

## 12. Test Isolation và Determinism

Phần này sẽ ghi lại các yêu cầu về isolation và determinism.

- Định hướng: test không được phụ thuộc vào thứ tự thực thi, shared mutable state, wall-clock time, khả năng truy cập network hay đặc thù của máy local, trừ khi dependency đó được khai báo và kiểm soát.
- Flaky test được coi là defect có owner, không phải nhiễu nền được chấp nhận — câu hỏi chính sách (quarantine có thời hạn so với blocking ngay lập tức) là [Chưa được định nghĩa].
- Phải trả lời được việc thực thi song song tương tác với isolation như thế nào, và cách phát hiện các vi phạm determinism mà không che giấu bằng retry.
- [Chưa được định nghĩa].

## 13. Chiến lược Thực thi CI

Phần này sẽ ghi lại mô hình thực thi CI.

- Những gì sẽ được ghi lại: những check nào chạy trên những event nào (lựa chọn affected-project so với chạy toàn bộ), thứ tự của các class nhanh và chậm, parallelism và ràng buộc tài nguyên, và cách thực thi CI giữ nhất quán với semantics thực thi local trong phạm vi cam kết của nó (AP-017).
- Các check thực thi boundary và dependency (xem [dependency-rules.md](dependency-rules.md)) chạy trong pipeline này; vị trí và hành vi khi failure của chúng được ghi lại tại đây.
- Phải trả lời được chi phí CI được giới hạn như thế nào khi sản phẩm mở rộng — chiến lược phải degrade một cách ngoan, không tuyến tính theo số lượng project.
- Lựa chọn CI tooling chưa được quyết định — xem [tooling-and-conventions.md](tooling-and-conventions.md); chiến lược là [Chưa được định nghĩa].

## 14. Quality Gates

Phần này sẽ ghi lại những kết quả nào gate việc merge và release.

- Phải trả lời được những test class nào bắt buộc phải pass, những static analysis nào là blocking, và cách scope của gate thay đổi theo project class và domain.
- Gates là nơi bộ máy của nhóm này gặp các quality attributes: [Testability](../07-quality-attributes/testability.md) định nghĩa những gì phải xác minh được, phần này định nghĩa việc xác minh chặn tiến trình ở đâu.
- Gates phải là các quyết định tường minh, không phải các cấu hình branch-protection tích lũy dần; mọi gate có một owner và một lý do (AP-018).
- Tập gate cụ thể là [Chưa được định nghĩa].

## 15. Các Câu hỏi Mở

- Build/workspace orchestrator và CI system nào sẽ được sử dụng? (Chưa quyết định; review checklist chỉ nhắc đến Nx như một ứng viên.)
- "Affected projects" được tính như thế nào — chỉ từ graph đã khai báo, hay kèm thêm các quy tắc phân loại thay đổi?
- Những test class nào chạy trên mỗi pull request so với nightly hoặc release candidates, một khi có dữ liệu chi phí thực tế?
- Remote build caching có được áp dụng ngay từ đầu không, và với những cam kết tính đúng đắn nào?
- Chính sách cho flaky test là gì — quarantine có thời hạn, hay blocking ngay lập tức?
- Mức độ production parity của môi trường test đáng với chi phí provisioning của nó ở từng test class là bao nhiêu?

## 16. Tài liệu Liên quan

- [Monorepo Architecture README](README.md) — các principles bao gồm yêu cầu semantics của AP-017.
- [project-taxonomy.md](project-taxonomy.md) — các project class mà build targets và test classification tuân theo.
- [dependency-rules.md](dependency-rules.md) — các enforcement check được thực thi trong CI pipeline.
- [module-boundaries.md](module-boundaries.md) — các ràng buộc của shared fixture và boundary check trong CI.
- [deployment-units.md](deployment-units.md) — xác minh deployment được system testing hỗ trợ.
- [Testability](../07-quality-attributes/testability.md) — các kỳ vọng quality-attribute mà kiến trúc này phải đáp ứng.
- [tooling-and-conventions.md](tooling-and-conventions.md) — các quyết định tooling chưa chốt mà tệp này ghi lại hậu quả của chúng.
- [Architecture Principles](../00-governance/architecture-principles.md) — AP-008, AP-017, AP-018, AP-019.
- [Monorepo Architecture Review Checklist](../08-review-process/review-checklists/monorepo-architecture-review.md) — phần "Build and Test" là hợp đồng review của tệp này.
