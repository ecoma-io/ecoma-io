# Ecoma Architecture & Domain Discovery Charter

## 1. Mục đích

Tài liệu này xác định mục tiêu, phạm vi, nguyên tắc và phương pháp thực hiện các hoạt động Discovery và Design phục vụ việc xây dựng, thay đổi và duy trì kiến trúc Ecoma.

Charter này có hiệu lực lâu dài. Nó không chỉ phục vụ một đợt Strategic Domain Discovery ban đầu. Mỗi sáng kiến kiến trúc hoặc thay đổi lớn có thể sử dụng Charter này làm cơ sở để xác định phạm vi và điều kiện hoàn thành cụ thể.

## 2. Bối cảnh

Ecoma được định hướng là một Product duy nhất — AI Factory Marketplace (SD-058) — gồm hai domain cung ứng ngang hàng (Domain LLM, Domain GPU) trên một lớp năng lực dùng chung do Ecoma sở hữu (Ecoma Platform, SD-059).

Kiến trúc cần hỗ trợ đồng thời:

- Tính thống nhất ở cấp Ecoma Platform khi có nhu cầu tích hợp.
- Quyền tự chủ nghiệp vụ và vận hành của từng domain.
- Khả năng mở rộng dạng cung ứng trong từng domain và liên kết giữa hai domain khi nhu cầu phát sinh (SD-060).
- Ranh giới ownership rõ ràng giữa các business domain.
- Khả năng phát triển và triển khai độc lập khi có lý do phù hợp.
- Kiểm soát được sự phụ thuộc và tác động thay đổi xuyên domain.

Các định hướng cụ thể của domain, mô hình thương mại và trách nhiệm pháp lý chỉ được xem là đã chốt khi có quyết định tương ứng trong tài liệu chiến lược hoặc Decision Record.

## 3. Mục tiêu

Hoạt động Discovery và Design hướng đến các kết quả sau:

1. Làm rõ mục tiêu chiến lược và vai trò của Ecoma Platform.
2. Xác định cấu trúc domain, phạm vi và mức độ trưởng thành của từng domain.
3. Mô hình hóa các business subject, actor, responsibility, policy, lifecycle và capability.
4. Xác định ownership và ranh giới nghiệp vụ.
5. Thiết kế Bounded Context và quan hệ giữa chúng.
6. Xác định các hợp đồng tích hợp và cách trao đổi thông tin giữa Context.
7. Thiết kế mô hình nội bộ của Context bằng các Tactical Design phù hợp.
8. Xác định System Architecture, Integration Architecture và Deployment Architecture.
9. Xác định cách tổ chức Monorepo, module boundaries và dependency rules.
10. Định nghĩa Quality Attributes và phương pháp xác minh.
11. Duy trì tính nhất quán, khả năng truy vết và lịch sử thay đổi của các quyết định.

## 4. Phạm vi

### 4.1. Trong phạm vi

Charter áp dụng cho:

- Ecoma Strategy và cấu trúc domain của sản phẩm.
- Strategic Domain và Domain Discovery.
- Business Capability, Business Process, Business Lifecycle và Business Policy.
- Domain Glossary và Domain Decision.
- Bounded Context, Context Map và Context Integration.
- Domain Event và Integration Contract.
- Tactical Design: Aggregate, Entity, Value Object, Domain Service, Repository và Application Service.
- System Context, Runtime, Deployment, Security, Data và Integration Architecture.
- Monorepo Architecture, Nx Project Taxonomy, Dependency Rules, Build, Test và Deployment Units.
- Quality Attributes, Architecture Constraints và các cơ chế kiểm chứng.
- Các thay đổi ảnh hưởng đến nhiều domain hoặc nhiều lớp kiến trúc.

### 4.2. Ngoài phạm vi

Charter này không thay thế:

- Product roadmap và kế hoạch delivery chi tiết.
- Đặc tả đầy đủ từng tính năng hoặc User Story.
- Hướng dẫn sử dụng sản phẩm.
- Runbook vận hành chi tiết.
- Quy trình quản trị pháp nhân, nhân sự hoặc tài chính của doanh nghiệp.
- Quy trình quản lý công việc và phê duyệt Pull Request nói chung.

Các nội dung này có thể tham chiếu đến kiến trúc nhưng phải có nơi quản lý chuyên trách.

## 5. Phạm vi phân tích và cấp độ thiết kế

Việc phân tích nên đi từ vấn đề và ownership nghiệp vụ đến giải pháp kỹ thuật. Các lớp dưới đây là các góc nhìn khác nhau, không phải phép ánh xạ một-một.

