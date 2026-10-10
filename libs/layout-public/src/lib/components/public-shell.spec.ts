// @vitest-environment jsdom
import type { PublicLocale } from '@ecoma-io/i18n-public';
import { mount } from '@vue/test-utils';
import { PublicFooter, PublicHeader, PublicShell, parsePublicLayoutPath } from '../../index';

/**
 * Lib tsconfig không có DOM lib — MouseEvent chỉ tồn tại runtime (jsdom).
 * Helper này expose đúng phần test cần: tạo event và đọc `defaultPrevented`.
 */
function domClick(init: { ctrlKey?: boolean }): { defaultPrevented: boolean } {
  const env = globalThis as unknown as {
    MouseEvent: new (t: string, i: object) => { defaultPrevented: boolean };
  };
  return new env.MouseEvent('click', { cancelable: true, ...init });
}

describe('PublicShell composition', () => {
  it('renders header, main and footer landmarks around slot content', () => {
    const wrapper = mount(PublicShell, {
      props: { path: '/en/blog' },
      slots: { default: '<div class="app-page">APP_CONTENT</div>' },
    });

    const html = wrapper.html();
    expect(wrapper.find('header').exists()).toBe(true);
    expect(wrapper.find('main').exists()).toBe(true);
    expect(wrapper.find('footer').exists()).toBe(true);
    expect(wrapper.find('main').text()).toBe('APP_CONTENT');

    // Thứ tự: header (mở) → main → footer; `<main id=` khớp landmark chính,
    // không trúng `public-main` xuất hiện trước trong skip link của header.
    expect(html.indexOf('<header')).toBeLessThan(html.indexOf('<main id='));
    expect(html.indexOf('<main id=')).toBeLessThan(html.indexOf('<footer'));
  });

  it('keeps application content out of header and footer', () => {
    const wrapper = mount(PublicShell, {
      props: { path: '/vi/docs' },
      slots: { default: '<div>APP_UNIQUE_MARKER_42</div>' },
    });
    expect(wrapper.find('header').html()).not.toContain('APP_UNIQUE_MARKER_42');
    expect(wrapper.find('footer').html()).not.toContain('APP_UNIQUE_MARKER_42');
    expect(wrapper.find('main').html()).toContain('APP_UNIQUE_MARKER_42');
  });

  it('updates chrome reactively when the path prop changes', async () => {
    // Pin reactivity của props destructure trong computed: đổi path (client-side
    // navigation) thì Header/Footer phải re-render theo, không giữ snapshot.
    const wrapper = mount(PublicShell, { props: { path: '/en/blog' } });
    expect(wrapper.find('header a[href="/en"]').attributes('href')).toBe('/en');

    await wrapper.setProps({ path: '/vi/docs' });

    expect(wrapper.find('header a[href="/vi"]').attributes('href')).toBe('/vi');
    // Trigger Docs là disclosure link (`a[href="/vi/docs"]` + aria-expanded);
    // panel đóng vẫn nằm trong DOM (chỉ `hidden`), nên đếm anchor **cấp
    // top-level** của nav (`nav > ul > li > a`) sẽ thấy cả trigger lẫn Blog —
    // lấy link khác trigger để xác nhận chỉ Blog là link thường.
    const links = wrapper.findAll('header nav[aria-label="Global"] > ul > li > a');
    expect(links.map((link) => link.attributes('href'))).toEqual(['/vi/blog', '/vi/docs']);
    expect(links[1]?.text()).toContain('Docs');
    expect(wrapper.find('footer a').attributes('href')).toBe('/vi');
  });

  it('renders without crashing on every path class', () => {
    for (const path of ['/', '/en', '/vi/docs/api', '/en/unknown', 'garbage']) {
      expect(() => mount(PublicShell, { props: { path }, slots: { default: 'X' } })).not.toThrow();
    }
  });
});

