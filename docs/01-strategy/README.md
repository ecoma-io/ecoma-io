# Strategy

## 1. Purpose

Nhóm tài liệu này ghi nhận định hướng chiến lược của Ecoma ở cấp Ecoma: chiến lược tổng thể, định nghĩa sản phẩm AI Factory Marketplace, mục tiêu chiến lược và các ràng buộc chiến lược cần được tôn trọng khi ra quyết định.

Đây là tầng định hướng cao nhất trong Architecture Knowledge Base. Nó trả lời câu hỏi Ecoma tồn tại vì sao và phát triển theo hướng nào — không phải nơi mô tả chi tiết nghiệp vụ, thiết kế Bounded Context hay kế hoạch triển khai kỹ thuật. Các nội dung đó thuộc về các nhóm tài liệu chuyên trách phía dưới.

## 2. Scope

**Thuộc nhóm này:**

- Ecoma strategy — định hướng và chiến lược tổng thể.
- AI Factory Marketplace — định nghĩa và cấu trúc sản phẩm duy nhất.
- Strategic objectives — các mục tiêu chiến lược cần đạt được.
- Strategic constraints — các ràng buộc chiến lược giới hạn không gian quyết định.

**Không thuộc nhóm này:**

- Roadmap triển khai, thời điểm ra mắt hoặc kế hoạch delivery của từng domain — chưa có quyết định tương ứng và không được ghi nhận tại đây; theo dõi tại [Discovery Backlog](../02-domain-discovery/discovery-backlog.md).
- Chi tiết nghiệp vụ, mô hình domain và kiến trúc kỹ thuật — thuộc các nhóm tài liệu chuyên trách.

## 3. Document Structure

| Tài liệu                    | Trách nhiệm                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `ecoma-strategy.md`         | Ghi nhận định hướng và chiến lược tổng thể của Ecoma.                                     |
| `ai-factory-marketplace.md` | Ghi nhận định nghĩa và cấu trúc sản phẩm AI Factory Marketplace.                          |
| `strategic-objectives.md`   | Ghi nhận các mục tiêu chiến lược cần đạt được.                                            |
| `constraints.md`            | Ghi nhận các ràng buộc chiến lược và những giới hạn cần được tôn trọng khi ra quyết định. |

Ghi chú lịch sử: hai tài liệu này kế thừa từ `ecosystem-strategy.md` và `product-portfolio.md` theo thay đổi chiến lược tại [SD-058](../02-domain-discovery/decisions/strategic-decisions.md); mô hình Product Portfolio nhiều sản phẩm không còn hiệu lực.

## 4. Relationship with Other Documents

- `00-governance/` — quy định cách quản trị và ra quyết định kiến trúc, bao gồm cả cách thay đổi nội dung nhóm này.
- `02-domain-discovery/` — sử dụng định hướng chiến lược làm đầu vào cho quá trình khám phá domain.
- `03-domain-design/` — sử dụng kết quả discovery làm cơ sở thiết kế domain.
- `05-system-architecture/` — chuyển hóa các yêu cầu kiến trúc đã được xác định thành định hướng kiến trúc hệ thống.

Quan hệ trên thể hiện hướng truyền thông tin giữa các lớp kiến trúc, không phải quy trình waterfall bắt buộc. Thông tin mới từ các lớp dưới có thể khiến định hướng chiến lược cần được xem xét lại; thay đổi phải được truy vết và đánh giá tác động theo quy trình trong `00-governance/`.

## 5. Usage Guidelines

- Thay đổi định hướng Ecoma phải được phản ánh tại `ecoma-strategy.md`.
- Thay đổi định nghĩa hoặc cấu trúc sản phẩm phải được phản ánh tại `ai-factory-marketplace.md`.
- Thay đổi mục tiêu chiến lược phải được phản ánh tại `strategic-objectives.md`.
- Ràng buộc chiến lược mới hoặc thay đổi ràng buộc phải được ghi nhận tại `constraints.md`.
- Không sử dụng nhóm tài liệu này để ghi nhận tiến độ triển khai hoặc trạng thái delivery; các chủ đề chưa có quyết định được theo dõi tại [Discovery Backlog](../02-domain-discovery/discovery-backlog.md).

Trạng thái của từng quyết định bên trong các tài liệu tuân theo [Decision Process](../00-governance/decision-process.md); chỉ nội dung có trạng thái Accepted mới có hiệu lực.
