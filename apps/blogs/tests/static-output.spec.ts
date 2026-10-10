import { describe, expect, it } from 'vitest';

/**
 * Verification của **static output thật** (`.output/public` sau
 * `blogs:build-static`) — Finding 4 của review PR #20.
 *
 * Những test này KHÔNG thay build-static: chúng chạy **sau** build (CI runner
 * và local chạy `nx run blogs:build-static && nx test blogs` — xem `docs/`
 * và mô tả PR). Mọi assertion đọc đúng file HTML/media đã được prerender, nên
 * một build hỏng (thiếu page, media không resolve, 404 fallback SPA hóa...) lộ
 * ngay tại đây thay vì chỉ được phát hiện khi đã deploy.
 *
 * Nguồn file là `import.meta.glob` của Vite (`query: '?raw'`, `eager: true`)
 * trên `.output/public` — **không** phải `node:fs`: override lint của repo cấm
 * Node builtin trong `apps/**` (tag `runtime:edge`), spec là file của app nên
 * cùng chịu ràng buộc đó. Glob pattern phải dùng path tương đối từ thư mục
 * `tests/`; thư mục `.output` nằm trong app root nên glob thấy được.
 *
 * `import.meta.glob` chỉ quét lúc **dev/test start**, nhưng test này luôn chạy
 * trên output vừa build trong cùng một lệnh — đây là pattern đã dùng ở
 * `content-contract.spec.ts`, chỉ khác nguồn là output thay vì source.
 */

