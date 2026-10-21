/**
 * `POST /api/auth/handoff` — hoàn tất bàn giao login từ `account` về `auth`.
 *
 * ## Luồng browser qua đây
 *
 * `auth` redirect user tới `/login?handle=X` (tham số `ecoma_x` của provider),
 * `account` xác minh OTP và phát hành session — rồi **push**
 * `POST /internal/session/verified` về `auth` (§5.1.2 hàng 5). Route này là
 * đường push đó: đọc session vừa được verify, đọc handle continuation từ body,
 * ký envelope HMAC và gọi auth qua Service Binding `AUTH_SERVICE` (tên binding
 * do Workstream hạ tầng khai báo; chưa có ⇒ fail-closed, không ngụy trang).
 *
 * UI gọi route này (qua adapter, từ `/login/continue`) sau khi mã được chấp
 * nhận. Handle đi vào body từ browser **chỉ relay** — opaque, không parse.
 *
 * ## `event_id` bất biến cho từng lần xác minh
 *
 * Contract `session-verified` yêu cầu `event_id` — key idempotency của event.
 * Nó được dựng từ `session_ref` của session vừa verify: cùng một lần xác minh
 * luôn cho cùng event_id, nên retry của BFF KHÔNG kích hoạt lại transaction —
 * nếu lần đầu đã thành công, auth trả `already_processed` (200). `event_id`
 * thay đổi theo attempt là đường hiện tại của một bug thật: mỗi retry là một
 * event mới, transaction của auth bị đẩy đi đẩy lại.
 *
 * ## Fail-closed mà không hủy session
 *
 * Mọi nhánh lỗi (auth chết/unreachable/binding chưa provision) trả HTTP 200
 * với `ok:false` + mã lý do ổn định — session vẫn sống, người dùng đăng nhập
 * thành công với account; UI cho retry (push idempotent). Chọn 200 thay vì
 * một mã lỗi HTTP thật: BFF không proxy phải phân biệt khuyến khích browser
 * hiện trang lỗi riêng — cùng một bảng results, cùng một UI state retry. Sự
 * kiện được ghi vào log với reason; không có nhánh nào biến "auth chết" thành
 * "bàn giao xong".
 */

import { createError, defineEventHandler, readValidatedBody, setResponseHeader } from 'h3';

import type { SessionVerifiedRequest } from '@ecoma-io/identity-contracts';

import { announceSessionVerified, authServiceBinding } from '../../lib/auth-client';
import { requireAuthedSession } from '../../lib/bff-session';
import { writeLog } from '../../utils/logger';

/** Body hợp lệ: `handle` opaque — hình dạng tối thiểu, không parse. */
function isHandoffBody(value: unknown): { handle: string } | false {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const handle = (value as { handle?: unknown }).handle;
  // Cận trên chặn abuse; không kiểm hình dạng khác — handle là thứ opaque.
  if (typeof handle !== 'string' || handle.length === 0 || handle.length > 1_000) {
    return false;
  }
  return { handle };
}

/** Response cho browser — `ok` chỉ khi auth xác nhận continuation. */
export interface HandoffResponse {
  readonly ok: boolean;
  /** Lý do thất bại — mã ổn định cho UI hiện, không chi tiết transport. */
  readonly reason?: string;
  readonly outcome?: 'consent_required' | 'granted' | 'already_processed';
  /** URL tuyệt đối do `auth` dựng — browser relay, không tự dựng. */
  readonly continueUrl?: string;
}

export default defineEventHandler(async (event): Promise<HandoffResponse> => {
  setResponseHeader(event, 'Cache-Control', 'no-store');

  const body = await readValidatedBody(event, isHandoffBody).catch(() => null);
  if (body === null) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' });
  }

  const authed = await requireAuthedSession(event);
  if (authed === null) {
    writeLog({ event: 'handoff.rejected', status: 401, reason: 'no_session' });
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }

  const config = useRuntimeConfig(event);
  const signingKey = typeof config.internalHmacSecret === 'string' ? config.internalHmacSecret : '';
  if (signingKey.length === 0) {
    writeLog({
      event: 'handoff.failed',
      status: 503,
      reason: 'config_missing',
    });
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
    });
  }

  // ⚠️ Invariant idempotency: **tài liệu đây, không phải ngẫu nhiên** — một lần
  // verifyOTP = một `session_ref` = một `event_id` = một lần push duy nhất vào
  // một transaction của auth. Route này KHÔNG nhận `event_id` từ body (browser
  // không được cấp quyền chọn key idempotency); nếu bỏ điều đó cho một caller
  // mới, retry sẽ mở lại transaction đã xong đúng như cảnh báo ở header. Test
  // neo: `tests/integration/bff-routes-e2e.spec.ts` — "retry sau thành công trả
  // `already_processed` thay vì mở lại".
  const pushRequest: SessionVerifiedRequest = {
    handle: body.handle,
    sub: authed.session.sub,
    acr: authed.session.acr,
    authn_at: authed.session.authnAtMs,
    account_session_ref: authed.session.sessionRef,
    event_id: `session_verified:${authed.session.sessionRef}`,
  };

  const result = await announceSessionVerified({
    binding: authServiceBinding(config),
    signingKey,
    request: pushRequest,
    nowMs: Date.now(),
  });

  if (!result.ok) {
    // Chỉ mã ổn định trong log — không giá trị handle, không chi tiết transport.
    // ⚠️ `status` ở đây là HTTP status route trả về browser (200, có `ok:false`
    // trong body), KHÔNG phải status của auth phía sau. Reason phân loại bên
    // trong (`rejected` = auth trả 4xx, `auth_unavailable` = auth trả 503,
    // `unreachable`/`binding_missing` = không tới được auth) mới là chi tiết
    // upstream; response là một bảng results thống nhất cho UI.
    writeLog({ event: 'handoff.failed', status: 200, reason: result.reason });
    return { ok: false, reason: result.reason };
  }

  writeLog({
    event: 'handoff.done',
    status: 200,
    reason: result.value.outcome,
  });
  return {
    ok: true,
    outcome: result.value.outcome,
    continueUrl: result.value.continue_url,
  };
});
