# Constraints

## Mục đích và nguồn

Tài liệu này ghi nhận các ràng buộc thiết kế bắt nguồn từ các quyết định chiến lược của Ecoma. Mỗi ràng buộc gồm phát biểu ràng buộc và ý nghĩa đối với thiết kế.

## 1. Domain-owned Domain Model

**Ràng buộc:** mỗi domain có quyền sở hữu và phát triển Domain Model độc lập của mình; Ecoma Platform không hợp nhất Domain Model của các domain.

**Ý nghĩa:** không thể thiết kế một Domain Model chung duy nhất ép cả hai domain vào đó. Tích hợp giữa Domain LLM và Domain GPU phải đi qua hợp đồng tích hợp rõ ràng, không đi qua mô hình chia sẻ. Căn cứ: [SD-006](../02-domain-discovery/decisions/strategic-decisions.md), [SD-007](../02-domain-discovery/decisions/strategic-decisions.md), đọc theo [SD-059](../02-domain-discovery/decisions/strategic-decisions.md).

## 2. Cùng thuật ngữ, ý nghĩa nghiệp vụ khác nhau

**Ràng buộc:** các domain được phép dùng cùng một tên gọi khái niệm nghiệp vụ nhưng mang ý nghĩa nghiệp vụ khác nhau trong Domain Model của mình.

**Ý nghĩa:** tên gọi trùng nhau giữa hai domain (ví dụ "Offering" của Domain LLM theo LLM-004 và "Offering" của Domain GPU theo GPU-002) không chứng minh hai khái niệm là một, và không được dùng làm căn cứ để tạo shared model hay hợp nhất nghiệp vụ. Mọi suy diễn về sự tương đồng nghiệp vụ phải được kiểm chứng qua Discovery, không dựa vào tên gọi. Căn cứ: [SD-007](../02-domain-discovery/decisions/strategic-decisions.md).

## 3. Không áp đặt business model hoặc organization model duy nhất

**Ràng buộc:** Ecoma Platform không áp đặt một business model hoặc organization model chung cho mọi domain; domain tự quyết định trong phạm vi nguyên tắc chung của Ecoma Platform.

**Ý nghĩa:** các năng lực và quy ước ở cấp Ecoma Platform phải được thiết kế trung lập về business model và organization model — ví dụ không hard-code một mô hình Pricing, SLA hay cấu trúc tổ chức cụ thể vào năng lực nền tảng. Căn cứ: [SD-002](../02-domain-discovery/decisions/strategic-decisions.md), [SD-030](../02-domain-discovery/decisions/strategic-decisions.md).

## 4. Shared Platform Capability không mặc nhiên sở hữu business policy

**Ràng buộc:** một capability được chia sẻ ở cấp Ecoma Platform không vì thế mà sở hữu business policy của các domain sử dụng nó; Technical Sharing không đồng nghĩa với Shared Business Ownership.

**Ý nghĩa:** khi thiết kế một Shared Platform Capability, ownership của policy phải được giữ tại domain (hoặc tại Ecoma nếu policy thực sự thuộc cấp platform). Capability nền tảng không được ngầm định nghĩa, thay đổi hay khóa business policy của domain sử dụng nó. Căn cứ: [SD-004](../02-domain-discovery/decisions/strategic-decisions.md).

## 5. Chuẩn hóa chọn lọc ở cấp Ecoma Platform

**Ràng buộc:** chỉ những quy tắc và năng lực thực sự cần thiết trên toàn sản phẩm mới được thống nhất ở cấp Ecoma Platform; không áp đặt tính nhất quán cho mọi nghiệp vụ.

**Ý nghĩa:** mỗi đề xuất chuẩn hóa xuyên domain phải có căn cứ rằng quy tắc đó thực sự thuộc cấp platform. Mặc định là không chuẩn hóa; việc chuẩn hóa cần được biện luận, không phải sự tự nhiên của thiết kế. Căn cứ: [SD-005](../02-domain-discovery/decisions/strategic-decisions.md).

