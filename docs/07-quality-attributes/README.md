# Quality Attributes

## 1. Purpose

Nhóm tài liệu này mô tả các Quality Attributes mà kiến trúc Ecoma cần quan tâm và các yêu cầu chất lượng cần được xem xét khi thiết kế, triển khai và review hệ thống.

Đây không phải danh sách công nghệ hay implementation guideline. Việc lựa chọn công nghệ và cách hiện thực hóa thuộc về các nhóm tài liệu kiến trúc và thiết kế chuyên trách; nhóm này xác định các yêu cầu chất lượng mà những quyết định đó phải đáp ứng.

## 2. Scope

**Thuộc nhóm này:**

- Observability.
- Performance.
- Reliability.
- Security.
- Testability.

Không bổ sung các file hoặc nhóm Quality Attributes khác ngoài phạm vi trên.

## 3. Document Structure

| Tài liệu           | Trách nhiệm                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `observability.md` | Ghi nhận yêu cầu liên quan đến khả năng quan sát, traceability và auditability.                               |
| `performance.md`   | Ghi nhận yêu cầu liên quan đến hiệu năng và khả năng mở rộng.                                                 |
| `reliability.md`   | Ghi nhận yêu cầu về độ tin cậy, khả năng phục hồi, failure isolation, blast radius và backward compatibility. |
| `security.md`      | Ghi nhận các yêu cầu về bảo mật, AuthN/AuthZ boundaries, access revocation và auditability.                   |
| `testability.md`   | Ghi nhận yêu cầu về khả năng kiểm thử, tính xác định của test và khả năng xác minh các invariant.             |

Hiện tại các tài liệu trong nhóm ghi nhận yêu cầu ở mức định hướng và nguyên tắc; chưa có mục tiêu định lượng nào (SLO, RTO, RPO, latency, throughput, availability) được xác lập. Các mục tiêu định lượng sẽ được cụ thể hóa qua quy trình quality requirements khi có đủ bối cảnh, theo định hướng của [AP-019](../00-governance/architecture-principles.md).

## 4. Quality Attribute Requirements

Quality Attributes được chuyển hóa thành yêu cầu có thể kiểm chứng theo chuỗi sau:

1. **Quality Attribute** — xác định thuộc tính chất lượng cần đảm bảo.
2. **Quality Attribute Scenario** — mô tả tình huống, điều kiện kích hoạt, môi trường và kết quả mong muốn.
3. **Measurable Requirement** — xác định tiêu chí có thể đo lường hoặc xác minh.
4. **Verification Method** — xác định cách kiểm chứng yêu cầu.
5. **Evidence** — ghi nhận bằng chứng chứng minh kết quả kiểm chứng.

Không tự đặt ra các con số SLO, latency target, throughput target hoặc availability target nếu chưa có quyết định hoặc yêu cầu tương ứng được xác nhận.

## 5. Relationship with Other Documents

- `00-governance/` — cung cấp nguyên tắc và quy trình ra quyết định kiến trúc, bao gồm [architecture principles](../00-governance/architecture-principles.md) định hướng cách xác lập yêu cầu chất lượng.
- `03-domain-design/` — Quality Attributes có thể ảnh hưởng đến các quyết định thiết kế domain và integration.
- `04-tactical-design/` — các pattern được lựa chọn cần đáp ứng những yêu cầu chất lượng có liên quan.
- `05-system-architecture/` — chuyển hóa các yêu cầu chất lượng thành quyết định kiến trúc hệ thống.
- `06-monorepo-architecture/` — xem xét các yêu cầu chất lượng có liên quan đến build, test, dependency và deployment.
- `08-review-process/` — cung cấp quy trình và checklist để review các yêu cầu chất lượng: [quality attributes review checklist](../08-review-process/review-checklists/quality-attributes-review.md).

Quan hệ trên không có nghĩa là mọi Quality Attribute đều phải được giải quyết ở mọi tầng kiến trúc. Mỗi yêu cầu chỉ phát sinh tác động ở những tầng mà nó thực sự áp dụng, và mức độ xem xét phải tương xứng với phạm vi ảnh hưởng của yêu cầu.

## 6. Usage Guidelines

- Mỗi yêu cầu chất lượng phải có phạm vi áp dụng rõ ràng.
- Khi có thể, yêu cầu phải có tiêu chí đo lường hoặc phương pháp xác minh cụ thể.
- Không sử dụng các tính từ chung chung như fast, scalable, secure hoặc reliable thay cho yêu cầu có thể kiểm chứng.
- Khi một yêu cầu ảnh hưởng đến nhiều tầng kiến trúc, phải ghi nhận mối liên hệ giữa yêu cầu và các tài liệu thiết kế liên quan.
- Khi thay đổi yêu cầu chất lượng, cập nhật file tương ứng và xem xét ảnh hưởng đến các quyết định kiến trúc đã có.

## 7. Coverage Considerations

Khi đánh giá mức độ bao phủ của Quality Attributes, cần xem xét hai khía cạnh:

- **Domain Extensibility** — khả năng Ecoma bổ sung domain mới vào sản phẩm ([SD-058](../02-domain-discovery/decisions/strategic-decisions.md)); các yêu cầu chất lượng không được xây dựng chỉ cho hai domain hiện có đến mức chặn trước việc bổ sung domain mới.
- **Architecture Modifiability** — khả năng thay đổi, mở rộng hoặc điều chỉnh kiến trúc mà không tạo ra chi phí thay đổi không cần thiết.

Hai khái niệm này có liên quan nhưng không đồng nhất: một kiến trúc hỗ trợ tốt việc thêm domain mới chưa chắc dễ sửa đổi trong nội bộ, và ngược lại.

Các khía cạnh trên được ghi nhận như những điểm cần xem xét khi đánh giá và bổ sung yêu cầu chất lượng. Nhóm này chưa xác định các yêu cầu cụ thể cho hai khía cạnh này; không tạo thêm file và không tuyên bố yêu cầu nào đã được chốt.
