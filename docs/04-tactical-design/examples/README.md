# Các ví dụ Tactical Design

- **Trạng thái:** Khung sườn (scaffold) — chỉ có định hướng cấu trúc; chưa chứa quyết định hay quy ước ràng buộc nào đã được review hoặc phê duyệt.
- **Phạm vi:** Cấu trúc kỳ vọng, tiêu chuẩn chất lượng và quy tắc bảo trì cho các ví dụ minh họa (worked examples) về các quy ước tactical design. Chưa có ví dụ nào tồn tại.

## 1. Mục đích

Thư mục này sẽ chứa các ví dụ minh họa giúp các tài liệu pattern trở nên cụ thể: một model nhỏ, tự trọn vẹn, cho thấy cách các quy ước trong [Modeling Conventions](../modeling-conventions.md) cùng với định hướng trong [Domain Patterns](../domain-patterns.md), [Application Patterns](../application-patterns.md), [Persistence Patterns](../persistence-patterns.md) và [Transaction Patterns](../transaction-patterns.md) kết hợp với nhau trong thực tế.

Ví dụ dạy bằng minh họa. Chúng thể hiện cách một context design sẽ áp dụng các mặc định (defaults), nêu rõ các trade-off đã chấp nhận, và ghi lại những phần lệch chuẩn (deviations) — để một team khi viết context design đầu tiên có một hình mẫu để so sánh, chứ không phải một template để sao chép. Ví dụ không tạo ra điều gì mới: một ví dụ không được đưa vào các quy tắc, quy ước hay quyết định mà các tài liệu pattern chưa có sẵn.

Đối tượng độc giả là contributor chuẩn bị viết hoặc review một per-context design trong khuôn khổ Domain Design, và reviewer kiểm tra design đó against kỳ vọng của nhóm này. Ví dụ phục vụ cả hai: designer thấy một cách áp dụng defaults đã được triển khai cụ thể; reviewer thấy hình dạng của một design tuân thủ, điều này giúp nhận diện và thảo luận các phần lệch chuẩn dễ hơn.

## 2. Phạm vi của Ví dụ

- Trong phạm vi: minh họa các building block và pattern — một aggregate với invariants của nó, một tập value object, một command/query flow, một ánh xạ domain/persistence model, một bản nháp concurrency hoặc locking, một bản nháp outbox hoặc saga — mỗi cái gắn với quy ước hoặc pattern mà nó minh họa.
- Ngoài phạm vi: nội dung domain thực của Ecoma. Các ví dụ dùng chủ đề trung tính, rõ ràng là hư cấu để không ai nhầm chúng với model đã được quyết định; việc gọi tên một aggregate hay event của Ecoma trong ví dụ trước khi context design của nó tồn tại sẽ tạo ra một quyết định không có thẩm quyền ([Decision Process](../../00-governance/decision-process.md): chỉ trạng thái Accepted mới có hiệu lực).
- Cũng ngoài phạm vi: lựa chọn công nghệ. Một ví dụ có thể dùng một storage shape hoặc framework chỉ như một minh họa được gán nhãn rõ ràng; nó không bao giờ hàm ý Ecoma đã chọn công nghệ đó — những lựa chọn đó thuộc về System Architecture.
- Ví dụ không phải là template: chúng cho thấy một cách áp dụng pattern, chứ không phải hình dạng duy nhất mà một context design hợp lệ có thể có.
- Những ví dụ đầu tiên đáng được đóng góp khi các quy ước đã ổn định, theo thứ tự ưu tiên gần đúng: một aggregate với consistency boundary có thể biện luận được cùng các invariant tests của nó; một cặp command/query thể hiện logical CQS mà không cần CQRS đầy đủ; một bản nháp outbox-with-inbox cho thấy duplicate delivery được chấp nhận chịu đựng. Các ví dụ này nhắm vào những quy ước mà team thường làm sai nhất trong context design đầu tiên của họ.

## 3. Yêu cầu Chất lượng của Ví dụ

