# Ecoma Architecture Principles

## 1. Mục đích

Tài liệu này xác định các nguyên tắc định hướng cho việc thiết kế, triển khai và thay đổi kiến trúc Ecoma.

Các nguyên tắc là cơ sở để đánh giá phương án, không phải bản thiết kế chi tiết. Chúng không thay thế quyết định cụ thể cho từng domain hoặc system.

Mỗi nguyên tắc có:

- **Statement:** Nội dung nguyên tắc.
- **Rationale:** Lý do tồn tại.
- **Implications:** Hệ quả đối với thiết kế và triển khai.
- **Verification:** Cách kiểm tra mức độ tuân thủ.

## 2. Cách hiểu và áp dụng

Các nguyên tắc được chia thành:

- **Invariant:** Ràng buộc nền tảng. Một thiết kế không được vi phạm nếu chưa có quyết định thay đổi nguyên tắc.
- **Guideline:** Định hướng mặc định. Có thể có ngoại lệ nếu nêu rõ lý do, hệ quả và được chấp thuận.
- **Quality Objective:** Mục tiêu chất lượng cần được cụ thể hóa thành yêu cầu và phương pháp xác minh.

Không được dùng một nguyên tắc ở cấp cao để suy ra một implementation cụ thể nếu chưa đánh giá bối cảnh.

## 3. Ecoma Platform và Domain

### AP-001 — Một sản phẩm, hai domain tự chủ trên Ecoma Platform

**Loại:** Invariant

**Statement:** Ecoma được quản trị như một sản phẩm duy nhất (AI Factory Marketplace) gồm hai domain cung ứng ngang hàng trên một lớp năng lực dùng chung do Ecoma sở hữu. Mỗi domain có business domain, trách nhiệm và vòng đời nghiệp vụ riêng, đồng thời tham gia vào trải nghiệm và năng lực tích hợp ở cấp Ecoma Platform.

**Rationale:** Bảo toàn khả năng phát triển độc lập của từng domain mà không loại bỏ khả năng phối hợp và cung cấp trải nghiệm tổng hợp trong một sản phẩm.

**Implications:**

- Không mặc định hai domain phải dùng chung một business model.
- Không mặc định các domain phải triển khai hoặc release đồng bộ.
- Quan hệ tích hợp phải được thiết kế rõ thay vì dựa trên chia sẻ ngầm.
- Các năng lực chung chỉ được chia sẻ khi ownership và trách nhiệm được xác định.

**Verification:** Mỗi capability và domain responsibility quan trọng phải có owner; các phụ thuộc xuyên domain phải có contract hoặc quyết định tương ứng.

### AP-002 — Phân biệt Ecoma Platform, Domain và Legal/Operating Entity

**Loại:** Invariant

**Statement:** Tên gọi Ecoma có thể được sử dụng trong ngữ cảnh thương hiệu, nhưng không được mặc định đồng nhất Ecoma Platform, domain, platform kỹ thuật và pháp nhân vận hành.

**Rationale:** Tránh nhập nhằng giữa ownership nghiệp vụ, trách nhiệm vận hành, quan hệ thương mại và tư cách pháp lý.

**Implications:**

- Tài liệu phải chỉ rõ chủ thể đang được nói đến.
- Các quyết định về contracting party, Merchant of Record, payment collection, settlement hoặc service responsibility phải được ghi riêng.
- Không suy ra trách nhiệm pháp lý từ tên domain hoặc tên Ecoma.

**Verification:** Các tài liệu có nội dung thương mại, tài chính hoặc trách nhiệm dịch vụ phải định danh đúng chủ thể và phạm vi trách nhiệm.

### AP-003 — Domain Autonomy

**Loại:** Invariant

**Statement:** Domain sở hữu business policy, lifecycle và domain data thuộc phạm vi của mình, trừ phần ownership được quyết định rõ ở cấp Ecoma Platform.

**Rationale:** Tránh tạo ra một business core tập trung khiến mọi domain phụ thuộc vào một mô hình chung không phù hợp.

**Implications:**

