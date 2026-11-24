# Kiến trúc deployment

**Trạng thái:** Scaffold — chỉ hướng dẫn cấu trúc; chưa chứa quyết định kiến trúc nào được review hoặc phê duyệt.

**Phạm vi:** Cách các đơn vị kỹ thuật của hệ thống được đặt chỗ, cấu hình, thay đổi và khôi phục trên các môi trường. Không môi trường, nền tảng hay topology nào được chọn trong scaffold này.

## 1. Mục tiêu deployment

- Sẽ nêu kiến trúc deployment phải đạt được điều gì, được suy ra từ các nguyên lý đã thiết lập: domain autonomy ([AP-001](../00-governance/architecture-principles.md)), failure isolation ([AP-013](../00-governance/architecture-principles.md)), và quy tắc không tạo deployment unit nào mà chi phí vận hành vượt quá lợi ích mang lại (review checklist).
- Phải trả lời: "deployable" ở đây nghĩa là gì, thay đổi và rollback phải nhanh đến mức nào, và mức độ autonomy giữa các domain và shared capability mà mô hình deployment phải giữ lại là gì.
- Các mục tiêu trở nên cụ thể và đo lường được theo từng quyết định ([AP-019](../00-governance/architecture-principles.md)); không mục tiêu nào được khẳng định trong scaffold này.

## 2. Môi trường deployment

- Sẽ ghi lại các môi trường nào tồn tại, mục đích của từng môi trường, và mức parity dự kiến giữa chúng.
- Phải trả lời theo từng môi trường: cái gì chạy ở đó, nó chứa những data class nào, ai được phép deploy vào đó, và chi phí duy trì là bao nhiêu.
- Các môi trường được dùng chung cho toàn sản phẩm hay tổ chức theo từng domain vẫn chưa quyết định; không có danh sách môi trường nào được khẳng định ở đây.

## 3. Danh mục deployment unit

- Sẽ liệt kê các deployment unit khi đã suy ra từ các quyết định container được chấp nhận; một deployment unit có thể đóng gói một container, một phần của một container, hoặc nhiều container — việc ánh xạ được quyết định, không bao giờ được giả định ([AP-006](../00-governance/architecture-principles.md)).
- Danh mục hiện **trống**; các ứng viên không được liệt kê sẵn.
- Mỗi mục trong tương lai sẽ liên kết đến quyết định đã định nghĩa nó và đến các mục container mà nó hiện thực hóa.

## 4. Topology triển khai

- Sẽ ghi lại cách các deployment unit được sắp xếp — placement, phân bố trên các failure domain, và các quan hệ proximity — khi có một quyết định topology.
- Mỗi mục phải biện minh cho cách sắp xếp đó dựa trên các kỳ vọng về [độ tin cậy](../07-quality-attributes/reliability.md) và [hiệu năng](../07-quality-attributes/performance.md), chứ không dựa theo thói quen hay mặc định.
- Không topology, nền tảng hay provider nào được chọn trong scaffold này; cách sắp xếp vẫn hoàn toàn chưa quyết định.

## 5. Kiến trúc mạng

- Sẽ ghi lại segmentation, exposure — cái gì truy cập được từ đâu — và các đường traffic giữa các deployment unit và qua ranh giới hệ thống, ở mức độ chi tiết cần thiết để đánh giá [trust boundary](security-architecture.md).
- Phân định trách nhiệm: viewpoint này ghi lại các sự kiện về placement và connectivity; viewpoint bảo mật ghi lại những gì được enforce tại các điểm vượt qua ranh giới; hai viewpoint không thay thế cho nhau.
- Không có gì về cấu trúc mạng được quyết định ở đây.

## 6. Phụ thuộc infrastructure

- Sẽ ghi lại mọi capability của infrastructure mà hệ thống phụ thuộc để chạy — compute, storage, networking, managed services — với mức độ criticality và kỳ vọng failure cho từng mục.
- Từng mục phải trả lời: cái gì ngừng hoạt động nếu dependency này không khả dụng, và điều đó có thỏa mãn các kỳ vọng failure trong [bản ghi độ tin cậy](../07-quality-attributes/reliability.md) hay không?
- Danh mục hiện trống; các dependency như vậy được dùng chung giữa các domain hay cô lập theo từng domain là một quyết định chưa xác định, có tác động ngược lại Mục 4.

## 7. Configuration và secrets

- Sẽ định nghĩa cách configuration được truyền đến các deployment unit và cách secret được inject — dưới dạng các quyết định đã ghi lại, chứ không phải quy ước.
- Định hướng đã được cố định bởi thực hành review: configuration và việc inject secret phải tường minh cho từng unit, và giá trị secret không bao giờ nằm trong các tệp repository ([system architecture checklist](../08-review-process/review-checklists/system-architecture-review.md)); cơ chế thỏa mãn điều này vẫn chưa quyết định.
- Theo từng unit, các mục sẽ phân biệt configuration thay đổi theo môi trường với configuration không được phép thay đổi.

