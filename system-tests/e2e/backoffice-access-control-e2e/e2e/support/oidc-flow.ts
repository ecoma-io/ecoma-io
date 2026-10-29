import { expect, type Page } from '@playwright/test';

/**
 * Luồng login browser đầy đủ của suite — quay OTP qua mail sink thật.
 *
 * ## Bản đồ luồng (đã verify từng bước trong code nguồn)
 *
 * 1. `GET /api/auth/login` (backoffice BFF) — 302 tới `GET {issuer}/authorize`
 *    kèm `__Host-backoffice-login` (Max-Age 600, Secure, HttpOnly, SameSite=Lax;
 *    `libs/backoffice-application/src/login-flow.ts`).
 * 2. `handleAuthorize` của auth (`apps/auth/src/browser-handlers.ts`) — mint
 *    binding `__Host-auth-browser`, 302 tới `{issuer}/auth?…&ecoma_x=X`.
 * 3. Provider tạo Interaction, `interactions.url` đẩy browser tới
 *    `{accountBaseUrl}/login?handle=X` (`apps/auth/src/oidc/provider.ts`).
 * 4. Trang login của account (`apps/account/app/pages/login/index.vue`):
 *    `login-email-form` → `login-email` → `login-submit` → challenge mode
 *    `code` → `login-code-form` → `login-code` → `login-code-submit` → OTP
 *    verify OK ⇒ trang relay browser qua hop `GET /authorize/confirm?handle=X`
 *    của auth (URL do BFF verify cấp, §5.1.2 hàng 7) → auth CAS
 *    `browser_confirmed` rồi 302 về `{accountBaseUrl}/login/continue?handle=X`
 *    (`apps/account/app/pages/login/continue.vue`).
 * 5. `/login/continue`: người dùng bấm nút `login-continue-target` ⇒
 *    `completeHandoff` push `/internal/session/verified` về auth và
 *    `window.location.assign` sang `continueUrl` do auth cấp.
 *    `session-verified-handler` của auth: consent chưa có ⇒
 *    `consent_required` với `continue_url` = `/consent?handle=Y`; đã grant ⇒
 *    `granted` với `continue_url` = resume URL của provider.
 *    Browser lần đầu ⇒ qua trang consent: `consent-approve` → `consent-continue`
 *    (nút relay, `apps/account/app/pages/consent.vue`) → provider resume.
 * 6. Provider cấp `code` về `redirect_uri` = `…/api/auth/callback`; callback
 *    của BFF đổi code lấy token qua `NUXT_BACKOFFICE_AUTH_INTERNAL_ORIGIN`,
 *    insert `bff_sessions`, set `__Host-backoffice-session` +
 *    `__Host-backoffice-csrf`, xoá login-flow cookie, 302 `/`
 *    (onboarding redirect không kích hoạt local vì `ACCOUNT_SERVICE` binding
 *    không được cấp cho container Node — `accountClientConfig` trả `null`).
 *
 * Helper KHÔNG assert chi tiết contract từng redirect — việc đó thuộc các test
 * contract chạy bằng request Node; helper chỉ điều khiển UI cho đến khi
 * browser đứng ở `/` của backoffice với session cookie. Hàm trả chuỗi
 * `Set-Cookie` nhìn thấy được ở hop cuối (callback → `/`) để test assert
 * contract ngay hop đó thay vì đọc lại từ browser context (cookie HttpOnly
 * đọc được qua `context.cookies`, nhưng hop contract là bằng chứng sát server hơn).
 */

/** Người nhận OTP — được mọi caller truyền từ fixture identity dùng chung. */
export interface LoginFlowParams {
  readonly email: string;
  /** Đọc mã OTP từ mail sink — inject để test tự định thời điểm `sinceMs`. */
  readonly readOtp: () => Promise<string>;
}

/**
 * Kết quả một lượt login — những gì test muốn xem sau khi browser đã tới `/`.
 */
export interface LoginFlowResult {
  /**
   * Status + `Set-Cookie` của hop CUỐI (callback 302 `/`): bằng chứng contract
   * hop cuối của callback, lấy từ response listener gắn trước khi điều hướng.
   */
  readonly finalHop: { readonly status: number; readonly setCookie: string | undefined };
}

/** Điều khiển browser đi hết luồng login, trả contract hop cuối. */
export async function performBrowserLogin(
  page: Page,
  params: LoginFlowParams,
): Promise<LoginFlowResult> {
  // Gắn listener TRƯỚC khi điều hướng — hop cuối (callback) chỉ xảy ra một
  // lần trong luồng và không lặp lại được sau đó.
  let finalHop: { status: number; setCookie: string | undefined } | undefined;
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/auth/callback') {
      finalHop = {
        status: response.status(),
        setCookie: response.headers()['set-cookie'],
      };
    }
  });

  // Điểm vào duy nhất: BFF dựng authorize URL (URL login do server dựng).
  await page.goto('/api/auth/login');

  // Trang login của account nhận browser sau hai redirect (auth glue → provider
  // → interaction URL). Form email là bước đầu của interaction.
  const emailForm = page.getByTestId('login-email-form');
  await expect(emailForm).toBeVisible();
  await page.getByTestId('login-email').fill(params.email);
  await page.getByTestId('login-submit').click();

  // Challenge mode `code` — OTP đã được account gửi qua transactional-mail.
  const codeForm = page.getByTestId('login-code-form');
  await expect(codeForm).toBeVisible();
  const otp = await params.readOtp();
  await page.getByTestId('login-code').fill(otp);
  await page.getByTestId('login-code-submit').click();

  // Sau verify OK, trang login relay browser qua hop `/authorize/confirm` của
  // auth rồi 302 về `/login/continue` (§5.1.2 hàng 7); tiếp tục phải qua nút
  // relay của trang đó — bấm `login-continue-target` để chạy handoff push và
  // điều hướng sang auth (consent lần đầu hoặc resume trực tiếp).
  const continueTarget = page.getByTestId('login-continue-target');
  await expect(continueTarget).toBeVisible();
  await continueTarget.click();

  // Lần đầu ⇒ trang consent với nút approve.
  const consentCard = page.getByTestId('consent-card');
  await expect(consentCard).toBeVisible();
  await page.getByTestId('consent-approve').click();

  // Nút relay `consent-continue` xuất hiện sau quyết định — bấm để provider
  // resume và cấp code về callback.
  const consentContinue = page.getByTestId('consent-continue');
  await expect(consentContinue).toBeVisible();
  await consentContinue.click();

  // Callback → 302 `/`; browser đổ về overview của backoffice với session.
  await expect(page).toHaveURL(/\/$/u);
  if (finalHop === undefined) {
    throw new Error('login flow finished but no /api/auth/callback response was observed');
  }
  return { finalHop };
}
