import { describe, expect, it } from 'vitest';
import { PUBLIC_LOCALES } from '../app/i18n/index';
import { PUBLIC_MOUNTS } from '../app/layout/index';

/**
 * Contract của seed content — chạy trên **file thật** trong `content/`, không
 * phải fixture: những test này bắt lỗi frontmatter/slug/mapping locale ngay ở
 * unit test thay vì chờ tới build.
 *
 * Schema zod thật của collection nằm trong `content.config.ts` và được
 * `@nuxt/content` enforce lúc build; ở đây mirror contract bằng validation thủ
 * công (zod không resolve được ngoài Nuxt context trong vitest project này) để
 * bắt lỗi dữ liệu ngay từ `nx test`.
 *
 * Nguồn file là `import.meta.glob` của Vite (`query: '*'` → raw string,
 * `eager: true` → đọc đồng bộ lúc import), không phải `node:fs`: override
 * lint của repo cấm Node builtin trong `apps/**` theo tag `runtime:edge` —
 * spec là file của app nên cũng chịu ràng buộc đó, dù chỉ chạy trong Node.
 * Glob raw `.md` và `.svg` mang lại đúng dữ liệu cần validate mà không cần
 * `readFileSync`/`readdirSync`.
 */

/** Raw content của mọi article, khoá là path từ `apps/home` — dạng `../content/en/blog/<slug>/index.md`. */
const ARTICLE_SOURCES = import.meta.glob<string>('../content/{en,vi}/blog/*/index.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Raw content của mọi shared asset, dùng để đếm và so khớp reference. */
const ASSET_NAMES = Object.keys(
  import.meta.glob<string>('../content/assets/*.svg', { query: '?raw', eager: true }),
).map((path) => path.split('/').pop() ?? '');

/** `{ locale, slug, raw }` suy ra từ glob key. */
const articles = Object.entries(ARTICLE_SOURCES).map(([key, raw]) => {
  const match = /content\/(en|vi)\/blog\/([^/]+)\/index\.md$/u.exec(key);
  if (!match) {
    throw new Error(`unexpected glob key: ${key}`);
  }
  return { locale: match[1] as 'en' | 'vi', slug: match[2], raw };
});

/** Tách frontmatter YAML tối thiểu (flat scalar + mảng đơn giản) để validate không cần parser YAML đầy đủ. */
function parseFrontmatter(raw: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(raw);
  if (!match) {
    throw new Error('missing frontmatter');
  }
  const result: Record<string, unknown> = {};
  let currentKey = '';
  for (const line of match[1].split(/\r?\n/u)) {
    // List item phải được xử lý **trước** cặp key:value — key hiện hành là key
    // gần nhất có khai báo (`tags:`), kể cả khi key đó khai báo không có value.
    const listItem = /^ {2}- (.+)$/u.exec(line);
    if (listItem && currentKey) {
      const list = result[currentKey];
      if (Array.isArray(list)) {
        list.push(listItem[1].trim());
      } else {
        result[currentKey] = [listItem[1].trim()];
      }
      continue;
    }
    // Key có thể khai báo không value (`tags:`) — khoảng trắng sau `:` là tùy
    // chọn, nên regex không được yêu cầu nó.
    const pair = /^([a-z]+):(.*)$/u.exec(line);
    if (!pair) {
      continue;
    }
    currentKey = pair[1];
    const rawValue = pair[2].trim();
    let value: unknown = rawValue.replace(/^'(.*)'$/u, '$1');
    if (value === 'true') {
      value = true;
    } else if (value === 'false') {
      value = false;
    } else if (rawValue === '') {
      // `tags:` không value = khởi đầu một YAML block sequence.
      value = [];
    }
    result[currentKey] = value;
  }
  return result;
}

/** Kiểm tra frontmatter khớp contract của `blogSchema` trong `content.config.ts`. */
function validFrontmatter(frontmatter: Record<string, unknown>): boolean {
  return (
    typeof frontmatter.title === 'string' &&
    frontmatter.title.length > 0 &&
    typeof frontmatter.description === 'string' &&
    frontmatter.description.length > 0 &&
    typeof frontmatter.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/u.test(frontmatter.date) &&
    typeof frontmatter.author === 'string' &&
    frontmatter.author.length > 0 &&
    Array.isArray(frontmatter.tags) &&
    frontmatter.tags.every((tag) => typeof tag === 'string') &&
    typeof frontmatter.featured === 'boolean'
  );
}

describe('seed content contract', () => {
  it('seeds six articles per locale, twelve in total', () => {
    expect(articles.filter((article) => article.locale === 'en')).toHaveLength(6);
    expect(articles.filter((article) => article.locale === 'vi')).toHaveLength(6);
  });

  it('keeps identical slugs across locales for the locale switcher', () => {
    // Locale switcher đổi đúng segment locale; hai locale phải có cùng tập slug
    // để mọi article có bản dịch thật ở locale kia.
    const enSlugs = articles
      .filter((a) => a.locale === 'en')
      .map((a) => a.slug)
      .toSorted();
    const viSlugs = articles
      .filter((a) => a.locale === 'vi')
      .map((a) => a.slug)
      .toSorted();
    expect(viSlugs).toEqual(enSlugs);
  });

  it('has valid frontmatter for every article', () => {
    for (const article of articles) {
      expect(
        validFrontmatter(parseFrontmatter(article.raw)),
        `${article.locale}/${article.slug}`,
      ).toBe(true);
    }
  });

  it('has a clear H1 matching the article body', () => {
    for (const article of articles) {
      // Cờ `m` bắt buộc: `^` phải neo từng dòng, không phải đầu chuỗi (chuỗi
      // mở đầu bằng frontmatter).
      expect(article.raw, `${article.locale}/${article.slug}`).toMatch(/^# .+/mu);
    }
  });

  it('marks at least one article featured per locale', () => {
    for (const locale of ['en', 'vi'] as const) {
      const perLocale = articles.filter((a) => a.locale === locale);
      const featured = perLocale.filter((a) => parseFrontmatter(a.raw).featured === true);
      // Thông điệp lỗi tự dựng (không dùng message arg của expect — rule
      // vitest/valid-expect chỉ nhận 1 argument) để biết locale nào thiếu.
      expect([locale, featured.length >= 1]).toEqual([expect.any(String), true]);
    }
  });

  it('uses deterministic ordering prefixes in file names', () => {
    // Thứ tự listing dựa `date` DESC, tie-break `stem ASC`. Prefix số trong tên
    // thư mục (`1.url-model`) làm `stem` không trùng nhau — điều kiện để tie-break
    // luôn xác định.
    for (const locale of ['en', 'vi'] as const) {
      const slugs = articles
        .filter((a) => a.locale === locale)
        .map((a) => a.slug)
        .toSorted();
      expect([locale, slugs]).toEqual([
        expect.any(String),
        expect.arrayContaining([expect.stringMatching(/^\d+\./u)]),
      ]);
      expect(slugs.filter((slug) => !/^\d+\./u.test(slug))).toEqual([]);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });

  it('exercises the markdown renderer with a representative element mixture', () => {
    // Toàn bộ seed (cả hai locale) phải cover mọi element: heading nhiều mức,
    // list, table, code block, blockquote, hr, link — đủ để renderer gặp một
    // lần mỗi loại.
    const all = articles.map((a) => a.raw).join('\n');
    expect(all).toMatch(/^## /mu);
    expect(all).toMatch(/^- /mu);
    expect(all).toMatch(/^\| .+\|/mu);
    expect(all).toMatch(/```/u);
    expect(all).toMatch(/^> /mu);
    expect(all).toMatch(/^---$/mu);
    expect(all).toMatch(/\]\(\//u);
  });

  it('references only collocated shared assets that exist in the repository', () => {
    // Mọi reference `../../../assets/x.svg` phải trỏ tới asset thật trong
    // `content/assets/` — bắt broken image ở unit test thay vì chỉ phát hiện
    // bằng một build đỏ. Vì asset dùng chung nằm ở một thư mục cố định,
    // reference hợp lệ luôn resolve về đúng tập tên file ở đó.
    const sharedNames = new Set(ASSET_NAMES);
    expect(sharedNames.size).toBeGreaterThanOrEqual(3);
    for (const article of articles) {
      const refs = [
        ...article.raw.matchAll(/!\[[^\]]*\]\((\.\.\/\.\.\/\.\.\/assets\/[^)]+)\)/gu),
      ].map((match) => match[1]);
      for (const ref of refs) {
        const assetName = ref.split('/').pop() ?? '';
        expect(sharedNames.has(assetName), `${article.locale}/${article.slug}: ${ref}`).toBe(true);
      }
    }
  });

  it('keeps shared language-neutral assets in one place, not duplicated per locale', () => {
    // Assets graphic không chữ nằm dưới `content/assets/` dùng chung; chúng
    // không được nhân bản vào thư mục locale. Glob chỉ phủ `content/{en,vi}/
    // blog/*/index.md` nên mọi file asset khác trong cây locale là leak —
    // kiểm tra qua một glob phụ rộng hơn.
    const localeAssetLeaks = Object.keys(
      import.meta.glob<string>('../content/{en,vi}/blog/**/*.{svg,png,jpg,webp}', {
        query: '?raw',
        eager: true,
      }),
    );
    expect(localeAssetLeaks, 'asset files inside locale trees').toEqual([]);
  });

  it('covers every registry locale and every global shell link in the prerender ignore list', () => {
    // `nitro.config.ts` liệt kê tường minh những entry point ngoài content
    // mà crawler (`crawlLinks: true`) đi theo từ global nav/footer của
    // `PublicShell`: locale roots, mount `legal`. Đây là coupling có chủ ý —
    // nhưng phải được ghim bằng test: registry thêm locale mới hoặc mount mới
    // mà `nitro.config.ts` chưa cập nhật `ignore` thì test đỏ **ngay tại đây**
    // thay vì build đỏ lúc prerender (hoặc tệ hơn, prerender 404 âm thầm).
    const nitroConfig = (() => {
      const modules = import.meta.glob<string>('../nitro.config.ts', {
        query: '?raw',
        import: 'default',
        eager: true,
      });
      return modules['../nitro.config.ts'] ?? '';
    })();

    // Mọi locale của registry phải có locale root phủ trong ignore.
    for (const definition of PUBLIC_LOCALES) {
      const code = definition.code;
      expect(nitroConfig, `nitro ignore: locale root /${code}`).toContain(`^\\/${code}\\/?$`);
    }

    // Mọi mount trong registry khác hai mount content (docs + blog — hai mount
    // mà app này prerender) phải xuất hiện trong ignore — mount mới sinh ra ở
    // registry mà home không sở hữu là một entry point ngoài ownership cho
    // crawler. Ignore hoạt động theo **prefix segment**: pattern
    // `^\/en\/legal(\/[^/]+)?\/?$` phủ cả mount lồng nhau, nên chỉ mount **cấp
    // một** (không có `/` trong path) cần pattern riêng trong config.
    const prerenderedMounts = new Set(['docs', 'blog']);
    for (const definition of PUBLIC_MOUNTS) {
      const mount = definition.path;
      if (prerenderedMounts.has(mount) || mount.includes('/')) {
        continue;
      }
      expect(nitroConfig, `nitro ignore: mount ${mount} outside content prerender`).toContain(
        `\\/${mount}`,
      );
    }
  });
});
