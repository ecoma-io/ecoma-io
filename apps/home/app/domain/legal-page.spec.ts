// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Component } from 'vue';

/**
 * Render test cho trang policy (`app/pages/[locale]/legal/[slug].vue`) —
 * trong jsdom, qua `@vue/test-utils` mount. Phạm vi: việc ghép
 * `parseLegalPage` + `buildLegalSeo` + `LEGAL_CONTENT` với `PublicShell`.
 *
 * SSR thật (node, không DOM) cho shell chrome đã được phủ ở `home-ssr.spec.ts`
 * cho page Home; shell render một đường như nhau cho mọi app content, nên ở
 * đây chỉ cần cây component và head input.
 *
 * Nuxt auto-import cung cấp các macro/composable như biến toàn cục; ở đây
 * chúng được stub trước khi mount. `definePageMeta` là stub rỗng — luật
 * validate đã được phủ trực tiếp ở `legal-locale.spec.ts`.
 */

vi.stubGlobal('definePageMeta', (): void => undefined);
vi.stubGlobal('createError', (options: { statusCode: number; statusMessage: string }): Error =>
  Object.assign(new Error(options.statusMessage), options),
);

/** Input `useHead` của lần render gần nhất — ghi lại thay vì bỏ qua. */
type RecordedHead = {
  readonly htmlAttrs?: { readonly lang?: string };
  readonly title?: string;
  readonly meta?: readonly { readonly name?: string; readonly content?: string }[];
  readonly link?: readonly { readonly rel?: string; readonly href?: string }[];
};

let recordedHead: RecordedHead | undefined;
vi.stubGlobal('useHead', (input: RecordedHead): void => {
  recordedHead = input;
});

/** Path mà `useRoute()` trả về — đổi trước mỗi lần mount. */
let currentPath = '/en/legal/privacy';
vi.stubGlobal('useRoute', () => ({ path: currentPath }));

let LegalPage: Component;

beforeAll(async () => {
  // Dynamic import sau khi stub: import tĩnh bị ESM hoist lên trước `stubGlobal`.
  LegalPage = ((await import('~/pages/[locale]/legal/[slug].vue')) as { default: Component })
    .default;
});

function render(path: string) {
  currentPath = path;
  recordedHead = undefined;
  return mount(LegalPage);
}

describe('app/pages/[locale]/legal/[slug].vue', () => {
  it('render trang privacy tiếng Anh: h1, đề mục h2, đoạn văn và head đúng', () => {
    const wrapper = render('/en/legal/privacy');
    const text = wrapper.text();

    expect(text).toContain('Privacy Policy');
    expect(text).toContain('Data we collect');
    expect(wrapper.find('h1').exists()).toBe(true);
    expect(wrapper.findAll('h2').length).toBeGreaterThan(0);
    expect(wrapper.find('header').exists()).toBe(true);
    expect(wrapper.find('footer').exists()).toBe(true);
    // Shell nhận `route.path` nên brand dựng theo chính locale của trang.
    expect(wrapper.find('header a[href="/en"]').exists()).toBe(true);

    expect(recordedHead?.htmlAttrs?.lang).toBe('en');
    expect(recordedHead?.title).toBe('Privacy Policy — ecoma.io');
    const canonical = recordedHead?.link?.find((link) => link.rel === 'canonical')?.href;
    expect(canonical).toBe('https://ecoma.io/en/legal/privacy');
  });

  it('render trang terms tiếng Việt khi pathname là /vi/legal/terms', () => {
    const wrapper = render('/vi/legal/terms');
    const text = wrapper.text();

    expect(text).toContain('Điều khoản dịch vụ');
    expect(text).toContain('Sử dụng hợp lệ');
    expect(text).not.toContain('Acceptable use');
    expect(wrapper.find('header a[href="/vi"]').exists()).toBe(true);

    expect(recordedHead?.htmlAttrs?.lang).toBe('vi-VN');
    const canonical = recordedHead?.link?.find((link) => link.rel === 'canonical')?.href;
    expect(canonical).toBe('https://ecoma.io/vi/legal/terms');
  });

  it('mỗi slug render đúng trang của mình — không rò nội dung chéo', () => {
    const privacy = render('/en/legal/privacy').text();
    const refund = render('/en/legal/refund').text();
    expect(privacy).toContain('personal data');
    expect(privacy).not.toContain('refund can be requested');
    expect(refund).toContain('refund');
    expect(refund).not.toContain('Data we collect');
  });

  it('mọi pathname không phải trang legal hợp lệ đều 404 — không fallback âm thầm', () => {
    for (const path of ['/', '/en', '/en/legal', '/en/legal/unknown', '/en/legal/privacy/x']) {
      expect(() => render(path)).toThrowError(/Page Not Found/u);
      expect(recordedHead).toBeUndefined();
    }
  });
});
