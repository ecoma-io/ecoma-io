/**
 * Chấp nhận luồng đăng nhập và uỷ quyền — hai trang mà **UI không được trở thành ranh giới
 * bảo mật**.
 *
 * ⚠️ Đây là điều kiện khó nhất của cả PR: những trang dễ bị "tiện tay" dựng luôn URL
 * hoặc tin vào `client_id` từ query string. Mỗi khẳng định dưới đây bảo vệ một điều kiện
 * đã chốt, và mỗi cái đều kiểm **hành vi render + hành vi adapter**, không chỉ markup.
 */
import { describe, expect, it, vi } from 'vitest';

import ConsentPage from '../app/pages/consent.vue';
import LoginPage from '../app/pages/login/index.vue';
import { MOCK_CONSENT_HANDLE } from '../app/account-data/mock-adapter';
import { flushPromises, mountAccount } from './harness';
import { accountStores } from './nuxt-runtime-bridge';

/** Tham số protocol mà UI không bao giờ được tự dựng hay tin. */
const PROTOCOL_PARAMS = /[?&](code|state|client_id|redirect_uri|scope|response_type|nonce)=/u;

describe('login acceptance', () => {
  it('asks for an email address first and shows no password field', async () => {
    const { wrapper } = await mountAccount(LoginPage);

    expect(wrapper.find('[data-testid="login-email-form"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="login-challenge"]').exists()).toBe(false);
    const input = wrapper.find('[data-testid="login-email"]');
    expect(input.attributes('type')).toBe('email');
    expect(input.attributes('autocomplete')).toContain('email');
  });

  it('does not show a code step until the adapter asks for one', async () => {
    const { wrapper } = await mountAccount(LoginPage, {
      adapterOptions: { challengeMode: 'email-link' },
    });

    await wrapper.find('[data-testid="login-email"]').setValue('user@example.com');
    await wrapper.find('[data-testid="login-email-form"]').trigger('submit');
    await flushPromises();

    // Challenge đã có, nhưng **không** có ô nhập mã: chế độ không cần bước đó.
    expect(wrapper.find('[data-testid="login-challenge"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="login-code-form"]').exists()).toBe(false);
  });

  it('shows a code step when the adapter reports a code challenge', async () => {
    const { wrapper } = await mountAccount(LoginPage, {
      adapterOptions: { challengeMode: 'code' },
    });

    await wrapper.find('[data-testid="login-email"]').setValue('user@example.com');
    await wrapper.find('[data-testid="login-email-form"]').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-testid="login-code-form"]').exists()).toBe(true);
  });

  it('reports a refused challenge request instead of pretending it was sent', async () => {
    const { wrapper } = await mountAccount(LoginPage, {
      adapterOptions: { failWrites: ['requestLoginChallenge'] },
    });

    await wrapper.find('[data-testid="login-email"]').setValue('user@example.com');
    await wrapper.find('[data-testid="login-email-form"]').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-testid="login-request-failed"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="login-challenge"]').exists()).toBe(false);
  });

  it('surfaces a failed resend while the challenge is still on screen', async () => {
    // Submit lần đầu thành công (challenge hiển thị), rồi adapter từ chối lần
    // gửi lại. Trước đây thông báo lỗi nằm trong `<form v-if="!challenge">` —
    // nhánh không còn render — nên gửi lại thất bại hoàn toàn im lặng.
    const { wrapper, adapter } = await mountAccount(LoginPage);

    await wrapper.find('[data-testid="login-email"]').setValue('user@example.com');
    await wrapper.find('[data-testid="login-email-form"]').trigger('submit');
    await flushPromises();
    expect(wrapper.find('[data-testid="login-challenge"]').exists()).toBe(true);

    const requestLoginChallenge = vi.spyOn(adapter, 'requestLoginChallenge');
    requestLoginChallenge.mockResolvedValueOnce({ ok: false, reason: 'mock refused resend' });

    await wrapper.find('[data-testid="login-resend"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="login-challenge"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="login-request-failed"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="login-resend-sent"]').exists()).toBe(false);
  });

  it('confirms a successful resend instead of staying silent', async () => {
    // `login.resendSent` có trong cả ba catalog nhưng trước đây không nơi nào
    // dùng: gửi lại thành công cũng im lặng như gửi lại thất bại.
    const { wrapper } = await mountAccount(LoginPage);

    await wrapper.find('[data-testid="login-email"]').setValue('user@example.com');
    await wrapper.find('[data-testid="login-email-form"]').trigger('submit');
    await flushPromises();

    await wrapper.find('[data-testid="login-resend"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="login-resend-sent"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Sent again.');
    expect(wrapper.find('[data-testid="login-request-failed"]').exists()).toBe(false);
  });

  it('confirms an accepted code instead of staying silent', async () => {
    // Trước đây `verifyLoginCode` trả `ok: true` không đổi gì trên màn hình:
    // `codeFailed` vốn đã là `false`, nên người dùng không phân biệt được "mã
    // đúng" với "chưa bấm" — với mock, 123456 là một dead-end thật.
    const { wrapper } = await mountAccount(LoginPage, {
      adapterOptions: { challengeMode: 'code' },
    });

    await wrapper.find('[data-testid="login-email"]').setValue('user@example.com');
    await wrapper.find('[data-testid="login-email-form"]').trigger('submit');
    await flushPromises();

    await wrapper.find('[data-testid="login-code"]').setValue('123456');
    await wrapper.find('[data-testid="login-code-form"]').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-testid="login-code-accepted"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Code accepted.');
    expect(wrapper.find('[data-testid="login-code-invalid"]').exists()).toBe(false);
  });

  it('replaces the accepted notice with an error when a later code is wrong', async () => {
    const { wrapper } = await mountAccount(LoginPage, {
      adapterOptions: { challengeMode: 'code' },
    });

    await wrapper.find('[data-testid="login-email"]').setValue('user@example.com');
    await wrapper.find('[data-testid="login-email-form"]').trigger('submit');
    await flushPromises();

    await wrapper.find('[data-testid="login-code"]').setValue('123456');
    await wrapper.find('[data-testid="login-code-form"]').trigger('submit');
    await flushPromises();

    await wrapper.find('[data-testid="login-code"]').setValue('999999');
    await wrapper.find('[data-testid="login-code-form"]').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-testid="login-code-invalid"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="login-code-accepted"]').exists()).toBe(false);
  });

  it('passes the continuation handle to the adapter and nowhere else', async () => {
    const HANDLE = 'opaque-continuation-handle';
    const { wrapper, adapter } = await mountAccount(LoginPage, {
      route: { path: '/login', query: { handle: HANDLE } },
    });

    const requestLoginChallenge = vi.spyOn(adapter, 'requestLoginChallenge');
    await wrapper.find('[data-testid="login-email"]').setValue('user@example.com');
    await wrapper.find('[data-testid="login-email-form"]').trigger('submit');
    await flushPromises();

    // Đúng một call-site, và mang handle nguyên vẹn.
    expect(requestLoginChallenge).toHaveBeenCalledTimes(1);
    expect(requestLoginChallenge).toHaveBeenCalledWith('user@example.com', HANDLE);

    // Handle không được dán vào bất kỳ liên kết nào của trang.
    for (const anchor of wrapper.findAll('a')) {
      expect(anchor.attributes('href') ?? '', 'an href must not carry the handle').not.toContain(
        HANDLE,
      );
    }
    // Cũng không nằm trong storage nào.
    expect(localStorage.getItem(HANDLE)).toBeNull();
    expect(sessionStorage.getItem(HANDLE)).toBeNull();
  });

  it('navigates nowhere after a challenge request', async () => {
    const { wrapper } = await mountAccount(LoginPage, {
      route: { path: '/login', query: { handle: 'opaque-continuation-handle' } },
    });

    await wrapper.find('[data-testid="login-email"]').setValue('user@example.com');
    await wrapper.find('[data-testid="login-email-form"]').trigger('submit');
    await flushPromises();

    // Đích tiếp theo là việc của BFF, không phải một `navigateTo` ở đây.
    expect(accountStoresRoutePath()).toBe('/login');
    expect(wrapper.findAll('a').map((a) => a.attributes('href') ?? '')).not.toContain(
      '/login/continue?handle=opaque-continuation-handle',
    );
  });
});