describe('PublicHeader', () => {
  it('renders a skip link to the main landmark as the first focusable element', () => {
    const wrapper = mount(PublicShell, { props: { path: '/en/docs/api' } });
    const first = wrapper.find('header a');
    expect(first.attributes('href')).toBe('#public-main');
    expect(wrapper.find('main').attributes('id')).toBe('public-main');
  });

  it('links the brand to the locale-root surface', () => {
    const wrapper = mount(PublicShell, { props: { path: '/en/docs/api' } });
    const brand = wrapper.find('header a[href="/en"]');
    // Brand là artwork logo (`EcomaLogo` render `<img>`), accessible name đến
    // từ `alt` — không còn text node để assert; pin cả alt lẫn src.
    expect(brand.find('img[alt="ecoma.io"]').exists()).toBe(true);
    expect(brand.find('img[src*="ecoma-logo-horizontal"]').exists()).toBe(true);
  });

  it('renders global navigation with locale-aware hrefs', () => {
    const wrapper = mount(PublicShell, { props: { path: '/vi/blog' } });
    const nav = wrapper.find('header nav[aria-label="Global"]');
    expect(nav.exists()).toBe(true);
    // Mọi mục nav cấp cao nhất đều là `<a href>` thật — kể cả trigger Docs
    // (no-JS và crawler vẫn có link tới docs). Combinator trực tiếp `>` để
    // không trúng link trong mega panel.
    const topLinks = nav.findAll(':scope > ul > li > a');
    expect(topLinks.map((link) => link.attributes('href'))).toEqual(['/vi/blog', '/vi/docs']);
    expect(topLinks[0]?.text()).toBe('Blog');
    const trigger = topLinks[1];
    expect(trigger?.text()).toContain('Docs');
    expect(trigger?.attributes('aria-expanded')).toBe('false');
    expect(trigger?.attributes('aria-controls')).toBe('public-header-docs-panel');
  });

  it('opens the docs disclosure to reveal mount root and section links', async () => {
    const wrapper = mount(PublicShell, { props: { path: '/en' } });
    const trigger = wrapper.find('header nav[aria-label="Global"] a[href="/en/docs"]');
    expect(trigger.attributes('aria-expanded')).toBe('false');
    // Panel luôn trong DOM, đóng bằng `hidden` — không nằm trong accessibility
    // tree khi đóng.
    const panel = wrapper.find('#public-header-docs-panel');
    expect(panel.attributes('hidden')).toBeDefined();

    await trigger.trigger('click');

    expect(trigger.attributes('aria-expanded')).toBe('true');
    expect(panel.attributes('hidden')).toBeUndefined();
    const links = panel.findAll('a');
    const hrefs = links.map((link) => link.attributes('href'));
    expect(hrefs).toEqual([
      '/en/docs',
      '/en/docs/getting-started',
      '/en/docs/concepts',
      '/en/docs/guides',
    ]);
  });

  it('lets modifier-click through so new-tab navigation reaches the mount root', async () => {
    // `@click.exact.prevent`: guard `exact` chạy trước `prevent` trong
    // withModifiers — modifier-click KHÔNG bị preventDefault (đi native mở
    // tab mới) và panel không toggle. Assert cả defaultPrevented: thứ tự
    // đảo (`prevent.exact`) sẽ prevent rồi mới return — click chết, và test
    // chỉ assert aria-expanded sẽ không bắt được.
    const wrapper = mount(PublicShell, { props: { path: '/en' } });
    const trigger = wrapper.find('header nav[aria-label="Global"] a[href="/en/docs"]');

    const event = domClick({ ctrlKey: true });
    (trigger.element as { dispatchEvent(e: unknown): boolean }).dispatchEvent(event);
    await wrapper.vm.$nextTick();

    expect(event.defaultPrevented).toBe(false);
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('#public-header-docs-panel').attributes('hidden')).toBeDefined();
  });

  it('prevents plain clicks so the panel toggles instead of navigating', async () => {
    // Chiều đối xứng: click thuần bị preventDefault (không điều hướng) và
    // toggle panel.
    const wrapper = mount(PublicShell, { props: { path: '/en' } });
    const trigger = wrapper.find('header nav[aria-label="Global"] a[href="/en/docs"]');

    const event = domClick({});
    (trigger.element as { dispatchEvent(e: unknown): boolean }).dispatchEvent(event);
    await wrapper.vm.$nextTick();

    expect(event.defaultPrevented).toBe(true);
    expect(trigger.attributes('aria-expanded')).toBe('true');
    expect(wrapper.find('#public-header-docs-panel').attributes('hidden')).toBeUndefined();
  });

  it('marks the exact current mount with aria-current=page', () => {
    const wrapper = mount(PublicShell, { props: { path: '/en/blog' } });
    const nav = wrapper.find('header nav[aria-label="Global"]');
    // Blog (link thường) là trang hiện tại.
    expect(nav.find('a[href="/en/blog"]').attributes('aria-current')).toBe('page');
    // Trigger Docs (disclosure link) mang section sense — ở đây không active.
    expect(nav.find('a[href="/en/docs"]').attributes('aria-current')).toBeUndefined();
  });

  it('marks a nested mount with aria-current=true on the parent trigger', () => {
    // docs/api không có mục riêng trong global nav — pathname dưới mount lồng
    // nhau vẫn hiện thị section cha là đang active, trên chính trigger.
    const wrapper = mount(PublicShell, { props: { path: '/en/docs/api/guide' } });
    const nav = wrapper.find('header nav[aria-label="Global"]');
    expect(nav.find('a[href="/en/docs"]').attributes('aria-current')).toBe('true');
    expect(nav.find('a[href="/en/blog"]').attributes('aria-current')).toBeUndefined();
  });

  it('marks a child resource of the current mount with aria-current=true, not page', () => {
    // Trigger Docs trỏ mount root; pathname /en/docs/hello-world là trang con
    // của mount docs — 'page' sẽ sai semantics ARIA, section sense là 'true'.
    const wrapper = mount(PublicShell, { props: { path: '/en/docs/hello-world' } });
    const nav = wrapper.find('header nav[aria-label="Global"]');
    expect(nav.find('a[href="/en/docs"]').attributes('aria-current')).toBe('true');
    expect(nav.find('a[href="/en/blog"]').attributes('aria-current')).toBeUndefined();
  });

  it('renders no aria-current on the locale-root surface', () => {
    const wrapper = mount(PublicShell, { props: { path: '/en' } });
    const nav = wrapper.find('header nav[aria-label="Global"]');
    for (const el of nav.findAll('a')) {
      expect(el.attributes('aria-current')).toBeUndefined();
    }
  });

  it('renders the locale switcher linking to the same resource in the other locale', () => {
    const wrapper = mount(PublicShell, { props: { path: '/en/docs/api' } });
    const language = wrapper.find('header nav[aria-label="Language"]');
    expect(language.exists()).toBe(true);

    const link = language.find('a');
    expect(link.text()).toBe('Tiếng Việt');
    expect(link.attributes('href')).toBe('/vi/docs/api');
    expect(link.attributes('hreflang')).toBe('vi-VN');
    expect(link.attributes('lang')).toBe('vi');

    // Locale hiện tại hiển thị dạng text, không phải link tự trỏ.
    expect(language.text()).toContain('English');
    expect(language.findAll('a')).toHaveLength(1);
  });

  it('switches locale on the locale-root surface too', () => {
    const wrapper = mount(PublicShell, { props: { path: '/vi' } });
    const link = wrapper.find('header nav[aria-label="Language"] a');
    expect(link.attributes('href')).toBe('/en');
    expect(link.attributes('hreflang')).toBe('en');
  });

  it('renders no locale-aware chrome for the bare root path', () => {
    const wrapper = mount(PublicShell, { props: { path: '/' } });
    expect(wrapper.find('header nav[aria-label="Global"]').exists()).toBe(false);
    expect(wrapper.find('header nav[aria-label="Language"]').exists()).toBe(false);
    // Brand trỏ `/` khi chưa có locale; skip link luôn trỏ `#public-main`.
    expect(wrapper.find('header a[href="/"]').exists()).toBe(true);
  });

  it('renders no locale-aware chrome for an invalid path', () => {
    const wrapper = mount(PublicShell, { props: { path: '/en/unknown' } });
    expect(wrapper.find('header nav[aria-label="Global"]').exists()).toBe(false);
    expect(wrapper.find('header nav[aria-label="Language"]').exists()).toBe(false);
    expect(wrapper.find('header a[href="/"]').exists()).toBe(true);
    // Shell vẫn render được khung cho trang lỗi — không throw.
    expect(wrapper.find('main').exists()).toBe(true);
  });

  it('consumes parsed layout state directly without a path prop', () => {
    // Boundary test: Header không tự parse pathname — nó chỉ đọc state mà
    // shell đã parse xong.
    const wrapper = mount(PublicHeader, {
      props: { layout: parsePublicLayoutPath('/vi/docs') },
    });
    const nav = wrapper.find('nav[aria-label="Global"]');
    expect(nav.find('a[href="/vi/blog"]').attributes('href')).toBe('/vi/blog');
    // /vi/docs dừng đúng mount root → trigger Docs (disclosure link) mang
    // section sense 'page' (như link thường).
    expect(nav.find('a[href="/vi/docs"]').attributes('aria-current')).toBe('page');
    expect(wrapper.find('nav[aria-label="Language"] a').attributes('href')).toBe('/en/docs');
  });
});