## 8. Chiến lược deployment

- Sẽ ghi lại, theo từng deployment unit, cách các thay đổi được roll out: approach, ràng buộc thứ tự tương đối với data migration, và compatibility window khi hai phía deploy độc lập gặp nhau ([AP-020](../00-governance/architecture-principles.md)).
- Deployment independence được áp dụng theo từng unit khi lợi ích bù đắp được chi phí vận hành của nó ([AP-012](../00-governance/architecture-principles.md)); không giả định một chiến lược thống nhất duy nhất cho tất cả các unit.
- Việc xác minh sau deploy — cách xác nhận thành công — là một phần của mọi mục chiến lược (yêu cầu của checklist).

## 9. Rollback và khôi phục

- Sẽ ghi lại, theo từng unit, đường rollback và hành vi khôi phục sau failure, bao gồm thứ tự với migration và với phía còn lại của bất kỳ integration nào.
- Các kỳ vọng khôi phục sẽ được cụ thể hóa khi có reliability targets — [bản ghi độ tin cậy](../07-quality-attributes/reliability.md) cố ý chưa đặt mục tiêu số nào.
- Định hướng: rollback không được vi phạm các nghĩa vụ backward-compatibility đã được chấp nhận ở cấp discovery ([AP-020](../00-governance/architecture-principles.md)).

## 10. Khác biệt giữa các môi trường

- Sẽ ghi lại mọi khác biệt có chủ đích giữa các môi trường — data class, scale, credential, capability được bật — kèm lý do được nêu cho từng khác biệt.
- Bảo vệ: các khác biệt không được che giấu những lỗ hổng hành vi chỉ xuất hiện ở production; các kỳ vọng parity từ Mục 2 chi phối mức khác biệt chấp nhận được.
- Chưa quyết định cho đến khi chính các môi trường được quyết định.

## 11. Cô lập tài nguyên

- Sẽ ghi lại các ranh giới isolation giữa các deployment unit và giữa các domain: resource nào không được dùng chung, và tại sao — thường là vì failure isolation và kiểm soát blast radius ([Smallest Blast Radius](../07-quality-attributes/reliability.md)).
- Từng mục phải trả lời: một workload có thể làm gì với workload khác nếu isolation thất bại, và điều đó có chấp nhận được không?
- Isolation được ghi lại dưới dạng các thuộc tính bắt buộc; các cơ chế cung cấp chúng là những quyết định cần đưa ra.

## 12. Ràng buộc vận hành

- Các ràng buộc mà mọi quyết định deployment phải tôn trọng, gắn với nguồn gốc của chúng: domain autonomy và federated operations ([Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md)), không over-engineering ([Constraints](../01-strategy/constraints.md)), và build/deploy semantics tường minh cho từng runnable unit ([AP-017](../00-governance/architecture-principles.md)).
- Cũng ghi lại ý thức về chi phí như một tiêu chí đánh giá: placement phân tán phải tự bù đắp bằng một lợi ích được nêu rõ.

## 13. Câu hỏi mở

- Các môi trường được tổ chức theo từng domain, dùng chung cho toàn sản phẩm, hay cả hai — và quyết định nào sở hữu lựa chọn đó?
- Tập hợp môi trường tối thiểu cần có trước khi các quyết định kiến trúc hệ thống đầu tiên có thể được xác minh là gì?
- Deployment independence được phân chia như thế nào trên toàn sản phẩm: theo domain, theo unit, hay theo loại thay đổi?
- Những recovery objective nào sẽ được đặt khi quy trình quality attributes định nghĩa các mục tiêu số?

## 14. Tài liệu liên quan

- [Container Architecture](container-architecture.md) — các deployment unit và group được suy ra từ các quyết định container ở đây.
- [Runtime Architecture](runtime-architecture.md) — hành vi startup, shutdown và failure mà deployment phải hỗ trợ.
- [Security Architecture](security-architecture.md) — enforcement tại ranh giới mạng và trust boundary.
- [Độ tin cậy](../07-quality-attributes/reliability.md) và [Hiệu năng](../07-quality-attributes/performance.md) — các kỳ vọng mà placement và khôi phục phải thỏa mãn.
- [Strategic Domain Model](../02-domain-discovery/strategic-domain-model.md) và [Constraints](../01-strategy/constraints.md) — các ràng buộc vận hành.
- [Architecture Principles](../00-governance/architecture-principles.md) và [Decision Process](../00-governance/decision-process.md).
- [System Architecture Review Checklist](../08-review-process/review-checklists/system-architecture-review.md).
