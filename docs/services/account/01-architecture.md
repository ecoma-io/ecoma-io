# Account — Architecture

> Phạm vi: thiết kế `account` — ranh giới, mô hình dữ liệu `db-account`, session/cookie security, contract BFF, và quyền sở hữu vòng đời account.
> Yêu cầu → [`02-requirements.md`](./02-requirements.md) · vận hành → [`03-operations.md`](./03-operations.md) · protocol `auth` → [`../auth/01-architecture.md`](../auth/01-architecture.md) · system boundary → [`docs/overview/01-architecture.md`](../../overview/01-architecture.md) §2.1.
> **Hiện trạng:** `account` đã có schema (`apps/account/db/migrations/`, 0001–0006), contract internal và luồng đăng nhập email-OTP (`apps/account/server/api/auth/`). **Chưa có**: login/consent UI, contract back-channel mà `account` đẩy sang `auth`, và `db-account` chưa provision. Tài liệu này giữ vai trò thiết kế: phần đã có trong code được nêu tại chỗ tương ứng, phần còn lại là target design.

---

## 1. Mục đích và ranh giới

`account` là deploy unit giữ **bằng chứng đăng nhập** của người dùng và mọi UI liên quan tài khoản, trong bounded context `identity`.

| Sở hữu                                                                                                                                 | Không sở hữu                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account UI · BFF · **login UI** · **consent UI** · browser session · credential · MFA/passkey · profile · preference · privacy request | Endpoint protocol OAuth 2.0/OIDC · client registration · grant · token · signing key · staff directory · role · permission · staff-role assignment |

- `account.ecoma.io` là **hostname riêng** ([`01` §7](../../overview/01-architecture.md)) — không phục vụ dưới path của `ecoma.io`. Lý do là shared-origin: XSS ở một app không được đọc được cookie của app khác (`01` §6).
- **Ranh giới bằng chứng:** `account` là nguồn sự thật duy nhất cho "người này đã xác thực". `auth` **không** đọc `db-account`, không đọc credential, không đọc session. Nó nhận kết quả xác thực qua contract đã xác thực — [`../auth/01-architecture.md`](../auth/01-architecture.md) §5.
- Ngược lại, `auth` là nguồn sự thật cho "người này đã ủy quyền app nào". `account` hiển thị trạng thái đó qua contract, không đọc `db-auth`.
- **Ranh giới danh tính ↔ quyền nghiệp vụ:** `account` sở hữu **danh tính** (ai là ai), **không** sở hữu quyền nghiệp vụ của bất kỳ application nào. Ai là staff của `backoffice`, có role gì, được làm gì là dữ liệu của `backoffice`; `account` không lưu và không suy ra những điều đó. Account ID (`sub`) là **tham chiếu** mà `backoffice` dùng để liên kết staff member, không phải quan hệ sở hữu — [`../../overview/01-architecture.md`](../../overview/01-architecture.md) §2.2 (A21).

## 2. Runtime

```text
account.ecoma.io  (Cloudflare Worker, Nuxt 4 + Nitro preset cloudflare_module)
├── Hyperdrive binding → db-account      (query cache OFF)
├── Service Binding  → auth              (chỉ khi luồng login/consent cần)
└── Worker Secrets                       (không có provider credential — gửi mail qua transactional-mail)
```

⚠️ **`Service Binding` từ Preview gọi production** (`04` PW4). Worker production giữ Hyperdrive production → một Preview gọi binding là đang **ghi vào database production qua một Worker production**. Vì vậy login/consent E2E trong Preview **không** dùng dependency mode A ([`02` §5.3](../../overview/02-delivery.md)).

## 3. Data model — `db-account`

Greenfield: **không có** schema hay migration history `db-identity` nào để kế thừa ([`overview/01-architecture.md`](../../overview/01-architecture.md) §4). Dưới đây là **logical specification** — định nghĩa ý nghĩa, ràng buộc, vòng đời; **không** phải DDL, không chốt kiểu cột vật lý hay index cụ thể.

Quy ước: `sub` là **opaque, không tái sử dụng, không tái phát hành**; mọi cột thời gian là UTC. Kiểu vật lý và index chốt ở migration, mỗi index phải gắn với một truy vấn hoặc ràng buộc cụ thể — không thêm index "cho chắc".

### 3.1 Sơ đồ quan hệ

```text
users 1───1 user_profiles
  │ 1
  ├───* email_addresses          (nhiều email; ≥1 verified để đăng nhập được; tra cứu theo address_hash)
  ├───1 password_credentials     (điều kiện — chỉ khi password auth được bật)
  ├───* authenticators           (passkey | totp — một bảng, discriminator)
  ├───* account_sessions         (mỗi device/mỗi lần đăng nhập)
  ├───* login_handoffs            (handle X ↔ session nào đã trình nó; §3.6)
  ├───1 user_preferences
  ├───1 notification_preferences
  ├───* privacy_requests         (export | correct | delete | restrict | object)
  └───* account_outbox_events    (event sang auth)

email_addresses        (chủ sở hữu dữ liệu email; §3.7)
otp_challenges         (kho challenge OTP, không FK tới email_addresses; §3.7)
security_events        (audit, ghi append-only, không FK tới users để giữ được sau tombstone)
privacy_notices        (version + nội dung đã phát hành)
privacy_acknowledgements  (user đã nhận version nào)
legal_consents         (cơ sở pháp lý cụ thể, KHÁC oauth consent)
```

### 3.2 Entity