- Một ví dụ hoặc là compilable/runnable với một minimal setup được nêu rõ, hoặc được đánh dấu rõ ràng là pseudo-code; nhãn này hiển thị tường minh ở phần header của ví dụ để người đọc không bao giờ phải đoán mình đang đọc loại nào.
- Một pattern cho mỗi ví dụ: mỗi ví dụ minh họa một quy ước hoặc pattern duy nhất và nêu rõ đó là pattern nào. Các mega-example ghép nhiều thứ lại che khuất phần nào minh họa điều gì; khi hai pattern buộc phải xuất hiện cùng nhau mới có ý nghĩa, mỗi layer được gán nhãn với tài liệu pattern tương ứng.
- Mỗi ví dụ nêu rõ nó minh họa những quy ước nào và định hướng gốc nằm ở đâu, để người đọc có thể đi từ phần minh họa ngược lại về quy tắc.
- Ví dụ thể hiện sự lệch chuẩn (deviation) khỏi một mặc định phải nêu rõ sự lệch chuẩn đó và lý do, phản chiếu những gì một context design sẽ ghi lại — một ví dụ lặng lẽ phá vỡ một mặc định là đang dạy rằng phá vỡ mặc định một cách lặng lẽ là chấp nhận được.
- Hành vi khi lỗi và ở các trường hợp biên được đưa vào khi pattern nói về failure (retry, compensation, conflict rejection): một ví dụ outbox không có duplicate delivery thì không phải là một ví dụ outbox.
- Một ví dụ nêu rõ các giả định của nó — kịch bản hư cấu, quy mô ngầm định, nhu cầu consistency ngầm định — để người đọc có thể đánh giá phần minh họa tổng quát được đến đâu; một ví dụ ngầm giả định, chẳng hạn, low contention là dạy pattern mà thiếu ngữ cảnh quyết định của nó.

## 4. Quan hệ với Modeling Conventions

- [Modeling Conventions](../modeling-conventions.md) sở hữu vốn từ vựng và các khu vực quy ước; ví dụ dùng đúng vocabulary đó — không ví dụ nào được chế ra một khái niệm building block thay thế hay đổi tên một khái niệm đã có.
- Ở những nơi một khu vực quy ước được mở rõ ràng (identity representation, event envelope, naming suffixes, repository read-side scope), ví dụ hoặc né câu hỏi đó, hoặc thể hiện một lựa chọn được gán nhãn là open choice — chúng không được trình bày một câu hỏi mở như thể đã có lời giải.
- Nếu một ví dụ có vẻ cần một quy tắc mà các quy ước chưa có, đó là tín hiệu để nêu câu hỏi trong phần Open Questions của tài liệu pattern, chứ không phải tự xử lý bên trong ví dụ. Khi đó ví dụ hoặc chờ, hoặc thể hiện lựa chọn mở như một lựa chọn mở.

## 5. Cấu trúc Ví dụ

- Cấu trúc kỳ vọng, khi các ví dụ tồn tại: một file (hoặc một thư mục nhỏ tự trọn vẹn) cho mỗi ví dụ, đặt tên theo pattern mà nó minh họa, chứa — phần header nêu tên (các) pattern được minh họa, mô tả ngắn về scenario, model hoặc flow minh họa, và các ghi chú về những quy ước và trade-off xuất hiện.
- Các ví dụ thể hiện tương tác xuyên các layer (ví dụ, một aggregate cùng repository của nó cùng một command handler) giữ cho mỗi layer dễ nhận diện và nêu tường minh các layer đó tương ứng với những tài liệu pattern nào.
- Thư mục sẽ có một danh mục (index) các ví dụ khi ví dụ đầu tiên được đóng góp; trước đó, README này là placeholder xác định những gì sẽ được chấp nhận.
- Một ví dụ nằm hoàn toàn trong thư mục này; nó không thêm source file ở bất kỳ đâu khác trong repository.
- Kỷ luật về kích thước: một ví dụ đủ nhỏ để đọc trong một lần ngồi — đủ model để làm pattern trở nên thực tế, không hơn; các chi tiết gây nhiễu không cần thiết (unused members, cấu hình ngẫu nhiên, scaffolding không liên quan đến pattern) bị lược bỏ ngay cả khi một ví dụ compilable về mặt kỹ thuật cần chúng, vì nhãn pseudo-code mua lại sự tự do đó.

