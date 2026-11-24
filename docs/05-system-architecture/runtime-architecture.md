# Kiến trúc Runtime

**Trạng thái:** Scaffold — chỉ cung cấp hướng dẫn cấu trúc; không chứa bất kỳ quyết định kiến trúc nào đã được xem xét hoặc phê duyệt.

**Phạm vi:** Cách hệ thống hành vi khi đang thực thi: xử lý yêu cầu, giao tiếp, công việc nền, tính đồng thời, xử lý lỗi và tắt hệ thống. Không cơ chế thực thi nào được chọn trong bản khung này.

## 1. Tổng quan Runtime

- Sẽ mô tả hành vi thời gian chạy của hệ thống khi có các quyết định runtime, bổ sung cho bản xem [container tĩnh](container-architecture.md) và bản xem [triển khai tập trung vào vị trí](deployment-architecture.md).
- Quan điểm này tồn tại vì cấu trúc tĩnh không xác định hành vi: hai bản phân hủy giống hệt nhau có thể thất bại rất khác nhau tại runtime.
- Không gì về thực thi được quyết định ở đây; mọi phần định nghĩa những gì sẽ được ghi nhận, chứ không phải cách hệ thống hoạt động.

## 2. Xử lý Yêu cầu

- Sẽ ghi nhận cách một yêu cầu di chuyển qua hệ thống: điểm vào, xác thực, điểm khi quyền được thi hành, sự chuyển giao giữa các đơn vị, và đường đi của phản hồi.
- Phải làm hiển thị nơi các invariant nghiệp vụ được thi hành — ở ranh giới chịu trách nhiệm cho chúng, không chỉ trong một đường đi gọi ([AP-008](../00-governance/architecture-principles.md)) — để việc thi hành vẫn [có tính xác định](../07-quality-attributes/security.md) bất kể điểm vào.
- Theo mỗi luồng, ghi nhận mong muốn tính nhất quán mà người gọi nhìn thấy; không luồng nào được thiết kế trong bản khung này.

## 3. Mô hình Thực thi Ứng dụng

- Sẽ ghi nhận, theo mỗi đơn vị, mô hình thực thi của nó: cách công việc đồng thời được cấu trúc bên trong (processes, threads, tasks hoặc các trừu tượng tương đương).
- Lựa chọn là theo mỗi đơn vị và đi từ trách nhiệm cũng như nhu cầu scaling của nó; không mô hình nào được chỉ định hoặc chọn ở đây.
- Các mục phải nêu các ảnh hưởng đối với [testability](../07-quality-attributes/testability.md): các kiểm tra có tính xác định đối với việc thi hành invariant đòi hỏi mô hình thực thi phải có thể tái lập trong điều kiện kiểm tra.

## 4. Giao tiếp Đồng bộ

- Sẽ ghi nhận nơi các đơn vị tương tác đồng bộ và ngữ nghĩa mà mỗi tương tác như vậy đòi hỏi: timeout, an toàn retry, và hành vi lỗi mà người gọi nhìn thấy ([AP-013](../00-governance/architecture-principles.md)).
- Hướng đánh giá: tương tác đồng bộ được biện minh khi người gọi thực sự không thể tiếp tục nếu không có câu trả lời; đánh giá theo từng trường hợp thuộc về [quan điểm tích hợp](integration-architecture.md).
- Hướng xác minh: các đường đi timeout và lỗi của các tương tác quan trọng đối với việc thi hành phải có thể kiểm tra được ([Reliability](../07-quality-attributes/reliability.md)).

## 5. Giao tiếp Bất đồng bộ