- Không đưa business rule riêng của domain vào shared platform chỉ để tái sử dụng code.
- Shared capability phải có ownership, contract và giới hạn trách nhiệm rõ.
- Domain có thể lựa chọn mô hình thương mại và vận hành khác nhau nếu không vi phạm các quyết định cấp Ecoma Platform.

**Verification:** Review ownership của capability, policy và dữ liệu; kiểm tra shared components không chứa business rule không thuộc phạm vi chung.

## 4. Domain Ownership và Domain Design

### AP-004 — Business Ownership trước Technical Boundary

**Loại:** Invariant

**Statement:** Ranh giới kỹ thuật phải được định hướng bởi business responsibility và ownership; không được dùng cấu trúc code, database hoặc deployment hiện tại làm bằng chứng duy nhất để xác định domain boundary.

**Rationale:** Giữ cho kiến trúc phản ánh business semantics thay vì cấu trúc kỹ thuật tình cờ.

**Implications:**

- Strategic Domain Discovery và Domain Design phải làm rõ ownership.
- Technical boundary có thể không trùng Bounded Context.
- Khi technical constraint buộc phải khác domain boundary, cần ghi rõ mapping và lý do.

**Verification:** Quyết định về Context, service hoặc module phải tham chiếu business responsibility liên quan.

### AP-005 — Bounded Context là ranh giới mô hình và ngôn ngữ

**Loại:** Invariant

**Statement:** Mỗi Bounded Context sở hữu một mô hình và ngôn ngữ nhất quán trong phạm vi trách nhiệm của nó.

**Rationale:** Tránh mô hình dùng chung bị kéo giãn để phục vụ nhiều ngữ cảnh có ý nghĩa khác nhau.

**Implications:**

- Không mặc định hai thuật ngữ giống tên có cùng ý nghĩa giữa các Context.
- Không mặc định hai Context phải dùng chung Entity hoặc schema.
- Context Map phải thể hiện quan hệ và cách tích hợp.
- Mỗi Context phải nêu rõ trách nhiệm và phần không thuộc trách nhiệm.

**Verification:** Context Definition, Ubiquitous Language và Context Map không có mâu thuẫn ownership chưa được giải quyết.

### AP-006 — Không mặc định ánh xạ một-một giữa các ranh giới

**Loại:** Invariant

**Statement:** Strategic Domain, Business Capability, Bounded Context, Microservice, Deployment Unit, Nx Project và package là các khái niệm khác nhau; không mặc định chúng ánh xạ một-một.

**Rationale:** Tránh áp đặt cấu trúc kỹ thuật lên mô hình nghiệp vụ hoặc ngược lại.

**Implications:**

- Một Bounded Context có thể được triển khai qua nhiều project hoặc module.
- Nhiều Context có thể cùng tồn tại trong một deployment unit nếu có quyết định phù hợp.
- Việc tách deployment cần xét ownership, consistency, scaling, security, reliability và operational cost.
- Việc chia Nx Project cần xét dependency và khả năng kiểm soát boundary.

**Verification:** Các sơ đồ hoặc tài liệu mapping phải mô tả quan hệ thực tế, không dùng tên gọi thay thế cho nhau.

### AP-007 — Explicit Integration Contracts

**Loại:** Invariant

**Statement:** Tương tác xuyên Bounded Context hoặc domain phải có contract và ownership rõ ràng.

**Rationale:** Giảm coupling ngầm và cho phép các bên thay đổi có kiểm soát.

**Implications:**

- Xác định producer, consumer và owner của contract.
- Làm rõ semantics, versioning, compatibility và error behavior.
- Với asynchronous integration, xác định delivery semantics, idempotency và xử lý duplicate/out-of-order nếu liên quan.
- Không truy cập trực tiếp dữ liệu nội bộ của Context khác như một contract mặc định.

**Verification:** Integration review xác nhận contract, compatibility strategy và failure behavior.

## 5. Domain Model và Tactical Design

### AP-008 — Domain Model bảo vệ Business Invariants

**Loại:** Invariant

