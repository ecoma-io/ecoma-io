# Backoffice — Architecture

> Phạm vi: thiết kế `backoffice` — ranh giới, domain model khái niệm, authorization model và nơi enforce, token validity vs privilege currency, data/service trust, invariants và các quyết định đã chốt qua ADR.
> Yêu cầu → [`02-requirements.md`](./02-requirements.md) · system boundary → [`../../overview/01-architecture.md`](../../overview/01-architecture.md) §2.2 · §4 · §8 A21–A24 · §9 · §10 · `account` → [`../account/01-architecture.md`](../account/01-architecture.md) · [`../account/03-operations.md`](../account/03-operations.md) · `auth` → [`../auth/01-architecture.md`](../auth/01-architecture.md) §6.
> ⚠️ **Hiện trạng:** `apps/backoffice` là Nuxt app (`@ecoma-io/backoffice`) đã tích hợp AppShell (`app/app.vue`), có một **UI prototype** dùng dữ liệu mẫu (Issue #235 → PR #240) cùng `GET /api/greet`. Prototype đó **không** chứng minh có backend hay persistence. **Chưa có** xác thực, staff, role/permission, database binding hay RBAC nào được implement (`wrangler.jsonc` không có binding lưu trữ dữ liệu nào — chỉ có `ASSETS` phục vụ static asset). Hostname production đặt mục tiêu là `office.ecoma.io` ([`01` §7](../../overview/01-architecture.md)), custom domain chưa gán. Trạng thái bề mặt — route, locale, adapter — có canonical ở [`README.md`](./README.md). Toàn bộ tài liệu này là **thiết kế**, không phải hành vi đang chạy.

---

## 1. Mục đích

Tài liệu này mô tả ranh giới, domain model khái niệm và authorization model của `backoffice` — nó trả lời _service nào sở hữu cái gì_, _quyền được quyết định ở đâu_, và _invariant nào phải luôn đúng_; không mô tả schema, DDL hay endpoint HTTP cụ thể.

## 2. Phạm vi

### 2.1. Trong phạm vi

- **Staff directory** và **staff lifecycle** — sổ staff, tư cách thành viên và các chuyển trạng thái của nó.
- **Role/permission catalog** — danh mục các permission được phép gán, thuộc sở hữu của `backoffice`.
- **Staff-role assignment** — gán role cho một staff member, kèm phạm vi (scope) và hạn theo thời gian nếu có.
- **Authorization audit** — bản ghi của các thao tác nhạy cảm quyền.
- **Privileged-operation workflow** — quy trình phê duyệt và thực thi thao tác vận hành nhạy cảm.

### 2.2. Ngoài phạm vi

- **Account identity, credential, MFA/passkey, browser session** → [`../account/README.md`](../account/README.md); `backoffice` không nhân bản state này.
- **Giao thức OAuth 2.0 / OIDC** — flows, clients, token issuance/validation/revocation → [`../auth/README.md`](../auth/README.md).
- **Dữ liệu nghiệp vụ của resource-owning backend** — `backoffice` không sở hữu, không đọc database của nó.
- **Chính sách authorization của từng resource** — `backoffice` chỉ _điều hướng_ về service sở hữu resource; việc enforce nằm ở service đó (§5).

## 3. Boundary và ownership

| Sở hữu của `backoffice`                                                                                                                                           | Không sở hữu                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Staff directory · staff lifecycle · permission catalog · staff-role assignment · role-management governance · privileged-operation workflow · authorization audit | Account identity · credential/MFA/passkey · browser session · OAuth 2.0/OIDC protocol · dữ liệu nghiệp vụ của resource-owning backend · authorization policy của từng resource |

- **Account ID là cross-service identity reference.** Một **staff member** liên kết tới đúng **một** Account ID (`sub`): không tái phát hành, không tái sử dụng. Đây là **reference**, không phải khoá ngoại xuyên database — không có FK từ database của `backoffice` sang database của `account`. Email **không** phải primary identity key.
- **`account`** sở hữu canonical account identity: hồ sơ, email đã xác thực, credential, MFA/passkey, browser session, account lifecycle, authn audit. Nó **không** sở hữu staff membership, staff role, permission assignment hay authorization policy của `backoffice`, và **không** được ghi vào dữ liệu staff/role/permission của `backoffice`.
- **`auth`** sở hữu trách nhiệm giao thức OAuth 2.0 / OIDC: flows, clients, redirect URI validation, token issuance/validation/revocation, audience restriction, assurance. Nó **không** sở hữu business role/permission của `backoffice`. **OAuth scope ≠ application-level permission** (A22).
- **`backoffice` không phải một IdP thứ hai và không phải credential store.** Authentication tới `backoffice` đi qua `account`/`auth` như mọi application khác; `backoffice` chỉ tiêu thụ Account ID và token đã xác thực, và **không** giữ duplicate credential/MFA/passkey state.
- **Database trust.** `backoffice` sở hữu database của nó: `db-backoffice`, PostgreSQL, schema `backoffice` ([ADR-0001](./adr/0001-storage-schema-staff-rbac.md)). `account` và `auth` **không** được ghi vào dữ liệu staff/role/permission của `backoffice` dù chung hạ tầng/instance — chung PostgreSQL instance ≠ chung write authority. Runtime role chỉ có quyền tối thiểu, tách migrator/runtime privilege; pattern tham chiếu ở [`../account/03-operations.md`](../account/03-operations.md) §3 — **tham chiếu, không sao chép**.
- **Trục trạng thái tách đôi.** `staff status` (`active` | `suspended` | `terminated`) là trục **khác hẳn** với account status (`active` | `suspended` | `deleted`); hai khái niệm khác nhau và không suy ra nhau. Ba giá trị cụ thể của `staff status` là **đề xuất** — điều đã chốt là **sự tách trục**, không phải từng nhãn (§4.2).

## 4. Domain model (khái niệm — không phải schema)

⚠️ Phần này chỉ định nghĩa **ý nghĩa và ràng buộc**. Không có table, cột hay DDL nào được chốt ở đây — thiết kế schema cụ thể thuộc workstream A ([#85](https://github.com/ecoma-io/ecoma-io/issues/85)); engine/database/schema đã chốt ([ADR-0001](./adr/0001-storage-schema-staff-rbac.md)).

### 4.1. Staff member ↔ Account ID

- **staff member** (thành viên staff) là một người trong **staff directory** của `backoffice`, liên kết tới đúng **một** Account ID.
- Thuật ngữ là **`staff`** — không dùng `user`, `employee` hay `admin` để chỉ khái niệm này, tránh nhầm với account `users` của `account`.
- Account ID (`sub`) là **reference** ổn định, không tái phát hành/không tái sử dụng; **email không phải primary identity key**.
- Một Account ID có thể không có staff entry; khi có, mapping là 1:1. Không suy ra staff membership từ việc một Account tồn tại.
- Không tạo staff entry bằng dữ liệu do client gửi; linkage do server-side decision tạo và audit.

### 4.2. Staff status — trục khác hẳn account status

- **staff status** là trạng thái **membership** của một staff member trong staff directory; đề xuất gồm `active` | `suspended` | `terminated`. Tập nhãn này **chưa chốt**; điều đã chốt là nó là **trục riêng**, không suy ra từ account status.
- Account status (`active` | `suspended` | `deleted`) do `account` sở hữu. Hai trục **khác nhau, không suy ra nhau**.
- Thay đổi account status (suspend/delete ở `account`) **không** tự động viết lại staff status; ngược lại, `terminated` ở `backoffice` **không** tự suspend account.
- Hai bên biết về nhau qua event/contract với semantics riêng, nhưng không có đường ghi ngầm: `account` không ghi dữ liệu staff, `backoffice` không ghi dữ liệu account.
- `terminated` là trạng thái cuối cho membership; khôi phục membership là thao tác mới có audit, không phải "chuyển lại về active" im lặng.

### 4.3. Permission và permission catalog

- **permission** là định danh một hành động trên một resource domain (action + resource domain), ví dụ một permission kiểu `delivery.redrive` **đã được một service khác đặt tên và dành chỗ** — tài liệu này **không phát minh** permission cụ thể nào.
- Permission **không phải scope**: OAuth scope do `auth` cấp theo giao thức không map thẳng thành application-level permission (A22).
- **permission catalog** — danh mục các permission được phép gán — thuộc sở hữu của `backoffice`. Thêm/đổi/bỏ một permission là governance action có audit.
- **Enforcement thuộc resource-owning backend**: catalog định nghĩa permission; resource-owning backend enforce permission đó trên operation của chính nó. Permission ngoài catalog không được backend tự phát minh (A21, §5).
- Permission không hàm ý theo thời gian hay theo object — đó là hai trục của assignment (§4.5) và của enforcement (§5).

### 4.4. Role

- **role** là một tập permission có tên; role là cách gán quyền theo nhóm thay vì gán từng permission.
- **Không có unrestricted `isAdmin` bypass role**: mọi role đều là tập permission hữu hạn, và mọi đường đều đi qua enforcement như nhau.
- **system-defined role** vs **custom role** được phân biệt; custom role administration **không bật** giai đoạn này, chỉ system-defined role ([ADR-0004](./adr/0004-custom-role-administration.md)).
- Role hierarchy (role kế thừa role) **không dùng**; gán phẳng ([ADR-0007](./adr/0007-no-role-hierarchy.md), §4.7).
- Nội dung của từng system-defined role chưa chốt ở đây — nó phải xuất phát từ permission catalog thực tế, không phải từ tài liệu này.

### 4.5. Staff-role assignment

- **role assignment** gán một role cho một staff member; một staff member có thể có **nhiều** role.
- Assignment có thể kèm **phạm vi (scope)** và **hạn theo thời gian** — hai thuộc tính này quyết định assignment sống ở đâu, tới khi nào.
- **Job title confers no permissions**: chức danh/hồ sơ không tạo ra quyền; chỉ assignment tạo quyền.
- Không tự-assignment, không tự-nâng quyền, không gán quyền vượt quá quyền của mình (§7); mọi assignment là privileged operation có audit.
- Khi staff status chuyển sang `terminated`, assignment không còn hiệu lực — nhưng việc này **không** suy ra từ account status (§4.2).

### 4.6. Authorization audit

- **authorization audit** là bản ghi của một thao tác nhạy cảm quyền: actor, target, action, thời gian, kết quả, lý do, request/correlation ID.
- **Append-only** và access-restricted; **không** chứa access token, auth secret hay PII.
- Audit ghi _đã xảy ra gì_, không phải _được phép làm gì_ — nó không thay thế enforcement.
- **Không giả định xoá vật lý**: `terminated` là trạng thái của record staff, không phải xoá record; lịch sử assignment được giữ để audit còn truy vấn được.
- Retention cho authorization audit đi theo policy retention hệ thống cho audit/security event — quyết định hệ thống, canonical ở [`../../overview/01-architecture.md`](../../overview/01-architecture.md) §10; `backoffice` là consumer, không phải owner của policy ([ADR-0008](./adr/0008-audit-retention.md)).
- Logging là một detective control quan trọng, không phải optional (nguyên tắc từ OWASP Authorization Cheat Sheet → [`02-requirements.md`](./02-requirements.md) §8).

### 4.7. Deferred — chỉ bật khi có điều kiện kích hoạt

| Khái niệm                              | Trạng thái   | Điều kiện kích hoạt xem xét lại                                                                                                   |
| -------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **role hierarchy**                     | **deferred** | Catalog lớn tới mức kế thừa role là cần thật ([ADR-0007](./adr/0007-no-role-hierarchy.md))                                        |
| **ABAC / ReBAC / policy engine ngoài** | **deferred** | Một yêu cầu resource/context cụ thể được chứng minh là RBAC không đáp ứng ([ADR-0006](./adr/0006-no-abac-rebac-policy-engine.md)) |
| **departments / groups**               | **deferred** | Có nhu cầu assignment theo tổ chức được lặp lại thay vì gán role từng người                                                       |

ABAC được định nghĩa là logical access control mà kết quả authorize được quyết định bằng cách evaluate **attributes** của subject, object, operation và đôi khi environment conditions (nguồn: NIST SP 800-162, trích trong [`02-requirements.md`](./02-requirements.md) §8). **v1 chỉ RBAC** — không dùng ABAC/ReBAC/policy engine ngoài ([ADR-0006](./adr/0006-no-abac-rebac-policy-engine.md)).

## 5. Authorization model và nơi enforce

- **Deny-by-default.** Mọi protected request bị từ chối trừ khi được authorize rõ ràng; không có đường allow mặc định khi thiếu dữ liệu (A23; OWASP: "an application should be configured to deny access by default").
- **Server-side enforcement tại resource-owning backend, trên mọi protected request.** "Permission should be validated correctly on every request"; validate ở phần lớn request là **không đủ** (OWASP Authorization Cheat Sheet).
- **Decision inputs:** principal (Account ID + staff context) + action (permission) + resource (object + scope) + context. Thiếu, sai, mơ hồ hay không đọc được authorization state → **fail closed**, **không** có degraded allow path.
- **Object-level + scope-level checks bắt buộc (A23).** Có quyền với _loại_ object không đồng nghĩa truy cập mọi object của loại đó (IDOR/BOLA — CWE-639); role assignment **không** phải quyền không giới hạn trên mọi object. Ownership/data filtering theo từng resource.
- **Enforcement chia đôi, không hợp nhất:** một permission được định nghĩa và có lifecycle trong **catalog của `backoffice`**, nhưng việc _enforce_ permission đó trên operation/resources thuộc về **resource-owning backend** của chính resource đó. `backoffice` không thay resource-owning backend quyết định trên từng request; resource-owning backend **không tự phát minh permission ngoài catalog**.
- **UI visibility ≠ authorization (A23).** Ẩn nút, ẩn route hay ẩn menu là trải nghiệm, không phải chốt chặn; gọi trực tiếp API phải vẫn bị từ chối.
- **Workload/service identity ≠ end-user identity.** Internal call mang danh tính service nào thì không được phép giả danh end-user, và ngược lại; hai trục principal không trộn.
- **Trusted mapping** từ token subject (`sub`) sang Account ID và sang staff context diễn ra server-side từ token đã xác thực; client không supply được principal, role, permission hay scope.
- **Internal contracts** không dựa vào vị trí mạng: dùng envelope HMAC (signature + timestamp + nonce, chống replay) theo giao thức canonical ở [`../auth/01-architecture.md`](../auth/01-architecture.md) §5.1.8; **vị trí mạng nội bộ không phải trust** — bằng chứng "Service Binding là isolation, không phải verification" → [`../account/01-architecture.md`](../account/01-architecture.md) §5.1.
- **`backoffice` không mặc định trở thành lời gọi đồng bộ trên mỗi request.** Resource-owning backend tự enforce với dữ liệu nó có (token + assignment đã đồng bộ); **không có** contract nhận kết quả authorization từ `backoffice` ([ADR-0009](./adr/0009-no-internal-authorization-result-contract.md)) — chỉ batch/event-based sync.
- **Quyết định deny cũng phải quan sát được** như quyết định allow — một request bị từ chối mà không để lại dấu vết là mất tín hiệu điều tra; nội dung audit vẫn theo §4.6, không ghi secret.

## 6. Token validation và freshness của authorization

- **Resource server validate token theo token profile của nó:** chữ ký, issuer, audience, expiry. RFC 9700 (BCP 240): access tokens **SHOULD** audience-restricted tới một resource server cụ thể; khi token không hợp lệ "the resource server MUST refuse to serve the respective request"; "The privileges associated with an access token SHOULD be restricted to the minimum required" (trích → [`02-requirements.md`](./02-requirements.md) §8).
- **ID Token không phải API access token.** OIDC Core 1.0 định nghĩa ID Token là JWT "that contains Claims about the Authentication event", và validation của nó gồm `iss` "MUST exactly match", `aud` ("MUST be rejected if the ID Token does not list the Client as a valid audience"), chữ ký JWS, và `exp` ("The current time MUST be before the time represented by the exp Claim") — đó là bằng chứng của **một authentication event giữa OP và Client**, không phải permission để gọi resource server (trích → [`02-requirements.md`](./02-requirements.md) §8).
- **Token validity ≠ privilege currency (A24).** Một token còn hạn **không** phải bằng chứng privilege còn hiện hành: staff có thể đã `terminated`, assignment có thể đã hết hạn, account có thể đã `suspended`, authorization cache có thể cũ.
- **Bốn cơ chế tách biệt, không suy cái này ra cái khi:**

| Cơ chế                               | Ai sở hữu                              | Nó làm được gì                                            | Nó **không** làm được gì                          |
| ------------------------------------ | -------------------------------------- | --------------------------------------------------------- | ------------------------------------------------- |
| **Staff termination**                | `backoffice`                           | Chấm dứt membership và assignment của staff member        | Không thu hồi token đã cấp; không suspend account |
| **Account suspension**               | `account`                              | Chặn xác thực mới, thu hồi browser session theo `account` | Không tự xoá staff status hay assignment          |
| **Token / session revocation**       | `auth` (+ `account`)                   | Làm token/session hết hiệu lực theo mô hình revocation    | Không sửa staff status; không sửa catalog         |
| **Authorization cache invalidation** | resource-owning backend + `backoffice` | Làm cache permission/role cũ hết hiệu lực                 | Không thu hồi token, không đổi account status     |

- **Stale-authorization risk khi role/status được embed vào JWT.** Các lựa chọn và đánh đổi:

| Lựa chọn                                     | Đổi lấy gì                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| **Short-lived token**                        | Cửa sổ stale nhỏ; phải có đường gia hạn an toàn — không nêu con số ở đây |
| **Online check với trạng thái `backoffice`** | Luôn thấy trạng thái hiện hành; trả giá một lần tra cứu mỗi request      |
| **Versioned authorization state**            | Token mang version, backend từ chối version đã bị thu hồi                |
| **Cache invalidation**                       | Giảm tải; độ trễ invalidation là rủi ro phải đo và giới hạn              |

- **Ngưỡng revocation latency tối đa theo risk class đã chốt ([ADR-0002](./adr/0002-revocation-latency-risk-class.md)): `normal` ≤ 60 giây, `high` ≤ 5 giây — là target, không tự hiện đại hoá thành cơ chế.** Phải có cơ chế thiết kế đáp ứng ngưỡng trước khi bật role assignment thật; không hứa thu hồi tức thời khi chưa có cơ chế guarantee.
- **Privilege change → cân nhắc regenerate session/token.** OWASP Session Management Cheat Sheet: session phải invalidate **server-side**, và "The session ID must be renewed or regenerated… after any privilege level change"; xoá cookie một mình **không** invalidate bản sao session bị đánh cắp (trích → [`02-requirements.md`](./02-requirements.md) §8).

## 7. Step-up authentication, privileged operations và governance

- **Permission ≠ authentication assurance.** Một staff member có permission vẫn có thể bị đòi bước xác thực mạnh hơn cho hành động rủi ro cao; `backoffice` dựa vào **bằng chứng từ flow `auth` đáng tin cậy**, và **không bao giờ tin cờ MFA do client supply** (claim/header do client gửi bị bỏ qua và bị coi là không đáng tin). Cơ chế step-up và freshness window đã chốt → [ADR-0005](./adr/0005-step-up-fresh-session.md).
- **Cấm:** tự gán role (self-assignment), tự nâng quyền (self-elevation), cấp quyền vượt quá quyền của chính mình (granting above one's own authority).
- **Separation of duties.** Role administration tách khỏi thao tác nghiệp vụ thường ngày; thao tác rủi ro cao cần phê duyệt độc lập (independent approval).
- **Mass-affecting role edits phải được gated** — sửa nhiều assignment cùng lúc có blast radius lớn nên phải qua nút kiểm soát riêng.
- **Concurrency khi đổi quyền phải không mở rộng quyền âm thầm:** re-check authorization **at write time**, không dùng kết quả đã cache từ trước khi quyền bị thay đổi (chống TOCTOU).
- **Bootstrap first-administrator và emergency recovery phải được document hoá và audit.** Chúng **không** được là cờ bypass/backdoor chưa document hay một đường tắt `isAdmin`; đường đã chốt là IaC/manual SQL có audit trail + hai-phím rule, không có backdoor code path ([ADR-0003](./adr/0003-bootstrap-first-admin-recovery.md)).

## 8. Data và service trust

- **Least-privilege runtime DB credentials.** Runtime role chỉ có đúng quyền tối thiểu trên database của `backoffice`; quyền migration thuộc role khác — tham chiếu pattern ba tầng role ở [`../account/03-operations.md`](../account/03-operations.md) §3, **không sao chép**.
- **Shared PostgreSQL ≠ shared write authority.** `account`/`auth` **không bao giờ** mutate role assignment, staff hay catalog của `backoffice`, dù chung instance. Mỗi service một runtime role, `REVOKE CONNECT` chéo ([`01` invariant 5/25](../../overview/01-architecture.md)).
- **Internal contracts không được dựa vào vị trí mạng.** Không có cơ chế nào cho phép Worker phân biệt request qua Service Binding với request từ Internet; Service Binding là **đường đi**, không phải **xác thực**. Internal call phải mang **envelope HMAC** (signature + timestamp + nonce, chống replay bền vững) — giao thức canonical và bản cài đặt duy nhất ở [`../auth/01-architecture.md`](../auth/01-architecture.md) §5.1.8; `backoffice` **không** tự định nghĩa envelope thứ hai. Nền tảng và hệ quả → [`../account/01-architecture.md`](../account/01-architecture.md) §5.1.
- **Confused deputy ở privileged BFF.** `backoffice` (UI + BFF) không được hành động thay cho một identity chưa được xác minh: principal luôn lấy từ server-side verified token, không từ request body/param.
- **Tách end-user identity với workload identity** khi các privileged operation được thực hiện thay (on behalf of) — cần ghi rõ principal nào đang thực thi và audit theo principal đó.

## 9. Architectural Invariants

| #   | Invariant                                                                                                                                      | Enforcement                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | Authorization **deny-by-default**, enforced **server-side** tại resource-owning backend trên **mọi** protected request                         | Contract test: request thiếu permission → `403`, kể cả gọi thẳng API              |
| 2   | **UI visibility ≠ authorization** — ẩn UI không thay thế server-side check                                                                     | Contract test: thao tác bị ẩn UI, gọi API trực tiếp → vẫn `403`                   |
| 3   | Không tin bất kỳ identity/role/permission/scope/MFA flag nào do client supply                                                                  | Contract test: request với claim/header giả bị bỏ qua hoặc bị từ chối             |
| 4   | `account`/`auth` **không ghi** vào dữ liệu staff/role/permission của `backoffice`                                                              | DB grant review (REVOKE theo role) + module-boundary lint                         |
| 5   | **Token validity ≠ privilege currency** — privilege check đọc trạng thái hiện hành, không suy từ token còn hạn                                 | Contract test: token còn hạn + staff `suspended` → từ chối                        |
| 6   | **Không** có bypass `isAdmin`/cờ chưa document nào đi qua enforcement                                                                          | Manual review đường request path + audit-log check: mọi privileged op có audit    |
| 7   | Mọi privileged operation ghi **authorization audit** (actor, target, action, time, result, reason, correlation ID), **không** secret/token/PII | Audit-log check: truy vấn audit không chứa token/secret/PII                       |
| 8   | `staff status` và **account status** là hai trục độc lập, không suy ra nhau                                                                    | Contract test: account bị suspend không tự đổi staff status (và ngược lại)        |
| 9   | Bootstrap/recovery first-administrator chỉ qua đường **đocumented + audited**                                                                  | Manual review đường bootstrap + audit-log check: mọi lần thử có audit             |
| 10  | Catalog là nguồn sự thật duy nhất của permission; resource-owning backend **không** tự phát minh permission ngoài catalog                      | Contract test + catalog review: permission dùng bởi backend phải có trong catalog |
| 11  | Least-privilege DB credential; runtime privilege ≠ migrator privilege                                                                          | DB grant review: `has_table_privilege` sweep không còn quyền thừa                 |
| 12  | Authorization audit **append-only**, access-restricted                                                                                         | SQL check: UPDATE/DELETE trên audit bị từ chối; grant read có giới hạn            |

## 10. Đã chốt qua ADR

Mười một quyết định từng "chưa chốt" dưới đây đã được chốt bằng architectural decision record ([ADR](./adr/)) — mỗi quyết định có **một** canonical location là ADR tương ứng; bảng này chỉ giữ **con trỏ** tới đó, không nhân bản quyết định. Thay đổi nội dung một quyết định được chốt phải qua ADR tương ứng (hay một ADR mới thay thế nó), không sửa ô bảng ở đây; điều kiện kích hoạt xem xét lại từng quyết định được ghi trong ADR đó. Danh sách trạng thái tổng của bộ ADR → [`adr/README.md`](./adr/README.md).

| Quyết định (đã chốt)                                                                                                                                                                      | ADR                                                                                                                                                    | Kích hoạt                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| **Storage/schema cho staff/RBAC** — engine theo quy tắc bounded context ([`01` §4](../../overview/01-architecture.md) A20)                                                                | [ADR-0001](./adr/0001-storage-schema-staff-rbac.md) — `db-backoffice`, PostgreSQL, schema `backoffice`                                                 | Trước khi implement persistence đầu tiên cho staff/RBAC                      |
| **Ngưỡng revocation latency tối đa theo risk class** (A24)                                                                                                                                | [ADR-0002](./adr/0002-revocation-latency-risk-class.md) — `normal` ≤ 60s, `high` ≤ 5s (target)                                                         | Trước khi bật role assignment thật                                           |
| **Cơ chế bootstrap first-administrator + emergency recovery** — đường nào, ai approve, audit ra sao                                                                                       | [ADR-0003](./adr/0003-bootstrap-first-admin-recovery.md) — IaC/manual SQL + hai-phím rule, không có backdoor path                                      | Trước khi cấp quyền đầu tiên                                                 |
| **Có bật custom role administration không** (system-defined vs custom)                                                                                                                    | [ADR-0004](./adr/0004-custom-role-administration.md) — không bật; chỉ system-defined role                                                              | Trước khi cho phép tạo role ngoài system-defined                             |
| **Step-up mechanism + freshness window** cho hành động rủi ro cao                                                                                                                         | [ADR-0005](./adr/0005-step-up-fresh-session.md) — fresh session ≤ 5 phút (target) trước privileged operation                                           | Trước privileged-operation workflow đầu tiên                                 |
| **Có cần ABAC/ReBAC/policy engine ngoài không**                                                                                                                                           | [ADR-0006](./adr/0006-no-abac-rebac-policy-engine.md) — không dùng; RBAC + typed scope + controlled conditions                                         | Khi có yêu cầu resource/context cụ thể được chứng minh là RBAC không đáp ứng |
| **Có bật role hierarchy không**                                                                                                                                                           | [ADR-0007](./adr/0007-no-role-hierarchy.md) — không dùng; gán phẳng                                                                                    | Khi catalog cần kế thừa role thay vì gán phẳng                               |
| **Retention cho authorization audit** — theo retention policy hệ thống cho audit/security event (canonical: [`../../overview/01-architecture.md`](../../overview/01-architecture.md) §10) | [ADR-0008](./adr/0008-audit-retention.md) — `backoffice` là consumer, không phải owner của policy                                                      | Trước production                                                             |
| **Internal contract** nhận kết quả authorization giữa `backoffice` và resource-owning backend                                                                                             | [ADR-0009](./adr/0009-no-internal-authorization-result-contract.md) — không có; backend tự enforce, chỉ batch/event-based sync                         | Trước tích hợp enforcement đầu tiên                                          |
| **Cách đặt tên permission read và seed catalog backoffice**                                                                                                                               | [ADR-0010](./adr/0010-permission-naming-and-read-catalog.md) — `domain.action` dot-style; 3 permission read `staff.read`/`role.read`/`permission.read` | Trước route read của #99                                                     |
| **Authn boundary của `backoffice` server routes** — 401 cho credential vắng/hỏng, 503 cho credential không verify được lúc này                                                            | [ADR-0011](./adr/0011-authn-boundary-and-unauthenticated-response.md) — 401 credential vắng/hỏng, 503 credential không verify được lúc này             | Khi tầng authn thật được wire vào `backoffice` server routes                 |
