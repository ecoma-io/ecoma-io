import { describe, expect, it } from 'vitest';

/**
 * Verification của **output production thật** (`.output/` sau `home:build`) —
 * kế thừa Finding 4 của review PR #20 cho bản hợp nhất.
 *
 * Những test này KHÔNG thay build: chúng chạy **sau** build (local và CI chạy
 * `nx build @ecoma-io/home && nx test @ecoma-io/home` — target `test` khai
 * `dependsOn: ['build']`). Mọi assertion đọc đúng file HTML/media đã được
 * prerender, nên một build hỏng (thiếu page, media không resolve, 404 fallback
 * SPA hóa...) lộ ngay tại đây thay vì chỉ được phát hiện khi đã deploy.
 *
 * Khác bản blogs trước đây: home là app **SSR** trên Cloudflare Workers —
 * output mang cả `.output/server` (Worker bundle) lẫn `.output/public`
 * (static assets + các content page đã prerender). Content routes (docs,
 * blog) được prerender lúc build; landing locale, legal và server routes vẫn
 * SSR lúc request. `404.html` là artifact tĩnh duy nhất cho unknown path —
 * `not_found_handling: "404-page"` phục vụ nó thay vì để Worker render.
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

/** Raw HTML của mọi trang prerender trong `.output/public/en|vi` — khoá là path từ `apps/home/tests`. */
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

/** Wrangler config thô — khẳng định contract deploy ngay từ test. */
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

/** Path content blog (đúng 14 trang: 2 landing + 12 article) suy từ glob. */
const BLOG_PAGES = Object.keys(PRERENDERED_HTML)
  .map(outputPath)
  .filter((path) => path.includes('/blog/'));

/** Path content docs suy từ glob. */
const DOCS_PAGES = Object.keys(PRERENDERED_HTML)
  .map(outputPath)
  .filter((path) => path.includes('/docs/'));