**Statement:** Business invariant phải được bảo vệ tại ranh giới chịu trách nhiệm, không chỉ dựa vào UI hoặc một luồng gọi cụ thể.

**Rationale:** Bảo đảm tính đúng đắn khi có nhiều entry point, concurrency hoặc integration.

**Implications:**

- Xác định invariant và consistency boundary.
- Chọn Aggregate boundary dựa trên invariant, không dựa trên quan hệ dữ liệu đơn thuần.
- Xác định concurrency control và transaction semantics.
- Application layer điều phối use case nhưng không thay thế ownership của domain rule.

**Verification:** Có test ở cấp phù hợp chứng minh invariant được giữ trong các tình huống thành công, cạnh tranh và thất bại.

### AP-009 — Rich Domain Model có chọn lọc

**Loại:** Guideline

**Statement:** Sử dụng Rich Domain Model khi hành vi và invariant thuộc về domain object; không ép mọi dữ liệu hoặc object thành domain object có hành vi.

**Rationale:** Bảo vệ business semantics mà không tạo abstraction không cần thiết.

**Implications:**

- Entity và Aggregate có hành vi khi chúng sở hữu rule cần bảo vệ.
- Value Object thể hiện khái niệm và equality theo giá trị.
- DTO, projection, read model và persistence model có thể là cấu trúc đơn giản.
- Domain Service chỉ dùng khi hành vi thực sự thuộc domain nhưng không tự nhiên thuộc một Entity hoặc Aggregate.

**Verification:** Review xem abstraction có thể giải thích bằng domain semantics hay chỉ tồn tại vì pattern.

### AP-010 — Clean Architecture Dependency Direction

**Loại:** Guideline

**Statement:** Domain policy không phụ thuộc vào framework, database, transport hoặc external provider; dependency hướng vào các policy ổn định hơn.

**Rationale:** Cho phép thay đổi infrastructure mà không làm biến dạng domain model.

**Implications:**

- Domain layer không import framework hoặc infrastructure implementation.
- Application layer điều phối use case và phụ thuộc vào abstraction cần thiết.
- Infrastructure adapter hiện thực hóa port hoặc contract.
- Không tạo layer chỉ để tuân theo hình thức nếu không có trách nhiệm thực tế.

**Verification:** Static dependency checks, Nx boundaries và code review.

### AP-011 — CQRS theo nhu cầu

**Loại:** Guideline

**Statement:** Ưu tiên phân biệt command và query về mặt trách nhiệm; chỉ triển khai full CQRS hoặc read/write model tách biệt khi có nhu cầu được chứng minh.

**Rationale:** Giữ mô hình đơn giản trong khi vẫn bảo toàn khả năng mở rộng.

**Implications:**

- Command chịu trách nhiệm thay đổi state và bảo vệ invariant.
- Query không được gây side effect nghiệp vụ ngoài ý muốn.
- Không mặc định phải có event sourcing, message broker hoặc database riêng cho read/write.
- Mọi bất đồng bộ và eventual consistency phải được thể hiện rõ.

**Verification:** Mỗi mức độ tách biệt phải có lý do về workload, consistency, scaling hoặc complexity.

## 6. System và Integration Architecture

### AP-012 — Deployment Independence là mục tiêu có điều kiện

**Loại:** Guideline

**Statement:** Các thành phần nên có khả năng triển khai độc lập khi điều đó đem lại lợi ích thực tế, nhưng không bắt buộc mỗi Bounded Context phải là một Microservice.

**Rationale:** Cân bằng autonomy với chi phí phân tán, vận hành và phối hợp.

**Implications:**

- Quyết định deployment boundary xét coupling, scaling, failure isolation, security, release cadence và operational cost.
- Có thể dùng modular monolith hoặc shared deployment unit khi phù hợp.
- Không tách service chỉ vì muốn phản ánh tên Context.

**Verification:** Architecture Decision phải nêu lý do chọn deployment boundary và chi phí chấp nhận.

### AP-013 — Failure Isolation và Explicit Failure Handling

**Loại:** Quality Objective

