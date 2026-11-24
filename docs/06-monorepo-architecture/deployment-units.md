# Deployment Units

**Trạng thái:** Scaffold — chỉ mang tính định hướng cấu trúc; chưa chứa quyết định nào đã được review hoặc phê duyệt.

**Phạm vi:** Cách các deployment unit — do System Architecture định nghĩa, không phải tại đây — ánh xạ vào các project trong repository, và những trách nhiệm phía repository nào đi theo: quyền sở hữu build artifact, configuration, versioning và verification.

Chưa có quyết định nào về deployment architecture, nên không deployment unit nào được nêu tên tại đây. Tài liệu này chỉ điều phối phần phản chiếu phía repository.

## 1. Định nghĩa Deployment Unit

Deployment unit là một runtime artifact được build, release và verify như một chỉnh thể.

- Các định nghĩa của nó — những unit nào tồn tại, runtime topology của chúng, tính độc lập của chúng — thuộc quyền sở hữu của nhóm System Architecture (xem [System Architecture](../05-system-architecture/README.md)); tài liệu này không định nghĩa hay giả định unit nào.
- File này điều phối phần phản chiếu phía repository: một deployment unit được chấp nhận ánh xạ vào các project có thể build như thế nào, ai sở hữu artifact của nó, và configuration, versioning và verification của nó được neo vào repository ra sao (AP-017).
- Theo AP-006, deployment unit không phải là một project trong repository: ánh xạ giữa chúng được ghi nhận, không bao giờ được giả định, và không bao giờ được suy ra từ cách đặt tên hay vị trí thư mục.

## 2. Phân loại Deployment Unit

Phần này sẽ ghi nhận một cách phân loại các deployment unit một khi System Architecture định nghĩa chúng.

- Loại hình phân loại là một mối quan tâm của repository: những unit nào là long-running service, những unit nào là batch hay event-driven, những unit nào là infrastructure provisioning thay vì application code, và những unit nào dùng chung cho Ecoma Platform so với do domain sở hữu.
- Phân loại chi phối kỳ vọng build-target và cách CI xử lý cho từng unit class trong [build-and-test-architecture.md](build-and-test-architecture.md).
- Nó phải trả lời việc các unit do domain sở hữu và unit do Ecoma Platform sở hữu có tuân theo kỳ vọng release và verification khác nhau hay không.
- Cho đến khi có định nghĩa unit, phần này chỉ ghi nhận các chiều phân loại cần được điền. [Chưa được định nghĩa].

## 3. Ánh xạ Application sang Deployment

Phần này sẽ ghi nhận, cho mỗi deployment unit được chấp nhận, những application project nào cấu thành nó và thông qua những build target nào.

- Đây là ánh xạ tường minh ngăn chặn giả định một-một giữa bounded context, project và deployment unit (AP-006).
- Nó phải trả lời việc thay đổi ánh xạ được review như thế nào — đó là một thay đổi kiến trúc theo [Quy trình quyết định kiến trúc](../00-governance/decision-process.md), không phải một lần chỉnh sửa build configuration.
- Nó phải trả lời việc ánh xạ giữ được đồng bộ với các quyết định của System Architecture như thế nào, thay vì trôi dần thành chỉ build configuration.
- [Chưa được định nghĩa].

## 4. Quyền sở hữu Build Artifact

Phần này sẽ ghi nhận, cho mỗi deployment unit, project nào sở hữu việc tạo ra release artifact.

- Nó phải trả lời artifact chứa những gì, định nghĩa của nó nằm ở đâu, và ai chịu trách nhiệm về tính toàn vẹn của nó.
- Nó phải trả lời việc quyền sở hữu artifact hiển thị như thế nào mà không cần mở pipeline configuration, artifact của shared platform code được quy về đâu, và consumer có thể truy vết một runtime artifact ngược về source và quyết định ra sao.
- Nó phải trả lời việc shared platform code được version bên trong các artifact tiêu thụ nó hay dưới dạng các artifact được version riêng — một quyết định có hệ lụy về tính tự trị (AP-001).
- [Chưa được định nghĩa].