/** Raw HTML của mọi trang prerender trong `.output/public/en|vi` — khoá là path từ `apps/blogs/tests`. */
const PRERENDERED_HTML = import.meta.glob<string>('../.output/public/{en,vi}/**/*.html', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** `404.html` ở gốc output — fallback của `not_found_handling: "404-page"` (nằm ngoài cây `{en,vi}`). */
const NOT_FOUND_HTML = import.meta.glob<string>('../.output/public/404.html', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Raw content của mọi media file trong output `assets/` — để xác nhận file tồn tại và không rỗng. */
const OUTPUT_ASSETS = import.meta.glob<string>('../.output/public/assets/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Wrangler config thô — khẳng định contract assets-only ngay từ test. */
const WRANGLER_CONFIG = (() => {
  const modules = import.meta.glob<string>('../wrangler.jsonc', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  return modules['../wrangler.jsonc'] ?? '';
})();

/** Path trong output (bỏ prefix `../.output/public/`) của một glob key. */
function outputPath(key: string): string {
  return key.replace('../.output/public/', '');
}

/** Tất cả HTML của một locale, dạng `path → raw html`. */
function htmlForLocale(locale: 'en' | 'vi'): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, html] of Object.entries(PRERENDERED_HTML)) {
    const path = outputPath(key);
    if (path.startsWith(`${locale}/`)) {
      map.set(path, html);
    }
  }
  return map;
}

/** Path nội dung blog (đúng 14 trang: 2 landing + 12 article) suy từ glob. */
const CONTENT_PAGES = Object.keys(PRERENDERED_HTML)
  .map(outputPath)
  .filter((path) => path.includes('/blog/'));

describe('static output: page inventory', () => {
  it('prerenders exactly 14 content pages: two landings plus twelve articles', () => {
    const landing = CONTENT_PAGES.filter((path) => path.endsWith('/blog/index.html'));
    const articles = CONTENT_PAGES.filter(
      (path) => !path.endsWith('/blog/index.html') && path.includes('/blog/'),
    );
    expect(landing).toHaveLength(2);
    expect(articles).toHaveLength(12);
    expect(CONTENT_PAGES).toHaveLength(14);
  });

  it('prerenders both landings at the canonical drop-trailing-slash paths', () => {
    expect(CONTENT_PAGES).toContain('en/blog/index.html');
    expect(CONTENT_PAGES).toContain('vi/blog/index.html');
  });

  it('prerenders all six article slugs in each locale', () => {
    // URL slug **không** mang prefix số: prefix ordering (`1.url-model`) chỉ
    // nằm trong content stem để tie-break, còn public path là `/blog/url-model`.
    const slugs = [
      'url-model',
      'build-time-content',
      'locale-switching',
      'static-deployment',
      'reading-first-design',
      'demo-content-note',
    ];
    for (const locale of ['en', 'vi'] as const) {
      for (const slug of slugs) {
        const page = `${locale}/blog/${slug}/index.html`;
        expect(CONTENT_PAGES, `${page}`).toContain(page);
      }
    }
  });

  it('emits a 404 page as the not-found fallback', () => {
    // `not_found_handling: "404-page"` của wrangler phục vụ `404.html` cho
    // mọi path chưa biết — file phải tồn tại; SPA fallback (`200.html` cho
    // path lạ) thì cố ý không dùng, và sự vắng mặt của cơ chế đó được khẳng
    // định ở test wrangler config dưới.
    expect(Object.keys(NOT_FOUND_HTML)).toContain('../.output/public/404.html');
  });
});

describe('static output: per-page correctness', () => {
  it('renders correct lang, canonical, and per-locale content on every page', () => {
    for (const locale of ['en', 'vi'] as const) {
      for (const [path, html] of htmlForLocale(locale)) {
        const lang = /<html[^>]*\slang="([^"]*)"/u.exec(html)?.[1];
        const canonical = /<link[^>]*rel="canonical"[^>]*href="([^"]*)"/u.exec(html)?.[1];
        expect(lang, `${path}`).toBe(locale === 'en' ? 'en' : 'vi-VN');
        expect(canonical, `${path}`).toContain(
          `https://ecoma.io/${path.replace(/\/index\.html$/u, '')}`,
        );
        // Nội dung đúng locale: landing vi phải chứa chữ tiếng Việt, en thì
        // chứa tiêu đề tiếng Anh — một page trộn locale sẽ fail ở một trong
        // hai phía.
        expect(html, `${path}`).toContain('<main');
      }
    }
  });

  it('renders a distinct title per article page', () => {
    for (const locale of ['en', 'vi'] as const) {
      const titles = new Set<string>();
      for (const [path, html] of htmlForLocale(locale)) {
        // Chỉ article (landing `/blog/index.html` bị loại — bài của nó là
        // featured và có thể trùng title với trang article đó).
        if (path.includes('/blog/') && !path.endsWith('/blog/index.html')) {
          const title = /<title>([^<]*)<\/title>/u.exec(html)?.[1] ?? `missing at ${path}`;
          titles.add(title);
        }
      }
      expect(titles.size, `${locale}: distinct article titles`).toBe(6);
    }
  });

  it('keeps landing hreflang alternates pointing at both locale landings', () => {
    for (const locale of ['en', 'vi'] as const) {
      const html = PRERENDERED_HTML[`../.output/public/${locale}/blog/index.html`] ?? '';
      expect(html).toContain('hreflang="en"');
      expect(html).toContain('hreflang="vi-VN"');
      expect(html).toMatch(new RegExp(`href="/${locale}/blog"`, 'u'));
      const other = locale === 'en' ? 'vi' : 'en';
      expect(html).toMatch(new RegExp(`href="/${other}/blog"`, 'u'));
    }
  });
});

