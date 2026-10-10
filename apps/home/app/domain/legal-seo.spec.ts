import { describe, expect, it } from 'vitest';

import { buildLegalSeo } from './legal-seo';
import { HOME_PRODUCTION_ORIGIN } from './home-origin';
import { LEGAL_SLUGS } from './legal-content';
import { PUBLIC_LOCALES } from '@ecoma-io/i18n-public';

const enContent = {
  title: 'Privacy Policy — ecoma.io',
  description: 'How ecoma.io collects, uses and protects personal data.',
};

describe('buildLegalSeo', () => {
  it('SEO cho /en/legal/privacy: lang=en, canonical tuyệt đối, alternates đầy đủ', () => {
    const seo = buildLegalSeo('en', 'privacy', enContent);
    expect(seo.lang).toBe('en');
    expect(seo.title).toBe(enContent.title);
    expect(seo.description).toBe(enContent.description);
    expect(seo.canonicalUrl).toBe('https://ecoma.io/en/legal/privacy');
    expect(seo.alternates.length).toBe(PUBLIC_LOCALES.length);
    const enAlt = seo.alternates.find((a) => a.hreflang === 'en');
    const viAlt = seo.alternates.find((a) => a.hreflang === 'vi-VN');
    expect(enAlt?.href).toBe('https://ecoma.io/en/legal/privacy');
    expect(viAlt?.href).toBe('https://ecoma.io/vi/legal/privacy');
    expect(seo.alternates.every((a) => a.rel === 'alternate')).toBe(true);
  });

  it('SEO cho /vi: lang=vi-VN, canonical riêng, không trộn locale', () => {
    const seo = buildLegalSeo('vi', 'privacy', {
      title: 'Chính sách bảo mật — ecoma.io',
      description: 'Mô tả.',
    });
    expect(seo.lang).toBe('vi-VN');
    expect(seo.canonicalUrl).toBe('https://ecoma.io/vi/legal/privacy');
    expect(seo.canonicalUrl).not.toBe(buildLegalSeo('en', 'privacy', enContent).canonicalUrl);
  });

  it('mọi slug dựng được canonical dưới mount legal, đúng pathname', () => {
    for (const slug of LEGAL_SLUGS) {
      const seo = buildLegalSeo('en', slug, enContent);
      expect(new URL(seo.canonicalUrl).pathname).toBe(`/en/legal/${slug}`);
    }
  });

  it('mọi URL đều tuyệt đối, https và nằm dưới production origin', () => {
    for (const locale of ['en', 'vi'] as const) {
      for (const slug of LEGAL_SLUGS) {
        const seo = buildLegalSeo(locale, slug, enContent);
        const urls = [seo.canonicalUrl, ...seo.alternates.map((a) => a.href)];
        for (const url of urls) {
          expect(url.startsWith(`${HOME_PRODUCTION_ORIGIN}/`)).toBe(true);
          expect(new URL(url).origin).toBe(HOME_PRODUCTION_ORIGIN);
          expect(new URL(url).protocol).toBe('https:');
        }
      }
    }
  });

  it('alternates có self-reference và phủ toàn bộ PUBLIC_LOCALES', () => {
    const seo = buildLegalSeo('en', 'terms', enContent);
    const hreflangs = seo.alternates.map((a) => a.hreflang).toSorted();
    expect(hreflangs).toEqual(PUBLIC_LOCALES.map((d) => d.hreflang).toSorted());
    expect(seo.alternates.find((a) => a.hreflang === 'en')?.href).toBe(seo.canonicalUrl);
  });

  it('payload bất biến với hostname của request', () => {
    const seo = buildLegalSeo('vi', 'refund', { title: 't', description: 'd' });
    const serialized = JSON.stringify(seo);
    expect(serialized).not.toContain('localhost');
    expect(serialized).not.toContain('ecoma.io.vn');
    expect(serialized).not.toContain('workers.dev');
  });

  it('deterministic: hai lần gọi cùng input cho kết quả y hệt', () => {
    const first = buildLegalSeo('en', 'payment', enContent);
    const second = buildLegalSeo('en', 'payment', enContent);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('không gọi Date/random: payload chỉ gồm field đã khai', () => {
    const seo = buildLegalSeo('en', 'privacy', enContent);
    expect(Object.keys(seo).toSorted()).toEqual([
      'alternates',
      'canonicalUrl',
      'description',
      'lang',
      'title',
    ]);
  });
});