## 5. Deployment Dependencies

Phần này sẽ ghi nhận các ràng buộc về thứ tự và tính tương thích giữa các deployment unit tại thời điểm release.

- Nó phải trả lời unit nào phải tương thích với phiên bản nào của unit khác (AP-020), những release nào cần phối hợp, và coupling giữa các release được giảm thiểu bằng cấu trúc repository ra sao.
- Hướng làm việc hiện tại: coupling được thể hiện qua các contract được khai báo và kiểm tra tương thích của chúng, không qua việc đồng bộ release — bảo toàn tính độc lập release của từng domain (AP-001).
- Các quy tắc hướng dependency trong [dependency-rules.md](dependency-rules.md) nuôi đầu vào cho phân tích này: một dependency graph vi phạm các quy tắc sở hữu sẽ sinh ra release coupling mà không pipeline nào sửa được.
- [Chưa được định nghĩa].

## 6. Independent Deployability

Phần này sẽ ghi nhận, cho mỗi deployment unit, việc nó có thể được deploy độc lập với các unit khác hay không và dưới những điều kiện tiên quyết nào.

- Điều này phản ánh lập trường của AP-012: tính độc lập là mục tiêu có điều kiện, không phải mệnh lệnh — modular monolith và shared deployment unit là những kết quả chính đáng khi ownership, consistency và chi phí vận hành nghiêng về phía chúng.
- Nó phải trả lời việc khả năng deploy độc lập đòi hỏi những thuộc tính phía repository nào — self-contained artifacts, configuration tường minh, kiểm tra tương thích contract — và sự khác biệt về nhịp release giữa các domain được hỗ trợ ra sao thay vì bị ép vào cùng một nhịp.
- Các quyết định ở mức unit đến từ System Architecture; phần này ghi nhận hệ quả của chúng đối với repository.
- [Chưa được định nghĩa].

## 7. Configuration và Secrets

Phần này sẽ ghi nhận cách configuration và secrets của mỗi deployment unit được quản lý phía repository.

- Nó phải trả lời cái gì là configuration đối lập với code, các giá trị theo environment được cung cấp ra sao mà không vào repository, và tư liệu secret được giữ hoàn toàn ngoài source như thế nào — review checklist coi hard-coded configuration là một finding, và [Security](../07-quality-attributes/security.md) mang góc nhìn về threat.
- Nó phải trả lời những thay đổi configuration nào được review như thay đổi kiến trúc và lỗi configuration được phát hiện trước deployment như thế nào.
- Nó phải trả lời configuration được quy về unit sở hữu nó ra sao để blast radius tính toán được.
- [Chưa được định nghĩa].

## 8. Versioning và Release

Phần này sẽ ghi nhận lược đồ versioning và luồng release cho mỗi deployment unit.

- Nó phải trả lời phiên bản được gán ra sao, một release chứa những gì, tính tương thích contract được kiểm tra trước release như thế nào (AP-020), và metadata của release liên kết ngược về trạng thái repository và các quyết định đã sinh ra nó ra sao.
- Hướng làm việc hiện tại: các domain mặc định release độc lập; bất cứ thứ gì ép phải đồng bộ đều cần một quyết định riêng. Hướng này chưa phải là một quy tắc đã được quyết định.
- Nó phải trả lời bản ghi release hỗ trợ các quyết định rollback và việc audit như thế nào.
- [Chưa được định nghĩa].

## 9. Deployment Lifecycle

Phần này sẽ ghi nhận các giai đoạn lifecycle mà repository phải hỗ trợ cho mỗi deployment unit: deploy, readiness, verification và cleanup/rollback — đúng ngữ nghĩa AP-017 yêu cầu.

