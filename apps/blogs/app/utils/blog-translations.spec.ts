import { describe, expect, it } from 'vitest';
import {
  blogArticleAvailableLocales,
  blogLandingAvailableLocales,
  blogTranslationCandidates,
} from './blog-translations';

describe('blogLandingAvailableLocales', () => {
  it('exposes both landing locales even when the blog has no articles at all', () => {
    // Landing là route tĩnh của mount — availability suy từ registry, KHÔNG
    // từ số article. Helper không nhận tham số content nào: blog trống ở cả
    // hai locale vẫn phải có cả hai landing để switcher navigation hoạt động.
    const available = blogLandingAvailableLocales();
    expect(available).toContain('en');
    expect(available).toContain('vi');
    expect(available).toHaveLength(2);
  });
});

describe('blogTranslationCandidates', () => {
  it('builds candidate paths for every registry locale independent of content', () => {
    // remainder luôn bắt đầu bằng `/` (vì shape pathname `/<locale>/blog/<remainder>`)
    const candidates = blogTranslationCandidates('/url-model');
    expect(candidates).toEqual(['/en/blog/url-model', '/vi/blog/url-model']);
  });
});

describe('blogArticleAvailableLocales', () => {
  // Content states của Finding 1: không article nào, chỉ EN, chỉ VI.
  // `existingPaths` là kết quả query `path IN candidates` — mô phỏng từng
  // state bằng tập path tĩnh, đúng observable behavior của route.
  const EN_ONLY = new Set(['/en/blog/url-model']);
  const VI_ONLY = new Set(['/vi/blog/url-model']);
  const EMPTY = new Set<string>();

  it('offers only en when only the en translation exists', () => {
    const available = blogArticleAvailableLocales('/url-model', EN_ONLY);
    expect(available).toEqual(['en']);
  });

  it('offers only vi when only the vi translation exists', () => {
    const available = blogArticleAvailableLocales('/url-model', VI_ONLY);
    expect(available).toEqual(['vi']);
  });

  it('offers both locales when both translations exist', () => {
    const available = blogArticleAvailableLocales(
      '/url-model',
      new Set(['/en/blog/url-model', '/vi/blog/url-model']),
    );
    expect(available).toEqual(['en', 'vi']);
  });

  it('offers no locale when the resource exists in neither locale (unknown article)', () => {
    const available = blogArticleAvailableLocales('/url-model', EMPTY);
    expect(available).toEqual([]);
  });

  it('never generates a switch URL for a nonexistent translation', () => {
    // Bất biến: candidate `/vi/...` không tồn tại trong EN_ONLY thì không thể
    // nằm trong kết quả — so khớp trực tiếp từng candidate với tập kết quả.
    const candidates = blogTranslationCandidates('/url-model');
    const availableFromEnOnly = blogArticleAvailableLocales('/url-model', EN_ONLY);
    const viCandidates = candidates.filter((path) => path.startsWith('/vi/'));
    expect(viCandidates).toEqual(['/vi/blog/url-model']);
    expect(EN_ONLY.has('/vi/blog/url-model')).toBe(false);
    expect(availableFromEnOnly).not.toContain('vi');
    expect(blogArticleAvailableLocales('/url-model', VI_ONLY)).not.toContain('en');
  });
});
