/**
 * Global public navigation — navigation cấp Public Web do `app/layout`
 * sở hữu.
 *
 * Dữ liệu tĩnh, frozen, không runtime fetch, không CMS schema. Application-
 * specific navigation (sidebar của docs, category của blogs…) **không** nằm
 * ở đây — nó thuộc về app.
 *
 * Label là `Record<PublicLocale, string>`: thêm một locale vào
 * `app/i18n` mà thiếu label là lỗi type ngay tại khai báo.
 */

import type { PublicLocale } from '../../i18n/index';
import { buildPublicPath } from './build-public-path';
import type { PublicMount } from './mount-registry';

/**
 * Một mục trong global navigation: trỏ đúng một public mount kèm label cho
 * mọi locale. `sections` tùy chọn: khi có, header render mount này là
 * disclosure (mega panel) thay vì link thường — vẫn là data, không phải
 * branch theo mount trong component. Mỗi section là một path resource dưới
 * mount (bắt đầu bằng `/`) kèm label theo locale.
 */
export type PublicNavigationSection = {
  readonly path: string;
  readonly label: Readonly<Record<PublicLocale, string>>;
};

export type PublicNavigationItem = {
  readonly mount: PublicMount;
  readonly label: Readonly<Record<PublicLocale, string>>;
  readonly sections?: readonly PublicNavigationSection[];
};

/**
 * Navigation item đã được resolve cho một locale cụ thể: `href` là public
 * path canonical dựng qua `buildPublicPath`, không bao giờ là string
 * concatenate. `sections` chỉ xuất hiện khi item khai báo nó trong data.
 */
export type PublicNavigationLink = {
  readonly mount: PublicMount;
  readonly label: string;
  readonly href: string;
  readonly sections?: readonly { readonly label: string; readonly href: string }[];
};

const NAVIGATION_DEFINITIONS = [
  { mount: 'blog', label: { en: 'Blog', vi: 'Blog' } },
  {
    mount: 'docs',
    label: { en: 'Docs', vi: 'Docs' },
    // Section docs thực sự có content — cùng tập với footer Documentation.
    sections: [
      { path: '/getting-started', label: { en: 'Getting started', vi: 'Bắt đầu' } },
      { path: '/concepts', label: { en: 'Concepts', vi: 'Khái niệm' } },
      { path: '/guides', label: { en: 'Guides', vi: 'Hướng dẫn' } },
    ],
  },
] as const satisfies readonly {
  mount: PublicMount;
  label: Record<PublicLocale, string>;
  sections?: readonly PublicNavigationSection[];
}[];

/**
 * Toàn bộ global navigation, frozen — **dữ liệu duy nhất** mô tả navigation
 * cấp Public Web. Mỗi mount chỉ xuất hiện tối đa một lần (lookup bắt buộc);
 * mount phải có trong registry, nên `buildPublicNavigation` không bao giờ
 * gặp mount lạ.
 */
export const PUBLIC_NAVIGATION: readonly PublicNavigationItem[] = Object.freeze(
  (NAVIGATION_DEFINITIONS as readonly PublicNavigationItem[]).map((item) =>
    Object.freeze({
      mount: item.mount,
      label: Object.freeze({ ...item.label }),
      ...(item.sections === undefined
        ? {}
        : {
            sections: Object.freeze(
              item.sections.map((s) =>
                Object.freeze({ ...s, label: Object.freeze({ ...s.label }) }),
              ),
            ),
          }),
    }),
  ),
);

/**
 * Dựng danh sách link navigation cho một locale, theo thứ tự hiển thị.
 *
 * Mọi `href` đi qua `buildPublicPath`; item không dựng được (chỉ xảy ra nếu
 * registry bị sửa sai ngoài ý muốn) bị bỏ qua thay vì trả href hỏng — không
 * có đường nào sinh URL bằng concatenation.
 */
export function buildPublicNavigation(locale: PublicLocale): readonly PublicNavigationLink[] {
  const links: PublicNavigationLink[] = [];
  for (const item of PUBLIC_NAVIGATION) {
    const built = buildPublicPath({ locale, mount: item.mount });
    if (built.kind === 'invalid') {
      continue;
    }
    // Section mount không dựng được bị bỏ kèm item — disclosure mà trỏ
    // sections hỏng thì tệ hơn là giảm còn link thường.
    const sections: { label: string; href: string }[] = [];
    let sectionsValid = true;
    if (item.sections !== undefined) {
      for (const section of item.sections) {
        const sectionBuilt = buildPublicPath({ locale, mount: item.mount, path: section.path });
        if (sectionBuilt.kind === 'invalid') {
          sectionsValid = false;
          break;
        }
        sections.push(Object.freeze({ label: section.label[locale], href: sectionBuilt.path }));
      }
      if (!sectionsValid) {
        continue;
      }
    }
    links.push(
      Object.freeze({
        mount: item.mount,
        label: item.label[locale],
        href: built.path,
        ...(item.sections === undefined ? {} : { sections: Object.freeze(sections) }),
      }),
    );
  }
  return Object.freeze(links);
}

/**
 * Một link trong footer — trỏ tới một mount (kèm `path` resource tùy chọn)
 * hoặc một locale-root (`mount: undefined`). `path` phải bắt đầu bằng `/`;
 * mọi href vẫn đi qua `buildPublicPath` nên path lạ bị loại khỏi kết quả
 * thay vì sinh URL hỏng.
 */