describe('static output: page inventory', () => {
  it('prerenders exactly 14 blog pages: two landings plus twelve articles', () => {
    const landing = BLOG_PAGES.filter((path) => path.endsWith('/blog/index.html'));
    const articles = BLOG_PAGES.filter(
      (path) => !path.endsWith('/blog/index.html') && path.includes('/blog/'),
    );
    expect(landing).toHaveLength(2);
    expect(articles).toHaveLength(12);
    expect(BLOG_PAGES).toHaveLength(14);
  });

  it('prerenders docs pages in both locales', () => {
    const landings = DOCS_PAGES.filter((path) => path.endsWith('/docs/index.html'));
    expect(landings).toContain('en/docs/index.html');
    expect(landings).toContain('vi/docs/index.html');
    // Cả hai locale phải prerender cùng số trang docs — cây content song song.
    const en = DOCS_PAGES.filter((path) => path.startsWith('en/')).length;
    const vi = DOCS_PAGES.filter((path) => path.startsWith('vi/')).length;
    expect(en).toBeGreaterThan(0);
    expect(en).toBe(vi);
  });

  it('prerenders all six blog article slugs in each locale', () => {
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
        expect(BLOG_PAGES, `${page}`).toContain(page);
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

  it('keeps unknown content paths out of the prerendered inventory', () => {
    // Manifest gate (`#build/prerendered-content-paths`) chặn route không có
    // trong manifest trước khi query content; hệ quả trong output: KHÔNG được
    // tồn tại HTML cho path ngoài cây content thật — nếu có thì crawler đã đi
    // theo link lạ và "prerender" một trang rỗng.
    for (const path of Object.keys(PRERENDERED_HTML).map(outputPath)) {
      expect(path).toMatch(/^\/?(en|vi)\/(docs|blog)(\/|$)/u);
    }
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
        // Nội dung qua shell thật: page phải render `<main>` của `PublicShell`.
        expect(html, `${path}`).toContain('<main');
      }
    }
  });

  it('renders a distinct title per blog article page', () => {
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

  it('renders the docs landing with its card sections in both locales', () => {
    // Landing docs prerender phải mang section card thật (không phải shell
    // rỗng) — một lỗi query content sẽ để landing trắng và fail ở đây.
    for (const locale of ['en', 'vi'] as const) {
      const html = PRERENDERED_HTML[`../.output/public/${locale}/docs/index.html`] ?? '';
      expect(html.length, `${locale}/docs landing size`).toBeGreaterThan(5000);
      expect(html).toContain('<main');
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
  it('keeps wrangler config an SSR Worker with assets and no SPA or not-found fallback', () => {
    // Contract deploy của bản hợp nhất, khẳng định trên **config thật**:
    // Worker SSR (`main` trỏ vào bundle Nitro) + static assets qua binding
    // ASSETS, **không** SPA fallback (`single-page-application` sẽ trả 200
    // cho path lạ). Config có comment giải thích nên assert trên **giá trị
    // JSON**, không phải trên từ khóa trần trong file.
    //
    // Khác bản docs/blogs static: KHÔNG đặt `not_found_handling` — với
    // `main` + assets (assets-first), fallback đó phục vụ `404.html` cho mọi
    // request không khớp asset mà **không invoke Worker**, tức sẽ nuốt SSR
    // của `/en`, `/en/legal/*` và error page SSR cho path content lạ. Trong
    // app hợp nhất, 404 cho path lạ là sản phẩm của Worker (middleware gate
    // + `error.vue`), còn `404.html` prerender chỉ là artifact để giữ tương
    // thích artifact-level, không wire vào serving.
    expect(WRANGLER_CONFIG).toContain('"name": "ecoma-home"');
    expect(WRANGLER_CONFIG).toContain('"main": ".output/server/index.mjs"');
    expect(WRANGLER_CONFIG).toContain('"directory": ".output/public"');
    expect(WRANGLER_CONFIG).toContain('"binding": "ASSETS"');
    expect(WRANGLER_CONFIG).not.toMatch(/"not_found_handling"\s*:\s*"single-page-application"/u);
    expect(WRANGLER_CONFIG).not.toMatch(/"not_found_handling"\s*:\s*"404-page"/u);
    expect(WRANGLER_CONFIG).not.toMatch(/"run_worker_first"/u);
    // Không D1: toàn bộ content là Git-managed Markdown, prerender lúc build —
    // Worker không được mang binding database nào.
    expect(WRANGLER_CONFIG).not.toContain('d1_databases');
  });

  it('emits the server bundle for SSR — content pages still stay prerendered', () => {
    // Home là SSR Worker: `.output/server` PHẢI tồn tại (ngược với blogs
    // static trước đây). Contract của bản hợp nhất là "SSR cho landing/legal
    // + prerender cho docs/blog", không phải "static toàn bộ".
    const serverEntry = import.meta.glob<string>('../.output/server/index.mjs', {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    expect(Object.keys(serverEntry)).toContain('../.output/server/index.mjs');
  });

  it('embeds the prerendered content manifest into the server bundle', () => {
    // Middleware gate (`server/middleware/prerendered-content-404.ts`) đọc
    // virtual module `virtual:prerendered-content-paths` — lấp bởi hook
    // `prerender:done` lúc build. Manifest rỗng trong server bundle = gate
    // 404 mọi content path ở runtime (bug đã gặp: app code import bị Vite
    // đóng băng trước prerender — chi tiết trong module app-local đăng ký
    // virtual). Test này chốt điều ngược lại: manifest trong bundle phải
    // non-empty và phủ đúng các trang HTML prerendered trong output.
    const chunks = import.meta.glob<string>('../.output/server/chunks/**/*.mjs', {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    // Không collapse whitespace: minifier có thể đặt `new` và `Set` trên hai
    // dòng (join bằng `\n` giữa các chunk), collapse sẽ dính chúng thành
    // `newSet(`. Regex tự cho phép whitespace thay vì biến dạng nguồn.
    // Bundle có nhiều Set literal — neo đúng Set của manifest qua phần tử
    // đầu tiên biết chắc (`/en/blog`, path content nhỏ nhất theo thứ tự
    // `toSorted()` của hook `prerender:done`).
    const bundled = Object.values(chunks).join('\n');
    const match = /new\s+Set\(\s*\[\s*"\/en\/blog"[^\]]*\]\)/u.exec(bundled);
    expect(match, 'manifest Set literal in server chunks').not.toBeNull();
    const paths = (match?.[0] ?? '')
      .replace(/^new\s+Set\(\s*\[/u, '')
      .replace(/\]\)$/u, '')
      .split(',')
      .map((item) => item.replace(/"/gu, '').trim())
      .filter((item) => item.startsWith('/'));
    expect(paths.length, 'manifest entries').toBeGreaterThan(0);
    // Mỗi HTML prerendered trong `.output/public` phải có mặt trong manifest
    // (manifest chứa cả `_payload.json` nên chỉ cần hướng HTML ⊆ manifest).
    for (const key of Object.keys(PRERENDERED_HTML)) {
      const routePath = `/${key.replace(/^\.\.\/\.output\/public\//u, '').replace(/\/index\.html$/u, '')}`;
      expect(paths, `${routePath} in embedded manifest`).toContain(routePath);
    }
  });
});
