# Tooling and Conventions

**Trạng thái:** Bản khung — chỉ chứa định hướng cấu trúc; chưa có quyết định nào được review hay phê duyệt.

**Phạm vi:** Các quyết định về workspace và công cụ phát triển mà monorepo yêu cầu — package manager, build system, language tooling, formatting, linting, code generation, CI tooling — trong đó chưa có lựa chọn nào được đưa ra; tệp này ghi lại các tiêu chí mà mỗi lựa chọn phải phục vụ và những gì sẽ được ghi lại sau khi chọn.

Chưa có quyết định tooling nào cho Ecoma. Mọi công cụ được nhắc đến trong tệp này hoặc trong nhóm này đều là ứng viên hoặc yêu cầu, không bao giờ là lựa chọn đã chốt.

## 1. Mục tiêu Quản trị Tooling

Các quyết định về tooling là các quyết định về kiến trúc: workspace orchestrator quyết định biên có thể được thực thi như thế nào, các verification slice được tính như thế nào, và một thay đổi có thể review được đến mức nào (AP-016, AP-017).

- Mọi lựa chọn tooling phải phục vụ việc thực thi biên (boundary enforcement), verification độc lập và khả năng review — tooling phục vụ kiến trúc, không bao giờ ngược lại (xem [Monorepo Architecture README](README.md), mục 4).
- Mỗi lựa chọn được đưa ra và ghi lại thông qua [Architecture Decision Process](../00-governance/decision-process.md) thay vì bằng cách tích lũy các tệp cấu hình; một công cụ không được ghi chép là một quyết định không thể review.
- Không có cấu hình mặc định của công cụ nào âm thầm định nghĩa ngữ nghĩa kiến trúc — auto-inference không được kiểm soát và hành vi target ngầm định là các phát hiện khi review, theo AP-017.
- Quản trị còn bao gồm cả quyền sở hữu trong quá trình vận hành: mọi công cụ có một người sở hữu, một lộ trình nâng cấp và một review trigger, chứ không chỉ là lựa chọn ban đầu.

## 2. Package Manager và Workspace

Package manager và cơ chế workspace chưa được quyết định.

- Các tiêu chí lựa chọn cần được ghi lại: khả năng hỗ trợ workspace layout cho sáu lớp phân loại taxonomy từ [project-taxonomy.md](project-taxonomy.md), lockfile và cam kết về tính tái lập (reproducibility), hiệu năng ở số lượng dự án kỳ vọng, và tính tương thích với build system được chọn.
- Sau khi quyết định, mục này sẽ ghi lại: lựa chọn kèm lý do và các phương án đã cân nhắc, cấu trúc thư mục gốc của workspace, và hành vi của các thao tác toàn workspace theo từng lớp dự án.
- Nó phải trả lời được cách các tệp cấp workspace được sở hữu và review, vì chúng ảnh hưởng đến mọi dự án cùng lúc.
- [Sẽ được xác định].

## 3. Build System

Build system và task orchestrator chưa được quyết định.

- Nx được tham chiếu trong [Monorepo Architecture Review Checklist](../08-review-process/review-checklists/monorepo-architecture-review.md) — hãy xem tham chiếu đó là gọi tên một ứng viên, không phải một quyết định; các phương án thay thế chưa được khảo sát.
- Các tiêu chí lựa chọn cần được ghi lại: mức độ biểu đạt của project graph, tính toán affected slice, ngữ nghĩa caching và cam kết về tính đúng đắn, và khả năng hỗ trợ thực thi biên (cơ chế mà [dependency-rules.md](dependency-rules.md) phụ thuộc vào).
- Sau khi chọn, mục này sẽ ghi lại decision record, quyền sở hữu cấu hình graph, và những quy ước từ [build-and-test-architecture.md](build-and-test-architecture.md) mà công cụ phải hiện thực hóa.
- Nó phải trả lời được cách ràng buộc các cấu hình mặc định của công cụ ở những nơi chúng có thể hàm ý ngữ nghĩa kiến trúc (AP-017).
- [Sẽ được xác định].

## 4. Language và Runtime Tooling

Các ngôn ngữ, runtime và version manager của chúng chưa được quyết định — chưa có lựa chọn ngôn ngữ hay phiên bản nào cho phần cài đặt của Ecoma.

- Các tiêu chí lựa chọn cần được ghi lại: mức độ phù hợp cho domain modeling, khả năng kiểm tra biên tĩnh, tính thực tế trong tuyển dụng và bảo trì, và tính nhất quán giữa các domain nơi shared platform đòi hỏi — nhưng không ép buộc tính đồng nhất vi phạm quyền tự chủ của domain (AP-001).
- Sau khi chọn, mục này sẽ ghi lại các phiên bản, version manager, nhịp nâng cấp, và các ngoại lệ theo từng domain kèm lý do.
- Nó phải trả lời được cách phát hiện và giới hạn hiện tượng lệch phiên bản (version drift) giữa các domain.
- [Sẽ được xác định].

