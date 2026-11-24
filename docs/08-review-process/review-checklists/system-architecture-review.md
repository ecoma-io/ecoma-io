# System Architecture Review Checklist

## 1. Phạm vi

Áp dụng cho System Context, Container/Component Architecture, Runtime, Integration, Data, Security và Deployment Architecture.

## 2. System Boundaries

- [ ] System và external actor/dependency được xác định.
- [ ] Trách nhiệm của từng application/service/component rõ ràng.
- [ ] Business boundary và deployment boundary được phân biệt.
- [ ] Không mặc định Bounded Context tương ứng Microservice.
- [ ] Ownership dữ liệu và quyền ghi được xác định.
- [ ] Các trust boundary được thể hiện.

## 3. Integration Architecture

- [ ] Giao thức và contract được xác định.
- [ ] Producer/consumer ownership rõ.
- [ ] Timeout, retry và error semantics được xác định.
- [ ] Idempotency và ordering được xử lý khi cần.
- [ ] Compatibility và rollout sequence được xem xét.
- [ ] Dependency failure không gây lan truyền ngoài dự kiến.
- [ ] Cross-system authentication và authorization được xác định.

## 4. Data Architecture

- [ ] Source of truth cho từng loại dữ liệu rõ.
- [ ] Operational data, projection, cache và replicated data được phân biệt.
- [ ] Data lifecycle, retention, deletion và export được xem xét.
- [ ] Backup và recovery có chiến lược.
- [ ] Data migration có kế hoạch.
- [ ] Sensitive data được phân loại và bảo vệ.
- [ ] Data access có audit khi cần.

## 5. Security Architecture

- [ ] Authentication và Authorization được phân biệt.
- [ ] Identity, tenant, organization và resource scope không bị nhập nhằng.
- [ ] Trust boundary và threat model được xem xét.
- [ ] Secret và credential được quản lý phù hợp.
- [ ] Privilege escalation và delegation được xem xét.
- [ ] Audit trail đáp ứng nhu cầu truy vết.
- [ ] Các rủi ro bảo mật có owner và mitigation.

## 6. Runtime và Deployment

- [ ] Deployment unit được xác định.
- [ ] Readiness, liveness và startup behavior rõ.
- [ ] Configuration và secret injection được xác định.
- [ ] Resource limits và scaling strategy được xem xét.
- [ ] Rollout, rollback và migration order được xác định.
- [ ] Health check phản ánh readiness thực tế.
- [ ] Failure isolation và recovery path được xem xét.
- [ ] Không tạo deployment unit độc lập nếu lợi ích không bù được operational cost.

## 7. Observability và Operations

- [ ] Logs, metrics và traces đủ để điều tra failure.
- [ ] Correlation/trace context được truyền qua integration khi cần.
- [ ] Alert có signal và action rõ.
- [ ] Runbook hoặc operational procedure tồn tại khi cần.
- [ ] SLO hoặc operational target được xác định nếu có cam kết.
- [ ] Có phương pháp kiểm chứng sau deploy.

## 8. Approval

- [ ] Architecture Owner xác nhận kiến trúc tổng thể.
- [ ] Security/Data owner được tham vấn khi liên quan.
- [ ] Domain owner xác nhận tác động nghiệp vụ.
- [ ] Decision Record và architecture diagrams được cập nhật.
