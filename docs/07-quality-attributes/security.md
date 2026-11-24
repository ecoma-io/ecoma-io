# Security

## Mục đích

Tài liệu này ghi nhận các thuộc tính chất lượng thuộc nhóm Security của Ecoma ở mức định hướng discovery: chúng mô tả ý nghĩa nghiệp vụ và hướng xác minh, chưa phải là thiết kế security architecture hay protocol implementation.

## Nguồn

- [Architecture Principles](../00-governance/architecture-principles.md) — đặc biệt AP-014 (Security và Authorization theo Ownership).

## Ghi chú về mục tiêu định lượng

Tài liệu này không đặt bất kỳ SLO hay mục tiêu định lượng nào. Các mục tiêu định lượng sẽ được xác lập qua quy trình quality requirements sau, không thuộc tài liệu này.

## 1. Deterministic enforcement

**Ý nghĩa:** Các quy tắc ủy quyền và business invariant được thực thi tất định: cùng một trạng thái nghiệp vụ cho cùng một kết quả enforcement, không phụ thuộc vào entry point, luồng gọi hay thời điểm thực hiện.

**Căn cứ và ý nghĩa:**

- [Architecture Principles](../00-governance/architecture-principles.md) đã xác lập nền tảng cho thuộc tính này: AP-008 yêu cầu business invariant được bảo vệ tại ranh giới chịu trách nhiệm, không chỉ dựa vào UI hoặc một luồng gọi cụ thể; AP-014 yêu cầu quyền được cấp, kế thừa, thu hồi và audit phải có semantics xác định.
- Tính tất định là điều kiện tiên quyết cho tính kiểm chứng được (SD-009 — Verifiable Architecture) và cho testability (xem [testability.md](testability.md)).

**Hướng xác minh ở mức nguyên tắc:** test chứng minh cùng trạng thái cho cùng kết quả trong các tình huống thành công, cạnh tranh và thất bại (theo Verification của AP-008).

## 2. Authentication và Authorization boundaries

**Ý nghĩa:** Xác thực Account thành công không mặc nhiên cấp quyền sử dụng domain hay quyền quản lý Provider. Authentication xác định danh tính; Authorization quyết định quyền — hai hoạt động có ranh giới rõ ràng.

**Căn cứ và ý nghĩa:**

- SD-012 (Unified User Identity): một Ecoma Account được sử dụng xuyên suốt Ecoma Platform, nhưng việc xác thực không mặc nhiên cấp quyền truy cập vào mọi domain.
- ID-001 (Shared Ecoma Account): quyền truy cập và quyền hạn vẫn do từng domain quyết định.
- Ranh giới Authentication ≠ Authorization được liệt kê rõ như một hệ quả cần giữ nhất quán; AP-014 là Invariant tương ứng ở cấp nguyên tắc: không suy ra quyền truy cập chỉ từ việc người dùng đã xác thực hoặc có mặt trong Ecoma Platform.

**Hướng xác minh ở mức nguyên tắc:** authorization tests và access-control review theo Verification của AP-014.

## 3. Access revocation

**Ý nghĩa:** Thu hồi truy cập phải xảy ra ngay lập tức và triệt để — quyền đã bị thu hồi không còn hiệu lực qua bất kỳ đường phụ thuộc nào.

**Căn cứ và ý nghĩa:**

- MEM-013 (Complete Membership Access Revocation): khi Membership kết thúc, toàn bộ quyền truy cập phát sinh trực tiếp hoặc gián tiếp từ Membership phải bị thu hồi, bao gồm quyền thông qua session, token hoặc credential phụ thuộc vào Membership.
- ORG-013 (Immediate Access Revocation): khi Consumer Organization bị Terminated, toàn bộ Membership kết thúc, Pending Invitation bị vô hiệu và mọi quyền truy cập phát sinh từ Organization phải bị thu hồi ngay.
- INV-014 (Organization Termination Invalidates Invitations): khi Consumer Organization bị Terminated, toàn bộ Pending Invitation phải bị vô hiệu ngay.

**Hướng xác minh ở mức nguyên tắc:** các tình huống revocation (kết thúc Membership, termination Organization) phải được kiểm chứng là triệt để — không còn quyền hiệu lực qua session, token, credential hay Invitation phụ thuộc. Thuộc tính này cũng là yêu cầu độ tin cậy của enforcement (xem [reliability.md](reliability.md), mục Resilience).

## 4. Auditability

**Ý nghĩa:** Các hoạt động và thay đổi có ý nghĩa nghiệp vụ phải có thể kiểm toán.

**Căn cứ và ý nghĩa:** AP-014 yêu cầu quyền được cấp, kế thừa, thu hồi và audit phải có semantics xác định. Chi tiết về phạm vi Auditability được ghi tại [observability.md](observability.md) — tài liệu này không trùng lặp nội dung đó.

## 5. Identity và organization boundary protection

**Ý nghĩa:** Bảo vệ ranh giới giữa Account, Organization và Provider — danh tính ở một khái niệm không mặc nhiên tạo ra quyền hoặc bằng chứng ở khái niệm khác.

**Căn cứ và ý nghĩa:**

- Các ranh giới đã xác lập: Account ≠ Consumer Organization ≠ Provider; Consumer Organization ≠ Organization Provider; Provider Identity ≠ Provider Actor. AP-014 đặt bảo vệ ranh giới này làm rationale trực tiếp của Invariant Security.
- ID-005 (Email OTP Verification): email OTP chỉ chứng minh người dùng kiểm soát địa chỉ email tại thời điểm xác minh, không chứng minh danh tính pháp lý hoặc danh tính con người. Bằng chứng kiểm soát email không được dùng như bằng chứng danh tính.
- INV-015 (Invitation Email Ownership Verification): người nhận phải chứng minh quyền kiểm soát chính xác email đích tại thời điểm chấp nhận Invitation; việc xác minh email ở Account khác hoặc từng liên kết email đó trước đây không thay thế yêu cầu này.
- ID-006 (Unique Account Email): một địa chỉ email chỉ được liên kết với tối đa một Account tại cùng một thời điểm — ràng buộc uniqueness bảo đảm email không trỏ tới hai danh tính Account.

**Hướng xác minh ở mức nguyên tắc:** kiểm chứng rằng các luồng nghiệp vụ không chuyển bằng chứng giữa các ranh giới (email verification không trở thành authorization; kiểm soát email cũ không chấp nhận Invitation hiện tại) và uniqueness email–Account được giữ vững kể cả dưới thao tác đồng thời (xem [testability.md](testability.md)).