describe('PublicHeader locale availability', () => {
  it('renders only the current locale when it is the single available locale', () => {
    const wrapper = mount(PublicShell, {
      props: { path: '/en/docs/api', availableLocales: ['en'] },
    });
    const language = wrapper.find('header nav[aria-label="Language"]');
    expect(language.exists()).toBe(true);
    // Chỉ en: current hiển thị dạng text, không có link sang locale nào.
    expect(language.findAll('a')).toHaveLength(0);
    expect(language.text()).toContain('English');
    expect(language.text()).not.toContain('Tiếng Việt');
    // Không sinh link tới locale ngoài context ở bất kỳ đâu trong header.
    expect(wrapper.find('header').html()).not.toContain('/vi');
  });

  it('renders both locales when both are available', () => {
    const wrapper = mount(PublicShell, {
      props: { path: '/en/docs/api', availableLocales: ['en', 'vi'] },
    });
    const language = wrapper.find('header nav[aria-label="Language"]');
    expect(language.text()).toContain('English');
    const link = language.find('a');
    expect(link.text()).toBe('Tiếng Việt');
    expect(link.attributes('href')).toBe('/vi/docs/api');
    expect(link.attributes('hreflang')).toBe('vi-VN');
  });

  it('always renders the current locale even when it is missing from availableLocales', () => {
    // Invariant: current luôn hợp lệ trong context — app không liệt kê 'en'
    // thì 'en' vẫn được render (và 'vi' vẫn link được vì có trong list).
    const wrapper = mount(PublicShell, {
      props: { path: '/en/blog', availableLocales: ['vi'] },
    });
    const language = wrapper.find('header nav[aria-label="Language"]');
    expect(language.text()).toContain('English');
    expect(language.find('a').attributes('href')).toBe('/vi/blog');
  });

  it('preserves existing switcher behavior when availableLocales is omitted', () => {
    const wrapper = mount(PublicShell, { props: { path: '/en/docs' } });
    const language = wrapper.find('header nav[aria-label="Language"]');
    expect(language.text()).toContain('English');
    const links = language.findAll('a');
    expect(links.map((link) => link.attributes('href'))).toEqual(['/vi/docs']);
  });

  it('drops values outside the locale registry instead of linking to them', () => {
    // Invalid/unexpected input (JS caller ép kiểu): kế thừa contract
    // i18n-public — so khớp exact, giá trị lạ bị loại, không throw.
    const wrapper = mount(PublicShell, {
      props: {
        path: '/en/blog',
        availableLocales: ['en', 'de'] as unknown as readonly PublicLocale[],
      },
    });
    const language = wrapper.find('header nav[aria-label="Language"]');
    expect(language.exists()).toBe(true);
    expect(language.text()).toContain('English');
    expect(language.findAll('a')).toHaveLength(0);
    expect(wrapper.find('header').html()).not.toContain('/de');
    expect(wrapper.find('header').html()).not.toContain('/vi');
  });

  it('updates the switcher reactively when availableLocales changes', async () => {
    const wrapper = mount(PublicShell, {
      props: { path: '/en/blog', availableLocales: ['en'] },
    });
    expect(wrapper.find('header nav[aria-label="Language"]').findAll('a')).toHaveLength(0);

    await wrapper.setProps({ availableLocales: ['en', 'vi'] });

    const link = wrapper.find('header nav[aria-label="Language"] a');
    expect(link.attributes('href')).toBe('/vi/blog');
  });

  it('keeps global navigation and brand unaffected by availability', () => {
    // Availability chỉ giới hạn locale switcher — nav mount và brand giữ nguyên.
    const wrapper = mount(PublicShell, {
      props: { path: '/en/blog', availableLocales: ['en'] },
    });
    expect(wrapper.find('header a[href="/en"]').exists()).toBe(true);
    const nav = wrapper.find('header nav[aria-label="Global"]');
    expect(nav.find('a[href="/en/blog"]').exists()).toBe(true);
    expect(nav.find('a[href="/en/docs"]').text()).toContain('Docs');
  });

  it('renders the brand logo with fallback size classes and intrinsic ratio intact', () => {
    // Sizing contract: header đặt `block h-6 w-auto` qua class fallthrough của
    // EcomaLogo (CSS-only — HTML width/height giữ nguyên cặp intrinsic
    // 160×46 để `<img>` có ratio, tránh CLS; `block` bỏ descender gap của
    // inline `<img>`). Pin lại để không ai xoá `w-auto` (một mình `h-6` bóp méo
    // artwork) hay đè width/height attrs.
    const wrapper = mount(PublicShell, { props: { path: '/en' } });
    const brandImg = wrapper.find('header a[href="/en"] img');
    expect(brandImg.classes()).toEqual(expect.arrayContaining(['block', 'h-6', 'w-auto']));
    expect(brandImg.attributes('width')).toBe('160');
    expect(brandImg.attributes('height')).toBe('46');
    expect(brandImg.attributes('alt')).toBe('ecoma.io');
  });
});

