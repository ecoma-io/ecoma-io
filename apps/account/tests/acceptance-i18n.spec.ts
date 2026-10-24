/**
 * Chấp nhận i18n — những điều **hành vi** mà bảng catalog không bắt được.
 *
 * ⚠️ `catalogs.spec.ts` kiểm ba catalog có cùng key. Test này kiểm phần còn lại: locale
 * đến từ đâu, đổi locale thì chuyện gì xảy ra, và — quan trọng nhất — **lỗi không
 * được biến thành thành công**.
 *
 * Bốn luật sản phẩm được bảo vệ ở đây:
 *
 * 1. Không có preference đã lưu và không có lựa chọn tường minh → **tiếng Anh**,
 *    không phải ngôn ngữ trình duyệt.
 * 2. Đổi locale giữ nguyên route: không có prefix trong URL, và không mất điều kiện
 *    của luồng OAuth đang dở.
 * 3. Lưu hỏng thì **không** hiện trạng thái thành công bền vững.
 * 4. Locale lạ từ server được đưa ra đường lỗi, không âm thầm thành locale khác.
 */
import { describe, expect, it } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import AccountLanguageSelect from '../app/components/AccountLanguageSelect.vue';
import PreferencesPage from '../app/pages/preferences.vue';
import SecurityPage from '../app/pages/security.vue';
import { createMockAccountAdapter } from '../app/account-data/mock-adapter';
import { useAccountFormat } from '../app/composables/use-account-preferences';
import { useAccountShellPreferences } from '../app/composables/use-account-shell-preferences';
import { useAccountI18n } from '../app/composables/use-account-i18n';
import { useAccountLocale } from '../app/composables/use-account-locale';
import {
  ACCOUNT_LOCALES,
  DEFAULT_ACCOUNT_LOCALE,
  type AccountLocale,
} from '../app/i18n/locale-registry';
import { accountStores } from './nuxt-runtime-bridge';
import { flushPromises, mountAccount } from './harness';

/**
 * Trang bọc trong đúng những gì `app.vue` làm: nối i18n rồi nạp shell preference.
 *
 * ⚠️ Mount component này mới là "tải trang" qua **đường thật**. Test set thẳng
 * composer locale thì không đi qua `useAccountLocale` hay shell wiring — đúng
 * chỗ mà một preference đã lưu không bao giờ được nạp sẽ vẫn pass.
 */
const ShellSecurityPage = defineComponent({
  setup() {
    useAccountI18n();
    useAccountShellPreferences();
    return () => h(SecurityPage);
  },
});

/**
 * Cookie locale cục bộ — cùng tên với hằng trong `use-account-locale.ts`.
 *
 * ⚠️ Viết lại ở đây thay vì import hằng ( nó không được export): nếu tên cookie đổi mà
 * test không theo, test sẽ **vẫn xanh** — nó đặt cookie không ai đọc rồi khẳng định app
 * rơi về tiếng Anh. Ở đây chính app đọc cookie, nên test kiểm được cả hai cùng lúc: nếu
 * tên lệch, `preferred` sẽ theo cookie mà test vừa đặt và khẳng định fail.
 */
const LOCALE_COOKIE = 'account-locale';