- Nó phải trả lời định nghĩa lifecycle nằm ở đâu, ai sở hữu chúng, và một lỗi lifecycle được báo ngược về project chịu trách nhiệm ra sao.
- Hành vi phía runtime thuộc về System Architecture và [Reliability](../07-quality-attributes/reliability.md); phần này chỉ sở hữu các định nghĩa phía repository.
- Nó phải trả lời định nghĩa lifecycle có đồng nhất trên các unit class hay thay đổi theo từng class, và sự khác biệt đó được khai báo ra sao.
- [Chưa được định nghĩa].

## 10. Quyền sở hữu Runtime Resource

Phần này sẽ ghi nhận các runtime resource — database, queue, storage, phân bổ infrastructure — được quy về các deployment unit sở hữu chúng ra sao và định nghĩa của chúng nằm ở đâu trong repository.

- Nó phải trả lời ai được sửa một định nghĩa resource, quyền sở hữu resource phản ánh các quyết định về data ownership ra sao (AP-015), và thay đổi resource được review như thế nào khi chúng ảnh hưởng đến các giả định của unit khác.
- Nó phải trả lời shared resource (nếu từng có quyết định nào) khác với unit-owned resource trong repository ra sao.
- Công nghệ resource provisioning chưa được quyết định; tại đây chỉ phạm vi hóa các mối quan tâm về ownership và vị trí đặt.
- [Chưa được định nghĩa].

## 11. Deployment Verification

Phần này sẽ ghi nhận một deployment được verify từ phía repository ra sao.

- Nó phải trả lời những test hoặc check nào cấu thành deployment verification cho từng unit class — system tests trong [build-and-test-architecture.md](build-and-test-architecture.md) là một đầu vào ứng viên — và kết quả verification chốt bước promotion ra sao.
- Nó phải trả lời lỗi verification kích hoạt rollback ra sao, và verification giữ được tính trung thực như thế nào: verify đúng cái đã thực sự được deploy, chứ không phải một bản build giống hệt.
- Nó phải trả lời độ phủ verification được review ra sao khi các unit tiến hóa.
- [Chưa được định nghĩa].

## 12. Câu hỏi mở

- System Architecture sẽ chấp nhận những deployment unit nào, và mỗi unit sẽ ánh xạ vào các application project ra sao? (Toàn bộ còn bỏ ngỏ — chưa có quyết định nào về deployment architecture.)
- Versioning của release sẽ theo từng deployment unit, theo từng domain, hay kết hợp cả hai, một khi tính tự trị release của từng domain được quyết định?
- Cơ chế repository nào sẽ nắm giữ deployment configuration — infrastructure-as-code ngay trong repo, các hệ thống configuration bên ngoài, hay một sự tách kết hợp?
- Tính tương thích contract giữa các unit deploy độc lập sẽ được verify trước release như thế nào?
- Mức deployment verification nào là tương xứng cho từng unit class, cân bằng giữa chi phí với kỳ vọng của [Reliability](../07-quality-attributes/reliability.md)?
- Định nghĩa runtime resource được review ra sao khi chúng vắt qua ranh giới unit?

## 13. Tài liệu liên quan

- [Monorepo Architecture README](README.md) — mối quan hệ giữa deployment unit và repository project.
- [project-taxonomy.md](project-taxonomy.md) — các project class cấu thành deployment unit.
- [build-and-test-architecture.md](build-and-test-architecture.md) — các build target và system test đầu vào cho việc sản xuất và verify artifact.
- [dependency-rules.md](dependency-rules.md) — cấu trúc dependency ràng buộc release coupling.
- [System Architecture](../05-system-architecture/README.md) — sở hữu định nghĩa deployment unit và hiện thực kỹ thuật (các quyết định còn đang chờ).
- [Architecture Principles](../00-governance/architecture-principles.md) — AP-001, AP-006, AP-012, AP-015, AP-017, AP-020.
- [Security](../07-quality-attributes/security.md) — kỳ vọng về xử lý secrets.
- [Reliability](../07-quality-attributes/reliability.md) — kỳ vọng reliability cho deployment verification và lifecycle.
- [Monorepo Architecture Review Checklist](../08-review-process/review-checklists/monorepo-architecture-review.md) — phần "Deployment Mapping" là hợp đồng review cho file này.
