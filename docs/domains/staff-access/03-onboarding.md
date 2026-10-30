# Backoffice — Onboarding

> 📌 Thư mục này là bounded context **Staff Access** (đích — Phase 1, xem [`README.md`](./README.md) §4); luồng onboarding dưới đây diễn ra trên `backoffice`, nơi hiện sở hữu nghiệp vụ staff (việc `staff-access` tiếp quản đã chốt qua [ADR-0013](./adr/0013-staff-access-ownership-transfer.md), host còn chờ P1.4 dựng deploy unit).

> Phạm vi: onboarding lần đầu của staff trên `backoffice` — gate displayName thiếu, giao tiếp với `account` để lấy displayName, chính sách fail/degrade, và chỗ gắn gate two-factor cho giai đoạn sau.
> Thiết kế → [`01-architecture.md`](./01-architecture.md) · contract provider → [`../account/01-architecture.md`](../account/01-architecture.md) §5.2 · yêu cầu provider → [`../account/02-requirements.md`](../account/02-requirements.md) §1.4b · yêu cầu backoffice → [`02-requirements.md`](./02-requirements.md).

---

## 1. Mục đích

Staff directory của `backoffice` hiển thị `displayName` cho từng staff member. `displayName` là dữ liệu hồ sơ thuộc sở hữu của `account` — `backoffice` **không** lưu bản sao bền vững, chỉ **cache** và **đọc qua contract** [`GET /internal/account/profiles`](../account/01-architecture.md) §5.2. Khi một staff member chưa đặt tên, sổ staff không còn tên để hiện và người dùng đó cần một đường onboarding rõ ràng.

Tài liệu này mô tả ba quyết định vận hành của cơ chế: gate hoạt động thế nào, lỗi được xử lý ra sao, và nơi gate two-factor sẽ gắn vào sau này.

## 2. Data flow

```text
Browser ──► GET /api/staff ──────────────► backoffice BFF ──► GET /internal/account/profiles?subs=… ──► account
                   ▲                                            │                                        (db-account)
Browser ──► GET /api/onboarding-status ──► backoffice BFF ────────┘
Browser ──► GET /api/me ─────────────────► (cùng đường client + cache)
Browser ──► GET /onboarding ─────────────► onboarding page (đọc /api/onboarding-status)
```

- Cả ba route BFF (`/api/staff`, `/api/onboarding-status`, `/api/me`) chạy **sau** `requirePrincipal` — chỉ staff đã đăng nhập mới chạm được chúng; `sub` của principal là khóa tra cứu duy nhất.
- `GET /api/me` trả `{ sub, displayName | null }` của phiên hiện tại: sub từ principal, displayName từ cùng batch contract và cùng cache — sub của một phiên chỉ là một entry, nên một lần fetch phục vụ cả ba route.
- `account` trả **chỉ** các sub được hỏi; entry thiếu hoặc `displayName: null` đều nghĩa là **chưa đặt tên**. Chi tiết ràng buộc → FR-011g…l ở [`../account/02-requirements.md`](../account/02-requirements.md) §1.4b.

## 3. Hai chế độ lỗi — fail-closed vs controlled degrade

Không phải mọi đường đọc displayName đều có cùng rủi ro khi `account` không trả lời được, nên các route áp hai chính sách khác nhau:

| Route                        | Vai trò khi đọc lỗi                        | Chính sách                                   | Lý do                                                                                                        |
| ---------------------------- | ------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET /api/onboarding-status` | Đầu vào của **gate** quyết định onboarding | **Fail-closed** → 503                        | Là gate bảo mật-hướng: trả `false` khi không verify được sẽ cho người chưa đặt tên lọt qua onboarding        |
| `GET /api/staff`             | Chỉ **trang trí** cột displayName          | **Controlled degrade** → `displayName: null` | Thiếu tên không làm mất chức năng nào của sổ staff; chặn cả trang vì một cột phụ là trả giá quá lớn          |
| `GET /api/me`                | Danh tính **hiển thị** của phiên hiện tại  | **Controlled degrade** → `displayName: null` | Cùng bản chất hiển thị với `/api/staff`; UI có label riêng cho trạng thái trống (`onboarding.noDisplayName`) |

- Degrade ở `/api/staff` **không im lặng**: mỗi lần degrade ghi log event `staff.account_degraded` kèm reason từ client (`binding_missing` / `secret_missing` / `unreachable` / `http_error` / `invalid_response`), tách rời với log thành công để đo được tỉ lệ degrade. `/api/me` degrade theo cùng nguyên tắc với log event riêng `me.account_degraded` — event tách nhau để đo được degrade của từng bề mặt.
- Các route chia dùng chung một client, nên một cấu hình sai (thiếu binding hay secret) hiện lên ở tất cả: gate chặn hẳn, sổ staff và `/api/me` mất tên — đúng ý, không có đường nào "vẫn chạy như cũ" với dữ liệu không verify được.

## 4. Cache displayName

- Cache **trong bộ nhớ module-level** của Worker/BFF process, TTL **120 giây**, key là `sub`, **dùng chung** cho cả ba route: một lần mở sổ staff với N người cũng "sạc" sẵn cache cho `/api/me` và `/api/onboarding-status` của bất kỳ ai trong N đó. Không có store bền vững và không có cross-instance invalidation — TTL ngắn là toàn bộ biên độ stale chấp nhận được.
- Giá trị `null` (chưa đặt tên) **có được cache**, nhưng với **expiry tuyệt đối**: một hit không kéo dài tuổi thọ entry. Nhờ đó, người dùng vừa đặt tên ở `account` không bị kẹt trong onboarding quá một TTL — lớn nhất là 120 giây sau khi cache cũ hết hạn.
- Cache chỉ là tối ưu hiệu năng; **hit hay miss không đổi kết quả quyết định** (system invariant 12 — không correctness nào phụ thuộc state isolate-global → [`../../architecture/01-architecture.md`](../../architecture/01-architecture.md) §9): cùng một giá trị từ `account` cho ra cùng một gate decision và cùng một ô displayName.

## 5. Tại sao không fallback theo email

Việc suy displayName từ email (local-part, hay bộ phận nào của địa chỉ) bị **loại** làm phương án fallback:

- **Email không phải tên hiển thị** — suy ra tên từ email tạo nhãn sai, và người dùng không có cách nào sửa nhãn đó từ `backoffice`.
- **Email không phải primary identity key** ([`01-architecture.md`](./01-architecture.md) §3): email đổi được, một account có nhiều email, và mapping email → staff không phải quan hệ 1:1 được `backoffice` sở hữu.
- **Che mất dữ liệu thật**: khi fallback thắp lên, không phân biệt được "tên thật" với "tên chế tạm", cả với người đọc lẫn với telemetry.
- Giải pháp đúng là **hiển thị trạng thái trống rõ ràng** (label i18n `onboarding.noDisplayName`) và đưa người dùng về `account` để tự đặt tên — dữ liệu vẫn single-source tại nơi sở hữu nó.

## 6. Two-factor ở onboarding (giai đoạn 2 — chưa cài đặt)

Màn `/onboarding` hiện có mục "Xác thực hai yếu tố" dạng **placeholder "Sắp có"**, không tương tác. Giai đoạn 2 (TOTP thật, ngoài phạm vi #325 giai đoạn 1) sẽ gắn vào đúng chỗ này:

- **Vị trí**: placeholder trong `apps/backoffice/app/pages/onboarding.vue` (`data-testid="onboarding-mfa"`) được thay bằng trạng thái enrolment TOTP thật đọc từ BFF.
- **Gate cứng**: khi bật, nút "tiếp tục" (bỏ qua onboarding) bị thay bằng checkpoint bắt buộc — staff chưa enrol 2FA không đi tiếp được vào app. Điều kiện và freshness của bước xác thực mạnh hơn theo [ADR-0005](./adr/0005-step-up-fresh-session.md); bằng chứng step-up chỉ đến từ flow `auth` đáng tin cậy, không từ cờ client ([`01-architecture.md`](./01-architecture.md) §7).
- **Không đổi contract**: gate 2FA thêm **yêu cầu mới lên principal**; nó không thêm trường nào vào contract profiles cũng không đổi chính sách hai route ở §3.

## 7. Cấu hình triển khai

| Key                                                 | Loại            | Ý nghĩa                                                                                                                                           |
| --------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACCOUNT_SERVICE` (binding, `ecoma-account-bridge`) | Service Binding | Đường gọi contract profiles. **Không** có nghĩa là xác thực — envelope HMAC mới là lớp xác thực → [`01-architecture.md`](./01-architecture.md) §8 |
| `AUTH_INTERNAL_SECRET`                              | Secret          | Chia sẻ với `account` để ký/xác minh envelope; rỗng/vắng → mọi call bị coi là chưa cấu hình                                                       |
| `NITRO_PUBLIC_BACKOFFICE_ACCOUNT_PROFILE_URL`       | Cấu hình public | Origin + path trang profile của `account` để link từ onboarding. Rỗng/vắng → **ẩn link** (không render link chết)                                 |

Việc cấp binding và secret cho từng môi trường thuộc tầng deployment, không thuộc mã nguồn `apps/backoffice`.