## 6. Quy ước Đặt tên

- Tên file và thư mục: kebab-case, có tiền tố là khu vực pattern được minh họa — ví dụ `aggregate-invariants-*`, `command-query-*`, `outbox-*`, `optimistic-locking-*` — để thư mục đọc như một danh mục theo pattern.
- Các chủ đề hư cấu bên trong ví dụ dùng tên placeholder trung tính, không thể trùng với các khái niệm domain thực của Ecoma; nếu một placeholder giống một thuật ngữ trong [Domain Glossary](../../02-domain-discovery/domain-glossary.md), ví dụ phải nêu rõ sự trùng hợp đó là ngẫu nhiên.
- Tên đặt bằng tiếng Anh, nhất quán với chính sách của repository; identifiers và mọi chuỗi quan sát được lúc runtime bên trong ví dụ cũng là tiếng Anh.
- Phần header của ví dụ nêu tên pattern được minh họa theo đúng cách diễn đạt mà tài liệu pattern dùng, để việc tìm kiếm theo cả hai chiều — từ pattern đến ví dụ, từ ví dụ đến pattern — tìm thấy cặp này mà không cần bước tra glossary.

## 7. Validation và Bảo trì

- Ví dụ được review như bất kỳ đóng góp tài liệu nào: reviewer kiểm tra rằng ví dụ khớp với các tài liệu pattern hiện hành, minh họa đúng những gì header của nó tuyên bố, không đưa vào quy tắc mới, và gán nhãn cho các phần lệch chuẩn ([Tactical Design Review Checklist](../../08-review-process/review-checklists/tactical-design-review.md) là tài liệu tham chiếu cho phần nội dung tactical).
- Khi một tài liệu pattern thay đổi, các ví dụ bị ảnh hưởng được cập nhật hoặc được đánh dấu tường minh là minh họa một hình dạng đã bị thay thế — một ví dụ mâu thuẫn với định hướng hiện hành còn tệ hơn không có ví dụ, vì nó trông có vẻ có thẩm quyền.
- Những ví dụ bị đi copy lặp lại vào các context design thực tế là tín hiệu cho thấy các tài liệu pattern thiếu định hướng; cách khắc phục là cải thiện các tài liệu pattern, chứ không phải thăng hạng ví dụ thành chuẩn mực.
- Một ví dụ không còn phục vụ mục đích nào thì bị xóa đi thay vì để hư hỏng dần; index trong README này phản ánh những gì thực sự tồn tại.
- Tần suất: ví dụ được bảo trì theo kiểu lười nhưng có chủ đích — một ví dụ lỗi thời được sửa, được đánh dấu, hoặc bị xóa trong lần chạm tới tiếp theo; yếu tố kích hoạt bảo trì là sự thay đổi của tài liệu pattern khiến nó không còn đúng, chứ không phải lịch.

## 8. Tài liệu Liên quan

- [Tactical Design README](../README.md) — tổng quan và triết lý của nhóm tài liệu.
- [Modeling Conventions](../modeling-conventions.md), [Domain Patterns](../domain-patterns.md), [Application Patterns](../application-patterns.md), [Persistence Patterns](../persistence-patterns.md), [Transaction Patterns](../transaction-patterns.md) — các tài liệu mà ví dụ minh họa.
- [Architecture Principles](../../00-governance/architecture-principles.md) — AP-008 đến AP-011.
- [Domain Glossary](../../02-domain-discovery/domain-glossary.md) — các thuật ngữ mà ví dụ không được âm thầm định nghĩa lại.
- [Decision Process](../../00-governance/decision-process.md) — lý do ví dụ không thể tạo ra quyết định.
- [Tactical Design Review Checklist](../../08-review-process/review-checklists/tactical-design-review.md).
