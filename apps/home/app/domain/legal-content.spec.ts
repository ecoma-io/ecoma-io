import { describe, expect, it } from 'vitest';

import { LEGAL_CONTENT, LEGAL_SLUGS } from './legal-content';
import { PUBLIC_LOCALES } from '@ecoma-io/i18n-public';

describe('LEGAL_CONTENT', () => {
  it('bao phủ toàn bộ PUBLIC_LOCALES và toàn bộ LEGAL_SLUGS (exact keys)', () => {
    const localeKeys = Object.keys(LEGAL_CONTENT).toSorted();
    expect(localeKeys).toEqual(PUBLIC_LOCALES.map((d) => d.code).toSorted());
    for (const def of PUBLIC_LOCALES) {
      expect(Object.keys(LEGAL_CONTENT[def.code]).toSorted()).toEqual([...LEGAL_SLUGS].toSorted());
    }
  });

  it('mỗi trang có title/heading/description không rỗng', () => {
    for (const def of PUBLIC_LOCALES) {
      for (const slug of LEGAL_SLUGS) {
        const page = LEGAL_CONTENT[def.code][slug];
        expect(page.title.trim().length).toBeGreaterThan(0);
        expect(page.heading.trim().length).toBeGreaterThan(0);
        expect(page.description.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('mỗi trang có ít nhất một đề mục, mỗi đề mục có heading + đoạn văn không rỗng', () => {
    for (const def of PUBLIC_LOCALES) {
      for (const slug of LEGAL_SLUGS) {
        const page = LEGAL_CONTENT[def.code][slug];
        expect(page.sections.length).toBeGreaterThan(0);
        for (const section of page.sections) {
          expect(section.heading.trim().length).toBeGreaterThan(0);
          expect(section.paragraphs.length).toBeGreaterThan(0);
          for (const paragraph of section.paragraphs) {
            expect(paragraph.trim().length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('title chứa "ecoma.io"', () => {
    for (const def of PUBLIC_LOCALES) {
      for (const slug of LEGAL_SLUGS) {
        expect(LEGAL_CONTENT[def.code][slug].title).toContain('ecoma.io');
      }
    }
  });
});