describe('consent acceptance', () => {
  it('takes its client name, permissions and risk from the adapter alone', async () => {
    const { wrapper } = await mountAccount(ConsentPage, {
      route: { path: '/consent', query: { handle: MOCK_CONSENT_HANDLE } },
    });

    expect(wrapper.find('[data-testid="consent-card"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Ecoma Docs');
    expect(wrapper.find('[data-testid="consent-high-risk"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="consent-permissions"] li').length).toBe(3);
  });

  it('ignores a handle it does not recognise instead of inventing a client', async () => {
    const { wrapper } = await mountAccount(ConsentPage, {
      route: { path: '/consent', query: { handle: 'forged-handle' } },
    });

    // Adapter từ chối handle lạ → nhánh `empty`, với câu giải thích — không phải
    // một consent screen trống giả (trước đây `isEmpty(undefined)` là false nên
    // state là `ready` với `value: undefined` và không nhánh nào khớp), và càng
    // không phải nhánh lỗi (handle không phải lỗi tải).
    expect(wrapper.find('[data-testid="consent-approve"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="consent-denied"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="consent-empty"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('The requesting application is not identified.');
  });

  it('shows the empty state when the URL carries no handle at all', async () => {
    const { wrapper } = await mountAccount(ConsentPage, {
      route: { path: '/consent', query: {} },
    });

    expect(wrapper.find('[data-testid="consent-empty"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="consent-approve"]').exists()).toBe(false);
  });

  it('never renders a browser-supplied client_id as if it were trusted', async () => {
    const { wrapper } = await mountAccount(ConsentPage, {
      route: {
        path: '/consent',
        query: { handle: MOCK_CONSENT_HANDLE, client_id: 'attacker-app', scope: 'admin:write' },
      },
    });

    const text = wrapper.text();
    expect(text, 'a query client_id must not be displayed').not.toContain('attacker-app');
    expect(text, 'a query scope must not be displayed').not.toContain('admin:write');
  });

  it('shows approve and deny, and builds no success or error redirect', async () => {
    const { wrapper, adapter } = await mountAccount(ConsentPage, {
      route: { path: '/consent', query: { handle: MOCK_CONSENT_HANDLE } },
    });

    const decideConsent = vi.spyOn(adapter, 'decideConsent');
    await wrapper.find('[data-testid="consent-approve"]').trigger('click');
    await flushPromises();

    // Quyết định đi qua adapter — nơi duy nhất được phép biết hậu quả của nó.
    expect(decideConsent).toHaveBeenCalledWith(MOCK_CONSENT_HANDLE, 'approve');

    // Không có `window.location` nào bị gán, và không có liên kết protocol nào.
    for (const anchor of wrapper.findAll('a')) {
      expect(anchor.attributes('href') ?? '', 'no protocol href').not.toMatch(PROTOCOL_PARAMS);
    }
    expect(wrapper.html()).not.toMatch(PROTOCOL_PARAMS);
  });

  it('reports a refused decision instead of a completed authorization', async () => {
    const { wrapper } = await mountAccount(ConsentPage, {
      adapterOptions: { failWrites: ['decideConsent'] },
      route: { path: '/consent', query: { handle: MOCK_CONSENT_HANDLE } },
    });

    await wrapper.find('[data-testid="consent-approve"]').trigger('click');
    await flushPromises();

    // `data-tone` là thứ phân biệt thành công với thất bại — đọc class thì một thay
    // đổi Tailwind sau này sẽ làm test im lặng pass/fail sai.
    expect(wrapper.find('[data-testid="account-result"]').attributes('data-tone')).toBe('danger');
    // Lưu hỏng thì handle chưa bị tiêu thụ: nút vẫn bấm được để thử lại.
    expect(
      (wrapper.find('[data-testid="consent-approve"]').element as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('reports a granted decision as granted, keeps it on screen, and never re-uses the handle', async () => {
    const { wrapper, adapter } = await mountAccount(ConsentPage, {
      route: { path: '/consent', query: { handle: MOCK_CONSENT_HANDLE } },
    });

    expect(wrapper.find('[data-testid="account-result"]').exists()).toBe(false);

    // Spy sau khi mount: lần gọi đầu (`useAsyncState` nạp context) đã xảy ra, nên
    // mọi lần gọi sau đây đều là của `reload()` — thứ không được tồn tại.
    const getConsentContext = vi.spyOn(adapter, 'getConsentContext');
    await wrapper.find('[data-testid="consent-deny"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="account-result"]').attributes('data-tone')).toBe('success');
    // Handle đã tiêu thụ: không `reload()` nạp lại context bằng chính handle đó —
    // adapter thật trả `undefined`, nhánh `empty` ("yêu cầu không còn hợp lệ")
    // sẽ phủ ngay lên thông báo vừa thành công.
    expect(getConsentContext).not.toHaveBeenCalled();
    // Thông báo và context vẫn trên màn hình, và nút bị khoá: gửi lại một handle
    // đã dùng sẽ làm adapter thật báo lỗi đè lên thành công.
    expect(wrapper.find('[data-testid="consent-approve"]').exists()).toBe(true);
    expect(
      (wrapper.find('[data-testid="consent-approve"]').element as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('reloads the context and unlocks the buttons when the handle in the URL changes', async () => {
    // `NuxtPage` tái sử dụng instance của page khi chỉ đổi query, còn
    // `useAsyncState` chỉ nạp ở `onMounted`: không có watch thì quyền của handle
    // cũ vẫn trên màn hình trong khi `decide()` đã đọc handle mới lúc bấm — cấp
    // quyền nhầm ứng dụng. Route trong harness là `reactive` nên `setRoute`
    // giữa chừng chính là mô phỏng điều hướng SPA đó.
    const { wrapper, adapter, setRoute } = await mountAccount(ConsentPage, {
      route: { path: '/consent', query: { handle: MOCK_CONSENT_HANDLE } },
    });
    expect(wrapper.text()).toContain('Ecoma Docs');

    const getConsentContext = vi.spyOn(adapter, 'getConsentContext');
    setRoute({ query: { handle: 'forged-handle' } });
    await flushPromises();

    // Context cũ bị thay bằng nhánh `empty` của handle mới, không phải treo quyền cũ.
    expect(wrapper.find('[data-testid="consent-empty"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Ecoma Docs');
    expect(getConsentContext).toHaveBeenCalledTimes(1);

    // Quay lại handle hợp lệ: context mới tải và nút bật — trạng thái quyết định
    // cũ (nếu có) không giữ khóa.
    setRoute({ query: { handle: MOCK_CONSENT_HANDLE } });
    await flushPromises();
    expect(wrapper.text()).toContain('Ecoma Docs');
    expect(
      (wrapper.find('[data-testid="consent-approve"]').element as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(getConsentContext).toHaveBeenCalledTimes(2);
  });
});

/** Route hiện tại của harness — dùng để khẳng định trang **không** điều hướng. */
function accountStoresRoutePath(): string {
  return accountStores.route.path;
}