| Entity                                         | Mục đích và trạng thái                                                                                                                   | Ràng buộc chính                                                                                                                                                                                                                                       | Dữ liệu nhạy cảm                                        | Vòng đời                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------- |
| `users`                                        | Subject và trạng thái account: `active` \| `suspended` \| `deleted`                                                                      | `sub` UNIQUE, không tái phát hành; `deleted` là **tombstone**, giữ `sub` để token cũ không resolve nhầm sang người khác                                                                                                                               | `sub` (pseudonymous, nhưng là khóa nối mọi record khác) | Nhóm (1) tombstone — duy nhất giữ lâu dài, xem §7.1 |
| `user_profiles`                                | Tên hiển thị, avatar, thông tin hồ sơ do user chủ động nhập                                                                              | 1:1 `users`                                                                                                                                                                                                                                           | Có — tên/ảnh là personal data                           | Theo account                                        |
| `user_emails` / `email_addresses`              | Email + trạng thái xác minh: `pending` \| `verified` \| `revoked`                                                                        | ≥1 `verified` mới đăng nhập được bằng email; UNIQUE trên email đã verify. Tên bảng vật lý là `email_addresses` (migration 0005), tra cứu theo `address_hash`, **không** theo địa chỉ trần (§3.7)                                                      | Có — high                                               | Theo account                                        |
| `password_credentials`                         | Hash mật khẩu                                                                                                                            | **Chỉ tồn tại khi password auth bật**; hash chậm + salt; **không** lưu reversible                                                                                                                                                                     | Có — cao                                                | Theo account                                        |
| `authenticators`                               | Passkey credential và TOTP. Passkey: credential id public, counter, kỳ thọ. TOTP: **secret mã hoá ở tầng ứng dụng**, không lưu plaintext | Mỗi loại một discriminator; passkey credential id UNIQUE; counter phải đơn điệu để phát hiện clone                                                                                                                                                    | Có — rất cao (TOTP secret là bearer tới MFa)            | Có thể thu hồi độc lập                              |
| `recovery_codes`                               | Mã dự phòng khi mất MFA                                                                                                                  | Hash; **single-use**; đếm số lần dùng                                                                                                                                                                                                                 | Có — cao                                                | Bị consume khi dùng                                 |
| `account_sessions`                             | Phiên cookie trình duyệt                                                                                                                 | **Chỉ lưu hash session identifier**, không lưu giá trị cookie; `expires_at`; `revoked_at`; `acr` + `authn_at` (mức xác thực và thời điểm xác thực, để đo tuổi bằng chứng); `session_ref` (định danh instance session, dùng cho `account_session_ref`) | Có — cao                                                | TTL + thu hồi                                       |
| `user_preferences`                             | Preference cá nhân: `locale`, `timezone`, `color_mode`                                                                                   | Typed columns, **không** JSONB — đây là contract ổn định đọc bởi nhiều service (§3.3)                                                                                                                                                                 | Không nhạy cảm                                          | Theo account — nhóm (2)                             |
| `login_handoffs`                               | Ràng buộc giữa handle X do `auth` cấp và `account_session` nào đã trình nó: state + session đã bind + thời điểm bind                     | `handle_hash` (hash của X, **không** lưu X) UNIQUE; tạo bằng thao tác **atomic**; session đã bind **không** đổi, không session khác ghi đè; `expires_at`; chuyển binding khi session rotate (§3.6)                                                    | Có — cao (định danh một authorization request)          | TTL ngắn, xoá hẳn — nhóm (2)                        |
| `notification_preferences`                     | Kênh nào được phép gửi cho user                                                                                                          | Ranh giới với `push-notification` (§3.4)                                                                                                                                                                                                              | Có (hành vi)                                            | Theo account — nhóm (2)                             |
| `security_events`                              | Audit đăng nhập: thành công/thất bại, IP, user-agent, lý do                                                                              | **Append-only**; không lưu password/token; IP + user-agent là personal data                                                                                                                                                                           | Có                                                      | Nhóm (3) — retention **mở**, xem §7.1               |
| `privacy_requests`                             | Yêu cầu data subject: `export` \| `correct` \| `delete` \| `restrict` \| `object`; trạng thái + deadline                                 | Có `subject_sub` (opaque, **không FK logic** — đây là chính nó); deadline theo luật                                                                                                                                                                   | Có — cao                                                | Nhóm (3) — theo quy trình, xem §7.1                 |
| `privacy_notices` / `privacy_acknowledgements` | Version notice đã phát hành và user đã nhận                                                                                              | ACK gắn version; **KHÁC** `legal_consents`                                                                                                                                                                                                            | Có                                                      | Theo chính sách — xem §7.1                          |
| `legal_consents`                               | Cơ sở pháp lý cụ thể (vd. điều khoản, xử lý dữ liệu nhạy cảm)                                                                            | Ghi `basis`, `policy_version`, `given_at`, `withdrawn_at`; **KHÁC** OAuth consent (`db-auth`)                                                                                                                                                         | Có                                                      | Nhóm (3) — retention **mở**, xem §7.1               |
| `account_outbox_events`                        | Event sang `auth`, ghi **cùng transaction** với state đổi                                                                                | Idempotency key UNIQUE; `published_at`, `attempts`                                                                                                                                                                                                    | Không                                                   | Dọn sau publish + retention                         |

⚠️ **Cột "Vòng đời" ở trên dùng nhãn nhóm của §7.1, không phải một cam kết thời hạn.** `Nhóm (1)` là tombstone tối thiểu và là thứ **duy nhất** được phép giữ lâu dài; `Nhóm (2)` bị xoá hoặc anonymize khi account bị xoá; `Nhóm (3)` có retention **riêng và còn mở** — chưa chốt, và việc giữ nó **chưa** được biện minh bằng nghĩa vụ cụ thể. Không entity nào ngoài tombstone được ghi là "vĩnh viễn"; chi tiết và lý do → §7.

### 3.3 `user_preferences` — vì sao typed column, không phải JSONB

Ba trường này được đọc bởi **nhiều** service qua contract, và chúng là **contract ổn định**: frontend khác locale, `llm-*`, `backoffice` đều dựa vào chúng. JSONB với key tự do biến một typo thành lỗi runtime im lặng ở tầng consumer và biến schema thành hợp đồng không kiểm soát được. Typed column ép validate ở tầng ghi và cho index được.

| Trường       | Kiểu logic                         | Validate                                                             | Default                                                      | Ảnh hưởng khi đổi                         |
| ------------ | ---------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------- |
| `locale`     | enum `en` \| `vi`                  | Chỉ nhận giá trị trong allowlist; **reject**, không fallback im lặng | Theo `Accept-Language` lúc tạo account, hợp lệ với allowlist | Đổi ngôn ngữ hiển thị; không đụng dữ liệu |
| `timezone`   | IANA TZ name (`Asia/Ho_Chi_Minh`)  | Validate theo tz database; reject tên không có                       | `Asia/Ho_Chi_Minh`                                           | Đổi cách hiển thị thời gian               |
| `color_mode` | enum `system` \| `light` \| `dark` | Enum đóng                                                            | `system`                                                     | Đổi theme                                 |

⚠️ **Không trùng với timezone nghiệp vụ.** `user_preferences.timezone` là thiết lập cá nhân của identity (timezone máy người dùng đang ở). Một trường kiểu "timezone giao dịch" của business thuộc service sở hữu nghiệp vụ đó, **không** đọc từ `db-account` — nó là quyết định nghiệp vụ, không phải thiết lập hiển thị. Service nghiệp vụ nhận `timezone` qua contract nếu user muốn dùng làm mặc định, và tự lưu bản riêng.

Contract (`GET`/`PATCH /account/preferences`) → [`02-requirements.md`](./02-requirements.md) FR-008.

### 3.4 Ranh giới với `notification_preferences`

