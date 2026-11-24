# Invitation Decisions

**Phạm vi:** Invitation vào Consumer Organization. Quy ước chung được quy định tại [README](README.md).

> Ngày quyết định không được ghi nhận.

## INV-001 — Invitation Management Authorization

**Status:** Accepted  

Owner hoặc Member có quyền quản lý thành viên được phép tạo và thu hồi Invitation trong phạm vi quyền hạn được cấp.

## INV-002 — Explicit Invitation Acceptance

**Status:** Accepted  

Người nhận phải chấp nhận Invitation trước khi trở thành Member.

## INV-003 — Invitation for Unregistered Email

**Status:** Accepted  

Invitation có thể được gửi đến email chưa có Ecoma Account; người nhận có thể đăng ký Account bằng email đó, xác minh OTP rồi chấp nhận Invitation.

## INV-004 — Immutable Invitation Recipient

**Status:** Accepted  

Invitation được gắn cố định với email đích khi tạo và không thể chuyển sang email khác hoặc thay đổi người nhận.

## INV-005 — Common Invitation Expiry

**Status:** Accepted  

Ecoma định nghĩa thời hạn hết hạn chung cho Invitation; giá trị thời hạn cụ thể chưa được quyết định.

## INV-006 — Invitation Lifecycle

**Status:** Accepted  

Invitation có các trạng thái Pending, Accepted, Rejected, Expired và Revoked; trạng thái kết thúc không thể quay lại Pending, muốn mời lại phải tạo Invitation mới.

## INV-007 — Pending Invitation Revocation

**Status:** Accepted  

Member có quyền quản lý thành viên được phép thu hồi Pending Invitation trong phạm vi quyền hạn được cấp.

## INV-008 — No Global Pending Invitation Quota

**Status:** Accepted  

Không áp đặt hạn mức nghiệp vụ toàn cục cho số lượng Pending Invitation; cơ chế rate limiting và chống lạm dụng vẫn được áp dụng.

## INV-009 — Independent Invitations Across Organizations

**Status:** Accepted  

Một email có thể nhận nhiều Invitation độc lập từ các Consumer Organization khác nhau.

## INV-010 — Invitation Uniqueness within Organization

**Status:** Accepted  
**Liên quan:** [MEM-009](membership-decisions.md)

Trong cùng một Consumer Organization, một email chỉ được có tối đa một Pending Invitation và không thể đồng thời là Member và người nhận Pending Invitation.

## INV-011 — Atomic Invitation Eligibility

**Status:** Accepted  

Việc kiểm tra điều kiện và tạo Invitation phải bảo đảm tính nguyên tử để ngăn chặn các Invitation trùng lặp do thao tác đồng thời.

## INV-012 — Immediate Re-invitation

**Status:** Accepted  

Có thể gửi Invitation mới ngay sau khi Invitation trước đó Accepted, Rejected, Expired hoặc Revoked, miễn là các điều kiện Membership và Pending Invitation được thỏa mãn.

## INV-013 — Independent Invitation Lifecycle

**Status:** Accepted  

Trạng thái kết thúc của một Invitation không ảnh hưởng đến các Invitation độc lập khác.

## INV-014 — Organization Termination Invalidates Invitations

**Status:** Accepted  

Khi Consumer Organization bị Terminated, toàn bộ Pending Invitation phải bị vô hiệu ngay.

## INV-015 — Invitation Email Ownership Verification

**Status:** Accepted  

Người nhận phải chứng minh quyền kiểm soát chính xác email đích tại thời điểm chấp nhận Invitation; việc xác minh email Account khác hoặc từng liên kết email đó trước đây không thay thế yêu cầu này.
