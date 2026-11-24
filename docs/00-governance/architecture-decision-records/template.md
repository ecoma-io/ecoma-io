# ADR-NNNN: `<Decision Title>`

- **Status:** Proposed
- **Category:** Strategic / Domain / Domain Design / Tactical / System Architecture / Engineering / Quality / Governance
- **Owner:** `<Person or role>`
- **Date:** YYYY-MM-DD
- **Decision Scope:** Ecoma Platform / Domain / Bounded Context / System
- **Applies To:** `<Products, Domains, Contexts or Systems>`
- **Related Products / Domains / Contexts:** `<List or links>`

## 1. Context

Mô tả tình huống, vấn đề hoặc nhu cầu dẫn đến quyết định.

Bao gồm khi phù hợp:

- Bối cảnh nghiệp vụ hoặc kỹ thuật.
- Các facts đã xác minh và nguồn tham chiếu.
- Assumptions chưa được xác minh.
- Constraints và các quyết định đang có hiệu lực.
- Lý do cần đưa ra quyết định tại thời điểm này.

## 2. Problem Statement

Phát biểu rõ vấn đề cần giải quyết.

Nêu tiêu chí để đánh giá một phương án phù hợp. Tránh mô tả vấn đề bằng chính giải pháp đang đề xuất.

## 3. Decision Drivers

Liệt kê các yếu tố chi phối quyết định, ví dụ:

- Business ownership.
- Product autonomy.
- Consistency và data integrity.
- Security và compliance.
- Availability và reliability.
- Scalability và performance.
- Deployment independence.
- Operational complexity.
- Development velocity.
- Cost và reversibility.

Chỉ giữ các yếu tố thực sự liên quan.

## 4. Considered Options

### Option A — `<Name>`

- Mô tả:
- Ưu điểm:
- Nhược điểm:
- Rủi ro:
- Hệ quả:

### Option B — `<Name>`

- Mô tả:
- Ưu điểm:
- Nhược điểm:
- Rủi ro:
- Hệ quả:

Thêm hoặc bỏ option tùy tình huống. Nếu chỉ có một phương án khả thi, giải thích constraint khiến các phương án khác không phù hợp.

## 5. Decision

Ghi quyết định đã chọn bằng các câu ngắn, rõ và có thể kiểm chứng.

Phải nêu rõ:

- Điều gì được chấp thuận.
- Phạm vi áp dụng.
- Điều gì không nằm trong phạm vi.
- Các điều kiện hoặc ngoại lệ, nếu có.

Khi record đang ở trạng thái `Proposed`, phần này phải được hiểu là phương án đề xuất, chưa có hiệu lực.

## 6. Rationale

Giải thích vì sao phương án được chọn đáp ứng các Decision Drivers tốt hơn các phương án còn lại.

Không chỉ lặp lại mô tả của Decision.

## 7. Consequences

### Positive

- `<Expected benefit>`

### Negative / Trade-offs

- `<Accepted cost or limitation>`

### Risks

- `<Risk and mitigation>`

### Operational Consequences

- `<Operational impact, if applicable>`

## 8. Impact Analysis

- **Strategy:** `<Impact or None>`
- **Domain:** `<Impact or None>`
- **Bounded Contexts:** `<Impact or None>`
- **Integration Contracts:** `<Impact or None>`
- **Tactical Design:** `<Impact or None>`
- **System Architecture:** `<Impact or None>`
- **Monorepo / Engineering:** `<Impact or None>`
- **Quality Attributes:** `<Impact or None>`
- **Existing Implementations:** `<Impact or None>`

Nêu rõ các mục chưa đánh giá được thay vì để trống nếu chúng có khả năng bị ảnh hưởng.

## 9. Implementation and Verification

- Implementation work items:
- Migration / rollout plan:
- Compatibility requirements:
- Verification method:
- Observability or operational evidence:
- Rollback / recovery strategy:

Nếu quyết định chưa yêu cầu implementation ngay, ghi rõ lý do.

## 10. Related Records and Documents

- **Related ADRs:**
- **Supersedes:**
- **Superseded by:**
- **Related Domain Decisions:**
- **Related Review Records:**
- **Source Documents:**

## 11. Open Questions

- `<Question>`
- `<Owner or next action>`

Chỉ giữ các câu hỏi còn mở có liên quan trực tiếp đến quyết định. Câu hỏi discovery rộng hơn nên được quản lý trong Discovery Backlog.

## 12. Approval

- **Review outcome:** `<Outcome / link to Review Record>`
- **Approved by:** `<Authorized person or role>`
- **Approval date:** YYYY-MM-DD
- **Effective date:** YYYY-MM-DD or On approval
- **Conditions:** `<Conditions, if any>`

---

## Status History

| Date       | Previous Status | New Status | Reason           | Reference |
| ---------- | --------------- | ---------- | ---------------- | --------- |
| YYYY-MM-DD | —               | Proposed   | Initial proposal | `<Link>`  |

Cập nhật bảng này mỗi khi trạng thái thay đổi. Không viết lại lịch sử để xóa trạng thái trước đó.
