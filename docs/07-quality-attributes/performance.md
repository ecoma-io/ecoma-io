# Performance

## Mục đích

Tài liệu này ghi nhận thuộc tính chất lượng thuộc nhóm Performance của Ecoma ở mức định hướng discovery. Ở giai đoạn hiện tại, căn cứ đã xác lập tập trung vào Scalability — khả năng hỗ trợ tăng trưởng ở cấp Ecoma Platform và cấp domain. Tài liệu không thiết kế capacity planning hay sizing.

## Nguồn

- [Architecture Principles](../00-governance/architecture-principles.md) — đặc biệt AP-019 (Quality Attributes phải đo lường được), AP-006 (việc tách deployment cần xét scaling).

## Ghi chú về mục tiêu định lượng

Tài liệu này KHÔNG đặt throughput, latency, capacity targets hay bất kỳ con số nào — chưa được thống nhất. Các mục tiêu định lượng sẽ được xác lập qua quy trình quality requirements sau, không thuộc tài liệu này. AP-019 nhắc rõ không áp dụng cùng một mức mục tiêu cho mọi domain nếu nhu cầu khác nhau.

## Scalability

### Phân biệt hai cấp tăng trưởng

**Ecoma Platform-level — tăng trưởng nền tảng và provider:**

- SD-038 (Dual Product Portfolio Expansion, đọc lại theo [SD-058](../02-domain-discovery/decisions/strategic-decisions.md)): hướng mở rộng bằng cách thêm domain mới vẫn giữ nguyên giá trị — kiến trúc cần hỗ trợ thêm domain mới mà không yêu cầu tái cấu trúc các domain hiện hữu (phù hợp [SD-059](../02-domain-discovery/decisions/strategic-decisions.md) về tự chủ domain).
- SD-016 và SD-018: Provider đăng ký danh tính với Ecoma một lần và có thể tham gia cung ứng trên cả hai domain Marketplace mà không phải đăng ký lại danh tính; mức độ tham gia được mở rộng theo Progressive Provider Trust. Việc thêm Provider tham gia cả hai domain không được phụ thuộc vào quy trình đăng ký lại danh tính.

**Domain-level — tăng trưởng người dùng mỗi domain:**

- ORG-008 (No Ecosystem-wide Organization Limit, đọc theo SD-059): Ecoma không đặt giới hạn chung toàn Ecoma Platform về số lượng Consumer Organization mà một Account có thể sở hữu hoặc tham gia. Các giới hạn (nếu có) thuộc chính sách của từng domain (ORG-009, ORG-010).
- INV-008 (No Global Pending Invitation Quota): không áp đặt hạn mức nghiệp vụ toàn cục cho số lượng Pending Invitation; cơ chế rate limiting và chống lạm dụng vẫn được áp dụng theo chính sách từng nơi.

### Ý nghĩa

- Không được tồn tại giới hạn platform-wide không cần thiết chặn tăng trưởng của các domain: các ràng buộc số lượng là chính sách nghiệp vụ sở hữu tại đúng phạm vi (domain hoặc Ecoma Platform khi có căn cứ), không phải hệ quả ngầm của thiết kế kỹ thuật.
- AP-006 và AP-012 nhắc rõ scaling là một trong các tiêu chí xét quyết định deployment boundary — tức Scalability ảnh hưởng thiết kế ranh giới, nhưng không quyết định topology ở giai đoạn này.
- Hai cấp tăng trưởng có thể không đồng nhất: một domain tăng trưởng nhanh không nhất thiết kéo theo tăng trưởng ở domain khác; thêm domain mới không nhất thiết thay đổi mô hình tăng trưởng của domain hiện hữu.

### Hướng xác minh ở mức nguyên tắc

Theo AP-019, mọi tuyên bố Scalability cần được cụ thể hóa thành scenario có workload, điều kiện và phạm vi đo. Ở mức discovery, hướng xác minh là: các mô hình tăng trưởng đã quyết định (thêm domain theo SD-038, đọc theo SD-058; thêm Provider theo SD-016, SD-018; tăng Organization và Pending Invitation theo ORG-008, ORG-009, INV-008) không gặp ràng buộc kỹ thuật ngầm ngoài các chính sách nghiệp vụ đã xác lập. Tăng trưởng Offering (lifecycle đã chốt: Provider-owned theo [SD-044](../02-domain-discovery/decisions/provider-decisions.md), Product-owned chưa phát sinh theo [SD-058](../02-domain-discovery/decisions/strategic-decisions.md)) và Member chưa có mô hình tăng trưởng được xác lập, cần làm rõ trong discovery tiếp. Cụ thể hóa qua quy trình quality requirements sau.