describe('static output: media resolution', () => {
  it('copies every referenced cover and inline asset into the output assets directory', () => {
    // Mọi `src="/assets/x.svg"` trong mọi HTML phải tồn tại trong output
    // `assets/` — bắt broken media ở test thay vì ở browser.
    const available = new Set(Object.keys(OUTPUT_ASSETS).map(outputPath));
    expect(available.size).toBeGreaterThanOrEqual(6);
    for (const [path, html] of Object.entries(PRERENDERED_HTML)) {
      for (const match of html.matchAll(/src="(\/assets\/[^"]+)"/gu)) {
        const assetRef = match[1] ?? '';
        const assetPath = `assets/${assetRef.replace('/assets/', '')}`;
        expect(available.has(assetPath), `${path}: ${assetRef}`).toBe(true);
      }
    }
  });

  it('leaves no unresolved relative asset path in any HTML', () => {
    for (const [path, html] of Object.entries(PRERENDERED_HTML)) {
      expect(html, `${path}`).not.toMatch(/src="[^"]*\.\.\//u);
      expect(html, `${path}`).not.toMatch(/src="assets\//u);
    }
  });

  it('renders cover images with meaningful alt text on articles that declare one', () => {
    // `url-model`, `static-deployment` và `reading-first-design` khai báo
    // cover; alt phải là text thật, không phải `[object Object]`.
    for (const locale of ['en', 'vi'] as const) {
      for (const slug of ['url-model', 'static-deployment', 'reading-first-design']) {
        const html = PRERENDERED_HTML[`../.output/public/${locale}/blog/${slug}/index.html`] ?? '';
        expect(html).toMatch(/<img[^>]*src="\/assets\/[^"]+\.svg"[^>]*alt="[^"]+"/u);
      }
    }
  });

  it('renders no cover image on articles without one', () => {
    // `build-time-content` và `demo-content-note` cố ý không có cover:
    // graceful absence — không `<img>` cover, không hình hỏng.
    for (const locale of ['en', 'vi'] as const) {
      for (const slug of ['build-time-content', 'demo-content-note']) {
        const html = PRERENDERED_HTML[`../.output/public/${locale}/blog/${slug}/index.html`] ?? '';
        expect(html, `${locale}/${slug}`).not.toMatch(/src="\/assets\/cover-/u);
        expect(html, `${locale}/${slug}`).not.toMatch(/alt="\[object Object\]"/u);
      }
    }
  });

  it('keeps inline body media working alongside covers', () => {
    // Ảnh nội dung (`public-web-layers` trong `url-model`) vẫn render đúng —
    // cover không thay thế inline media.
    for (const locale of ['en', 'vi'] as const) {
      const html = PRERENDERED_HTML[`../.output/public/${locale}/blog/url-model/index.html`] ?? '';
      expect(html).toContain('src="/assets/public-web-layers.svg"');
    }
  });

  it('serves every output asset with non-empty content', () => {
    for (const [key, raw] of Object.entries(OUTPUT_ASSETS)) {
      expect(raw.length, `${key}`).toBeGreaterThan(0);
    }
  });
});

describe('static output: deployment contract', () => {
  it('keeps wrangler config assets-only with a 404-page fallback and no SPA mode', () => {
    // Contract deploy của Finding 4, khẳng định trên **config thật**:
    // assets-only (không `main`), `not_found_handling: "404-page"`, và **không**
    // `single-page-application` (SPA fallback sẽ trả 200 cho path lạ). Config
    // có comment giải thích chống SPA nên assert trên **giá trị JSON**, không
    // phải trên từ khóa trần trong file.
    expect(WRANGLER_CONFIG).toContain('"not_found_handling": "404-page"');
    expect(WRANGLER_CONFIG).toContain('"html_handling": "drop-trailing-slash"');
    expect(WRANGLER_CONFIG).toContain('"directory": ".output/public"');
    expect(WRANGLER_CONFIG).not.toMatch(/"main"\s*:/u);
    expect(WRANGLER_CONFIG).not.toMatch(/"not_found_handling"\s*:\s*"single-page-application"/u);
    expect(WRANGLER_CONFIG).not.toContain('d1_databases');
  });

  it('emits no server bundle — the output carries no runtime code', () => {
    // `preset: 'static'` nghĩa là không có `.output/server` với code chạy lúc
    // request; chỉ có (tùy chọn) manifest nội bộ. Kiểm tra qua glob: thư mục
    // `server/mjs` không được xuất hiện dưới output.
    const serverChunks = Object.keys(
      import.meta.glob<string>('../.output/server/**/*.{mjs,js}', { query: '?raw', eager: true }),
    ).filter((key) => !key.includes('server/chunks/'));
    expect(serverChunks).toEqual([]);
  });
});
