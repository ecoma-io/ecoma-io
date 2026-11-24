# Tactical Design Review Checklist

## 1. Phạm vi

Áp dụng cho Domain Model và cách hiện thực hóa bên trong một Bounded Context, bao gồm Aggregate, Entity, Value Object, Domain Service, Repository, Application Service, transaction và persistence mapping.

## 2. Domain Semantics

- [ ] Thiết kế phản ánh Ubiquitous Language của Context.
- [ ] Entity, Value Object và Domain Service được dùng theo semantics.
- [ ] Identity và equality được xác định rõ.
- [ ] Domain rule nằm ở nơi có ownership phù hợp.
- [ ] Không đưa framework hoặc persistence concern vào domain policy.
- [ ] Không tạo abstraction chỉ để tuân thủ pattern.

## 3. Aggregate và Invariants

- [ ] Mỗi Aggregate có consistency boundary rõ.
- [ ] Aggregate bảo vệ invariant thuộc phạm vi của nó.
- [ ] Aggregate boundary không chỉ dựa trên quan hệ object hoặc database table.
- [ ] Các invariant xuyên Aggregate có chiến lược consistency phù hợp.
- [ ] Kích thước và transaction scope không gây coupling không cần thiết.
- [ ] Các concurrent command có semantics xác định.

## 4. Application và Domain Services

- [ ] Application Service điều phối use case, không sở hữu business rule không thuộc application.
- [ ] Domain Service chỉ được dùng khi hành vi thực sự thuộc domain.
- [ ] Authorization và precondition được kiểm tra tại boundary phù hợp.
- [ ] Side effect được điều phối rõ.
- [ ] Domain Event chỉ biểu đạt sự kiện nghiệp vụ có ý nghĩa.
- [ ] Event publication có chiến lược đảm bảo consistency khi cần.

## 5. Persistence và Transaction

- [ ] Repository abstraction phản ánh nhu cầu domain/application.
- [ ] Persistence model không làm rò rỉ vào domain model ngoài chủ đích.
- [ ] Transaction boundary được xác định.
- [ ] Concurrency control và optimistic/pessimistic locking được cân nhắc.
- [ ] Idempotency được xử lý cho operation có retry hoặc duplicate delivery.
- [ ] Migration và backward compatibility được xem xét.
- [ ] Không giả định distributed transaction nếu chưa có cơ chế thực tế.

## 6. CQRS và Read Model

- [ ] Command và query có trách nhiệm rõ.
- [ ] Full CQRS chỉ được dùng khi có lý do.
- [ ] Read model/projection có source và update semantics rõ.
- [ ] Eventual consistency được thể hiện cho consumer.
- [ ] Query không tạo side effect nghiệp vụ ngoài ý muốn.

## 7. Verification

- [ ] Có unit test cho invariant và domain behavior quan trọng.
- [ ] Có test cho transition hợp lệ và không hợp lệ.
- [ ] Có concurrency test khi invariant chịu ảnh hưởng bởi cạnh tranh.
- [ ] Có integration test cho persistence và transaction behavior.
- [ ] Có test cho duplicate, retry và failure khi liên quan.

## 8. Approval

- [ ] Domain Owner xác nhận semantics và invariant.
- [ ] Architecture Owner xác nhận design fit.
- [ ] Các thay đổi có tác động đến contract hoặc Context khác đã được review.