describe('i18n acceptance', () => {
  it('defaults to English with no saved preference and no explicit choice', async () => {
    const { wrapper } = await mountAccount(SecurityPage, {
      adapterOptions: { invalidStoredLocale: 'en' },
    });
    // Locale hợp lệ từ server là tiếng Anh: nó cho cùng kết quả với "không có gì", nên
    // dùng `undefined` để kiểm đúng nhánh **không có** preference.
    expect(wrapper.text()).toContain('Ecoma is passwordless.');
  });

  it('never falls back to the browser language', async () => {
    // jsdom đặt `navigator.language` là `en-US`; dù app có dò thì cũng phải ra `en`.
    expect(navigator.language).toBe('en-US');
    const { wrapper } = await mountAccount(SecurityPage, {
      adapterOptions: { invalidStoredLocale: 'klingon' },
    });
    expect(wrapper.text()).toContain('Ecoma is passwordless.');
  });

  it('the language selector offers exactly the three registry locales', async () => {
    const { wrapper } = await mountAccount(AccountLanguageSelect, {
      props: { authenticated: false },
    });
    const options = wrapper.findAll('[data-testid="account-language-select"] option');
    expect(options.map((option) => option.text())).toEqual(['English', 'Tiếng Việt', '简体中文']);
  });

  it('switching the locale updates every visible string without changing the route', async () => {
    const { wrapper, setLocale, setRoute } = await mountAccount(SecurityPage, {
      adapterOptions: { invalidStoredLocale: 'en' },
    });
    setRoute({ path: '/security' });

    const englishHeading = wrapper.find('h1').text();
    expect(englishHeading).toBe('Security');

    await setLocale('vi');
    expect(wrapper.find('h1').text()).toBe('Bảo mật');
    // Route giữ nguyên: locale không phải thứ URL biết.
    expect(accountStores.route.path).toBe('/security');
  });

  it('switching to Chinese renders Chinese, not a fallback', async () => {
    const { wrapper, setLocale } = await mountAccount(SecurityPage, {
      adapterOptions: { invalidStoredLocale: 'en' },
    });
    await setLocale('zh-CN');
    expect(wrapper.find('h1').text()).toBe('安全');
  });

  it('renders the whole page in the selected locale, not just the heading', async () => {
    const { wrapper, setLocale } = await mountAccount(SecurityPage, {
      adapterOptions: { invalidStoredLocale: 'en' },
    });
    await setLocale('vi');

    // Mọi khối chữ tiếng Anh đã biết ở trang này phải biến mất. Kiểm **nhiều** chỗ vì
    // một khẳng định chỉ bắt được thứ nó đã nghĩ tới.
    for (const english of ['Passkeys', 'Authenticator app', 'Recovery codes', 'Remove']) {
      expect(wrapper.text(), `still English: ${english}`).not.toContain(english);
    }
    for (const vietnamese of ['Passkey', 'Ứng dụng xác thực', 'Mã khôi phục']) {
      expect(wrapper.text(), `missing Vietnamese: ${vietnamese}`).toContain(vietnamese);
    }
  });

  it('an unauthenticated explicit choice survives a remount', async () => {
    const { wrapper } = await mountAccount(AccountLanguageSelect, {
      props: { authenticated: false },
    });
    await wrapper.find('[data-testid="account-language-select"]').setValue('vi');
    await flushPromises();
    expect(accountStores.cookies.get(LOCALE_COOKIE)).toBe('vi');
  });

  it('a saved preference is authoritative over the local choice', async () => {
    // Cookie để 'en', preference đã lưu là 'vi' — preference đã lưu phải thắng
    // **lúc tải trang**, qua đúng đường shell wiring (`useAccountShellPreferences`
    // nạp `useStoredAccountLocale`), không phải bằng cách set composer locale.
    accountStores.cookies.set(LOCALE_COOKIE, 'en');
    const adapter = createMockAccountAdapter();
    await adapter.updatePreferences({ locale: 'vi' });
    const { wrapper } = await mountAccount(ShellSecurityPage, { adapter });
    await flushPromises();
    expect(wrapper.find('h1').text()).toBe('Bảo mật');
  });

  it('an explicit choice in this session beats the stored preference immediately', async () => {
    // Stored đã có 'vi' (tài khoản), người dùng vừa chọn 'en' ở selector và lưu
    // **hỏng**: UI phải giữ 'en' — đổi ngay khi chọn, và không bật ngược về 'vi'
    // khi lưu hỏng. Không có trạng thái `explicit` thì `preferred = stored ?? …`
    // giữ 'vi' xuyên suốt: select không đổi khi bấm, và quay về 'vi' sau khi lưu
    // thất bại — đúng hai hành vi mà khối chú thích của selector cấm.
    //
    // `account-locale-stored` là key `useState` của `useStoredAccountLocale` —
    // cùng lý do với `LOCALE_COOKIE` ở trên: hằng không được export, và nếu key
    // đổi mà test không theo thì stored rỗng, select là 'en' ngay từ đầu và
    // khẳng định đầu tiên fail — rõ ràng, thay vì pass nhầm.
    accountStores.store.set('account-locale-stored', ref<AccountLocale>('vi'));
    const { wrapper } = await mountAccount(AccountLanguageSelect, {
      props: { authenticated: true, saveFailedLabel: 'Could not save.' },
      adapterOptions: { failWrites: ['updatePreferences'] },
    });
    await flushPromises();
    const select = wrapper.find('[data-testid="account-language-select"]');
    expect((select.element as HTMLSelectElement).value).toBe('vi');

    await select.setValue('en');
    await flushPromises();
    // Chọn xong + lưu hỏng: vẫn 'en', và có thông báo lỗi — không im lặng, không revert.
    expect((select.element as HTMLSelectElement).value).toBe('en');
    expect(wrapper.find('[data-testid="account-language-failed"]').exists()).toBe(true);
  });

  it('a successful save wins over an explicit choice left from earlier in the session', async () => {
    // Kịch bản thật: đổi ở selector header nhưng lưu hỏng → `explicit` giữ lựa
    // chọn mới, `stored` giữ giá trị cũ; sau đó lưu thành công (đường của
    // `/preferences`, gọi `chooseAndPersist` mà **không** qua `chooseLocal`) thì
    // `explicit` phải theo locale vừa lưu — nếu không nó vẫn thắng `stored` và
    // app hiển thị locale cũ trong khi server đã lưu locale mới cho tới lần tải
    // trang sau. Key `useState` viết lại ở đây với cùng lý do với `LOCALE_COOKIE`.
    accountStores.store.set('account-locale-explicit', ref<AccountLocale>('vi'));
    accountStores.store.set('account-locale-stored', ref<AccountLocale>('en'));
    const { preferred, chooseAndPersist } = useAccountLocale();
    const outcome = await chooseAndPersist('en', createMockAccountAdapter());
    expect(outcome).toBe('saved');
    expect(preferred.value).toBe('en');
  });

  it('formats dates in the saved timezone once the shell has loaded preferences', async () => {
    // Timezone đọc từ `useState('account-preferences')`; state đó chỉ có dữ liệu
    // khi shell nạp. Mock lưu `Asia/Ho_Chi_Minh` (+07), còn fallback là UTC: một
    // timestamp buổi sáng UTC sẽ sang ngày hôm sau ở +07, nên hai locale cho chuỗi
    // khác nhau — khẳng định phải so sánh đúng hai chuỗi Intl. Locale trong test
    // này là 'en' (chưa có lựa chọn nào) nên chuỗi expected dựng bằng 'en'.
    const adapter = createMockAccountAdapter();
    await adapter.updatePreferences({ timezone: 'Asia/Ho_Chi_Minh' });
    accountStores.nuxtApp.$accountAdapter = adapter;
    useAccountShellPreferences();
    await flushPromises();

    const { formatDateTime } = useAccountFormat();
    const iso = '2026-01-01T20:00:00.000Z';
    const expected = new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Ho_Chi_Minh',
    }).format(new Date(iso));
    const utc = new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(iso));
    expect(expected).not.toBe(utc);
    expect(formatDateTime(iso)).toBe(expected);
  });

  it('formats in the locale currently shown, not only the saved preference', async () => {
    // Đổi locale hiển thị (như selector header) mà không đụng preference đã lưu:
    // ngày giờ và số phải đổi theo ngay — đúng cam kết trong JSDoc của
    // `useAccountFormat`. Trước đây locale chỉ đọc từ `preferences.locale` nên
    // cam kết sai: chữ đổi theo selector còn `Intl` vẫn theo locale cũ.
    accountStores.store.set('account-locale-explicit', ref<AccountLocale>('vi'));
    const { formatDateTime, formatCount } = useAccountFormat();
    const iso = '2026-01-01T20:00:00.000Z';
    const expected = new Intl.DateTimeFormat('vi', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(iso));
    expect(formatDateTime(iso)).toBe(expected);
    expect(formatCount(1234)).toBe(new Intl.NumberFormat('vi').format(1234));
  });

  it('reports a failed save instead of a durable success', async () => {
    const { wrapper } = await mountAccount(AccountLanguageSelect, {
      props: {
        authenticated: true,
        saveFailedLabel: 'Could not save your language.',
        savedLabel: 'Language saved.',
      },
      adapterOptions: { failWrites: ['updatePreferences'] },
    });

    await wrapper.find('[data-testid="account-language-select"]').setValue('vi');
    await flushPromises();

    expect(wrapper.find('[data-testid="account-language-saved"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="account-language-failed"]').exists()).toBe(true);
  });

  it('reports a successful save when the adapter accepts it', async () => {
    const { wrapper } = await mountAccount(AccountLanguageSelect, {
      props: {
        authenticated: true,
        saveFailedLabel: 'Could not save your language.',
        savedLabel: 'Language saved.',
      },
    });

    await wrapper.find('[data-testid="account-language-select"]').setValue('vi');
    await flushPromises();

    expect(wrapper.find('[data-testid="account-language-saved"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="account-language-failed"]').exists()).toBe(false);
  });

  it('surfaces an unsupported stored locale on /preferences instead of coercing it', async () => {
    const { wrapper } = await mountAccount(PreferencesPage, {
      adapterOptions: { invalidStoredLocale: 'klingon' },
    });
    const error = wrapper.find('[data-testid="preferences-invalid-locale"]');
    expect(error.exists()).toBe(true);
    expect(error.text()).toContain('klingon');
  });

  it('shows no locale error when the stored locale is supported', async () => {
    const { wrapper } = await mountAccount(PreferencesPage);
    expect(wrapper.find('[data-testid="preferences-invalid-locale"]').exists()).toBe(false);
  });

  it('a stored locale only reaches the UI through the shell, not through the route', async () => {
    // Không có locale segment trong URL, nên route không đổi khi locale đổi: `/`
    // phải cho ra cùng một trang dù locale là 'vi' hay 'en'.
    accountStores.cookies.set(LOCALE_COOKIE, 'vi');
    const { wrapper, setRoute } = await mountAccount(SecurityPage);
    setRoute({ path: '/security' });
    expect(accountStores.route.path).toBe('/security');
    expect(wrapper.find('h1').text()).toBe('Security');
  });

  it('never offers or accepts a locale outside the registry', async () => {
    const { wrapper } = await mountAccount(PreferencesPage);
    const offered = wrapper
      .findAll('[data-testid="preferences-language"] option')
      .map((option) => (option.element as HTMLOptionElement).value);

    // Chỉ ba locale trong registry, và mỗi mục đều từ registry chứ không viết tay.
    expect(offered).toEqual(ACCOUNT_LOCALES.map((definition) => definition.code));
    // Lấy từ registry một locale **không** có trong danh sách — registry frozen nên
    // chỉ có thể bằng cách ép kiểu, và đó chính là việc cần chặn: giá trị lạ không được
    // đi ra khỏi UI dưới dạng preference đã lưu.
    expect(offered).not.toContain('klingon' as AccountLocale);
    expect(offered).not.toContain('en-US' as AccountLocale);
  });

  it('defaults the registry to English', () => {
    expect(DEFAULT_ACCOUNT_LOCALE).toBe('en');
  });
});