| Lớp                   | Câu hỏi trọng tâm                                                 | Kết quả chính                                                |
| --------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| Strategy              | Ecoma muốn đạt mục tiêu gì và từng domain đóng vai trò nào?       | Strategic Objectives, AI Factory Marketplace                 |
| Domain Discovery      | Business có những chủ thể, trách nhiệm, policy và capability nào? | Strategic Domain Model, Capability Map, Lifecycle            |
| Domain Design         | Mô hình nghiệp vụ được phân chia thành những Context nào?         | Bounded Context, Context Map                                 |
| Tactical Design       | Mỗi Context bảo vệ mô hình và invariant như thế nào?              | Domain Model, Aggregate Design, Application Design           |
| System Architecture   | Các thành phần chạy, giao tiếp và triển khai ra sao?              | System, Runtime, Deployment, Security, Data Architecture     |
| Monorepo Architecture | Source code và dependency được tổ chức, kiểm soát ra sao?         | Project Taxonomy, Module Boundaries, Build/Test Architecture |
| Quality Attributes    | Hệ thống phải đạt chất lượng nào và xác minh bằng cách nào?       | Quality Requirements, Verification Strategy                  |

## 6. Phương pháp làm việc

### 6.1. Bắt đầu từ vấn đề và tình huống thực tế

Mỗi hoạt động Discovery cần làm rõ:

- Vấn đề hoặc nhu cầu đang được giải quyết.
- Các actor và stakeholder liên quan.
- Các tình huống thực tế, bao gồm ngoại lệ và trường hợp thất bại.
- Trách nhiệm và quyền quyết định của các bên.
- Những quy tắc nghiệp vụ đang tồn tại hoặc cần có.
- Các giả định chưa được xác minh.

Không bắt đầu bằng việc chọn một pattern, framework, database hoặc deployment topology rồi ép business model vào giải pháp đó.

### 6.2. Phân biệt Fact, Assumption, Proposal và Decision

Mỗi nội dung quan trọng phải được phân biệt:

- **Fact:** Thông tin đã được xác minh bằng nguồn đáng tin cậy.
- **Assumption:** Giả định đang được sử dụng nhưng chưa xác minh.
- **Proposal:** Phương án đang được đề xuất để thảo luận.
- **Open Question:** Câu hỏi chưa có câu trả lời hoặc chưa đủ dữ kiện.
- **Decision:** Kết luận đã được chấp thuận theo quy trình.

Không được nâng một Assumption hoặc Proposal thành Decision chỉ vì nó đã xuất hiện trong tài liệu hoặc code.

### 6.3. Phân biệt các loại quyết định

Cần phân biệt ít nhất:

- Strategic Decision: định hướng Ecoma Platform và cấu trúc domain của sản phẩm.
- Domain Decision: business ownership, policy, lifecycle, responsibility và invariant.
- Architecture Decision: ranh giới, topology, integration, deployment và các lựa chọn kiến trúc.
- Engineering Decision: quy ước triển khai, tooling, build, test và code organization.

Một quyết định có thể ảnh hưởng nhiều loại. Khi đó, phải ghi nhận rõ phạm vi và authority cần thiết; không dùng quyết định kỹ thuật để ngầm thay đổi business policy.

### 6.4. Thiết kế theo bằng chứng và hệ quả

Mỗi phương án quan trọng cần được đánh giá dựa trên:

- Mục tiêu cần đạt.
- Các phương án khả thi.
- Lợi ích, chi phí và rủi ro.
- Các dependency và constraint.
- Hệ quả ngắn hạn và dài hạn.
- Khả năng thay đổi hoặc đảo ngược.
- Cách xác minh quyết định khi triển khai.

Không bắt buộc mọi nội dung phải có nhiều phương án nếu chỉ có một phương án khả thi. Khi đó phải ghi rõ constraint khiến các phương án khác không phù hợp.

### 6.5. Lặp lại có kiểm soát

Discovery và Design có thể lặp lại khi xuất hiện thông tin mới. Mỗi vòng lặp cần:

- Xác định nội dung được xem xét lại.
- Giữ nguyên các quyết định không bị ảnh hưởng.
- Ghi nhận quyết định mới hoặc thay đổi.
- Đánh giá tác động đến tài liệu và implementation hiện có.
- Không sửa lịch sử để làm như quyết định mới đã tồn tại từ trước.

## 7. Nguyên tắc phân ranh giới

