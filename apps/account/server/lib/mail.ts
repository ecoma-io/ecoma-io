/**
 * Adapter gửi mail tới `transactional-mail` qua contract `POST /v1/messages`.
 *
 * ## Vì sao đây là HTTP fetch chứ không phải Service Binding
 *
 * Contract public của `transactional-mail` là `POST /v1/messages` trên Worker
 * public của service đó (`docs/services/transactional-mail/01-architecture.md`
 * §5, §7.1). Binding service-to-service cho đường này là **hạ tầng chưa provision**
 * — receiver hiện serve HTTP thật, nhưng đường gọi công khai giữa hai deploy unit
 * vẫn là HTTP fetch tới origin (`runtimeConfig.mailServiceUrl`). Adapter vì vậy
 * dựng URL từ `runtimeConfig` và caller fail-closed khi config thiếu — không có
 * đường "không gửi được thì coi như đã gửi".
 *
 * ## Xác thực: envelope `ecoma-internal-v1` ký bằng lib dùng chung
 *
 * ⚠️ Receiver **bắt buộc** envelope HMAC trước khi vào bất kỳ logic nghiệp vụ nào
 * (`apps/transactional-mail/src/main.ts` bước 1 của `POST /v1/messages`; middleware
 * verify phủ mọi route cần authenticate — `01-architecture.md` §7.4). Một request
 * không envelope là `401` thống nhất, tức **mọi** mail OTP sẽ chết im lặng nếu
 * adapter gửi không ký.
 *
 * ⚠️ **Ký bằng `signRequest` của `@ecoma-io/identity-contracts`** — lib canonical
 * duy nhất, cùng một bản cài đặt mà receiver verify. Tự viết lại HMAC ở đây là
 * tạo một bản envelope thứ hai, lệch nhau ở chữ hoa/thường của method hay đơn vị
 * length-prefix (đúng lệch ship hai envelope khác nhau mà JSDoc của lib nhắc tới)
 * và chỉ lộ ra khi chữ ký đầu tiên tới receiver thật.
 *
 * ⚠️ **Credential là CỦA PATH NÀY.** Envelope không mang principal
 * (`01-architecture.md` §7.4); principal được suy ra từ credential đã khớp trong
 * registry của receiver, và `svc.account` ký bằng secret đăng ký tại
 * `MAIL_INTERNAL_AUTH_SECRET_SVC_ACCOUNT`. Vì vậy sender phải mang credential
 * **riêng** của path Account↔Mail (`NUXT_MAIL_INTERNAL_AUTH_SECRET` — fail-closed,
 * không default): khoá Account↔Auth là một credential khác cho một receiver khác,
 * và giả định "cùng một secret cho hai path" là một lỗi cấu hình mà không gì bắt
 * được cho tới khi chữ ký lệch ở production.
 *
 * ⚠️ **Body đã ký phải byte-identical với body gửi đi.** `hashBody` băm đúng byte
 * truyền vào; ký một chuỗi rồi `JSON.stringify` lại ở chỗ khác đổi thứ tự khoá /
 * khoảng trắng ⇒ chữ ký hợp lệ trên một body không gửi đi. Vì vậy adapter tính
 * `JSON.stringify` **một lần**, dùng đúng `Uint8Array` đó vừa để ký vừa để gửi
 * (cùng hình thức `signEnvelope` của `auth-client.ts`).
 *
 * ## Không tự gọi provider
 *
 * `03-operations.md`: `account` **không** giữ provider credential — mọi mail đi
 * qua `transactional-mail`, service duy nhất giữ SMTP/API key. Adapter chỉ dựng
 * request đúng contract và xử lý lỗi transport/fail-closed.
 */

import { signRequest } from '@ecoma-io/identity-contracts';
import {
  validatePostMessagesRequest,
  isPostMessagesResponse,
  type PostMessagesRequest,
} from '@ecoma-io/transactional-mail-contracts';

/** Logical template của mail OTP đăng nhập. Contract để chuỗi mở (open logical string). */
export const OTP_LOGIN_TEMPLATE = 'account.login-otp';

/**
 * Path của contract public — **tường minh và không query string**.
 *
 * Receiver dựng canonical từ `url.pathname` và từ chối mọi request **có** query
 * string (`apps/transactional-mail/src/internal-auth.ts` — `invalid_field` trước
 * vòng duyệt credential). Vì vậy path ký phải đúng chuỗi này; nối query vào URL
 * là đổi canonical thành thứ receiver không bao giờ dựng.
 */
export const MAIL_MESSAGES_PATH = '/v1/messages';

