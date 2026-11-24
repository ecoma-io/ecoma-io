# Reliability

## Mục đích

Tài liệu này ghi nhận các thuộc tính chất lượng thuộc nhóm Reliability của Ecoma ở mức định hướng discovery: chúng mô tả ý nghĩa nghiệp vụ và hướng xác minh, chưa phải là yêu cầu định lượng.

## Nguồn

- Các quyết định Accepted — đặc biệt SD-023 (Immutable Historical Obligations), SD-025 (Operational Continuity), ORG-013 và MEM-013 (thu hồi truy cập ngay lập tức), được trích dẫn ở các mục dưới.
- [Architecture Principles](../00-governance/architecture-principles.md) — đặc biệt AP-013 (Failure Isolation), AP-020 (Compatibility và Evolution), AP-019 (Quality Attributes phải đo lường được).

## Ghi chú về mục tiêu định lượng

Tài liệu này không đặt bất kỳ SLO, RTO, RPO hay mục tiêu định lượng nào. Các mục tiêu định lượng sẽ được xác lập qua quy trình quality requirements sau, không thuộc tài liệu này (theo định hướng của AP-019: mỗi mục tiêu cần được cụ thể hóa thành scenario và threshold khi có đủ bối cảnh).

## 1. Resilience

**Ý nghĩa:** Hệ thống duy trì hoạt động nghiệp vụ khi gặp sự cố ở các thành phần phụ thuộc, thay vì chuyển sự cố thành gián đoạn toàn bộ cung ứng.

**Căn cứ và ý nghĩa:**

- Ở **Ecoma Platform-level**, tinh thần của SD-025 (Operational Continuity During Transformation) yêu cầu các sự kiện quản trị — như chuyển đổi tư cách Provider — không làm gián đoạn hoạt động cung cấp dịch vụ hiện hữu. Resilience ở đây là độ tin cậy của enforcement: các thay đổi trạng thái nghiệp vụ phải được thực thi trọn vẹn ngay cả khi có sự cố cục bộ.
- Các quyết định ORG-013 (Immediate Access Revocation) và MEM-013 (Complete Membership Access Revocation) đặt ra yêu cầu độ tin cậy của enforcement: thu hồi truy cập phải xảy ra ngay và triệt để. Một hệ thống kém resilient có thể để lại quyền truy cập đã bị thu hồi vẫn hoạt động sau sự cố — đây là vi phạm cả Reliability lẫn thuộc tính bảo mật (xem [security.md](security.md)).

**Hướng xác minh ở mức nguyên tắc:** xác định behavior khi dependency không khả dụng; kiểm tra các quy trình enforcement quan trọng (revocation, termination) hoàn thành trọn vẹn trong các tình huống thất bại — theo tinh thần Verification của AP-013.

## 2. Failure Isolation

**Ý nghĩa:** Sự cố ở một domain hoặc một capability không lan thành sự cố toàn hệ thống.

**Căn cứ và ý nghĩa:**

- AP-013 (Failure Isolation và Explicit Failure Handling) là Quality Objective trực tiếp: hệ thống phải xác định và kiểm soát tác động khi dependency, integration hoặc thành phần nội bộ gặp lỗi.
- Phân tách ownership theo domain ([SD-059](../02-domain-discovery/decisions/strategic-decisions.md) — hai domain tự chủ trên Ecoma Platform) tạo nền tảng nghiệp vụ cho Failure Isolation: ranh giới business đã được xác lập, ranh giới lỗi phải được thiết kế tương ứng.
- Ở **Domain-level**, sự cố của một domain không được mặc nhiên ảnh hưởng đến vận hành của domain còn lại. Ở **Ecoma Platform-level**, các năng lực dùng chung (SD-004) cần được xem xét đặc biệt vì đây là nơi lỗi có thể lan rộng nhất.

**Hướng xác minh ở mức nguyên tắc:** failure-mode tests và integration tests theo Verification của AP-013; cụ thể hóa qua quy trình quality requirements sau.

## 3. Smallest Blast Radius

**Ý nghĩa:** Phạm vi tác động của một thay đổi hoặc sự cố được giới hạn ở phạm vi nhỏ nhất có thể — một thay đổi không được tạo ra tác động lan sang các phần nghiệp vụ không liên quan.

**Căn cứ và ý nghĩa:**

- Nguyên tắc này phù hợp trực tiếp với phân tách ownership theo domain (SD-059, SD-006 — Independent Domain Ownership) và các ranh giới nghiệp vụ đã xác lập: Account ≠ Consumer Organization ≠ Provider; Consumer Organization ≠ Organization Provider (Domain Boundary 1, 2).
- AP-006 nhắc rõ việc tách deployment cần xét failure isolation; AP-012 đặt deployment independence là mục tiêu có điều kiện. Smallest Blast Radius là tiêu chí định hướng cho các quyết định đó, không phải một topology bắt buộc.
- AP-021 yêu cầu đánh giá tác động trước khi thay đổi implementation — cùng tinh thần giới hạn blast radius của thay đổi.

**Hướng xác minh ở mức nguyên tắc:** review tác động của thay đổi theo ranh giới ownership đã xác lập; các phụ thuộc xuyên Product phải có contract rõ (AP-007) để blast radius có thể được đánh giá.

## 4. Backward Compatibility

**Ý nghĩa:** Thay đổi không phá vỡ các nghĩa vụ và quyền lợi đã phát sinh trước đó.

**Căn cứ và ý nghĩa:**

- SD-023 (Immutable Historical Obligations): lịch sử và nghĩa vụ đã phát sinh được bảo toàn, xử lý theo trạng thái và chính sách có hiệu lực tại thời điểm phát sinh. Đây là căn cứ nghiệp vụ trung tâm: Backward Compatibility không chỉ là vấn đề kỹ thuật (API, schema, event) mà là nghĩa vụ nghiệp vụ.
- Các Product độc lập về lifecycle và được quản trị vòng đời ở cấp Portfolio (SD-002, SD-039) có nghĩa là các bên có thể thay đổi không đồng bộ; AP-020 yêu cầu thay đổi contract, schema, event hoặc API phải xem xét consumer hiện tại và khả năng tương thích.
- Ở **Ecoma Platform-level**: contract tích hợp giữa các domain phải tuân theo compatibility policy (AP-007, AP-020). Ở **Domain-level**: các nghĩa vụ thương mại và dữ liệu đang tồn tại phải được xử lý theo chính sách tại thời điểm phát sinh (SD-023), kể cả khi domain thay đổi chính sách mới.

**Hướng xác minh ở mức nguyên tắc:** contract tests, compatibility checks và migration tests theo Verification của AP-020.