`notification_preferences` chỉ ghi **ý định của user** (kênh nào được phép gửi, tần suất mong muốn). Nó **không** phải danh sách thiết bị, subscription hay delivery state — những thứ đó thuộc `push` (D1) và `web-push-notification-job` ([`01` §4](../../overview/01-architecture.md)). `account` không đọc D1 của service khác và không ghi vào đó; intent được đưa sang qua event/contract.

### 3.5 Cross-service reference

`db-auth` lưu `sub` của user. Đó là **tham chiếu opaque không có foreign key** — `account` không giữ FK trỏ sang `db-auth` (không tồn tại), và không FK trỏ tới bảng "user" của `db-auth` vì nó không có bảng đó. Toàn vẹn tham chiếu chéo là **responsibility của contract**, phát hiện bằng reconciliation ([`../auth/03-operations.md`](../auth/03-operations.md)).

### 3.6 `login_handoffs` — vì sao cần state bền vững, và vì sao nó không đủ một mình

⚠️ **Bản trước không có entity nào giữ quan hệ "handle X ↔ session nào đã trình nó".** Ràng buộc đó được mô tả bằng lời trong §5.1 mà không có nơi lưu, nên nó không hiện thực được: hai request cùng trình X sẽ không có gì để so sánh, và "first-binding-wins" không có nghĩa gì khi không có "first". `login_handoffs` là nơi duy nhất quan hệ đó tồn tại.

**Định nghĩa logic** (không phải DDL — kiểu cột vật lý và index chốt ở migration):

| Trường        | Ý nghĩa                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| `handle_hash` | Hash của handle X. **Không lưu X dạng rõ** — X đến từ query string và có thể lọt vào log của tầng trung gian |
| `session_ref` | `account_session_ref` của session **đã trình X lần đầu**                                                     |
| `bound_at`    | Thời điểm binding được tạo — dùng để trả lời "ai đã bind trước" khi có tranh chấp                            |
| `state`       | `bound` → `consumed` \| `session_rotated` \| `expired` (§3.6.2)                                              |
| `expires_at`  | TTL ngắn, bằng TTL transaction phía `auth`                                                                   |

⚠️ **`session_ref` ở đây là con trỏ tới một session, không phải credential.** Nó không được dùng để xác thực ai cả; nó chỉ để so khớp "session đang xử lý X có phải đúng session đã bind X không" (§4).

#### 3.6.1 First-binding-wins phải atomic, và nó là chốt chặn chống **ghi đè**

| Tình huống                               | Kết quả bắt buộc                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Session S1 trình X, chưa có binding      | Tạo binding `X → S1`                                                                                                 |
| **Hai session trình X lần đầu cùng lúc** | **Đúng một** binding thắng; request kia thua và nhận định danh của session đã bind — **không** có request nào ghi đè |
| Session S1 trình X lại (retry)           | Idempotent: trả về binding của S1, không tạo bản ghi thứ hai                                                         |
| Session S2 trình X khi đã bind S1        | Từ chối; **không** ghi đè S1                                                                                         |
| X hết TTL / đã consume                   | `invalid_request`; **không** có đường gia hạn âm thầm                                                                |

⚠️ **"First-binding-wins" chỉ là một thuộc tính của ràng buộc UNIQUE, không phải một quy tắc kiểm tra.** Điều kiện cần giữ là: **chỉ một thao tác atomic duy nhất tạo được bản ghi**; mọi thao tác sau đó là so khớp, không phải ghi. Nếu implementation đọc-rồi-ghi thay vì insert có điều kiện, hai request song song sẽ cùng thấy "chưa có" và cùng ghi — và toàn bộ tính chất trên biến mất.

#### 3.6.2 Session rotation phải chuyển binding, không được làm rơi

Đăng nhập thành công thường **rotate session** (`session_ref` cũ bị thu hồi, `session_ref` mới được cấp) — đúng để chống session fixation. Nhưng X đã bind vào session _trước xác thực_.

⚠️ **Nếu không chuyển binding, login sẽ hỏng: X bị bind vào session đã bị thu hồi, và bước xác thực sẽ không khớp với bản ghi nào.** Nếu chuyển _không kiểm soát_, session thứ ba có thể thừa kế X. Vì vậy chuyển binding là **một thao tác atomic duy nhất**, trong đúng transaction xoay session:

1. Ghi state `session_rotated`, trỏ `session_ref` sang session mới.
2. Session cũ bị thu hồi bởi chính transaction xoay đó.
3. Session mới **kế thừa** binding; không có đường nào để session khác chiếm X giữa hai bước này.

Sau khi xác thực thành công và handoff được dùng, state chuyển `consumed` và bản ghi hết hiệu lực.

#### 3.6.3 ⚠️ First-binding-wins **không** chống được pre-binding — và đó là ranh giới của nó

⚠️ **Đây là điểm mà bản trước im lặng và cần nói rõ.** `login_handoffs` chỉ chặn việc **ghi đè** binding. Nó **không** chứng minh được rằng session đầu tiên bind là session của người dùng hợp lệ:

> Attacker lấy X **trước** (qua referrer, log, history, shoulder-surfing), mở nó bằng **session của chính hắn**, bind thành công vì chưa có ai bind. Các request sau đó của nạn nhân — kể cả nạn nhân — đều bị từ chối vì binding đã thuộc session khác. First-binding-wins **chạy đúng như thiết kế** và vẫn thất bại.

Vì vậy `login_handoffs` là **lớp bảo vệ thứ nhất, không phải lớp duy nhất**, và nó **không đủ một mình**. Lớp thứ hai nằm ở `auth`: transaction gắn với cookie `__Host-auth-browser` mà chính `auth` cấp cho trình duyệt đã nhận `302` từ `/authorize`, và `POST /internal/session/verified` bị từ chối nếu transaction chưa `browser_confirmed` ([`../auth/01-architecture.md`](../auth/01-architecture.md) §5.3). Attacker có X **và** session riêng vẫn không có cookie đó.

**Hai lớp phải cùng tồn tại.** Thiết kế chỉ còn `login_handoffs` thì hở pre-binding; chỉ còn lớp của `auth` thì vẫn để một session bất kỳ đẩy kết quả xác thực cho một transaction nó không khởi tạo.

### 3.7 Đăng nhập email-OTP — hai entity và các ràng buộc đã chốt trong migration

Luồng đăng nhập phương thức duy nhất hiện có là **email-OTP** (`apps/account/server/api/auth/{challenge,verify,session,logout}`). Hai bảng dưới đây có migration thật (`0005`, `0006`) và được integration test phủ; mô tả dưới đây phản chiếu ràng buộc đã chốt trong migration, không phải ý định.