1. Business ownership phải được xác định trước khi quyết định cách tổ chức code hoặc deployment.
2. Strategic Domain, Business Capability, Bounded Context, Microservice, Deployment Unit và Nx Project là các khái niệm khác nhau.
3. Một Bounded Context phải có trách nhiệm và mô hình nghiệp vụ đủ rõ; không tạo Context chỉ để chia thư mục hoặc chia team.
4. Không hợp nhất business ownership chỉ vì các Context dùng chung công nghệ hoặc hạ tầng.
5. Không tạo shared model chỉ vì hai Context có thuật ngữ hoặc cấu trúc dữ liệu giống nhau.
6. Tích hợp xuyên Context phải thể hiện rõ ownership, contract, consistency expectation và failure behavior.
7. Quyết định phân tách hoặc hợp nhất phải xét cả chi phí phối hợp, vận hành và thay đổi.

## 8. Vai trò tham gia

Các vai trò sau cần được xác định cho từng hoạt động. Một người có thể đảm nhiệm nhiều vai trò, nhưng trách nhiệm phải được ghi rõ.

- **Sponsor / Strategic Owner:** Chịu trách nhiệm về mục tiêu và định hướng chiến lược thuộc phạm vi của mình.
- **Domain Owner:** Chịu trách nhiệm về tính đúng đắn của business model và policy trong domain được giao.
- **Architecture Owner:** Chịu trách nhiệm về tính nhất quán của kiến trúc trong phạm vi được giao.
- **Author:** Chuẩn bị đề xuất, bằng chứng và tài liệu.
- **Reviewer:** Phản biện và đánh giá nội dung.
- **Approver:** Có thẩm quyền chấp thuận quyết định.
- **Implementer:** Chuyển quyết định thành implementation và cung cấp bằng chứng tuân thủ.

Không mặc định người viết tài liệu là người có quyền phê duyệt. Quyền review và approval chi tiết được quy định tại `08-review-process`.

## 9. Đầu ra bắt buộc

Tùy phạm vi hoạt động, đầu ra có thể bao gồm:

- Tài liệu chiến lược hoặc mô hình nghiệp vụ được cập nhật.
- Business Capability hoặc Lifecycle được xác định.
- Domain Glossary được cập nhật.
- Bounded Context và Context Map.
- Tactical Design và Integration Contract.
- System hoặc Monorepo Architecture.
- Quality Attribute và Verification Strategy.
- Decision Records.
- Review Records.
- Discovery Backlog và danh sách câu hỏi còn mở.

Không yêu cầu tạo tất cả đầu ra cho mọi thay đổi. Chỉ tạo những gì cần thiết để giải quyết phạm vi đã xác định.

## 10. Điều kiện hoàn thành một hoạt động Discovery/Design

Một hoạt động chỉ được xem là hoàn thành khi:

1. Phạm vi và vấn đề đã được mô tả rõ.
2. Các stakeholder, actor và ownership liên quan đã được xác định đủ cho phạm vi đó.
3. Các thuật ngữ quan trọng được sử dụng nhất quán.
4. Các Fact, Assumption, Proposal và Open Question được phân biệt.
5. Các quyết định cần thiết đã được chấp thuận hoặc được ghi rõ là chưa giải quyết.
6. Các hệ quả, dependency và rủi ro quan trọng đã được đánh giá.
7. Tài liệu liên quan đã được cập nhật và liên kết.
8. Review cần thiết đã hoàn thành theo `08-review-process`.
9. Các câu hỏi còn mở có owner hoặc cách xử lý tiếp theo.
10. Không còn mâu thuẫn chưa được xử lý với các quyết định đang có hiệu lực.

Hoàn thành một hoạt động không có nghĩa toàn bộ domain hoặc kiến trúc đã bất biến. Quyết định có thể được xem xét lại khi xuất hiện bằng chứng hoặc nhu cầu mới.

## 11. Điều kiện xem xét lại Charter

Charter phải được review khi:

- Mục tiêu hoặc mô hình sản phẩm thay đổi đáng kể.
- Xuất hiện loại quyết định mới chưa được quy định.
- Quy trình hiện tại gây cản trở đáng kể hoặc không kiểm soát được rủi ro.
- Phạm vi quản trị kiến trúc mở rộng sang các nhóm hoạt động chưa được đề cập.
- Có bằng chứng cho thấy các nguyên tắc hoặc phương pháp hiện tại không còn phù hợp.

Mọi thay đổi Charter phải tuân theo `decision-process.md` và `08-review-process`.
