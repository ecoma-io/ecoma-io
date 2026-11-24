# Review Records

## 1. Mục đích

Thư mục này lưu Review Record đã hoàn tất hoặc đang được theo dõi. Review Record là bằng chứng về phạm vi, phiên bản, reviewer, findings, kết luận và approval.

## 2. Quy tắc lưu trữ

- Mỗi review có một ID duy nhất theo dạng `REV-YYYY-NNN`.
- Không tái sử dụng ID.
- Tên file dùng dạng `REV-YYYY-NNN-<short-title>.md`.
- Record phải liên kết đến tài liệu, Decision Record, PR, commit hoặc phiên bản được review.
- Không lưu bản sao toàn bộ tài liệu được review.
- Không xóa record đã hoàn tất; nếu record sai, bổ sung correction hoặc record thay thế có liên kết.
- Review đang mở có thể được lưu tại đây nếu cần theo dõi dài hạn; nếu dùng công cụ khác làm nơi quản lý chính, phải lưu liên kết ổn định.

## 3. Vòng đời

Review Record có thể được tạo ở trạng thái In Progress và cập nhật xuyên suốt review.

Khi review kết thúc:

- Điền kết luận.
- Ghi approval nếu cần.
- Liên kết Decision Record.
- Ghi follow-up.
- Ghi commit hoặc version được publish.
- Chuyển record sang trạng thái kết thúc phù hợp.

## 4. Chỉ mục

Có thể duy trì danh sách Review Records trong file này hoặc công cụ quản lý review. Nếu số lượng tăng, bổ sung bảng chỉ mục với các trường:

- Review ID.
- Title.
- Review Level.
- Review Type.
- Status.
- Date.
- Related ADR.
- PR/Commit.
- Review Coordinator.

Không tạo một chỉ mục thủ công khác nếu hệ thống quản lý công việc đã cung cấp cùng thông tin và có liên kết truy cập ổn định.