**`email_addresses` (0005) — chủ sở hữu dữ liệu email.** Email là **credential liên lạc + đăng nhập**, không bao giờ là OIDC `sub` (FR-002). Điểm khác so với entity `user_emails` ở bảng trên: bảng giữ thêm `address_hash` (SHA-256 hex của địa chỉ đã normalize) làm **khoá tra cứu** của luồng OTP — index không chứa địa chỉ trần. Chỉ `status = verified` mới nhận OTP đăng nhập. ⚠️ Đường cấp email cho user (thêm/verify qua UI) **chưa có** — tới lúc đó luồng OTP chỉ đăng nhập được địa chỉ được seed thủ công.

**`otp_challenges` (0006) — kho challenge, không lưu mã OTP.** Bảng chỉ giữ `HMAC-SHA256(key, purpose || ':' || code)` (digest hex 64), key là Worker Secret `NUXT_OTP_HMAC_SECRET` — cùng hình dạng "chỉ lưu dẫn xuất" với `account_sessions.id_hash`. Ba ràng buộc đáng chú ý:

| Ràng buộc                                                                   | Hiện thực                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Một challenge active cho mỗi `(address, purpose)`                           | Partial UNIQUE index `(address_hash, purpose) WHERE consumed_at IS NULL`; resend phải consume challenge cũ trong cùng transaction                                                                                                                                                                                                     |
| Challenge cấp được cả cho địa chỉ **chưa tồn tại** trong DB                 | Không FK sang `email_addresses` — anti-enumeration trả lời như nhau và vẫn ghi challenge ma cho địa chỉ lạ (đó chính là rate-limit)                                                                                                                                                                                                   |
| Rate limit đếm từ chính bảng này                                            | 3/15 phút và 10/giờ per `address_hash` — reconstructible từ durable state, không bảng rate-limit riêng, không bộ nhớ cục bộ Worker                                                                                                                                                                                                    |
| Challenge hết hạn bị **khoá nguyên tử**, không để "ở trạng thái active mãi" | `expireChallengeIfExpired` — một `UPDATE ... SET consumed_at WHERE consumed_at IS NULL AND expires_at <= $now` đơn câu; route `verify` gọi ở nhánh hết hạn. Mốc thời gian do caller truyền (không phải `now()` DB) để hai đồng hồ Worker/DB lệch nhau không đổi kết quả của TTL. Chi tiết vòng đời → `apps/account/server/lib/otp.ts` |
| Trần số lần thử tăng **nguyên tử trong SQL**                                | `recordFailedAttempt` là `SET attempts = attempts + 1 WHERE consumed_at IS NULL RETURNING attempts` — không read-then-write; đồng thời không request nào mua được một lần dư                                                                                                                                                          |
| Verify là CAS                                                               | `consumeChallenge` chỉ khớp khi `consumed_at IS NULL` — replay một mã đã dùng không tạo session thứ hai                                                                                                                                                                                                                               |

Tham số OTP (TTL 600 giây, resend cooldown 60 giây, tối đa 5 lần thử, mã 8 chữ số) nằm ở `apps/account/server/lib/otp.ts`; giới hạn gửi mail qua `transactional-mail` tại `apps/account/server/lib/mail.ts` (`POST /v1/messages`, timeout 3 giây, chưa provision service thật).

### 3.8 Mô hình assurance — ACR thay thang bậc `authn_level`

Mức xác thực của session được ghi dưới dạng **ACR URN** (`urn:ecoma:acr:*`), không còn thang bậc tuyến tính `authn_level` (migration `0004` đổi tên cột `account_sessions.authn_level` → `acr`). Model set-membership (`libs/identity-domain/src/acr.ts`, chính sách ở mục này — file code chỉ giữ hằng và phép kiểm tập):

| URN                                | Nghĩa                                                               | Quan hệ kéo theo                                                  |
| ---------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `urn:ecoma:acr:email-otp`          | Đã xác thực bằng email-OTP (phương thức đăng nhập duy nhất hiện có) | Không kéo theo gì — OTP một yếu tố **không** tự thành MFA         |
| `urn:ecoma:acr:mfa`                | OTP **cộng thêm** một yếu tố thứ hai (TOTP hoặc Passkey)            | Kéo theo `email-otp`                                              |
| `urn:ecoma:acr:phishing-resistant` | Yếu tố thứ hai là **Passkey/WebAuthn**                              | Kéo theo `mfa` (TOTP shareable-secret **không** kéo theo URN này) |

Kiểm tra "session đủ assurance cho hành động X" là phép **thuộc tập**: tập ACR của session phải **chứa** ACR yêu cầu (`acrSatisfies`). Không có rank, không suy diễn xuôi/ngược; tập được tính từ bằng chứng bằng `acrSetFor`, nơi gọi không tự ghép URN tay. ACR của session đi vào payload `POST /internal/session/verified` (`libs/identity-contracts/src/session-verified.ts`) và được `auth` bind vào transaction rồi đưa vào ID token dưới claim `acr`.

## 4. Session và cookie security

| Thuộc tính            | Giá trị                                                                                                                                             | Vì sao                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Tên cookie            | `__Host-` prefix                                                                                                                                    | Browser chỉ chấp nhận khi `Secure`, `Path=/`, **không** `Domain` → không thể bị subdomain khác ghi đè                                       |
| `Secure`              | bắt buộc                                                                                                                                            | `__Host-` bắt buộc; chặn gửi qua HTTP thường                                                                                                |
| `HttpOnly`            | bắt buộc                                                                                                                                            | Chặn đọc bằng JS → giảm tác động của XSS                                                                                                    |
| `SameSite`            | `Lax`                                                                                                                                               | Đủ cho top-level GET redirect từ `auth`. `None` mở CSRF cross-site — không dùng                                                             |
| CSRF                  | Token gắn với session cho **mọi** request đổi state; kiểm ở BFF                                                                                     | `SameSite=Lax` **không** bảo vệ được POST cross-site trong mọi trường hợp                                                                   |
| Giá trị cookie        | **random ≥ 256 bit**, chỉ hash được lưu                                                                                                             | Không lưu giá trị → mất `db-account` không tạo session giả                                                                                  |
| Rotation              | **Tại thời điểm xác thực thành công**, trước khi sinh bất kỳ bằng chứng nào                                                                         | Chống session fixation: không bao giờ thừa kế session id có sẵn, kể cả anonymous                                                            |
| `account_session_ref` | Opaque, `account` sinh tại thời điểm xác thực, định danh **instance của session đã xác thực**; **không** phải cookie và **không** dùng để đăng nhập | Cho `auth` ràng buộc toàn bộ transaction vào **đúng** session đã xác thực — [`../auth/01-architecture.md`](../auth/01-architecture.md) §5.3 |
| Reauthentication      | Hành động nhạy cảm yêu cầu `acr` và `authn_at` **đủ mới**, không suy ra từ tuổi session                                                             | Cookie sống lâu không đồng nghĩa bằng chứng đủ mới                                                                                          |