- Sẽ ghi nhận nơi các đơn vị tương tác bất đồng bộ và ngữ nghĩa mà mỗi tương tác đòi hỏi: bảo đảm gửi tin, idempotency, xử lý tin trùng lặp và sai thứ tự ([AP-007](../00-governance/architecture-principles.md)).
- Mọi eventual consistency do thiết kế bất đồng bộ đưa ra phải được nêu rõ ràng, kèm theo các hậu quả mà người dùng nhìn thấy ([AP-011](../00-governance/architecture-principles.md)).
- Hướng xác minh: các lần gửi trùng lặp, sai thứ tự và thất bại của các thông điệp quan trọng đối với việc thi hành — thu hồi, chấm dứt — không được làm suy yếu các bảo đảm trong các bản ghi [security](../07-quality-attributes/security.md) và [reliability](../07-quality-attributes/reliability.md).

## 6. Xử lý Nền

- Sẽ ghi nhận công việc được thực thi ngoài đường đi yêu cầu — retries, projections, cleanup, reconciliation — cùng với trigger, đơn vị sở hữu, xử lý lỗi, và cách tiến độ được [quan sát](../07-quality-attributes/observability.md).
- Mỗi mục phải trả lời: điều gì xảy ra khi công việc này thất bại hoặc bị chậm trễ, và kết quả nghiệp vụ nào phụ thuộc vào việc nó hoàn thành?
- Không khẳng định công việc nền nào tồn tại; các mục chỉ xuất hiện khi các quyết định tạo ra chúng.

## 7. Lên lịch và Thực thi Job

- Sẽ ghi nhận công việc dựa trên thời gian: các lịch trình, đơn vị sở hữu của chúng, hành vi khi bỏ lỡ lịch trình, và việc thực thi có buộc phải chạy một lần duy nhất trên các replica hay có thể chạy đồng thời.
- Mỗi mục phải trả lời: job này bảo vệ invariant nào, và hoạt động của nó có idempotent hay không — điều kiện cần trước khi bất kỳ retry nào là an toàn ([AP-013](../00-governance/architecture-principles.md)).
- Cơ chế lên lịch chưa được quyết định; tệp này chỉ ghi nhận yêu cầu và kết quả.

## 8. Mô hình Đồng thời

- Sẽ ghi nhận cách truy cập đồng thời vào trạng thái dùng chung được kiểm soát theo từng đơn vị, để việc thi hành vẫn có tính xác định khi có tranh chấp ([thi hành có tính xác định](../07-quality-attributes/security.md)).
- Phải trả lời theo từng đơn vị: trạng thái nào được dùng chung, những hoạt động nào có thể xung đột, và xung đột được giải quyết ra sao — ở mức thuộc tính; cơ chế cụ thể là một quyết định.
- Hướng xác minh: các kiểm tra tình huống đồng thời được mong đợi để bảo vệ invariant ([AP-008](../00-governance/architecture-principles.md), [Testability](../07-quality-attributes/testability.md)).

## 9. Vòng đời Tài nguyên

- Sẽ ghi nhận vòng đời của các tài nguyên runtime — connections, sessions, tokens, trạng thái tạm: cách mỗi loại được tạo ra, giới hạn, cạn kiệt và giải phóng.
- Mỗi mục phải trả lời: hành vi khi tài nguyên cạn kiệt là gì, và sự cạn kiệt có [quan sát được](../07-quality-attributes/observability.md) hay không?
- Giới hạn và giá trị của chúng là các quyết định; yêu cầu rằng giới hạn phải tồn tại và sự cạn kiệt phải diễn ra theo cách được xác định là mang tính định hướng.

## 10. Xử lý Lỗi Runtime

- Sẽ ghi nhận, theo mỗi quan hệ phụ thuộc, thiết kế lỗi: timeout, chính sách retry, circuit breaking, backpressure, fallback, và hành vi của đơn vị khi phụ thuộc vẫn không khả dụng ([AP-013](../00-governance/architecture-principles.md)).
- Hướng xác minh từ bản ghi reliability: các quy trình quan trọng đối với việc thi hành — thu hồi quyền truy cập, chấm dứt tổ chức — phải hoàn thành trọn vẹn ngay cả khi thất bại một phần ([Resilience](../07-quality-attributes/reliability.md)); các kiểm tra failure-mode là bằng chứng được mong đợi.
- Không giả định distributed transaction có sẵn; tính nhất quán giữa các đơn vị sau thất bại được nêu theo từng trường hợp, theo [quan điểm dữ liệu](data-architecture.md).

