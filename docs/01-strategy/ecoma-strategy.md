# Ecoma Strategy

## Mục đích và nguồn

Tài liệu này ghi nhận định hướng chiến lược của Ecoma ở cấp Ecoma — chiến lược của sản phẩm AI Factory Marketplace và lớp năng lực dùng chung Ecoma Platform. Tài liệu chỉ ghi nhận những gì đã thống nhất; các chủ đề chưa quyết định được liên kết tới [Discovery Backlog](../02-domain-discovery/discovery-backlog.md).

## 1. Sản phẩm duy nhất AI Factory Marketplace

Ecoma là một Product duy nhất — AI Factory Marketplace — hợp nhất từ định hướng LLM Marketplace và GPU Cloud Marketplace. Không còn mô hình Product Portfolio gồm nhiều Product; Decentralized Cloud Object Storage bị loại khỏi định hướng chiến lược. Căn cứ: [SD-058](../02-domain-discovery/decisions/strategic-decisions.md).

## 2. Cấu trúc hai domain trên một lớp Ecoma Platform

AI Factory Marketplace gồm hai domain cung ứng ngang hàng — Domain LLM và Domain GPU — trên một lớp năng lực dùng chung do Ecoma sở hữu (Ecoma Platform): Account & Identity, Profile, Provider Identity & Trust, Financial Balance & Settlement, Workspace/API key. Mỗi domain tự nắm Offering, discovery, verify, vòng đời và vận hành cung ứng của mình; không có model niêm yết dùng chung. Các quyết định trước đây phát biểu theo cấp Product được đọc lại theo cấp domain. Căn cứ: [SD-059](../02-domain-discovery/decisions/strategic-decisions.md).

## 3. Balanced Strategic Design

Chiến lược thiết kế của Ecoma cân bằng ba yếu tố: tính độc lập của từng domain, năng lực dùng chung và tính nhất quán toàn sản phẩm. Không yếu tố nào được cực đại hóa mà làm suy yếu các yếu tố còn lại. Căn cứ: [SD-003](../02-domain-discovery/decisions/strategic-decisions.md), đọc theo SD-059.

## 4. Selective Sharing

Chỉ những capability thực sự thuộc cấp Ecoma Platform mới được chia sẻ ở cấp platform. Việc chia sẻ công nghệ giữa hai domain không đồng nghĩa với hợp nhất quyền sở hữu nghiệp vụ — Technical Sharing không kéo theo Shared Business Ownership. Căn cứ: [SD-004](../02-domain-discovery/decisions/strategic-decisions.md), [SD-005](../02-domain-discovery/decisions/strategic-decisions.md).

## 5. Unified Product Experience

- Ecoma sử dụng thương hiệu và định hướng trải nghiệm thống nhất xuyên suốt sản phẩm. Căn cứ: [SD-011](../02-domain-discovery/decisions/strategic-decisions.md).
- Một Ecoma Account được dùng xuyên suốt sản phẩm; tuy nhiên authentication không mặc nhiên cấp quyền truy cập — Authorization vẫn do từng domain quyết định. Căn cứ: [SD-012](../02-domain-discovery/decisions/strategic-decisions.md), [ID-001](../02-domain-discovery/decisions/account-identity-decisions.md).
- Ownership Profile được phân tách: Ecoma Platform sở hữu Profile cốt lõi và Personalization dùng chung; domain có thể sở hữu các phần mở rộng Profile phục vụ nghiệp vụ riêng. Căn cứ: [SD-013](../02-domain-discovery/decisions/strategic-decisions.md).
- Provider đăng ký danh tính một lần với Ecoma và có thể cung ứng trên cả hai domain qua một ứng dụng cấu hình; sự dùng chung giao diện này không lập ranh giới nghiệp vụ. Căn cứ: [SD-018](../02-domain-discovery/decisions/provider-decisions.md), [SD-059](../02-domain-discovery/decisions/strategic-decisions.md).

## 6. Liên kết giữa hai domain

Việc tài nguyên GPU của một Provider trở thành hạ tầng chạy Offering LLM của Provider khác qua Ecoma không phải giá trị cốt lõi của sản phẩm, nhưng được phép xảy ra và Ecoma mong muốn. Ranh giới giữa hai domain phải không chặn liên kết này khi nhu cầu phát sinh; không thiết kế tích hợp trước khi có nhu cầu thực. Căn cứ: [SD-060](../02-domain-discovery/decisions/strategic-decisions.md).

## 7. Hybrid Governance

Ecoma Platform quản trị các nguyên tắc và năng lực nền tảng bắt buộc thống nhất. Từng domain tự chủ quyết định business model, quan hệ thương mại, pricing, SLA và trách nhiệm dịch vụ trong phạm vi các nguyên tắc chung đó. Căn cứ: [SD-030](../02-domain-discovery/decisions/strategic-decisions.md), đọc theo SD-059.

## 8. Federated Operations

Các năng lực vận hành dùng chung được tổ chức ở cấp Ecoma Platform; các hoạt động vận hành đặc thù thuộc quyền sở hữu và thực hiện tại từng domain. Căn cứ: [SD-040](../02-domain-discovery/decisions/strategic-decisions.md).

## 9. Vai trò thương mại của Ecoma đối với Consumer

- Ecoma luôn là chủ thể có quan hệ thương mại trực tiếp với Consumer, kể cả khi Offering thuộc sở hữu của Provider. Căn cứ: [SD-035](../02-domain-discovery/decisions/strategic-decisions.md).
- Consumer thanh toán thông qua Ecoma; Ecoma quản lý dòng tiền, nghĩa vụ tài chính và việc thanh toán cho Provider. Căn cứ: [SD-015](../02-domain-discovery/decisions/provider-decisions.md).
- Cả hai domain đóng vai trò trung gian Marketplace: Ecoma ghép nối cung ứng của Provider với nhu cầu của Consumer, Offering thuộc sở hữu Provider. Căn cứ: [SD-058](../02-domain-discovery/decisions/strategic-decisions.md) (giữ phần vai trò của SD-054).
- Phạm vi cam kết dịch vụ của Ecoma với Consumer do từng domain quyết định; Ecoma chịu trách nhiệm đối với những cam kết do mình đưa ra. Căn cứ: [SD-036](../02-domain-discovery/decisions/strategic-decisions.md).
- **Chưa quyết định:** tư cách pháp lý Merchant of Record của Ecoma chưa được xác định (theo [SD-015](../02-domain-discovery/decisions/provider-decisions.md)). Chủ đề này chưa có quyết định và chưa được suy diễn thêm; theo dõi tại [Discovery Backlog](../02-domain-discovery/discovery-backlog.md).

## Tài liệu liên quan

- [AI Factory Marketplace](ai-factory-marketplace.md)
- [Strategic Objectives](strategic-objectives.md)
- [Constraints](constraints.md)
