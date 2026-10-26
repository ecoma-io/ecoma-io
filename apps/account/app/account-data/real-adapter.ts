/*
 * ⚠️ `no-invalid-void-type` tắt cho file này: `Result<void>` là **hợp đồng**,
 * không phải lựa chọn kiểu (cùng lý do với `mock-adapter.ts`).
 */

/**
 * Adapter thật — UI nói chuyện với **server API của chính app account**.
 *
 * ## Ranh giới
 *
 * Đây KHÔNG phải là adapter gọi trực tiếp `auth` hay transactional-mail: mọi
 * request đi tới các route BFF của app (`/api/auth/*`, `/api/consent/*`) trên
 * cùng origin. Envelope HMAC, Service Binding và secret sống ở **server**;
 * browser chỉ có session cookie + CSRF token. UI không bao giờ là security
 * boundary.
 *
 * ## Luồng đã nối
 *
 * - `/login` challenge → `POST /api/auth/challenge` (204 anti-enumeration —
 *   UI không phân biệt hết hạn/lỗi/địa chỉ lạ, mọi nhánh là "đã gửi").
 * - `/login` verify → `POST /api/auth/verify` (session + CSRF cookie).
 * - `/login/continue` handoff → `POST /api/auth/handoff` (push
 *   `/internal/session/verified` về auth; `continueUrl` do auth cấp được relay).
 * - `/consent` context → `POST /api/consent/context`.
 * - `/consent` decide → `POST /api/consent/decide`.
 *
 * ## Các luồng chưa có đường server — từ chối, không giả
 *
 * Các thao tác dữ liệu tài khoản (profile, emails, sessions, applications…) và
 * các route còn lại của mock **chưa có BFF thật**: adapter này vẫn là mock cho
 * phần đó và `isPreview` vẫn `true`. Đây là một sự thật phải nói lên được ở UI
 * (banner Preview data) chứ không phải một "fake success": chỉ các luồng đã
 * nối ở trên mới là đường thật.
 *
 * ⚠️ **Không giữ dữ liệu nhạy cảm qua trang**: giá trị cookie đọc b indirectly
 * qua `$fetch` với `credentials: 'include'` (browser tự gắn) và CSRF token
 *(document.cookie). Adapter KHÔNG viết cookies, KHÔNG viết storage.
 */

import type { AccountAdapter, ConsentContext, LoginChallenge, Result } from './types';
import { createMockAccountAdapter, type MockAdapterOptions } from './mock-adapter';

/** Cookie CSRF do verify cấp; browser JS đọc được (không HttpOnly). */
const CSRF_COOKIE_NAME = '__Host-account-csrf';
/** Header double-submit tương ứng. */
const CSRF_HEADER_NAME = 'x-ecoma-csrf';

/** Đọc cookie bằng trình duyệt đúng semantics của document.cookie. */
function readCsrfToken(): string | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CSRF_COOKIE_NAME) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return undefined;
}

/** POST JSON với CSRF double-submit nếu có token. */
async function postJson(path: string, body: unknown): Promise<Response> {
  const csrf = readCsrfToken();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf !== undefined) {
    headers[CSRF_HEADER_NAME] = csrf;
  }
  return fetch(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
}

/** TTL của OTP đo từ phía server (OTP_TTL_SECONDS = 600); UI chỉ hiển thị. */
const OTP_TTL_UI_SECONDS = 600;

/**
 * Adapter thật cho các luồng đã nối, mock cho phần còn lại.
 *
 * ⚠️ **Cùng một `MockAdapterOptions`** với `createMockAccountAdapter` — các
 * test/UI preview dựng mock tùy chỉnh được, real adapter chỉ thay các luồng
 * đã nối bên trên lớp đó.
 *
 * @param options Tuỳ chỉnh của lớp mock bên dưới (test/UI preview).
 * @param preview `isPreview` **dẫn xuất** — do điểm chọn adapter truyền từ mode
 *                + domain coverage, không phải cờ hardcode. Ở mode `real` hôm
 *                nay mọi domain dữ liệu vẫn mock bên trong nên cờ là `true`;
 *                PR4 wire từng domain sẽ chuyển slice đó sang đường thật và cờ
 *                tự đúng theo — banner tắt đúng khi domain cuối cùng hết mock,
 *                không cần đụng UI.
 */
