import type { PublicLocale } from '@ecoma-io/i18n-public';
import {
  PUBLIC_NAVIGATION,
  buildPublicNavigation,
  isPublicMount,
  parsePublicLayoutPath,
} from '../index';

describe('global public navigation', () => {
  it('declares exactly the global items in display order', () => {
    expect(PUBLIC_NAVIGATION.map((item) => item.mount)).toEqual(['blog', 'docs']);
    expect(PUBLIC_NAVIGATION.map((item) => item.label)).toEqual([
      { en: 'Blog', vi: 'Blog' },
      { en: 'Docs', vi: 'Docs' },
    ]);
  });

  it('only references mounts that exist in the registry', () => {
    for (const item of PUBLIC_NAVIGATION) {
      expect(isPublicMount(item.mount)).toBe(true);
    }
  });

  it('gives every item a label for every locale', () => {
    for (const item of PUBLIC_NAVIGATION) {
      expect(Object.keys(item.label).toSorted()).toEqual(['en', 'vi']);
      for (const locale of ['en', 'vi'] as const) {
        expect(item.label[locale]).not.toBe('');
      }
    }
  });

  it('is frozen: collection and entries are immutable', () => {
    expect(Object.isFrozen(PUBLIC_NAVIGATION)).toBe(true);
    for (const item of PUBLIC_NAVIGATION) {
      expect(Object.isFrozen(item)).toBe(true);
      expect(Object.isFrozen(item.label)).toBe(true);
    }
    expect(() => {
      // @ts-expect-error -- navigation là tĩnh readonly
      PUBLIC_NAVIGATION[0].mount = 'docs';
    }).toThrow(TypeError);
    expect(PUBLIC_NAVIGATION).toHaveLength(2);
  });

  describe('buildPublicNavigation', () => {
    it('builds locale-aware hrefs for en', () => {
      expect(buildPublicNavigation('en')).toEqual([
        { mount: 'blog', label: 'Blog', href: '/en/blog' },
        { mount: 'docs', label: 'Docs', href: '/en/docs' },
      ]);
    });

    it('builds locale-aware hrefs for vi', () => {
      expect(buildPublicNavigation('vi')).toEqual([
        { mount: 'blog', label: 'Blog', href: '/vi/blog' },
        { mount: 'docs', label: 'Docs', href: '/vi/docs' },
      ]);
    });

    it('produces hrefs that parse back to the same mount', () => {
      for (const locale of ['en', 'vi'] as const) {
        for (const link of buildPublicNavigation(locale)) {
          const parsed = parsePublicLayoutPath(link.href);
          expect(parsed).toMatchObject({ kind: 'localized', locale, mount: link.mount });
        }
      }
    });

    it('returns a frozen list of frozen links', () => {
      const links = buildPublicNavigation('en');
      expect(Object.isFrozen(links)).toBe(true);
      for (const link of links) {
        expect(Object.isFrozen(link)).toBe(true);
      }
    });

    it('does not share mutable state between calls', () => {
      const first = buildPublicNavigation('en');
      const second = buildPublicNavigation('en');
      expect(first).not.toBe(second);
      expect(first).toEqual(second);
      expect(PUBLIC_NAVIGATION).toHaveLength(2);
    });
  });

  describe('type safety', () => {
    it('labels are typed against the locale registry of i18n-public', () => {
      for (const item of PUBLIC_NAVIGATION) {
        expect(acceptsLocaleRecord(item.label)).not.toBe('');
      }
    });
  });
});

/** Nhận đúng shape `Record<PublicLocale, string>` — thiếu locale là lỗi type. */
function acceptsLocaleRecord(record: Readonly<Record<PublicLocale, string>>): string {
  return Object.values(record).join('');
}
