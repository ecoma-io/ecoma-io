# Strategic Domain Discovery

## 1. Purpose

Nhóm tài liệu này ghi nhận kết quả khám phá nghiệp vụ của Ecoma ở cấp Strategic Domain, trước khi tiến hành thiết kế Bounded Context và Tactical Design. Mục tiêu là hiểu đúng business subjects, actors, responsibilities, capabilities, lifecycles, processes và domain boundaries của sản phẩm.

Strategic Domain không đồng nhất với Bounded Context, Domain (LLM/GPU) hay Microservice. Không mặc định ánh xạ 1:1 giữa các khái niệm này; mọi ánh xạ cụ thể phải được quyết định dựa trên ownership, consistency boundary, vận hành và chi phí thay đổi, theo quy định trong [Governance](../00-governance/README.md).

## 2. Scope

**Thuộc nhóm này:**

- Strategic Domain Model — mô hình domain ở cấp chiến lược.
- Domain Glossary — thuật ngữ nghiệp vụ chuẩn hóa.
- Business Capability Map — các năng lực nghiệp vụ.
- Business Lifecycles — vòng đời của các business subjects.
- Business Processes — các quy trình nghiệp vụ.
- Domain Decisions — các quyết định nghiệp vụ đã ghi nhận trong quá trình discovery.
- Discovery Backlog — các câu hỏi và chủ đề chưa kết luận.

Đây là nhóm tài liệu khám phá và mô hình hóa nghiệp vụ. Không phải nơi định nghĩa API, database schema, aggregate hay implementation detail — các nội dung đó thuộc về Domain Design, Tactical Design và các nhóm kiến trúc kỹ thuật.

## 3. Document Structure

### 3.1. Core Models

| Tài liệu                     | Trách nhiệm                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `strategic-domain-model.md`  | Mô tả mô hình domain ở cấp chiến lược, các business subjects, relationships và boundaries đã được khám phá. |
| `domain-glossary.md`         | Chuẩn hóa thuật ngữ nghiệp vụ và ý nghĩa của chúng trong phạm vi Ecoma.                                     |
| `business-capability-map.md` | Ghi nhận các business capabilities được xác định hoặc đang được xem xét.                                    |

### 3.2. Business Lifecycles

- [account-lifecycle.md](business-lifecycles/account-lifecycle.md)
- [consumer-organization-lifecycle.md](business-lifecycles/consumer-organization-lifecycle.md)
- [invitation-lifecycle.md](business-lifecycles/invitation-lifecycle.md)
- [membership-lifecycle.md](business-lifecycles/membership-lifecycle.md)
- [provider-lifecycle.md](business-lifecycles/provider-lifecycle.md)
- [provider-transformation-lifecycle.md](business-lifecycles/provider-transformation-lifecycle.md)

Lifecycle tập trung vào trạng thái, sự kiện chuyển trạng thái, điều kiện và các quy tắc liên quan đến vòng đời của một business subject.

### 3.3. Business Processes

- [account-email-change.md](business-processes/account-email-change.md)
- [account-registration-and-verification.md](business-processes/account-registration-and-verification.md)
- [consumer-invitation.md](business-processes/consumer-invitation.md)
- [consumer-membership-management.md](business-processes/consumer-membership-management.md)
- [consumer-organization-creation.md](business-processes/consumer-organization-creation.md)
- [llm-request-lifecycle.md](business-processes/llm-request-lifecycle.md)
- [provider-registration.md](business-processes/provider-registration.md)
- [provider-transformation.md](business-processes/provider-transformation.md)

Process mô tả trình tự hoạt động nghiệp vụ, actors tham gia, điều kiện và kết quả của một quy trình. Business Process không thay thế Business Lifecycle: lifecycle mô tả các trạng thái của một subject theo thời gian, process mô tả các hoạt động diễn ra trên các trạng thái đó. Mỗi process liên kết đến lifecycle liên quan của nó.

### 3.4. Domain Decisions

- [decisions/README.md](decisions/README.md) — quy ước đọc và quản lý decision register.
- [strategic-decisions.md](decisions/strategic-decisions.md)
- [provider-decisions.md](decisions/provider-decisions.md)
- [account-identity-decisions.md](decisions/account-identity-decisions.md)
- [consumer-organization-decisions.md](decisions/consumer-organization-decisions.md)
- [membership-decisions.md](decisions/membership-decisions.md)
- [invitation-decisions.md](decisions/invitation-decisions.md)
- [financial-decisions.md](decisions/financial-decisions.md)
- [llm-marketplace-decisions.md](decisions/llm-marketplace-decisions.md) — quyết định cấp domain (Domain LLM)
- [gpu-cloud-marketplace-decisions.md](decisions/gpu-cloud-marketplace-decisions.md) — quyết định cấp domain (Domain GPU)