## 5. Định dạng Code (Code Formatting)

Công cụ và phong cách formatting chưa được quyết định.

- Tiêu chí lựa chọn: một cách tiếp cận formatter thống nhất trên toàn repository để giữ cho diff dễ review, tích hợp với editor và CI, và mức độ phủ theo từng ngôn ngữ nhất quán với các lựa chọn ngôn ngữ sau khi được đưa ra.
- Sau khi chọn, mục này sẽ ghi lại vị trí cấu hình (toàn workspace hay theo từng dự án, theo [repository-structure.md](repository-structure.md) mục 6), ai được phép thay đổi quy tắc phong cách (một thay đổi quản trị, không phải chỉnh sửa cá nhân), và cách formatting được thực thi trong các gate của [build-and-test-architecture.md](build-and-test-architecture.md).
- [Sẽ được xác định].

## 6. Linting và Static Analysis

Công cụ linting và static analysis chưa được quyết định, nhưng vai trò của chúng đã được cố định.

- Chúng mang một phần việc thực thi biên và dependency từ [dependency-rules.md](dependency-rules.md), do đó lựa chọn phải hỗ trợ các quy tắc biên tùy chỉnh hoặc tích hợp với cơ chế biên — đây là tiêu chí cứng, không phải sở thích.
- Các tiêu chí lựa chọn cần được ghi lại: khả năng mở rộng quy tắc, hỗ trợ boundary rule, hiệu năng ở quy mô monorepo, và hành vi với false positive.
- Sau khi chọn, mục này sẽ ghi lại quyền sở hữu bộ quy tắc, chính sách mức độ nghiêm trọng (severity), và hành vi của lint failure trong CI (blocking hay advisory, theo các quyết định gate).
- [Sẽ được xác định].

## 7. Code Generation

Chiến lược code generation chưa được quyết định.

- Khi đã quyết định, generation có thể được dùng cho những gì — các lĩnh vực ứng viên bao gồm types và client code suy ra từ contract — và các bất biến mà generation phải giữ trong mọi trường hợp: code sinh ra phải nhận diện được, nguồn sự thật (source of truth) của nó được ghi lại, việc tái sinh (regeneration) phải tái lập được trong CI, và code sinh ra không bao giờ được sửa tay.
- Nó phải trả lời được cách các artifact sinh ra tương tác với việc thực thi biên — code sinh ra tuân theo cùng các quy tắc biên — và cách một bản cập nhật generator được review (nó có thể âm thầm thay đổi nhiều dự án).
- Nó phải trả lời được các định nghĩa generator nằm ở đâu và ai sở hữu chúng theo lớp tooling của taxonomy.
- [Sẽ được xác định].

## 8. Quản lý Dependency

Cơ chế quản trị dependency bên ngoài chưa được quyết định.

- Các định hướng chính sách cần được phê chuẩn: mọi dependency bên ngoài có một người sở hữu và một lý do được ghi lại (review checklist yêu cầu điều này); việc thêm mới và nâng cấp lớn được review; license và posture an ninh được kiểm tra; nhịp cập nhật là có chủ đích thay vì phản ứng.
- Sau khi cơ chế được chọn, mục này sẽ ghi lại cách danh sách dependency được audit, cách lỗ hổng đã biết chặn release, và cách kỳ vọng từ [Security](../07-quality-attributes/security.md) nuôi dưỡng việc audit.
- Nó phải trả lời được cách rủi ro từ dependency bậc trung gian (transitive dependency) được bộc lộ, chứ không chỉ các dependency trực tiếp.
- [Sẽ được xác định].

## 9. Môi trường Phát triển

Câu chuyện về môi trường phát triển chưa được quyết định.

- Nó phải trả lời được cách một contributor có được môi trường làm việc được — local setup, môi trường container hóa, hay remote workspace — bao nhiêu phần setup được kịch bản hóa so với được viết tài liệu, và cách đảm bảo môi trường đồng nhất với CI trong cam kết nhất quán của AP-017.
- Sau khi chọn, mục này sẽ ghi lại cách tiếp cận, lộ trình onboarding mà nó hàm ý, và những phần nào được sở hữu dưới dạng code thay vì hướng dẫn trên wiki — một setup có tài liệu nhưng không ai sở hữu sẽ mục nát.
- Nó phải trả lời được cách phiên bản công cụ của môi trường được giữ đồng bộ với phiên bản công cụ của CI.
- [Sẽ được xác định].

