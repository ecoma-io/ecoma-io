# Ecoma Architecture Governance

## 1. Mục đích

Thư mục này định nghĩa nền tảng quản trị kiến trúc được sử dụng lâu dài cho toàn bộ Ecoma. Nó quy định cách hình thành, ghi nhận, đánh giá, phê duyệt, thay đổi và duy trì các quyết định có ảnh hưởng đến kiến trúc.

Phạm vi quản trị bao gồm toàn bộ vòng đời:

- Strategic Discovery và Domain Discovery.
- Domain Design, bao gồm Bounded Context và Context Map.
- Tactical Design.
- System Architecture và Integration Architecture.
- Data, Security, Deployment và Runtime Architecture.
- Monorepo Architecture và Engineering Architecture.
- Các thay đổi kiến trúc phát sinh trong quá trình phát triển và vận hành.

Đây là bộ quy tắc quản trị kiến trúc, không phải tài liệu mô tả kiến trúc hiện trạng. Các mô hình, thiết kế và quyết định cụ thể phải được ghi nhận tại những nhóm tài liệu chuyên trách.

## 2. Cấu trúc

```text
00-governance/
├── README.md
├── discovery-charter.md
├── architecture-principles.md
├── decision-process.md
└── architecture-decision-records/
    └── template.md
```

| Tài liệu                                    | Trách nhiệm                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `discovery-charter.md`                      | Xác định mục tiêu, phạm vi, phương pháp và điều kiện hoàn thành hoạt động discovery/design |
| `architecture-principles.md`                | Định nghĩa các nguyên tắc định hướng và ràng buộc kiến trúc                                |
| `decision-process.md`                       | Định nghĩa cách quản lý vòng đời và thay đổi quyết định                                    |
| `architecture-decision-records/template.md` | Chuẩn hóa cách ghi nhận một quyết định kiến trúc                                           |

## 3. Quan hệ với các nhóm tài liệu khác

Architecture Knowledge Base được tổ chức theo các lớp trách nhiệm:

1. `00-governance`: quản trị cách hình thành và thay đổi tri thức kiến trúc.
2. `01-strategy`: chiến lược Ecoma Platform, cấu trúc sản phẩm và mục tiêu.
3. `02-domain-discovery`: mô hình nghiệp vụ, Business Capability, Lifecycle, Process và Domain Decision.
4. `03-domain-design`: Bounded Context, Context Map, Domain Event và Integration Contract.
5. `04-tactical-design`: cách hiện thực hóa Domain Model bên trong từng Bounded Context.
6. `05-system-architecture`: kiến trúc hệ thống, runtime, deployment, security, data và integration.
7. `06-monorepo-architecture`: tổ chức source code, Nx Projects, dependency, build, test và deployment units.
8. `07-quality-attributes`: các thuộc tính chất lượng và cách xác minh chúng.
9. `08-review-process`: quy trình, thẩm quyền, checklist và bằng chứng review.

Các nhóm tài liệu trên không phải các giai đoạn tuyến tính tuyệt đối. Thông tin mới có thể khiến một lớp cần được xem xét lại. Tuy nhiên, thay đổi phải được truy vết và đánh giá tác động, không được âm thầm sửa một lớp bằng quyết định thuộc lớp khác.

## 4. Quy tắc sử dụng

### 4.1. Phân biệt mô hình, đề xuất và quyết định

Mọi nội dung có ảnh hưởng đến kiến trúc phải thể hiện rõ nó là:

- Mô tả hiện trạng hoặc thông tin đã được xác minh.
- Đề xuất đang được xem xét.
- Câu hỏi chưa có kết luận.
- Quyết định đã được chấp thuận.
- Quyết định đã bị thay thế hoặc rút lại.

Không trình bày một đề xuất hoặc giả định như một quyết định đã được thống nhất.

### 4.2. Một nguồn sở hữu cho mỗi nội dung

Mỗi khái niệm, quyết định hoặc mô hình phải có một tài liệu sở hữu chính. Các tài liệu khác liên kết đến nguồn đó thay vì sao chép định nghĩa.

Ví dụ:

- Định nghĩa Bounded Context thuộc hồ sơ của chính Context.
- Quan hệ giữa các Context thuộc Context Map.
- Quy tắc tổ chức Nx Project thuộc Monorepo Architecture.
- Quyết định thay đổi một ranh giới kiến trúc được ghi nhận trong Decision Record và liên kết đến các tài liệu bị ảnh hưởng.

### 4.3. Tính truy vết

Các quyết định quan trọng cần liên kết đến:

- Vấn đề hoặc nhu cầu dẫn đến quyết định.
- Mục tiêu chiến lược hoặc yêu cầu nghiệp vụ liên quan, nếu có.
- Các mô hình và tài liệu chịu ảnh hưởng.
- Các quyết định phụ thuộc hoặc bị thay thế.
- Cách xác minh việc triển khai phù hợp với quyết định.

Không bắt buộc mọi quyết định kỹ thuật nhỏ phải có chuỗi truy vết đầy đủ đến Strategic Objective. Mức độ truy vết phải tương xứng với phạm vi ảnh hưởng.

### 4.4. Không mặc định ánh xạ 1:1

Không mặc định các khái niệm sau tương ứng một-một:

- Domain (LLM/GPU) và Strategic Domain.
- Business Capability và Bounded Context.
- Bounded Context và Microservice.
- Bounded Context và Deployment Unit.
- Bounded Context và Nx Project.
- Nx Project và Package hoặc thư mục source code.

Mọi ánh xạ cụ thể phải được quyết định dựa trên ownership, consistency boundary, vận hành và chi phí thay đổi.

## 5. Nguyên tắc quản lý tài liệu

- Tài liệu phải phản ánh quyết định và hiểu biết hiện tại, không phải lịch sử trao đổi chưa được xử lý.
- Nội dung chưa chắc chắn phải được đánh dấu rõ và có đường dẫn đến câu hỏi hoặc Discovery Item tương ứng.
- Không xóa lịch sử quyết định đã được chấp thuận. Khi thay đổi, tạo quyết định mới và đánh dấu quyết định cũ là `Superseded` hoặc `Withdrawn`.
- Mỗi tài liệu phải có phạm vi và trách nhiệm rõ ràng.
- Chỉ tạo tài liệu khi có nội dung thực sự cần quản lý; không tạo file rỗng chỉ để hoàn thiện cấu trúc.
- Tên file và thư mục nên ổn định, có ý nghĩa và không phụ thuộc vào trạng thái tạm thời của dự án.

## 6. Quản lý thay đổi bộ Governance

Thay đổi các quy tắc trong `00-governance` cũng phải được review. Một thay đổi không được tự miễn trừ khỏi quy trình chỉ vì nó thay đổi chính quy trình đó.

Mọi thay đổi có thể làm thay đổi cách phân loại, phê duyệt hoặc lưu trữ quyết định phải có Decision Record, nêu rõ:

- Vấn đề của quy tắc hiện tại.
- Phạm vi thay đổi.
- Tác động đến các quyết định và tài liệu đang tồn tại.
- Cách chuyển đổi các record cũ, nếu cần.

## 7. Trạng thái tài liệu và tính hiệu lực

Trạng thái của tài liệu không thay thế trạng thái của quyết định bên trong tài liệu.

Một tài liệu có thể đang được cập nhật nhưng vẫn chứa các quyết định đã được chấp thuận. Ngược lại, việc một tài liệu đã được merge hoặc publish không có nghĩa mọi nội dung trong đó đã trở thành quyết định.

Trạng thái quyết định và quy tắc hiệu lực được định nghĩa tại `decision-process.md`.

## 8. Điều kiện vận hành

Bộ Governance được xem là đủ để vận hành khi:

- Người đóng góp biết phải ghi nhận thông tin ở đâu.
- Có thể phân biệt thông tin, đề xuất, câu hỏi và quyết định.
- Mỗi quyết định quan trọng có trạng thái và người chịu trách nhiệm.
- Có quy trình thay đổi quyết định đã được chấp thuận.
- Có thể truy vết tác động giữa các lớp kiến trúc.
- Có thể review một thay đổi mà không phải tự phát minh quy tắc quản trị mới.

Quy trình review chi tiết và thẩm quyền review/approval được quy định tại `08-review-process`.
