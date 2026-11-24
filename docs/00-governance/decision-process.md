# Architecture Decision Process

## 1. Mục đích

Tài liệu này quy định cách phân loại, tạo lập, đánh giá, chấp thuận, công bố, thay đổi và lưu trữ các quyết định có ảnh hưởng đến kiến trúc Ecoma.

Mục tiêu là bảo đảm quyết định:

- Có vấn đề và bối cảnh rõ ràng.
- Được chấp thuận bởi đúng thẩm quyền.
- Có rationale và consequences.
- Có trạng thái hiệu lực minh bạch.
- Có thể truy vết và xem xét lại.
- Không bị thay đổi âm thầm hoặc mất lịch sử.

## 2. Phạm vi áp dụng

Quy trình áp dụng cho quyết định ảnh hưởng đến một hoặc nhiều nội dung sau:

- Ecoma Strategy và cấu trúc domain của sản phẩm.
- Business ownership, responsibility, policy và lifecycle.
- Domain boundary và Bounded Context.
- Context Map, Domain Event và Integration Contract.
- Tactical Design và consistency boundary.
- System, Security, Data, Runtime và Deployment Architecture.
- Monorepo structure, module boundary và dependency rules.
- Quality Attributes và architecture constraints.
- Các nguyên tắc quản trị và review.

Không yêu cầu tạo Architecture Decision Record cho mọi lựa chọn code cục bộ, refactor nhỏ hoặc implementation detail không làm thay đổi kiến trúc có ý nghĩa.

## 3. Phân loại quyết định

Mỗi Decision Record phải có một loại chính. Có thể ghi thêm các loại liên quan.

| Loại                | Phạm vi                                                                          |
| ------------------- | -------------------------------------------------------------------------------- |
| Strategic           | Tầm nhìn, mục tiêu, cấu trúc domain của sản phẩm, vai trò Ecoma Platform         |
| Domain              | Business subject, ownership, actor, policy, lifecycle, responsibility, invariant |
| Domain Design       | Bounded Context, Context Map, domain boundary, event và contract                 |
| Tactical            | Aggregate, Entity, Value Object, Repository, transaction và application pattern  |
| System Architecture | System boundary, integration, runtime, deployment, security, data                |
| Engineering         | Monorepo, Nx project, dependency, build, test và tooling                         |
| Quality             | Reliability, performance, security, observability và verification                |
| Governance          | Quy trình, authority, nguyên tắc và cách quản lý kiến trúc                       |

Nếu quyết định tác động đến nhiều loại, phải ghi rõ các loại liên quan và authority cần thiết. Không chọn loại Engineering chỉ vì thay đổi được thực hiện trong code nếu bản chất của nó là thay đổi Domain hoặc Strategic Decision.

## 4. Phân biệt thông tin và quyết định

Không phải mọi nội dung trong Architecture Knowledge Base đều là quyết định.

| Loại nội dung | Ý nghĩa                     |
| ------------- | --------------------------- |
| Fact          | Thông tin đã xác minh       |
| Assumption    | Giả định chưa xác minh      |
| Proposal      | Phương án đang được đề xuất |
| Open Question | Vấn đề chưa có kết luận     |
| Decision      | Kết luận đã được chấp thuận |

Một Proposal chỉ trở thành Decision sau khi được review và approve theo đúng authority.

Một tài liệu được merge, một PR được approve hoặc một implementation đã tồn tại không tự động chứng minh rằng quyết định kiến trúc tương ứng đã được chấp thuận.

## 5. Trạng thái quyết định

Sử dụng các trạng thái sau:

| Trạng thái   | Ý nghĩa                                     | Có hiệu lực? |
| ------------ | ------------------------------------------- | ------------ |
| `Proposed`   | Đang được đề xuất và chờ đánh giá           | Không        |
| `Accepted`   | Đã được chấp thuận và đang có hiệu lực      | Có           |
| `Rejected`   | Đã được xem xét nhưng không được chấp thuận | Không        |
| `Superseded` | Đã bị một quyết định mới thay thế           | Không        |
| `Withdrawn`  | Đã được rút lại, không tiếp tục áp dụng     | Không        |