**Statement:** Hệ thống phải xác định và kiểm soát tác động khi dependency, integration hoặc thành phần nội bộ gặp lỗi.

**Rationale:** Ngăn lỗi cục bộ lan rộng thành lỗi toàn sản phẩm.

**Implications:**

- Xác định timeout, retry, circuit breaking, backpressure và fallback khi phù hợp.
- Không retry các operation không idempotent nếu chưa có cơ chế bảo vệ.
- Xác định behavior khi dependency không khả dụng.
- Không giả định distributed transaction luôn khả thi.

**Verification:** Failure-mode tests, integration tests, operational metrics và runbook.

### AP-014 — Security và Authorization theo Ownership

**Loại:** Invariant

**Statement:** Authentication xác định danh tính; authorization quyết định quyền. Không suy ra quyền truy cập chỉ từ việc người dùng đã xác thực hoặc có mặt trong Ecoma Platform.

**Rationale:** Bảo vệ ranh giới giữa Account, Organization, Provider, domain và resource ownership.

**Implications:**

- Quyền truy cập phải được xác định trong đúng security/business scope.
- Cross-domain access phải có policy và delegation rõ ràng.
- Quyền được cấp, kế thừa, thu hồi và audit phải có semantics xác định.
- Không tin cậy dữ liệu identity từ client làm bằng chứng authorization.

**Verification:** Threat modeling, authorization tests, access-control review và audit evidence.

### AP-015 — Data Ownership và Controlled Sharing

**Loại:** Invariant

**Statement:** Mỗi domain data có owner rõ ràng. Việc chia sẻ dữ liệu phải thông qua contract hoặc cơ chế được quyết định rõ, không tạo ra quyền ghi tùy tiện lên dữ liệu của domain khác.

**Rationale:** Bảo vệ consistency, lifecycle và quyền kiểm soát dữ liệu.

**Implications:**

- Xác định source of truth.
- Phân biệt operational data, projection và replicated data.
- Xác định retention, deletion, export và data access policy khi liên quan.
- Tránh shared database schema tạo coupling không được quản lý.

**Verification:** Data ownership map, access review và kiểm tra dependency ở database/schema.

## 7. Monorepo và Engineering Architecture

### AP-016 — Module Boundaries phải được kiểm soát

**Loại:** Invariant

**Statement:** Ranh giới module và dependency rules quan trọng phải có khả năng kiểm tra bằng công cụ, không chỉ dựa vào quy ước bằng văn bản.

**Rationale:** Ngăn dependency drift khi số lượng Context, domain và contributor tăng lên.

**Implications:**

- Định nghĩa project taxonomy và tagging convention.
- Sử dụng Nx boundary enforcement hoặc cơ chế tương đương.
- Hạn chế deep import và truy cập implementation nội bộ.
- Ngoại lệ phải có lý do, phạm vi và thời hạn xem xét nếu phù hợp.

**Verification:** CI chạy boundary checks; vi phạm được xử lý như lỗi kiến trúc.

### AP-017 — Build, Test và Deployment phải có semantics rõ

**Loại:** Invariant

**Statement:** Mỗi runnable application, deployable unit và test suite phải có cách build, test, deploy và verify xác định.

**Rationale:** Tránh phụ thuộc vào suy luận ngầm của tooling và bảo đảm pipeline có thể lặp lại.

**Implications:**

- Target quan trọng phải được định nghĩa rõ.
- Không dựa vào auto-inference nếu gây xung đột hoặc làm semantics không rõ.
- Phân biệt library, application, tooling và test project.
- Deployment lifecycle phải có readiness, verification và cleanup khi phù hợp.

**Verification:** CI thực thi target đã định nghĩa; local và CI workflow có kết quả nhất quán trong phạm vi cam kết.

### AP-018 — Automation phải phản ánh Architecture Contract

**Loại:** Guideline

**Statement:** Quy tắc có thể kiểm chứng tự động nên được chuyển thành lint, test, static analysis hoặc CI enforcement.

**Rationale:** Giảm phụ thuộc vào trí nhớ và review thủ công.

**Implications:**

