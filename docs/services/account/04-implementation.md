# Account — triển khai nền tảng

> Issue: [#172](https://github.com/ecoma-io/ecoma-io/issues/172) · PR: [#173](https://github.com/ecoma-io/ecoma-io/pull/173).
> Phạm vi file này: **trạng thái triển khai** và các quyết định chặn mà tài liệu thiết kế chưa phản ánh. Thiết kế → [`01-architecture.md`](./01-architecture.md) · yêu cầu → [`02-requirements.md`](./02-requirements.md) · vận hành → [`03-operations.md`](./03-operations.md).

## Quyết định chặn — Service Binding không phải là cơ chế xác thực

⚠️ **Các tài liệu khác trong bộ này mô tả internal contract là "chỉ sau Service Binding, đã xác thực" ([`02-requirements.md`](./02-requirements.md) FR-008g, FR-011c; AC-008i, AC-020b). Trên Cloudflare, tiền đề đó không đúng.**

Đối chiếu tài liệu chính thức của Cloudflare:

| Điều Cloudflare nói                                                                                                           | Hệ quả                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Không** có header, request property hay cơ chế nào cho Worker phân biệt request qua Service Binding với request từ internet | Ràng buộc bằng "chỉ gọi được qua binding" không kiểm chứng được bằng cách kiểm tra request     |
| Mô hình chính thức là **isolation, không phải verification**: giữ Worker đích không reachable từ internet                     | `account` **không** áp dụng được mô hình đó vì phải phục vụ BFF công khai trên chính Worker đó |
| "Do not treat the downstream invocation as authenticated by the caller's Access context"                                      | Nền tảng không cung cấp assertion nào về caller để truyền qua binding                          |

⚠️ **`CF-Connecting-IP` không phải tín hiệu.** Request công cộng có IP thật; request qua binding thì không có — nhưng **thiếu header ở cả hai trường hợp**, nên sự vắng mặt của nó không chứng minh điều gì. Và nếu sau này Cloudflare thêm header đó, một kiểm tra "có header thì cho qua" trở thành giả mạo được ngay khi bất kỳ tầng nào phía trên chèn được header.

**Hệ quả cho thiết kế:** internal contract trên một Worker có public hostname phải có **authenticator ở tầng ứng dụng**, không dựa vào transport. Xem [`01-architecture.md`](./01-architecture.md) §5.

## Hiện trạng triển khai

⚠️ **Bảng này ghi trạng thái trên branch, không phải trạng thái đã merge.** Cột "PR" nói mã PR; xem PR và CI để biết mục nào thực sự đã land.

| Phần                                                                                              | Trạng thái                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/identity-domain`                                                                            | Có trên branch PR #173 — subject, lifecycle status, session policy, domain errors                                                                                                               |
| `libs/identity-contracts`                                                                         | Có trên branch PR #173 — contract internal + envelope HMAC dùng chung cho caller và callee                                                                                                      |
| `libs/identity-infrastructure`                                                                    | ❌ Chưa — adapter Hyperdrive/`pg`, repository, transaction boundary                                                                                                                             |
| Migration `db-account`                                                                            | ✅ Trên branch — `0001`–`0003`, 53 integration test trên PostgreSQL 17 thật; chạy từ CI bằng role `_migrator_`                                                                                  |
| App wiring (`nuxt.config` alias, Hyperdrive binding, config validation, logger, `health`/`ready`) | 🚧 Trên branch — xem PR                                                                                                                                                                         |
| `GET /internal/account/status`                                                                    | 🚧 Trên branch — contract `account` **phục vụ**, `auth` là consumer (FR-011a). Tên tham số đã thống nhất về `sub` ở cả hai phía (issue [#208](https://github.com/ecoma-io/ecoma-io/issues/208)) |
| BFF account/profile/preferences                                                                   | ❌ Chưa — ngoài phạm vi PR                                                                                                                                                                      |
| Password · MFA · passkey                                                                          | ❌ Chưa — password auth còn chưa chốt ([`01-architecture.md`](./01-architecture.md) §10)                                                                                                        |
| OAuth flow đầy đủ                                                                                 | ❌ Chưa — thuộc `auth`                                                                                                                                                                          |
| `POST /internal/session/verified`                                                                 | ❌ Route thuộc **`auth`**, không phải `account` (FR-006b). PR chỉ ship contract + phía caller                                                                                                   |

## Nonce store

✅ **Đã đóng ở cả hai phía.** Mỗi service sở hữu bảng nonce của mình trong database của mình — `account.internal_nonces` (`apps/account/db/migrations/0003_internal_nonces.sql`) và `auth.internal_nonces` (`apps/auth/migrations/0010_internal_nonces.sql`). Phần serving dùng chúng qua `recordNonce` trong `server/utils/db.ts` + `makeNonceGuard` trong `server/middleware/internal-auth.ts` (phía `account`), và `makeNonceGuard` trong `apps/auth/src/account-client.ts` (phía `auth`).

⚠️ **Hai bảng, không phải một bảng dùng chung.** Nonce đã chiếm ở `db-account` **không** bảo vệ được request đến `auth`, và ngược lại: nonce là duy nhất theo **từng service nhận**. Gộp thành một kho là vi phạm `one service owns each database` — service này với sang database của service kia.

⚠️ **Prune được lên lịch định kỳ.** Hai bảng có `expires_at`, có index phục vụ prune; `.github/workflows/identity-nonce-prune.yaml` chạy `prune-auth` và `prune-account` mỗi ngày (`cron: '17 3 * * *'`) — `prune-account` xoá `account.internal_nonces` bằng `ecoma_account_migrator`, không chạm `db-auth`. Các ràng buộc về lô, timeout, probe cap và fail-closed tương tự đã được mô tả đầy đủ trong [`../auth/03-operations.md`](../auth/03-operations.md) §3.3. Bảng phình ra là vấn đề **vận hành, không phải bảo mật**: một nonce cũ nằm lại vẫn là một nonce đã bị chiếm.

⚠️ **Cơ chế replay guard của `verifyRequest` là callback `claimNonce`, không có giá trị mặc định.** Đó là khoảng trống thật giữa contract và database: replay guard không có nơi lưu nonce đã thấy thì không chống được replay. Tên cũ `seenNonce` đã đổi thành `claimNonce` để mọi consumer viết theo tài liệu cũ **hỏng lúc typecheck** thay vì chạy sai lúc runtime: hợp đồng là "chiếm-ghi nguyên tử", một `SELECT` thuần không còn gán được.

| Vấn đề                                                                                      | Cách đóng                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verifyRequest` bắt buộc `claimNonce` là callback của **caller**, không có giá trị mặc định | `makeNonceGuard` cấp callback dạng check-and-record; middleware từ chối 401 khi thiếu Hyperdrive vì không có kho nonce thì không xác minh được replay |
| `migrations/0001` không tạo bảng nào cho nonce                                              | Được khắc phục bằng `migrations/0003_internal_nonces.sql` — bảng riêng, **không** trộn vào `security_events`                                          |
| `auth` không có kho nonce nào                                                               | `apps/auth/migrations/0010_internal_nonces.sql` — cùng cấu trúc, cùng bộ grant, cùng lý do không dùng `security_events`                               |

⚠️ **Vì sao không dùng `security_events` làm ledger.** Nó là audit append-only với retention **riêng và còn mở** ([`01-architecture.md`](./01-architecture.md) §7.1 nhóm (3)) — retention đó theo nghĩa vụ pháp lý và chống gian lận, không phải theo tuổi của nonce. Trộn hai vòng đời khiến việc dọn nonce hết hạn phải đi theo retention audit, và index theo nonce sẽ không phục vụ truy vấn nào.

Ba ràng buộc của `0003` được giữ bằng test, không chỉ bằng quy ước:

- **`expires_at` không có `DEFAULT`.** Nó là `timestamp của envelope + skew`, tức dữ liệu người gọi kiểm soát; database tự điền thì nonce sống mãi và replay guard vô hiệu hoá. `internal-nonces.spec.ts` assert **cấu trúc cột** qua `pg_attribute` — assert hành vi sẽ xanh vì mọi test đều truyền giá trị tường minh.
- **Không grant `UPDATE`.** Nới `expires_at` của nonce đã ghi là nới cửa sổ replay. Prune dùng `DELETE` theo `expires_at`.
- **`claimNonce` phải là "chiếm và ghi", không phải "kiểm tra".** Cài bằng `SELECT` rồi `INSERT` ở câu khác sẽ mất tính nguyên tử dưới tải đồng thời; `internal-nonces.spec.ts` chạy hai connection thật với `pg_sleep` làm barrier để chứng minh đúng một cái thắng.

⚠️ **`server/middleware/internal-auth.ts` không import bất kỳ thứ gì từ `apps/account/db/`.** Thư mục `db/` là script Node đọc `node:fs` để liệt kê file migration; import nó từ Worker kéo `node:fs` vào bundle của `/internal/**` và `nuxt build` đỏ với `RollupError: db/migrate.mts (71:44): Expected ',', got ':'`. Hằng giao thức thì ngược lại — nó **được** import thẳng từ `@ecoma-io/identity-contracts` (`runtime:universal`, nên cả Worker lẫn Nitro đều nạp được), và đó là nguồn sự thật duy nhất. `db/migrate.mts` giữ bản lặp lại **cố ý** vì nó không import được lib đó, và `internal-nonces.spec.ts` canh bản lặp ấy bằng cách đọc nguồn.

⚠️ **`INTERNAL_SKEW_SECONDS` trong `apps/account/db/migrate.mts` là bản lặp lại của `DEFAULT_SKEW_SECONDS` trong `libs/identity-contracts`.** Vitest config của app không resolve được `@ecoma-io/*`, nên import lib ở integration test sẽ hỏng trước khi test kịp chạy. `internal-nonces.spec.ts` đọc nguồn của lib và assert hai ngang nhau để lệch đó không thể xảy ra âm thầm. Phần serving không dùng bản lặp lại đó — nó lấy skew từ `config.internalAuthSkewSeconds` (mặc định `DEFAULT_SKEW_SECONDS` của lib), tức **đúng** con số mà `verifyRequest` dùng ở chính lệnh gọi đó, và truyền cùng số ấy cho `makeNonceGuard`.

## Tham số tra cứu của `/internal/account/status` — đã thống nhất về `sub`

✅ **Đã đóng ở cả hai phía (issue [#208](https://github.com/ecoma-io/ecoma-io/issues/208), PR [#252](https://github.com/ecoma-io/ecoma-io/pull/252)).** Tên tham số trên wire là **`sub`**: route của `account` đọc `query.sub` rồi kiểm định dạng bằng `isSubject` (`account/server/routes/internal/account/status.get.ts`), và consumer ở `auth` (`AccountClient.checkStatus`) gửi `?sub=`.

⚠️ **Trước đó hai phía dùng hai tên khác nhau và đường kiểm tra trạng thái lúc phát hành không chạy được.** `auth` gọi `?account_id=`; `account` trả `400` vì thiếu `sub` — kể cả khi request được ký đúng. Đây là lệch hợp đồng về **tham số**, không phải về envelope: cả hai phía vẫn ký và verify đúng một giao thức canonical, nonce store vẫn bền ở cả hai bên, taxonomy `401`/`413`/`503` không đổi. Triệu chứng vì thế không lộ ra như một lỗi contract: `400` là một nhánh fail-closed hợp lệ, nên nó đọc thành "không phát hành được token".

**Quyết định: giữ `sub` làm tên canonical, sửa phía `auth`.** Lý do không phải "provider đã viết trước":

- `sub` là **định danh thật** ở cả hai phía. `account.users.sub` là PRIMARY KEY mà `selectAccountStatus` tra cứu (`SELECT status FROM account.users WHERE sub = $1`), và phía `auth` đặt thẳng `claims.sub = params.accountId` khi phát access token (`libs/identity-auth-application/src/authorization-service.ts`).
- `accountId` trong tầng application của `auth` **chỉ là tên nội bộ** cho chính subject đó — giữ nguyên tên đó là giữ một cái tên khớp với port của application layer; đổi nó thành `sub` là một lần đổi tên không mang thêm thông tin, còn đổi **tham số URL** mới là thay đổi hợp đồng.
- FR-011a và [`../auth/01-architecture.md`](../auth/01-architecture.md) §6.0 đã mô tả contract bằng `sub`, nên sửa consumer đưa code về khớp tài liệu thay vì sửa tài liệu cho khớp code.

⚠️ **`account` không nhận alias `account_id`.** Hai tên cho một hợp đồng là hai đường để chúng lệch nhau lần nữa, và lần lệch tới sẽ lại chỉ lộ ra dưới dạng "không phát hành được token". Provider đọc **đúng một** tham số.

_Bất biến này được giữ bằng test, không chỉ bằng quy ước:_

| Bất biến                                                            | Test giữ nó                                                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Consumer gửi đúng path canonical `?sub=`, và ký đúng request nó gửi | `apps/auth/src/account-client.spec.ts` — bắt `Request` thật mà binding nhận, verify bằng `verifyRequest` canonical             |
| Provider phục vụ `?sub=` và **từ chối** `?account_id=` bằng `400`   | `apps/account/tests/integration/status-route-e2e.spec.ts` — h3 app thật + middleware internal-auth thật + PostgreSQL thật      |
| Hai phía dùng **cùng một** tên tham số                              | Test conformance trong `account-client.spec.ts`: đo URL consumer dựng ra lúc chạy, so với tên provider đọc từ source của route |

⚠️ **Test conformance ở dòng cuối không tự nó chứng minh provider hành xử đúng như source nó nói** — nó chỉ so tên hai phía. Ranh giới `type:composition` của Nx cấm app này import app kia, nên không có test nào chạy được cả hai phía trong một process; phần "provider thật sự phục vụ `sub`" do integration test ở `apps/account` chứng minh. Ghép hai thứ lại mới thành bằng chứng tương thích.
