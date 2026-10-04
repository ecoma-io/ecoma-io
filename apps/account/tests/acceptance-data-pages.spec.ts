/**
 * Chấp nhận các trang dữ liệu — bốn trạng thái và "không có nút chết".
 *
 * ⚠️ Yêu cầu sản phẩm là **mọi** trang dữ liệu phải có đủ loading/empty/error/success.
 * Test này dùng adapter **cố ý hỏng** để ép nhánh lỗi: mock mặc định trả dữ liệu tốt,
 * và nếu chỉ kiểm bằng mock mặc định thì nhánh lỗi không bao giờ chạy — trang vẫn "có
 * trạng thái lỗi" trên giấy mà không ai từng thấy nó render.
 *
 * ⚠️ Danh sách lời gọi **đọc** viết tay chứ không dò bằng tiền tố `get`: adapter có cả
 * `getProfile` lẫn `listEmails`, và một bộ lọc theo tiền tố sẽ âm thầm bỏ qua nửa còn
 * lại — nhánh lỗi của những trang danh sách sẽ không bao giờ được kiểm mà test vẫn xanh.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AccountAdapter, Result } from '../app/account-data/types';

import { createMockAccountAdapter } from '../app/account-data/mock-adapter';

import ProfilePage from '../app/pages/index.vue';
import EmailsPage from '../app/pages/emails.vue';
import SecurityPage from '../app/pages/security.vue';
import SessionsPage from '../app/pages/sessions.vue';
import ApplicationsPage from '../app/pages/applications.vue';
import PreferencesPage from '../app/pages/preferences.vue';
import NotificationsPage from '../app/pages/notifications.vue';
import PrivacyPage from '../app/pages/privacy.vue';
import { flushPromises, mountAccount } from './harness';

/**
 * Thu hẹp `Result<T>` sang nhánh thành công.
 *
 * ⚠️ Vì sao cần: `expect(result.ok).toBe(true)` rồi `if (result.ok) { … }` là cách
 * thông thường, nhưng `vitest/no-conditional-expect` cấm `expect` bên trong nhánh —
 * đúng, vì `it` không có `expect` nào chạy thì vẫn xanh. Hàm này **ném** thay vì
 * phủ định: nếu adapter trả `ok: false`, test đỏ ngay với lý do của chính adapter
 * thay vì im lặng bỏ qua phần còn lại.
 */
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`expected an ok result, got: ${result.reason}`);
  }
  return result.value;
}

type DataPage = {
  readonly name: string;
  readonly component: unknown;
  /** Trang có nhánh rỗng, hay luôn có dữ liệu vì nó là **một** object. */
  readonly hasEmpty: boolean;
  /** Trang có `useAsyncState` nhiều lần — adapter hỏng ở lần nào cũng phải ra lỗi. */
  readonly reads: readonly string[];
};

/**
 * ⚠️ `/preferences` và `/notifications` không có nhánh rỗng: chúng là một object
 * preference nên luôn có dữ liệu, và chỉ có loading/error/ready. `useAsyncState` cố ý bỏ
 * nhánh `empty` cho những trang đó — giữ nó nghĩa là có một template branch không bao
 * giờ tới mà vẫn phải viết `v-else-if`, và mọi lần sửa sau đó lại phải thêm một kiểm tra
 * cho nhánh chết đó.
 */
const DATA_PAGES: readonly DataPage[] = [
  {
    name: '/',
    component: ProfilePage,
    hasEmpty: true,
    reads: ['getProfile'],
  },
  {
    name: '/emails',
    component: EmailsPage,
    hasEmpty: true,
    reads: ['listEmails'],
  },
  {
    name: '/security',
    component: SecurityPage,
    hasEmpty: true,
    reads: ['getTotpState', 'getRecoveryCodesState', 'listPasskeys'],
  },
  {
    name: '/sessions',
    component: SessionsPage,
    hasEmpty: true,
    reads: ['listSessions'],
  },
  {
    name: '/applications',
    component: ApplicationsPage,
    hasEmpty: true,
    reads: ['listApplications'],
  },
  {
    name: '/preferences',
    component: PreferencesPage,
    hasEmpty: false,
    reads: ['getPreferences'],
  },
  {
    name: '/notifications',
    component: NotificationsPage,
    hasEmpty: false,
    reads: ['getNotificationPreferences'],
  },
  {
    name: '/privacy',
    component: PrivacyPage,
    hasEmpty: true,
    reads: ['listPrivacyRequests'],
  },
] as const;

/** Thông điệp mà adapter giả ném — test khẳng định nó **hiện ra**, không bị nuốt. */
const READ_FAILURE = 'adapter read failed';

