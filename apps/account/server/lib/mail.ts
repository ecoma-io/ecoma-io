/**
 * Adapter gửi mail tới `transactional-mail` qua contract `POST /v1/messages`.
 *
 * ## Vì sao đây là HTTP fetch chứ không phải Service Binding
 *
 * Contract public của `transactional-mail` là `POST /v1/messages` trên Worker
 * public của service đó (`docs/services/transactional-mail/01-architecture.md`
 * §5, §7.1). Binding service-to-service cho đường này là **hạ tầng chưa provision**
 * — `apps/transactional-mail/src/main.ts` hiện là scaffold `Hello word!`, chưa có
 * route nào. Adapter vì vậy dựng URL từ `runtimeConfig` (`mailServiceUrl`) và
 * caller fail-closed khi config thiếu — không có đường "không gửi được thì coi như
 * đã gửi".
 *
 * ⚠️ **Payload build bằng validator thật của lib contract** — cùng một hàm mà
 * phía nhận dùng để từ chối. Nếu request của ta không qua
 * `validatePostMessagesRequest` thì đó là bug của adapter, phát hiện ở test chứ
 * không ở production (`01-architecture.md` §7.1: `app` bị bỏ qua ở body,
 * `principal_id` do server kiểm soát — adapter không tự thêm field đó).
 *
 * ## Không tự gọi provider
 *
 * `03-operations.md`: `account` **không** giữ provider credential — mọi mail đi
 * qua `transactional-mail`, service duy nhất giữ SMTP/API key. Adapter chỉ dựng
 * request đúng contract và xử lý lỗi transport/fail-closed.
 */

import {
  validatePostMessagesRequest,
  isPostMessagesResponse,
  type PostMessagesRequest,
} from '@ecoma-io/transactional-mail-contracts';

/** Logical template của mail OTP đăng nhập. Contract để chuỗi mở (open logical string). */
export const OTP_LOGIN_TEMPLATE = 'account.login-otp';

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
 * Gửi mail qua `POST {mailServiceUrl}/v1/messages`.
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
 */
export async function sendMail(
  mailServiceUrl: string | undefined,
  request: PostMessagesRequest | null,
): Promise<MailSendResult> {
  if (request === null) {
    return { ok: false, reason: 'invalid_payload' };
  }
  if (mailServiceUrl === undefined || mailServiceUrl === '') {
    return { ok: false, reason: 'config_missing' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAIL_TIMEOUT_MS);
  try {
    // ⚠️ `Idempotency-Key` bắt buộc bởi contract receiver (FR-001 bước 3 — thiếu ⇒
    // `400 invalid_request`, request không bao giờ tới được hàng SEND). Key từ
    // attempt cấu tử (correlationId per-challenge) — không phải recipient/template,
    // vì hai attempt khác nhau cùng địa chỉ phải không va nhau ở bước 5 (FR-002).
    const response = await fetch(`${mailServiceUrl.replace(/\/+$/u, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': otpMailIdempotencyKey(request.correlation_id),
      },
      body: JSON.stringify(request),
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