## 11. Graceful Shutdown

- Sẽ ghi nhận cách một đơn vị dừng: cách xử lý công việc đang dở dang, điểm mà nó ngừng nhận công việc mới, và những gì [bản xem triển khai](deployment-architecture.md) có thể giả định về hành vi dừng.
- Phải trả lời: một thao tác quan trọng đối với việc thi hành bị gián đoạn sẽ làm gì khi khởi động lại, và điều đó được chứng minh như thế nào ([Reliability](../07-quality-attributes/reliability.md))?
- Ngữ nghĩa tắt hệ thống theo từng đơn vị là các quyết định; mức sẵn sàng trong quá trình rollout phụ thuộc vào chúng.

## 12. Cô lập Runtime

- Sẽ ghi nhận sự cô lập giữa các khối công việc được thực thi đồng thời: những gì ngăn một yêu cầu, job hoặc khối công việc của một tenant làm các khối khác bị đói tài nguyên.
- Bảo vệ các mong đợi về phạm vi ảnh hưởng ([Smallest Blast Radius](../07-quality-attributes/reliability.md)) và hiệu suất công bằng ([Performance](../07-quality-attributes/performance.md)); các thuộc tính cô lập yêu cầu được ghi nhận ở đây, còn cơ chế là các quyết định.
- Sự cô lập giữa các đơn vị được [quan điểm triển khai](deployment-architecture.md) và [quan điểm security](security-architecture.md) bao quát; phần này bao quát sự cô lập bên trong runtime của một đơn vị.

## 13. Các câu hỏi mở

- Những quyết định runtime nào là điều kiện tiên quyết để xác minh các bảo đảm thi hành đã được chấp nhận ở giai đoạn khám phá — thu hồi ngay lập tức, tính đủ điều kiện nhận lời mời mang tính nguyên tử?
- Ngữ nghĩa thất bại nào mà các tương tác đồng bộ giữa các đơn vị phải bảo đảm trước khi các integration contract đầu tiên được định nghĩa?
- Công việc đang dở dang được xử lý thế nào trong suốt quá trình tắt hệ thống và khởi động lại mà không vi phạm các nghĩa vụ tương thích ngược?
- Những nhu cầu xử lý nền nào đã được các vòng đời đã thiết lập ngụ ý — hết hạn lời mời, lưu giữ sau chấm dứt — và trong số đó, nhu cầu nào vẫn chưa được quyết định trong [Discovery Backlog](../02-domain-discovery/discovery-backlog.md)?

## 14. Các tài liệu liên quan

- [Kiến trúc Container](container-architecture.md) — các đơn vị mà hành vi runtime của chúng được tệp này ghi nhận.
- [Kiến trúc Triển khai](deployment-architecture.md) — việc đặt vị trí, rollout và phục hồi phụ thuộc vào ngữ nghĩa tắt hệ thống và mức sẵn sàng.
- [Kiến trúc Tích hợp](integration-architecture.md) — ngữ nghĩa giao tiếp giữa các đơn vị và với các hệ thống bên ngoài.
- [Reliability](../07-quality-attributes/reliability.md), [Observability](../07-quality-attributes/observability.md), [Performance](../07-quality-attributes/performance.md), [Testability](../07-quality-attributes/testability.md), [Security](../07-quality-attributes/security.md) — các kỳ vọng chất lượng mà các quyết định runtime phải tôn trọng.
- [Nguyên lý Kiến trúc](../00-governance/architecture-principles.md) (đặc biệt là AP-007, AP-008, AP-011, AP-013), [Quy trình quyết định](../00-governance/decision-process.md).
- [Danh sách kiểm tra xem xét Kiến trúc Hệ thống](../08-review-process/review-checklists/system-architecture-review.md).
