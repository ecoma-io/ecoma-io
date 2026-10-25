/**
 * Chấp nhận trang đăng nhập — trang mà **UI không được trở thành ranh giới bảo mật**.
 *
 * ⚠️ Trang dễ bị "tiện tay" dựng luôn URL hoặc tin vào `client_id` từ query string.
 * Mỗi khẳng định dưới đây bảo vệ một điều kiện đã chốt, và mỗi cái đều kiểm **hành vi
 * render + hành vi adapter**, không chỉ markup. (Tách từ `tests/acceptance-auth-flow.spec.ts`
 * — nhóm `login acceptance` giữ nguyên từng test case.)
 *
 * File này giữ thêm nhóm bất biến passwordless của `/login` (tách từ
 * `tests/acceptance-passwordless.spec.ts`): không có ô mật khẩu, không có link
 * khôi phục mật khẩu, không có passkey đăng nhập.
 */
import { describe, expect, it, vi } from 'vitest';

import LoginPage from './index.vue';
import { flushPromises, mountAccount } from '../../../tests/harness';
import { accountStores } from '../../../tests/nuxt-runtime-bridge';

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

describe('passwordless invariant', () => {
  it('/login has no password field and no password-recovery link', async () => {
    const { wrapper } = await mountAccount(LoginPage);

    expect(wrapper.find('input[type="password"]').exists()).toBe(false);
    expect(wrapper.findAll('input').map((input) => input.attributes('type'))).not.toContain(
      'password',
    );
    // Không có liên kết nào — kể cả `NuxtLink` — trỏ tới một màn hình mật khẩu.
    for (const anchor of wrapper.findAll('a')) {
      expect(anchor.attributes('href') ?? '', 'href').not.toMatch(/password|mat-khau|mật%20khẩu/iu);
    }
    // Chữ trên trang được phép **nhắc** rằng không có mật khẩu (đó là thông điệp
    // đúng), nhưng không được đưa ra một lựa chọn khôi phục mật khẩu.
    expect(wrapper.find('[data-testid="login-no-password"]').exists()).toBe(true);
  });

  it('/login offers no passkey sign-in action', async () => {
    const { wrapper } = await mountAccount(LoginPage);
    expect(wrapper.text().toLowerCase()).not.toContain('passkey');
  });
});

/** Route hiện tại của harness — dùng để khẳng định trang **không** điều hướng. */
function accountStoresRoutePath(): string {
  return accountStores.route.path;
}
