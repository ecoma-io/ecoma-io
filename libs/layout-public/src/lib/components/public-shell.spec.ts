// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { PublicFooter, PublicHeader, PublicShell, parsePublicLayoutPath } from '../../index';

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

    // Thứ tự: header → main (nội dung app) → footer.
    expect(html.indexOf('<header')).toBeLessThan(html.indexOf('<main'));
    expect(html.indexOf('<main')).toBeLessThan(html.indexOf('<footer'));
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
    expect(wrapper.find('header a').attributes('href')).toBe('/en');

    await wrapper.setProps({ path: '/vi/docs' });

    expect(wrapper.find('header a').attributes('href')).toBe('/vi');
    const links = wrapper.find('header nav[aria-label="Global"]').findAll('a');
    expect(links.map((link) => link.attributes('href'))).toEqual(['/vi/blog', '/vi/docs']);
    expect(links[1].attributes('aria-current')).toBe('page');
    expect(wrapper.find('footer a').attributes('href')).toBe('/vi');
  });

  it('renders without crashing on every path class', () => {
    for (const path of ['/', '/en', '/vi/docs/api', '/en/unknown', 'garbage']) {
      expect(() => mount(PublicShell, { props: { path }, slots: { default: 'X' } })).not.toThrow();
    }
  });
});

describe('PublicHeader', () => {
  it('links the brand to the locale-root surface', () => {
    const wrapper = mount(PublicShell, { props: { path: '/en/docs/api' } });
    const brand = wrapper.find('header a');
    expect(brand.text()).toBe('ecoma.io');
    expect(brand.attributes('href')).toBe('/en');
  });

  it('renders global navigation with locale-aware hrefs', () => {
    const wrapper = mount(PublicShell, { props: { path: '/vi/blog' } });
    const nav = wrapper.find('header nav[aria-label="Global"]');
    expect(nav.exists()).toBe(true);
    const links = nav.findAll('a');
    expect(links.map((link) => [link.text(), link.attributes('href')])).toEqual([
      ['Blog', '/vi/blog'],
      ['Docs', '/vi/docs'],
    ]);
  });

  it('marks the exact current mount with aria-current=page', () => {
    const wrapper = mount(PublicShell, { props: { path: '/en/blog' } });
    const links = wrapper.find('header nav[aria-label="Global"]').findAll('a');
    expect(links[0].attributes('aria-current')).toBe('page');
    expect(links[1].attributes('aria-current')).toBeUndefined();
  });

  it('marks a nested mount with aria-current=true on the parent item', () => {
    // docs/api không có mục riêng trong global nav — pathname dưới mount lồng
    // nhau vẫn hiện thị section cha là đang active.
    const wrapper = mount(PublicShell, { props: { path: '/en/docs/api/guide' } });
    const links = wrapper.find('header nav[aria-label="Global"]').findAll('a');
    expect(links[1].attributes('aria-current')).toBe('true');
    expect(links[0].attributes('aria-current')).toBeUndefined();
  });

  it('marks a child resource of the current mount with aria-current=true, not page', () => {
    // Link Blog trỏ /en/blog; pathname /en/blog/hello-world là trang con,
    // không phải chính link đó — 'page' sẽ sai semantics ARIA.
    const wrapper = mount(PublicShell, { props: { path: '/en/blog/hello-world' } });
    const links = wrapper.find('header nav[aria-label="Global"]').findAll('a');
    expect(links[0].attributes('aria-current')).toBe('true');
    expect(links[1].attributes('aria-current')).toBeUndefined();
  });

  it('renders no aria-current on the locale-root surface', () => {
    const wrapper = mount(PublicShell, { props: { path: '/en' } });
    const links = wrapper.find('header nav[aria-label="Global"]').findAll('a');
    for (const link of links) {
      expect(link.attributes('aria-current')).toBeUndefined();
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
    expect(wrapper.find('header a').attributes('href')).toBe('/');
  });

  it('renders no locale-aware chrome for an invalid path', () => {
    const wrapper = mount(PublicShell, { props: { path: '/en/unknown' } });
    expect(wrapper.find('header nav[aria-label="Global"]').exists()).toBe(false);
    expect(wrapper.find('header nav[aria-label="Language"]').exists()).toBe(false);
    expect(wrapper.find('header a').attributes('href')).toBe('/');
    // Shell vẫn render được khung cho trang lỗi — không throw.
    expect(wrapper.find('main').exists()).toBe(true);
  });

  it('consumes parsed layout state directly without a path prop', () => {
    // Boundary test: Header không tự parse pathname — nó chỉ đọc state mà
    // shell đã parse xong.
    const wrapper = mount(PublicHeader, {
      props: { layout: parsePublicLayoutPath('/vi/docs') },
    });
    const links = wrapper.find('nav[aria-label="Global"]').findAll('a');
    expect(links.map((link) => link.attributes('href'))).toEqual(['/vi/blog', '/vi/docs']);
    expect(wrapper.find('nav[aria-label="Language"] a').attributes('href')).toBe('/en/docs');
  });
});

describe('PublicFooter', () => {
  it('renders shared brand and copyright without application content', () => {
    const wrapper = mount(PublicShell, { props: { path: '/vi/blog' } });
    const footer = wrapper.find('footer');
    expect(footer.find('a').text()).toBe('ecoma.io');
    expect(footer.find('a').attributes('href')).toBe('/vi');
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
