# Kiến trúc tích hợp

**Trạng thái:** Scaffold — chỉ hướng dẫn cấu trúc; chưa có quyết định kiến trúc nào được xem xét hoặc phê duyệt.

**Phạm vi:** Cách các đơn vị, domain và hệ thống bên ngoài trao đổi thông tin theo các hợp đồng rõ ràng, và cách các hợp đồng đó được quản trị cấp hệ thống. Không có protocol, format hay broker nào được chọn trong scaffold này.

## 1. Mục tiêu tích hợp

- Mọi tương tác xuyên ranh giới — giữa các container, giữa các domain, với các hệ thống bên ngoài — đều có một hợp đồng rõ ràng với quyền sở hữu được định nghĩa ([AP-007](../00-governance/architecture-principles.md)).
- Các tương tác giữ nguyên sự độc lập của domain: tích hợp không bao giờ gộp quyền sở hữu nghiệp vụ, và cả hai bên đều không thay đổi mô hình nội bộ của bên kia (SD-004, [Constraints](../01-strategy/constraints.md)).
- Sự cố trong một tích hợp không lan truyền vượt quá mức ảnh hưởng mà thiết kế quy định ([Failure Isolation](../07-quality-attributes/reliability.md), [AP-013](../00-governance/architecture-principles.md)).

## 2. Nguyên lý tích hợp

- Không có chia sẻ ngầm: truy cập trực tiếp vào dữ liệu nội bộ của ngữ cảnh hoặc domain khác không phải là một hợp đồng ([AP-007](../00-governance/architecture-principles.md)); mọi tương tác xuyên ranh giới đặt tên hợp đồng và chủ sở hữu của nó.
- Sự tương thích được thiết kế, không phải hy vọng: các thay đổi được đánh giá đối với các consumer hiện tại, breaking change kèm theo kế hoạch di chuyển và kế hoạch ngừng sử dụng ([AP-020](../00-governance/architecture-principles.md)).
- Các phong cách được chọn cho từng tương tác theo quyết định: không có phong cách mặc định, không khẳng định thống nhất — mỗi lựa chọn trade-off đều được ghi lại.
- Tích hợp vừa là quản trị vừa là cơ chế: ai sở hữu, ai được phép tiêu dùng, và cách thay đổi được xem xét quan trọng không kém định dạng truyền tải (wire format).

## 3. Ranh giới tích hợp

- Xác định các tương tác mà quan điểm này quản lý: bất cứ gì xuyên ranh giới hệ thống, giữa các domain, hoặc giữa các container nằm trong các phạm vi sở hữu khác nhau.
- Xác định phân chia công lao: các **hợp đồng bản thân** — nghĩa, quyền sở hữu, semantics — là các artifact miền được sở hữu bởi Domain Design (xem catalog hợp đồng tích hợp dưới docs/03-domain-design/integration-contracts/, dự kiến; [Domain Design](../03-domain-design/README.md)); quan điểm này quản lý **cơ chế cấp hệ thống** — cách các hợp đồng được thực hiện, đăng ký, phiên bản hóa có hiệu lực, và làm cho có thể quan sát.
- Bảo vệ: một tiện lợi kỹ thuật ở đây không thể định nghĩa lại một hợp đồng miền có ý nghĩa gì.

## 4. Danh mục phong cách tích hợp

- Sẽ liệt kê các phong cách tích hợp đang sử dụng sau khi các quyết định đã được đưa ra — mỗi mục nhập nêu nơi phong cách được áp dụng, các hợp đồng nào sử dụng nó, và quyết định đã chọn nó.
- Các phong cách ứng cử viên không được liệt kê hoặc so sánh ở đây; danh mục chỉ phát triển từ các lựa chọn đã được chấp nhận.
- Cho mỗi mục nhập, bản ghi phải nêu các ý nghĩa giao hàng mà phong cách cung cấp, để các consumer có thể được đánh giá theo các kỳ vọng về sự cố trong Phần 10.

## 5. Tích hợp đồng bộ

- Sẽ ghi lại, cho từng tương tác đồng bộ: timeout, an toàn thử lại, ý nghĩa lỗi, và hành vi của caller khi callee không sẵn sàng hoặc chậm.
- Phải thỏa mãn các kỳ vọng về cô lập sự cố: sự không sẵn sàng của một bên chỉ làm kém hiệu quả những gì thiết kế nói nó làm kém hiệu quả ([AP-013](../00-governance/architecture-principles.md)); các thao tác không idempotent không được thử lại không có bảo vệ.
- Hướng kiểm tra: timeout và các đường dẫn sự cố có thể kiểm tra ([Testability](../07-quality-attributes/testability.md)); không có protocol nào được chọn ở đây.

## 6. Tích hợp bất đồng bộ