Quy tắc:

- Chỉ `Accepted` là trạng thái quyết định có hiệu lực.
- `Rejected` giữ lại lịch sử phương án đã xem xét, không dùng lại như quyết định.
- `Superseded` phải liên kết đến Decision Record thay thế.
- `Withdrawn` phải có lý do rút lại.
- Không xóa Decision Record đã được công bố chỉ vì nó không còn hiệu lực.

`Draft` có thể được dùng trong quá trình soạn thảo file nhưng không phải trạng thái quyết định chính thức. `Open Question` được quản lý như một câu hỏi trong Discovery Backlog, không phải trạng thái của Decision Record.

## 6. Decision Record

### 6.1. Khi nào cần tạo

Tạo Decision Record khi có một hoặc nhiều điều kiện:

- Thay đổi business ownership hoặc responsibility.
- Thay đổi Strategic Direction hoặc cấu trúc domain của sản phẩm.
- Tạo, hợp nhất, tách hoặc thay đổi Bounded Context.
- Thay đổi Context Map hoặc Integration Contract có ảnh hưởng đáng kể.
- Thay đổi consistency boundary, transaction semantics hoặc data ownership.
- Chọn hoặc thay đổi System/Deployment Architecture.
- Thay đổi module boundary hoặc dependency rule quan trọng.
- Chấp nhận ngoại lệ đối với Architecture Principle.
- Chọn giữa các phương án có trade-off dài hạn đáng kể.
- Thay đổi một quyết định `Accepted` trước đó.

Không bắt buộc tạo record cho thay đổi implementation nhỏ nằm hoàn toàn trong phạm vi quyết định đã có hiệu lực.

#### Phân biệt Domain Decision và ADR

- **Domain Decision** ghi nhận quyết định thuộc business semantics, policy, lifecycle, ownership và responsibility của domain.
- **ADR** ghi nhận quyết định có tác động đáng kể đến kiến trúc, architectural boundaries, architecture principles hoặc trade-off dài hạn.
- Domain Decision không mặc nhiên yêu cầu tạo ADR.
- Chỉ cần ADR khi quyết định domain đồng thời thiết lập hoặc thay đổi một ràng buộc kiến trúc có ảnh hưởng đáng kể.
- Nếu cùng một vấn đề cần cả hai loại record, mỗi record phải có trách nhiệm riêng và liên kết đến nhau. Không sao chép toàn bộ nội dung giữa hai record.

Ví dụ phân loại:

| Tình huống                                | Record chính                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Thay đổi business policy trong một domain | Domain Decision                                                                         |
| Thay đổi ownership giữa hai domain        | Domain Decision; thêm ADR nếu có tác động kiến trúc đáng kể                             |
| Tách một Bounded Context                  | ADR                                                                                     |
| Thay đổi deployment architecture          | ADR                                                                                     |
| Thay đổi Aggregate invariant              | Domain Decision hoặc tài liệu Domain Model; thêm ADR nếu có trade-off kiến trúc đáng kể |

### 6.2. Vị trí lưu trữ

Decision Records được lưu tại:

```text
00-governance/
└── architecture-decision-records/
    ├── template.md
    ├── ADR-0001-<short-title>.md
    ├── ADR-0002-<short-title>.md
    └── ...
```

Các Domain Decision chi tiết có thể được quản lý trong `02-domain-discovery/decisions/` nếu có nhu cầu về taxonomy riêng. Tuy nhiên, nếu chúng thay đổi kiến trúc hoặc có tác động xuyên lớp, cần liên kết đến Architecture Decision Record hoặc sử dụng cùng một cơ chế decision governance.

Không tạo hai bản ghi độc lập cho cùng một quyết định. Phải chỉ rõ nguồn sở hữu chính.

### 6.3. Định danh

- ID sử dụng dạng `ADR-NNNN`, tăng tuần tự và không tái sử dụng.
- Tên file có tiêu đề ngắn, ổn định, dùng kebab-case.
- ID không thay đổi khi tiêu đề hoặc trạng thái thay đổi.
- Không dùng số issue hoặc PR làm ID thay thế cho ADR.