export type PublicFooterLink = {
  readonly mount: PublicMount | undefined;
  readonly label: Readonly<Record<PublicLocale, string>>;
  readonly path?: string;
};

/**
 * Một cột của footer: heading + các link con. Heading là
 * `Record<PublicLocale, string>` — thiếu locale là lỗi type.
 */
export type PublicFooterGroup = {
  readonly heading: Readonly<Record<PublicLocale, string>>;
  readonly links: readonly PublicFooterLink[];
};

/**
 * Footer groups — dữ liệu tĩnh, frozen, chỉ chứa destination **thực sự tồn
 * tại**: home locale-root, các public mount, các section docs đã có content
 * (`getting-started`, `concepts`, `guides`) và các resource policy dưới mount
 * `legal` do `apps/home` phục vụ. Không có link mạng xã hội — không có trang
 * nào như vậy, footer không bịa destination để lấp layout.
 */
const FOOTER_DEFINITIONS = [
  {
    heading: { en: 'Surfaces', vi: 'Bề mặt' },
    links: [
      { mount: undefined, label: { en: 'Home', vi: 'Trang chủ' } },
      { mount: 'docs', label: { en: 'Docs', vi: 'Docs' } },
      { mount: 'blog', label: { en: 'Blog', vi: 'Blog' } },
    ],
  },
  {
    heading: { en: 'Documentation', vi: 'Tài liệu' },
    links: [
      {
        mount: 'docs',
        path: '/getting-started',
        label: { en: 'Getting started', vi: 'Bắt đầu' },
      },
      { mount: 'docs', path: '/concepts', label: { en: 'Concepts', vi: 'Khái niệm' } },
      { mount: 'docs', path: '/guides', label: { en: 'Guides', vi: 'Hướng dẫn' } },
    ],
  },
  {
    heading: { en: 'Legal', vi: 'Pháp lý' },
    links: [
      {
        mount: 'legal',
        path: '/privacy',
        label: { en: 'Privacy Policy', vi: 'Chính sách bảo mật' },
      },
      {
        mount: 'legal',
        path: '/terms',
        label: { en: 'Terms of Service', vi: 'Điều khoản dịch vụ' },
      },
      {
        mount: 'legal',
        path: '/service-delivery',
        label: { en: 'Service Delivery Policy', vi: 'Chính sách cung cấp dịch vụ' },
      },
      {
        mount: 'legal',
        path: '/payment',
        label: { en: 'Payment Policy', vi: 'Chính sách thanh toán' },
      },
      {
        mount: 'legal',
        path: '/refund',
        label: { en: 'Refund Policy', vi: 'Chính sách hoàn tiền' },
      },
    ],
  },
] as const satisfies readonly {
  heading: Record<PublicLocale, string>;
  links: readonly {
    mount: PublicMount | undefined;
    label: Record<PublicLocale, string>;
    path?: string;
  }[];
}[];

/**
 * Toàn bộ footer groups, frozen — dữ liệu duy nhất mô tả footer. Footer của
 * shell render **heading + link text**, không render `<nav>` wrapper (spec
 * component ghim: footer không có navigation landmark; heading h3 không phải
 * nav).
 */
export const PUBLIC_FOOTER_GROUPS: readonly PublicFooterGroup[] = Object.freeze(
  FOOTER_DEFINITIONS.map((group) =>
    Object.freeze({
      heading: Object.freeze({ ...group.heading }),
      links: Object.freeze(group.links.map((link) => Object.freeze({ ...link }))),
    }),
  ),
);

/**
 * Mô tả ngắn của brand trong footer — một câu, mô tả đúng bề mặt đang tồn
 * tại (public web hai locale), không hứa hẹn tính năng chưa có.
 */
export const PUBLIC_FOOTER_TAGLINE: Readonly<Record<PublicLocale, string>> = Object.freeze({
  en: 'The public surface of ecoma.io — English and Vietnamese, served from the edge.',
  vi: 'Bề mặt public của ecoma.io — English và tiếng Việt, phục vụ từ edge.',
});

/**
 * Dựng footer groups đã resolve cho một locale, theo thứ tự hiển thị.
 *
 * Mọi `href` đi qua `buildPublicPath`; item không dựng được (chỉ xảy ra nếu
 * registry bị sửa sai ngoài ý muốn) bị bỏ qua thay vì trả href hỏng — không
 * có đường nào sinh URL bằng concatenation. Heading và label đã là text của
 * locale; kết quả frozen từng phần.
 */
export function buildPublicFooterGroups(
  locale: PublicLocale,
): readonly { readonly heading: string; readonly links: readonly PublicFooterLinkResolved[] }[] {
  return Object.freeze(
    PUBLIC_FOOTER_GROUPS.map((group) => {
      const links: PublicFooterLinkResolved[] = [];
      for (const link of group.links) {
        const built =
          link.mount === undefined
            ? buildPublicPath({ locale })
            : buildPublicPath({ locale, mount: link.mount, path: link.path });
        if (built.kind === 'invalid') {
          continue;
        }
        links.push(Object.freeze({ label: link.label[locale], href: built.path }));
      }
      return Object.freeze({ heading: group.heading[locale], links: Object.freeze(links) });
    }),
  );
}

/** Footer link đã resolve cho một locale: text hiển thị + href canonical. */
export type PublicFooterLinkResolved = {
  readonly label: string;
  readonly href: string;
};
