import { describe, expect, it } from 'vitest';
import {
  orderArticlesByDateDesc,
  pickFeaturedArticle,
  pickRelatedArticles,
  type BlogArticleSummary,
} from './blog-articles';

/** Fixture factory — một article EN với các field override được. */
function en(overrides: Partial<BlogArticleSummary> & { path: string }): BlogArticleSummary {
  return {
    stem: `en/blog/${overrides.path.split('/').pop()}`,
    title: `Article ${overrides.path}`,
    description: 'Description',
    date: '2026-09-01',
    author: 'John Martin',
    tags: ['architecture'],
    featured: false,
    ...overrides,
  };
}

describe('orderArticlesByDateDesc', () => {
  it('orders newest first', () => {
    const ordered = orderArticlesByDateDesc([
      en({ path: '/en/blog/a', date: '2026-09-01' }),
      en({ path: '/en/blog/b', date: '2026-09-09' }),
      en({ path: '/en/blog/c', date: '2026-09-05' }),
    ]);
    expect(ordered.map((article) => article.path)).toEqual([
      '/en/blog/b',
      '/en/blog/c',
      '/en/blog/a',
    ]);
  });

  it('breaks date ties deterministically by stem ascending', () => {
    // Hai article cùng ngày: thứ tự chỉ có thể đến từ `stem` — số ordering
    // prefix trong tên file làm tie-break này ổn định và không trùng.
    const ordered = orderArticlesByDateDesc([
      en({ path: '/en/blog/b', stem: 'en/blog/2.b', date: '2026-09-01' }),
      en({ path: '/en/blog/a', stem: 'en/blog/1.a', date: '2026-09-01' }),
    ]);
    expect(ordered.map((article) => article.path)).toEqual(['/en/blog/a', '/en/blog/b']);
  });

  it('never mixes locales when the input list is locale-filtered', () => {
    // Hàm chỉ sort theo `date`/`stem` — nhưng test này pin contract: caller
    // truyền danh sách đã lọc một locale, và sort không được làm mất tính chất
    // đó (không thêm/xoá phần tử).
    const input = [en({ path: '/en/blog/a' }), en({ path: '/en/blog/b' })];
    const ordered = orderArticlesByDateDesc(input);
    expect(ordered).toHaveLength(2);
    expect(ordered.every((article) => article.path.startsWith('/en/'))).toBe(true);
  });

  it('does not mutate the input array', () => {
    const input = [
      en({ path: '/en/blog/a', date: '2026-09-01' }),
      en({ path: '/en/blog/b', date: '2026-09-09' }),
    ];
    const snapshot = [...input];
    orderArticlesByDateDesc(input);
    expect(input).toEqual(snapshot);
  });

  it('returns an empty array for an empty list', () => {
    expect(orderArticlesByDateDesc([])).toEqual([]);
  });
});

describe('pickFeaturedArticle', () => {
  it('picks the flagged article even when it is not the newest', () => {
    const featured = pickFeaturedArticle([
      en({ path: '/en/blog/new', date: '2026-10-01', featured: false }),
      en({ path: '/en/blog/pick', date: '2026-09-01', featured: true }),
    ]);
    expect(featured?.path).toBe('/en/blog/pick');
  });

  it('picks the first flagged article in display order when several are flagged', () => {
    const featured = pickFeaturedArticle([
      en({ path: '/en/blog/old', date: '2026-09-01', featured: true }),
      en({ path: '/en/blog/new', date: '2026-10-01', featured: true }),
    ]);
    expect(featured?.path).toBe('/en/blog/new');
  });

  it('falls back to the newest article when nothing is featured', () => {
    // Landing luôn có hero: fallback là bài mới nhất, không phải `undefined` —
    // nhưng fallback phải là bài **thật** từ danh sách, không phải dữ liệu chế.
    const featured = pickFeaturedArticle([
      en({ path: '/en/blog/old', date: '2026-09-01', featured: false }),
      en({ path: '/en/blog/new', date: '2026-10-01', featured: false }),
    ]);
    expect(featured?.path).toBe('/en/blog/new');
    expect(featured?.featured).toBe(false);
  });

  it('returns undefined for an empty list', () => {
    // Blog rỗng: không hero — landing vẫn render hợp lệ với listing rỗng.
    expect(pickFeaturedArticle([])).toBeUndefined();
  });
});

describe('pickRelatedArticles', () => {
  const current = en({
    path: '/en/blog/current',
    date: '2026-10-01',
    tags: ['architecture', 'urls'],
  });

  const pool = [
    current,
    en({ path: '/en/blog/same-primary', tags: ['architecture'], date: '2026-09-20' }),
    en({ path: '/en/blog/same-secondary', tags: ['urls'], date: '2026-09-25' }),
    en({ path: '/en/blog/no-tag-overlap', tags: ['design'], date: '2026-09-15' }),
    // Article VI không nằm trong pool này: caller lọc theo locale ở tầng query;
    // test dưới pin thêm rằng hàm không đụng tới path ngoài locale nếu danh
    // sách đầu vào đúng contract.
  ];

  it('excludes the current article from its own related list', () => {
    const related = pickRelatedArticles(pool, current, 3);
    expect(related.every((article) => article.path !== current.path)).toBe(true);
  });

  it('ranks by the primary tag and orders newest first', () => {
    const related = pickRelatedArticles(pool, current, 3);
    // Chỉ `same-primary` chia tag đầu (`architecture`); `same-secondary` chia
    // tag phụ nhưng không phải tag chính.
    expect(related.map((article) => article.path)).toEqual(['/en/blog/same-primary']);
  });

  it('respects the limit', () => {
    const bigPool = [
      ...pool,
      en({ path: '/en/blog/more-1', tags: ['architecture'], date: '2026-08-20' }),
      en({ path: '/en/blog/more-2', tags: ['architecture'], date: '2026-08-10' }),
    ];
    const related = pickRelatedArticles(bigPool, current, 2);
    expect(related).toHaveLength(2);
    expect(related.map((article) => article.path)).toEqual([
      '/en/blog/same-primary',
      '/en/blog/more-1',
    ]);
  });

  it('returns an empty list when the current article has no tags', () => {
    const untagged = en({ path: '/en/blog/untagged', tags: [] });
    expect(pickRelatedArticles(pool, untagged, 3)).toEqual([]);
  });

  it('keeps every related article within the provided (locale-filtered) pool', () => {
    const related = pickRelatedArticles(pool, current, 10);
    // Mọi kết quả đến từ pool — không có article nào được "suy ra" ngoài input.
    const poolPaths = new Set(pool.map((article) => article.path));
    expect(related.every((article) => poolPaths.has(article.path))).toBe(true);
  });
});