Đây là nơi tổ chức các quyết định nghiệp vụ đã được ghi nhận trong quá trình discovery. Chi tiết cách đọc và quản lý decision register được quy định tại [decisions/README.md](decisions/README.md).

Các decision record trong nhóm này không đồng nhất với formal Architecture Decision Record. ADR kiến trúc thuộc [architecture-decision-records](../00-governance/architecture-decision-records/) theo quy trình decision governance chung; hai hệ thống record không ghi trùng một quyết định.

### 3.5. Discovery Backlog

- [discovery-backlog.md](discovery-backlog.md) — theo dõi các vấn đề, câu hỏi và chủ đề nghiệp vụ chưa được giải quyết hoặc cần tiếp tục khám phá.

## 4. Modeling Responsibilities

| Artifact                | Trả lời câu hỏi                                                 |
| ----------------------- | --------------------------------------------------------------- |
| Strategic Domain Model  | Ecoma đang có những business subjects và domain boundaries nào? |
| Domain Glossary         | Các thuật ngữ nghiệp vụ có ý nghĩa chính xác là gì?             |
| Business Capability Map | Ecoma cần những năng lực nghiệp vụ nào?                         |
| Business Lifecycle      | Một business subject có những trạng thái và chuyển đổi nào?     |
| Business Process        | Một hoạt động nghiệp vụ diễn ra như thế nào?                    |
| Domain Decisions        | Những quyết định nghiệp vụ nào đã được ghi nhận?                |
| Discovery Backlog       | Những vấn đề nào vẫn cần được khám phá hoặc giải quyết?         |

## 5. Relationship with Other Documents

- `01-strategy/` — cung cấp định hướng và phạm vi chiến lược làm đầu vào.
- `00-governance/` — cung cấp quy tắc quản lý và ra quyết định: [Discovery Charter](../00-governance/discovery-charter.md) quy định phương pháp discovery, [Decision Process](../00-governance/decision-process.md) quy định vòng đời quyết định.
- `03-domain-design/` — sử dụng kết quả discovery làm đầu vào để xác định Bounded Context, Context Map, Domain Events và Integration Contracts.
- `08-review-process/` — cung cấp quy trình và checklist để review kết quả discovery: [domain discovery review checklist](../08-review-process/review-checklists/domain-discovery-review.md).

Kết quả discovery là đầu vào cho Domain Design. Điều này không có nghĩa mọi câu hỏi trong backlog phải được đóng trước khi chuyển sang bước tiếp theo; những vấn đề có ảnh hưởng trực tiếp đến tính đúng đắn của domain boundaries và các quyết định nền tảng cần được giải quyết trước, các vấn đề còn lại được theo dõi tiếp trong [Discovery Backlog](discovery-backlog.md).

## 6. Usage Guidelines

- Khi phát hiện thuật ngữ mới hoặc thay đổi ý nghĩa thuật ngữ, cập nhật `domain-glossary.md`.
- Khi phát hiện business subject, relationship hoặc boundary mới, cập nhật `strategic-domain-model.md`.
- Khi xác định hoặc điều chỉnh business capability, cập nhật `business-capability-map.md`.
- Khi thay đổi trạng thái hoặc quy tắc vòng đời, cập nhật lifecycle tương ứng.
- Khi thay đổi trình tự hoặc trách nhiệm trong hoạt động nghiệp vụ, cập nhật business process tương ứng.
- Khi đưa ra quyết định nghiệp vụ, cập nhật decision register phù hợp và áp dụng trạng thái theo [Decision Process](../00-governance/decision-process.md).
- Khi có vấn đề chưa đủ thông tin để kết luận, ghi nhận vào `discovery-backlog.md`; không tự suy diễn giả định hoặc câu hỏi mở thành quyết định.

Phân biệt rõ các loại nội dung sau, theo phương pháp được quy định tại [Discovery Charter](../00-governance/discovery-charter.md) và [decision register](decisions/README.md):

- **Decision** — quyết định đã được chấp thuận (`Accepted`) và có hiệu lực theo Decision Process.
- **Assumption** — giả định chưa được xác minh, không được trình bày như quyết định.
- **Open Question** — câu hỏi chưa đủ thông tin để kết luận.
- **Discovery Backlog Item** — open question được ghi nhận vào backlog với trạng thái `Open` hoặc `Resolved`.

Không tự đặt thêm trạng thái hoặc quy ước mới ngoài những gì các tài liệu governance và discovery hiện có hỗ trợ.
