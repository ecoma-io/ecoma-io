/**
 * Bất bi��n passwordless ở tầng **render**, không chỉ ở tầng route.
 *
 * ⚠️ `nav-items.spec.ts` kiểm danh sách nav. Test này kiểm thứ mà danh sách đó không
 * bắt được: **markup thật** của các trang nhạy cảm. Ecoma không có mật khẩu, nên
 * không được tồn tại ở bất kỳ đâu trong app:
 *
 * - `<input type="password">` — ô nhập mật khẩu;
 * - link/`NuxtLink` nào trỏ tới màn hình mật khẩu;
 * - nút "quên mật khẩu" / "đặt lại mật khẩu";
 * - passkey **dùng để đăng nhập** trên `/login` (tài liệu chưa chốt, nên UI không
 *   đề nghị).
 *
 * Và một điều dễ nhầm hơn nhiều: **mã khôi phục MFA không phải khôi phục mật khẩu**.
 * `/security` có mã khôi phục, và phải giữ — nhưng phải nói rõ đó là mã khôi phục
 * *hai yếu tố*, không phải đường lấy lại mật khẩu. Test kiểm cả hai mặt: có mã
 * khôi phục, và không có bất kỳ ngữ cảnh mật khẩu nào.
 */
import { describe, expect, it } from 'vitest';

import LoginPage from '../app/pages/login/index.vue';
import ContinuePage from '../app/pages/login/continue.vue';
import SecurityPage from '../app/pages/security.vue';
import AccountLayout from '../app/layouts/default.vue';
import { mountAccount } from './harness';

/** Khớp mọi cách diễn đạt "mật khẩu" mà một UI có thể dùng ở cả ba locale. */
const PASSWORD_WORDS =
  /\bpassword\b|\bpasswd\b|\bpasswort\b|\bcontrase[nñ]a\b|\b密码\b|\bmật khẩu\b|\bmat khau\b/iu;

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

  it('/security has no password section at all', async () => {
    const { wrapper } = await mountAccount(SecurityPage);

    // Không có `type="password"`, không có form đổi/đặt lại mật khẩu.
    expect(wrapper.find('input[type="password"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="login-email"]').exists()).toBe(false);
    // `noPasswordNote` nói rõ app không dùng mật khẩu — đây là câu được phép.
    expect(wrapper.find('[data-testid="security-no-password"]').exists()).toBe(true);

    // ⚠️ Mã khôi phục **có** mặt và phải mặt: đó là mã khôi phục MFA.
    expect(wrapper.find('[data-testid="recovery-codes-state"]').exists()).toBe(true);
  });

  it('/security never mentions password recovery in its section headings', async () => {
    const { wrapper } = await mountAccount(SecurityPage);
    const headings = wrapper.findAll('h2').map((heading) => heading.text());
    expect(headings.length).toBeGreaterThan(0);
    for (const heading of headings) {
      expect(heading, 'a security section heading must not be about passwords').not.toMatch(
        PASSWORD_WORDS,
      );
    }
  });

  it('/login/continue builds no protocol continuation URL', async () => {
    const { wrapper, setRoute } = await mountAccount(ContinuePage);
    setRoute({ path: '/login/continue', query: { handle: 'opaque-handle-value' } });

    // Không có form, không có `action`/`href` chứa tham số protocol.
    expect(wrapper.find('form').exists()).toBe(false);
    for (const anchor of wrapper.findAll('a')) {
      const href = anchor.attributes('href') ?? '';
      expect(href).not.toMatch(/[?&](code|state|client_id|redirect_uri|scope)=/u);
    }
  });

  it('/login/continue never renders the continuation handle into the DOM', async () => {
    // Handle trong DOM là handle trong HTML SSR, trong view-source, trong cây
    // accessibility và trong mọi script quét DOM — một đường rò handle ra ngoài
    // luồng sinh ra nó (FR-006k3). Trước đây một `<p class="sr-only">` dán nó
    // thẳng vào trang; test này giữ cho nó không quay lại.
    const HANDLE = 'opaque-handle-value';
    const { wrapper } = await mountAccount(ContinuePage, {
      route: { path: '/login/continue', query: { handle: HANDLE } },
    });

    expect(wrapper.html()).not.toContain(HANDLE);
    expect(wrapper.find('[data-testid="login-continue-handle"]').exists()).toBe(false);
  });

  it('the account layout links to no password route', async () => {
    const { wrapper } = await mountAccount(AccountLayout, {
      slots: { default: '<p data-testid="slot" />' },
    });
    const hrefs = wrapper.findAll('a').map((anchor) => anchor.attributes('href') ?? '');
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).not.toMatch(/password|forgot|reset/iu);
    }
  });
});