/** Tên biến runtime config mang credential ký cho path Account↔Mail. */
export const MAIL_INTERNAL_AUTH_SECRET_ENV = 'NUXT_MAIL_INTERNAL_AUTH_SECRET';

/**
 * Timeout một lần gọi mail (ms) — dưới timeout tổng của request route.
 *
 * Hằng số có chủ đích chứ không config: giống lập luận `ACCOUNT_TIMEOUT_MS` của
 * `apps/auth/src/account-client.ts` — nằm dưới mọi mốc platform áp cho đường này,
 * và không có tình huống production nào cần chỉnh riêng nó.
 */
export const MAIL_TIMEOUT_MS = 3_000;

/** Lý do gửi mail thất bại — mã ổn định cho log, không mang chi tiết transport. */
export type MailSendFailureReason =
  | 'config_missing'
  | 'credential_missing'
  | 'invalid_payload'
  | 'rejected'
  | 'unreachable';

/** Kết quả một lần gửi — discriminated, không ném cho lỗi đã phân loại. */
export type MailSendResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: MailSendFailureReason; readonly detail?: string };

/**
 * Dựng body `POST /v1/messages` cho mail OTP và **validate bằng lib thật**.
 *
 * ⚠️ `code` đi vào `variables` — transactional-mail render và **không bao giờ**
 * log recipient lẫn content (`01-architecture.md` của service đó). Còn lại mọi
 * giá trị là hằng của luồng.
 *
 * @returns Request đã validate, hoặc `null` khi payload sai hình dạng — điều
 *   không xảy ra với các hằng phía trên, nhưng validator là lớp bắt đúng chỗ nếu
 *   một ai đó đổi template/variables thành giá trị rỗng.
 */
export function buildOtpMailRequest(params: {
  recipient: string;
  code: string;
  locale?: string;
  correlationId: string;
}): PostMessagesRequest | null {
  const candidate = {
    template: OTP_LOGIN_TEMPLATE,
    recipient: params.recipient,
    locale: params.locale ?? 'en',
    variables: { code: params.code },
    correlation_id: params.correlationId,
  };
  const validation = validatePostMessagesRequest(candidate);
  if (!validation.ok) {
    return null;
  }
  return validation.request;
}

/**
 * Khoá idempotency của một attempt gửi mail — prefix chuẩn + phần duy nhất per-attempt.
 *
 * ⚠️ `transactional-mail` **bắt buộc** `Idempotency-Key` (`apps/transactional-mail/src/main.ts`,
 * FR-001 bước 3 — thiếu ⇒ `400 invalid_request`), và phân biệt replay (`200`, cùng
 * fingerprint) với conflict (`409 idempotency_key_conflict`, cùng key + fingerprint khác —
 * FR-002). Key vì thế KHÔNG được chỉ từ recipient/template: hai attempt khác nhau của
 * cùng địa chỉ phải ra hai key khác nhau, còn retry của MỘT attempt phải tái dùng đúng
 * key đó. `correlationId` truyền vào `buildOtpMailRequest` đã thoả cả hai điều kiện —
 * mỗi attempt sinh digest HMAC riêng nên 16-hex đầu unique per attempt, deterministic
 * cho retry, và đủ ngắn để cùng prefix lọt ceiling 128 ký tự.
 */
export function otpMailIdempotencyKey(correlationId: string | undefined): string {
  return `account-otp-corr-${correlationId ?? 'none'}`;
}

/**
 * Gửi mail qua `POST {mailServiceUrl}/v1/messages` với envelope HMAC đã ký.
 *
 * ⚠️ **Fail-closed là hàm trả `{ ok: false }`, không bao giờ ném cho lỗi đã phân
 * loại** — route quyết định hành vi (OTP domain: việc mail lỗi phải để lại dấu
 * vết ở log nhưng **không** tiết lộ qua response, vì response là anti-enumeration).
 * Ném ở đây sẽ buộc route phải phân loại lại lỗi transport, tức là hai tầng cùng
 * phải biết chi tiết mà chỉ tầng này cần.
 *
 * @param mailServiceUrl Origin của transactional-mail, không có path cuối. Lấy từ
 *   `runtimeConfig`; rỗng ⇒ `{ ok: false, reason: 'config_missing' }` — không
 *   retry, không fallback (một config thiếu phải lộ ra, không được ngụy trang
 *   thành lỗi transport thoáng qua).
 * @param request Request **đã validate** ({@link buildOtpMailRequest}); `null`
 *   ⇒ `{ ok: false, reason: 'invalid_payload' }` và không fetch.
 * @param signingSecret Credential ký cho path Account↔Mail — đúng secret mà
 *   receiver nhận diện là principal `svc.account` trong registry của nó
 *   (`MAIL_INTERNAL_AUTH_SECRET_SVC_ACCOUNT`). Rỗng/`undefined` ⇒
 *   `{ ok: false, reason: 'credential_missing', detail: NUXT_MAIL_INTERNAL_AUTH_SECRET }`
 *   **trước** mọi fetch: không có đường "gửi unsigned cho biết receiver nói gì",
 *   và detail nêu **tên biến**, không nêu giá trị (đọc được trong log platform).
 */
