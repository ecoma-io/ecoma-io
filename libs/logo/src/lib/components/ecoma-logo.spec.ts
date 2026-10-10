// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { ECOMA_LOGO_HORIZONTAL_SVG_URL, EcomaLogo } from '../../index';

describe('EcomaLogo', () => {
  it('renders an img pointing at the bundled SVG asset URL', () => {
    const wrapper = mount(EcomaLogo);

    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe(ECOMA_LOGO_HORIZONTAL_SVG_URL);
  });

  it('anchors the asset URL to the real SVG source file', () => {
    // Neo URL vào đúng artwork nguồn: nếu đổi import sang asset khác hoặc
    // xoá nhầm file, assertion này đỏ — không chỉ so src với chính constant
    // (tautology). Vite giữ base filename cả dev lẫn build hashed nên
    // assertion hold ở cả hai chế độ.
    expect(ECOMA_LOGO_HORIZONTAL_SVG_URL.endsWith('ecoma-logo-horizontal.svg')).toBe(true);
  });

  it('defaults alt text to the brand name', () => {
    const wrapper = mount(EcomaLogo);

    expect(wrapper.find('img').attributes('alt')).toBe('ecoma.io');
  });

  it('lets the consumer override alt text per usage context', () => {
    const wrapper = mount(EcomaLogo, { props: { alt: 'Về trang chủ ecoma.io' } });

    expect(wrapper.find('img').attributes('alt')).toBe('Về trang chủ ecoma.io');
  });

  it('falls through extra attributes to the img root', () => {
    // Consumer tùy chỉnh qua attribute fallthrough (single root): class merge
    // với class của component, attr tự do (data-*) đi thẳng vào `<img>`.
    const wrapper = mount(EcomaLogo, {
      attrs: { class: 'h-6 w-auto', 'data-testid': 'brand-logo' },
    });

    const img = wrapper.find('img');
    expect(img.classes()).toContain('ecoma-logo');
    expect(img.classes()).toContain('h-6');
    expect(img.classes()).toContain('w-auto');
    expect(img.attributes('data-testid')).toBe('brand-logo');
  });

  it('keeps intrinsic dimensions as width/height attributes to avoid CLS', () => {
    // width/height nội tại của SVG (160×45.92 → height=46): browser reserve
    // không gian trước khi artwork tải xong. CSS của consumer luôn thắng
    // attribute HTML nên override không bị cản.
    const wrapper = mount(EcomaLogo);

    const img = wrapper.find('img');
    expect(img.attributes('width')).toBe('160');
    expect(img.attributes('height')).toBe('46');
  });

  it('lets the consumer override sizing through CSS classes, not width attributes', () => {
    // width/height KHÔNG đi qua fallthrough: override một mình một trong hai
    // làm browser bóp méo artwork (cả hai attr làm khung hiển thị). Sizing
    // của consumer chỉ qua CSS.
    const wrapper = mount(EcomaLogo, { attrs: { width: '48', height: '48' } });

    const img = wrapper.find('img');
    expect(img.attributes('width')).toBe('160');
    expect(img.attributes('height')).toBe('46');
  });

  it('never lets fallthrough attributes replace the bundled artwork', () => {
    // Artwork là source of truth: nhóm nguồn ảnh bị filter khỏi fallthrough
    // — browser ưu tiên srcset hơn src nên cả ba phải chặn cùng nhau.
    const wrapper = mount(EcomaLogo, {
      attrs: {
        src: '/replaced.svg',
        srcset: '/replaced-2x.svg 2x',
        imagesrcset: '/replaced.avif 2x',
      },
    });

    const img = wrapper.find('img');
    expect(img.attributes('src')).toBe(ECOMA_LOGO_HORIZONTAL_SVG_URL);
    expect(img.attributes('srcset')).toBeUndefined();
    expect(img.attributes('imagesrcset')).toBeUndefined();
  });
});