### 6.4. Nội dung tối thiểu

Một Decision Record cần có:

- ID, title, date, status, category và owner.
- Context và problem.
- Decision.
- Rationale.
- Alternatives considered, nếu có.
- Consequences và trade-offs.
- Affected areas và dependencies.
- Related documents.
- Supersedes hoặc Superseded by, nếu có.

Dùng mẫu tại `architecture-decision-records/template.md`.

## 7. Vòng đời quyết định

### 7.1. Identify

Nhận diện vấn đề cần có quyết định.

Kết quả:

- Vấn đề được mô tả.
- Phạm vi ảnh hưởng sơ bộ.
- Owner của vấn đề được xác định.

### 7.2. Propose

Tạo Decision Record ở trạng thái `Proposed`.

Tác giả cần:

- Mô tả bối cảnh và constraint.
- Đưa ra phương án đề xuất.
- Liệt kê alternatives khả thi hoặc giải thích vì sao không có alternative thực tế.
- Đánh giá consequences, risk và trade-off.
- Xác định tài liệu, Product, Context hoặc system bị ảnh hưởng.

### 7.3. Review

Thực hiện review theo `08-review-process`.

Reviewer cần đánh giá:

- Tính đúng đắn của context và facts.
- Sự phù hợp với các quyết định đang có hiệu lực.
- Tính nhất quán xuyên lớp.
- Rủi ro, trade-off và khả năng triển khai.
- Authority cần thiết để approve.

Review có thể kết luận cần bổ sung thông tin, yêu cầu chỉnh sửa hoặc đủ điều kiện trình approve.

### 7.4. Approve hoặc Reject

Người có thẩm quyền đưa ra kết luận.

- Nếu chấp thuận: chuyển thành `Accepted`.
- Nếu không chấp thuận: chuyển thành `Rejected`, ghi rationale.
- Nếu chưa đủ thông tin: giữ `Proposed`, ghi rõ phần còn thiếu và người xử lý.

Không được coi im lặng, merge code hoặc bắt đầu implementation là approval.

### 7.5. Publish và Implement

Sau khi `Accepted`:

- Cập nhật các tài liệu kiến trúc sở hữu nội dung.
- Liên kết Decision Record từ các tài liệu liên quan.
- Tạo implementation work item nếu cần.
- Xác định cách kiểm chứng implementation tuân thủ quyết định.
- Ghi nhận các điều kiện hoặc follow-up chưa hoàn tất.

Decision Record có hiệu lực từ thời điểm được approve, trừ khi record nêu rõ thời điểm có hiệu lực khác.

### 7.6. Revisit

Khi bối cảnh thay đổi hoặc có bằng chứng mới, có thể đề xuất xem xét lại.

Việc xem xét lại phải tạo Decision Record mới hoặc một thay đổi được quản lý tương đương. Không sửa nội dung lịch sử của quyết định cũ để thay đổi ý nghĩa.

## 8. Thay đổi quyết định đã Accepted

Để thay đổi một quyết định đang có hiệu lực:

1. Tạo Decision Record mới.
2. Tham chiếu quyết định cũ.
3. Giải thích lý do thay đổi và bằng chứng mới.
4. Đánh giá tác động lên các tài liệu, implementation, consumer và Product liên quan.
5. Xác định migration, compatibility, rollout và rollback nếu cần.
6. Review và approve theo authority của quyết định mới.
7. Khi quyết định mới được chấp thuận, đánh dấu quyết định cũ là `Superseded`.
8. Cập nhật các tài liệu nguồn sở hữu và liên kết truy vết.

Không chuyển quyết định cũ sang `Superseded` trước khi quyết định thay thế được chấp thuận, trừ khi quyết định cũ bị rút hiệu lực bằng một quyết định có thẩm quyền riêng.

## 9. Decision Authority

Quyền approve phụ thuộc vào bản chất và phạm vi quyết định, không chỉ phụ thuộc chức danh kỹ thuật.

Nguyên tắc:

- Strategic Decision cần người có thẩm quyền về định hướng Ecoma.
- Domain Decision cần Domain Owner hoặc người được ủy quyền cho domain liên quan.
- Domain Design Decision cần owner của các Context bị ảnh hưởng và Architecture Owner trong phạm vi tương ứng.
- System/Engineering Decision cần Architecture Owner hoặc Engineering Owner có thẩm quyền.
- Quyết định xuyên domain cần authority đại diện cho các domain hoặc trách nhiệm Ecoma Platform bị ảnh hưởng.
- Quyết định thay đổi Governance cần authority có quyền quản trị bộ quy tắc này.

Danh sách người hoặc vai trò cụ thể, cơ chế ủy quyền và cách xử lý bất đồng được quy định tại `08-review-process/review-authority.md`.

Không mặc định một cá nhân có toàn quyền approve mọi loại quyết định.

## 10. Quyết định khẩn cấp

Trong sự cố vận hành hoặc rủi ro bảo mật nghiêm trọng, có thể cần thay đổi trước khi hoàn tất quy trình review thông thường.

Khi đó:

- Chỉ áp dụng thay đổi tối thiểu cần thiết để kiểm soát rủi ro.
- Người thực hiện phải có authority vận hành hoặc incident authority phù hợp.
- Ghi lại lý do, phạm vi, thời điểm và tác động.
- Tạo hoặc cập nhật Decision Record ngay khi có thể.
- Thực hiện retrospective review sau khi tình huống khẩn cấp được kiểm soát.
- Xác định thay đổi là giải pháp lâu dài hay workaround tạm thời.
- Có thời hạn hoặc điều kiện loại bỏ workaround nếu phù hợp.

Quy trình khẩn cấp không được dùng để né tránh approval cho thay đổi kiến trúc lâu dài.

## 11. Quan hệ với tài liệu và implementation

Decision Record không thay thế tài liệu mô tả kiến trúc.

- Decision Record ghi lại **vì sao và đã quyết định điều gì**.
- Tài liệu kiến trúc chuyên trách mô tả **mô hình hoặc thiết kế hiện đang có hiệu lực**.
- Source code và infrastructure configuration thể hiện **implementation thực tế**.
- Review Record ghi lại **đã kiểm tra những gì và kết luận review ra sao**.

Khi các nguồn mâu thuẫn:

1. Không tự động giả định source code là quyết định đúng.
2. Xác định Decision Record đang có hiệu lực.
3. Xác minh implementation có lệch khỏi quyết định hay tài liệu đã lỗi thời.
4. Ghi nhận và xử lý discrepancy.
5. Nếu cần thay đổi quyết định, thực hiện quy trình revisit.

## 12. Decision Log và truy vết

Cần duy trì một chỉ mục Decision Records, có thể là bảng trong `README.md` của thư mục ADR hoặc công cụ quản lý phù hợp.

Các trường tối thiểu:

- ID.
- Title.
- Category.
- Status.
- Owner.
- Date.
- Related Product/Domain/Context.
- Supersedes/Superseded by.

Các tài liệu liên quan nên liên kết trực tiếp đến ADR thay vì sao chép rationale.

## 13. Điều kiện hoàn thành một Decision Record

Một Decision Record chỉ được xem là hoàn tất khi:

- Context và vấn đề đủ rõ.
- Decision được diễn đạt không mơ hồ.
- Rationale và trade-off được ghi nhận.
- Các alternatives được đánh giá phù hợp với độ quan trọng.
- Affected areas và dependencies được xác định.
- Review đã hoàn thành.
- Đúng authority đã approve hoặc reject.
- Status và liên kết liên quan được cập nhật.
- Nếu Accepted, tài liệu nguồn sở hữu đã được cập nhật hoặc có work item rõ ràng để cập nhật.

## 14. Các vấn đề cần được hoàn thiện ở Governance/Review

Tài liệu này không tự gán người có thẩm quyền cụ thể. Những nội dung sau phải được chốt trong `08-review-process`:

- Danh sách vai trò và người đang đảm nhiệm.
- Authority matrix theo loại và phạm vi quyết định.
- Quy tắc xử lý bất đồng.
- Quy tắc quorum hoặc yêu cầu đồng thuận nếu cần.
- Cơ chế delegated approval.
- Quy trình review và lưu Review Record.