## 10. CI Tooling

Nền tảng CI và công cụ pipeline chưa được quyết định.

- Các tiêu chí lựa chọn cần được ghi lại: khả năng nhận biết monorepo, hỗ trợ thực thi affected slice, xử lý secret, và sự đánh đổi giữa self-hosting và hosted.
- Sau khi chọn, mục này sẽ ghi lại vị trí và quyền sở hữu của các định nghĩa pipeline, cách pipeline giữ đồng bộ với build target, và cách hành vi CI được kiểm thử thay vì được khám phá trong production.
- Kỳ vọng về chiến lược thực thi nằm trong [build-and-test-architecture.md](build-and-test-architecture.md); mục này chỉ sở hữu lựa chọn công cụ.
- [Sẽ được xác định].

## 11. Quyền Sở hữu Cấu hình Công cụ

Cấu hình của mọi công cụ sẽ có một người sở hữu được ghi lại và một kỷ luật thay đổi được tuyên bố.

- Nó phải trả lời được ai phê duyệt thay đổi cấu hình, thay đổi nào đòi hỏi một quyết định kiến trúc so với một review thông thường, và cách thay đổi cấu hình được xác thực — một thay đổi boundary rule phải được kiểm nghiệm đối chiếu với taxonomy, theo review checklist.
- Cấu hình không có người sở hữu sẽ trôi dạt; mục này sẽ ghi lại bản đồ quyền sở hữu khi bộ công cụ tồn tại.
- Nó phải trả lời được cách cấu hình được giữ đồng bộ giữa các cấp workspace, từng dự án và CI.
- [Sẽ được xác định].

## 12. Chính sách Nâng cấp Tooling

Mục này sẽ ghi lại cách các công cụ được nâng cấp.

- Nó phải trả lời được nhịp nâng cấp theo từng lớp công cụ, ai thực thi và review các bản nâng cấp, và cách xác minh tác động của một bản nâng cấp lên việc thực thi biên và tính đúng đắn của caching.
- Các bản nâng cấp của công cụ trọng yếu về thực thi (cơ chế biên, build graph) là các thay đổi nhạy cảm về kiến trúc theo [Architecture Decision Process](../00-governance/decision-process.md), không phải bảo trì thông thường.
- Nó phải trả lời được chiến lược pinning so với floating theo từng lớp công cụ và hệ quả review của nó.
- [Sẽ được xác định].

## 13. Câu hỏi Mở

- Package manager và cơ chế workspace nào sẽ được áp dụng, và trọng số các tiêu chí quyết định là gì?
- Build system nào sẽ được áp dụng? (Nx là một ứng viên được review checklist tham chiếu; các phương án thay thế chưa được khảo sát; chưa có gì được quyết định.)
- Ngôn ngữ và runtime nào sẽ được dùng cho phần cài đặt của Ecoma, và các domain có được phép khác nhau ở nơi shared platform cho phép không?
- Cơ chế thực thi biên nào sẽ mang các dependency rule — native boundary tagging, import linting, hay một cách tiếp cận khác?
- Nền tảng CI nào, và việc xử lý secret có đòi hỏi self-hosting không?
- Code generation có thuộc bộ công cụ ban đầu, hay được trì hoãn cho đến khi các contract tồn tại?

## 14. Tài liệu Liên quan

- [Monorepo Architecture README](README.md) — nguyên tắc rằng tooling phục vụ biên.
- [project-taxonomy.md](project-taxonomy.md) — các lớp mà mọi lựa chọn tooling phải đáp ứng.
- [dependency-rules.md](dependency-rules.md) — việc thực thi mà tooling phải có khả năng biểu đạt.
- [module-boundaries.md](module-boundaries.md) — các kiểm tra biên mà tooling phải mang.
- [build-and-test-architecture.md](build-and-test-architecture.md) — ngữ nghĩa build và CI mà các công cụ hiện thực hóa.
- [repository-structure.md](repository-structure.md) — nơi cấu hình công cụ sẽ nằm.
- [Architecture Principles](../00-governance/architecture-principles.md) — AP-001, AP-016, AP-017, AP-018.
- [Architecture Decision Process](../00-governance/decision-process.md) — cách một lựa chọn tooling trở thành quyết định Accepted.
- [Security](../07-quality-attributes/security.md) — kỳ vọng về dependency audit và xử lý secret.
- [Monorepo Architecture Review Checklist](../08-review-process/review-checklists/monorepo-architecture-review.md) — các mục "Enforcement" và "Maintainability" là hợp đồng review cho tệp này.
