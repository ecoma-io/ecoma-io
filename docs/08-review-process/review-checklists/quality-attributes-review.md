# Quality Attributes Review Checklist

## 1. Phạm vi

Áp dụng cho việc xác định, thay đổi hoặc xác minh Quality Attributes như reliability, availability, performance, scalability, security, observability, maintainability và testability.

## 2. Quality Scenario

- [ ] Quality concern được mô tả cụ thể.
- [ ] Actor hoặc source of stimulus được xác định.
- [ ] Điều kiện và workload được mô tả.
- [ ] Expected response hoặc measurable outcome được xác định.
- [ ] Phạm vi domain, system hoặc component được nêu.
- [ ] Các giả định về workload và environment được ghi nhận.

## 3. Measurability

- [ ] Mục tiêu có metric, threshold hoặc observable evidence.
- [ ] Measurement window và điều kiện đo được xác định khi cần.
- [ ] Baseline hiện tại được ghi nhận nếu có.
- [ ] Không dùng từ chung chung như fast, scalable hoặc highly available mà không giải thích.
- [ ] Mục tiêu không vượt quá khả năng đo lường hiện có nếu chưa có kế hoạch bổ sung.

## 4. Trade-offs

- [ ] Các Quality Attributes xung đột được nhận diện.
- [ ] Chi phí và rủi ro được ghi nhận.
- [ ] Phạm vi áp dụng theo domain hoặc workload được xác định.
- [ ] Có lý do cho việc ưu tiên một thuộc tính hơn thuộc tính khác.
- [ ] Các ảnh hưởng đến domain correctness và security không bị hy sinh ngầm.

## 5. Verification

- [ ] Có phương pháp kiểm chứng: test, benchmark, static analysis, threat model hoặc operational metric.
- [ ] Test environment và workload đủ đại diện.
- [ ] Có cách quan sát trong production hoặc môi trường tương ứng khi cần.
- [ ] Có owner xử lý khi target không đạt.
- [ ] Có kế hoạch review lại target khi workload hoặc business context thay đổi.

## 6. Approval

- [ ] Domain owner xác nhận mục tiêu nghiệp vụ.
- [ ] Architecture Owner xác nhận giải pháp và trade-off.
- [ ] Security hoặc operational authority tham gia khi liên quan.
- [ ] Quality Attribute và Verification Strategy được cập nhật.