⚠️ **Không có cookie session dùng chung `.ecoma.io`.** Mỗi hostname có cookie scope riêng (`01` §6). `account` không đọc được cookie của `auth` hay `home`, và ngược lại — đây là điều kiện để tách blast radius XSS.

## 5. Contract

`account` là **provider** của hai contract (trong đó một cái là BFF cho browser), và **consumer** của hai contract.

⚠️ **Hướng gọi đọc là `consumer → provider`.** Service gọi là consumer; service sở hữu route và xử lý là provider.

| Contract                          | Consumer  | Provider  | Nội dung                                                                                   | Ghi chú                                                                                                                                                                                                   |
| --------------------------------- | --------- | --------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BFF account API                   | Browser   | `account` | Account, profile, email, preferences, session list/revoke, connected apps, privacy request | Không phải public API — không có versioning `oasdiff`                                                                                                                                                     |
| `POST /internal/session/verified` | `account` | `auth`    | Kết quả xác thực session + danh tính lấy từ session của `account`                          | Back-channel **đẩy** sang `auth`, đã xác thực — [`../auth/01-architecture.md`](../auth/01-architecture.md) §5.1                                                                                           |
| `GET /authorize/confirm`          | Browser   | `auth`    | Xác nhận browser là bên khởi tạo transaction, bằng cookie `__Host-auth-browser`            | **Không** phải contract của `account` — `account` chỉ `302` browser tới đó; cookie thuộc origin `auth`, không trộn với cookie `account` ([`../auth/01-architecture.md`](../auth/01-architecture.md) §5.3) |
| `GET /authorize/complete`         | Browser   | `auth`    | Hoàn tất authorization → success hoặc OAuth error tới `redirect_uri` đã đăng ký            | **Không** phải contract của `account` — `account` chỉ `302` browser tới `continue_url` mà `auth` cấp ([`../auth/01-architecture.md`](../auth/01-architecture.md) §5.1.4)                                  |
| `POST /internal/consent/context`  | `account` | `auth`    | Client name, scope đã yêu cầu, mức rủi ro                                                  | `account` **render** từ đây, không đọc `db-auth`; payload có cấu trúc nên là `POST`, không phải `GET` — [`../auth/01-architecture.md`](../auth/01-architecture.md) §5.7                                   |
| `POST /internal/consent/decide`   | `account` | `auth`    | Quyết định approve/deny + session ref đã xác minh                                          | `auth` tự bind vào transaction của nó — [`../auth/01-architecture.md`](../auth/01-architecture.md) §5.5                                                                                                   |
| `GET /internal/account/status`    | `auth`    | `account` | Trạng thái account tối thiểu                                                               | Đọc authority trong `db-account`; `auth` hỏi lúc phát hành — §6.0 của auth                                                                                                                                |

⚠️ **`account` là provider của contract status, không phải consumer.** Route `/internal/account/status` thuộc `account` vì `account` là bên sở hữu trạng thái; `auth` là bên gọi. Đây là hướng ngược lại với ba contract back-channel mà `account` đẩy đi.

### 5.1 Hai loại contract — không trộn

|              | **BFF (browser-facing)**                      | **Internal (service-to-service)**                                 |
| ------------ | --------------------------------------------- | ----------------------------------------------------------------- |
| Ai gọi       | Browser qua cookie `account.ecoma.io`         | Service khác qua Service Binding                                  |
| Xác thực     | Cookie + CSRF token                           | **Envelope HMAC** — signature + timestamp + nonce, không cookie   |
| Xác thị thần | Session của browser                           | `sub` truyền trong request, phải được ràng buộc                   |
| Trả gì       | Preference của **chính người đang đăng nhập** | Preference của `sub` được chỉ định                                |
| Endpoint     | `GET`/`PATCH /account/preferences`            | `GET /internal/account/preferences?sub=`                          |
| Rủi ro chính | CSRF, session hijack                          | **Đọc chéo user** — service nào cũng hỏi được về bất kỳ `sub` nào |

⚠️ **Internal contract dùng envelope HMAC, không dựa vào Service Binding.** Đối chiếu tài liệu Cloudflare: **không có** header, request property hay cơ chế nào cho Worker phân biệt request qua Service Binding với request từ internet; mô hình chính thức là **isolation, không phải verification** — giữ Worker đích không reachable từ internet. `account` không áp dụng được mô hình đó vì phải phục vụ BFF công khai trên chính Worker đó. Cloudflare cũng nói rõ không được coi lời gọi downstream là đã xác thực bởi Access context của caller. Bằng chứng và hệ quả → [`04-implementation.md`](./04-implementation.md).

Envelope ký trên `method + path + timestamp + nonce + body-hash`, kiểm bằng so sánh thời gian hằng, có cửa sổ skew và chống replay trong cửa sổ đó bằng một nonce chiếm vào kho bền vững; thiếu header → `401`, kho nonce không gọi được → `503`. Định dạng, quy tắc canonical, retention và taxonomy lỗi có **một** nguồn sự thật: [`../auth/01-architecture.md`](../auth/01-architecture.md) §5.1.8, cài đặt ở `libs/identity-contracts`. Service Binding vẫn là **đường đi được khuyến nghị** (không cần public route, không tốn egress), nhưng nó là tối ưu hóa đường đi chứ **không phải** cơ chế xác thực — không có Service Binding nào thay được signature.

⚠️ **Đây là hai contract tách biệt, không phải một.** Endpoint BFF phải **bỏ qua** mọi tham số `sub` do client gửi và luôn đọc subject từ session — nếu không, attacker chỉ cần thêm `?sub=<của người khác>` là đọc được preference người khác. Endpoint internal thì ngược lại: **không** nhận cookie, và phải kiểm caller được phép hỏi `sub` đó.

| Yêu cầu                  | BFF                                                           | Internal                             |
| ------------------------ | ------------------------------------------------------------- | ------------------------------------ |
| Subject lấy từ đâu       | Session (bỏ qua mọi `sub` trong request)                      | Tham số `sub`, đã xác thực là caller |
| Chống đọc chéo user      | Bỏ qua `sub` trong query/body                                 | Allowlist service được hỏi `sub` đó  |
| Chống đọc theo enum      | Rate limit + audit                                            | Audit mọi lần đọc theo `sub`         |
| Trả về khi không tồn tại | `404` cho session, không tiết lộ `sub` khác tồn tại hay không | `404`                                |