## 6. Không over-engineering

**Ràng buộc:** thiết kế hướng mở rộng nhưng chỉ triển khai khi có nhu cầu thực tế.

**Ý nghĩa:** không xây dựng trước năng lực, abstraction hay cấu trúc cho nhu cầu chưa phát sinh, kể cả nhu cầu được dự đoán từ khả năng liên kết giữa hai domain ([SD-060](../02-domain-discovery/decisions/strategic-decisions.md)). Các pattern cần lý do phù hợp mới được áp dụng — ví dụ CQRS chỉ được áp dụng khi có lý do nghiệp vụ và kỹ thuật phù hợp, không phải quy ước mặc định. Căn cứ: tinh thần [SD-005](../02-domain-discovery/decisions/strategic-decisions.md) và [SD-008](../02-domain-discovery/decisions/strategic-decisions.md).

## 7. Ranh giới nghiệp vụ không đồng nhất ranh giới triển khai kỹ thuật

**Ràng buộc:** ranh giới business ownership không được đồng nhất một-một với ranh giới triển khai kỹ thuật (Bounded Context, Microservice, Deployment Unit, module code) — và không được đồng nhất với ranh giới giao diện người dùng.

**Ý nghĩa:** Strategic Domain, Business Capability, Bounded Context, service và deployment unit là các khái niệm ở các lớp khác nhau. Việc chia sẻ công nghệ hoặc hạ tầng giữa hai domain không hợp nhất ownership nghiệp vụ của chúng; ngược lại, ownership nghiệp vụ riêng biệt không bắt buộc triển khai tách riêng. Provider cấu hình cung ứng cả hai domain qua một ứng dụng là sự thật về giao diện, không phải căn cứ hợp nhất nghiệp vụ. Việc phân lớp phân tích — từ Strategy đến Technical — phải theo nguyên tắc phân ranh giới trong [Discovery Charter](../00-governance/discovery-charter.md), không ánh xạ một-một. Căn cứ: [SD-003](../02-domain-discovery/decisions/strategic-decisions.md), [SD-004](../02-domain-discovery/decisions/strategic-decisions.md), [SD-059](../02-domain-discovery/decisions/strategic-decisions.md).

## 8. Đa ngôn ngữ English-first

**Ràng buộc:** mọi nội dung hiển thị cho end-user phải tồn tại bản English làm ngôn ngữ gốc; locale khác là tùy chọn, thiếu bản locale thì hiển thị English (fallback). Locale Preference thuộc Profile cốt lõi sở hữu Ecoma Platform; mã locale chuẩn hóa xuyên sản phẩm (BCP 47); danh sách ngôn ngữ hỗ trợ được quản lý tập trung, cập nhật động ở cấp platform; việc bổ sung ngôn ngữ mới không được đòi hỏi thay đổi cấu trúc dữ liệu hay contract của domain khác.

**Ý nghĩa:** thiết kế giao diện, thông điệp hệ thống và lưu trữ nội dung đa ngữ không được hard-code danh sách ngôn ngữ hay gắn nội dung hiển thị vào cấu trúc dữ liệu cố định theo từng ngôn ngữ. Năng lực nền tảng quản lý danh sách ngôn ngữ sở hữu danh sách, không sở hữu bản dịch của domain (theo ràng buộc số 4). Nội dung do Provider tạo không thuộc ràng buộc English bắt buộc — đa ngữ cho nội dung đó là tùy chọn theo chính sách từng domain. Căn cứ: [SD-055](../02-domain-discovery/decisions/strategic-decisions.md), [SD-013](../02-domain-discovery/decisions/strategic-decisions.md), [SD-046](../02-domain-discovery/decisions/strategic-decisions.md).

## Tài liệu liên quan

- [Ecoma Strategy](ecoma-strategy.md)
- [Strategic Objectives](strategic-objectives.md)
- [AI Factory Marketplace](ai-factory-marketplace.md)
