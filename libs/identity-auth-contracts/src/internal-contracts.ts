/**
 * Contract back-channel `account → auth`.
 *
 * ⚠️ **Không khai lại DTO nào đã có bản canonical.** Mọi DTO của contract nội bộ được
 * định nghĩa tại `@ecoma-io/identity-contracts` — nguồn sự thật duy nhất. File này chỉ giữ:
 *
 *  1. các **re-export**, gồm một **alias tên cũ** (`AccountStatus`) để call
 *     site hiện có tiếp tục biên dịch, trỏ thẳng về type canonical; và
 *  2. các khai báo **chỉ thuộc shim**: năm type `Consent*` và hàm `allowsIssuance`, chưa
 *     có bản canonical.
 *
 * Danh sách khai báo cục bộ ở mục 2 là một allowlist và được canh bởi
 * `internal-contracts.spec.ts`; thêm một khai báo cục bộ mới làm test đỏ cho tới khi
 * allowlist đó được sửa một cách có ý thức.
 *
 * Lý do phải ghi rõ: trước đây file này khai lại `SessionVerifiedRequest` bằng tay và
 * đã trôi lệch khỏi bản canonical — `authn_at` là `string` thay vì epoch ms `number`,
 * `authn_level` nhận `'mfa'` (giá trị canonical không có), và outcome có thêm
 * `'invalid_request'`. `apps/auth` dùng type đó để `JSON.stringify` payload gửi sang
 * `account`, mà `account` validate bằng validator canonical, nên một caller làm đúng
 * theo type của shim vẫn bị từ chối `400`. Khai lại type chính là cách lỗi đó sinh ra;
 * re-export làm nó bất khả thi về mặt cấu trúc.
 *
 * ⚠️ **Về `'invalid_request'` — giá trị bị bỏ khỏi `SessionVerifiedOutcome`.** Bản canonical
 * theo FR-009i (`docs/services/auth/02-requirements.md`): outcome của contract này gồm
 * **ba** giá trị, và chính FR-009i là chỗ khẳng định `access_denied` **không** phải outcome.
 * Trong docs, `invalid_request` xuất hiện như một **kết quả từ chối**, không phải outcome:
 * bảng state machine §5.1.2 hàng 3 và 12, bảng thứ tự kiểm §5.1.1 bước 1, và §5.1.5(a)
 * (bảng **idempotency**, *không* phải bảng outcome — §5.1.5 có ba bảng con (a)(b)(c), mỗi
 * bảng liệt kê các trường hợp xử lý, không phải các outcome). Bảng outcome thật sự nằm ở
 * §5.1.1, cũng **ba** hàng, cả ba đều `200` kèm body; các kiểu từ chối payload đã được mô
 * hình riêng bằng `SessionVerifiedRejectionReason` ở bản canonical. Vì §5 cấm thiết kế lại
 * hành vi endpoint trong PR này, ở đây **không** thêm giá trị thứ tư. Nếu về sau route được
 * implement và thật sự trả `invalid_request` trong body `200`, thì đó là thay đổi contract ở
 * bản canonical — phải sửa FR-009i và bảng outcome §5.1.1 trước, không phải khai lại ở file này.
 *
 * Xem bảng hướng trong `docs/services/auth/01-architecture.md` §5.1.7 — cột "Hướng" đọc
 * là `consumer → provider`, và tên endpoint nằm trên không gian tên của provider.
 * `/internal/account/status` có TIỀN TỐ `account` nhưng thuộc về `account`.
 */

import type { AccountStatusResponseValue } from '@ecoma-io/identity-contracts';

export {
  FORBIDDEN_SESSION_VERIFIED_FIELDS,
  isAccountStatusResponseValue,
  type AccountStatusResponse,
  type AccountStatusResponseValue as AccountStatus,
  type AcrUrn,
  type SessionVerifiedOutcome,
  type SessionVerifiedRequest,
  type SessionVerifiedResponse,
} from '@ecoma-io/identity-contracts';

/**
 * Payload `POST /internal/consent/context`.
 *
 * ⚠️ KHÔNG có `sub`: `account` đã được xác minh ở `/authorize/complete` và
 * transaction đã gắn subject. Trả `sub` trong context là tiết lộ dữ liệu định
 * danh không cần thiết, và mở đường cho client dùng nhầm nó làm bằng chứng.
 */
export interface ConsentContextRequest {
  handle: string;
  account_session_ref: string;
}

export interface ConsentContextResponse {
  client_name: string;
  scope: string[];
  /** Thông tin TRÌNH BÀY cho consent UI — KHÔNG phải control bảo mật. */
  risk_level: 'low' | 'elevated' | 'high';
}

/** Quyết định consent. `deny` là kết quả hợp lệ, không phải lỗi. */
export type ConsentDecision = 'approve' | 'deny';

/**
 * Payload `POST /internal/consent/decide`.
 *
 * ⚠️ Ba trường. `account` KHÔNG được gửi `client_id`, `redirect_uri`, `scope`,
 * `state`, `nonce` hay `code_verifier` — kể cả ở bước này. Không có bước nào
 * trong đoạn này để caller đưa tham số authorization vào.
 */
export interface ConsentDecideRequest {
  handle: string;
  decision: ConsentDecision;
  account_session_ref: string;
}

export interface ConsentDecideResponse {
  outcome: 'approved' | 'denied';
  continue_url: string;
}

/**
 * Mọi trạng thái không phải `active` đều dẫn tới không cấp token.
 *
 * Nhận thẳng type canonical (qua alias `AccountStatus`) thay vì một union khai lại, nên
 * thêm một trạng thái mới ở canonical sẽ chảy tới đây mà không cần sửa file này.
 */
export function allowsIssuance(status: AccountStatusResponseValue): boolean {
  return status === 'active';
}