export async function sendMail(
  mailServiceUrl: string | undefined,
  request: PostMessagesRequest | null,
  signingSecret: string | undefined,
): Promise<MailSendResult> {
  if (request === null) {
    return { ok: false, reason: 'invalid_payload' };
  }
  if (mailServiceUrl === undefined || mailServiceUrl === '') {
    return { ok: false, reason: 'config_missing' };
  }
  if (signingSecret === undefined || signingSecret === '') {
    return {
      ok: false,
      reason: 'credential_missing',
      detail: MAIL_INTERNAL_AUTH_SECRET_ENV,
    };
  }

  // ⚠️ Một lần stringify, một `Uint8Array`: đúng byte này vừa được băm trong
  // `signRequest`, vừa được gửi làm thân request. Ký trên chuỗi rồi stringify
  // lại ở nhánh fetch là hai bản body có thể lệch nhau ở khoảng trắng/thứ tự khoá,
  // và chữ ký hợp lệ trên một body không hề đi qua dây — đúng lỗi mà §7.4 coi là
  // "sửa body ⇒ 401" nhưng chỉ phát hiện ở receiver thật.
  const bodyBytes = new TextEncoder().encode(JSON.stringify(request));

  // ⚠️ Không `kid`: receiver của path này (credential registry
  // `MAIL_INTERNAL_AUTH_SECRET_SVC_ACCOUNT`) không khai `secretByKid`, nên một
  // header `kid` là chỉ dẫn chọn khoá mà receiver không có hàm resolve — nó không
  // nằm trong canonical string (không đổi chữ ký) nhưng thêm một trường mà không
  // bên nào dùng. Khi receiver hỗ trợ `kid` cho slot này, bật nó ở sender và
  // receiver cùng lúc, không trước.
  //
  // Timestamp = epoch giây tại thời điểm ký; nonce tự sinh trong `signRequest`
  // (crypto.randomUUID — đủ mạnh cho yêu cầu replay của contract).
  const envelope = await signRequest({
    method: 'POST',
    path: MAIL_MESSAGES_PATH,
    body: bodyBytes,
    secret: signingSecret,
    timestamp: String(Math.floor(Date.now() / 1000)),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAIL_TIMEOUT_MS);
  try {
    // ⚠️ `Idempotency-Key` bắt buộc bởi contract receiver (FR-001 bước 3 — thiếu ⇒
    // `400 invalid_request`, request không bao giờ tới được hàng SEND). Key từ
    // attempt cấu tử (correlationId per-challenge) — không phải recipient/template,
    // vì hai attempt khác nhau cùng địa chỉ phải không va nhau ở bước 5 (FR-002).
    //
    // `Idempotency-Key` KHÔNG nằm trong envelope ký (receiver không băm header
    // này vào bodyHash — `01-architecture.md` §7.4, mục "giới hạn đã nhận biết"):
    // đổi key trên cùng payload không đổi chữ ký, đúng hợp đồng.
    const headers = new Headers({
      'content-type': 'application/json',
      'idempotency-key': otpMailIdempotencyKey(request.correlation_id),
    });
    for (const [name, value] of Object.entries(envelope)) {
      headers.set(name, value);
    }

    const response = await fetch(`${mailServiceUrl.replace(/\/+$/u, '')}${MAIL_MESSAGES_PATH}`, {
      method: 'POST',
      headers,
      body: bodyBytes,
      signal: controller.signal,
    });

    // 2xx = service nhận (queued). Response phải là shape contract — một body lạ
    // là dấu hiệu đường không đúng service, không được coi như đã gửi.
    if (!response.ok) {
      return { ok: false, reason: 'rejected', detail: String(response.status) };
    }
    const parsed: unknown = await response.json().catch(() => undefined);
    if (!isPostMessagesResponse(parsed)) {
      return { ok: false, reason: 'rejected', detail: 'invalid_response_shape' };
    }
    return { ok: true };
  } catch {
    // Abort (timeout) và lỗi network cùng là `unreachable`: phân loại thêm ở đây
    // không đổi hành vi của route và không có discriminator đáng tin để phân biệt.
    return { ok: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