- Ưu tiên tự động hóa dependency, schema, contract, test và documentation checks khi khả thi.
- Phân biệt rule có thể enforce với quality attribute cần đo lường.
- Không tuyên bố một thuộc tính được bảo đảm chỉ vì có một CI check liên quan.

**Verification:** Mỗi enforcement có owner, phạm vi, failure behavior và cách xử lý false positive.

## 8. Quality và Evolution

### AP-019 — Quality Attributes phải đo lường được

**Loại:** Quality Objective

**Statement:** Các yêu cầu về performance, reliability, security, availability, scalability và maintainability phải được diễn đạt đủ cụ thể để có thể đánh giá.

**Rationale:** Tránh các tuyên bố chất lượng chung chung không thể xác minh.

**Implications:**

- Chuyển mục tiêu thành scenario, threshold hoặc observable signal khi phù hợp.
- Ghi nhận workload, điều kiện và phạm vi đo.
- Xác định cách test hoặc giám sát.
- Không áp dụng cùng một mức SLO cho mọi domain nếu nhu cầu khác nhau.

**Verification:** Có metric, test, review hoặc operational evidence tương ứng.

### AP-020 — Compatibility và Evolution phải được thiết kế

**Loại:** Invariant

**Statement:** Thay đổi contract, schema, event hoặc API phải xem xét consumer hiện tại và khả năng tương thích.

**Rationale:** Giảm rủi ro thay đổi gây gián đoạn giữa các domain hoặc deployment độc lập.

**Implications:**

- Xác định compatibility policy và versioning strategy theo loại contract.
- Ưu tiên thay đổi tương thích khi có thể.
- Breaking change phải có migration/deprecation plan.
- Kiểm tra thứ tự rollout và rollback nếu các bên không deploy đồng thời.

**Verification:** Contract tests, compatibility checks, migration tests và rollout plan.

### AP-021 — Quyết định phải có thể được xem xét lại

**Loại:** Invariant

**Statement:** Quyết định kiến trúc là kết luận có hiệu lực trong một bối cảnh xác định, không phải chân lý bất biến. Khi bối cảnh hoặc bằng chứng thay đổi, quyết định có thể được xem xét lại theo quy trình.

**Rationale:** Tránh giữ lại quyết định lỗi thời, đồng thời bảo toàn lịch sử và tính nhất quán.

**Implications:**

- Ghi lại context, rationale, consequence và status.
- Không sửa lịch sử để che khuất thay đổi.
- Quyết định thay thế phải liên kết đến quyết định cũ.
- Đánh giá tác động trước khi thay đổi implementation.

**Verification:** Decision Records có status, owner, liên kết thay thế và impact assessment.

## 9. Ngoại lệ nguyên tắc

Ngoại lệ đối với Guideline hoặc Quality Objective phải nêu:

- Nguyên tắc liên quan.
- Lý do không áp dụng.
- Phạm vi ngoại lệ.
- Rủi ro và hệ quả.
- Biện pháp giảm thiểu.
- Người có thẩm quyền chấp thuận.
- Thời điểm hoặc điều kiện xem xét lại, nếu ngoại lệ có tính tạm thời.

Invariant không được vi phạm bằng một ngoại lệ thông thường. Muốn thay đổi Invariant phải sửa chính nguyên tắc thông qua một Decision Record có thẩm quyền phù hợp.

## 10. Quản lý và cập nhật

Các nguyên tắc phải được review khi:

- Mục tiêu Ecoma Platform hoặc cấu trúc domain của sản phẩm thay đổi.
- Xuất hiện mâu thuẫn giữa các nguyên tắc.
- Có bằng chứng thực tế cho thấy một nguyên tắc gây hệ quả không mong muốn.
- Công nghệ hoặc operating model thay đổi đáng kể.
- Một nguyên tắc không thể được kiểm chứng hoặc không còn ý nghĩa.

Không thêm nguyên tắc chỉ để ghi lại một implementation detail. Chi tiết triển khai thuộc Tactical Design, System Architecture hoặc Monorepo Architecture.
