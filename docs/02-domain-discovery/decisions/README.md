# Decision Records — Domain Discovery

## Mục đích

Thư mục này lưu các Decision Record cấp discovery của Ecoma, gồm Strategic Decision và Domain Decision theo nghĩa được định nghĩa trong [decision-process](../../00-governance/decision-process.md). Các quyết định SD-001–SD-040 thuộc giai đoạn đầu của discovery; SD-058–SD-064 ghi nhận thay đổi chiến lược sang sản phẩm duy nhất và mô hình tiêu dùng theo domain.

Đây không phải là bộ Architecture Decision Record (ADR). ADR kiến trúc vẫn thuộc [architecture-decision-records](../../00-governance/architecture-decision-records/) theo quy trình decision governance chung. Hai hệ thống record không ghi trùng một quyết định: mỗi quyết định có đúng một nguồn sở hữu chính. Nếu một Domain Decision đồng thời tạo ra ràng buộc kiến trúc có ảnh hưởng đáng kể, record tại đây liên kết đến ADR tương ứng thay vì sao chép nội dung.

## Phân nhóm quyết định

| File                                                                     | Mã quyết định                                                                                               | Phạm vi                                                                                  |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [strategic-decisions.md](strategic-decisions.md)                         | SD-001–SD-013, SD-029, SD-030, SD-033–SD-041, SD-046–SD-049, SD-051, SD-052, SD-054–SD-060, SD-061, SD-062, SD-063, SD-064 | Chiến lược Ecoma Platform, cấu trúc hai domain, Marketplace governance, Đa ngôn ngữ cấp platform |
| [provider-decisions.md](provider-decisions.md)                           | SD-014–SD-028, SD-042–SD-045, SD-050, SD-053                                                                | Provider và chuyển đổi Provider                                                          |
| [account-identity-decisions.md](account-identity-decisions.md)           | ID-001–ID-014                                                                                               | Ecoma Account và Identity                                                                |
| [consumer-organization-decisions.md](consumer-organization-decisions.md) | ORG-001–ORG-014                                                                                             | Consumer Organization                                                                    |
| [membership-decisions.md](membership-decisions.md)                       | MEM-001–MEM-018                                                                                             | Membership của Consumer Organization                                                     |
| [invitation-decisions.md](invitation-decisions.md)                       | INV-001–INV-015                                                                                             | Invitation vào Consumer Organization                                                     |
| [financial-decisions.md](financial-decisions.md)                         | FIN-001–FIN-009                                                                                             | Balance, settlement và dòng tiền Ecoma–Consumer–Provider                                 |
| [llm-marketplace-decisions.md](llm-marketplace-decisions.md)             | LLM-001–LLM-033                                                                                             | Domain LLM — quyết định cấp domain (domain discovery đầu tiên theo SD-059)                |
| [gpu-cloud-marketplace-decisions.md](gpu-cloud-marketplace-decisions.md) | GPU-001–GPU-012                                                                                             | Domain GPU — quyết định cấp domain (domain discovery thứ hai theo SD-059)                 |

Mô hình chiến lược hiện hành được mô tả tại [strategic-domain-model](../strategic-domain-model.md); các câu hỏi discovery đang chờ xử lý được theo dõi tại [Discovery Backlog](../discovery-backlog.md).

## Quy ước mã

- Tiền tố mã theo nhóm chủ đề: `SD` (Strategic Decision), `ID` (Account & Identity), `ORG` (Consumer Organization), `MEM` (Membership), `INV` (Invitation), `FIN` (Financial), `LLM` (Domain LLM — quyết định cấp domain), `GPU` (Domain GPU — quyết định cấp domain).
- Số tăng dần theo thứ tự ghi nhận.
- Mã không đổi khi tiêu đề hoặc trạng thái thay đổi.
- Không tái sử dụng mã của một quyết định đã bị loại.
- Khoảng số bị thiếu là một phần của lịch sử: khoảng SD-031–SD-032 đã được xác minh là sai sót đánh số, không tương ứng quyết định nào; không được lấp khoảng trống này bằng cách đánh lại số cho quyết định mới.

## Quy ước trạng thái và ngày

- Trạng thái sử dụng các giá trị được định nghĩa trong [decision-process](../../00-governance/decision-process.md): `Proposed`, `Accepted`, `Rejected`, `Superseded`, `Withdrawn`.
- Các quyết định SD-001–SD-040 đã được thống nhất trong giai đoạn đầu của discovery và có trạng thái `Accepted`.
- Ngày quyết định không được ghi nhận ở các record.

## Quy ước quan hệ

Mục "Liên quan" của một quyết định chỉ ghi những quan hệ xác định trực tiếp từ nội dung quyết định. Không suy diễn quan hệ từ tên gọi hoặc chủ đề tương tự.

## Bảo toàn lịch sử

Theo nguyên tắc governance trong [decision-process](../../00-governance/decision-process.md):

- Không xóa một quyết định đã `Accepted` chỉ vì nó không còn hiệu lực.
- Thay đổi quyết định bằng cách tạo quyết định mới, sau đó đánh dấu quyết định cũ là `Superseded` hoặc `Withdrawn`.
- Không sửa nội dung lịch sử của một quyết định đã ghi nhận để thay đổi ý nghĩa của nó.

## Nội dung chưa kết luận

Câu hỏi chưa có kết luận không được ghi thành quyết định trong thư mục này. Các điểm cần làm rõ được đưa vào [Discovery Backlog](../discovery-backlog.md) để theo dõi và xử lý theo quy trình discovery. Ví dụ: giá trị thời hạn cụ thể của Invitation (INV-005) chưa được quyết định.
