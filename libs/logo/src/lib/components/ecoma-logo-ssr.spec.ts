// @vitest-environment node
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { EcomaLogo } from '../../index';

/**
 * SSR/SSG compatibility: render component trong môi trường **không có DOM**
 * (node). Nếu component phụ thuộc `window`/`document` hay client-only API
 * thì test này throw ngay — đúng bằng chứng cần cho SSG-first public web.
 */
describe('EcomaLogo SSR', () => {
  it('renders the logo to a string without a DOM', async () => {
    const app = createSSRApp({
      render: () => h(EcomaLogo, { alt: 'ecoma.io' }),
    });
    const html = await renderToString(app);

    expect(html).toContain('<img');
    expect(html).toContain('alt="ecoma.io"');
    // URL asset được render thẳng vào src — không placeholder, không lazy.
    expect(html).toMatch(/src="[^"]+"/u);
  });

  it('is deterministic: renders are identical even when system time differs', async () => {
    // Hai render ở hai system time khác nhau — bắt code đọc `Date`.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2001-02-03T04:05:06.000Z'));
      const first = await renderLogo();
      vi.setSystemTime(new Date('2049-12-31T23:59:59.000Z'));
      expect(await renderLogo()).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the default alt when no props are given', async () => {
    const app = createSSRApp({
      render: () => h(EcomaLogo, {}),
    });
    const html = await renderToString(app);

    expect(html).toContain('alt="ecoma.io"');
  });
});

/** Render logo không props — dùng kiểm chứng deterministic (SSR thuần, không DOM). */
async function renderLogo(): Promise<string> {
  const app = createSSRApp({
    render: () => h(EcomaLogo, {}),
  });
  return renderToString(app);
}
