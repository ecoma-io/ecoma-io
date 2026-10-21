/**
 * Client gọi ngược `auth` qua các internal contract `account → auth` (§5.1.7
 * của `docs/services/auth/01-architecture.md`): `POST /internal/session/verified`
 * (hàng 5), `POST /internal/consent/context` (hàng 6) và
 * `POST /internal/consent/decide` (hàng 7/8).
 *
 * ## mirror của `apps/auth/src/account-client.ts`
 *
 * hướng ngược lại: `auth` gọi `account` qua `AccountClient` ở đó. Cả hai cùng
 * dùng `signRequest` của `@ecoma-io/identity-contracts` — cùng một canonical
 * string, cùng một bộ header — nên một thay đổi của protocol bẻ cả hai bên cùng
 * lúc, đúng ý của "một hợp đồng, một lib".
 *
 * ⚠️ **Service Binding KHÔNG phải một authenticator.** Mọi request vẫn ký
 * HMAC với secret nội bộ (cùng secret với `internalHmacSecret` mà
 * `server/middleware/internal-auth.ts` nhập vào cho hướng auth → account). Vì vậy
 * hai đường authaccount dùng CHÍNH secret đó — `NUXT_INTERNAL_HMAC_SECRET` trên
 * account, secret tương ứng trên auth — cùng dòng secret được provision một lần.
 *
 * ## Transport là Service Binding `AUTH_SERVICE`
 *
 * Tên binding nằm trong `apps/account/wrangler.jsonc` — do Workstream hạ tầng
 * (Workstream E) khai báo cùng môi trường. Code chỉ chứa **tên** binding (invariant
 * của repo: application code không chứa host/port/identity). Chưa có binding
 * (môi trường dev, hay hạ tầng chưa provision ⇒ binding `null`) **không** được
 * coi là "không cần gọi" — every caller fail-closed với `binding_missing`.
 *
 * Không dùng fetch public origin cho đường này: `/internal/**` của auth nằm
 * sau chính middleware envelope-HMAC của nó, key trong fetch qua binding để
 * host-specific và không mở thêm một đường public-reachable nào.
 */

import {
  createNonce,
  signRequest,
  type SessionVerifiedRequest,
  type SessionVerifiedResponse,
} from '@ecoma-io/identity-contracts';
import type {
  ConsentContextRequest,
  ConsentContextResponse,
  ConsentDecideRequest,
  ConsentDecideResponse,
} from '@ecoma-io/identity-auth-contracts';

/**
 * Tên binding Worker `auth` chấp nhận theo `wrangler.jsonc` (Workstream E sẽ
 * khai báo đúng tên đó). `runtimeConfig.cloudflare.env.AUTH_SERVICE`.
 */
export const AUTH_SERVICE_BINDING_NAME = 'AUTH_SERVICE';

/** Binding Worker mà app này gọi tới. */
export interface AuthServiceBinding {
  /**
   * Chữ ký `fetch(input, init)` chuẩn của Service Binding — nhận cả `init`
   * để timeout qua `init.signal` (bỏ signal là không timeout được).
   */
  fetch(input: Request, init?: RequestInit): Promise<Response>;
}

/** Timeout một lần gọi tới `auth`. Hằng số có chủ đích như ACCOUNT_TIMEOUT_MS bên `auth`. */
export const AUTH_TIMEOUT_MS = 3_000;

/** Lý do gọi thất bại, phân loại ở tầng này — route quyết định hành vi. */
export type AuthCallFailureReason =
  /** Config không có binding — hạ tầng chưa provision, không ngụy trang. */
  | 'binding_missing'
  /** auth trả 4xx — bao gồm `invalid_grant` (handle lạ/hết hạn/đã dùng) và 400. */
  | 'rejected'
  /** auth trả 503 — chính auth đang fail-close. */
  | 'auth_unavailable'
  /** Network/timeout — không tới được auth. */
  | 'unreachable'
  /** auth trả 200 nhưng body khác shape contract. */
  | 'invalid_response';

/** Kết quả một lần gọi back-channel — discriminated, không ném cho caller người dùng. */
export type AuthCallResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: AuthCallFailureReason;
      readonly detail?: string;
    };

/**
 * Trích kiểu `unknown` là binding Worker `auth` từ `runtimeConfig`.
 *
 * Tương tự `accountHyperdrive`: `cloudflare` **không** nằm trong
 * `runtimeConfig` khai ở `nuxt.config.ts`, nên đọc qua `unknown` và kiểm
 * hình dạng thật của binding trước khi dùng (không tin kiểu từ hạ tầng).
 *
 * `binding?.fetch` chỉ là **function check** — mỗi adapter của Worker chạy qua
 * shim không có prototype ổn định, không có `instanceof` đáng tin.
 */