⚠️ **Internal contract là điểm nhạy cảm nhất của cả hệ thống:** nó cho phép một service hỏi preference của bất kỳ `sub` nào. Vì vậy nó **không** được là public endpoint, phải có envelope HMAC hợp lệ, và mọi lần đọc phải audit. Không có service nào được hỏi bằng internal contract rồi tự phục vụ browser — browser luôn đi qua BFF.

⚠️ **`account` chỉ relay `continue_url`, không dựng nó.** Nó nhận URL tuyệt đối do `auth` cấp trong response và `302` browser tới đó — không tự ghép chuỗi, không thêm tham số, không render nội dung của nó. Đây là điều kiện chống open redirect: `auth` là bên duy nhất dựng URL từ origin đã cấu hình ([`../auth/01-architecture.md`](../auth/01-architecture.md) §5.1.1).

⚠️ **`account` không được gửi `client_id`, `redirect_uri` hay `scope`** trong payload hoàn tất. Bỏ chúng khỏi payload làm transaction substitution bất khả thi **về mặt cấu trúc**, mạnh hơn là kiểm tra thêm sau khi nhận ([`01` invariant 28](../../overview/01-architecture.md)).

⚠️ **`account_session_ref` phải lấy từ session của chính `account`, không lấy từ request.** `account` **không** nhận `account_session_ref` từ browser rồi forward nguyên xi — nếu nhận, attacker gửi `account_session_ref` của nạn nhân là đẩy được kết quả xác thực hoặc quyết định consent dưới tên họ. Mọi payload trong bảng trên điều suy ra từ session đã xác thực ở BFF, và `account_session_ref` phải so khớp `sub` trong `db-account` trước khi gửi đi. Đây là cùng nguyên tắc với dòng "Subject lấy từ đâu" trong bảng §5.1.

⚠️ **Ba contract trong bảng trên phải đi qua Service Binding đã xác thực, và phải dùng `POST` khi payload có cấu trúc.** `POST /internal/consent/context` là ví dụ rõ nhất: continuation handle và session reference **không được nằm trong URL** — chúng lọt vào access log, `Referer` và lịch sử proxy. Không contract nào trong bảng này được phép trở thành public endpoint hay để browser gọi trực tiếp.

## 6. Vòng đời account

`account` giữ **authoritative state**; thay đổi được ghi ở đây **ngay**, không đợi `auth`.

| Sự kiện               | Hành vi trong `db-account`                                                                                                    | Lan sang `auth`                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Suspend**           | `users.status = suspended`; thu hồi **mọi** `account_sessions`; chặn đăng nhập mới                                            | Outbox event, idempotent; `auth` cũng kiểm tra khi phát hành |
| **Reactivate**        | `status = active`; user phải đăng nhập lại                                                                                    | Grant cũ **không** tự sống lại — phải consent lại            |
| **Credential change** | Ghi credential mới; thu hồi session khác; nếu đổi email/mật khẩu → yêu cầu reauthentication                                   | Outbox event (phát hiện bất thường)                          |
| **Delete**            | Soft delete → `sub` thành tombstone, **không** tái phát hành; thu hồi session; xoá/anonymize dữ liệu chức năng theo retention | Outbox event; `auth` thu hồi grant và token                  |
| **Identifier reuse**  | **Cấm** tuyệt đối                                                                                                             | `sub` tombstone giữ nguyên giá trị                           |

Cơ chế lan sang `auth` — transactional outbox, idempotency key, retry, reconciliation, partial failure → [`../auth/01-architecture.md`](../auth/01-architecture.md) §7.

⚠️ **Truyền trạng thái sang `auth` là best-effort, nên kiểm tra tại thời điểm phát hành là chốt chặn cuối.** `auth` không được cấp token cho `sub` mà nó biết là suspended/deleted, bất kể đã nhận event hay chưa. ⚠️ **Bảo đảm này có điều kiện thời điểm**: một lần phát hành đã đọc `active` trước khi commit suspend/delete vẫn có thể phát hành sau commit đó. Kiến trúc hai database hiện tại **không** bảo đảm "không token nào thành công sau khi suspend commit"; ngữ nghĩa đầy đủ và decision gate còn mở nằm ở [`../auth/01-architecture.md`](../auth/01-architecture.md) §6.0 rule 1–5. Số staleness tối đa chấp nhận được là quyết định chưa chốt ([`overview/01-architecture.md`](../../overview/01-architecture.md) §10).

## 7. Xoá account, anonymize và retention

⚠️ **"Giữ vĩnh viễn" không phải retention đã được biện minh.** Ba nhóm dữ liệu dưới đây có cơ sở giữ khác nhau, và chỉ một nhóm mới thật sự cần giữ lâu dài. Mọi khoảng thời gian cụ thể là **quyết định chưa chốt** — xem [`../account/02-requirements.md`](../account/02-requirements.md) §6 và [`../../overview/03-operations.md`](../../overview/03-operations.md) §10.

### 7.1 Ba nhóm, ba cách xử lý

| Nhóm                        | Ví dụ                                                                                     | Xử lý khi user xoá account                        | Cơ sở giữ                                                        | Vì sao                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **(1) Tombstone tối thiểu** | `users.sub`, `users.status = deleted`, thời điểm xoá                                      | **Giữ lại**, chỉ giữ đúng những cột này           | Kỹ thuật, **không** phải lợi ích người dùng                      | Chống tái sử dụng `sub` và chống token cũ resolve nhầm sang người khác. Không chứa nội dung nào đọc được về con người |
| **(2) Dữ liệu chức năng**   | Profile, email, preferences, notification preferences, session, authenticator, credential | **Xoá hoặc anonymize**                            | Không có                                                         | Vì mục đích đã hết; giữ lại không có lý do                                                                            |
| **(3) Audit và bảo mật**    | `security_events`, `privacy_requests`, `legal_consents`, `privacy_acknowledgements`       | **Theo retention riêng**, có thể giữ hơn nhóm (2) | Nghĩa vụ pháp lý và chống gian lận — **cần xác minh**, chưa chốt | Xoá sạch thì mất dấu vết truy cết; nhưng IP + user-agent là personal data nên không thể giữ mãi                       |

⚠️ **Nhóm (1) là nhóm duy nhất được giữ "vĩnh viễn", và chỉ vì lý do kỹ thuật.** Nó không phải lợi ích người dùng, không phải phân tích, không phải marketing. Nếu `users` giữ thêm cột nào nữa sau khi xoá, cột đó phải được biện minh riêng — mặc định là anonymize.

#### Tombstone là pseudonymous, không phải ẩn danh

⚠️ **`sub` không phải dữ liệu "không nhận diện được".** Nó là pseudonymous: bản thân nó không chứa tên hay email, nhưng vẫn là **khoá nối mọi record khác** của cùng một người (nhóm 2 và 3 ở trên). Giữ nó lâu dài nghĩa là **giữ khả năng nối lại** các bản ghi đó về một chủ thể duy nhất — kể cả sau khi dữ liệu chức năng đã bị xoá. Vì vậy:

| Câu hỏi                                               | Trả lời hiện tại                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ai được đọc tombstone?**                            | Chỉ các đường nội bộ cần nó để từ chối identifier tái sử dụng và để từ chối token cũ resolve. **Không** có đường đọc lấy hồ sơ; mọi đường đều trả về tối thiểu và audit lại theo `sub`                                                                                                                                             |
| **Rủi ro tái liên kết là gì?**                        | Nếu sau này có thêm một bảng nào đó nối `sub` với dữ liệu đã anonymize, thì anonymize trở nên vô nghĩa — dữ liệu đã "không nhận diện" lại quay về nhận diện được qua `sub`. Đây là lý do `sub` phải là **mục tiêu tái liên kết duy nhất**, không phải một trong nhiều                                                              |
| **Tái phát hành `sub` có xoá được rủi ro này không?** | ⚠️ **Không — và đây là điểm dễ hiểu sai nhất.** Cấp `sub` mới **không** xoá khả năng liên kết từ `sub` **cũ** tới bản ghi lịch sử hay dữ liệu còn giữ ở service khác; nó chỉ làm giá trị mới không nối được với giá trị cũ nữa. Nếu `sub` cũ vẫn xuất hiện trong `db-auth`, audit hay bất kỳ kho nào khác, thì liên kết đó vẫn còn |

**Đánh đổi phải nói thẳng, không được gọi là đã giải quyết:** giữ `sub` trong tombstone ngăn `sub` cũ bị gán cho account mới — **nhưng** đó chính là điều duy trì khả năng nối các bản ghi mang `sub` đó. Hai mục tiêu này **không thể cùng đạt** bằng thiết kế hiện tại.

**Biện pháp giảm rủi ro tái liên kết** tập trung vào việc **loại bỏ mapping và record nhận diện không còn cần thiết**, quản lý các kho dữ liệu còn giữ `sub`, và giới hạn quyền truy cập — **không** tuyên bố đạt anonymization chỉ nhờ đổi identifier. Cụ thể:

| Việc                                              | Tác dụng                                               | Giới hạn                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Xoá/anonymize record nhận diện không còn mục đích | Đoạt liên kết giữa `sub` và dữ liệu chức năng còn lại  | Không chạm tới `sub` trong nhóm (3) hoặc ở `db-auth`                                             |
| Quản lý kho dữ liệu còn giữ `sub`                 | Biết **có bao nhiêu** kho còn giữ `sub` và ai được đọc | `db-auth` giữ `sub` vì contract, không vì lợi ích người dùng — không xoá được với lý do kỹ thuật |
| Hạn chế quyền truy cập theo `sub`                 | Thu hẹp vùng có thể tái liên kết                       | ⚠️ Không triệt tiêu rủi ro; chỉ làm nó khó hơn                                                   |

⚠️ **Việc tái phát hành `sub` là một câu hỏi chính sách chưa giải quyết, và task này không tự quyết nó.** Tái phát hành `sub` **mâu thuẫn** với yêu cầu token cũ không resolve nhầm sang người khác (§7.5) — nếu `sub` cũ có thể resolve sang người mới thì một token cũ kia sẽ cấp quyền cho người đã bị xoá. Vì vậy nó **không được** coi là cách sửa mặc định và **không** được bật khi chưa quyết. Owner: DPO + Security. Trigger: trước khi `sub` được dùng làm khoá nối cho bất kỳ tính năng nào mới. Xem [`../account/02-requirements.md`](./02-requirements.md) FR-012m.

⚠️ **Vì vậy ba câu trên là giới hạn đã biết của thiết kế tombstone, không phải kết luận pháp lý đã được xác minh.** Ở mức tối thiểu hiện tại, việc giữ tombstone **không** thu thập thêm dữ liệu cá nhân — nhưng nó **không** xoá được việc dữ liệu đã anonymize trước đó có thể bị nối lại. Không được mô tả `sub` hoặc tombstone là dữ liệu không nhận diện được.

### 7.2 Anonymize khác xoá như thế nào

| Cách              | Nghĩa                                           | Dùng khi                                                                                               |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Xoá**           | Row biến mất hoàn toàn                          | Dữ liệu không còn giá trị với bất kỳ mục đích nào                                                      |
| **Anonymize**     | Giữ cấu trúc và quan hệ, xoá nội dung nhận dạng | Cần giữ tham chiếu, đếm số lượng, hoặc chứng minh một sự kiện đã xảy ra mà không còn gắn với con người |
| **Giữ tombstone** | Giữ khoá định danh tối thiểu                    | Chỉ nhóm (1)                                                                                           |

⚠️ **Anonymize không mặc định là đủ.** Với IP và user-agent, anonymize có thể chỉ là cắt bớt — mức anonymize đủ để không còn là personal data là câu hỏi cần trả lời theo từng trường, và **chưa** có câu trả lời đã xác minh.

### 7.3 Điều không được coi là tự động biện minh

| Điều                                  | Vấn đề                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| "Giữ vĩnh viễn vì có thể cần sau này" | Không phải cơ sở. Cần nghĩa vụ hoặc mục đích đã nêu                             |
| "Audit thì phải giữ mãi"              | Audit là personal data khi còn gắn IP/user-agent. Có thời hạn, và hạn phải chốt |
| "Backup giữ lâu hơn nên xoá vô nghĩa" | Đúng — vì vậy cần quy trình riêng cho backup, xem §7.4                          |
| "Anonymize là xoá"                    | Hai việc khác nhau; xem §7.2                                                    |

### 7.4 Backup và restore — điểm hay bị bỏ sót

⚠️ **Xoá ở database chính KHÔNG xoá trong backup.** Đây là khoảng trống thường bị bỏ sót nhất, và nó có thể làm nghĩa vụ xoá dữ liệu trở nên không thực thi được:

1. Backup được chụp trước khi xoá vẫn chứa dữ liệu cá nhân.
2. Khi restore, dữ liệu đó quay lại.
3. Vì vậy cần: **retention của backup** biết được và có hạn; **quy trình restore** có bước đối chiếu với danh sách `sub` đã xoá; và **kết quả đối chiếu được ghi lại** — nếu không, không ai biết dữ liệu cá nhân nào đã quay lại từ backup.

**Dữ liệu quay lại từ backup không được mặc định coi là hợp lệ.** Sau restore, một row trở lại trong `users` **không** đồng nghĩa với một account còn tồn tại. Nếu `sub` đó có trong tombstone thì nó phải bị xử lý như **tombstone đã quay lại cùng dữ liệu chức năng theo sau nó** — tức là phải xoá hoặc anonymize lại nhóm (2), không phải coi là account hoạt động.

