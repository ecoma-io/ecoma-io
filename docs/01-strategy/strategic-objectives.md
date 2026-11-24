# Strategic Objectives

## Mục đích và nguồn

Tài liệu này ghi nhận các mục tiêu chiến lược của Ecoma cho sản phẩm AI Factory Marketplace. Tài liệu mô tả mục đích và ý nghĩa của từng mục tiêu; không đặt KPI hay chỉ số đo lường.

## 1. Unified Product Experience

**Mục đích:** bảo đảm AI Factory Marketplace là một sản phẩm có thương hiệu và trải nghiệm thống nhất, thay vì hai khu chợ rời rạc của LLM và GPU.

**Ý nghĩa:** một Ecoma Account dùng xuyên suốt sản phẩm cho cả hai domain, giúp người dùng không phải tạo danh tính riêng cho từng domain; tuy nhiên authentication không mặc nhiên cấp quyền — Authorization vẫn thuộc từng domain. Thông tin Profile cốt lõi và Personalization dùng chung thuộc sở hữu Ecoma Platform, còn domain có thể sở hữu phần mở rộng Profile phục vụ nghiệp vụ riêng. Provider đăng ký danh tính một lần và cung ứng trên cả hai domain qua một ứng dụng cấu hình. Nhờ đó trải nghiệm liền mạch không làm xói mòn ranh giới ownership giữa Ecoma Platform và từng domain. Căn cứ: [SD-011](../02-domain-discovery/decisions/strategic-decisions.md), [SD-012](../02-domain-discovery/decisions/strategic-decisions.md), [SD-013](../02-domain-discovery/decisions/strategic-decisions.md), [SD-018](../02-domain-discovery/decisions/provider-decisions.md), [SD-059](../02-domain-discovery/decisions/strategic-decisions.md).

## 2. Integrated Product Business

**Mục đích:** bảo đảm tích hợp giữa hai domain không chỉ nằm ở trải nghiệm mà còn có thể mở rộng sang hoạt động kinh doanh khi nhu cầu phát sinh.

**Ý nghĩa:** Consumer thanh toán qua một ví tài chính dùng chung; tài nguyên GPU của một Provider có thể trở thành hạ tầng chạy Offering LLM của Provider khác qua Ecoma — liên kết được phép xảy ra và Ecoma mong muốn, nhưng không được thiết kế trước khi có nhu cầu thực. Trong mọi trường hợp, Ecoma luôn là chủ thể có quan hệ thương mại trực tiếp với Consumer — kể cả khi Offering thuộc sở hữu của Provider — và Consumer thanh toán thông qua Ecoma, với dòng tiền và việc thanh toán cho Provider do Ecoma quản lý. Căn cứ: [SD-060](../02-domain-discovery/decisions/strategic-decisions.md), [SD-037](../02-domain-discovery/decisions/strategic-decisions.md), [SD-015](../02-domain-discovery/decisions/provider-decisions.md), [SD-035](../02-domain-discovery/decisions/strategic-decisions.md).

## 3. Domain Independence

**Mục đích:** bảo đảm từng domain có đủ quyền tự chủ để phát triển và cạnh tranh như một mảng nghiệp vụ riêng trong sản phẩm.

**Ý nghĩa:** mỗi domain chịu trách nhiệm sở hữu và phát triển nghiệp vụ cung ứng của mình, được phép có Domain Model riêng — kể cả khi dùng những khái niệm có tên gọi tương tự (ví dụ "Offering" của Domain LLM và "Offer" của Domain GPU) — và có business model, chính sách và Lifecycle riêng. Ecoma Platform không áp đặt một mô hình duy nhất cho mọi domain. Căn cứ: [SD-002](../02-domain-discovery/decisions/strategic-decisions.md), [SD-006](../02-domain-discovery/decisions/strategic-decisions.md), [SD-007](../02-domain-discovery/decisions/strategic-decisions.md), [SD-059](../02-domain-discovery/decisions/strategic-decisions.md).

## 4. Product Extensibility

**Mục đích:** bảo đảm sản phẩm có khả năng mở rộng theo thời gian mà không cần tái cấu trúc nền tảng.

**Ý nghĩa:** việc mở rộng diễn ra theo cả hai hướng — bổ sung dạng cung ứng mới trong từng domain (serverless, reserved, container job — theo dõi tại Discovery Backlog) và liên kết cung ứng giữa hai domain khi nhu cầu phát sinh. Về phía cung ứng, một Provider đăng ký danh tính với Ecoma một lần và có thể cung ứng trên cả hai domain mà không phải đăng ký lại danh tính, với mô hình cung ứng linh hoạt (tài nguyên đầu vào hoặc dịch vụ thành phần) tùy theo domain và Offering. Căn cứ: [SD-060](../02-domain-discovery/decisions/strategic-decisions.md), [SD-016](../02-domain-discovery/decisions/provider-decisions.md), [SD-018](../02-domain-discovery/decisions/provider-decisions.md), [SD-033](../02-domain-discovery/decisions/strategic-decisions.md).

## 5. Federated Operations và Governance

**Mục đích:** tổ chức quản trị và vận hành theo mô hình liên hiệp — thống nhất ở những gì thuộc Ecoma Platform, tự chủ ở những gì đặc thù của từng domain.

**Ý nghĩa:** Ecoma Platform quản trị các nguyên tắc chung và năng lực nền tảng bắt buộc thống nhất; các năng lực vận hành dùng chung được tổ chức ở cấp platform, còn các hoạt động vận hành đặc thù thuộc quyền sở hữu và thực hiện tại từng domain. Căn cứ: [SD-030](../02-domain-discovery/decisions/strategic-decisions.md), [SD-040](../02-domain-discovery/decisions/strategic-decisions.md), [SD-059](../02-domain-discovery/decisions/strategic-decisions.md).

## Tài liệu liên quan

- [Ecoma Strategy](ecoma-strategy.md)
- [AI Factory Marketplace](ai-factory-marketplace.md)
- [Constraints](constraints.md)