export function authServiceBinding(runtimeConfig: unknown): AuthServiceBinding | null {
  const env = (runtimeConfig as { cloudflare?: { env?: Record<string, unknown> } } | undefined)
    ?.cloudflare?.env;
  const binding = env?.[AUTH_SERVICE_BINDING_NAME];
  if (
    typeof binding !== 'object' ||
    binding === null ||
    typeof (binding as AuthServiceBinding).fetch !== 'function'
  ) {
    return null;
  }
  return binding as AuthServiceBinding;
}

/**
 * Tạo chuẩn hoá một loi back-channel: signature từ method + path (kèm query)
 * + timestamp + nonce + body hash theo canonical contract
 * (`@ecoma-io/identity-contracts`).
 *
 * Trả về cả headers lẫn body để hai thứ không thể lệch nhau (ký byte nào, gửi
 * byte ấy) — cùng lập luận `signInternalRequest` ở `apps/auth` phía
 * `account-client.ts`.
 */
async function signEnvelope(params: {
  signingKey: string;
  method: string;
  path: string;
  body: Uint8Array;
  nowMs: number;
}): Promise<{ headers: Record<string, string>; body: Uint8Array }> {
  const headers = await signRequest({
    method: params.method,
    path: params.path,
    body: params.body,
    secret: params.signingKey,
    timestamp: String(Math.floor(params.nowMs / 1000)),
    nonce: createNonce(),
  });

  return { headers, body: params.body };
}

/** Post JSON payload đã sign tới một route nội bộ của `auth`. */
async function postSignedJson<T>(params: {
  binding: AuthServiceBinding;
  signingKey: string;
  path: string;
  payload: unknown;
  nowMs: number;
}): Promise<AuthCallResult<T>> {
  const body = new TextEncoder().encode(JSON.stringify(params.payload));
  const envelope = await signEnvelope({
    signingKey: params.signingKey,
    method: 'POST',
    path: params.path,
    body,
    nowMs: params.nowMs,
  });

  // Dựng headers qua `Headers` thay vì object literal spread: cùng một object
  // literal chứa cả content-type và ba header envelope, hợp nhất hai nguồn
  // (string literal với output của signRequest) — tách bạch để hình dạng code
  // giữ tính dễ đọc và dễ review từng header.
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const [name, value] of Object.entries(envelope.headers)) {
    headers.set(name, value);
  }

  const request = new Request(`https://auth.internal${params.path}`, {
    method: 'POST',
    headers,
    body: new Uint8Array(envelope.body),
  });

  let response: Response;
  try {
    response = await params.binding.fetch(request, {
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
  } catch {
    // Timeout (abort) và lỗi network cùng là `unreachable` — phân loại thêm ở
    // tầng này không có discriminator đáng tin và không đổi hành vi route.
    return { ok: false, reason: 'unreachable' };
  }

  // ⚠️ 503 cụ thể có nghĩa là chính auth đang fail-close (DB chết) — route nên
  // biết nó đang là "thứ rủi ro được bảo vệ" chứ không phải "auth chết".
  if (response.status === 503) {
    return { ok: false, reason: 'auth_unavailable', detail: '503' };
  }
  // 4xx bất اعلام: invalid_grant (404), invalid_payload (400), forbidden (401).
  if (response.status >= 400) {
    return { ok: false, reason: 'rejected', detail: String(response.status) };
  }

  try {
    const parsed: unknown = await response.json();
    return { ok: true, value: parsed as T };
  } catch {
    return { ok: false, reason: 'invalid_response', detail: 'non_json_body' };
  }
}

/** 200 của `/internal/session/verified` — kiểm shape trước khi coi là thành công. */
function isSessionVerifiedResponse(value: unknown): value is SessionVerifiedResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { outcome?: unknown; continue_url?: unknown };
  if (
    candidate.outcome !== 'consent_required' &&
    candidate.outcome !== 'granted' &&
    candidate.outcome !== 'already_processed'
  ) {
    return false;
  }
  if (
    candidate.continue_url !== undefined &&
    (typeof candidate.continue_url !== 'string' || !/^https?:\/\//u.test(candidate.continue_url))
  ) {
    return false;
  }
  // `continue_url` là URL tuyệt đối do auth dựng; account chỉ relay. Một URL
  // tương đối (relative path) ở đây là dấu hiệu một bên dựng sai hình dạng.
  // `granted`/`consent_required` bắt buộc BẮT BUỘC có `continue_url`: mà không
  // có nó thì account không có gì để 302 browser — coi thiếu là
  // `invalid_response` (fail-closed) thay vì ok không có đường đi.
  if (candidate.outcome !== 'already_processed') {
    if (candidate.continue_url === undefined) {
      return false;
    }
    // `transaction_state` chỉ có mặt ở `already_processed` (§5.1.1).
    const wide = value as { transaction_state?: unknown };
    return wide.transaction_state === undefined;
  }
  // Ở chiều ngược lại, `already_processed` KHÔNG có continuation để cấp — auth
  // trả `transaction_state`, không trả `continue_url`. Có url ở đây là shape lạ;
  // xếp `invalid_response` thay vì relay URL không có định nghĩa trong contract.
  if (candidate.continue_url !== undefined) {
    return false;
  }
  return true;
}

/** 200 của `/internal/consent/context` — kiểm shape trước khi render consent UI. */
function isConsentContextResponse(value: unknown): value is ConsentContextResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as {
    client_name?: unknown;
    scope?: unknown;
    risk_level?: unknown;
  };
  if (typeof candidate.client_name !== 'string' || candidate.client_name === '') {
    return false;
  }
  if (!Array.isArray(candidate.scope) || !candidate.scope.every((v) => typeof v === 'string')) {
    return false;
  }
  return (
    candidate.risk_level === 'low' ||
    candidate.risk_level === 'elevated' ||
    candidate.risk_level === 'high'
  );
}

