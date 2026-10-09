import type { PublicLocale } from '@ecoma-io/i18n-public';
import {
  PUBLIC_FOOTER_GROUPS,
  PUBLIC_FOOTER_TAGLINE,
  PUBLIC_NAVIGATION,
  buildPublicFooterGroups,
  buildPublicNavigation,
  isPublicMount,
  parsePublicLayoutPath,
} from '../index';
import type { PublicMount } from './mount-registry';

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
    // Gom mọi đích freeze (item, label, sections, từng section + label) vào
    // một mảng rồi assert .every — tránh no-conditional-expect.
    const nested = PUBLIC_NAVIGATION.flatMap((item) => [
      item,
      item.label,
      ...(item.sections ?? []).flatMap((section) => [section, section.label]),
    ]);
    expect(nested.every((entry) => Object.isFrozen(entry))).toBe(true);
    expect(() => {
      // @ts-expect-error -- navigation là tĩnh readonly
      PUBLIC_NAVIGATION[0].mount = 'docs';
    }).toThrow(TypeError);
    expect(PUBLIC_NAVIGATION).toHaveLength(2);
  });

  it('declares sections only as real docs content paths', () => {
    // Section trong nav data phải trỏ đúng resource docs đang tồn tại — cùng
    // tập với footer Documentation; thiếu locale hay path lạ là lỗi data.
    const docs = PUBLIC_NAVIGATION.find((item) => item.mount === 'docs');
    expect(docs?.sections?.map((section) => section.path)).toEqual([
      '/getting-started',
      '/concepts',
      '/guides',
    ]);
    for (const item of PUBLIC_NAVIGATION) {
      for (const section of item.sections ?? []) {
        expect(Object.keys(section.label).toSorted()).toEqual(['en', 'vi']);
        expect(section.path.startsWith('/')).toBe(true);
      }
    }
  });

  describe('buildPublicNavigation', () => {
    it('builds locale-aware hrefs for en, resolving declared sections', () => {
      expect(buildPublicNavigation('en')).toEqual([
        { mount: 'blog', label: 'Blog', href: '/en/blog' },
        {
          mount: 'docs',
          label: 'Docs',
          href: '/en/docs',
          sections: [
            { label: 'Getting started', href: '/en/docs/getting-started' },
            { label: 'Concepts', href: '/en/docs/concepts' },
            { label: 'Guides', href: '/en/docs/guides' },
          ],
        },
      ]);
    });

    it('builds locale-aware hrefs for vi, resolving declared sections', () => {
      expect(buildPublicNavigation('vi')).toEqual([
        { mount: 'blog', label: 'Blog', href: '/vi/blog' },
        {
          mount: 'docs',
          label: 'Docs',
          href: '/vi/docs',
          sections: [
            { label: 'Bắt đầu', href: '/vi/docs/getting-started' },
            { label: 'Khái niệm', href: '/vi/docs/concepts' },
            { label: 'Hướng dẫn', href: '/vi/docs/guides' },
          ],
        },
      ]);
    });

    it('produces hrefs that parse back to the same mount', () => {
      for (const locale of ['en', 'vi'] as const) {
        for (const link of buildPublicNavigation(locale)) {
          const parsed = parsePublicLayoutPath(link.href);
          expect(parsed).toMatchObject({ kind: 'localized', locale, mount: link.mount });
          for (const section of link.sections ?? []) {
            const sectionParsed = parsePublicLayoutPath(section.href);
            expect(sectionParsed).toMatchObject({ kind: 'localized', locale, mount: link.mount });
          }
        }
      }
    });

    it('returns a frozen list of frozen links, section lists included', () => {
      const links = buildPublicNavigation('en');
      expect(Object.isFrozen(links)).toBe(true);
      // Gom mọi đích freeze vào một mảng rồi assert .every — tránh
      // no-conditional-expect (expect trong if/for).
      const nested = links.flatMap((link) => [link, ...(link.sections ?? [])]);
      expect(nested.every((entry) => Object.isFrozen(entry))).toBe(true);
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

describe('footer groups', () => {
  it('declares only real destinations: registry mounts and docs sections', () => {
    /** Mount của mọi link, đã bỏ `undefined` (locale-root link không có mount). */
    const mounts: PublicMount[] = [];
    /** Path của mọi link có path — thu thập rồi assert độc lập với mount. */
    const paths: string[] = [];
    for (const group of PUBLIC_FOOTER_GROUPS) {
      for (const link of group.links) {
        if (link.mount !== undefined) {
          mounts.push(link.mount);
        }
        if (link.path !== undefined) {
          paths.push(link.path);
        }
      }
    }
    // Mọi mount không-undefined phải có trong registry.
    expect(mounts.every((mount) => isPublicMount(mount))).toBe(true);
    // Link có path chỉ tồn tại khi path là resource path chuẩn (bắt đầu bằng
    // `/`) — footer không sinh URL bằng concatenation.
    expect(paths.every((path) => path.startsWith('/'))).toBe(true);
    // Cột Documentation chỉ chứa ba section docs có content thật.
    const docsGroup = PUBLIC_FOOTER_GROUPS.find((group) => group.heading.en === 'Documentation');
    expect(docsGroup?.links.map((link) => link.path)).toEqual([
      '/getting-started',
      '/concepts',
      '/guides',
    ]);
  });

  it('gives every heading and link a label for every locale', () => {
    for (const group of PUBLIC_FOOTER_GROUPS) {
      expect(Object.keys(group.heading).toSorted()).toEqual(['en', 'vi']);
      for (const link of group.links) {
        expect(Object.keys(link.label).toSorted()).toEqual(['en', 'vi']);
      }
    }
    expect(Object.keys(PUBLIC_FOOTER_TAGLINE).toSorted()).toEqual(['en', 'vi']);
  });

  it('is frozen: groups, headings and links are immutable', () => {
    expect(Object.isFrozen(PUBLIC_FOOTER_GROUPS)).toBe(true);
    for (const group of PUBLIC_FOOTER_GROUPS) {
      expect(Object.isFrozen(group)).toBe(true);
      expect(Object.isFrozen(group.heading)).toBe(true);
      expect(Object.isFrozen(group.links)).toBe(true);
    }
  });

  describe('buildPublicFooterGroups', () => {
    it('resolves headings and locale-aware hrefs for en', () => {
      expect(buildPublicFooterGroups('en')).toEqual([
        {
          heading: 'Surfaces',
          links: [
            { label: 'Home', href: '/en' },
            { label: 'Docs', href: '/en/docs' },
            { label: 'Blog', href: '/en/blog' },
          ],
        },
        {
          heading: 'Documentation',
          links: [
            { label: 'Getting started', href: '/en/docs/getting-started' },
            { label: 'Concepts', href: '/en/docs/concepts' },
            { label: 'Guides', href: '/en/docs/guides' },
          ],
        },
      ]);
    });

    it('resolves headings and locale-aware hrefs for vi', () => {
      expect(buildPublicFooterGroups('vi')).toEqual([
        {
          heading: 'Bề mặt',
          links: [
            { label: 'Trang chủ', href: '/vi' },
            { label: 'Docs', href: '/vi/docs' },
            { label: 'Blog', href: '/vi/blog' },
          ],
        },
        {
          heading: 'Tài liệu',
          links: [
            { label: 'Bắt đầu', href: '/vi/docs/getting-started' },
            { label: 'Khái niệm', href: '/vi/docs/concepts' },
            { label: 'Hướng dẫn', href: '/vi/docs/guides' },
          ],
        },
      ]);
    });

    it('produces hrefs that parse back to the same locale and mount', () => {
      for (const locale of ['en', 'vi'] as const) {
        for (const group of buildPublicFooterGroups(locale)) {
          for (const link of group.links) {
            const parsed = parsePublicLayoutPath(link.href);
            expect(parsed).toMatchObject({ locale });
          }
        }
      }
    });

    it('returns frozen groups with frozen links', () => {
      const groups = buildPublicFooterGroups('en');
      expect(Object.isFrozen(groups)).toBe(true);
      for (const group of groups) {
        expect(Object.isFrozen(group)).toBe(true);
        expect(Object.isFrozen(group.links)).toBe(true);
        for (const link of group.links) {
          expect(Object.isFrozen(link)).toBe(true);
        }
      }
    });
  });
});

/** Nhận đúng shape `Record<PublicLocale, string>` — thiếu locale là lỗi type. */
function acceptsLocaleRecord(record: Readonly<Record<PublicLocale, string>>): string {
  return Object.values(record).join('');
}