- Sẽ ghi lại, cho từng tương tác bất đồng bộ: ý nghĩa giao hàng, yêu cầu idempotency, và xử lý các tin nhắn trùng lặp và ngoài thứ tự ([AP-007](../00-governance/architecture-principles.md)).
- Mọi sự nhất quán cuối cùng được đưa ra là rõ ràng, với các hậu quả hiển thị với người dùng được nêu rõ — phần [giao tiếp bất đồng bộ](runtime-architecture.md) trong thời gian chạy ghi lại bên thực thi.
- Hướng kiểm tra: các giao hàng trùng lặp, được sắp xếp lại và thất bại không được làm suy yếu các đảm bảo thi hành — huỷ và chấm dứt vẫn hiệu quả dưới giao hàng không đáng tin cậy ([kỳ vọng bảo mật](../07-quality-attributes/security.md)).

## 7. Quản trị API và hợp đồng

- Xác định cách các hợp đồng được quản trị cấp hệ thống: cách một hợp đồng được đăng ký, ai phê duyệt việc tạo và thay đổi, cách các phiên bản được xác định, và cách sự tương thích được kiểm tra trước khi thay đổi được áp dụng ([AP-020](../00-governance/architecture-principles.md)).
- Phải trả lời: đăng ký nằm ở đâu, một bản ghi hợp đồng chứa gì (producer, consumers, owner, semantics, version, error behavior), và xem xét nào được áp dụng — [danh sách kiểm tra xem xét kiến trúc hệ thống](../08-review-process/review-checklists/system-architecture-review.md) bao quát quyền sở hữu producer/consumer và sự tương thích; [thẩm quyền xem xét](../08-review-process/review-authority.md) quyết định ai phê duyệt.
- Nội dung miền của các hợp đồng vẫn được sở hữu bởi Domain Design (Phần 3); quản trị ở đây không bao giờ chỉnh sửa ý nghĩa.
- Công cụ đăng ký và kiểm tra cụ thể chưa được quyết định; các yêu cầu có hướng ([AP-018](../00-governance/architecture-principles.md)): các quy tắc có thể được xác minh tự động nên được làm.

## 8. Tích hợp sự kiện

- Sẽ ghi lại tích hợp dựa trên sự kiện cấp hệ thống: một sự kiện có ý nghĩa gì xuyên ranh giới — một sự thật được xuất bản bởi chủ sở hữu, được tiêu dùng theo một hợp đồng — trái với các sự kiện nội bộ trong một đơn vị mà quan điểm này không quản lý.
- Cho mỗi tích hợp sự kiện, ghi lại ý nghĩa giao hàng, kỳ vọng thứ tự, và hành vi sự cố phía consumer; ý nghĩa miền của mỗi sự kiện sống với ngữ cảnh sở hữu nó trong Domain Design.
- Cơ chế xuất bản sự kiện chưa được quyết định; không có gì được chọn trong scaffold này.

## 9. Tích hợp cung cấp bên ngoài

- Sẽ ghi lại cách các tích hợp với các hệ thống bên ngoài — từ [danh mục ngữ cảnh hệ thống](system-context.md) — được cấu trúc: ranh giới adapter, xử lý thông tin xác thực, hành vi sự cố, và ai sở hữu tích hợp.
- Phải giữ chi tiết cung cấp bên ngoài ngoài logic nghiệp vụ: một cung cấp bên ngoài có thể được thay thế tại ranh giới adapter, và sự cố của nó được giữ trong giới hạn theo Phần 10.
- Các cung cấp bên ngoài nào tồn tại phụ thuộc vào các câu hỏi thương mại chưa được quyết định — thanh toán, quyết toán, Merchant of Record ([Hồ sơ khám phá](../02-domain-discovery/discovery-backlog.md)); không có cung cấp nào được đặt tên ở đây.

## 10. Độ tin cậy và xử lý sự cố

- Tổng hợp các kỳ vọng sự cố trên tất cả các bản ghi tích hợp: timeout, retry, circuit breaking, backpressure, fallback — áp dụng cho từng tương tác, chưa bao giờ được giả định toàn cầu ([AP-013](../00-governance/architecture-principles.md)).
- Phải trả lời cho mỗi tương tác: consumer trải nghiệm gì khi producer thất bại, điều đó có chấp nhận được so với [kỳ vọng độ tin cậy](../07-quality-attributes/reliability.md), và sự cố có thể quan sát được không [khả năng quan sát](../07-quality-attributes/observability.md)?

## 11. Phiên bản hóa và sự tương thích

