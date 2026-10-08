/**
 * Global public navigation — navigation cấp Public Web do `layout-public`
 * sở hữu.
 *
 * Dữ liệu tĩnh, frozen, không runtime fetch, không CMS schema. Application-
 * specific navigation (sidebar của docs, category của blogs…) **không** nằm
 * ở đây — nó thuộc về app.
 *
 * Label là `Record<PublicLocale, string>`: thêm một locale vào
 * `i18n-public` mà thiếu label là lỗi type ngay tại khai báo.
 */

import type { PublicLocale } from '@ecoma-io/i18n-public';
import { buildPublicPath } from './build-public-path';
import type { PublicMount } from './mount-registry';

/**
 * Một mục trong global navigation: trỏ đúng một public mount kèm label cho
 * mọi locale.
 */
export type PublicNavigationItem = {
  readonly mount: PublicMount;
  readonly label: Readonly<Record<PublicLocale, string>>;
};

/**
 * Navigation item đã được resolve cho một locale cụ thể: `href` là public
 * path canonical dựng qua `buildPublicPath`, không bao giờ là string
 * concatenate.
 */
export type PublicNavigationLink = {
  readonly mount: PublicMount;
  readonly label: string;
  readonly href: string;
};

const NAVIGATION_DEFINITIONS = [
  { mount: 'blog', label: { en: 'Blog', vi: 'Blog' } },
  { mount: 'docs', label: { en: 'Docs', vi: 'Docs' } },
] as const satisfies readonly {
  mount: PublicMount;
  label: Record<PublicLocale, string>;
}[];

/**
 * Toàn bộ global navigation, frozen — **dữ liệu duy nhất** mô tả navigation
 * cấp Public Web. Mỗi mount chỉ xuất hiện tối đa một lần (lookup bắt buộc);
 * mount phải có trong registry, nên `buildPublicNavigation` không bao giờ
 * gặp mount lạ.
 */
export const PUBLIC_NAVIGATION: readonly PublicNavigationItem[] = Object.freeze(
  NAVIGATION_DEFINITIONS.map((item) =>
    Object.freeze({
      mount: item.mount,
      label: Object.freeze({ ...item.label }),
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
    links.push(Object.freeze({ mount: item.mount, label: item.label[locale], href: built.path }));
  }
  return Object.freeze(links);
}
