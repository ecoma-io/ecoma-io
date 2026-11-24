# Observability

## Mục đích

Tài liệu này ghi nhận các thuộc tính chất lượng thuộc nhóm Observability của Ecoma ở mức định hướng discovery: hệ thống phải cho phép quan sát hành vi nghiệp vụ và trạng thái ở mức đủ để chẩn đoán. Tài liệu không thiết kế tracing infrastructure hay monitoring stack.

## Nguồn

- [Architecture Principles](../00-governance/architecture-principles.md) — đặc biệt AP-013 (Failure Isolation và Explicit Failure Handling), AP-019 (Quality Attributes phải đo lường được).

## Ghi chú về mục tiêu định lượng

Tài liệu này không đặt bất kỳ metric hay mục tiêu định lượng nào. Truy vết các hoạt động và thay đổi có ý nghĩa nghiệp vụ là yêu cầu chung; các mục tiêu định lượng sẽ được xác lập qua quy trình quality requirements sau, không thuộc tài liệu này.

## 1. Observability

**Ý nghĩa:** Hệ thống cho phép quan sát hành vi nghiệp vụ và trạng thái ở mức đủ để chẩn đoán — khi một use case thất bại hoặc một trạng thái nghiệp vụ gây tranh cãi, phải có cách xác định điều gì đã xảy ra mà không cần suy luận ngầm từ code.

**Căn cứ và ý nghĩa:**

- AP-013 liệt kê operational metrics là một trong các phương tiện Verification cho Failure Isolation: quan sát được hành vi lỗi là điều kiện để kiểm soát lỗi. AP-019 yêu cầu chất lượng phải có observable signal tương ứng.
- Các quy trình enforcement nghiệp vụ đã được quyết định — revocation ngay lập tức (ORG-013, MEM-013), termination có hiệu lực ngay (ORG-011), Provider Transformation giữ nguyên hoạt động (SD-025) — chỉ có thể được xác minh trong thực tế nếu hệ thống quan sát được các sự kiện đó.

**Hướng xác minh ở mức nguyên tắc:** với mỗi quy trình nghiệp vụ quan trọng, xác định hành vi nào cần quan sát được và failure behavior nào cần chẩn đoán được. Cụ thể hóa qua quy trình quality requirements sau.

## 2. Traceability

**Ý nghĩa:** Truy vết được luồng nghiệp vụ xuyên các khái niệm đã xác lập — ở mức ý nghĩa nghiệp vụ, không phải thiết kế tracing infrastructure.

**Căn cứ và ý nghĩa:**

- Các chuỗi nghiệp vụ đã được xác lập cần truy vết được giữa các khái niệm, ví dụ: Account → Invitation → Membership (ID-008, INV-002, MEM-015) và Provider → Offering → Commercial Relationship (SD-014, SD-020, SD-034, SD-035).
- AP-006 nhắc rõ các ranh giới nghiệp vụ và kỹ thuật không ánh xạ một-một; do đó Traceability ở đây là khả năng theo dõi quan hệ nghiệp vụ (một Membership phát sinh từ Invitation nào, một Commercial Relationship gắn với Offering và Provider nào), độc lập với cách hệ thống được triển khai kỹ thuật.

**Hướng xác minh ở mức nguyên tắc:** với mỗi chuỗi nghiệp vụ quan trọng, phải trả lời được câu hỏi quan hệ giữa các khái niệm đầu–cuối. Không định nghĩa trước cơ chế.

## 3. Auditability

**Ý nghĩa:** Mỗi hoạt động và thay đổi có ý nghĩa nghiệp vụ phải truy vết được ai làm gì, khi nào, trên đối tượng nào.

**Căn cứ và ý nghĩa:**

- SD-009 (Verifiable Architecture): kiến trúc phải có khả năng kiểm chứng thông qua các quy tắc và bằng chứng phù hợp. Audit trail của các thay đổi nghiệp vụ là một dạng bằng chứng trung tâm của thuộc tính này.
- MEM-008 (Persistent Delegated Permissions) yêu cầu các quyền đã cấp tiếp tục tồn tại cho đến khi một chủ thể có thẩm quyền thay đổi — việc xác định chủ thể có thẩm quyền của một thay đổi là yêu cầu trực tiếp của Auditability. Cùng yêu cầu xuất hiện trong ORG-013: mọi quyền phát sinh từ Organization phải bị thu hồi ngay, và việc thu hồi đó phải có thể kiểm chứng đã xảy ra.
- Phạm vi ví dụ các thay đổi cần audit: quyết định Ownership transfer (MEM-003), Membership revocation (MEM-013), Organization termination (ORG-011), Provider Transformation (SD-021, SD-026), thay đổi Offering (SD-034).
- Thuộc tính này liên quan chặt đến Security (xem [security.md](security.md), mục Auditability — tài liệu đó liên kết về đây, không trùng lặp).

**Hướng xác minh ở mức nguyên tắc:** với mỗi loại thay đổi có ý nghĩa nghiệp vụ liệt kê ở trên, phải tồn tại bằng chứng cho phép xác định chủ thể, hành động, thời điểm và đối tượng. Không đặt metric cụ thể.