export function createServerAccountAdapter(
  options: MockAdapterOptions = {},
  preview = true,
): AccountAdapter {
  const mock = createMockAccountAdapter(options);

  return {
    ...mock,

    /**
     * Dẫn xuất từ mode + domain coverage (tham số {@link preview}) — xem JSDoc
     * của factory. Không hardcode ở đây: hardcode làm banner nói dối ngay khi
     * một domain đầu tiên chuyển sang đường thật.
     */
    isPreview: preview,

    /**
     * Luồng challenge làm một request thật; response luôn `204` bất kể kết quả
     * gửi mail. Adapter dựng `LoginChallenge` **từ TTL hợp đồng** — đây là dữ
     * liệu hiển thị duy nhất cho phản hồi 204 và không phải là kết quả mock:
     * mode `'code'` là mode của luồng thật (email-link chưa nối ở server).
     *
     * ⚠️ Không có cách nào cho UI phân biệt "địa chỉ không tồn tại" ra khỏi
     * "đã gửi" — route là anti-enumeration, và UI,vì thế,từ chối đường nào đó vì nó: mọi
     * request thành công đều được hiện như một challenge đã gửi.
     *
     * Handle continuation đi **vào body** của request (FR-006c: binding được
     * ghi tại bước challenge): server cần nó để ghi `login_handoffs` cho
     * session trình X. Nó KHÔNG đi vào URL — trên URL thì handle lọt vào
     * access log, `Referer` và lịch sử proxy.
     */
    requestLoginChallenge: async (
      email: string,
      continuationHandle?: string,
    ): Promise<Result<LoginChallenge>> => {
      // Handle opaque, hình dạng tối thiểu ở server — adapter chỉ forward.
      const response = await postJson('/api/auth/challenge', {
        email,
        ...(continuationHandle === undefined ? {} : { handle: continuationHandle }),
      });
      if (!response.ok) {
        // 400 (body sai hình dạng) hoặc 503 (config/DB chết) — hiển thị lỗi
        // chung; không phân biệt detail ra UI.
        return { ok: false, reason: `challenge request failed with ${response.status}` };
      }
      // Nhớ email cho bước verify trong cùng phiên — xem `pendingLoginEmail`.
      pendingLoginEmail = email;
      const expiresAt = new Date(Date.now() + OTP_TTL_UI_SECONDS * 1000).toISOString();
      return { ok: true, value: { email, mode: 'code', expiresAt } };
    },

    /**
     * Verify với một mã từ UI. Email được nhớ từ lần challenge gần nhất trong
     * phiên của adapter (module-local của nuxtApp, không storage) — cùng lớp
     * giữ với email UI state.
     *
     * ⚠️ Verify yêu cầu email từ UI mock hiện tại; điều đó nghĩa là một trang
     * đã reload giữa chừng (adapter mất email đang chờ) là một phiên lỗi, UI
     * bắt người dùng phải yêu cầu challenge mới. Đây là một tình huống thật
     * (tải lại trang) mà chi phí sửa là thay đổi hợp đồng bên server-side —
     * out of scope cho PR này (tài liệu hóa trong PR handoff).
     */
    verifyLoginCode: async (code: string): Promise<Result<void>> => {
      const email = pendingLoginEmail;
      if (email === undefined) {
        // Không có challenge nào được yêu cầu từ phiên này (ví dụ vừa reload
        // trang) — UI phải yêu cầu challenge mới; không có đường nào verify
        // mà không có email.
        return { ok: false, reason: 'no challenge requested' };
      }
      const response = await postJson('/api/auth/verify', { email, code });
      if (!response.ok) {
        return { ok: false, reason: `verify request failed with ${response.status}` };
      }
      // Mã đã dùng — xỉa email pending cho lần verify kế (rotation là luồng
      // bình thường, một verify mới bắt đầu từ một challenge mới).
      pendingLoginEmail = undefined;
      return { ok: true, value: undefined };
    },

    /**
     * Push `/internal/session/verified` qua BFF để hoàn tất continuation.
     */
    completeHandoff: async (
      handle: string,
    ): Promise<Result<{ continueUrl: string | undefined }>> => {
      const response = await postJson('/api/auth/handoff', { handle });
      if (response.status === 401) {
        // Session chấm dứt giữa chừng — UI đưa về luồng login từ đầu.
        return { ok: false, reason: 'session not active' };
      }
      if (!response.ok) {
        return { ok: false, reason: `handoff request failed with ${response.status}` };
      }
      const body: unknown = await response.json().catch(() => undefined);
      if (typeof body !== 'object' || body === null || !(body as { ok?: unknown }).ok) {
        return { ok: false, reason: 'handoff response unreadable' };
      }
      const candidate = body as {
        ok?: boolean;
        reason?: string;
        continueUrl?: string;
      };
      if (!candidate.ok) {
        return { ok: false, reason: candidate.reason ?? 'handoff rejected' };
      }
      return { ok: true, value: { continueUrl: candidate.continueUrl } };
    },

    /**
     * Consent context qua BFF. Trả `undefined` cho mọi lỗi — nhánh `empty`
     * của `/consent` không phân biệt lý do, giống như luồng thật không phân
     * biệt "handle lạ" với "handle hết hạn" (không oracle thêm).
     */
    getConsentContext: async (handle: string): Promise<ConsentContext | undefined> => {
      const response = await postJson('/api/consent/context', { handle });
      if (!response.ok) {
        return undefined;
      }
      const body: unknown = await response.json().catch(() => undefined);
      if (typeof body !== 'object' || body === null) {
        return undefined;
      }
      const candidate = body as {
        ok?: unknown;
        clientName?: unknown;
        permissions?: unknown;
        highRisk?: unknown;
      };
      if (
        candidate.ok !== true ||
        typeof candidate.clientName !== 'string' ||
        candidate.clientName === '' ||
        !Array.isArray(candidate.permissions)
      ) {
        return undefined;
      }
      // Shape từng permission do server dựng — chỉ relay.
      const permissions = candidate.permissions
        .filter(
          (entry): entry is { label: string; description: string } =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as { label?: unknown }).label === 'string' &&
            typeof (entry as { description?: unknown }).description === 'string',
        )
        .map((entry) => ({ label: entry.label, description: entry.description }));
      if (permissions.length === 0) {
        return undefined;
      }
      return {
        clientName: candidate.clientName,
        permissions,
        highRisk: candidate.highRisk === true,
      };
    },

    /**
     * Consent decide qua BFF; `continueUrl` được relay (UI điều hướng browser)
     * khi có.
     */
    decideConsent: async (
      handle: string,
      decision: 'approve' | 'deny',
    ): Promise<Result<{ continueUrl: string | undefined }>> => {
      const response = await postJson('/api/consent/decide', { handle, decision });
      if (response.status === 401) {
        return { ok: false, reason: 'session not active' };
      }
      if (!response.ok) {
        return { ok: false, reason: `decide request failed with ${response.status}` };
      }
      const body: unknown = await response.json().catch(() => undefined);
      if (typeof body !== 'object' || body === null) {
        return { ok: false, reason: 'decide response unreadable' };
      }
      const candidate = body as {
        ok?: unknown;
        reason?: unknown;
        continueUrl?: unknown;
      };
      if (candidate.ok !== true) {
        return {
          ok: false,
          reason:
            typeof candidate.reason === 'string' && candidate.reason !== ''
              ? candidate.reason
              : 'decide rejected',
        };
      }
      return {
        ok: true,
        value: {
          continueUrl:
            typeof candidate.continueUrl === 'string' ? candidate.continueUrl : undefined,
        },
      };
    },
  };
}

/**
 * Email đang chờ verify của phiên — holder nội bộ, không storage.
 *
 * ⚠️ Module-local ở client là biến theo tab (mỗi tab một copy, không chia sẻ
 * qua request hay giữa các tab). Không `useState`, không `localStorage` —
 * chạm storage là đường "lưu thông tin xác thực" mà `01-architecture.md` §4
 * của app account không cho (chỉ lưu hash session ở server).
 * Khai báo ở mức module nhưng định nghĩa trước khi factory dùng; một `let`
 * module được hoist an toàn cho closure đọc sau này.
 */
let pendingLoginEmail: string | undefined;