/**
 * Adapter mà mọi lời gọi đọc trong `methods` đều ném lỗi.
 *
 * ⚠️ Đây là **hợp đồng thật**: `AccountAdapter` trả `Result` cho thao tác ghi và ném cho
 * lời gọi đọc, và `useAsyncState` bắt lỗi ném để dựng nhánh `error`. Adapter trả `Result`
 * lỗi cho một lời gọi đọc sẽ không bao giờ chạm tới nhánh lỗi của **trang**.
 */
function failingReads(base: AccountAdapter, methods: readonly string[]): AccountAdapter {
  const broken = new Set(methods);
  return new Proxy(base, {
    get(target, property, receiver) {
      const name = String(property);
      if (broken.has(name)) {
        return () => {
          throw new Error(READ_FAILURE);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

/** Adapter có sẵn dữ liệu **rỗng** cho mọi lời gọi đọc. */
function emptyReads(base: AccountAdapter, methods: readonly string[]): AccountAdapter {
  const emptied = new Set(methods);
  return new Proxy(base, {
    get(target, property, receiver) {
      const name = String(property);
      if (emptied.has(name)) {
        return async () => {
          // Profile rỗng nhất vẫn phải là **object**: `useAsyncState` gọi `isEmpty` trên nó
          // và template đọc `displayName`. Một object rỗng là hình dạng "không có thông
          // tin" mà `/` hiển thị, khác hẳn với một mảng rỗng.
          return name === 'getProfile' ? { displayName: '', avatarUrl: undefined } : [];
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

describe('data page states', () => {
  // Không bọc `describe(page.name, …)`: `vitest(valid-title)` đòi title của `describe`
  // phải là chuỗi tĩnh, mà `page.name` đến từ vòng lặp. Tên trang đã nằm trong chính
  // title của từng `it`, nên nhóm ngoài không mang thêm thông tin nào.
  for (const page of DATA_PAGES) {
    for (const read of page.reads) {
      // Title ghép từ `read` như một template literal **inline** — đây là dạng repo
      // đã dùng và lint chấp nhận (`vitest(valid-title)` chỉ phạt khi title đi qua
      // biến, vì lúc đó công cụ không đọc được tên test).
      it(`shows an error state when ${read} fails`, async () => {
        const { wrapper } = await mountAccount(page.component, {
          adapter: failingReads(createMockAccountAdapter(), [read]),
        });

        expect(wrapper.find('[data-testid="account-error"]').exists()).toBe(true);
        // Không được nuốt: nội dung lỗi phải hiện ra để người dùng có gì báo support.
        expect(wrapper.find('[data-testid="account-error-detail"]').text()).toContain(READ_FAILURE);
      });
    }

    it('shows an error state, not an empty one, when a read fails', async () => {
      const { wrapper } = await mountAccount(page.component, {
        adapter: failingReads(createMockAccountAdapter(), page.reads),
      });

      // Nhánh rỗng là trạng thái **riêng**: hiện nó khi đọc hỏng là nói dối người dùng
      // rằng họ không có dữ liệu, trong khi thật ra app không biết.
      expect(wrapper.find('[data-testid="account-error"]').exists()).toBe(true);
    });

    it('does not show an empty state for a read that failed', async () => {
      const { wrapper } = await mountAccount(page.component, {
        adapter: failingReads(createMockAccountAdapter(), page.reads),
      });

      expect(wrapper.find('[data-testid="account-empty"]').exists()).toBe(false);
    });

    it('renders its own content when the adapter succeeds', async () => {
      const { wrapper } = await mountAccount(page.component);

      expect(wrapper.find('[data-testid="account-error"]').exists()).toBe(false);
      expect(wrapper.find('h1').exists(), `${page.name} must have an h1`).toBe(true);
    });
  }

  describe('empty states', () => {
    for (const page of DATA_PAGES.filter((candidate) => candidate.hasEmpty)) {
      it(`${page.name} shows an empty state when the adapter returns nothing`, async () => {
        const { wrapper } = await mountAccount(page.component, {
          adapter: emptyReads(createMockAccountAdapter(), page.reads),
        });

        expect(wrapper.find('[data-testid="account-error"]').exists()).toBe(false);
        expect(
          wrapper.find('[data-testid="account-empty"]').exists(),
          `${page.name} must render an empty state`,
        ).toBe(true);
      });
    }

    for (const page of DATA_PAGES.filter((candidate) => !candidate.hasEmpty)) {
      it(`${page.name} has no empty state: its data is always one object`, async () => {
        const { wrapper } = await mountAccount(page.component);

        // Trang đã **tải xong** — thiếu nhánh rỗng là quyết định có chủ ý, không phải sót.
        expect(wrapper.find('[data-testid="account-error"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="account-empty"]').exists()).toBe(false);
      });
    }
  });
});

describe('interactive controls', () => {
  it('every button on /emails has a visible or explicit label', async () => {
    const { wrapper } = await mountAccount(EmailsPage);

    const buttons = wrapper.findAll('button');
    expect(buttons.length).toBeGreaterThan(0);

    for (const button of buttons) {
      const label =
        button.text().trim() || button.attributes('aria-label') || button.attributes('title');
      expect(label, `an unlabelled button is unusable: ${button.html()}`).toBeTruthy();
    }
  });

  it('every link on /emails points somewhere', async () => {
    const { wrapper } = await mountAccount(EmailsPage);

    for (const anchor of wrapper.findAll('a')) {
      // `href=""` là link chết — bấm không đi đâu.
      expect(anchor.attributes('href'), `a dead link: ${anchor.html()}`).toBeTruthy();
    }
  });

  it('every disabled control explains itself', async () => {
    const { wrapper } = await mountAccount(EmailsPage);

    // `<button disabled>` bị trình đọc màn hình bỏ qua, nên người dùng bàn phím cần một
    // lý do **hiện ra** — `title` là cách phổ biến nhất khi nút vẫn phải hiện.
    for (const control of wrapper.findAll('[disabled]')) {
      expect(
        control.attributes('title') ?? control.attributes('aria-label'),
        `a disabled control with no explanation: ${control.html()}`,
      ).toBeTruthy();
    }
  });

  it('every form field on /emails has an associated label element', async () => {
    const { wrapper } = await mountAccount(EmailsPage);

    for (const field of wrapper.findAll('input, select, textarea')) {
      const id = field.attributes('id');
      expect(id, `a field without an id cannot be labelled: ${field.html()}`).toBeTruthy();
      expect(wrapper.find(`label[for="${id}"]`).exists(), `no <label for="${id}">`).toBe(true);
    }
  });

  it('a new address is added through the adapter, not to a local copy', async () => {
    const { wrapper, adapter } = await mountAccount(EmailsPage);
    const before = await adapter.listEmails();

    await wrapper.find('[data-testid="email-new-address"]').setValue('new@example.com');
    await wrapper.find('[data-testid="email-add-form"]').trigger('submit');
    await wrapper.vm.$nextTick();

    const after = await adapter.listEmails();
    expect(after.length).toBe(before.length + 1);
    expect(after.some((email) => email.address === 'new@example.com')).toBe(true);
  });

  it('a new address starts unverified and is not the sign-in address', async () => {
    const { adapter } = await mountAccount(EmailsPage);
    const added = unwrap(await adapter.addEmail('fresh@example.com'));

    expect(added.status).toBe('pending');
    expect(added.isSignInAddress).toBe(false);
  });

  it('the sign-in address cannot be removed from the UI', async () => {
    const { wrapper, adapter } = await mountAccount(EmailsPage);
    const emails = await adapter.listEmails();
    const signIn = emails.find((email) => email.isSignInAddress);
    expect(signIn, 'the fixture must contain a sign-in address').toBeDefined();
    const id = signIn?.id ?? '';

    // Nút xoá tồn tại nhưng **bị vô hiệu hoá kèm lý do nhìn thấy được** — đây là mẫu a11y
    // đúng: bỏ hẳn nút thì người dùng không biết tại sao mình không xoá được.
    const remove = wrapper.find(`[data-testid="email-remove-${id}"]`);
    expect(remove.exists()).toBe(true);
    expect(
      remove.attributes('disabled'),
      'removing the sign-in address must be disabled',
    ).toBeDefined();
    expect(remove.attributes('title') ?? '', 'a disabled control must explain itself').not.toBe('');
    expect(wrapper.find(`[data-testid="email-blocked-${id}"]`).exists()).toBe(true);

    // Và nếu ai đó gọi thẳng adapter thì hợp đồng vẫn giữ.
    const removed = await adapter.removeEmail(id);
    expect(removed.ok).toBe(false);
  });

  it('the current session cannot be revoked from the UI', async () => {
    const { wrapper, adapter } = await mountAccount(SessionsPage);
    const sessions = await adapter.listSessions();
    const current = sessions.find((session) => session.isCurrent);
    const other = sessions.find((session) => !session.isCurrent);
    expect(current, 'the fixture must contain a current session').toBeDefined();
    expect(other, 'the fixture must contain another session').toBeDefined();

    // Không có nút thu hồi cho chính session đang dùng — thu hồi nó nghĩa là tự đuổi
    // mình ra khỏi tài khoản ngay giữa thao tác.
    expect(wrapper.find(`[data-testid="session-revoke-${current?.id}"]`).exists()).toBe(false);
    expect(wrapper.find(`[data-testid="session-revoke-${other?.id}"]`).exists()).toBe(true);
  });

  it('a high-risk application is flagged from the adapter, not by the UI', async () => {
    const { wrapper, adapter } = await mountAccount(ApplicationsPage);
    const applications = await adapter.listApplications();
    const risky = applications.filter((application) => application.highRisk);
    expect(risky.length).toBeGreaterThan(0);

    // Cờ rủi ro là **dữ liệu của BFF**, không phải phán đoán của UI: UI chỉ hiển thị.
    expect(wrapper.findAll('[data-testid="application-high-risk"]').length).toBe(risky.length);
  });

  it('reverts a notification toggle and reports failure when the write cannot reach the server', async () => {
    // Adapter thật reject khi mạng lỗi (`$fetch`); chỉ trả `Result` cho lỗi nghiệp
    // vụ. Không bắt thì toggle giữ vị trí người dùng bấm trong khi server chưa
    // nhận — đúng thứ khối chú thích của trang cấm ("nói dối rằng lựa chọn đã
    // được giữ").
    const { wrapper, adapter } = await mountAccount(NotificationsPage);
    await flushPromises();
    const checkbox = wrapper.find('[data-testid="notification-serviceEmail"]');
    expect((checkbox.element as HTMLInputElement).checked).toBe(true);

    vi.spyOn(adapter, 'updateNotificationPreferences').mockRejectedValueOnce(
      new Error('network down'),
    );
    await checkbox.setValue(false);
    await flushPromises();

    expect(wrapper.find('[data-testid="account-result"]').attributes('data-tone')).toBe('danger');
    expect(
      (wrapper.find('[data-testid="notification-serviceEmail"]').element as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it('writes preferences once per save, not twice', async () => {
    // Trước đây `save()` gửi patch ba trường rồi còn gọi `chooseAndPersist` — mỗi
    // lần là một `updatePreferences` thật. Hai lần ghi: lần thứ hai hỏng trong
    // khi lần đầu thành công thì UI báo thất bại cho thay đổi đã nằm trên server.
    const { wrapper, adapter } = await mountAccount(PreferencesPage);
    await flushPromises();

    const updatePreferences = vi.spyOn(adapter, 'updatePreferences');
    await wrapper.find('[data-testid="preferences-form"]').trigger('submit');
    await flushPromises();

    expect(updatePreferences).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="account-result"]').attributes('data-tone')).toBe('success');
  });

  it('says colour mode is not applied yet instead of pretending it works', async () => {
    // `preferences.colorMode` chưa được shell áp (chưa có theme class, chưa có
    // token dark): lưu "Thành công" rồi không có gì đổi chính là thứ trang này
    // cấm. Control phải nói ra trạng thái thật, có lý do nhìn thấy được.
    const { wrapper } = await mountAccount(PreferencesPage);
    await flushPromises();

    const fieldset = wrapper.find('[data-testid="preferences-color-mode"]');
    expect(fieldset.attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="preferences-color-mode-hint"]').text()).toContain(
      'not applied yet',
    );
  });
});

describe('security page interactions', () => {
  it('closes the confirmation dialog after removing a passkey', async () => {
    const { wrapper } = await mountAccount(SecurityPage);
    await wrapper.find('[data-testid="passkey-remove-passkey-1"]').trigger('click');
    await flushPromises();

    const dialog = wrapper.find('[data-testid="account-dialog"]');
    expect(dialog.attributes('open')).toBeDefined();

    await wrapper.find('[data-testid="account-dialog-confirm"]').trigger('click');
    await flushPromises();

    // `removing` phải được reset ngay sau thao tác: không thì `open` vẫn true,
    // dialog treo vĩnh viễn, nút xác nhận lại enable và bấm lần nữa sẽ gỡ một id
    // đã bị gỡ — đúng lỗi mà hai trang anh em (`sessions`, `applications`) đã tránh.
    expect(dialog.attributes('open')).toBeUndefined();
    expect(wrapper.find('[data-testid="account-result"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="account-result"]').attributes('data-tone')).toBe('success');
  });

  it('reports a failed removal and keeps the passkey list intact', async () => {
    const { wrapper } = await mountAccount(SecurityPage, {
      adapterOptions: { failWrites: ['removePasskey'] },
    });
    await wrapper.find('[data-testid="passkey-remove-passkey-1"]').trigger('click');
    await flushPromises();
    await wrapper.find('[data-testid="account-dialog-confirm"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="account-result"]').attributes('data-tone')).toBe('danger');
    // Vẫn hiển thị danh sách passkey — thao tác hỏng không được xoá OptimisticListItem.
    expect(wrapper.find('[data-testid="passkey-list"]').exists()).toBe(true);
  });
});