Quy trình đối chiếu, tối thiểu:

| Bước | Việc                                                                                                              | Kết quả phải ghi lại                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1    | Đọc danh sách tombstone **từ nguồn đã được kiểm chứng là còn hiện hành** — không phải từ chính backup vừa restore | Số lượng tombstone dùng làm chuẩn đối chiếu, và nguồn của nó |
| 2    | So **mọi** `sub` có trong dữ liệu vừa restore với danh sách đó                                                    | Danh sách `sub` bị restore lại dù đã xoá                     |
| 3    | Xử lý từng row khớp: xoá hoặc anonymize nhóm (2); **không** mở lại account                                        | Số row đã xử lý, theo từng `sub`                             |
| 4    | Kiểm `db-auth` có bản ghi nào trỏ tới các `sub` đó                                                                | Kết quả reconcile với `db-auth`                              |
| 5    | Ghi kết quả — kể cả khi **không** có dòng nào khớp                                                                | Bằng chứng đã đối chiếu, không chỉ "restore thành công"      |

⚠️ **Không được ghi "restore xong" mà bỏ qua bước đối chiếu.** Một restore thành công về mặt kỹ thuật có thể đã hồi sinh dữ liệu đã xoá; nếu không ghi kết quả đối chiếu thì không ai biết điều đó có xảy ra hay không. Bước 5 tồn tại để biến "không chắc" thành một câu trả lời có thể kiểm chứng.

Reconciliation sau restore → [`03-operations.md`](./03-operations.md) §9.2.

### 7.5 Ràng buộc

1. `sub` không tái sử dụng, không tái phát hành; xoá account không giải phóng nó (§9 invariant 7).
2. Xoá account **không** được xoá tombstone `sub`.
3. Nhóm (2) phải xoá hoặc anonymize theo retention đã chốt — **không** có mặc định "giữ".
4. Nhóm (3) giữ theo retention riêng đã chốt; retention này **chưa** được biện minh bằng nghĩa vụ cụ thể.
5. Sau khi xoá, `auth` thu hồi grant và token; `db-auth` giữ `sub` tombstone theo retention của nó ([`../auth/01-architecture.md`](../auth/01-architecture.md) §7).
6. Mỗi service khác tự xoá dữ liệu của mình theo contract; `account` không xoá được dữ liệu ngoài `db-account` ([`02-requirements.md`](./02-requirements.md) FR-013a).
7. Backup restore phải có bước đối chiếu `sub` đã xoá, và kết quả phải được ghi lại (§7.4).
8. Dữ liệu quay lại từ backup **không** được coi là hợp lệ chỉ vì nó đã vào database; row có `sub` nằm trong tombstone phải được xử lý lại như sau khi xoá (§7.4).

## 9. Architectural invariants

1. `account` chỉ đọc/ghi `db-account`. Không đọc `db-auth`, không D1 của service khác, không cross-database query ([`01` invariant 25](../../overview/01-architecture.md)).
2. Credential verifier và browser session **chỉ** tồn tại trong `db-account`. Không trusted identity assertion nào đi qua query parameter ([`01` invariant 27](../../overview/01-architecture.md)).
3. Session identifier chỉ được lưu dạng hash; cookie không có giá trị đọc lại được.
4. Session identifier **rotate tại thời điểm xác thực**, không bao giờ thừa kế session id có sẵn.
5. Mọi request đổi state của BFF kiểm CSRF token gắn với session.
6. Trạng thái account được ghi vào `db-account` **trước**, lan sang `auth` **sau**; không đợi `auth` để ghi.
7. `sub` không tái sử dụng, không tái phát hành; xoá account không giải phóng nó, và tombstone tối thiểu là giữ duy nhất được phép vĩnh viễn (§7).
8. Audit event **append-only**, không lưu secret. Retention riêng, lâu hơn dữ liệu chức năng, **nhưng có hạn** — không phải giữ vĩnh viễn (§7.1).
9. Không log password, session cookie, `code_verifier`, token hay assertion.
10. `account` không implement endpoint protocol OAuth 2.0/OIDC; nó chỉ render UI lấy dữ liệu qua contract.
11. Handle do `auth` cấp được `account` gắn với session trình duyệt **trước** khi xác thực, và chỉ session đó được xác thực ([`../auth/01-architecture.md`](../auth/01-architecture.md) §5.3).
12. Tombstone là dữ liệu **pseudonymous**: nó giữ khả năng nối lại các bản ghi đã anonymize. Vì vậy nó **không** được mô tả là dữ liệu không nhận diện được, và anonymize **không** được coi là đã loại bỏ rủi ro tái liên kết (§7.1).

## 10. Chưa chốt

| Mục                                                                                                                                     | Kích hoạt                 | Ảnh hưởng                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------- |
| **Password auth có bật hay không** — quyết định `password_credentials` và `recovery_codes` tồn tại hay không, và cả luồng quên mật khẩu | Trước schema `db-account` | Hai entity và toàn bộ email flow                                      |
| **MFA bắt buộc hay tuỳ chọn**, và có bật passkey trước TOTP không                                                                       | Trước khi bật login thật  | UX đăng nhập, `acr`                                                   |
| **Staleness tối đa** của trạng thái account mà `auth` chấp nhận                                                                         | Trước tính năng suspend   | [`../auth/01-architecture.md`](../auth/01-architecture.md) §9         |
| **Primitve mã hoá TOTP secret** tầng ứng dụng, và nơi giữ key                                                                           | Trước khi lưu TOTP secret | Đây là secret của người dùng, không phải secret hạ tầng               |
| **Cơ chế relay outbox** (`01` §10)                                                                                                      | Trước tích hợp đầu tiên   | Event sang `auth`                                                     |
| **Rate limit / anti-brute-force** số cụ thể                                                                                             | Trước khi bật login thật  | [`03-operations.md`](./03-operations.md)                              |
| **Retention cụ thể** của `security_events` và audit. Việc _có cần giữ_ đã là câu hỏi pháp lý mở, không phải mặc định giữ (§7.3)         | Trước production          | [`02-requirements.md`](./02-requirements.md) §7.1 (owner + kích hoạt) |
| **Cơ sở pháp lý** cho từng mục inventory, và phạm vi áp dụng của từng bộ luật                                                           | Trước production          | [`02-requirements.md`](./02-requirements.md) §7.1 (owner + kích hoạt) |

Unresolved system-wide liên quan service → tham chiếu, không liệt kê lại: [`overview/01-architecture.md`](../../overview/01-architecture.md) §10 · [`overview/03-operations.md`](../../overview/03-operations.md) §10.
