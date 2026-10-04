import { describe, expect, it } from 'vitest';

import { HOME_CONTENT } from './home-content';
import { PUBLIC_LOCALES } from '../i18n/index';

describe('HOME_CONTENT', () => {
  it('bao phủ toàn bộ PUBLIC_LOCALES (exact keys)', () => {
    const contentKeys = Object.keys(HOME_CONTENT).toSorted();
    const localeKeys = PUBLIC_LOCALES.map((d) => d.code).toSorted();
    expect(contentKeys).toEqual(localeKeys);
  });

  it('có title/heading/description không rỗng cho từng locale', () => {
    for (const def of PUBLIC_LOCALES) {
      const c = HOME_CONTENT[def.code];
      expect(c.title.trim().length).toBeGreaterThan(0);
      expect(c.heading.trim().length).toBeGreaterThan(0);
      expect(c.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('intro và platformPoints là readonly array, có ít nhất 1 mục', () => {
    for (const def of PUBLIC_LOCALES) {
      const c = HOME_CONTENT[def.code];
      expect(Array.isArray(c.intro)).toBe(true);
      expect(Array.isArray(c.platformPoints)).toBe(true);
      expect(c.intro.length).toBeGreaterThan(0);
      expect(c.platformPoints.length).toBeGreaterThan(0);
    }
  });

  it('title chứa "Ecoma.io"', () => {
    for (const def of PUBLIC_LOCALES) {
      const c = HOME_CONTENT[def.code];
      expect(c.title).toContain('Ecoma.io');
    }
  });
});