describe('PublicFooter', () => {
  it('renders shared brand and copyright without application content', () => {
    const wrapper = mount(PublicShell, { props: { path: '/vi/blog' } });
    const footer = wrapper.find('footer');
    // Brand footer là artwork logo (img alt="ecoma.io") — anchor brand giữ
    // toàn bộ contract thị giác: `bg-white` là điều kiện DUY NHẤT giữ wordmark
    // tối của artwork đọc được trên nền slate-950 (artwork cấm recolor, xem
    // AGENTS.md), `h-6 w-auto` là sizing CSS-only, `block` bỏ descender gap
    // để padding plate đều. Pin cả bộ để xoá nhầm một class vẫn đỏ test.
    const brand = footer.find('a[href="/vi"]');
    expect(brand.classes()).toContain('bg-white');
    expect(brand.text()).toBe('');
    const brandImg = brand.find('img');
    expect(brandImg.classes()).toEqual(expect.arrayContaining(['block', 'h-6', 'w-auto']));
    expect(brandImg.attributes('alt')).toBe('ecoma.io');
    expect(brandImg.attributes('src')).toContain('ecoma-logo-horizontal');
    expect(footer.text()).toContain('© ecoma.io');
  });

  it('falls back to / for the brand on root and invalid paths', () => {
    for (const path of ['/', '/en/unknown']) {
      const wrapper = mount(PublicFooter, { props: { layout: parsePublicLayoutPath(path) } });
      expect(wrapper.find('a').attributes('href')).toBe('/');
    }
  });

  it('contains no navigation and no runtime state', () => {
    const wrapper = mount(PublicFooter, {
      props: { layout: parsePublicLayoutPath('/en') },
    });
    expect(wrapper.find('nav').exists()).toBe(false);
    expect(wrapper.html()).not.toContain('undefined');
  });
});
