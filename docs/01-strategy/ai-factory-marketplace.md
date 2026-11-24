# AI Factory Marketplace

## Mục đích và nguồn

Tài liệu này ghi nhận định nghĩa và cấu trúc của AI Factory Marketplace — Product duy nhất của Ecoma. Nguồn: [SD-058](../02-domain-discovery/decisions/strategic-decisions.md), [SD-059](../02-domain-discovery/decisions/strategic-decisions.md) và các quyết định đã ở trạng thái Accepted được ghi nhận tại [decision register](../02-domain-discovery/decisions/README.md).

## Định nghĩa sản phẩm

AI Factory Marketplace là một marketplace trung gian: Ecoma ghép nối cung ứng của Provider với nhu cầu của Consumer cho hai loại năng lực AI — inference LLM và compute GPU. Ecoma không tự huấn luyện model nền tảng và không sở hữu hạ tầng GPU làm Offering chủ đạo; Offering thuộc sở hữu Provider ([SD-058](../02-domain-discovery/decisions/strategic-decisions.md), giữ phần vai trò trung gian Marketplace của [SD-054](../02-domain-discovery/decisions/strategic-decisions.md)).

Ecoma luôn là chủ thể có quan hệ thương mại trực tiếp với Consumer; Consumer thanh toán qua Ecoma, Ecoma quản lý dòng tiền và thanh toán cho Provider ([SD-035](../02-domain-discovery/decisions/strategic-decisions.md), [SD-015](../02-domain-discovery/decisions/provider-decisions.md)).

## Cấu trúc hai domain trên Ecoma Platform

Theo [SD-059](../02-domain-discovery/decisions/strategic-decisions.md), sản phẩm gồm hai domain cung ứng ngang hàng trên một lớp năng lực dùng chung do Ecoma sở hữu:

- **Domain LLM** — Offering inference (model, capability, giá, trạng thái), discovery, routing, serving, metering; tổng hợp tại [LLM Marketplace Decisions](../02-domain-discovery/decisions/llm-marketplace-decisions.md) và phần Domain Model tương ứng.
- **Domain GPU** — Offering compute GPU (phần cứng, giá compute/storage/bandwidth), discovery, vận hành instance, metering qua platform-side agent, bồi thường; tổng hợp tại [GPU Cloud Marketplace Decisions](../02-domain-discovery/decisions/gpu-cloud-marketplace-decisions.md).
- **Ecoma Platform** — Account & Identity, Profile, Provider Identity & Trust (đăng ký một lần, dùng chung cả hai domain), Financial Balance & Settlement, Workspace/API key.

Ranh giới giữa hai domain là rời hoàn toàn: không có model niêm yết dùng chung; hai domain gặp nhau ở Account, ví tài chính và danh tính Provider. Consumer duyệt Offering qua hai khu discovery riêng; Provider cấu hình cung ứng cả hai domain qua một ứng dụng — giao diện dùng chung, không hợp nhất ranh giới nghiệp vụ.

## Liên kết giữa hai domain

Tài nguyên GPU của một Provider có thể trở thành hạ tầng chạy Offering LLM của Provider khác qua Ecoma: không phải giá trị cốt lõi, được phép xảy ra và Ecoma mong muốn; ranh giới hai domain không được chặn liên kết này, nhưng không thiết kế tích hợp trước khi có nhu cầu thực ([SD-060](../02-domain-discovery/decisions/strategic-decisions.md)).

## Tự chủ của domain trong sản phẩm

Trong phạm vi nguyên tắc Ecoma Platform đã xác lập, từng domain vẫn tự chủ phát triển và vận hành nghiệp vụ của mình — bao gồm business model, quan hệ thương mại, Pricing, SLA và trách nhiệm dịch vụ ([SD-030](../02-domain-discovery/decisions/strategic-decisions.md), đọc theo [SD-059](../02-domain-discovery/decisions/strategic-decisions.md)). Settlement là hạ tầng dùng chung mặc định; domain chỉ thay thế kèm khai báo override theo [FIN-004](../02-domain-discovery/decisions/financial-decisions.md) — xem [Discovery Backlog](../02-domain-discovery/discovery-backlog.md).

## Chưa xác định

Các nội dung sau **chưa có quyết định** và chưa được ghi nhận ở đây:

- Thứ tự và thời điểm triển khai của từng domain trong sản phẩm (thay cho thứ tự ưu tiên Portfolio cũ đã bị thay thế bởi [SD-058](../02-domain-discovery/decisions/strategic-decisions.md)).
- Thời điểm ra mắt và trạng thái triển khai hiện tại.
- Mô hình thương mại chi tiết của từng domain: quyền sở hữu Offering, Pricing, cấu trúc Offering và trách nhiệm cung cấp dịch vụ cụ thể.
- Tiêu chuẩn đánh giá và chứng nhận Provider theo từng domain.

Các chủ đề này chưa được suy diễn thêm; theo dõi tại [Discovery Backlog](../02-domain-discovery/discovery-backlog.md).

## Tài liệu liên quan

- [Ecoma Strategy](ecoma-strategy.md)
- [Strategic Objectives](strategic-objectives.md)
- [Constraints](constraints.md)