/** 200 của `/internal/consent/decide` — outcome + continue_url bắt buộc. */
function isConsentDecideResponse(value: unknown): value is ConsentDecideResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { outcome?: unknown; continue_url?: unknown };
  if (candidate.outcome !== 'approved' && candidate.outcome !== 'denied') {
    return false;
  }
  // continue_url bắt buộc ở cả hai outcome — auth duy nhất bên cấp URL tiếp.
  return typeof candidate.continue_url === 'string' && /^https?:\/\//u.test(candidate.continue_url);
}

/**
 * `POST /internal/session/verified` — báo `auth` rằng identity đã xác minh.
 *
 * `event_id` do caller cấp (bất biến: cùng một lần xác minh phải cho cùng
 * `event_id`, để retry sull đường này KHÔNG kích hoạt lại một transaction).
 * Contract yêu cầu 6 trường bắt buộc và cấm 7 trường protocol — payload dựng ở
 * đây đúng 6 trường đó, không thêm gì.
 *
 * ⚠️ Caller xử lý `already_processed` như kết quả `ok` (retry nằm qua được) —
 * kiểm shape `SessionVerifiedResponse` ở tầng này giúp caller không cần toờn
 * từ đó về sau.
 */
export async function announceSessionVerified(params: {
  binding: AuthServiceBinding | null;
  signingKey: string;
  request: SessionVerifiedRequest;
  nowMs: number;
}): Promise<AuthCallResult<SessionVerifiedResponse>> {
  if (params.binding === null) {
    return { ok: false, reason: 'binding_missing' };
  }
  const result = await postSignedJson<unknown>({
    binding: params.binding,
    signingKey: params.signingKey,
    path: '/internal/session/verified',
    payload: params.request,
    nowMs: params.nowMs,
  });
  if (!result.ok) {
    return result;
  }
  return isSessionVerifiedResponse(result.value)
    ? { ok: true, value: result.value }
    : {
        ok: false,
        reason: 'invalid_response',
        detail: 'session_verified_shape',
      };
}

/**
 * `POST /internal/consent/context` — đọc context consent cho transaction
 * đang chờ. Trả `undefined` payload (không có `ConsentContext`) khi auth từ
 * chối — route gọi lại phải phân biệt 404 (`invalid_grant`, handle lạ) với
 * 500 để UI state đúng.
 */
export async function fetchConsentContext(params: {
  binding: AuthServiceBinding | null;
  signingKey: string;
  request: ConsentContextRequest;
  nowMs: number;
}): Promise<AuthCallResult<ConsentContextResponse>> {
  if (params.binding === null) {
    return { ok: false, reason: 'binding_missing' };
  }
  const result = await postSignedJson<unknown>({
    binding: params.binding,
    signingKey: params.signingKey,
    path: '/internal/consent/context',
    payload: params.request,
    nowMs: params.nowMs,
  });
  if (!result.ok) {
    return result;
  }
  return isConsentContextResponse(result.value)
    ? { ok: true, value: result.value }
    : {
        ok: false,
        reason: 'invalid_response',
        detail: 'consent_context_shape',
      };
}

/**
 * `POST /internal/consent/decide` — xác nhận hoặc từ chối consent.
 *
 * `denied` là kết quả hợp lệ theo protocol — auth chọn URI tới RP với
 * `error=access_denied` bằng cách dùng chính route này. Caller biceiving lỗi
 * chỉ được dùng cho body đã fail (rejected, unreachable), KHÔNG dùng cho
 * outcome `denied`.
 */
export async function submitConsentDecision(params: {
  binding: AuthServiceBinding | null;
  signingKey: string;
  request: ConsentDecideRequest;
  nowMs: number;
}): Promise<AuthCallResult<ConsentDecideResponse>> {
  if (params.binding === null) {
    return { ok: false, reason: 'binding_missing' };
  }
  const result = await postSignedJson<unknown>({
    binding: params.binding,
    signingKey: params.signingKey,
    path: '/internal/consent/decide',
    payload: params.request,
    nowMs: params.nowMs,
  });
  if (!result.ok) {
    return result;
  }
  return isConsentDecideResponse(result.value)
    ? { ok: true, value: result.value }
    : { ok: false, reason: 'invalid_response', detail: 'consent_decide_shape' };
}