- Sẽ ghi lại chiến lược phiên bản hóa theo từng loại hợp đồng và chính sách tương thích mà consumers có thể dựa vào: các thay đổi nào tương thích, breaking change nào, và trình tự triển khai khi các bên triển khai độc lập ([AP-020](../00-governance/architecture-principles.md)).
- Giới hạn bởi các nghĩa vụ kinh doanh đã thiết lập: sự tương thích ngược là một nghĩa vụ kinh doanh, không chỉ là một nghĩa vụ kỹ thuật — các nghĩa vụ lịch sử tồn tại sau khi thay đổi (SD-023, [Độ tin cậy](../07-quality-attributes/reliability.md)).
- Hướng kiểm tra: các kiểm tra hợp đồng và kiểm tra sự tương thích cản trở thay đổi ([AP-020](../00-governance/architecture-principles.md)); công cụ thi hành chưa được quyết định.

## 12. Bảo mật

- Sẽ ghi lại cách bảo mật tích hợp hoạt động cấp hệ thống: cách mỗi bên xác thực xuyên ranh giới, cách ngữ cảnh danh tính di chuyển, và thông tin xác thực nào tích hợp sử dụng ([bảo mật dịch vụ-dịch vụ](security-architecture.md)).
- Các vượt ranh giới niềm tin trong tích hợp tái sử dụng [danh mục quan điểm bảo mật](security-architecture.md); phần này chỉ ghi lại các thực hiện đặc thù cho tích hợp.
- Chu kỳ của thông tin xác thực tuân theo kỳ vọng huỷ toàn bộ: một thông tin xác thực tích hợp bị huỷ là không thể sử dụng ở mọi nơi, nhanh chóng ([huỷ quyền truy cập](../07-quality-attributes/security.md)).

## 13. Khả năng quan sát và khả năng truy vết

- Sẽ ghi lại cách các tương tác được làm cho có thể quan sát: lan truyền ngữ cảnh tương quan và truy vết xuyên ranh giới, và các kết quả tương tác nào có thể đo lường ([AP-019](../00-governance/architecture-principles.md)).
- Phải thỏa mãn [kỳ vọng truy vết](../07-quality-attributes/observability.md): các chuỗi kinh doanh trải dài các khái niệm — lời mời tham gia đến thành viên, người cung cấp đến dịch vụ đến quan hệ thương mại — có thể được theo dõi từ đầu đến cuối, độc lập với phương tiện kỹ thuật.
- Cơ chế lan truyền và định dạng tín hiệu chưa được quyết định; các yêu cầu chỉ có hướng.

## 14. Các câu hỏi mở

- Bản ghi và đăng ký hợp đồng tối thiểu nào hỗ trợ kiểm tra sự tương thích trước khi tích hợp xuyên ngữ cảnh đầu tiên tồn tại?
- Phong cách tích hợp nào áp dụng cho các tương tác đã được ngụ ý bởi khám phá — xác thực tài khoản xuyên các domain, dòng chảy lời mời, sự tham gia của người cung cấp trên cả hai domain — khi mà ánh xạ ngữ cảnh-đơn vị chưa được quyết định?
- Ngữ cảnh truy vết được lan truyền như thế nào xuyên các đơn vị có thể triển khai độc lập, và ai sở hữu chuẩn lan truyền?
- Các tích hợp sự kiện bảo toàn đảm bảo huỷ toàn bộ (MEM-013, ORG-013) như thế nào khi giao hàng bị trì hoãn hoặc trùng lặp?
- Khi các tích hợp cung cấp bên ngoài được danh mục (Phần 9), các hành vi fail-closed versus fail-open nào mà các dòng chảy thương mại sẽ yêu cầu?

## 15. Tài liệu liên quan

- [Thiết kế miền](../03-domain-design/README.md) — sở hữu các hợp đồng mà quan điểm này quản lý.
- [Kiến trúc container](container-architecture.md) — các đơn vị và cạnh phụ thuộc mà các tích hợp kết nối.
- [Kiến trúc thời gian chạy](runtime-architecture.md) — hành vi thời gian thực thi của các tương tác tích hợp.
- [Kiến trúc bảo mật](security-architecture.md) — vượt ranh giới và quản trị thông tin xác thực.
- [Mô hình miền chiến lược](../02-domain-discovery/strategic-domain-model.md) và [Ràng buộc](../01-strategy/constraints.md) — các ràng buộc về quyền sở hữu và chia sẻ đối với tích hợp.
- [Độ tin cậy](../07-quality-attributes/reliability.md), [Khả năng quan sát](../07-quality-attributes/observability.md) — kỳ vọng về sự cố và truy vết.
- [Nguyên lý kiến trúc](../00-governance/architecture-principles.md) (đặc biệt là AP-007, AP-013, AP-018, AP-020), [Quy trình quyết định](../00-governance/decision-process.md).
- [Danh sách kiểm tra xem xét kiến trúc hệ thống](../08-review-process/review-checklists/system-architecture-review.md).
